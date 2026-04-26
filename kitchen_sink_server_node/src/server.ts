/**
 * Kitchen Sink Lite MCP server (Node).
 *
 * Serves the kitchen-sink-lite widget HTML and exposes two tools:
 * - kitchen-sink-show: renders the widget with structured content, adding a processedAt/echoed demo.
 * - kitchen-sink-refresh: lightweight echo tool called from the widget via callTool.
 *
 * Uses @modelcontextprotocol/sdk over the Streamable HTTP transport. Make sure
 * assets are built (pnpm run build) so the widget HTML is available in /assets
 * before starting.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

type WidgetPayload = {
  message: string;
  accentColor?: string;
  details?: string;
  fromTool?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");

const TEMPLATE_URI = "ui://widget/kitchen-sink-lite.html";
const MIME_TYPE = "text/html+skybridge";

function readWidgetHtml(): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "pnpm run build" before starting the server.`
    );
  }

  const directPath = path.join(ASSETS_DIR, "kitchen-sink-lite.html");
  let htmlContents: string | null = null;

  if (fs.existsSync(directPath)) {
    htmlContents = fs.readFileSync(directPath, "utf8");
  } else {
    const candidates = fs
      .readdirSync(ASSETS_DIR)
      .filter(
        (file) =>
          file.startsWith("kitchen-sink-lite-") && file.endsWith(".html")
      )
      .sort();
    const fallback = candidates[candidates.length - 1];
    if (fallback) {
      htmlContents = fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
    }
  }

  if (!htmlContents) {
    throw new Error(
      `Widget HTML for "kitchen-sink-lite" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`
    );
  }

  return htmlContents;
}

function toolDescriptorMeta() {
  return {
    "openai/outputTemplate": TEMPLATE_URI,
    "openai/toolInvocation/invoking": "Preparing the kitchen sink widget",
    "openai/toolInvocation/invoked": "Widget rendered",
    "openai/widgetAccessible": true,
  } as const;
}

function toolInvocationMeta(invocation: string) {
  return {
    ...toolDescriptorMeta(),
    invocation,
  };
}

const widgetHtml = readWidgetHtml();

const toolInputSchema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Message to render in the widget.",
    },
    accentColor: {
      type: "string",
      description: "Optional accent color (hex).",
    },
    details: {
      type: "string",
      description: "Optional supporting copy to show under the headline.",
    },
  },
  required: ["message"],
  additionalProperties: false,
} satisfies Tool["inputSchema"];

const refreshInputSchema = {
  type: "object",
  properties: {
    message: { type: "string", description: "Message to echo back." },
  },
  required: ["message"],
  additionalProperties: false,
} satisfies Tool["inputSchema"];

const showParser = z.object({
  message: z.string(),
  accentColor: z.string().optional(),
  details: z.string().optional(),
});

const refreshParser = z.object({
  message: z.string(),
});

const tools: Tool[] = [
  {
    name: "kitchen-sink-show",
    title: "Render kitchen sink widget",
    description: "Returns the widget template with the provided message.",
    inputSchema: toolInputSchema,
    _meta: toolDescriptorMeta(),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "kitchen-sink-refresh",
    title: "Refresh from widget",
    description: "Lightweight echo tool called from the widget via callTool.",
    inputSchema: refreshInputSchema,
    _meta: toolDescriptorMeta(),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
];

const resources: Resource[] = [
  {
    name: "Kitchen sink widget",
    uri: TEMPLATE_URI,
    description: "Kitchen sink lite widget markup",
    mimeType: MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
];

const resourceTemplates: ResourceTemplate[] = [
  {
    name: "Kitchen sink widget template",
    uriTemplate: TEMPLATE_URI,
    description: "Kitchen sink lite widget markup",
    mimeType: MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
];

function createKitchenSinkServer(): Server {
  const server = new Server(
    {
      name: "kitchen-sink-node",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  server.setRequestHandler(
    ListResourcesRequestSchema,
    async (_request: ListResourcesRequest) => ({
      resources,
    })
  );

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (_request: ReadResourceRequest) => ({
      contents: [
        {
          uri: TEMPLATE_URI,
          mimeType: MIME_TYPE,
          text: widgetHtml,
          _meta: toolDescriptorMeta(),
        },
      ],
    })
  );

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (_request: ListResourceTemplatesRequest) => ({
      resourceTemplates,
    })
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (_request: ListToolsRequest) => ({
      tools,
    })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      if (request.params.name === "kitchen-sink-show") {
        const args = showParser.parse(request.params.arguments ?? {});
        const processedAt = new Date().toISOString();
        const echoed = args.message.toUpperCase();
        const payload: WidgetPayload = {
          message: args.message,
          accentColor: args.accentColor ?? "#2d6cdf",
          details:
            args.details ??
            `Processed at ${processedAt}. Echo (uppercased): ${echoed}.`,
          fromTool: "kitchen-sink-show",
        };
        // Demonstrate a tool transforming input before returning structured content.
        return {
          content: [
            {
              type: "text",
              text: `Widget ready with message: ${payload.message} (processed ${processedAt})`,
            },
          ],
          structuredContent: { ...payload, processedAt, echoed },
          _meta: toolInvocationMeta("kitchen-sink-show"),
        };
      }

      if (request.params.name === "kitchen-sink-refresh") {
        const args = refreshParser.parse(request.params.arguments ?? {});
        const payload: WidgetPayload = {
          message: args.message,
          accentColor: "#2d6cdf",
          details: "Response returned from window.openai.callTool.",
          fromTool: "kitchen-sink-refresh",
        };
        return {
          content: [{ type: "text", text: payload.message }],
          structuredContent: payload,
          _meta: toolInvocationMeta("kitchen-sink-refresh"),
        };
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    }
  );

  return server;
}

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const app = express();
app.use(cors());
app.use(express.json());

// Stateless Streamable HTTP: a fresh server + transport per request, with no
// server-side session tracking. Replaces the legacy two-endpoint SSE design
// (`/mcp` + `/mcp/messages?sessionId=...`) with a single MCP endpoint.
app.all("/mcp", async (req, res) => {
  const server = createKitchenSinkServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.listen(port, () => {
  console.log(`Kitchen Sink MCP server listening on http://localhost:${port}`);
  console.log(`  MCP endpoint: http://localhost:${port}/mcp`);
});
