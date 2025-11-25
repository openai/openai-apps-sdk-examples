"""
Jacket Store demo MCP server implemented with the Python FastMCP helper.

This server is modeled after the Pizzaz demo, but instead exposes
widget-backed tools for an e-commerce experience focused on jackets.

Each handler returns an HTML shell via an MCP resource and echoes the selected
jacket, size, and color as structured content so the ChatGPT client can
hydrate the UI widgets (catalog, detail view, cart, etc.). The module also
wires the handlers into an HTTP/SSE stack so you can run the server with
uvicorn on port 8000.
"""

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
class JacketWidget:
    identifier: str
    title: str
    template_uri: str
    invoking: str
    invoked: str
    html: str
    response_text: str


ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"


@lru_cache(maxsize=None)
def _load_widget_html(component_name: str) -> str:
    """
    Load the compiled HTML for a given widget component from the assets dir.

    Expected filenames:
      - jacket-store.html
      - jacket-catalog.html
      - jacket-detail.html
      - jacket-cart.html
      - jacket-recommendations.html
    or fallback to jacket-*.html variants.
    """
    html_path = ASSETS_DIR / f"{component_name}.html"
    if html_path.exists():
        return html_path.read_text(encoding="utf8")

    fallback_candidates = sorted(ASSETS_DIR.glob(f"{component_name}-*.html"))
    if fallback_candidates:
        return fallback_candidates[-1].read_text(encoding="utf8")

    raise FileNotFoundError(
        f'Widget HTML for "{component_name}" not found in {ASSETS_DIR}. '
        "Run your UI build step to generate the assets before starting the server."
    )


widgets: List[JacketWidget] = [
    JacketWidget(
        identifier="jacket-catalog",
        title="Browse Jackets Catalog",
        template_uri="ui://widget/jacket-catalog.html",
        invoking="Loading jacket catalog",
        invoked="Jacket catalog loaded",
        html=_load_widget_html("jacket-catalog"),
        response_text="Rendered the jacket catalog!",
    ),
    JacketWidget(
        identifier="jacket-detail",
        title="Show Jacket Detail",
        template_uri="ui://widget/jacket-detail.html",
        invoking="Fetching jacket details",
        invoked="Jacket detail displayed",
        html=_load_widget_html("jacket-detail"),
        response_text="Rendered a jacket detail view!",
    ),
    JacketWidget(
        identifier="jacket-cart",
        title="Open Shopping Cart",
        template_uri="ui://widget/jacket-cart.html",
        invoking="Opening jacket cart",
        invoked="Jacket cart opened",
        html=_load_widget_html("jacket-cart"),
        response_text="Rendered the jacket shopping cart!",
    ),
    JacketWidget(
        identifier="jacket-recommendations",
        title="Show Recommended Jackets",
        template_uri="ui://widget/jacket-recommendations.html",
        invoking="Finding recommended jackets",
        invoked="Recommended jackets displayed",
        html=_load_widget_html("jacket-recommendations"),
        response_text="Rendered recommended jackets!",
    ),
    JacketWidget(
        identifier="jacket-store",
        title="Open Jacket Store",
        template_uri="ui://widget/jacket-store.html",
        invoking="Opening jacket store",
        invoked="Jacket store opened",
        html=_load_widget_html("jacket-store"),
        response_text="Rendered the full jacket store experience!",
    ),
]


MIME_TYPE = "text/html+skybridge"

WIDGETS_BY_ID: Dict[str, JacketWidget] = {
    widget.identifier: widget for widget in widgets
}
WIDGETS_BY_URI: Dict[str, JacketWidget] = {
    widget.template_uri: widget for widget in widgets
}


class JacketSelection(BaseModel):
    """Schema for jacket store tools."""

    jacket_id: str = Field(
        ...,
        alias="jacketId",
        description="The ID or SKU of the selected jacket.",
    )
    size: str = Field(
        ...,
        description="Size of the jacket (e.g. XS, S, M, L, XL).",
    )
    color: str = Field(
        ...,
        description="Color of the jacket (e.g. black, navy, red).",
    )

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


mcp = FastMCP(
    name="jacket-store-python",
    stateless_http=True,
)


TOOL_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "jacketId": {
            "type": "string",
            "description": "The ID or SKU of the selected jacket.",
        },
        "size": {
            "type": "string",
            "description": "Size of the jacket (e.g. XS, S, M, L, XL).",
        },
        "color": {
            "type": "string",
            "description": "Color of the jacket (e.g. black, navy, red).",
        },
    },
    "required": ["jacketId", "size", "color"],
    "additionalProperties": False,
}


def _resource_description(widget: JacketWidget) -> str:
    return f"{widget.title} widget markup"


def _tool_meta(widget: JacketWidget) -> Dict[str, Any]:
    return {
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
    }


def _tool_invocation_meta(widget: JacketWidget) -> Dict[str, Any]:
    return {
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
    }


@mcp._mcp_server.list_tools()
async def _list_tools() -> List[types.Tool]:
    """
    Expose each jacket widget as a tool. All jacket tools share the same
    input schema (jacketId, size, color) so the assistant can pass the
    current selection into any view (catalog, detail, cart, etc.).
    """
    return [
        types.Tool(
            name=widget.identifier,
            title=widget.title,
            description=widget.title,
            inputSchema=deepcopy(TOOL_INPUT_SCHEMA),
            _meta=_tool_meta(widget),
            # Disable approval prompt; these are read-only, UI-only tools
            annotations={
                "destructiveHint": False,
                "openWorldHint": False,
                "readOnlyHint": True,
            },
        )
        for widget in widgets
    ]


@mcp._mcp_server.list_resources()
async def _list_resources() -> List[types.Resource]:
    """
    List the HTML resources so the client can pre-fetch and cache them.
    """
    return [
        types.Resource(
            name=widget.title,
            title=widget.title,
            uri=widget.template_uri,
            description=_resource_description(widget),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(widget),
        )
        for widget in widgets
    ]


@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    """
    List resource templates matching the HTML shells that back each widget.
    """
    return [
        types.ResourceTemplate(
            name=widget.title,
            title=widget.title,
            uriTemplate=widget.template_uri,
            description=_resource_description(widget),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(widget),
        )
        for widget in widgets
    ]


async def _handle_read_resource(
    req: types.ReadResourceRequest,
) -> types.ServerResult:
    """
    Read the HTML for a given widget resource URI.
    """
    widget = WIDGETS_BY_URI.get(str(req.params.uri))
    if widget is None:
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
    """
    Handle an invocation of a jacket tool (catalog/detail/cart/etc.).

    - Validates the incoming arguments against JacketSelection
    - Returns a small text response plus structured content describing
      the current jacket selection, which the UI bundle can use to drive
      the widget state.
    """
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
        payload = JacketSelection.model_validate(arguments)
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

    meta = _tool_invocation_meta(widget)

    return types.ServerResult(
        types.CallToolResult(
            content=[
                types.TextContent(
                    type="text",
                    text=widget.response_text,
                )
            ],
            structuredContent={
                "jacketId": payload.jacket_id,
                "size": payload.size,
                "color": payload.color,
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
    # CORS is optional; if Starlette isn't installed with CORS support,
    # the app will still function.
    pass


if __name__ == "__main__":
    import uvicorn

    # Change "main:app" if this file name/module changes.
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
