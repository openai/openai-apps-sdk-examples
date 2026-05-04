import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { ArrowRotateCw } from "@openai/apps-sdk-ui/components/Icon";
import { BasicsShell, CodeWalkthrough, KeyValueGrid, StatusAlert } from "../mcp-app-basics/components";
import { callTool, type ToolResultLike } from "../mcp-app-basics/openai-helpers";
import type { DemoData } from "../mcp-app-basics/types";

type DiceSides = 6 | 12 | 20;
type Status = "idle" | "rolling" | "error";

interface RollResult {
  sides: number;
  rolled: number;
}

function parseRollResult(toolResult: ToolResultLike): RollResult | null {
  const structured = toolResult.structuredContent;
  if (
    structured &&
    typeof structured === "object" &&
    "sides" in structured &&
    "rolled" in structured
  ) {
    return structured as RollResult;
  }

  const text = toolResult.content
    ?.filter((c): c is { type: string; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ");

  return text ? (JSON.parse(text) as RollResult) : null;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DemoData | null>(null);
  const [sides, setSides] = useState<DiceSides>(6);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<RollResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Call Server Tool", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (toolResult) => {
        setData(toolResult.structuredContent as unknown as DemoData);
        setReady(true);
      };
    },
  });

  if (error) {
    return <BasicsShell title="Call Server Tool" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Call Server Tool" isConnected={false} />;
  }

  if (!ready) {
    return (
      <BasicsShell title="Call Server Tool" isConnected={true} isReady={false} />
    );
  }

  const handleRoll = async () => {
    setStatus("rolling");
    setErrorMsg(null);

    try {
      const toolResult = await callTool(app, "call_server_tool__roll_dice", {
        sides,
      });

      if (toolResult.isError) {
        setStatus("error");
        const text = toolResult.content
          ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join(" ");
        setErrorMsg(text || "Tool returned an error.");
      } else {
        setResult(parseRollResult(toolResult));
        setStatus("idle");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <BasicsShell
      title="Call Server Tool"
      description="Roll a die by calling an app-only MCP tool directly from the widget. The model does not participate in the reroll."
      isConnected={true}
      badge={<Badge color="discovery">app-only tool</Badge>}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SegmentedControl
          value={String(sides)}
          onChange={(next) => setSides(Number(next) as DiceSides)}
          aria-label="Dice sides"
          size="md"
        >
          <SegmentedControl.Option value="6">d6</SegmentedControl.Option>
          <SegmentedControl.Option value="12">d12</SegmentedControl.Option>
          <SegmentedControl.Option value="20">d20</SegmentedControl.Option>
        </SegmentedControl>
        <Button
          color="primary"
          onClick={() => void handleRoll()}
          disabled={status === "rolling"}
          loading={status === "rolling"}
          className="w-fit"
        >
          <ArrowRotateCw />
          {status === "rolling" ? "Rolling" : "Roll"}
        </Button>
      </div>

      {result && status === "idle" ? (
        <div className="mb-4 rounded-lg border border-subtle bg-surface-secondary p-3">
          <KeyValueGrid
            className="mb-0"
            rows={[
              { label: "rolled", value: <span className="text-2xl font-semibold">{result.rolled}</span> },
              { label: "sides", value: `d${result.sides}` },
            ]}
          />
        </div>
      ) : null}

      {status === "error" ? (
        <StatusAlert
          tone="danger"
          title="Tool call failed"
          description={errorMsg || "The app-only tool returned an error."}
        />
      ) : null}

      <CodeWalkthrough steps={data?.steps} />
    </BasicsShell>
  );
}
