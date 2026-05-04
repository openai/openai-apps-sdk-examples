import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState, useCallback } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { CodeBlock } from "@openai/apps-sdk-ui/components/CodeBlock";
import { BasicsShell, CodeWalkthrough, KeyValueGrid, StatusAlert } from "../mcp-app-basics/components";
import type { DemoData } from "../mcp-app-basics/types";

export default function App() {
  const [data, setData] = useState<DemoData | null>(null);
  const [context, setContext] = useState<Record<string, unknown> | null>(null);
  const [updateCount, setUpdateCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const captureContext = useCallback((app: McpApp) => {
    try {
      const ctx = app.getHostContext();
      setContext(ctx as unknown as Record<string, unknown>);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {
      setContext({});
    }
  }, []);

  const { app, error } = useApp({
    appInfo: { name: "Get Host Context", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
        captureContext(app);
      };
      app.onhostcontextchanged = () => {
        captureContext(app);
        setUpdateCount((c) => c + 1);
      };
    },
  });

  if (error) {
    return <BasicsShell title="Host Context" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Host Context" isConnected={false} />;
  }

  if (!data) {
    return (
      <BasicsShell title="Host Context" isConnected={true} isReady={false} />
    );
  }

  const SIMPLE_KEYS = ["theme", "displayMode", "locale", "timeZone", "platform"] as const;
  const ARRAY_KEYS = ["availableDisplayModes"] as const;
  const OBJECT_KEYS = ["containerDimensions", "deviceCapabilities"] as const;
  const simpleRows = SIMPLE_KEYS.map((key) => {
    const value = context?.[key];
    return {
      label: key,
      value:
        value !== undefined && value !== null ? String(value) : "not reported",
    };
  });
  const arrayRows = ARRAY_KEYS.map((key) => {
    const value = context?.[key];
    return {
      label: key,
      value: Array.isArray(value) ? value.join(", ") : "not reported",
    };
  });

  return (
    <BasicsShell
      title="Host Context"
      description="Live environment data from the MCP Apps bridge, including theme, display mode, locale, and layout hints."
      isConnected={true}
      badge={<Badge color="discovery">MCP bridge</Badge>}
    >
      {lastUpdated ? (
        <StatusAlert
          tone="success"
          title={`Last updated: ${lastUpdated}`}
          description={
            updateCount > 0
              ? `${updateCount} live update${updateCount !== 1 ? "s" : ""}`
              : "Initial host context captured."
          }
        />
      ) : null}

      <KeyValueGrid rows={[...simpleRows, ...arrayRows]} />

      <div className="space-y-3">
        {OBJECT_KEYS.map((key) => {
          const value = context?.[key];
          return (
            <div key={key} className="space-y-1">
              <p className="font-mono text-xs text-secondary">{key}</p>
              <CodeBlock language="json">
                {value && typeof value === "object"
                  ? JSON.stringify(value, null, 2)
                  : "not reported"}
              </CodeBlock>
            </div>
          );
        })}
      </div>

      <StatusAlert
        tone="info"
        title="How it works"
        description="Call app.getHostContext() after connection, then subscribe to app.onhostcontextchanged for updates."
        className="mt-4"
      />

      <CodeWalkthrough steps={data.steps} />
    </BasicsShell>
  );
}
