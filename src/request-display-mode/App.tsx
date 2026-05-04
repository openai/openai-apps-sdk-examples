import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { SegmentedControl } from "@openai/apps-sdk-ui/components/SegmentedControl";
import { Expand } from "@openai/apps-sdk-ui/components/Icon";
import { BasicsShell, CodeWalkthrough, KeyValueGrid, StatusAlert } from "../mcp-app-basics/components";
import { requestDisplayMode } from "../mcp-app-basics/openai-helpers";
import type { DemoData } from "../mcp-app-basics/types";

type DisplayMode = "inline" | "fullscreen" | "pip";

interface ModeResult {
  requested: DisplayMode;
  granted: DisplayMode;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DemoData | null>(null);
  const [currentMode, setCurrentMode] = useState<string | null>(null);
  const [availableModes, setAvailableModes] = useState<DisplayMode[]>([]);
  const [modeResult, setModeResult] = useState<ModeResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Request Display Mode", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
        setReady(true);
        const ctx = app.getHostContext();
        if (ctx) {
          setCurrentMode(ctx.displayMode ?? "inline");
          setAvailableModes((ctx.availableDisplayModes as DisplayMode[]) ?? []);
        }
      };
      app.onhostcontextchanged = (ctx) => {
        if (ctx.displayMode) setCurrentMode(ctx.displayMode);
        if (ctx.availableDisplayModes) {
          setAvailableModes(ctx.availableDisplayModes as DisplayMode[]);
        }
      };
    },
  });

  if (error) {
    return <BasicsShell title="Request Display Mode" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Request Display Mode" isConnected={false} />;
  }

  if (!ready) {
    return (
      <BasicsShell title="Request Display Mode" isConnected={true} isReady={false} />
    );
  }

  const handleRequestMode = async (mode: DisplayMode) => {
    setErrorMsg(null);
    setModeResult(null);

    try {
      const result = await requestDisplayMode(app, mode);
      setModeResult({ requested: mode, granted: result.mode as DisplayMode });
      setCurrentMode(result.mode);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Request failed");
    }
  };

  const allModes: DisplayMode[] = ["inline", "fullscreen", "pip"];

  const isExpanded = currentMode === "fullscreen" || currentMode === "pip";
  const selectedMode = allModes.includes(currentMode as DisplayMode)
    ? (currentMode as DisplayMode)
    : "inline";

  return (
    <BasicsShell
      title="Request Display Mode"
      description="Request inline, fullscreen, or picture-in-picture display from a user action. The host may grant a different mode."
      isConnected={true}
      expanded={isExpanded}
      badge={<Badge color="info">{currentMode ?? "unknown"}</Badge>}
    >
      <div className="mb-4 rounded-lg border border-subtle bg-surface-secondary p-3">
        <KeyValueGrid
          className="mb-0"
          rows={[
            { label: "current", value: currentMode ?? "unknown" },
            {
              label: "available",
              value:
                availableModes.length > 0
                  ? availableModes.join(", ")
                  : "none reported",
            },
          ]}
        />
      </div>

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SegmentedControl<DisplayMode>
          value={selectedMode}
          onChange={(mode) => void handleRequestMode(mode)}
          aria-label="Display mode"
          size="md"
        >
          {allModes.map((mode) => (
            <SegmentedControl.Option
              key={mode}
              value={mode}
              disabled={availableModes.length > 0 && !availableModes.includes(mode)}
            >
              {mode}
            </SegmentedControl.Option>
          ))}
        </SegmentedControl>
        <Button
          color="secondary"
          variant="outline"
          onClick={() => void handleRequestMode("fullscreen")}
          disabled={
            availableModes.length > 0 && !availableModes.includes("fullscreen")
          }
          className="w-fit"
        >
          <Expand />
          Fullscreen
        </Button>
      </div>

      {modeResult ? (
        <StatusAlert
          tone={
            modeResult.requested === modeResult.granted ? "success" : "warning"
          }
          title="Display mode response"
          description={`Requested ${modeResult.requested}; granted ${modeResult.granted}.`}
        />
      ) : null}
      {errorMsg ? (
        <StatusAlert
          tone="danger"
          title="Display mode request failed"
          description={errorMsg}
        />
      ) : null}

      <StatusAlert
        tone="caution"
        title="User action required"
        description="requestDisplayMode must be called from a user-initiated event such as a button click."
      />

      <CodeWalkthrough steps={data?.steps} />
    </BasicsShell>
  );
}
