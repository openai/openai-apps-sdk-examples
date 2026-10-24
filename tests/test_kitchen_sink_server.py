"""Unit tests for kitchen_sink_server_python."""

import asyncio
from starlette.applications import Starlette

from kitchen_sink_server_python.main import (
    TEMPLATE_URI,
    app,
    kitchen_sink_refresh,
    kitchen_sink_show,
    mcp,
)


def test_app_initialization():
    """Verify app is instantiated as a Starlette app via streamable_http_app."""
    assert isinstance(app, Starlette)


def test_kitchen_sink_show_tool():
    """Verify kitchen_sink_show returns expected structured content and metadata."""
    async def _test():
        result = await kitchen_sink_show(message="Test Hello", accent_color="#123456", details="Test Details")
        assert not result.isError
        assert len(result.content) == 1
        assert "Test Hello" in result.content[0].text
        assert result.structuredContent["message"] == "Test Hello"
        assert result.structuredContent["accentColor"] == "#123456"
        assert result.structuredContent["details"] == "Test Details"
        assert result.structuredContent["fromTool"] == "kitchen-sink-show"
        assert result.meta["openai/outputTemplate"] == TEMPLATE_URI
        assert result.meta["invocation"] == "kitchen-sink-show"
    asyncio.run(_test())


def test_kitchen_sink_refresh_tool():
    """Verify kitchen_sink_refresh echoes the payload correctly."""
    async def _test():
        result = await kitchen_sink_refresh(message="Echo Check")
        assert not result.isError
        assert len(result.content) == 1
        assert result.content[0].text == "Echo Check"
        assert result.structuredContent["message"] == "Echo Check"
        assert result.structuredContent["fromTool"] == "kitchen-sink-refresh"
        assert result.meta["invocation"] == "kitchen-sink-refresh"
    asyncio.run(_test())


def test_mcp_registered_tools_and_resources():
    """Verify FastMCP tool and resource registration."""
    async def _test():
        tools = await mcp.list_tools()
        tool_names = [t.name for t in tools]
        assert "kitchen_sink_show" in tool_names
        assert "kitchen_sink_refresh" in tool_names

        resources = await mcp.list_resources()
        resource_uris = [str(r.uri) for r in resources]
        assert TEMPLATE_URI in resource_uris
    asyncio.run(_test())
