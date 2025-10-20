"""Chart search MCP server for ChatGPT App.

This server exposes a tool to search for charts based on keywords and returns
them as iframes. Uses mock data inspired by Our World in Data charts.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, List, Tuple

import mcp.types as types
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, ValidationError


@dataclass(frozen=True)
class Chart:
    """Represents a chart with metadata and embed URL."""
    id: str
    title: str
    description: str
    keywords: Tuple[str, ...]  # Use tuple instead of list for frozen dataclass
    iframe_url: str
    category: str


# Mock chart data
CHARTS: List[Chart] = [
    Chart(
        id="population-density",
        title="Population Density Map",
        description="World map showing population density across countries",
        keywords=("population", "density", "demographics", "people", "map"),
        iframe_url="https://ourworldindata.org/grapher/population-density?tab=map",
        category="demographics"
    ),
    Chart(
        id="co2-emissions",
        title="CO2 Emissions by Country",
        description="Annual CO2 emissions from fossil fuels and industry",
        keywords=("co2", "carbon", "emissions", "climate", "environment", "pollution"),
        iframe_url="https://ourworldindata.org/grapher/annual-co2-emissions-per-country",
        category="environment"
    ),
    Chart(
        id="gdp-per-capita",
        title="GDP per Capita",
        description="Gross domestic product per capita adjusted for inflation",
        keywords=("gdp", "economy", "income", "wealth", "economic", "growth"),
        iframe_url="https://ourworldindata.org/grapher/gdp-per-capita-worldbank",
        category="economy"
    ),
    Chart(
        id="life-expectancy",
        title="Life Expectancy",
        description="Life expectancy at birth by country over time",
        keywords=("life", "expectancy", "health", "longevity", "mortality"),
        iframe_url="https://ourworldindata.org/grapher/life-expectancy",
        category="health"
    ),
    Chart(
        id="renewable-energy",
        title="Renewable Energy Share",
        description="Share of primary energy from renewable sources",
        keywords=("renewable", "energy", "solar", "wind", "sustainable", "clean"),
        iframe_url="https://ourworldindata.org/grapher/renewable-share-energy",
        category="environment"
    ),
]

MIME_TYPE = "text/html+skybridge"


def search_charts(query: str, max_results: int = 5) -> List[Chart]:
    """Search charts by keywords."""
    query_lower = query.lower()
    query_terms = query_lower.split()

    scored_charts = []
    for chart in CHARTS:
        score = 0
        # Check title
        if any(term in chart.title.lower() for term in query_terms):
            score += 3
        # Check keywords
        for keyword in chart.keywords:
            if any(term in keyword for term in query_terms):
                score += 2
        # Check description
        if any(term in chart.description.lower() for term in query_terms):
            score += 1

        if score > 0:
            scored_charts.append((score, chart))

    # Sort by score descending
    scored_charts.sort(key=lambda x: x[0], reverse=True)
    return [chart for _, chart in scored_charts[:max_results]]


@lru_cache(maxsize=None)
def _generate_chart_widget_html(chart: Chart) -> str:
    """Generate HTML widget for displaying a chart iframe."""
    return f"""<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {{
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: white;
      padding: 16px;
    }}
    .chart-container {{
      max-width: 100%;
      margin: 0 auto;
    }}
    .chart-header {{
      margin-bottom: 12px;
    }}
    .chart-title {{
      font-size: 18px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 4px;
    }}
    .chart-description {{
      font-size: 14px;
      color: #666;
    }}
    .chart-iframe {{
      width: 100%;
      height: 600px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
    }}
  </style>
</head>
<body>
  <div class="chart-container">
    <div class="chart-header">
      <div class="chart-title" id="chart-title"></div>
      <div class="chart-description" id="chart-description"></div>
    </div>
    <iframe
      id="chart-iframe"
      loading="lazy"
      allow="web-share; clipboard-write"
      class="chart-iframe">
    </iframe>
  </div>
  <script>
    // Listen for structured content from MCP
    window.addEventListener('message', (event) => {{
      if (event.data.type === 'structuredContent') {{
        const data = event.data.content;
        if (data.title) {{
          document.getElementById('chart-title').textContent = data.title;
        }}
        if (data.description) {{
          document.getElementById('chart-description').textContent = data.description;
        }}
        if (data.iframeUrl) {{
          document.getElementById('chart-iframe').src = data.iframeUrl;
        }}
      }}
    }});

    // Alternative: Direct hydration from structured content
    if (window.structuredContent) {{
      const data = window.structuredContent;
      document.getElementById('chart-title').textContent = data.title || '';
      document.getElementById('chart-description').textContent = data.description || '';
      document.getElementById('chart-iframe').src = data.iframeUrl || '';
    }}
  </script>
