from __future__ import annotations

import io
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional
from uuid import uuid4
import logging
import os
import re
import secrets
from urllib.parse import urlparse, unquote

import pandas as pd
import mcp.types as types
from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP
from pandas.errors import EmptyDataError, ParserError
from pydantic import ValidationError

from .charts import build_chart_response
from .filters import apply_filters
from .profiling import profile_dataframe
from .schemas import (
    ChartInput,
    DatasetProfile,
    DatasetSummary,
    OpenResponse,
    PreviewInput,
    PreviewResponse,
    UploadChunkInput,
    UploadDatasetInput,
    UploadDatasetResponse,
    UploadInitInput,
    UploadInitResponse,
)
from .store import DatasetRecord, DatasetStore
from .utils import dataframe_preview
from starlette.requests import Request
from starlette.responses import JSONResponse


ASSET_LOGGER = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
COMPONENT_NAME = "data-explorer"
TEMPLATE_URI = f"ui://widget/{COMPONENT_NAME}.html"
SCRIPT_URI = f"ui://widget/{COMPONENT_NAME}.js"
STYLE_URI = f"ui://widget/{COMPONENT_NAME}.css"
MIME_TYPE = "text/html+skybridge"
EMPTY_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {},
    "additionalProperties": False,
}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB default limit
UPLOAD_SESSION_TTL_SECONDS = 20 * 60  # 20 minutes
PATH_ALLOWLIST_ENV = "DATA_EXPLORER_ALLOWED_UPLOAD_ROOTS"
AUTH_TOKEN_ENV = "DATA_EXPLORER_AUTH_TOKEN"
CORS_ORIGINS_ENV = "DATA_EXPLORER_CORS_ALLOW_ORIGINS"
PATH_UPLOAD_DISABLED_MESSAGE = (
    "filePath/fileUri uploads are disabled. Provide csvText or set "
    f"{PATH_ALLOWLIST_ENV} to allow specific directories."
)

SECURITY_LOGGER = logging.getLogger("data_explorer_server.security")

_SCRIPT_TAG_PATTERN = re.compile(
    r"<script[^>]*src=\"[^\"]*/(?P<filename>[\w.-]+\.js)\"[^>]*></script>",
    re.IGNORECASE,
)

_STYLESHEET_LINK_PATTERN = re.compile(
    r"<link[^>]*href=\"[^\"]*/(?P<filename>[\w.-]+\.css)\"[^>]*/?>",
    re.IGNORECASE,
)


def _parse_path_allowlist(raw_value: Optional[str]) -> tuple[Path, ...]:
    if not raw_value:
        return ()

    roots: List[Path] = []
    for entry in raw_value.split(os.pathsep):
        candidate = entry.strip()
        if not candidate:
            continue
        try:
            resolved = Path(candidate).expanduser().resolve(strict=False)
        except OSError as exc:
            SECURITY_LOGGER.warning(
                "Ignoring invalid path in %s (%s): %s",
                PATH_ALLOWLIST_ENV,
                candidate,
                exc,
            )
            continue
        roots.append(resolved)
    return tuple(roots)


def _ensure_path_within_allowlist(resolved_path: Path) -> None:
    if not _ALLOWED_UPLOAD_ROOTS:
        raise HTTPException(status_code=400, detail=PATH_UPLOAD_DISABLED_MESSAGE)

    for root in _ALLOWED_UPLOAD_ROOTS:
        try:
            resolved_path.relative_to(root)
            return
        except ValueError:
            continue

    raise HTTPException(
        status_code=403,
        detail="Requested file path is outside the configured allowlist.",
    )


