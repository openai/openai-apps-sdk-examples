# MCP App Basics server (Node)

Educational MCP server with eleven interactive examples covering the core MCP Apps SDK APIs. Each tool renders a widget that demonstrates one API and includes an expandable code walkthrough.

## Prerequisites

- Node 18+
- Dependencies installed (`pnpm install` from repo root)

## Install & run

```bash
pnpm install
pnpm start
# or change port: PORT=9000 pnpm start
```

`pnpm start` builds the eleven basics widgets first, then starts the MCP server.
The basics build script adds a fresh `ASSET_HASH_SALT` each run so ChatGPT and
browser caches see new JS/CSS asset URLs. To only rebuild those widgets, run:

```bash
pnpm run build:widgets
```

Server listens on `http://localhost:8000/mcp` and serves built widget assets from
`http://localhost:8000/assets`. It binds to `127.0.0.1` by default; set
`HOST=0.0.0.0` only if you need LAN access. When testing through ngrok, expose
this server once; resource HTML infers the public origin from the incoming
request headers so the same tunnel serves both `/mcp` and `/assets`. Set
`PUBLIC_BASE_URL` or `API_BASE_URL` only if you need to override that inferred
origin.

For ChatGPT, widget resources declare both `_meta.ui.csp` and
`openai/widgetCSP`, allowlisting the same public origin used for `/mcp` and
`/assets`. If ngrok or another proxy does not forward the expected public host,
set `PUBLIC_BASE_URL=https://your-public-origin` when starting the server.

## Examples

### Data Flow

| Tool | API | Try saying in ChatGPT |
|------|-----|-----------------------|
| `show_tool_result` | `ontoolresult` + `structuredContent` | "Show me how a tool result gets displayed in a widget" |
| `send_message` | `window.openai.sendFollowUpMessage()` | "How do I send a message from a widget?" |
| `update_model_context` | `app.updateModelContext()` | "How can a widget silently give context to the model?" |

### Widget ↔ Server

| Tool | API | Try saying in ChatGPT |
|------|-----|-----------------------|
| `call_server_tool` | `window.openai.callTool()` | "Show me how a widget calls a server tool directly" |

### Host Interaction

| Tool | API | Try saying in ChatGPT |
|------|-----|-----------------------|
| `open_link` | `window.openai.openExternal()` | "How do I open a link from a widget?" |
| `request_display_mode` | `window.openai.requestDisplayMode()` + host globals | "How do I make a widget go fullscreen?" |
| `host_theming` | `useHostStyles()` + `useDocumentTheme()` | "How do I match the host's theme in my widget?" |
| `get_host_capabilities` | `app.getHostCapabilities()` | "How do I check what the host supports?" |
| `get_host_context` | `app.getHostContext()` + `onhostcontextchanged` | "How do I get the host's theme and locale?" |
| `get_host_version` | `app.getHostVersion()` | "How do I identify which host is running?" |

### Tool Lifecycle

| Tool | API | Try saying in ChatGPT |
|------|-----|-----------------------|
| `streaming_tool_input` | `ontoolinputpartial` → `ontoolinput` → `ontoolresult` | "Show me how streaming tool input works" |
