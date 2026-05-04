import type { App as McpApp } from "@modelcontextprotocol/ext-apps";

type DisplayMode = "inline" | "fullscreen" | "pip";

export type ToolResultLike = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

type OpenAiBridge = {
  callTool?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<ToolResultLike>;
  sendFollowUpMessage?: (args: {
    prompt: string;
    scrollToBottom?: boolean;
  }) => Promise<void>;
  openExternal?: (args: { href: string; redirectUrl?: string | false }) => void | Promise<void>;
  requestDisplayMode?: (args: { mode: DisplayMode }) => Promise<{ mode: DisplayMode }>;
};

function getOpenAiBridge(): OpenAiBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  return (window.openai as unknown as OpenAiBridge | undefined) ?? null;
}

export async function sendFollowUpMessage(
  app: McpApp,
  prompt: string
): Promise<{ isError?: boolean }> {
  const bridge = getOpenAiBridge();

  if (bridge?.sendFollowUpMessage) {
    await bridge.sendFollowUpMessage({ prompt, scrollToBottom: true });
    return {};
  }

  return app.sendMessage({
    role: "user",
    content: [{ type: "text", text: prompt }],
  });
}

export async function callTool(
  app: McpApp,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResultLike> {
  const bridge = getOpenAiBridge();

  if (bridge?.callTool) {
    return bridge.callTool(name, args);
  }

  return app.callServerTool({ name, arguments: args });
}

export async function openExternal(
  app: McpApp,
  href: string
): Promise<{ isError?: boolean }> {
  const bridge = getOpenAiBridge();

  if (bridge?.openExternal) {
    await bridge.openExternal({ href });
    return {};
  }

  return app.openLink({ url: href });
}

export async function requestDisplayMode(
  app: McpApp,
  mode: DisplayMode
): Promise<{ mode: DisplayMode }> {
  const bridge = getOpenAiBridge();

  if (bridge?.requestDisplayMode) {
    return bridge.requestDisplayMode({ mode });
  }

  return app.requestDisplayMode({ mode });
}
