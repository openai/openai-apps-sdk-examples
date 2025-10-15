# Pizzaz MCP Server (Python)

This directory packages a Python implementation of the Pizzaz demo server using the `FastMCP` helper from the official Model Context Protocol SDK. It mirrors the Node example and exposes each pizza widget as both a resource and a tool while sharing configuration through a local `.env` file and falling back to the published CDN bundles when needed.

## Prerequisites

- Python 3.10+
- A virtual environment (recommended)

## Installation

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# Unix/Mac
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

## Run the Server

```bash
python main.py
```

This boots a FastAPI app with uvicorn on `http://127.0.0.1:8000` (equivalently `uvicorn pizzaz_server_python.main:app --port 8000`). The endpoints mirror the Node demo:

- `GET /mcp` exposes the SSE stream.
- `POST /mcp/messages?sessionId=...` accepts follow-up messages for an active session.

Cross-origin requests are allowed so you can drive the server from local tooling or the MCP Inspector. The process loads configuration from `.env` in this directory. Update it to control asset origin and port selection, for example:

```env
# Use the Vite dev server started in the repo root with `pnpm run dev`
ENVIRONMENT=local

# After `pnpm run build && pnpm run serve`, point to the static bundles
# ENVIRONMENT=production
# DOMAIN=http://localhost:4444

# Change the default port (defaults to 8000)
# PORT=8123
```

- When `ENVIRONMENT=local`, widgets hydrate from the running Vite dev server without hashed filenames.
- When `ENVIRONMENT=production` alongside a `DOMAIN`, widgets load from your local static server.
- When `ENVIRONMENT` is omitted entirely, the server now defaults to the CDN assets (version `0038`) just like the Node implementation.
- Each tool response includes confirmation text, structured JSON echoing the requested topping, and `_meta.openai/outputTemplate` metadata for the Skybridge widget.

Prefer a cross-platform launcher? After activating the environment you can run:

```bash
pnpm start:pizzaz-python
```

## Hot-swap reminder

Whenever you switch the server mode (dev/static/CDN), tweak `.env`, or rebuild assets, refresh your ChatGPT connector instead of deleting it: **Settings → Apps & Connectors → [your app] → Actions → Refresh app**. ChatGPT keeps the same MCP endpoint and reloads widget templates in place. The main [README](../README.md#hot-swap-modes-without-reconnecting) has a concise cheat sheet plus VM guidance.

## Next steps

Use these handlers as a starting point when wiring in real data, authentication, or localization support. The structure demonstrates how to:

1. Register reusable UI resources that load static HTML bundles.
2. Associate tools with those widgets via `_meta.openai/outputTemplate`.
3. Ship structured JSON alongside human-readable confirmation text.

See main [README.md](../README.md) for:
- Testing in ChatGPT
- Architecture overview
- Advanced configuration
