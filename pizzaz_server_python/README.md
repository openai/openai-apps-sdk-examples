# Pizzaz MCP server (Python)

This directory packages a Python implementation of the Pizzaz demo server using the `FastMCP` helper from the official Model Context Protocol SDK. It mirrors the Node example and exposes each pizza widget as both a resource and a tool.

## Prerequisites

- Python 3.10+
- A virtual environment (recommended)

## Installation

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> **Heads up:** There is a similarly named package named `modelcontextprotocol`
> on PyPI that is unrelated to the official MCP SDK. The requirements file
> installs the official `mcp` distribution with its FastAPI extra so that the
> `mcp.server.fastmcp` module is available. If you previously installed the
> other project, run `pip uninstall modelcontextprotocol` before reinstalling
> the requirements.

## Run the server

```bash
python main.py
```

This boots the Streamable HTTP app with uvicorn at `http://127.0.0.1:8000/mcp` (equivalently `uvicorn pizzaz_server_python.main:app --port 8000`). Connect with the MCP Inspector or follow OpenAI's [connect and test guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

Cross-origin requests are allowed so you can drive the server from local tooling or the MCP Inspector. Each tool declares an output schema and returns structured content that echoes the requested topping. The tool descriptor's `_meta.ui.resourceUri` points to the matching MCP HTML resource (`text/html;profile=mcp-app`).

The Pizzaz shop is a UI-only mockup. Its client-side widget state is suitable
for illustrating presentation behavior, not for authoritative cart data or
real checkout; use the server-backed shopping-cart example for that pattern.

## Next steps

Use these handlers as a starting point when wiring in real data, authentication, or localization support. The structure demonstrates how to:

1. Register reusable UI resources that load static HTML bundles.
2. Associate tools with those widgets via `_meta.ui.resourceUri`.
3. Ship structured JSON alongside human-readable confirmation text.
