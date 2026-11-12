# Solar system MCP server (Python)

This directory packages a Python implementation of the solar-system demo server
using the official Model Context Protocol FastMCP helper. It mirrors the widget
experience shipped in this repository and lets you drive the 3D solar system UI
from ChatGPT or the MCP Inspector.

## Prerequisites

- Python 3.10+
- A virtual environment (recommended)

## Installation

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> The requirements pin the official `mcp` distribution with its FastAPI extra. If
you previously installed the unrelated `modelcontextprotocol` package, uninstall
it first to avoid import conflicts.

## Run the server

```bash
python main.py
```

This boots a Streamable HTTP app with uvicorn at `http://127.0.0.1:8000/mcp`
(equivalently `uvicorn solar-system_server_python.main:app --port 8000`). Connect
with the MCP Inspector or follow OpenAI's
[connect and test guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

The tool declares an output schema and returns a small structured payload
describing the requested planet. Its `_meta.ui.resourceUri` points to the MCP
HTML resource served as `text/html;profile=mcp-app`.

## Next steps

- Expand the schema with additional celestial bodies or mission telemetry.
- Source live ephemeris data to position planets in real time.
- Gate access with authentication before exposing the widget in production.
