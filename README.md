# Apps SDK Examples Gallery

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

This repository showcases example UI components to be used with the Apps SDK, as well as example MCP servers that expose a collection of components as tools.
It is meant to be used as a starting point and source of inspiration to build your own apps for ChatGPT.

Note: If you are on Chrome and have recently updated to version 142, you will need to disable the [`local-network-access` flag](https://developer.chrome.com/release-notes/142#local_network_access_restrictions) to see the widget UI.

How to disable it:

1. Go to chrome://flags/
2. Find #local-network-access-check
3. Set it to Disabled

⚠️ **Note 🚨 Make sure to restart Chrome after changing this flag for the update to take effect.**

## MCP + Apps SDK overview

The Model Context Protocol (MCP) is an open specification for connecting large language model clients to external tools, data, and user interfaces. An MCP server exposes tools that a model can call during a conversation and returns results according to the tool contracts. Those results can include extra metadata—such as inline HTML—that the Apps SDK uses to render rich UI components (widgets) alongside assistant messages.

Within the Apps SDK, MCP keeps the server, model, and UI in sync. By standardizing the wire format, authentication, and metadata, it lets ChatGPT reason about your connector the same way it reasons about built-in tools. A minimal MCP integration for Apps SDK implements three capabilities:

1. **List tools** – Your server advertises the tools it supports, including their JSON Schema input/output contracts and optional annotations (for example, `readOnlyHint`).
2. **Call tools** – When a model selects a tool, it issues a `call_tool` request with arguments that match the user intent. Your server executes the action and returns structured content the model can parse.
3. **Return widgets** – Alongside structured content, return embedded resources in the response metadata so the Apps SDK can render the interface inline in the Apps SDK client (ChatGPT).

Because the protocol is transport agnostic, you can host the server over Server-Sent Events or streaming HTTP—Apps SDK supports both.

The MCP servers in this demo highlight how each tool can light up widgets by combining structured payloads with `_meta.openai/outputTemplate` metadata returned from the MCP servers.

## Repository structure

- `src/` – Source for each widget example.
- `assets/` – Generated HTML, JS, and CSS bundles after running the build step.
- `pizzaz_server_node/` – MCP server implemented with the official TypeScript SDK.
- `pizzaz_server_python/` – Python MCP server that returns the Pizzaz widgets.
- `solar-system_server_python/` – Python MCP server for the 3D solar system widget.
- `data_explorer_server_python/` – Python MCP server that powers the Data Explorer widget (CSV uploads, filters, charts).
- `build-all.mts` – Vite build orchestrator that produces hashed bundles for every widget entrypoint.

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm/yarn
- Python 3.10+ (for the Python MCP server)
- pre-commit for formatting

## Install dependencies

Clone the repository and install the workspace dependencies:

```bash
pnpm install
pre-commit install
```

> Using npm or yarn? Install the root dependencies with your preferred client and adjust the commands below accordingly.

## Build the components gallery

The components are bundled into standalone assets that the MCP servers serve as reusable UI resources.

```bash
pnpm run build
```

This command runs `build-all.mts`, producing versioned `.html`, `.js`, and `.css` files inside `assets/`. Each widget is wrapped with the CSS it needs so you can host the bundles directly or ship them with your own server.

To iterate on your components locally, you can also launch the Vite dev server:

```bash
pnpm run dev
```

## Serve the static assets

All of the MCP servers (except the Data Explorer server) expect the bundled HTML, JS, and CSS to be served from the local static file server. After every build, start the server before launching any MCP processes:

```bash
pnpm run serve
```

The assets are exposed at [`http://localhost:4444`](http://localhost:4444) with CORS enabled so that local tooling (including MCP inspectors) can fetch them.

> **Note:** The Python Pizzaz server caches widget HTML with `functools.lru_cache`. If you rebuild or manually edit files in `assets/`, restart the MCP server so it picks up the updated markup.

> **Note:** The Data Explorer server reads the built widget assets directly from the `assets/` directory, so you still need to run `pnpm run build` whenever you change the frontend, but you don't have to start `pnpm run serve` while that server is running.

## Run the MCP servers

The repository ships several demo MCP servers that highlight different widget bundles:

- **Pizzaz (Node & Python)** – pizza-inspired collection of tools and components
- **Solar system (Python)** – 3D solar system viewer
- **Data Explorer (Python)** – interactive CSV upload, profiling, preview, and charting

### Pizzaz Node server

```bash
cd pizzaz_server_node
pnpm start
```

### Pizzaz Python server

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r pizzaz_server_python/requirements.txt
uvicorn pizzaz_server_python.main:app --port 8000
```

### Solar system Python server

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r solar-system_server_python/requirements.txt
uvicorn solar-system_server_python.main:app --port 8000
```

You can reuse the same virtual environment for all Python servers—install the dependencies once and run whichever entry point you need.

### Data Explorer Python server

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r data_explorer_server_python/requirements.txt
pnpm run build
uvicorn data_explorer_server_python.main:app --port 8001 --reload
```

This server accepts CSV uploads, profiles dataset metadata, exposes filtered preview tables, and generates chart-ready aggregates. Built assets are served directly by the MCP server, so rerun `pnpm run build` whenever you update the widget bundle.

#### Data Explorer security configuration

- `DATA_EXPLORER_ALLOWED_UPLOAD_ROOTS` (required for `filePath`/`fileUri` uploads) – os-path-separated list of directories (e.g., `/tmp:/Users/me/datasets`). Path-based uploads are disabled unless this allowlist is set.
- `DATA_EXPLORER_AUTH_TOKEN` – when set, every HTTP request (including MCP transport) must send `Authorization: Bearer <token>`.
- `DATA_EXPLORER_CORS_ALLOW_ORIGINS` – comma-delimited list of origins (e.g., `https://platform.openai.com,https://studio.openai.com`) that should receive CORS headers. CORS is disabled when this variable is unset.

If you expose the server over the public internet, configure all three variables to avoid leaking local files or running an unauthenticated, cross-origin-accessible endpoint.

For local development you can continue testing path uploads by pointing the allowlist at directories you control, for example:

```bash
export DATA_EXPLORER_ALLOWED_UPLOAD_ROOTS="$(pwd)/sample-data:/tmp"
uvicorn data_explorer_server_python.main:app --port 8001 --reload
```

Inline (`csvText`) and chunked uploads do not require any of the security environment variables, so you can omit them when doing quick experiments.

## Testing in ChatGPT

To add these apps to ChatGPT, enable [developer mode](https://platform.openai.com/docs/guides/developer-mode), and add your apps in Settings > Connectors.

To add your local server without deploying it, you can use a tool like [ngrok](https://ngrok.com/) to expose your local server to the internet.

For example, once your mcp servers are running, you can run:

```bash
ngrok http 8000
```

You will get a public URL that you can use to add your local server to ChatGPT in Settings > Connectors.

For example: `https://<custom_endpoint>.ngrok-free.app/mcp`

Once you add a connector, you can use it in ChatGPT conversations.

You can add your app to the conversation context by selecting it in the "More" options.

![more-chatgpt](https://github.com/user-attachments/assets/26852b36-7f9e-4f48-a515-aebd87173399)

You can then invoke tools by asking something related. For example, for the Pizzaz app, you can ask "What are the best pizzas in town?".

## Next steps

- Customize the widget data: edit the handlers in `pizzaz_server_node/src`, `pizzaz_server_python/main.py`, `solar-system_server_python`, or `data_explorer_server_python` to fetch data from your systems.
- Create your own components and add them to the gallery: drop new entries into `src/` and they will be picked up automatically by the build script.

### Deploy your MCP server

You can use the cloud environment of your choice to deploy your MCP server.

Include this in the environment variables:

```
BASE_URL=https://your-server.com
```

This will be used to generate the HTML for the widgets so that they can serve static assets from this hosted url.

## Contributing

You are welcome to open issues or submit PRs to improve this app, however, please note that we may not review all suggestions.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
