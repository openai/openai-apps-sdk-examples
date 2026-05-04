import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { CodeWalkthrough, BasicsShell, KeyValueGrid } from "../mcp-app-basics/components";
import type { Step } from "../mcp-app-basics/types";

interface DemoData {
  greeting: string;
  message: string;
  timestamp: string;
  toolName: string;
  inputReceived: { name: string };
  steps: Step[];
}

export default function App() {
  const [data, setData] = useState<DemoData | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Show Tool Result", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
      };
    },
  });

  if (error) {
    return <BasicsShell title="Show Tool Result" error={error} isConnected={false}> </BasicsShell>;
  }

  if (!app) {
    return <BasicsShell title="Show Tool Result" isConnected={false}> </BasicsShell>;
  }

  if (!data) {
    return (
      <BasicsShell title="Show Tool Result" isConnected={true} isReady={false}>
        {" "}
      </BasicsShell>
    );
  }

  return (
    <BasicsShell
      title={data.greeting}
      description={data.message}
      isConnected={true}
      badge={<Badge color="info">structuredContent</Badge>}
    >
      <KeyValueGrid
        rows={[
          { label: "tool", value: data.toolName },
          { label: "input", value: JSON.stringify(data.inputReceived) },
          { label: "timestamp", value: data.timestamp },
        ]}
      />
      <CodeWalkthrough steps={data.steps} />
    </BasicsShell>
  );
}
