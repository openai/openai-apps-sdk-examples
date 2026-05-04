import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState, useRef } from "react";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import { ChatCompose } from "@openai/apps-sdk-ui/components/Icon";
import { BasicsShell, CodeWalkthrough, StatusAlert } from "../mcp-app-basics/components";
import { sendFollowUpMessage } from "../mcp-app-basics/openai-helpers";
import type { DemoData } from "../mcp-app-basics/types";

type Status = "idle" | "sending" | "sent" | "error";

export default function App() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DemoData | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Send Message", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
        setReady(true);
      };
    },
  });

  if (error) {
    return <BasicsShell title="Send Message" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Send Message" isConnected={false} />;
  }

  if (!ready) {
    return (
      <BasicsShell title="Send Message" isConnected={true} isReady={false} />
    );
  }

  const handleSend = async () => {
    if (!text.trim()) return;

    setStatus("sending");

    try {
      const result = await sendFollowUpMessage(
        app,
        `[Sent from the Send Message demo widget]: ${text.trim()}`
      );

      if (result.isError) {
        setStatus("error");
      } else {
        setStatus("sent");
        setText("");
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setStatus("idle"), 2000);
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <BasicsShell
      title="Send Message"
      description="Type a message and send it into the conversation. ChatGPT will respond from the component-authored follow-up."
      isConnected={true}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void handleSend();
            }
          }}
          placeholder="Type a message..."
          disabled={status === "sending"}
          className="min-w-0 flex-1"
        />
        <Button
          color="primary"
          onClick={() => void handleSend()}
          disabled={status === "sending" || !text.trim()}
          loading={status === "sending"}
          className="sm:w-fit"
        >
          <ChatCompose />
          {status === "sending" ? "Sending" : "Send"}
        </Button>
      </div>

      {status === "sent" ? (
        <StatusAlert
          tone="success"
          title="Message sent"
          description="The follow-up was handed to ChatGPT."
        />
      ) : null}
      {status === "error" ? (
        <StatusAlert
          tone="danger"
          title="Failed to send"
          description="The host rejected the follow-up or the bridge call failed."
        />
      ) : null}

      <CodeWalkthrough steps={data?.steps} />
    </BasicsShell>
  );
}
