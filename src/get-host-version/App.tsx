import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { BasicsShell, CodeWalkthrough, KeyValueGrid, StatusAlert } from "../mcp-app-basics/components";
import type { DemoData } from "../mcp-app-basics/types";

interface HostVersion {
  name?: string;
  version?: string;
}

export default function App() {
  const [data, setData] = useState<DemoData | null>(null);
  const [hostVersion, setHostVersion] = useState<HostVersion | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Get Host Version", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
        try {
          const ver = app.getHostVersion();
          setHostVersion(ver as unknown as HostVersion);
        } catch {
          setHostVersion({});
        }
      };
    },
  });

  if (error) {
    return <BasicsShell title="Host Version" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Host Version" isConnected={false} />;
  }

  if (!data) {
    return (
      <BasicsShell title="Host Version" isConnected={true} isReady={false} />
    );
  }

  return (
    <BasicsShell
      title="Host Version"
      description="Host implementation identity from the MCP Apps bridge. This is useful for diagnostics and feature logging."
      isConnected={true}
      badge={<Badge color="discovery">MCP bridge</Badge>}
    >
      <KeyValueGrid
        rows={[
          { label: "name", value: hostVersion?.name ?? "not reported" },
          { label: "version", value: hostVersion?.version ?? "not reported" },
        ]}
      />

      <StatusAlert
        tone="info"
        title="How it works"
        description="Call app.getHostVersion() after connection to identify the host application and version."
      />

      <CodeWalkthrough steps={data.steps} />
    </BasicsShell>
  );
}
