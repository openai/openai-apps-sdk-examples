"""Pizzaz demo MCP server implemented with the Python FastMCP helper.

The server mirrors the Node example in this repository and exposes
widget-backed tools that render the Pizzaz UI bundle. Each handler returns the
HTML shell via an MCP resource and echoes the selected topping as structured
content so the ChatGPT client can hydrate the widget. The module also wires the
handlers into an HTTP/SSE stack so you can run the server with uvicorn on port
8000, matching the Node transport behavior."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List
import re

import hashlib
from dotenv import load_dotenv
import json
import logging
import os
import time

import mcp.types as types
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, ValidationError

logger = logging.getLogger(__name__)


REPO_ROOT = Path(__file__).resolve().parents[1]

# Load .env from this server directory if present, with OS env taking precedence
try:
    load_dotenv(REPO_ROOT / "pizzaz_server_python" / ".env")
except Exception:
    pass
ASSETS_DIR = REPO_ROOT / "assets"

with (REPO_ROOT / "package.json").open("r", encoding="utf-8") as package_file:
    _package_version = json.load(package_file)["version"]

DEFAULT_ASSET_HASH = hashlib.sha256(_package_version.encode("utf-8")).hexdigest()[:4]


def _discover_asset_hash() -> str | None:
    try:
        candidates = sorted(
            ASSETS_DIR.glob("*.js"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except FileNotFoundError:
        return None
    except OSError as exc:  # pragma: no cover
        logger.warning("Failed to scan assets directory for hash: %s", exc)
        return None

    pattern = re.compile(r"^[a-z0-9-]+-([0-9a-f]{4})\.js$")
    for candidate in candidates:
        match = pattern.match(candidate.name)
        if match:
            return match.group(1)
    return None


def _get_env(key: str) -> str | None:
    return os.environ.get(key)


# Environment variables - only these three are supported
ENVIRONMENT = (_get_env("ENVIRONMENT") or "").strip()
DOMAIN = (_get_env("DOMAIN") or "").strip() or None
PORT = (_get_env("PORT") or "").strip() or None

# Internal constants
CDN_BASE = "https://persistent.oaistatic.com/ecosystem-built-assets"
CDN_VERSION = "0038"

# Determine asset serving strategy based on ENVIRONMENT and DOMAIN
_environment = ENVIRONMENT.lower()
_is_env_local = _environment in {"local", "dev", "development"}

if DOMAIN:
    _dev_asset_origin = DOMAIN.rstrip("/")
elif _is_env_local:
    _dev_asset_origin = "http://localhost:4444"
else:
    _dev_asset_origin = None

# When using the Vite dev server (`pnpm run dev`), assets are served without the hash suffix
_dev_asset_hashed = not _is_env_local

asset_hash_override = (_get_env("ASSET_HASH") or "").strip().lower()
_asset_hash = asset_hash_override or (_discover_asset_hash() or DEFAULT_ASSET_HASH).lower()

# In dev with un-hashed assets, derive a version tag from the process start minute
_is_dev_unhashed = bool(_dev_asset_origin) and (not _dev_asset_hashed)
_auto_dev_version = None
if _is_dev_unhashed:
    # Auto-bump once per minute: dev-<base36(minutes since epoch)>
    _auto_dev_version = f"dev-{int(time.time() // 60):x}"

_template_version = (
    _auto_dev_version
    or _asset_hash
).lower()
_version_suffix = f"?v={_template_version}" if _template_version else ""

# Default pizza video (public-domain fallback that does not expire).
DEFAULT_PIZZA_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"

VIDEO_URL_SCRIPT = f"<script>window.__PIZZAZ_VIDEO_URL__ = {json.dumps(DEFAULT_PIZZA_VIDEO_URL)};</script>"


@dataclass(frozen=True)
class PizzazWidget:
    identifier: str
    title: str
    template_uri: str
    invoking: str
    invoked: str
    html: str
    response_text: str


def _inline_widget_markup(asset_name: str) -> str | None:
    css_path = ASSETS_DIR / f"{asset_name}-{_asset_hash}.css"
    js_path = ASSETS_DIR / f"{asset_name}-{_asset_hash}.js"

    try:
        css = css_path.read_text(encoding="utf-8")
        js = js_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:  # pragma: no cover
        logger.warning("Failed to load local assets for %s (%s)", asset_name, exc)
        return None

    extra = VIDEO_URL_SCRIPT if asset_name == "pizzaz-video" else ""

    return (
        f'<div id="{asset_name}-root"></div>\n'
        f"<style>\n{css}\n</style>\n"
        f"<script type=\"module\">\n{js}\n</script>\n"
        f"{extra}"
    )


def _cdn_widget_markup(asset_name: str) -> str:
    extra = VIDEO_URL_SCRIPT if asset_name == "pizzaz-video" else ""

    return (
        f'<div id="{asset_name}-root"></div>\n'
        f'<link rel="stylesheet" href="{CDN_BASE}/{asset_name}-{CDN_VERSION}.css">\n'
        f'<script type="module" src="{CDN_BASE}/{asset_name}-{CDN_VERSION}.js"></script>\n'
        f"{extra}"
    )


def _dev_hosted_widget_markup(asset_name: str) -> str | None:
    if not _dev_asset_origin:
        return None

    # Only serve from the dev origin if a corresponding entry exists under src/
    # This avoids emitting broken links for widgets that rely on CDN-only assets.
    src_dir = REPO_ROOT / "src" / asset_name
    if not src_dir.exists():
        return None

    hash_segment = f"-{_asset_hash}" if _dev_asset_hashed else ""
    css_href = f"{_dev_asset_origin}/{asset_name}{hash_segment}.css"
    js_src = f"{_dev_asset_origin}/{asset_name}{hash_segment}.js"

    extra = VIDEO_URL_SCRIPT if asset_name == "pizzaz-video" else ""

    return (
        f'<div id="{asset_name}-root"></div>\n'
        f'<link rel="stylesheet" href="{css_href}">\n'
        f'<script type="module" src="{js_src}"></script>\n'
        f"{extra}"
    )


def _build_widget_markup(asset_name: str) -> str:
    dev_markup = _dev_hosted_widget_markup(asset_name)
    if dev_markup is not None:
        logger.info("Serving %s from dev asset origin %s", asset_name, _dev_asset_origin)
        return dev_markup

    if not ENVIRONMENT:
        logger.info(
            "No ENVIRONMENT specified; falling back to CDN assets for %s",
            asset_name,
        )
        return _cdn_widget_markup(asset_name)

    inline = _inline_widget_markup(asset_name)
    if inline is not None:
        return inline

    logger.info(
        "Using CDN assets for %s (no matching local assets for hash %s in %s)",
        asset_name,
        _asset_hash,
        ASSETS_DIR,
    )
    return _cdn_widget_markup(asset_name)


_WIDGET_CONFIGS: List[Dict[str, str]] = [
    {
        "identifier": "pizza-map",
        "title": "Show Pizza Map",
        "template_uri_base": "ui://widget/pizza-map.html",
        "invoking": "Hand-tossing a map",
        "invoked": "Served a fresh map",
        "response_text": "Rendered a pizza map!",
        "asset_name": "pizzaz",
    },
    {
        "identifier": "pizza-carousel",
        "title": "Show Pizza Carousel",
        "template_uri_base": "ui://widget/pizza-carousel.html",
        "invoking": "Carousel some spots",
        "invoked": "Served a fresh carousel",
        "response_text": "Rendered a pizza carousel!",
        "asset_name": "pizzaz-carousel",
    },
    {
        "identifier": "pizza-albums",
        "title": "Show Pizza Album",
        "template_uri_base": "ui://widget/pizza-albums.html",
        "invoking": "Hand-tossing an album",
        "invoked": "Served a fresh album",
        "response_text": "Rendered a pizza album!",
        "asset_name": "pizzaz-albums",
    },
    {
        "identifier": "pizza-list",
        "title": "Show Pizza List",
        "template_uri_base": "ui://widget/pizza-list.html",
        "invoking": "Hand-tossing a list",
        "invoked": "Served a fresh list",
        "response_text": "Rendered a pizza list!",
        "asset_name": "pizzaz-list",
    },
    {
        "identifier": "pizza-video",
        "title": "Show Pizza Video",
        "template_uri_base": "ui://widget/pizza-video.html",
        "invoking": "Hand-tossing a video",
        "invoked": "Served a fresh video",
        "response_text": "Rendered a pizza video!",
        "asset_name": "pizzaz-video",
    },
]


widgets: List[PizzazWidget] = [
    PizzazWidget(
        identifier=config["identifier"],
        title=config["title"],
        template_uri=f"{config['template_uri_base']}{_version_suffix}",
        invoking=config["invoking"],
        invoked=config["invoked"],
        html=_build_widget_markup(config["asset_name"]),
        response_text=config["response_text"],
    )
    for config in _WIDGET_CONFIGS
]


MIME_TYPE = "text/html+skybridge"


WIDGETS_BY_ID: Dict[str, PizzazWidget] = {widget.identifier: widget for widget in widgets}
WIDGETS_BY_URI: Dict[str, PizzazWidget] = {widget.template_uri: widget for widget in widgets}


class PizzaInput(BaseModel):
    """Schema for pizza tools."""

    pizza_topping: str = Field(
        ...,
        alias="pizzaTopping",
        description="Topping to mention when rendering the widget.",
    )

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


mcp = FastMCP(
    name="pizzaz-python",
    stateless_http=True,
)


TOOL_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "pizzaTopping": {
            "type": "string",
            "description": "Topping to mention when rendering the widget.",
        }
    },
    "required": ["pizzaTopping"],
    "additionalProperties": False,
}


def _resource_description(widget: PizzazWidget) -> str:
    return f"{widget.title} widget markup"


def _tool_meta(widget: PizzazWidget) -> Dict[str, Any]:
    return {
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
        "annotations": {
          "destructiveHint": False,
          "openWorldHint": False,
          "readOnlyHint": True
        }
    }


def _embedded_widget_resource(widget: PizzazWidget) -> types.EmbeddedResource:
    # Some typed clients expect AnyUrl; cast string to the expected type at runtime
    text_contents = types.TextResourceContents(
        uri=widget.template_uri,  # type: ignore[arg-type]
        mimeType=MIME_TYPE,
        text=widget.html,
    )
    # EmbeddedResource in latest FastMCP generally takes (type, resource)
    return types.EmbeddedResource(
        type="resource",
        resource=text_contents,
    )


@mcp._mcp_server.list_tools()
async def _list_tools() -> List[types.Tool]:
    return [
        types.Tool(
            name=widget.identifier,
            title=widget.title,
            description=widget.title,
            inputSchema=deepcopy(TOOL_INPUT_SCHEMA),
            _meta=_tool_meta(widget),
        )
        for widget in widgets
    ]


@mcp._mcp_server.list_resources()
async def _list_resources() -> List[types.Resource]:
    return [
        types.Resource(
            name=widget.title,
            uri=widget.template_uri,  # type: ignore[arg-type]
            description=_resource_description(widget),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(widget),
        )
        for widget in widgets
    ]


@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    return [
        types.ResourceTemplate(
            name=widget.title,
            uriTemplate=widget.template_uri,  # type: ignore[arg-type]
            description=_resource_description(widget),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(widget),
        )
        for widget in widgets
    ]


async def _handle_read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    widget = WIDGETS_BY_URI.get(str(req.params.uri))
    if widget is None:
        return types.ServerResult(
            types.ReadResourceResult(
                contents=[],
                _meta={"error": f"Unknown resource: {req.params.uri}"},
            )
        )

    contents: List[types.TextResourceContents | types.BlobResourceContents] = [
        types.TextResourceContents(
            uri=widget.template_uri,  # type: ignore[arg-type]
            mimeType=MIME_TYPE,
            text=widget.html,
            _meta=_tool_meta(widget),
        )
    ]

    return types.ServerResult(
        types.ReadResourceResult(contents=contents)  # type: ignore[arg-type]
    )


async def _call_tool_request(req: types.CallToolRequest) -> types.ServerResult:
    widget = WIDGETS_BY_ID.get(req.params.name)
    if widget is None:
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"Unknown tool: {req.params.name}",
                    )
                ],
                isError=True,
            )
        )

    arguments = req.params.arguments or {}
    try:
        payload = PizzaInput.model_validate(arguments)
    except ValidationError as exc:
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"Input validation error: {exc.errors()}",
                    )
                ],
                isError=True,
            )
        )

    topping = payload.pizza_topping
    widget_resource = _embedded_widget_resource(widget)
    meta: Dict[str, Any] = {
        "openai.com/widget": widget_resource.model_dump(mode="json"),
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
    }

    return types.ServerResult(
        types.CallToolResult(
            content=[
                types.TextContent(
                    type="text",
                    text=widget.response_text,
                )
            ],
            structuredContent={"pizzaTopping": topping},
            _meta=meta,
        )
    )


mcp._mcp_server.request_handlers[types.CallToolRequest] = _call_tool_request
mcp._mcp_server.request_handlers[types.ReadResourceRequest] = _handle_read_resource


app = mcp.streamable_http_app()

try:
    from starlette.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )
except Exception:
    pass


if __name__ == "__main__":
    import uvicorn
    try:
        _port = int(PORT or "8000")
    except Exception:
        _port = 8000
    uvicorn.run(app, host="0.0.0.0", port=_port)
