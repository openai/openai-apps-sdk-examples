import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Textarea } from "@openai/apps-sdk-ui/components/Textarea";
import { CodeBlock } from "@openai/apps-sdk-ui/components/CodeBlock";
import { Brain } from "@openai/apps-sdk-ui/components/Icon";
import { BasicsShell, CodeWalkthrough, StatusAlert } from "../mcp-app-basics/components";
import type { DemoData } from "../mcp-app-basics/types";

type Status = "idle" | "updating" | "updated" | "error";

export default function App() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DemoData | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [currentContext, setCurrentContext] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Update Model Context", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
        setReady(true);
      };
    },
  });

  if (error) {
    return <BasicsShell title="Update Model Context" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Update Model Context" isConnected={false} />;
  }

  if (!ready) {
    return (
      <BasicsShell title="Update Model Context" isConnected={true} isReady={false} />
    );
  }

  const handleSetContext = async () => {
    if (!text.trim()) return;

    setStatus("updating");

    try {
      await app.updateModelContext({
        content: [{ type: "text", text: text.trim() }],
      });

      setStatus("updated");
      setCurrentContext(text.trim());
      setText("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <BasicsShell
      title="Update Model Context"
      description="Set context that the model receives on its next turn. The update is quiet and does not trigger an immediate response."
      isConnected={true}
    >
      <div className="space-y-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter context for the model..."
          disabled={status === "updating"}
          rows={3}
          autoResize
        />
        <Button
          color="primary"
          onClick={() => void handleSetContext()}
          disabled={status === "updating" || !text.trim()}
          loading={status === "updating"}
          className="w-fit"
        >
          <Brain />
          {status === "updating" ? "Setting" : "Set context"}
        </Button>
      </div>

      {status === "updated" ? (
        <StatusAlert
          tone="success"
          title="Context set"
          description="The latest context will be included in the model's next turn."
          className="mt-3"
        />
      ) : null}
      {status === "error" ? (
        <StatusAlert
          tone="danger"
          title="Failed to update context"
          description="The host rejected the context update or the bridge call failed."
          className="mt-3"
        />
      ) : null}

      {currentContext ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium uppercase text-secondary">
            Current context
          </p>
          <CodeBlock language="text">{currentContext}</CodeBlock>
        </div>
      ) : null}

      <CodeWalkthrough steps={data?.steps} />
    </BasicsShell>
  );
}