def _load_widget_assets() -> tuple[str, Optional[str], Optional[str]]:
    base_path = ASSETS_DIR / f"{COMPONENT_NAME}.html"
    html_source: Optional[str] = None

    if base_path.exists():
        html_source = base_path.read_text(encoding="utf8")
    else:
        candidates = sorted(ASSETS_DIR.glob(f"{COMPONENT_NAME}-*.html"))
        if candidates:
            html_source = candidates[-1].read_text(encoding="utf8")

    if html_source is None:
        # Provide minimal shell if assets missing.
        return (
            """<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <style>\n      body { font-family: system-ui, sans-serif; padding: 1rem; }\n    </style>\n  </head>\n  <body>\n    <div id=\"data-explorer-root\"></div>\n    <script type=\"module\">\n      console.warn(\"Data Explorer bundle missing from assets/. Run 'pnpm run build' to generate it.\");\n    </script>\n  </body>\n</html>\n""",
            None,
            None,
        )

    script_match = _SCRIPT_TAG_PATTERN.search(html_source)
    style_match = _STYLESHEET_LINK_PATTERN.search(html_source)
    script_text: Optional[str] = None
    style_text: Optional[str] = None

    if script_match:
        script_filename = script_match.group("filename")
        try:
            script_text = (ASSETS_DIR / script_filename).read_text(encoding="utf8")
        except FileNotFoundError:
            ASSET_LOGGER.warning("Script asset missing: %s", script_filename)
        except OSError as exc:
            ASSET_LOGGER.warning("Failed to read script %s: %s", script_filename, exc)
        if script_text is not None:
            html_source = _SCRIPT_TAG_PATTERN.sub(
                f'<script type="module" src="{SCRIPT_URI}"></script>',
                html_source,
                count=1,
            )

    if style_match:
        style_filename = style_match.group("filename")
        try:
            style_text = (ASSETS_DIR / style_filename).read_text(encoding="utf8")
        except FileNotFoundError:
            ASSET_LOGGER.warning("Stylesheet asset missing: %s", style_filename)
        except OSError as exc:
            ASSET_LOGGER.warning(
                "Failed to read stylesheet %s: %s", style_filename, exc
            )
        if style_text is not None:
            html_source = _STYLESHEET_LINK_PATTERN.sub(
                f'<link rel="stylesheet" href="{STYLE_URI}" />',
                html_source,
                count=1,
            )

    return html_source, script_text, style_text


def _format_size_limit_error(max_bytes: int) -> str:
    return f"Upload exceeds maximum size of {max_bytes // (1024 * 1024)} MB."


@dataclass
class UploadSession:
    upload_id: str
    dataset_name: str
    delimiter: Optional[str]
    has_header: bool
    filename: Optional[str]
    created_at: datetime
    buffer: io.StringIO
    byte_count: int = 0
    chunk_count: int = 0

    def append_chunk(
        self, chunk: str, chunk_index: Optional[int], max_bytes: int
    ) -> int:
        if chunk_index is not None and chunk_index != self.chunk_count:
            raise ValueError(
                f"Unexpected chunkIndex {chunk_index}; expected {self.chunk_count}."
            )

        encoded = chunk.encode("utf-8")
        new_total = self.byte_count + len(encoded)
        if new_total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=_format_size_limit_error(max_bytes),
            )

        self.buffer.write(chunk)
        self.byte_count = new_total
        self.chunk_count += 1
        return self.byte_count


class UploadSessionManager:
    def __init__(self, max_bytes: int, ttl_seconds: int) -> None:
        self._max_bytes = max_bytes
        self._ttl_seconds = ttl_seconds
        self._sessions: Dict[str, UploadSession] = {}
        self._lock = Lock()

    def _cleanup_expired(self) -> None:
        now = datetime.now(timezone.utc)
        with self._lock:
            expired = [
                upload_id
                for upload_id, session in self._sessions.items()
                if (now - session.created_at).total_seconds() > self._ttl_seconds
            ]
            for upload_id in expired:
                del self._sessions[upload_id]

    def create_session(
        self,
        dataset_name: str,
        delimiter: Optional[str],
        has_header: bool,
        filename: Optional[str],
    ) -> UploadSession:
        self._cleanup_expired()
        upload_id = str(uuid4())
        session = UploadSession(
            upload_id=upload_id,
            dataset_name=dataset_name,
            delimiter=delimiter,
            has_header=has_header,
            filename=filename,
            created_at=datetime.now(timezone.utc),
            buffer=io.StringIO(),
        )
        with self._lock:
            self._sessions[upload_id] = session
        return session

    def append_chunk(
        self, upload_id: str, chunk: str, chunk_index: Optional[int]
    ) -> UploadSession:
        with self._lock:
            session = self._sessions.get(upload_id)
            if session is None:
                raise KeyError(upload_id)
            try:
                session.append_chunk(chunk, chunk_index, self._max_bytes)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            return session

    def finalize_session(self, upload_id: str) -> UploadSession:
        with self._lock:
            session = self._sessions.pop(upload_id, None)
        if session is None:
            raise KeyError(upload_id)
        return session


