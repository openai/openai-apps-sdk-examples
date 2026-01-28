# Apps SDK Examples Gallery

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Example Apps SDK widgets + MCP servers you can run in ChatGPT developer mode.

- Apps SDK docs: https://developers.openai.com/apps-sdk
- Apps SDK UI library: https://github.com/openai/apps-sdk-ui

## Prerequisites

- Node.js 18+
- pnpm (recommended for repo scripts)
- Python 3.10+ (only for the Python MCP servers)
- A tunnel (ngrok or cloudflared) to expose a public HTTPS URL that ChatGPT can reach

### Install pnpm (if you don’t have it)

This repo uses pnpm workspaces and `pnpm --filter` scripts. If running `pnpm -v` works, you can skip this section.

If `pnpm` is not installed, `pnpm install` will fail (for example: `pnpm: command not found`). Install pnpm using either option:

**Option A (recommended): Corepack (ships with Node.js 18+)**

Corepack will use the pnpm version pinned in `package.json` (`packageManager`), which helps keep installs consistent across machines.

```bash
corepack enable
pnpm -v
```

**Option B: Install pnpm globally with npm**

```bash
npm install -g pnpm
pnpm -v
```

## Quickstart: Hello World (no build step)

The fastest starting point is the Hello World Node example in `examples/hello-world-mcp-node/`. It serves a single inline HTML widget over MCP.

Install once:

```bash
pnpm install
```

Start the server:

```bash
pnpm hello-world
```

It listens on `http://localhost:8000/mcp` by default (set `PORT` to change it). You’ll expose this port via a tunnel for ChatGPT.

ChatGPT connectors must be able to reach your MCP server over a public HTTPS URL. For local development, use a tunnel.

In a second terminal:

```bash
ngrok http 8000
```

Then in ChatGPT (developer mode), add a connector pointing to:

- `https://<subdomain>.ngrok-free.app/mcp`

Try:

- “Use `hello-world-show` with name ‘Sam’.”
- Then edit the name in the widget and click **Update greeting**.

## Examples (what’s included)

If you only run one thing, run **Hello World**. The other demos are “bundled widget” examples that require `pnpm build`.

| Example | UI | MCP server | Notes |
| --- | --- | --- | --- |
| Hello World | inline HTML | `examples/hello-world-mcp-node/` | No build step; simplest end-to-end demo. |
| Pizzaz (Node) | `examples/pizzaz/ui/` → `examples/pizzaz/assets/` | `examples/pizzaz/server_node/` | Multi-view UI (map/list/carousel/shop). |
| Pizzaz (Python) | `examples/pizzaz/ui/` → `examples/pizzaz/assets/` | `examples/pizzaz/server_python/` | Python equivalent of Pizzaz tools. |
| Kitchen sink lite (Node) | `examples/kitchen-sink-lite/ui/` → `examples/kitchen-sink-lite/assets/` | `examples/kitchen-sink-lite/server_node/` | Broad `window.openai` API surface demo. |
| Kitchen sink lite (Python) | `examples/kitchen-sink-lite/ui/` → `examples/kitchen-sink-lite/assets/` | `examples/kitchen-sink-lite/server_python/` | Python equivalent of kitchen-sink-lite. |
| Solar system (Python) | `examples/solar-system/ui/` → `examples/solar-system/assets/` | `examples/solar-system/server_python/` | 3D solar system widget. |
| Shopping cart (Python) | `examples/shopping-cart/ui/` → `examples/shopping-cart/assets/` | `examples/shopping-cart/server_python/` | Demonstrates `widgetSessionId` + state sync. |
| Authenticated (Python) | `examples/authenticated/ui/` → `examples/authenticated/assets/` | `examples/authenticated/server_python/` | Demonstrates authenticated tool calls. |

## Running the bundled widget demos (Pizzaz, Solar System, Kitchen Sink, …)

Most demos in this repo use React bundles built into `examples/*/assets/`. For those demos you typically run:

1. Build the bundles
2. Run an MCP server (Node or Python)

### 1) Build assets

In one terminal:

```bash
pnpm install
pnpm build
```

Each MCP server serves its own widget bundles at `http://localhost:8000/assets/...` by default.

> **Note:** The Python Pizzaz server caches widget HTML. After `pnpm build`, restart the MCP server if you don’t see updates.

### 2) Run an MCP server (second terminal)

Node servers:

```bash
pnpm --filter pizzaz-mcp-node start
pnpm --filter kitchen-sink-mcp-node start
```

Python servers (each has a `python main.py` entrypoint):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r examples/pizzaz/server_python/requirements.txt
cd examples/pizzaz/server_python && python main.py
```

Other Python servers:

- `examples/kitchen-sink-lite/server_python`
- `examples/shopping-cart/server_python`
- `examples/authenticated/server_python`
- `examples/solar-system/server_python`

> You can reuse the same `.venv` for all Python servers—install the requirements once for each server you plan to run.

> **Ports:** Most servers default to port 8000. If you want to run more than one at a time, set `PORT` (Node and Python) or run uvicorn directly with `--port`.

### 3) Add the connector in ChatGPT

Enable developer mode, then add your MCP server URL in Settings → Connectors.

If you’re developing locally, expose port 8000 with a tunnel (ngrok example):

```bash
ngrok http 8000
```

Use the tunnel URL + `/mcp`.

> [!IMPORTANT]
> The Python MCP SDK enforces DNS rebinding protection. When tunneling (for example via ngrok), allow your tunnel host before starting any Python server:
>
> ```bash
> export MCP_ALLOWED_HOSTS="<subdomain>.ngrok-free.app"
> export MCP_ALLOWED_ORIGINS="https://<subdomain>.ngrok-free.app"
> ```
>
> For Python servers, also set `PUBLIC_BASE_URL` so widget bundles load over HTTPS:
>
> ```bash
> export PUBLIC_BASE_URL="https://<subdomain>.ngrok-free.app"
> ```

## Troubleshooting

### Chrome localhost restrictions

If you try to use `http://localhost:...` from ChatGPT in Chrome and the widget UI doesn’t appear, Chrome 142+ may block private network access by default.

Options:

- Use a tunnel (recommended), or
- Disable the `local-network-access-check` flag in `chrome://flags` and restart Chrome.

## Developing widgets (optional)

- `pnpm dev` runs the Vite dev server.
- `pnpm build` regenerates the static bundles in `examples/*/assets/` used by the demo MCP servers.

## Repository structure

- `examples/` – runnable end-to-end demos (MCP servers; some include UI too).
- `examples/*/ui/` – widget sources (React).
- `examples/_shared/ui/` – shared widget helpers + base styles.
- `examples/*/assets/` – built widget bundles (generated by `pnpm build`).
- `build-all.mts` – Vite build orchestrator that produces hashed bundles for every widget entrypoint.

## Contributing

You are welcome to open issues or submit PRs to improve this repo, but note that we may not review all suggestions.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