</body>
</html>"""


class SearchChartsInput(BaseModel):
    """Schema for chart search tool."""

    query: str = Field(
        ...,
        description="Search query with keywords to find relevant charts (e.g., 'population density', 'CO2 emissions')",
    )

    model_config = ConfigDict(extra="forbid")


mcp = FastMCP(
    name="chart-search",
    stateless_http=True,
)


WIDGET_TEMPLATE_URI = "ui://widget/chart-viewer.html"
WIDGET_TITLE = "Chart Viewer"


TOOL_INPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "Search query with keywords to find relevant charts (e.g., 'population density', 'CO2 emissions')",
        }
    },
    "required": ["query"],
    "additionalProperties": False,
}


def _tool_meta() -> Dict[str, Any]:
    return {
        "openai/outputTemplate": WIDGET_TEMPLATE_URI,
        "openai/toolInvocation/invoking": "Searching for charts",
        "openai/toolInvocation/invoked": "Found charts",
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True
    }


def _embedded_widget_resource(chart: Chart) -> types.EmbeddedResource:
    return types.EmbeddedResource(
        type="resource",
        resource=types.TextResourceContents(
            uri=WIDGET_TEMPLATE_URI,
            mimeType=MIME_TYPE,
            text=_generate_chart_widget_html(chart),
            title=WIDGET_TITLE,
        ),
    )


@mcp._mcp_server.list_tools()
async def _list_tools() -> List[types.Tool]:
    return [
        types.Tool(
            name="search-charts",
            title="Search Charts",
            description="Search for data visualization charts based on keywords and return them as interactive iframes",
            inputSchema=TOOL_INPUT_SCHEMA,
            _meta=_tool_meta(),
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
            name=WIDGET_TITLE,
            title=WIDGET_TITLE,
            uri=WIDGET_TEMPLATE_URI,
            description="Chart viewer widget for displaying data visualizations",
            mimeType=MIME_TYPE,
            _meta=_tool_meta(),
        )
    ]


@mcp._mcp_server.list_resource_templates()
async def _list_resource_templates() -> List[types.ResourceTemplate]:
    return [
        types.ResourceTemplate(
            name=WIDGET_TITLE,
            title=WIDGET_TITLE,
            uriTemplate=WIDGET_TEMPLATE_URI,
            description="Chart viewer widget template",
            mimeType=MIME_TYPE,
            _meta=_tool_meta(),
        )
    ]


async def _handle_read_resource(req: types.ReadResourceRequest) -> types.ServerResult:
    if str(req.params.uri) != WIDGET_TEMPLATE_URI:
        return types.ServerResult(
            types.ReadResourceResult(
                contents=[],
                _meta={"error": f"Unknown resource: {req.params.uri}"},
            )
        )

    # Return a default chart widget HTML
    default_chart = CHARTS[0]
    contents = [
        types.TextResourceContents(
            uri=WIDGET_TEMPLATE_URI,
            mimeType=MIME_TYPE,
            text=_generate_chart_widget_html(default_chart),
            _meta=_tool_meta(),
        )
    ]

    return types.ServerResult(types.ReadResourceResult(contents=contents))


async def _call_tool_request(req: types.CallToolRequest) -> types.ServerResult:
    if req.params.name != "search-charts":
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
        payload = SearchChartsInput.model_validate(arguments)
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

    # Search for charts
    results = search_charts(payload.query)

    if not results:
        return types.ServerResult(
            types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=f"No charts found for query: {payload.query}",
                    )
                ],
                isError=False,
            )
        )

    # Return the first matching chart as a widget
    chart = results[0]
    widget_resource = _embedded_widget_resource(chart)

    # Build response text with all results
    response_text = f"Found {len(results)} chart(s):\n\n"
    response_text += f"Displaying: {chart.title}\n{chart.description}\n\n"

    if len(results) > 1:
        response_text += "Other matches:\n"
        for other_chart in results[1:]:
            response_text += f"- {other_chart.title}\n"

    meta: Dict[str, Any] = {
        "openai.com/widget": widget_resource.model_dump(mode="json"),
        "openai/outputTemplate": WIDGET_TEMPLATE_URI,
        "openai/toolInvocation/invoking": "Searching for charts",
        "openai/toolInvocation/invoked": "Found charts",
        "openai/widgetAccessible": True,
        "openai/resultCanProduceWidget": True,
    }

    return types.ServerResult(
        types.CallToolResult(
            content=[
                types.TextContent(
                    type="text",
                    text=response_text,
                )
            ],
            structuredContent={
                "title": chart.title,
                "description": chart.description,
                "iframeUrl": chart.iframe_url,
                "category": chart.category,
                "chartId": chart.id,
            },
            _meta=meta
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

    uvicorn.run("main:app", host="0.0.0.0", port=8001)