def _summary_from_record(record: DatasetRecord) -> DatasetSummary:
    profile = DatasetProfile.model_validate(record.profile)
    return DatasetSummary(
        dataset_id=record.dataset_id,
        dataset_name=record.name,
        row_count=record.row_count,
        column_count=record.column_count,
        created_at=record.created_at.isoformat(),
        filename=record.filename,
        profile=profile,
    )


def _json_content(payload: Dict[str, Any]) -> List[types.Content]:
    text = json.dumps(payload, default=str)
    return [
        types.TextContent(
            type="text",
            text=text,
        )
    ]


def _ensure_inline_size_within_limit(csv_text: str, max_bytes: int) -> None:
    encoded = csv_text.encode("utf-8")
    if len(encoded) > max_bytes:
        raise HTTPException(status_code=413, detail=_format_size_limit_error(max_bytes))


def _extract_path_from_payload(payload: UploadDatasetInput) -> Optional[Path]:
    if payload.file_path:
        return Path(payload.file_path).expanduser()

    if payload.file_uri:
        parsed = urlparse(payload.file_uri)
        if parsed.scheme not in ("", "file"):
            raise HTTPException(
                status_code=400,
                detail="Only local file URIs (file://) are supported for uploads.",
            )

        allowed_hosts = ("", "localhost", "127.0.0.1")
        netloc = parsed.netloc
        path_component = unquote(parsed.path or "")

        if os.name == "nt" and netloc not in allowed_hosts:
            # Windows file URIs may use the drive letter as the authority component
            if len(netloc) == 2 and netloc[1] == ":":
                path_component = f"{netloc}{path_component}"
                netloc = ""
            else:
                raise HTTPException(
                    status_code=400,
                    detail="File URIs must reference the local machine.",
                )

        if netloc not in allowed_hosts:
            raise HTTPException(
                status_code=400,
                detail="File URIs must reference the local machine.",
            )

        if not path_component:
            raise HTTPException(status_code=400, detail="fileUri is missing a path.")

        if (
            os.name == "nt"
            and path_component.startswith("/")
            and len(path_component) > 2
            and path_component[2] == ":"
        ):
            path_component = path_component.lstrip("/")

        return Path(path_component).expanduser()

    return None


def _read_csv_from_path(path: Path, desired_encoding: Optional[str]) -> str:
    candidate = path.expanduser()
    try:
        resolved_path = candidate.resolve(strict=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {candidate}")
    except OSError as exc:
        raise HTTPException(
            status_code=400, detail=f"Unable to resolve upload path: {exc}"
        ) from exc

    _ensure_path_within_allowlist(resolved_path)

    if not resolved_path.is_file():
        raise HTTPException(
            status_code=400,
            detail=f"Upload target is not a file: {resolved_path}",
        )

    file_size = resolved_path.stat().st_size
    if file_size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if file_size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413, detail=_format_size_limit_error(MAX_UPLOAD_BYTES)
        )

    raw_bytes = resolved_path.read_bytes()
    # Probe encodings in priority order, skipping duplicates
    candidate_encodings = []
    if desired_encoding:
        candidate_encodings.append(desired_encoding)
    candidate_encodings.extend(["utf-8", "utf-8-sig", "latin-1"])

    seen: set[str] = set()
    for encoding in candidate_encodings:
        normalized = encoding.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
        except LookupError:
            continue

    raise HTTPException(
        status_code=400,
        detail=(
            "Failed to decode uploaded file. Specify an encoding via the encoding field"
        ),
    )


