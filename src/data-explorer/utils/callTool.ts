import type { CallToolResponse } from "../../types";

export async function callToolJson<T>(
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  if (!window?.openai?.callTool) {
    throw new Error("callTool API is unavailable in this environment.");
  }

  const response: CallToolResponse = await window.openai.callTool(name, args);
  const payload = response?.result ?? "";

  if (!payload) {
    throw new Error("Tool call returned an empty response.");
  }

  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    throw new Error(
      `Unable to parse tool response for ${name}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
