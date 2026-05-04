import {
  useApp,
  useHostStyles,
  useDocumentTheme,
} from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { ColorTheme } from "@openai/apps-sdk-ui/components/Icon";
import { BasicsShell, CodeWalkthrough, KeyValueGrid } from "../mcp-app-basics/components";
import type { DemoData } from "../mcp-app-basics/types";

const CSS_VARS_TO_SHOW = [
  "--color-background-primary",
  "--color-background-secondary",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-border-light",
  "--border-radius-md",
] as const;

export default function App() {
  const [data, setData] = useState<DemoData | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Host Theming", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
      };
    },
  });

  useHostStyles(app, app?.getHostContext());
  const theme = useDocumentTheme();

  if (error) {
    return <BasicsShell title="Host Theming" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Host Theming" isConnected={false} />;
  }

  if (!data) {
    return (
      <BasicsShell title="Host Theming" isConnected={true} isReady={false} />
    );
  }

  return (
    <BasicsShell
      title="Host Theming"
      description="This widget uses host CSS variables and Apps SDK UI tokens, so it follows the current ChatGPT theme."
      isConnected={true}
      badge={
        <Badge color={theme === "dark" ? "discovery" : "info"}>
          <ColorTheme className="size-3" />
          {theme}
        </Badge>
      }
    >
      <div className="mb-4 rounded-lg border border-subtle bg-surface-secondary p-3">
        <KeyValueGrid
          className="mb-0"
          rows={CSS_VARS_TO_SHOW.map((varName) => {
            const value =
              typeof window !== "undefined"
                ? getComputedStyle(document.documentElement)
                    .getPropertyValue(varName)
                    .trim()
                : "";
            const isColor = varName.startsWith("--color-");
            return {
              label: varName,
              value: value || "(unset)",
              badge:
                isColor && value ? (
                  <span
                    aria-hidden="true"
                    className="inline-block size-4 rounded border border-subtle"
                    style={{ background: `var(${varName})` }}
                  />
                ) : null,
            };
          })}
        />
      </div>

      <CodeWalkthrough steps={data.steps} />
    </BasicsShell>
  );
}
