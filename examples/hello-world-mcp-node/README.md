# Hello World (Node MCP + inline widget)

This example is the fastest way to see an Apps SDK widget working end-to-end in ChatGPT developer mode.

What you get:

- A minimal **MCP server** (SSE transport)
- A single **inline HTML widget** (no Vite build, no `pnpm run serve`)
- Two tools:
  - `hello-world-show` renders the widget with a greeting
  - `hello-world-greet` can be called from the widget via `window.openai.callTool`

## Prerequisites

- Node.js 18+
- pnpm

## Run

From the repo root:

```bash
pnpm --filter hello-world-mcp-node start
```

The server starts on `http://localhost:8000` by default.

## Add to ChatGPT (developer mode)

1. Enable developer mode.
2. Expose the server via a tunnel (ngrok example):

   ```bash
   ngrok http 8000
   ```

3. Add a connector pointing to `https://<your-subdomain>.ngrok-free.app/mcp`.

> `http://localhost:8000/mcp` is useful for local testing (for example with the MCP Inspector), but ChatGPT generally needs a public HTTPS URL.

## Try it

In ChatGPT, ask:

- “Use `hello-world-show` with name ‘Sam’.”

Then inside the widget:

- Type a new name and click **Update greeting** (calls `hello-world-greet`)

> The “Hello World” label above the widget is the connector name in ChatGPT settings; the greeting inside the widget is what changes.
