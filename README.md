# Apps SDK Examples Gallery

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

This repository showcases example UI components to be used with the Apps SDK, as well as example MCP servers that expose a collection of components as tools.
It is meant to be used as a starting point and source of inspiration to build your own apps for ChatGPT.

## MCP + Apps SDK Overview

The Model Context Protocol (MCP) is an open specification for connecting large language model clients to external tools, data, and user interfaces. An MCP server exposes tools that a model can call during a conversation and returns results according to the tool contracts. Those results can include extra metadata—such as inline HTML—that the Apps SDK uses to render rich UI components (widgets) alongside assistant messages.

Within the Apps SDK, MCP keeps the server, model, and UI in sync. By standardizing the wire format, authentication, and metadata, it lets ChatGPT reason about your connector the same way it reasons about built-in tools. A minimal MCP integration for Apps SDK implements three capabilities:

1. **List tools** – Your server advertises the tools it supports, including their JSON Schema input/output contracts and optional annotations (for example, `readOnlyHint`).
2. **Call tools** – When a model selects a tool, it issues a `call_tool` request with arguments that match the user intent. Your server executes the action and returns structured content the model can parse.
3. **Return widgets** – Alongside structured content, return embedded resources in the response metadata so the Apps SDK can render the interface inline in the Apps SDK client (ChatGPT).

Because the protocol is transport agnostic, you can host the server over Server-Sent Events or streaming HTTP—Apps SDK supports both.

The MCP servers in this demo highlight how each tool can light up widgets by combining structured payloads with `_meta.openai/outputTemplate` metadata returned from the MCP servers.

## Repository Structure

- `src/` – Source for each widget example.
- `assets/` – Generated HTML, JS, and CSS bundles after running the build step.
- `pizzaz_server_node/` – MCP server implemented with the official TypeScript SDK.
- `pizzaz_server_python/` – Python MCP server that returns the Pizzaz widgets.
- `solar-system_server_python/` – Python MCP server for the 3D solar system widget.
- `build-all.mts` – Vite build orchestrator that produces hashed bundles for every widget entrypoint.

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm/yarn
- Python 3.10+ (for the Python MCP server)

## Install dependencies

Clone the repository and install the workspace dependencies:

```bash
pnpm install
```

> Using npm or yarn? Install the root dependencies with your preferred client and adjust the commands below accordingly.

## Build the components gallery

The components are bundled into standalone assets that the MCP servers serve as reusable UI resources.

```bash
pnpm run build
```

This command runs `build-all.mts`, producing versioned `.html`, `.js`, and `.css` files inside `assets/`. Each widget is wrapped with the CSS it needs so you can host the bundles directly or ship them with your own server. If the local assets are missing at runtime, the Pizzaz MCP server automatically falls back to the CDN bundles (version `0038`).

To iterate locally, you can also launch the Vite dev server:

```bash
pnpm run dev
```

The Vite config binds to `http://127.0.0.1:4444` by default. Need another host or port? Pass CLI overrides (for example, to expose on all interfaces at `4000`):

```bash
pnpm run dev --host 0.0.0.0 --port 4000
```

If you change the origin, update the MCP server `.env` (`DOMAIN=<new-origin>`) so widgets resolve correctly.

## Serve the static assets

If you want to preview the generated bundles without the MCP servers, start the static file server after running a build:

```bash
pnpm run serve
```

This static server also defaults to port `4444`. Override it when needed:

```bash
pnpm run serve -p 4000
```

Make sure the MCP server `DOMAIN` matches the port you choose.

