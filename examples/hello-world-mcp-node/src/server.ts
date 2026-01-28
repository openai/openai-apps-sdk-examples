/**
 * Hello World MCP server (Node).
 *
 * Goals:
 * - No build step (widget HTML is inline)
 * - Minimal MCP surface area (tools + resources)
 * - Demonstrates `window.openai.callTool`
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const TEMPLATE_URI = "ui://widget/hello-world.html";
const MIME_TYPE = "text/html+skybridge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_HTML_PATH = path.resolve(__dirname, "widget.html");

function readWidgetHtml(): string {
  return fs.readFileSync(WIDGET_HTML_PATH, "utf8");
}

const widgetHtml = readWidgetHtml();

function widgetDescriptorMeta() {
  return {
    "openai/outputTemplate": TEMPLATE_URI,
    "openai/toolInvocation/invoking": "Preparing hello world…",
    "openai/toolInvocation/invoked": "Hello world ready",
    "openai/widgetAccessible": true,
  } as const;
}

function widgetInvocationMeta(invocation: string) {
  return {
    ...widgetDescriptorMeta(),
    invocation,
  };
}

function nonWidgetToolMeta(invoking: string, invoked: string) {
  return {
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  } as const;
}

const showInputSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Name to greet.",
    },
  },
  required: [],
  additionalProperties: false,
} as const;

const showParser = z.object({
  name: z.string().trim().min(1).optional(),
});

const tools: Tool[] = [
  {
    name: "hello-world-show",
    title: "Hello World (show widget)",
    description: "Renders a minimal widget with a greeting.",
    inputSchema: showInputSchema,
    _meta: widgetDescriptorMeta(),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "hello-world-greet",
    title: "Hello World (greet)",
    description: "Returns a greeting (meant to be called from the widget).",
    inputSchema: showInputSchema,
    _meta: nonWidgetToolMeta("Greeting…", "Greeting ready"),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
];

const resources: Resource[] = [
  {
    name: "Hello world widget",
    uri: TEMPLATE_URI,
    description: "Inline hello world widget markup",
    mimeType: MIME_TYPE,
    _meta: widgetDescriptorMeta(),
  },
];

const resourceTemplates: ResourceTemplate[] = [
  {
    name: "Hello world widget template",
    uriTemplate: TEMPLATE_URI,
    description: "Inline hello world widget markup",
    mimeType: MIME_TYPE,
    _meta: widgetDescriptorMeta(),
  },
];

function createHelloWorldServer(): Server {
  const server = new Server(
    { name: "hello-world-node", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } }
  );

  server.setRequestHandler(
    ListResourcesRequestSchema,
    async (_request: ListResourcesRequest) => ({ resources })
  );

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (_request: ReadResourceRequest) => ({
      contents: [
        {
          uri: TEMPLATE_URI,
          mimeType: MIME_TYPE,
          text: widgetHtml,
          _meta: widgetDescriptorMeta(),
        },
      ],
    })
  );

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (_request: ListResourceTemplatesRequest) => ({ resourceTemplates })
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (_request: ListToolsRequest) => ({ tools })
  );

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    if (request.params.name === "hello-world-show") {
      const args = showParser.parse(request.params.arguments ?? {});
      const name = args.name ?? "world";
      const greeting = `Hello, ${name}!`;
      const payload = {
        name,
        greeting,
        subtitle: "This widget is served as inline HTML (no build step).",
        generatedAt: new Date().toISOString(),
      };

      return {
        content: [{ type: "text", text: greeting }],
        structuredContent: payload,
        _meta: widgetInvocationMeta("hello-world-show"),
      };
    }

    if (request.params.name === "hello-world-greet") {
      const args = showParser.parse(request.params.arguments ?? {});
      const name = args.name ?? "world";
      const receivedAt = new Date().toISOString();
      const greeting = `Hello, ${name}!`;
      return {
        content: [{ type: "text", text: greeting }],
        structuredContent: { name, greeting, receivedAt },
        _meta: nonWidgetToolMeta("Greeting…", "Greeting ready"),
      };
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
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
  const server = createHelloWorldServer();
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

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (
    req.method === "OPTIONS" &&
    (url.pathname === ssePath || url.pathname === postPath)
  ) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
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
  console.log(`Hello World MCP server listening on http://localhost:${port}`);
  console.log(`  SSE stream: GET http://localhost:${port}${ssePath}`);
  console.log(
    `  Message post endpoint: POST http://localhost:${port}${postPath}?sessionId=...`
  );
});
