/**
 * MCP App Basics server (Node).
 *
 * Educational demo server with eleven tools:
 *   - show_tool_result: data flowing IN to a widget (structuredContent)
 *   - send_message: data flowing OUT from a widget (app.sendMessage)
 *   - update_model_context: silent context injection (app.updateModelContext)
 *   - call_server_tool: widget calling server tools directly (app.callServerTool)
 *   - host_theming: adapting to host theme (useHostStyles + useDocumentTheme)
 *   - open_link: opening external URLs via app.openLink()
 *   - request_display_mode: changing widget display mode via app.requestDisplayMode()
 *   - streaming_tool_input: streaming partial tool input via app.ontoolinputpartial
 *   - get_host_capabilities: querying host capabilities via app.getHostCapabilities()
 *   - get_host_context: querying host context via app.getHostContext()
 *   - get_host_version: querying host version via app.getHostVersion()
 *
 * Uses registerAppTool + registerAppResource with stateless Streamable HTTP.
 *
 * Build the widget first: pnpm run build
 * Then start: pnpm start
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const SERVER_VERSION = "0.1.3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");

const SHOW_TOOL_RESULT_URI = "ui://show-tool-result/show-tool-result.html";
const SEND_MESSAGE_URI = "ui://send-message/send-message.html";
const UPDATE_MODEL_CONTEXT_URI =
  "ui://update-model-context/update-model-context.html";
const CALL_SERVER_TOOL_URI =
  "ui://call-server-tool/call-server-tool.html";
const HOST_THEMING_URI = "ui://host-theming/host-theming.html";
const OPEN_LINK_URI = "ui://open-link/open-link.html";
const REQUEST_DISPLAY_MODE_URI =
  "ui://request-display-mode/request-display-mode.html";
const STREAMING_TOOL_INPUT_URI =
  "ui://streaming-tool-input/streaming-tool-input.html";
const GET_HOST_CAPABILITIES_URI =
  "ui://get-host-capabilities/get-host-capabilities.html";
const GET_HOST_CONTEXT_URI =
  "ui://get-host-context/get-host-context.html";
const GET_HOST_VERSION_URI =
  "ui://get-host-version/get-host-version.html";

const walkthroughStepSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  summary: z.string(),
  code: z.string(),
});
const walkthroughOutputSchema = {
  toolName: z.string(),
  steps: z.array(walkthroughStepSchema),
};
const showToolResultOutputSchema = {
  greeting: z.string(),
  message: z.string(),
  timestamp: z.string(),
  toolName: z.string(),
  inputReceived: z.object({ name: z.string() }),
  steps: z.array(walkthroughStepSchema),
};

function readWidgetHtml(widgetName: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "pnpm run build" before starting the server.`
    );
  }

  const directPath = path.join(ASSETS_DIR, `${widgetName}.html`);

  if (fs.existsSync(directPath)) {
    return fs.readFileSync(directPath, "utf8");
  }

  // Fall back to hashed filename: {widgetName}-{hash}.html
  const candidates = fs
    .readdirSync(ASSETS_DIR)
    .filter(
      (file) => file.startsWith(`${widgetName}-`) && file.endsWith(".html")
    )
    .sort();
  const fallback = candidates[candidates.length - 1];

  if (fallback) {
    return fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
  }

  throw new Error(
    `Widget HTML for "${widgetName}" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`
  );
}

const showToolResultHtml = readWidgetHtml("show-tool-result");
const sendMessageHtml = readWidgetHtml("send-message");
const updateModelContextHtml = readWidgetHtml("update-model-context");
const callServerToolHtml = readWidgetHtml("call-server-tool");
const hostThemingHtml = readWidgetHtml("host-theming");
const openLinkHtml = readWidgetHtml("open-link");
const requestDisplayModeHtml = readWidgetHtml("request-display-mode");
const streamingToolInputHtml = readWidgetHtml("streaming-tool-input");
const getHostCapabilitiesHtml = readWidgetHtml("get-host-capabilities");
const getHostContextHtml = readWidgetHtml("get-host-context");
const getHostVersionHtml = readWidgetHtml("get-host-version");
function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-app-basics",
    version: SERVER_VERSION,
  });

  // ── show_tool_result ─────────────────────────────────────────────────
  registerAppTool(
    server,
    "show_tool_result",
    {
      title: "Show Tool Result",
      description:
        "Demonstrates how an MCP tool sends data to a widget for display via structuredContent. " +
        "The widget receives and renders the tool's output. Use when the user asks how to display " +
        "a tool result in a widget, render custom UI from a tool call, pass data from a tool to a " +
        "component, use structuredContent, or show server data in a widget.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Optional name to greet (defaults to 'World')"),
      },
      outputSchema: showToolResultOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: SHOW_TOOL_RESULT_URI } },
    },
    async ({ name }) => {
      const resolvedName = name ?? "World";
      const timestamp = new Date().toISOString();
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `The "show_tool_result" tool was called with input ${JSON.stringify({ name: resolvedName })}.`,
              "A live widget is rendering the structuredContent right now.",
              "Explain how the data flowed from the tool handler to the widget, tailored to the user's question.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          greeting: `Hello, ${resolvedName}!`,
          message: "This was generated by the MCP App Basics server.",
          timestamp,
          toolName: "show_tool_result",
          inputReceived: { name: resolvedName },
          steps: [
            {
              id: 1,
              title: "Define the tool",
              summary:
                "Use registerAppTool from @modelcontextprotocol/ext-apps/server",
              code: [
                `import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";`,
                ``,
                `registerAppTool(server, "show_tool_result", {`,
                `  title: "Show Tool Result",`,
                `  inputSchema: { name: z.string().optional() },`,
                `  _meta: { ui: { resourceUri: "${SHOW_TOOL_RESULT_URI}" } },`,
                `}, async ({ name }) => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Return content + structuredContent",
              summary:
                "content for the model, structuredContent for widget + model",
              code: [
                `return {`,
                `  content: [{ type: "text", text: "..." }],`,
                `  structuredContent: {`,
                `    greeting: "Hello, ${resolvedName}!",`,
                `    toolName: "show_tool_result",`,
                `  },`,
                `};`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Serve the widget HTML",
              summary:
                "registerAppResource from @modelcontextprotocol/ext-apps/server",
              code: [
                `import { registerAppResource } from "@modelcontextprotocol/ext-apps/server";`,
                ``,
                `registerAppResource(server, "Widget",`,
                `  "${SHOW_TOOL_RESULT_URI}",`,
                `  { mimeType: RESOURCE_MIME_TYPE },`,
                `  async () => ({`,
                `    contents: [{ uri, mimeType, text: widgetHtml }],`,
                `  })`,
                `);`,
              ].join("\n"),
            },
            {
              id: 4,
              title: "Widget receives data",
              summary: "useApp() from @modelcontextprotocol/ext-apps/react",
              code: [
                `import { useApp } from "@modelcontextprotocol/ext-apps/react";`,
                ``,
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    app.ontoolresult = (result) => {`,
                `      setData(result.structuredContent);`,
                `    };`,
                `  },`,
                `});`,
              ].join("\n"),
            },
            {
              id: 5,
              title: "Render",
              summary: "Standard React from structuredContent data",
              code: [
                `<h1>{data.greeting}</h1>`,
                `<p>{data.message}</p>`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  // ── send_message ─────────────────────────────────────────────────────
  registerAppTool(
    server,
    "send_message",
    {
      title: "Send Message",
      description:
        "Demonstrates how a widget sends a message into the conversation on behalf of the user " +
        "using app.sendMessage(). The message triggers a model response, enabling bidirectional " +
        "widget-to-model communication. Use when the user asks how to send a message from a widget, " +
        "have a widget chat or talk to the AI, trigger a follow-up model response from a component, " +
        "or enable two-way communication between a widget and the model.",
      inputSchema: {},
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: SEND_MESSAGE_URI } },
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              'The "send_message" tool was called.',
              "A live widget is now ready for the user to type a message and send it into the conversation via app.sendMessage().",
              "Explain how sendMessage enables widget-to-model communication, tailored to the user's question.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "send_message",
          steps: [
            {
              id: 1,
              title: "Define the tool",
              summary:
                "Use registerAppTool with a resourceUri pointing to the widget",
              code: [
                `registerAppTool(server, "send_message", {`,
                `  title: "Send Message",`,
                `  inputSchema: {},`,
                `  _meta: { ui: { resourceUri: "${SEND_MESSAGE_URI}" } },`,
                `}, async () => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Widget connects",
              summary:
                "useApp() + ontoolresult to know when the widget is ready",
              code: [
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    app.ontoolresult = () => setReady(true);`,
                `  },`,
                `});`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Call app.sendMessage()",
              summary:
                'Send a user-role message that appears in the conversation and triggers a model response',
              code: [
                `const result = await app.sendMessage({`,
                `  role: "user",`,
                `  content: [{ type: "text", text: "Hello from the widget!" }],`,
                `});`,
              ].join("\n"),
            },
            {
              id: 4,
              title: "Handle the result",
              summary:
                "Check result.isError; on success the message appears in the chat and the model responds",
              code: [
                `if (result.isError) {`,
                `  // handle error`,
                `} else {`,
                `  // message sent successfully`,
                `}`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  // ── update_model_context ─────────────────────────────────────────────
  registerAppTool(
    server,
    "update_model_context",
    {
      title: "Update Model Context",
      description:
        "Demonstrates how a widget silently provides additional context or information to the model " +
        "using app.updateModelContext(). The context is deferred until the model's next turn and does " +
        "not trigger an immediate response. Use when the user asks how to give the model more " +
        "information from a widget, share widget state or data with the AI, inject background context, " +
        "update what the model knows without sending a visible message, or pass data to the model " +
        "silently.",
      inputSchema: {},
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: UPDATE_MODEL_CONTEXT_URI } },
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              'The "update_model_context" tool was called.',
              "A live widget is now ready for the user to set context that will be silently included in the model's next turn via app.updateModelContext().",
              "Explain how updateModelContext differs from sendMessage: it is deferred (not immediate) and does not trigger a model response on its own.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "update_model_context",
          steps: [
            {
              id: 1,
              title: "Define the tool",
              summary:
                "Use registerAppTool with a resourceUri pointing to the widget",
              code: [
                `registerAppTool(server, "update_model_context", {`,
                `  title: "Update Model Context",`,
                `  inputSchema: {},`,
                `  _meta: { ui: { resourceUri: "${UPDATE_MODEL_CONTEXT_URI}" } },`,
                `}, async () => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Widget connects",
              summary:
                "useApp() + ontoolresult to know when the widget is ready",
              code: [
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    app.ontoolresult = () => setReady(true);`,
                `  },`,
                `});`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Call app.updateModelContext()",
              summary:
                "Silently provide context — no message appears, no immediate model response",
              code: [
                `const result = await app.updateModelContext({`,
                `  content: [{ type: "text", text: "User prefers dark mode" }],`,
                `});`,
              ].join("\n"),
            },
            {
              id: 4,
              title: "Deferred, last-write-wins",
              summary:
                "Each call overwrites the previous; context is delivered on the next user message or sendMessage turn",
              code: [
                `// First call sets context`,
                `await app.updateModelContext({`,
                `  content: [{ type: "text", text: "Context A" }],`,
                `});`,
                ``,
                `// Second call REPLACES Context A with Context B`,
                `await app.updateModelContext({`,
                `  content: [{ type: "text", text: "Context B" }],`,
                `});`,
                `// Model only sees "Context B" on its next turn`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  // ── call_server_tool (model-visible) ──────────────────────────────────
  registerAppTool(
    server,
    "call_server_tool",
    {
      title: "Call Server Tool",
      description:
        "Demonstrates how a widget calls a server tool directly via app.callServerTool(), " +
        "bypassing the model entirely. The widget calls an app-only dice-roll tool registered " +
        'with visibility: ["app"]. Use when the user asks how to call a tool from a widget, ' +
        "invoke server-side logic from a component, use callServerTool, or create app-only tools.",
      inputSchema: {},
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: CALL_SERVER_TOOL_URI } },
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              'The "call_server_tool" tool was called.',
              "A live widget is now ready for the user to roll dice by calling an app-only server tool directly via app.callServerTool().",
              "Explain how callServerTool enables widget-to-server communication without model involvement, tailored to the user's question.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "call_server_tool",
          steps: [
            {
              id: 1,
              title: "Register an app-only tool",
              summary:
                'Use visibility: ["app"] so only the widget can call it — the model never sees it',
              code: [
                `registerAppTool(server, "call_server_tool__roll_dice", {`,
                `  title: "Roll Dice",`,
                `  inputSchema: { sides: z.number() },`,
                `  _meta: { ui: { visibility: ["app"] } },`,
                `}, async ({ sides }) => {`,
                `  const rolled = Math.floor(Math.random() * sides) + 1;`,
                `  return { content: [{ type: "text", text: JSON.stringify({ sides, rolled }) }] };`,
                `});`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Widget calls the tool",
              summary:
                "app.callServerTool() sends a request to the server, proxied by the host",
              code: [
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    app.ontoolresult = () => setReady(true);`,
                `  },`,
                `});`,
                ``,
                `const result = await app.callServerTool({`,
                `  name: "call_server_tool__roll_dice",`,
                `  arguments: { sides: 20 },`,
                `});`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Handle the result",
              summary:
                "Check isError for tool-level failures; transport errors throw",
              code: [
                `if (result.isError) {`,
                `  console.error("Tool error:", result.content);`,
                `} else {`,
                `  const data = JSON.parse(result.content[0].text);`,
                `  console.log("Rolled:", data.rolled);`,
                `}`,
              ].join("\n"),
            },
            {
              id: 4,
              title: "Model never sees app-only tools",
              summary:
                'Tools with visibility: ["app"] are hidden from the model\'s tool list',
              code: [
                `// Model-visible tool (default):`,
                `//   _meta: { ui: { resourceUri: "..." } }`,
                ``,
                `// App-only tool (hidden from model):`,
                `//   _meta: { ui: { visibility: ["app"] } }`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  // ── call_server_tool__roll_dice (app-only) ───────────────────────────
  registerAppTool(
    server,
    "call_server_tool__roll_dice",
    {
      title: "Roll Dice",
      description: "Rolls a dice with the given number of sides. App-only tool.",
      inputSchema: {
        sides: z.number().describe("Number of sides on the dice"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ sides }) => {
      const rolled = Math.floor(Math.random() * sides) + 1;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ sides, rolled }),
          },
        ],
      };
    }
  );

  // ── host_theming ─────────────────────────────────────────────────────
  registerAppTool(
    server,
    "host_theming",
    {
      title: "Host Theming",
      description:
        "Demonstrates how a widget adapts to the host's theme using useHostStyles() and " +
        "useDocumentTheme(). The widget automatically inherits the host's CSS variables, fonts, " +
        "and light/dark theme. Use when the user asks how to match the host theme, style a widget " +
        "like ChatGPT, use CSS variables from the host, detect light or dark mode, or adapt to " +
        "theme changes.",
      inputSchema: {},
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: HOST_THEMING_URI } },
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              'The "host_theming" tool was called.',
              "A live widget is now displaying a card styled with the host's CSS variables, showing how it adapts automatically to the current theme.",
              "Explain how useHostStyles and useDocumentTheme enable seamless theme integration, tailored to the user's question.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "host_theming",
          steps: [
            {
              id: 1,
              title: "Define the tool",
              summary:
                "Use registerAppTool with a resourceUri pointing to the widget",
              code: [
                `registerAppTool(server, "host_theming", {`,
                `  title: "Host Theming",`,
                `  inputSchema: {},`,
                `  _meta: { ui: { resourceUri: "${HOST_THEMING_URI}" } },`,
                `}, async () => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Call useHostStyles(app)",
              summary:
                "Applies all host CSS variables and fonts to your widget's document",
              code: [
                `import { useApp, useHostStyles, useDocumentTheme }`,
                `  from "@modelcontextprotocol/ext-apps/react";`,
                ``,
                `const { app } = useApp({ ... });`,
                `useHostStyles(app, app?.getHostContext());`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Use useDocumentTheme()",
              summary:
                'Reactive hook that returns "light" or "dark" — re-renders on theme change',
              code: [
                `const theme = useDocumentTheme();`,
                `// theme === "light" | "dark"`,
              ].join("\n"),
            },
            {
              id: 4,
              title: "Style with CSS variables",
              summary:
                "Use var(--color-*) instead of hardcoded colors to match the host",
              code: [
                `<div style={{`,
                `  background: "var(--color-background-primary)",`,
                `  color: "var(--color-text-primary)",`,
                `  border: "1px solid var(--color-border-light)",`,
                `  borderRadius: "var(--border-radius-md)",`,
                `}}>`,
                `  Themed content`,
                `</div>`,
              ].join("\n"),
            },
            {
              id: 5,
              title: "React to theme changes",
              summary:
                "onhostcontextchanged fires automatically; hooks handle re-renders",
              code: [
                `const theme = useDocumentTheme();`,
                ``,
                `return (`,
                `  <div>`,
                `    {theme === "dark" ? <DarkIcon /> : <LightIcon />}`,
                `  </div>`,
                `);`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  // ── Resources ────────────────────────────────────────────────────────
  registerAppResource(
    server,
    "Show Tool Result Widget",
    SHOW_TOOL_RESULT_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Show Tool Result widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: SHOW_TOOL_RESULT_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: showToolResultHtml,
        },
      ],
    })
  );

  registerAppResource(
    server,
    "Send Message Widget",
    SEND_MESSAGE_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: "Send Message widget HTML" },
    async () => ({
      contents: [
        {
          uri: SEND_MESSAGE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: sendMessageHtml,
        },
      ],
    })
  );

  registerAppResource(
    server,
    "Update Model Context Widget",
    UPDATE_MODEL_CONTEXT_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Update Model Context widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: UPDATE_MODEL_CONTEXT_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: updateModelContextHtml,
        },
      ],
    })
  );

  registerAppResource(
    server,
    "Call Server Tool Widget",
    CALL_SERVER_TOOL_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Call Server Tool widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: CALL_SERVER_TOOL_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: callServerToolHtml,
        },
      ],
    })
  );

  registerAppResource(
    server,
    "Host Theming Widget",
    HOST_THEMING_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Host Theming widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: HOST_THEMING_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: hostThemingHtml,
        },
      ],
    })
  );

  // ── open_link ─────────────────────────────────────────────────────────
  registerAppTool(
    server,
    "open_link",
    {
      title: "Open Link",
      description:
        "Demonstrates how a widget opens an external URL via app.openLink(). The host may deny " +
        "the request based on its security policy. Use when the user asks how to open a link from " +
        "a widget, navigate to an external URL, launch a browser tab, or handle link denial.",
      inputSchema: {},
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: OPEN_LINK_URI } },
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              'The "open_link" tool was called.',
              "A live widget is now ready for the user to open links via app.openLink().",
              "Explain how openLink requests the host to open a URL, and how the host may deny the request based on its security policy.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "open_link",
          steps: [
            {
              id: 1,
              title: "Define the tool",
              summary:
                "Use registerAppTool with a resourceUri pointing to the widget",
              code: [
                `registerAppTool(server, "open_link", {`,
                `  title: "Open Link",`,
                `  inputSchema: {},`,
                `  _meta: { ui: { resourceUri: "${OPEN_LINK_URI}" } },`,
                `}, async () => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Call app.openLink()",
              summary:
                "Request the host to open a URL in a new tab or browser",
              code: [
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    app.ontoolresult = () => setReady(true);`,
                `  },`,
                `});`,
                ``,
                `const result = await app.openLink({`,
                `  url: "https://example.com",`,
                `});`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Handle denial",
              summary:
                "The host may deny the request based on its security policy — check isError",
              code: [
                `if (result.isError) {`,
                `  // Host denied the request`,
                `  console.log("Link denied by host");`,
                `} else {`,
                `  // Link opened successfully`,
                `  console.log("Link opened");`,
                `}`,
              ].join("\n"),
            },
            {
              id: 4,
              title: "Host security policy",
              summary:
                "The host controls which URLs are allowed — untrusted URLs may be blocked",
              code: [
                `// The host decides which URLs to allow.`,
                `// There's no way to bypass this — it's a security feature.`,
                `// Always handle denial gracefully in your UI.`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  registerAppResource(
    server,
    "Open Link Widget",
    OPEN_LINK_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Open Link widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: OPEN_LINK_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: openLinkHtml,
        },
      ],
    })
  );

  // ── request_display_mode ──────────────────────────────────────────────
  registerAppTool(
    server,
    "request_display_mode",
    {
      title: "Request Display Mode",
      description:
        "Demonstrates how a widget changes its display mode via app.requestDisplayMode(). " +
        "Supports inline, fullscreen, and pip modes. The host may grant a different mode than " +
        "requested. Use when the user asks how to go fullscreen, change widget size, use picture-in-picture, " +
        "request display mode, or check available display modes.",
      inputSchema: {},
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: REQUEST_DISPLAY_MODE_URI } },
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              'The "request_display_mode" tool was called.',
              "A live widget is now ready for the user to switch between inline, fullscreen, and pip display modes via app.requestDisplayMode().",
              "Explain how requestDisplayMode works, that it must be called from a user-initiated action, and that the host may grant a different mode than requested.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "request_display_mode",
          steps: [
            {
              id: 1,
              title: "Define the tool",
              summary:
                "Use registerAppTool with a resourceUri pointing to the widget",
              code: [
                `registerAppTool(server, "request_display_mode", {`,
                `  title: "Request Display Mode",`,
                `  inputSchema: {},`,
                `  _meta: { ui: { resourceUri: "${REQUEST_DISPLAY_MODE_URI}" } },`,
                `}, async () => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Check available modes",
              summary:
                "Use getHostContext() to see which modes the host supports",
              code: [
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    app.ontoolresult = () => setReady(true);`,
                `  },`,
                `});`,
                ``,
                `const ctx = app.getHostContext();`,
                `const available = ctx?.availableDisplayModes;`,
                `// e.g. ["inline", "fullscreen", "pip"]`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Request a mode change",
              summary:
                "Must be called from a user-initiated action (button click) — will fail if called programmatically",
              code: [
                `// IMPORTANT: Must be in a click handler!`,
                `const result = await app.requestDisplayMode({`,
                `  mode: "fullscreen",`,
                `});`,
                `console.log("Granted:", result.mode);`,
              ].join("\n"),
            },
            {
              id: 4,
              title: "Granted vs requested",
              summary:
                "The host may grant a different mode — always check the result",
              code: [
                `const result = await app.requestDisplayMode({`,
                `  mode: "pip",`,
                `});`,
                ``,
                `if (result.mode !== "pip") {`,
                `  // Host granted a different mode`,
                `  console.log("Got:", result.mode, "instead of pip");`,
                `}`,
              ].join("\n"),
            },
            {
              id: 5,
              title: "Listen for context changes",
              summary:
                "onhostcontextchanged fires when the display mode changes (including user-initiated changes)",
              code: [
                `app.onhostcontextchanged = (ctx) => {`,
                `  console.log("New mode:", ctx.displayMode);`,
                `  console.log("Available:", ctx.availableDisplayModes);`,
                `};`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  registerAppResource(
    server,
    "Request Display Mode Widget",
    REQUEST_DISPLAY_MODE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Request Display Mode widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: REQUEST_DISPLAY_MODE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: requestDisplayModeHtml,
        },
      ],
    })
  );

  // ── streaming_tool_input ─────────────────────────────────────────────
  registerAppTool(
    server,
    "streaming_tool_input",
    {
      title: "Streaming Tool Input",
      description:
        "Demonstrates how a widget renders tool arguments progressively as they stream in via " +
        "app.ontoolinputpartial. Write an original, creative short story — the widget will show " +
        "each field appearing in real time as the model generates the arguments. " +
        "Use when the user asks how to stream tool input, show partial arguments, render progressively, " +
        "use ontoolinputpartial, or preview tool args.",
      inputSchema: {
        title: z.string().describe("Title of the short story"),
        author: z.string().describe("Author name (invent a pen name)"),
        genre: z
          .string()
          .describe("Genre (e.g. sci-fi, fantasy, mystery, fable)"),
        setting: z
          .string()
          .describe(
            "A vivid 1-2 sentence description of where and when the story takes place"
          ),
        paragraphs: z
          .array(z.string())
          .describe(
            "The story body as an array of paragraphs. Write 3 paragraphs, " +
              "each 2-3 sentences long, to create a complete narrative arc."
          ),
        moral: z
          .string()
          .describe("The moral or takeaway of the story (1 sentence)"),
      },
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: STREAMING_TOOL_INPUT_URI } },
    },
    async ({ title, author }) => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `The story "${title}" by ${author} was generated.`,
              "The widget rendered each field progressively as it streamed in via ontoolinputpartial.",
              "Explain how the widget used ontoolinputpartial to show partial arguments in real time.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "streaming_tool_input",
          steps: [
            {
              id: 1,
              title: "Define the tool with a rich inputSchema",
              summary:
                "The inputSchema drives what gets streamed — each Zod field appears progressively in the widget",
              code: [
                `registerAppTool(server, "streaming_tool_input", {`,
                `  title: "Streaming Tool Input",`,
                `  inputSchema: {`,
                `    title: z.string(),`,
                `    author: z.string(),`,
                `    genre: z.string(),`,
                `    setting: z.string(),`,
                `    paragraphs: z.array(z.string()),`,
                `    moral: z.string(),`,
                `  },`,
                `  _meta: { ui: { resourceUri: "${STREAMING_TOOL_INPUT_URI}" } },`,
                `}, async ({ title, author }) => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Connect and register callbacks",
              summary:
                "useApp() + all three event handlers in onAppCreated",
              code: [
                `const [story, setStory] = useState(null);`,
                `const [phase, setPhase] = useState("waiting");`,
                ``,
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    // Fires many times with partial (healed) JSON`,
                `    app.ontoolinputpartial = (params) => {`,
                `      setStory(params.arguments);`,
                `      setPhase("streaming");`,
                `    };`,
                `    // Fires once with the final, complete input`,
                `    app.ontoolinput = (params) => {`,
                `      setStory(params.arguments);`,
                `    };`,
                `    // Fires once after the server handler returns`,
                `    app.ontoolresult = () => {`,
                `      setPhase("complete");`,
                `    };`,
                `  },`,
                `});`,
                ``,
                `// Render — fields appear one by one as they stream:`,
                `return (`,
                `  <div>`,
                `    {story?.title && <h2>{story.title}</h2>}`,
                `    {story?.author && <p>by {story.author}</p>}`,
                `    {story?.setting && <p>{story.setting}</p>}`,
                `    {formatStory(story, { fadeTrailing: phase === "streaming" })}`,
                `  </div>`,
                `);`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Event ordering",
              summary:
                "Partial (0..N) → input (0..1) → result (1) — use partial only for preview UI",
              code: [
                `// Event lifecycle:`,
                `// ontoolinputpartial (many)  — healed, incomplete`,
                `// ontoolinput       (once)   — final, complete`,
                `// ontoolresult      (once)   — server response`,
                ``,
                `// Partial args may have truncated strings`,
                `// or incomplete arrays — use for preview only`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  registerAppResource(
    server,
    "Streaming Tool Input Widget",
    STREAMING_TOOL_INPUT_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Streaming Tool Input widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: STREAMING_TOOL_INPUT_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: streamingToolInputHtml,
        },
      ],
    })
  );

  // ── get_host_capabilities ───────────────────────────────────────────
  registerAppTool(
    server,
    "get_host_capabilities",
    {
      title: "Get Host Capabilities",
      description:
        "Demonstrates how a widget queries what the host supports via app.getHostCapabilities(). " +
        "Returns capabilities like openLinks, serverTools, logging, sandbox, updateModelContext, " +
        "and message. Use when the user asks how to check host capabilities, detect supported " +
        "features, use getHostCapabilities, or query what the host can do.",
      inputSchema: {},
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: GET_HOST_CAPABILITIES_URI } },
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              'The "get_host_capabilities" tool was called.',
              "A live widget is now displaying the host's capabilities returned by app.getHostCapabilities().",
              "Explain how getHostCapabilities lets a widget discover what the host supports, tailored to the user's question.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "get_host_capabilities",
          steps: [
            {
              id: 1,
              title: "Define the tool",
              summary:
                "Use registerAppTool with a resourceUri pointing to the widget",
              code: [
                `registerAppTool(server, "get_host_capabilities", {`,
                `  title: "Get Host Capabilities",`,
                `  inputSchema: {},`,
                `  _meta: { ui: { resourceUri: "${GET_HOST_CAPABILITIES_URI}" } },`,
                `}, async () => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Call app.getHostCapabilities()",
              summary:
                "Returns an object describing what the host supports — available after connection",
              code: [
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    app.ontoolresult = () => { /* ... */ };`,
                `  },`,
                `});`,
                ``,
                `const caps = app.getHostCapabilities();`,
                `// caps.openLinks — can the host open external links?`,
                `// caps.serverTools — can the widget call server tools?`,
                `// caps.message — can the widget send messages?`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Check individual capabilities",
              summary:
                "Each field is present if supported, undefined if not",
              code: [
                `if (caps.openLinks) {`,
                `  // Safe to call app.openLink()`,
                `}`,
                `if (caps.updateModelContext) {`,
                `  // Safe to call app.updateModelContext()`,
                `}`,
              ].join("\n"),
            },
            {
              id: 4,
              title: "Capabilities are static",
              summary:
                "Set once at connection time — they do not change during the session",
              code: [
                `// Call once after connection and cache the result`,
                `const caps = app.getHostCapabilities();`,
                `// No need for a listener — capabilities don't change`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  registerAppResource(
    server,
    "Get Host Capabilities Widget",
    GET_HOST_CAPABILITIES_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Get Host Capabilities widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: GET_HOST_CAPABILITIES_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: getHostCapabilitiesHtml,
        },
      ],
    })
  );

  // ── get_host_context ────────────────────────────────────────────────
  registerAppTool(
    server,
    "get_host_context",
    {
      title: "Get Host Context",
      description:
        "Demonstrates how a widget queries the host's environment via app.getHostContext() and " +
        "listens for live updates via app.onhostcontextchanged. Shows theme, displayMode, locale, " +
        "timeZone, platform, containerDimensions, and more. Use when the user asks how to get host " +
        "context, detect theme or locale, listen for context changes, use getHostContext, or react " +
        "to environment changes.",
      inputSchema: {},
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: GET_HOST_CONTEXT_URI } },
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              'The "get_host_context" tool was called.',
              "A live widget is now displaying the host's context returned by app.getHostContext(), with live updates via onhostcontextchanged.",
              "Explain how getHostContext provides environment info and how onhostcontextchanged enables reactive updates, tailored to the user's question.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "get_host_context",
          steps: [
            {
              id: 1,
              title: "Define the tool",
              summary:
                "Use registerAppTool with a resourceUri pointing to the widget",
              code: [
                `registerAppTool(server, "get_host_context", {`,
                `  title: "Get Host Context",`,
                `  inputSchema: {},`,
                `  _meta: { ui: { resourceUri: "${GET_HOST_CONTEXT_URI}" } },`,
                `}, async () => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Call app.getHostContext()",
              summary:
                "Returns the current host environment — theme, locale, display mode, dimensions, etc.",
              code: [
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    app.ontoolresult = () => { /* ... */ };`,
                `    app.onhostcontextchanged = (ctx) => {`,
                `      console.log("Theme:", ctx.theme);`,
                `    };`,
                `  },`,
                `});`,
                ``,
                `const ctx = app.getHostContext();`,
                `// ctx.theme — "light" | "dark"`,
                `// ctx.displayMode — "inline" | "fullscreen" | "pip"`,
                `// ctx.locale — e.g. "en-US"`,
                `// ctx.containerDimensions — { width, height }`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Context vs Capabilities",
              summary:
                "Context is dynamic (changes over time); capabilities are static (set once at connection)",
              code: [
                `// Dynamic — changes during session:`,
                `const ctx = app.getHostContext();`,
                ``,
                `// Static — set once at connection:`,
                `const caps = app.getHostCapabilities();`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  registerAppResource(
    server,
    "Get Host Context Widget",
    GET_HOST_CONTEXT_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Get Host Context widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: GET_HOST_CONTEXT_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: getHostContextHtml,
        },
      ],
    })
  );

  // ── get_host_version ────────────────────────────────────────────────
  registerAppTool(
    server,
    "get_host_version",
    {
      title: "Get Host Version",
      description:
        "Demonstrates how a widget identifies the host application via app.getHostVersion(). " +
        "Returns the host's name and version string. Use when the user asks how to identify the " +
        "host, get the host name or version, use getHostVersion, or detect which host is running.",
      inputSchema: {},
      outputSchema: walkthroughOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: GET_HOST_VERSION_URI } },
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              'The "get_host_version" tool was called.',
              "A live widget is now displaying the host's name and version returned by app.getHostVersion().",
              "Explain how getHostVersion identifies the host application, tailored to the user's question.",
              "Encourage follow-up questions about MCP Apps.",
            ].join(" "),
          },
        ],
        structuredContent: {
          toolName: "get_host_version",
          steps: [
            {
              id: 1,
              title: "Define the tool",
              summary:
                "Use registerAppTool with a resourceUri pointing to the widget",
              code: [
                `registerAppTool(server, "get_host_version", {`,
                `  title: "Get Host Version",`,
                `  inputSchema: {},`,
                `  _meta: { ui: { resourceUri: "${GET_HOST_VERSION_URI}" } },`,
                `}, async () => { /* handler */ });`,
              ].join("\n"),
            },
            {
              id: 2,
              title: "Call app.getHostVersion()",
              summary:
                "Returns { name, version } identifying the host application",
              code: [
                `const { app } = useApp({`,
                `  onAppCreated: (app) => {`,
                `    app.ontoolresult = () => { /* ... */ };`,
                `  },`,
                `});`,
                ``,
                `const ver = app.getHostVersion();`,
                `console.log(ver.name);    // e.g. "ChatGPT"`,
                `console.log(ver.version); // e.g. "1.2.3"`,
              ].join("\n"),
            },
            {
              id: 3,
              title: "Use for feature detection",
              summary:
                "Check the host name or version to conditionally enable features",
              code: [
                `const ver = app.getHostVersion();`,
                `if (ver.name === "ChatGPT") {`,
                `  // ChatGPT-specific behavior`,
                `}`,
              ].join("\n"),
            },
            {
              id: 4,
              title: "Version is static",
              summary:
                "Like capabilities, the version is set once at connection and does not change",
              code: [
                `// Call once after connection`,
                `const ver = app.getHostVersion();`,
                `// No listener needed — version doesn't change`,
              ].join("\n"),
            },
          ],
        },
      };
    }
  );

  registerAppResource(
    server,
    "Get Host Version Widget",
    GET_HOST_VERSION_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Get Host Version widget HTML",
    },
    async () => ({
      contents: [
        {
          uri: GET_HOST_VERSION_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: getHostVersionHtml,
        },
      ],
    })
  );

  return server;
}

const port = parseInt(process.env.PORT ?? "8000", 10);
const app = express();
app.use(cors());
app.use(express.json());

app.all("/mcp", async (req, res) => {
  const server = createServer();
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
  console.log(
    `MCP App Basics server listening on http://localhost:${port}/mcp`
  );
});
