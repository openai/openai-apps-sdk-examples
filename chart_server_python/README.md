# Chart Search MCP Server

An MCP server for ChatGPT App that searches for data visualization charts based on keywords and returns them as interactive iframes.

## Features

- Search charts by keywords (e.g., "population density", "CO2 emissions")
- Returns charts as embedded iframes
- Mock data with various chart categories (demographics, environment, economy, health)
- Built with FastMCP 2.x decorator-based API for easy integration with ChatGPT Apps

## Installation

```bash
pip install -r requirements.txt
```

## Usage

Start the server:

```bash
python main.py
```

The server will run on `http://localhost:8001` with HTTP/SSE transport.

## Example Queries

- "population density" → Returns a world map showing population density
- "CO2 emissions" → Returns CO2 emissions by country chart
- "GDP" → Returns GDP per capita chart
- "life expectancy" → Returns life expectancy trends
- "renewable energy" → Returns renewable energy share chart

## Mock Data

The server includes 5 example charts from Our World in Data:

1. **Population Density Map** - World demographics
2. **CO2 Emissions** - Climate and environment data
3. **GDP per Capita** - Economic indicators
4. **Life Expectancy** - Health statistics
5. **Renewable Energy Share** - Sustainable energy trends

## Integration with ChatGPT App

Configure your ChatGPT App to connect to this MCP server:

```json
{
  "mcpServers": {
    "chart-search": {
      "url": "http://localhost:8001"
    }
  }
}
```

Then use the `search_charts_tool` with natural language queries.

## Testing

Test the server with curl:

```bash
# List available tools
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'

# Search for charts
curl -X POST http://localhost:8001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "search_charts_tool", "arguments": {"query": "CO2 emissions"}}}'
```