def _resolve_upload_source(payload: UploadDatasetInput) -> tuple[str, Optional[str]]:
    if payload.csv_text:
        _ensure_inline_size_within_limit(payload.csv_text, MAX_UPLOAD_BYTES)
        return payload.csv_text, payload.filename

    path = _extract_path_from_payload(payload)
    if path is None:
        raise HTTPException(
            status_code=400, detail="No CSV source provided for upload."
        )

    csv_text = _read_csv_from_path(
        path, payload.encoding.strip() if payload.encoding else None
    )
    filename = payload.filename or path.name
    return csv_text, filename


def _csv_to_dataframe(csv_text: str, payload: UploadDatasetInput) -> pd.DataFrame:
    buffer = io.StringIO(csv_text)
    read_kwargs: Dict[str, Any] = {
        "sep": payload.delimiter if payload.delimiter else None,
        "engine": "python",
    }
    if not payload.has_header:
        read_kwargs["header"] = None
    try:
        dataframe = pd.read_csv(buffer, **read_kwargs)
    except (EmptyDataError, ParserError) as exc:
        raise HTTPException(
            status_code=400, detail=f"Failed to parse CSV: {exc}"
        ) from exc

    if dataframe.empty:
        raise HTTPException(status_code=400, detail="Uploaded CSV is empty.")

    dataframe = dataframe.convert_dtypes()
    if not payload.has_header:
        dataframe.columns = [f"column_{idx + 1}" for idx in range(dataframe.shape[1])]

    return dataframe


_WIDGET_HTML, _WIDGET_SCRIPT, _WIDGET_STYLE = _load_widget_assets()

_ALLOWED_UPLOAD_ROOTS = _parse_path_allowlist(os.getenv(PATH_ALLOWLIST_ENV))
_AUTH_TOKEN = os.getenv(AUTH_TOKEN_ENV)
_CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in (os.getenv(CORS_ORIGINS_ENV) or "").split(",")
    if origin.strip()
]

store = DatasetStore()
upload_manager = UploadSessionManager(MAX_UPLOAD_BYTES, UPLOAD_SESSION_TTL_SECONDS)
mcp = FastMCP(name="data-explorer", stateless_http=True)
WIDGET_HTML = _WIDGET_HTML
logger = logging.getLogger("data_explorer_server")
logging.basicConfig(level=logging.INFO)


def _tool_meta() -> Dict[str, Any]:
    return {
        "openai/outputTemplate": TEMPLATE_URI,
        "openai/resultCanProduceWidget": True,
        "openai/widgetAccessible": True,
        "openai/toolInvocation/invoking": "Profiling dataset",
        "openai/toolInvocation/invoked": "Dataset ready",
    }


@mcp._mcp_server.list_tools()
async def _list_tools() -> List[types.Tool]:
    def build_tool(
        name: str, title: str, description: str, input_schema: Dict[str, Any]
    ) -> types.Tool:
        return types.Tool(
            name=name,
            title=title,
            description=description,
            inputSchema=json.loads(json.dumps(input_schema)),
            _meta=_tool_meta(),
            annotations={
                "destructiveHint": False,
                "openWorldHint": False,
                "readOnlyHint": False,
            },
        )

    return [
        build_tool(
            "data-explorer.open",
            "Open Data Explorer",
            "Mount the data exploration widget.",
            EMPTY_INPUT_SCHEMA,
        ),
        build_tool(
            "data-explorer.uploadInit",
            "Begin Chunked Upload",
            "Start a chunked CSV upload session.",
            UploadInitInput.model_json_schema(),
        ),
        build_tool(
            "data-explorer.uploadChunk",
            "Upload CSV Chunk",
            "Append a CSV chunk to an existing upload session.",
            UploadChunkInput.model_json_schema(),
        ),
        build_tool(
            "data-explorer.upload",
            "Upload CSV",
            "Upload a CSV dataset for profiling and exploration.",
            UploadDatasetInput.model_json_schema(),
        ),
        build_tool(
            "data-explorer.preview",
            "Get Preview",
            "Fetch a filtered preview of the dataset.",
            PreviewInput.model_json_schema(),
        ),
        build_tool(
            "data-explorer.chart",
            "Build Chart",
            "Create chart-ready data using current filters.",
            ChartInput.model_json_schema(),
        ),
    ]


