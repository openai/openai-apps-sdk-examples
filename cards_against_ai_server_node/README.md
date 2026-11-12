# Cards Against AI — MCP Server (Node)

MCP Apps backend that drives a card game through ChatGPT's model while keeping a real-time widget in sync. Single server serves both MCP API and widget assets.

## Quick Start

```bash
pnpm install              # from repo root
cd cards_against_ai_server_node
pnpm start                # builds widget + starts server on :8000
```

The server serves widget assets and MCP endpoint from the same port (8000).

### With ngrok

```bash
echo 'BASE_URL=https://your-domain.ngrok.app' > .env.local  # in repo root
ngrok http 8000 --domain your-domain.ngrok.app
cd cards_against_ai_server_node && pnpm start
```

Single tunnel, single server.

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm start` | Build widget + start server |
| `pnpm run dev` | Build widget + start server |
| `pnpm run build` | Build widget only |
| `pnpm run build:check` | Build widget + typecheck app + server |
| `pnpm run start:server` | Start server without rebuilding assets |

## Key MCP Apps Concepts

- **Tool response structure** — the tool descriptor's `_meta.ui.resourceUri` binds the widget; both `content` and `structuredContent` are visible to the model, while the widget can read structured data through `ontoolresult`.
- **Widget state** — game state stays on the server and is returned in `structuredContent`; the host-provided `openai/widgetSessionId` is not set by the server.
- **Resource registration** — Widget HTML is served as an MCP resource so ChatGPT can render it. CSP metadata controls which domains the sandboxed iframe can access.
- **Rules resources** — `rules://` URIs provide context documents the model reads before acting. They inform behavior, not UI.
- **Tool annotations** — `toolAnnotations` hint to ChatGPT whether to show confirmation dialogs (readOnlyHint, destructiveHint, openWorldHint).
- **Stateless transport** — `createCardsAgainstAiServer` creates a fresh McpServer per request. Game state lives in a Map, not in the MCP session.
- **SSE for real-time updates** — Custom SSE endpoint pushes game state to the widget on every mutation, separate from the MCP protocol.
- **Zod input schemas** — `registerAppTool` accepts Zod shapes, not JSON Schema. The SDK converts them automatically.
