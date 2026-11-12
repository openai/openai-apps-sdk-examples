# Kitchen Sink Lite MCP server (Node)

TypeScript implementation of the minimal kitchen-sink widget server using the official Model Context Protocol SDK.

It exposes two tools:

- `kitchen-sink-show`: returns the widget template plus structured content for the initial render.
- `kitchen-sink-refresh`: lightweight echo tool so the widget can call back via `window.openai.callTool`.

Both tools use `_meta.ui.resourceUri` to associate the MCP App UI resource at `ui://widget/kitchen-sink-lite.html`, and declare their structured output schemas.

## Prereqs

- Node 18+
- Static assets built (run `pnpm run build` from the repo root). The server loads `assets/kitchen-sink-lite*.html`.

## Install & run

```bash
pnpm install
pnpm --filter kitchen-sink-mcp-node start
# or, from this folder:
pnpm start
```

The server uses Streamable HTTP at `http://localhost:8000/mcp`. You can change the port with `PORT=9000 pnpm start`.
