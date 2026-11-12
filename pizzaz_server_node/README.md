# Pizzaz MCP server (Node)

This directory contains a minimal Model Context Protocol (MCP) server implemented with the official TypeScript SDK. The server exposes the Pizzaz demo widgets using the MCP Apps UI convention.

## Prerequisites

- Node.js 18+
- pnpm, npm, or yarn for dependency management

## Install dependencies

```bash
pnpm install
```

If you prefer npm or yarn, adjust the command accordingly.

## Run the server

```bash
pnpm start
```

The server uses Streamable HTTP at `http://localhost:8000/mcp`. Once running, connect with the MCP Inspector or follow OpenAI's [connect and test guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

Each tool responds with:

- `content`: a short text confirmation that mirrors the original Pizzaz examples.
- `structuredContent`: a small JSON payload that echoes the topping argument, demonstrating how to ship data alongside widgets.
- `_meta.ui.resourceUri`: tool metadata that associates the tool with an MCP HTML resource served as `text/html;profile=mcp-app`.

The Pizzaz shop is a UI-only mockup. Its client-side widget state is suitable
for illustrating presentation behavior, not for authoritative cart data or
real checkout; use the server-backed shopping-cart example for that pattern.

Feel free to extend the handlers with real data sources, authentication, and persistence.
