import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, readdirSync, Dirent } from "node:fs";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import 'dotenv/config';
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };

const CDN_BASE = "https://persistent.oaistatic.com/ecosystem-built-assets";
const CDN_VERSION = "0038";

function getEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined ? undefined : value;
}

// Environment variables - only these three are supported
const ENVIRONMENT = (getEnv("ENVIRONMENT") ?? "").trim();
const DOMAIN = (getEnv("DOMAIN") ?? "").trim() || undefined;
const PORT = (getEnv("PORT") ?? "").trim() || undefined;

// Determine asset serving strategy based on ENVIRONMENT and DOMAIN
const environment = ENVIRONMENT.toLowerCase();
const isLocalEnv = environment === "local" || environment === "dev" || environment === "development";
const rawDevAssetOrigin = DOMAIN ?? (isLocalEnv ? "http://localhost:4444" : undefined);
const devAssetOrigin = rawDevAssetOrigin?.replace(/\/$/, "");

// When using the Vite dev server (`pnpm run dev`), assets are served without the hash suffix
const devAssetUseHash = !isLocalEnv;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../../");
const assetsDir = resolve(repoRoot, "assets");

function discoverAssetHash(dir: string): string | undefined {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      console.warn(`Failed to scan assets directory for hash: ${err.message}`);
    }
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^[a-z0-9-]+-([0-9a-f]{4})\.(?:js|css|html)$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

const computedAssetHash = crypto
  .createHash("sha256")
  .update((pkg as { version: string }).version, "utf8")
  .digest("hex")
  .slice(0, 4);

const assetHash = (
  process.env.ASSET_HASH?.trim().toLowerCase() ||
  discoverAssetHash(assetsDir) ||
  computedAssetHash
).toLowerCase();

// In dev with un-hashed assets, derive a version tag from the process start minute
const isDevUnhashed = Boolean(devAssetOrigin) && !devAssetUseHash;
const autoDevVersion = isDevUnhashed
  ? `dev-${Math.floor(Date.now() / 60_000).toString(36)}`
  : undefined;
const templateVersion = (autoDevVersion ?? assetHash).toLowerCase();

// Default pizza video (public-domain fallback that does not expire).
const DEFAULT_PIZZA_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const videoScriptSnippet = `<script>window.__PIZZAZ_VIDEO_URL__ = ${JSON.stringify(DEFAULT_PIZZA_VIDEO_URL)};<\/script>`;

type PizzazWidget = {
  id: string;
  title: string;
  templateUri: string;
  invoking: string;
  invoked: string;
  html: string;
  responseText: string;
};

type WidgetConfig = Omit<PizzazWidget, "html" | "templateUri"> & {
  assetName: string;
  templateUriBase: string;
};

function devHostedWidgetHtml(assetName: string): string | undefined {
  if (!devAssetOrigin) {
    return undefined;
  }

  // Only serve from the dev origin if a corresponding entry exists under src/
  // This avoids emitting broken links for widgets that rely on CDN-only assets.
  const srcDir = resolve(repoRoot, "src", assetName);
  if (!existsSync(srcDir)) {
    return undefined;
  }

  const hashSegment = devAssetUseHash ? `-${assetHash}` : "";
  const cssHref = `${devAssetOrigin}/${assetName}${hashSegment}.css`;
  const jsSrc = `${devAssetOrigin}/${assetName}${hashSegment}.js`;
  const extraScript = assetName === "pizzaz-video" ? videoScriptSnippet : "";

  return `
<div id="${assetName}-root"></div>
<link rel="stylesheet" href="${cssHref}">
<script type="module" src="${jsSrc}"></script>
${extraScript}
  `.trim();
}

function inlineWidgetHtml(assetName: string): string | undefined {
  const cssPath = resolve(assetsDir, `${assetName}-${assetHash}.css`);
  const jsPath = resolve(assetsDir, `${assetName}-${assetHash}.js`);

  // If either file is missing, silently skip inlining and allow CDN/dev fallback.
  if (!existsSync(cssPath) || !existsSync(jsPath)) {
    return undefined;
  }

  try {
    const css = readFileSync(cssPath, "utf8");
    const js = readFileSync(jsPath, "utf8");

    const extraScript = assetName === "pizzaz-video" ? videoScriptSnippet : "";

    return `
<div id="${assetName}-root"></div>
<style>
${css}
</style>
<script type="module">
${js}
</script>
${extraScript}
    `.trim();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // Only warn on unexpected read errors; ENOENT is already handled above.
    if (err.code !== "ENOENT") {
      console.warn(
        `Failed to inline local assets for ${assetName}: ${err.message}. Falling back to CDN.`,
      );
    }
    return undefined;
  }
}

function cdnWidgetHtml(assetName: string): string {
  const extraScript = assetName === "pizzaz-video" ? videoScriptSnippet : "";

  return `
<div id="${assetName}-root"></div>
<link rel="stylesheet" href="${CDN_BASE}/${assetName}-${CDN_VERSION}.css">
<script type="module" src="${CDN_BASE}/${assetName}-${CDN_VERSION}.js"></script>
${extraScript}
  `.trim();
}

function buildWidgetHtml(assetName: string): string {
  const devHtml = devHostedWidgetHtml(assetName);
  if (devHtml) {
    return devHtml;
  }

  if (!ENVIRONMENT) {
    console.info(`No ENVIRONMENT set; falling back to CDN assets for ${assetName}`);
    return cdnWidgetHtml(assetName);
  }

  return inlineWidgetHtml(assetName) ?? cdnWidgetHtml(assetName);
}

