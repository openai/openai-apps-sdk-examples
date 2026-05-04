import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { CodeBlock } from "@openai/apps-sdk-ui/components/CodeBlock";
import { BasicsShell, CodeWalkthrough, StatusAlert } from "../mcp-app-basics/components";
import type { DemoData } from "../mcp-app-basics/types";

const CAPABILITY_KEYS = [
  "openLinks",
  "serverTools",
  "serverResources",
  "logging",
  "sandbox",
  "updateModelContext",
  "message",
] as const;

export default function App() {
  const [data, setData] = useState<DemoData | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, unknown> | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Get Host Capabilities", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
        try {
          const caps = app.getHostCapabilities();
          setCapabilities(caps as unknown as Record<string, unknown>);
        } catch {
          setCapabilities({});
        }
      };
    },
  });

  if (error) {
    return <BasicsShell title="Host Capabilities" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Host Capabilities" isConnected={false} />;
  }

  if (!data) {
    return (
      <BasicsShell title="Host Capabilities" isConnected={true} isReady={false} />
    );
  }

  return (
    <BasicsShell
      title="Host Capabilities"
      description="Capabilities advertised during the MCP Apps bridge initialization. This is an ext-apps bridge example."
      isConnected={true}
      badge={<Badge color="discovery">MCP bridge</Badge>}
    >
      <div className="mb-4 divide-y divide-subtle rounded-lg border border-subtle">
        {CAPABILITY_KEYS.map((key) => {
          const value = capabilities?.[key];
          const supported =
            value !== undefined && value !== null && value !== false;
          return (
            <div
              key={key}
              className="grid gap-2 p-3 sm:grid-cols-[minmax(8rem,1fr)_auto_minmax(10rem,1.2fr)] sm:items-start"
            >
              <span className="font-mono text-xs text-primary">{key}</span>
              <Badge color={supported ? "success" : "secondary"} variant="soft">
                {supported ? "supported" : "not reported"}
              </Badge>
              <span className="min-w-0 break-words font-mono text-xs text-secondary">
                {supported
                  ? typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)
                  : "not reported"}
              </span>
            </div>
          );
        })}
      </div>

      <StatusAlert
        tone="info"
        title="How it works"
        description="Call app.getHostCapabilities() after connection. These capabilities are set by the host during initialization."
      />

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium uppercase text-secondary">
          Raw capabilities
        </p>
        <CodeBlock language="json">
          {JSON.stringify(capabilities ?? {}, null, 2)}
        </CodeBlock>
      </div>

      <CodeWalkthrough steps={data.steps} />
    </BasicsShell>
  );
}
