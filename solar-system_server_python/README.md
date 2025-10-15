# Solar system MCP server (Python)

This directory packages a Python implementation of the solar-system demo server using the official Model Context Protocol FastMCP helper. It mirrors the widget experience shipped in this repository and lets you drive the 3D solar system UI from ChatGPT or the MCP Inspector. It shares configuration through a local `.env` file while falling back to the published CDN bundles whenever local assets are unavailable.

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

> The requirements pin the official `mcp` distribution with its FastAPI extra. If you previously installed the unrelated `modelcontextprotocol` package, uninstall it first to avoid import conflicts.

## Run the server

```bash
python main.py
```

This boots a FastAPI app with uvicorn on `http://127.0.0.1:8000` (equivalently `uvicorn solar-system_server_python.main:app --port 8000`). The server exposes streaming endpoints compatible with the MCP Inspector and ChatGPT connectors:

- `GET /mcp` provides the SSE stream.
- `POST /mcp/messages?sessionId=...` receives follow-up messages for a session.

Configuration lives in `.env` in this directory. Update it before launching to control asset origin and port selection:

```env
# Use the Vite dev server started with `pnpm run dev`
ENVIRONMENT=local

# After `pnpm run build && pnpm run serve`, point to the static bundles
# ENVIRONMENT=production
# DOMAIN=http://localhost:4444

# Change the default port (defaults to 8000)
# PORT=8123
```

- When `ENVIRONMENT=local`, the widget hydrates from the Vite dev server without hashed filenames.
- When `ENVIRONMENT=production` with a `DOMAIN`, assets are served from your local static server.
- When `ENVIRONMENT` is omitted entirely—or local assets are missing—the server defaults to the CDN bundles (version `0038`).
- Each tool call returns a JSON payload describing the requested planet plus metadata that embeds the solar-system widget so the Apps SDK can render the 3D experience inline.

Prefer not to type the Python entry point directly? After activating the environment you can run:

```bash
pnpm start:solar-python
```

## Hot-swap reminder

When you change `.env`, rebuild assets, or toggle between dev/static/CDN, don't delete the connector—just reopen it in ChatGPT (**Settings → Apps & Connectors → [your app] → Actions → Refresh app**). ChatGPT keeps the existing MCP base URL and fetches the newest widget templates right away. The repo [README](../README.md#hot-swap-modes-without-reconnecting) includes the full mode cheat sheet and VM considerations.

## Next steps

- Expand the schema with additional celestial bodies or mission telemetry.
- Source live ephemeris data to position planets in real time.
- Gate access with authentication before exposing the widget in production.

See main [README.md](../README.md) for:
- Testing in ChatGPT
- Architecture overview
- Advanced configuration