const widgetConfigs: WidgetConfig[] = [
  {
    id: "pizza-map",
    title: "Show Pizza Map",
    templateUriBase: "ui://widget/pizza-map.html",
    invoking: "Hand-tossing a map",
    invoked: "Served a fresh map",
    responseText: "Rendered a pizza map!",
    assetName: "pizzaz"
  },
  {
    id: "pizza-carousel",
    title: "Show Pizza Carousel",
    templateUriBase: "ui://widget/pizza-carousel.html",
    invoking: "Carousel some spots",
    invoked: "Served a fresh carousel",
    responseText: "Rendered a pizza carousel!",
    assetName: "pizzaz-carousel"
  },
  {
    id: "pizza-albums",
    title: "Show Pizza Album",
    templateUriBase: "ui://widget/pizza-albums.html",
    invoking: "Hand-tossing an album",
    invoked: "Served a fresh album",
    responseText: "Rendered a pizza album!",
    assetName: "pizzaz-albums"
  },
  {
    id: "pizza-list",
    title: "Show Pizza List",
    templateUriBase: "ui://widget/pizza-list.html",
    invoking: "Hand-tossing a list",
    invoked: "Served a fresh list",
    responseText: "Rendered a pizza list!",
    assetName: "pizzaz-list"
  },
  {
    id: "pizza-video",
    title: "Show Pizza Video",
    templateUriBase: "ui://widget/pizza-video.html",
    invoking: "Hand-tossing a video",
    invoked: "Served a fresh video",
    responseText: "Rendered a pizza video!",
    assetName: "pizzaz-video"
  }
];

const versionSuffix = templateVersion ? `?v=${templateVersion}` : "";

const widgets: PizzazWidget[] = widgetConfigs.map(({ assetName, templateUriBase, ...rest }) => ({
  ...rest,
  templateUri: `${templateUriBase}${versionSuffix}`,
  html: buildWidgetHtml(assetName)
}));

const widgetsById = new Map<string, PizzazWidget>();
const widgetsByUri = new Map<string, PizzazWidget>();

widgets.forEach((widget) => {
  widgetsById.set(widget.id, widget);
  widgetsByUri.set(widget.templateUri, widget);
});

function widgetMeta(widget: PizzazWidget) {
  return {
    "openai/outputTemplate": widget.templateUri,
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true
  } as const;
}

const toolInputSchema = {
  type: "object",
  properties: {
    pizzaTopping: {
      type: "string",
      description: "Topping to mention when rendering the widget."
    }
  },
  required: ["pizzaTopping"],
  additionalProperties: false
} as const;

const toolInputParser = z.object({
  pizzaTopping: z.string()
});

const tools: Tool[] = widgets.map((widget) => ({
  name: widget.id,
  description: widget.title,
  inputSchema: toolInputSchema,
  title: widget.title,
  _meta: widgetMeta(widget)
}));

const resources: Resource[] = widgets.map((widget) => ({
  uri: widget.templateUri,
  name: widget.title,
  description: `${widget.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(widget)
}));

const resourceTemplates: ResourceTemplate[] = widgets.map((widget) => ({
  uriTemplate: widget.templateUri,
  name: widget.title,
  description: `${widget.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(widget)
}));

function createPizzazServer(): Server {
  const server = new Server(
    {
      name: "pizzaz-node",
      version: "0.1.0"
    },
    {
      capabilities: {
        resources: {},
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async (_request: ListResourcesRequest) => ({
    resources
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request: ReadResourceRequest) => {
    const widget = widgetsByUri.get(request.params.uri);

    if (!widget) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }

    return {
      contents: [
        {
          uri: widget.templateUri,
          mimeType: "text/html+skybridge",
          text: widget.html,
          _meta: widgetMeta(widget)
        }
      ]
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_request: ListResourceTemplatesRequest) => ({
    resourceTemplates
  }));

  server.setRequestHandler(ListToolsRequestSchema, async (_request: ListToolsRequest) => ({
    tools
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const widget = widgetsById.get(request.params.name);

    if (!widget) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const args = toolInputParser.parse(request.params.arguments ?? {});

    return {
      content: [
        {
          type: "text",
          text: widget.responseText
        }
      ],
      structuredContent: {
        pizzaTopping: args.pizzaTopping
      },
      _meta: widgetMeta(widget)
    };
  });

  return server;
}

type SessionRecord = {
  server: Server;
  transport: SSEServerTransport;
};

const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";

async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createPizzazServer();
  const transport = new SSEServerTransport(postPath, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    await server.close();
  };

  transport.onerror = (error) => {
    console.error("SSE transport error", error);
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    res.writeHead(404).end("Unknown session");
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

const portEnv = Number(PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && (url.pathname === ssePath || url.pathname === postPath)) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === ssePath) {
    await handleSseRequest(res);
    return;
  }

  if (req.method === "POST" && url.pathname === postPath) {
    await handlePostMessage(req, res, url);
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

httpServer.listen(port, () => {
  console.log(`Pizzaz MCP server listening on http://localhost:${port}`);
  console.log(`  SSE stream: GET http://localhost:${port}${ssePath}`);
  console.log(`  Message post endpoint: POST http://localhost:${port}${postPath}?sessionId=...`);
});
