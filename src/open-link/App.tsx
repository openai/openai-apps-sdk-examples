import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState, useRef } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { ExternalLink } from "@openai/apps-sdk-ui/components/Icon";
import { BasicsShell, CodeWalkthrough, StatusAlert } from "../mcp-app-basics/components";
import { openExternal } from "../mcp-app-basics/openai-helpers";
import type { DemoData } from "../mcp-app-basics/types";

type Status = "idle" | "success" | "denied" | "error";

const PREDEFINED_LINKS = [
  { label: "MCP Docs", url: "https://modelcontextprotocol.io/docs/extensions/apps" },
  { label: "GitHub", url: "https://github.com/modelcontextprotocol" },
  { label: "Example.com", url: "https://example.com" },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DemoData | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Open Link", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
        setReady(true);
      };
    },
  });

  if (error) {
    return <BasicsShell title="Open Link" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Open Link" isConnected={false} />;
  }

  if (!ready) {
    return (
      <BasicsShell title="Open Link" isConnected={true} isReady={false} />
    );
  }

  const handleOpenLink = async (url: string) => {
    setLastUrl(url);
    if (timerRef.current) clearTimeout(timerRef.current);

    try {
      const result = await openExternal(app, url);
      if (result.isError) {
        setStatus("denied");
      } else {
        setStatus("success");
      }
    } catch {
      setStatus("error");
    }

    timerRef.current = setTimeout(() => setStatus("idle"), 3000);
  };

  return (
    <BasicsShell
      title="Open Link"
      description="Ask the host to open a vetted external URL. The widget requests navigation, and the host decides whether to allow it."
      isConnected={true}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {PREDEFINED_LINKS.map((link) => (
          <Button
            key={link.url}
            color="secondary"
            variant="outline"
            onClick={() => void handleOpenLink(link.url)}
          >
            <ExternalLink />
            {link.label}
          </Button>
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customUrl.trim()) {
              void handleOpenLink(customUrl.trim());
            }
          }}
          placeholder="https://..."
          className="min-w-0 flex-1"
        />
        <Button
          color="primary"
          onClick={() => {
            if (customUrl.trim()) {
              void handleOpenLink(customUrl.trim());
            }
          }}
          disabled={!customUrl.trim()}
          className="sm:w-fit"
        >
          <ExternalLink />
          Open
        </Button>
      </div>

      {status === "success" ? (
        <StatusAlert tone="success" title="Opened" description={lastUrl} />
      ) : null}
      {status === "denied" ? (
        <StatusAlert tone="warning" title="Denied by host" description={lastUrl} />
      ) : null}
      {status === "error" ? (
        <StatusAlert tone="danger" title="Open failed" description={lastUrl} />
      ) : null}

      <StatusAlert
        tone="info"
        title="Host-mediated navigation"
        description="The app cannot open links directly. All requests go through the host security policy."
        className="mt-4"
      />

      <CodeWalkthrough steps={data?.steps} />
    </BasicsShell>
  );
}