@mcp._mcp_server.list_resources()
async def _list_resources() -> List[types.Resource]:
    resources = [
        types.Resource(
            name="Data Explorer Widget",
            title="Data Explorer Widget",
            uri=TEMPLATE_URI,
            description="HTML bundle for the data explorer widget.",
            mimeType=MIME_TYPE,
            _meta=_tool_meta(),
        )
    ]
    if _WIDGET_SCRIPT is not None:
        resources.append(
            types.Resource(
                name="Data Explorer Script",
                title="Data Explorer Script",
                uri=SCRIPT_URI,
                description="JavaScript bundle for the data explorer widget.",
                mimeType="text/javascript",
                _meta=_tool_meta(),
            )
        )
    if _WIDGET_STYLE is not None:
        resources.append(
            types.Resource(
                name="Data Explorer Styles",
                title="Data Explorer Styles",
                uri=STYLE_URI,
                description="Stylesheet for the data explorer widget.",
                mimeType="text/css",
                _meta=_tool_meta(),
            )
        )
    return resources


@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    templates = [
        types.ResourceTemplate(
            name="Data Explorer Widget",
            title="Data Explorer Widget",
            uriTemplate=TEMPLATE_URI,
            description="HTML bundle for the data explorer widget.",
            mimeType=MIME_TYPE,
            _meta=_tool_meta(),
        )
    ]
    if _WIDGET_SCRIPT is not None:
        templates.append(
            types.ResourceTemplate(
                name="Data Explorer Script",
                title="Data Explorer Script",
                uriTemplate=SCRIPT_URI,
                description="JavaScript bundle for the data explorer widget.",
                mimeType="text/javascript",
                _meta=_tool_meta(),
            )
        )
    if _WIDGET_STYLE is not None:
        templates.append(
            types.ResourceTemplate(
                name="Data Explorer Styles",
                title="Data Explorer Styles",
                uriTemplate=STYLE_URI,
                description="Stylesheet for the data explorer widget.",
                mimeType="text/css",
                _meta=_tool_meta(),
            )
        )
    return templates


async def _read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    uri = str(req.params.uri)
    if uri == TEMPLATE_URI:
        return types.ServerResult(
            types.ReadResourceResult(
                contents=[
                    types.TextResourceContents(
                        text=WIDGET_HTML,
                        uri=TEMPLATE_URI,
                        mimeType=MIME_TYPE,
                        _meta=_tool_meta(),
                    )
                ]
            )
        )

    if uri == SCRIPT_URI and _WIDGET_SCRIPT is not None:
        return types.ServerResult(
            types.ReadResourceResult(
                contents=[
                    types.TextResourceContents(
                        text=_WIDGET_SCRIPT,
                        uri=SCRIPT_URI,
                        mimeType="text/javascript",
                        _meta=_tool_meta(),
                    )
                ]
            )
        )

    if uri == STYLE_URI and _WIDGET_STYLE is not None:
        return types.ServerResult(
            types.ReadResourceResult(
                contents=[
                    types.TextResourceContents(
                        text=_WIDGET_STYLE,
                        uri=STYLE_URI,
                        mimeType="text/css",
                        _meta=_tool_meta(),
                    )
                ]
            )
        )

    return types.ServerResult(
        types.ReadResourceResult(
            contents=[],
            _meta={"error": f"Unknown resource: {req.params.uri}"},
        )
    )


