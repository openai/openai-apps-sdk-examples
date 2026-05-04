import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useState } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { CodeBlock } from "@openai/apps-sdk-ui/components/CodeBlock";
import { BasicsShell, CodeWalkthrough, StatusAlert } from "../mcp-app-basics/components";
import type { DemoData } from "../mcp-app-basics/types";

interface StoryInput {
  title?: string;
  author?: string;
  genre?: string;
  setting?: string;
  paragraphs?: string[];
  moral?: string;
}

type Phase = "waiting" | "streaming" | "complete";

function formatStory(story: StoryInput, { fadeTrailing }: { fadeTrailing: boolean }) {
  return (
    <>
      {story.paragraphs && story.paragraphs.length > 0 && (
        <div className="mt-3 space-y-3 border-t border-subtle pt-3">
          {story.paragraphs.map((paragraph, i) => (
            <p
              key={i}
              className={`text-sm leading-relaxed ${
                fadeTrailing && i === story.paragraphs!.length - 1
                  ? "text-tertiary"
                  : "text-primary"
              }`}
            >
              {paragraph}
            </p>
          ))}
        </div>
      )}
      {story.moral !== undefined && (
        <p className={`mt-3 border-t border-subtle pt-3 text-sm italic ${
          fadeTrailing ? "text-tertiary" : "text-secondary"
        }`}>
          Moral: {story.moral || "..."}
        </p>
      )}
    </>
  );
}

export default function App() {
  const [story, setStory] = useState<StoryInput | null>(null);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [data, setData] = useState<DemoData | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Streaming Tool Input", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app: McpApp) => {
      app.ontoolinputpartial = (params) => {
        setStory((params.arguments ?? null) as StoryInput | null);
        setPhase("streaming");
      };
      app.ontoolinput = (params) => {
        setStory((params.arguments ?? null) as StoryInput | null);
      };
      app.ontoolresult = (result) => {
        setData(result.structuredContent as unknown as DemoData);
        setPhase("complete");
      };
    },
  });

  if (error) {
    return <BasicsShell title="Streaming Tool Input" error={error} isConnected={false} />;
  }

  if (!app) {
    return <BasicsShell title="Streaming Tool Input" isConnected={false} />;
  }

  const phaseLabels: Record<Phase, string> = {
    waiting: "Waiting for model to call tool...",
    streaming: "Streaming input...",
    complete: "Complete",
  };
  const phaseTone: Record<Phase, "secondary" | "info" | "success"> = {
    waiting: "secondary",
    streaming: "info",
    complete: "success",
  };

  return (
    <BasicsShell
      title="Streaming Tool Input"
      description="Watch tool arguments render progressively as the model generates them."
      isConnected={true}
      badge={<Badge color={phaseTone[phase]}>{phaseLabels[phase]}</Badge>}
    >
      {!story ? (
        <StatusAlert
          tone="info"
          title="Waiting for streamed arguments"
          description="Ask ChatGPT to show streaming tool input, and this widget will preview the story fields as they arrive."
        />
      ) : null}

      {story ? (
        <div
          className={`mb-4 rounded-lg border p-4 ${
            phase === "streaming"
              ? "border-info bg-surface-secondary"
              : "border-subtle bg-surface-secondary"
          }`}
        >
          {story.title !== undefined ? (
            <h2 className="heading-md mb-1 text-primary">{story.title || "..."}</h2>
          ) : null}
          {story.author !== undefined ? (
            <p className="mb-1 text-sm text-secondary">
              by {story.author || "..."}
            </p>
          ) : null}
          {story.genre !== undefined ? (
            <p className="text-xs italic text-tertiary">{story.genre || "..."}</p>
          ) : null}
          {story.setting !== undefined ? (
            <p className="mb-3 text-xs text-secondary">
              Setting: {story.setting || "..."}
            </p>
          ) : null}
          {formatStory(story, { fadeTrailing: phase === "streaming" })}
        </div>
      ) : null}

      {story ? (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-medium uppercase text-secondary">
            Current streamed input
          </p>
          <CodeBlock language="json">{JSON.stringify(story, null, 2)}</CodeBlock>
        </div>
      ) : null}

      <CodeWalkthrough steps={data?.steps} />
    </BasicsShell>
  );
}
