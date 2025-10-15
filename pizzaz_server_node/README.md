# Pizzaz MCP Server (Node)

This directory contains a minimal Model Context Protocol (MCP) server implemented with the official TypeScript SDK. The service exposes the five Pizzaz demo widgets and shares configuration with the rest of the workspace: it reads environment flags from a local `.env` file and automatically falls back to the published CDN bundles when local assets are unavailable.

## Prerequisites

- Node.js 18+
- pnpm, npm, or yarn for dependency management

## Install dependencies

```bash
pnpm install
```

Adjust the command if you prefer npm or yarn.

## Run the server

```bash
pnpm start
```

This launches an HTTP MCP server on `http://localhost:8000/mcp` with two endpoints:

- `GET /mcp` provides the SSE stream.
- `POST /mcp/messages?sessionId=...` accepts follow-up messages for active sessions.

Configuration lives in `.env` within this directory (loaded automatically via `dotenv`). Update it before starting the server to control asset origins and ports. A typical file looks like:

```env
# Use the Vite dev server started with `pnpm run dev`
ENVIRONMENT=local

# After `pnpm run build && pnpm run serve`, point to the static bundles
# ENVIRONMENT=production
# DOMAIN=http://localhost:4444

# Change the default port (defaults to 8000)
# PORT=8123
```

Key behaviors:

- When `ENVIRONMENT=local`, widgets load from the Vite dev server (`pnpm run dev` from the repo root) without hashed filenames.
- When `ENVIRONMENT=production` and `DOMAIN` is set, widgets are served from your local static server (typically `pnpm run serve`).
- When `ENVIRONMENT` is omitted entirely—or neither local option provides assets—the server falls back to the CDN bundles (version `0038`).

The script boots the server with an SSE transport, which makes it compatible with the MCP Inspector as well as ChatGPT connectors. Once running you can list the tools and invoke any of the pizza experiences.
- Each tool emits:
	- `content`: confirmation text matching the requested action.
	- `structuredContent`: JSON reflecting the requested topping.
	- `_meta.openai/outputTemplate`: metadata binding the response to the Skybridge widget.

### Hot-swap reminder

After changing `.env`, rebuilding assets, or toggling between dev/static/CDN, open your ChatGPT connector (**Settings → Apps & Connectors → [your app] → Actions → Refresh app**). That keeps the same MCP URL, avoids new ngrok tunnels, and prompts ChatGPT to fetch the latest widget templates. See the root [README](../README.md#hot-swap-modes-without-reconnecting) for the mode cheat sheet and VM tips.

## Next Steps

Extend these handlers with real data sources, authentication, or localization, and customize the widget configuration under `src/` to align with your application.

See main [README.md](../README.md) for:
- Testing in ChatGPT
- Architecture overview
- Advanced configuration