def _handle_open() -> OpenResponse:
    datasets = [_summary_from_record(record) for record in store.list_recent()]
    response = OpenResponse(
        datasets=datasets,
        active_dataset_id=datasets[0].dataset_id if datasets else None,
        supports_chunk_upload=True,
        max_upload_bytes=MAX_UPLOAD_BYTES,
    )
    return response


def _process_dataset_upload(payload: UploadDatasetInput) -> UploadDatasetResponse:
    csv_text, inferred_filename = _resolve_upload_source(payload)
    dataframe = _csv_to_dataframe(csv_text, payload)
    resolved_filename = payload.filename or inferred_filename
    profile = profile_dataframe(dataframe)
    record = store.create(
        name=payload.dataset_name,
        filename=resolved_filename,
        dataframe=dataframe,
        profile=profile,
    )
    summary = _summary_from_record(record)
    preview_rows = dataframe_preview(record.dataframe, limit=20)

    return UploadDatasetResponse(
        dataset=summary,
        preview=preview_rows,
        columns=list(record.dataframe.columns),
    )


def _handle_upload(args: Dict[str, Any]) -> UploadDatasetResponse:
    payload = UploadDatasetInput.model_validate(args)
    return _process_dataset_upload(payload)


def _handle_upload_init(args: Dict[str, Any]) -> UploadInitResponse:
    logger.info("Handling uploadInit with args keys: %s", list(args.keys()))
    if "csvText" in args:
        logger.info(
            "uploadInit received csvText; treating request as direct upload for backwards compatibility"
        )
        dataset_args = {
            "datasetName": args.get("datasetName"),
            "csvText": args.get("csvText"),
            "delimiter": args.get("delimiter"),
            "hasHeader": args.get("hasHeader", True),
            "filename": args.get("filename"),
        }
        dataset_payload = UploadDatasetInput.model_validate(dataset_args)
        return _process_dataset_upload(dataset_payload)

    payload = UploadInitInput.model_validate(args)
    dataset_name = (payload.dataset_name or "").strip()
    session = upload_manager.create_session(
        dataset_name=dataset_name,
        delimiter=payload.delimiter,
        has_header=payload.has_header,
        filename=payload.filename,
    )
    return UploadInitResponse(uploadId=session.upload_id)


def _handle_upload_chunk(args: Dict[str, Any]) -> Dict[str, Any]:
    payload = UploadChunkInput.model_validate(args)
    try:
        session = upload_manager.append_chunk(
            payload.upload_id, payload.chunk_text, payload.chunk_index
        )
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Unknown uploadId: {payload.upload_id}"
        ) from None

    total_bytes = session.byte_count

    if not payload.is_final:
        return {
            "uploadId": session.upload_id,
            "receivedBytes": total_bytes,
            "isFinalized": False,
        }

    finalized_session = upload_manager.finalize_session(payload.upload_id)
    dataset_payload = UploadDatasetInput(
        datasetName=finalized_session.dataset_name,
        csvText=finalized_session.buffer.getvalue(),
        delimiter=finalized_session.delimiter,
        hasHeader=finalized_session.has_header,
        filename=finalized_session.filename,
    )
    response = _process_dataset_upload(dataset_payload)
    result = response.model_dump(by_alias=True)
    result["uploadId"] = finalized_session.upload_id
    result["isFinalized"] = True
    result["receivedBytes"] = total_bytes
    return result


def _handle_preview(args: Dict[str, Any]) -> PreviewResponse:
    payload = PreviewInput.model_validate(args)
    record = store.get(payload.dataset_id)
    filtered = apply_filters(record.dataframe, payload.filters)
    preview_rows = dataframe_preview(
        filtered, limit=payload.limit, offset=payload.offset
    )

    response = PreviewResponse(
        dataset_id=record.dataset_id,
        total_rows=int(filtered.shape[0]),
        rows=preview_rows,
        columns=list(filtered.columns),
        applied_filters=payload.filters,
    )
    return response