The assets are exposed at [`http://localhost:4444`](http://localhost:4444) with CORS enabled so that local tooling (including MCP inspectors) can fetch them.

## Run the MCP servers

The repository ships several demo MCP servers that highlight different widget bundles:

- **Pizzaz (Node & Python)** – pizza-inspired collection of tools and components
- **Solar system (Python)** – 3D solar system viewer

Every tool response includes plain text content, structured JSON, and `_meta.openai/outputTemplate` metadata so the Apps SDK can hydrate the matching widget.

Each MCP server reads `ENVIRONMENT`, `DOMAIN`, and `PORT` from a `.env` file located in its own directory (`pizzaz_server_node/.env`, `pizzaz_server_python/.env`, `solar-system_server_python/.env`). Instead of exporting shell variables, create or update the `.env` file beside the server you're running. For example, inside `pizzaz_server_node/.env`:

```env
# Development: consume Vite dev assets on http://localhost:5173
ENVIRONMENT=local

# Production-style: point to the static asset server started with `pnpm run serve`
# ENVIRONMENT=production
# DOMAIN=http://localhost:4444

# Port override (defaults to 8000 when omitted)
# PORT=8123
```

- Use `ENVIRONMENT=local` while `pnpm run dev` is serving assets so widgets load without hash suffixes.
- Switch to `ENVIRONMENT=production` and set `DOMAIN` after running `pnpm run build` and `pnpm run serve` to reference the static bundles.
- Adjust `PORT` if you need the MCP endpoint on something other than `http://localhost:8000/mcp`.

### Pizzaz Node server

```bash
cd pizzaz_server_node
pnpm install
pnpm start
```

### Pizzaz Python server

```bash
cd pizzaz_server_python
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Prefer invoking uvicorn directly? From the repository root you can run `uvicorn pizzaz_server_python.main:app --port 8000` once dependencies are installed.

> Prefer pnpm scripts? After activating the virtual environment, return to the repository root (for example `cd ..`) and run `pnpm start:pizzaz-python`.

### Solar system Python server

```bash
cd solar-system_server_python
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Prefer invoking uvicorn directly? From the repository root you can run `uvicorn solar-system_server_python.main:app --port 8000` once dependencies are installed.

> Similarly, once the virtual environment is active, head back to the repository root and run `pnpm start:solar-python` to use the wrapper script.

You can reuse the same virtual environment for all Python servers—install the dependencies once and run whichever entry point you need.

## Testing in ChatGPT

To add these apps to ChatGPT, enable [developer mode](https://platform.openai.com/docs/guides/developer-mode), and add your apps in Settings > Connectors.

To add your local server without deploying it, you can use a tool like [ngrok](https://ngrok.com/) to expose your local server to the internet.

For example, once your MCP servers are running, you can run:

```bash
ngrok http 8000
```

Use the generated URL (for example `https://<custom_endpoint>.ngrok-free.app/mcp`) when configuring ChatGPT. All of the demo servers listen on `http://localhost:8000/mcp` by default; adjust the port in the command above if you override it.

### Hot-swap modes without reconnecting

You can swap between CDN, static builds, and the Vite dev server without reconfiguring ChatGPT:

1. Change the environment you care about (edit the relevant `.env`, run `pnpm run dev`, or rebuild assets and rerun the MCP server).
2. In ChatGPT, open **Settings → Apps & Connectors →** select your connected app → **Actions → Refresh app**.
3. Continue the conversation, no reconnects or page reloads are needed.

When switching modes, avoid disconnecting the connector, deleting it, launching a brand-new tunnel, or refreshing the ChatGPT conversation tab. After you hit **Refresh app**, ChatGPT keeps the existing MCP base URL and simply pulls the latest widget HTML/CSS/JS strategy from your server.

| Mode | What you change | Typical `.env` |
| --- | --- | --- |
| CDN (easiest) | Nothing beyond the MCP server | (leave `PORT`, `ENVIRONMENT` & `DOMAIN` unset) |
| Static serve (inline bundles) | `pnpm run build` (optionally `pnpm run serve` to inspect) | `ENVIRONMENT=production` / `PORT=8000` |
| Dev (Vite hot reload) | Run `pnpm run dev` and point your MCP server at it | `ENVIRONMENT=local` / `DOMAIN=http://127.0.0.1:4444` / `PORT=8000` |

#### Working inside virtual machines

For the smoothest loop, keep everything inside the same VM: run Vite or the static server, the MCP server, ngrok, and your ChatGPT browser session together so localhost resolves correctly. If your browser lives on the host machine while servers stay in the VM, either tunnel the frontend as well (for example, a second `ngrok http 4444` plus `DOMAIN=<that URL>`), or expose the VM via an HTTPS-accessible IP and point `DOMAIN` there.

Switch modes freely → **Actions → Refresh app** → keep building.

Once you add a connector, you can use it in ChatGPT conversations.

You can add your app to the conversation context by selecting it in the "More" options.

![more-chatgpt](https://github.com/user-attachments/assets/26852b36-7f9e-4f48-a515-aebd87173399)

You can then invoke tools by asking something related. For example, for the Pizzaz app, you can ask "What are the best pizzas in town?".


## Next steps

- Customize the widget data: edit the handlers in `pizzaz_server_node/src`, `pizzaz_server_python/main.py`, or the solar system server to fetch data from your systems.
- Create your own components and add them to the gallery: drop new entries into `src/` and they will be picked up automatically by the build script.

## Contributing

You are welcome to open issues or submit PRs to improve this app, however, please note that we may not review all suggestions.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
