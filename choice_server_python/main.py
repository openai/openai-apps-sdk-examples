"""
Choice demo MCP server implemented in the same structure as the Pizzaz demo.

This server exposes a widget-backed tool that displays a multiple-choice question
and buttons for the user to select an answer. The widget posts the selected
choice back to ChatGPT using the same openai MCP widget mechanics.
"""

from __future__ import annotations
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Dict, List
import json, html as _html

import mcp.types as types
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, ValidationError


# -----------------------------------------------------------------------------
# Widget definition
# -----------------------------------------------------------------------------

@dataclass(frozen=True)
class ChoiceWidget:
    identifier: str
    title: str
    template_uri: str
    invoking: str
    invoked: str
    html: str
    response_text: str


# -----------------------------------------------------------------------------
# Widget list (Pizzaz style)
# -----------------------------------------------------------------------------

widgets: List[ChoiceWidget] = [
    ChoiceWidget(
        identifier="choose-question",
        title="Ask a Question",
        template_uri="ui://widget/choose-question.html",
        invoking="Asking a multiple-choice question",
        invoked="Displayed question options",
        html=(
            "<div id=\"choice-root\"></div>\n"
            "<link rel=\"stylesheet\" href=\"http://localhost:4444/choice-2d2b.css\">\n"
            "<script type=\"module\" src=\"http://localhost:4444/choice-2d2b.js\"></script>"
        ),
        response_text="Please choose an option",
    ),
]


# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------

MIME_TYPE = "text/html+skybridge"

WIDGETS_BY_ID: Dict[str, ChoiceWidget] = {w.identifier: w for w in widgets}
WIDGETS_BY_URI: Dict[str, ChoiceWidget] = {w.template_uri: w for w in widgets}


# -----------------------------------------------------------------------------
# Input schema
# -----------------------------------------------------------------------------

class ChoiceInput(BaseModel):
    """Schema for the choice question tool."""
    question: str = Field(..., description="Question text to present above the choices.")
    choices: List[str] = Field(..., min_items=1, description="List of choices for the user to select.")
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


TOOL_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "question": {
            "type": "string",
            "description": "Question text to present above the choices.",
        },
        "choices": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string"},
            "description": "List of choices for the user to select.",
        },
    },
    "required": ["question", "choices"],
    "additionalProperties": False,
}


# -----------------------------------------------------------------------------
# FastMCP setup
# -----------------------------------------------------------------------------

mcp = FastMCP(
    name="choice-python",
    sse_path="/mcp",
    message_path="/mcp/messages",
    stateless_http=True,
)


# -----------------------------------------------------------------------------
# Helper functions
# -----------------------------------------------------------------------------

def _resource_description(widget: ChoiceWidget) -> str:
    return f"{widget.title} widget markup"


def _tool_meta(widget: ChoiceWidget) -> Dict[str, Any]:
    return {
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
        "annotations": {
            "destructiveHint": False,
            "openWorldHint": False,
            "readOnlyHint": True,
        },
    }


def _embedded_widget_resource(widget: ChoiceWidget) -> types.EmbeddedResource:
    return types.EmbeddedResource(
        type="resource",
        resource=types.TextResourceContents(
            uri=widget.template_uri,
            mimeType=MIME_TYPE,
            text=widget.html,
            title=widget.title,
        ),
    )


# -----------------------------------------------------------------------------
# MCP handlers
# -----------------------------------------------------------------------------

@mcp._mcp_server.list_tools()
async def _list_tools() -> List[types.Tool]:
    return [
        types.Tool(
            name=w.identifier,
            title=w.title,
            description="Present a multiple-choice question to the user",
            inputSchema=deepcopy(TOOL_INPUT_SCHEMA),
            _meta=_tool_meta(w),
        )
        for w in widgets
    ]


@mcp._mcp_server.list_resources()
async def _list_resources() -> List[types.Resource]:
    return [
        types.Resource(
            name=w.title,
            title=w.title,
            uri=w.template_uri,
            description=_resource_description(w),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(w),
        )
        for w in widgets
    ]


@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    return [
        types.ResourceTemplate(
            name=w.title,
            title=w.title,
            uriTemplate=w.template_uri,
            description=_resource_description(w),
            mimeType=MIME_TYPE,
            _meta=_tool_meta(w),
        )
        for w in widgets
    ]


async def _handle_read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    widget = WIDGETS_BY_URI.get(str(req.params.uri))
    if widget is None:
        return types.ServerResult(
            types.ReadResourceResult(contents=[], _meta={"error": f"Unknown resource: {req.params.uri}"})
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
    widget = WIDGETS_BY_ID.get(req.params.name)
    if widget is None:
        return types.ServerResult(
            types.CallToolResult(
                content=[types.TextContent(type="text", text=f"Unknown tool: {req.params.name}")],
                isError=True,
            )
        )

    args = req.params.arguments or {}
    try:
        payload = ChoiceInput.model_validate(args)
    except ValidationError as exc:
        return types.ServerResult(
            types.CallToolResult(
                content=[types.TextContent(type="text", text=f"Input validation error: {exc.errors()}")],
                isError=True,
            )
        )

    # structuredContent data
    structured = {"question": payload.question, "choices": payload.choices}

    # 把 structured 内容内联到 HTML data-structured 属性中 (静态首帧)
    structured_json = json.dumps(structured)
    data_attr = _html.escape(structured_json, quote=True)
    widget_html = (
        f'<div id="choice-root" data-structured="{data_attr}"></div>\n'
        '<link rel="stylesheet" href="http://localhost:4444/choice-2d2b.css">\n'
        '<script type="module" src="http://localhost:4444/choice-2d2b.js"></script>'
    )

    # 返回时替换 html 内容
    widget_with_data = ChoiceWidget(
        identifier=widget.identifier,
        title=widget.title,
        template_uri=widget.template_uri,
        invoking=widget.invoking,
        invoked=widget.invoked,
        html=widget_html,
        response_text=widget.response_text,
    )

    widget_resource = _embedded_widget_resource(widget_with_data)

    meta = {
        "openai.com/widget": widget_resource.model_dump(mode="json"),
        "openai/outputTemplate": widget.template_uri,
        "openai/toolInvocation/invoking": widget.invoking,
        "openai/toolInvocation/invoked": widget.invoked,
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
    }

    return types.ServerResult(
        types.CallToolResult(
            content=[types.TextContent(type="text", text=widget.response_text)],
            structuredContent=structured,
            _meta=meta,
            isError=False,
        )
    )


# Register handlers
mcp._mcp_server.request_handlers[types.CallToolRequest] = _call_tool_request
mcp._mcp_server.request_handlers[types.ReadResourceRequest] = _handle_read_resource


# -----------------------------------------------------------------------------
# ASGI app
# -----------------------------------------------------------------------------

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
    uvicorn.run(app, host="0.0.0.0", port=8000)