def _handle_chart(args: Dict[str, Any]) -> Dict[str, Any]:
    payload = ChartInput.model_validate(args)
    record = store.get(payload.dataset_id)
    filtered = apply_filters(record.dataframe, payload.filters)
    if filtered.empty:
        chart_response = {
            "datasetId": record.dataset_id,
            "chartType": payload.config.chart_type.value,
            "config": payload.config.model_dump(by_alias=True),
            "series": [],
            "points": [],
            "bins": [],
        }
    else:
        chart_model = build_chart_response(filtered, payload.config, record.dataset_id)
        chart_response = chart_model.model_dump(by_alias=True)

    return chart_response


async def _on_read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    return await _read_resource(req)


async def _on_call_tool(req: types.CallToolRequest) -> types.ServerResult:
    tool_name = req.params.name
    args = req.params.arguments or {}
    logger.info(
        "Received tool call: name=%s args=%s", tool_name, json.dumps(args, default=str)
    )

    try:
        if tool_name == "data-explorer.open":
            response = _handle_open()
            payload = response.model_dump(by_alias=True)
        elif tool_name == "data-explorer.uploadInit":
            response = _handle_upload_init(args)
            payload = response.model_dump(by_alias=True)
        elif tool_name == "data-explorer.uploadChunk":
            payload = _handle_upload_chunk(args)
        elif tool_name == "data-explorer.upload":
            response = _handle_upload(args)
            payload = response.model_dump(by_alias=True)
        elif tool_name == "data-explorer.preview":
            response = _handle_preview(args)
            payload = response.model_dump(by_alias=True)
        elif tool_name == "data-explorer.chart":
            payload = _handle_chart(args)
        else:
            return types.ServerResult(
                types.CallToolResult(
                    content=[
                        types.TextContent(
                            type="text", text=f"Unknown tool: {tool_name}"
                        )
                    ],
                    isError=True,
                )
            )
    except ValidationError as exc:
        logger.warning(
            "Validation error while handling tool '%s': %s",
            tool_name,
            exc.errors(),
        )
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=json.dumps(
                            {"error": "validation_error", "details": exc.errors()}
                        ),
                    )
                ],
                isError=True,
            )
        )
    except HTTPException as exc:
        logger.warning(
            "HTTPException while handling tool '%s': %s",
            tool_name,
            exc.detail,
        )
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=json.dumps({"error": exc.detail}),
                    )
                ],
                isError=True,
            )
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Unhandled error while handling tool '%s'", tool_name)
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=json.dumps(
                            {"error": "internal_error", "details": str(exc)}
                        ),
                    )
                ],
                isError=True,
            )
        )

    return types.ServerResult(
        types.CallToolResult(
            content=_json_content(payload),
            structuredContent=payload,
            _meta=_tool_meta(),
        )
    )


mcp._mcp_server.request_handlers[types.ReadResourceRequest] = _on_read_resource
mcp._mcp_server.request_handlers[types.CallToolRequest] = _on_call_tool

app = mcp.streamable_http_app()


@app.middleware("http")
async def _enforce_bearer_token(request: Request, call_next):
    if not _AUTH_TOKEN:
        return await call_next(request)

    header_value = request.headers.get("authorization")
    if not header_value or not header_value.startswith("Bearer "):
        return JSONResponse({"error": "Missing bearer token"}, status_code=401)

    provided = header_value.split(" ", 1)[1].strip()
    if not provided or not secrets.compare_digest(provided, _AUTH_TOKEN):
        return JSONResponse({"error": "Invalid bearer token"}, status_code=403)

    return await call_next(request)


async def _health_endpoint(request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    response = await call_next(request)
    logger.info("%s %s -> %s", request.method, request.url.path, response.status_code)
    return response


app.add_route("/health", _health_endpoint, methods=["GET"])

try:
    from starlette.middleware.cors import CORSMiddleware

    if _CORS_ALLOWED_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=_CORS_ALLOWED_ORIGINS,
            allow_methods=["*"],
            allow_headers=["*"],
            allow_credentials=False,
        )
except Exception:  # pragma: no cover - optional dependency
    pass


__all__ = ["app", "mcp", "store"]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("data_explorer_server_python.main:app", host="0.0.0.0", port=8001)
