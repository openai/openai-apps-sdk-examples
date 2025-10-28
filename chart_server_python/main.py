"""Chart search MCP server - minimal version based on pizzaz_server_python."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

import mcp.types as types
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, ValidationError


@dataclass(frozen=True)
class ChartWidget:
    identifier: str
    title: str
    template_uri: str
    invoking: str
    invoked: str
    html: str
    response_text: str


ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"


# @lru_cache(maxsize=None)
def _load_widget_html(component_name: str) -> str:
    html_path = ASSETS_DIR / f"{component_name}.html"
    if html_path.exists():
        return html_path.read_text(encoding="utf8")

    fallback_candidates = sorted(ASSETS_DIR.glob(f"{component_name}-*.html"))
    if fallback_candidates:
        return fallback_candidates[-1].read_text(encoding="utf8")

    raise FileNotFoundError(
        f'Widget HTML for "{component_name}" not found in {ASSETS_DIR}. '
        "Run `pnpm run build` to generate the assets before starting the server."
    )


widget = ChartWidget(
    identifier="show-chart",
    title="Show Chart",
    template_uri="ui://widget/chart-viewer.html",
    invoking="Rendering chart",
    invoked="Chart rendered",
    html=_load_widget_html("chart-widget"),
    response_text="Rendered a chart!",
)

MIME_TYPE = "text/html+skybridge"


class ChartInput(BaseModel):
    """Schema for chart tool."""

    query: str = Field(
        ...,
        description="Search query for finding a chart",
    )

    model_config = ConfigDict(extra="forbid")


mcp = FastMCP(
    name="chart-search",
    stateless_http=True,
)


TOOL_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "Search query for finding a chart",
        }
    },
    "required": ["query"],
    "additionalProperties": False,
}


def _resource_description(widget: ChartWidget) -> str:
    return f"{widget.title} widget markup"


def _tool_meta(widget: ChartWidget) -> Dict[str, Any]:
    return {
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
    }


def _embedded_widget_resource(widget: ChartWidget) -> types.EmbeddedResource:
    return types.EmbeddedResource(
        type="resource",
        resource=types.TextResourceContents(
            uri=widget.template_uri,
            mimeType=MIME_TYPE,
            text=widget.html,
            title=widget.title,
        ),
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
            annotations={
                "destructiveHint": False,
                "openWorldHint": False,
                "readOnlyHint": True,
            },
        )
    ]


@mcp._mcp_server.list_resources()
async def _list_resources() -> List[types.Resource]:
    return [
        types.Resource(
            name=widget.title,
            title=widget.title,
            uri=widget.template_uri,
            description=_resource_description(widget),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(widget),
        )
    ]


@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    return [
        types.ResourceTemplate(
            name=widget.title,
            title=widget.title,
            uriTemplate=widget.template_uri,
            description=_resource_description(widget),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(widget),
        )
    ]


async def _handle_read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    if str(req.params.uri) != widget.template_uri:
        return types.ServerResult(
            types.ReadResourceResult(
                contents=[],
                _meta={"error": f"Unknown resource: {req.params.uri}"},
            )
        )

    contents = [
        types.TextResourceContents(
            uri=widget.template_uri,
            mimeType=MIME_TYPE,
            text=widget.html,
            _meta=_tool_meta(widget),
        )
    ]

    return types.ServerResult(types.ReadResourceResult(contents=contents))


async def _call_tool_request(req: types.CallToolRequest) -> types.ServerResult:
    if req.params.name != widget.identifier:
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
        payload = ChartInput.model_validate(arguments)
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

    query = payload.query
    widget_resource = _embedded_widget_resource(widget)
    meta: Dict[str, Any] = {
        "openai.com/widget": widget_resource.model_dump(mode="json"),
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
    }

    # Create chart config based on query
    chart_config = {
        "id": 2994,
        "map": {
            "time": 2025,
            "colorScale": {
                "baseColorScheme": "OrRd",
                "binningStrategy": "manual",
                "customNumericColors": [None, None, None, None, None, None, None, None, None],
                "customNumericValues": [0, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
            },
            "columnSlug": "147859",
            "timeTolerance": 10
        },
        "tab": "map",
        "slug": "population-density",
        "title": query,  # Use query as title
        "yAxis": {"min": 0},
        "$schema": "https://files.ourworldindata.org/schemas/grapher-schema.009.json",
        "version": 50,
        "subtitle": f"Chart for: {query}",
        "hasMapTab": True,
        "originUrl": "/population-growth",
        "dimensions": [
            {
                "display": {
                    "includeInTable": True,
                    "numDecimalPlaces": 1
                },
                "property": "y",
                "variableId": 953906
            }
        ],
        "isPublished": True,
        "relatedQuestions": [
            {
                "url": "https://ourworldindata.org/population-sources",
                "text": "What sources do we rely on for historical and future population estimates?"
            }
        ],
        "selectedEntityNames": ["World"],
        "hideAnnotationFieldsInTitle": {
            "time": True,
            "entity": True,
            "changeInPrefix": True
        },
        "bakedGrapherURL": "https://ourworldindata.org/grapher",
        "adminBaseUrl": "https://ourworldindata.org",
        "dataApiUrl": "https://api.ourworldindata.org/v1/indicators/"
    }

    return types.ServerResult(
        types.CallToolResult(
            content=[
                types.TextContent(
                    type="text",
                    text=widget.response_text,
                )
            ],
            structuredContent={
                "query": query,
                "chartConfig": chart_config
            },
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


# Serve static assets
from starlette.responses import FileResponse
from starlette.routing import Route


async def serve_asset(request):
    filename = request.path_params["filename"]

    # Determine MIME type based on extension
    mime_types = {
        ".js": "application/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".map": "application/json",
    }
    ext = "." + filename.rsplit(".", 1)[1] if "." in filename else ""
    media_type = mime_types.get(ext)

    # Try exact match first
    file_path = ASSETS_DIR / filename
    if file_path.exists():
        return FileResponse(file_path, media_type=media_type)

    # Try with hash suffix pattern (e.g., chart-widget.js -> chart-widget-2d2b.js)
    base_name = filename.rsplit(".", 1)[0] if "." in filename else filename

    candidates = sorted(ASSETS_DIR.glob(f"{base_name}-*.{ext.lstrip('.')}"))
    if candidates:
        return FileResponse(candidates[-1], media_type=media_type)

    return FileResponse(str(file_path), status_code=404)


app.routes.append(Route("/{filename:path}", serve_asset))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
