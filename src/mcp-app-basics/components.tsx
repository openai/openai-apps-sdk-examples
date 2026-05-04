import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { CodeBlock } from "@openai/apps-sdk-ui/components/CodeBlock";
import { LoadingIndicator } from "@openai/apps-sdk-ui/components/Indicator";
import { TextLink } from "@openai/apps-sdk-ui/components/TextLink";
import type { ReactNode } from "react";
import type { Step } from "./types";

type StatusTone = "info" | "success" | "warning" | "danger" | "caution";

export function BasicsShell({
  title,
  description,
  children = null,
  error,
  isConnected,
  isReady = true,
  waitingMessage = "Waiting for tool result...",
  expanded = false,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  error?: Error | null;
  isConnected: boolean;
  isReady?: boolean;
  waitingMessage?: string;
  expanded?: boolean;
  badge?: ReactNode;
}) {
  if (error) {
    return (
      <BasicsEmptyState
        tone="danger"
        title="Connection failed"
        description={error.message}
      />
    );
  }

  if (!isConnected) {
    return (
      <BasicsEmptyState
        tone="info"
        title="Connecting"
        description="Opening the MCP Apps bridge."
        loading
      />
    );
  }

  if (!isReady) {
    return (
      <BasicsEmptyState tone="info" title={waitingMessage} loading />
    );
  }

  return (
    <main
      className={
        expanded
          ? "min-h-screen w-full bg-surface p-4 text-primary sm:p-6"
          : "flex min-h-32 items-center justify-center bg-transparent p-4 text-primary"
      }
    >
      <section
        className={
          expanded
            ? "mx-auto w-full max-w-2xl"
            : "w-full max-w-2xl rounded-lg border border-default bg-surface p-4 shadow-sm sm:p-5"
        }
      >
        <header className="mb-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {badge}
            <h1 className="heading-lg text-primary">{title}</h1>
          </div>
          {description ? (
            <p className="text-sm leading-relaxed text-secondary">
              {description}
            </p>
          ) : null}
        </header>
        {children}
      </section>
    </main>
  );
}

function BasicsEmptyState({
  title,
  description,
  tone,
  loading = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  tone: StatusTone;
  loading?: boolean;
}) {
  return (
    <div className="flex min-h-32 items-center justify-center p-4 text-primary">
      <Alert
        color={tone}
        variant="soft"
        title={
          <span className="inline-flex items-center gap-2">
            {loading ? <LoadingIndicator size={16} /> : null}
            {title}
          </span>
        }
        description={description}
        className="w-full max-w-lg"
      />
    </div>
  );
}

export function StatusAlert({
  tone,
  title,
  description,
  className = "mb-3",
}: {
  tone: StatusTone;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <Alert
      color={tone}
      variant="soft"
      title={title}
      description={description}
      className={className}
    />
  );
}

export function CodeWalkthrough({
  steps,
  title = "See the code and explanation",
}: {
  steps?: Step[];
  title?: string;
}) {
  if (!steps?.length) {
    return null;
  }

  return (
    <details className="mt-5 border-t border-subtle pt-4">
      <summary className="cursor-pointer text-sm font-medium text-secondary hover:text-primary">
        {title}
      </summary>
      <ol className="mt-4 space-y-4">
        {steps.map((step) => (
          <li key={step.id} className="space-y-2">
            <div className="flex items-start gap-2">
              <Badge color="secondary" variant="soft" size="sm">
                {step.id}
              </Badge>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-primary">
                  {step.title}
                </h2>
                <p className="text-sm leading-relaxed text-secondary">
                  {step.summary}
                </p>
              </div>
            </div>
            {step.code ? (
              <CodeBlock className="text-xs" language="tsx">
                {step.code}
              </CodeBlock>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <TextLink
          href="https://developers.openai.com/apps-sdk/build/chatgpt-ui"
          forceExternal
        >
          Build ChatGPT UI
        </TextLink>
        <TextLink href="https://developers.openai.com/apps-sdk/reference" forceExternal>
          Apps SDK reference
        </TextLink>
        <TextLink
          href="https://openai.github.io/apps-sdk-ui/?path=/docs/overview-introduction--docs"
          forceExternal
        >
          Apps SDK UI
        </TextLink>
      </div>
    </details>
  );
}

export function KeyValueGrid({
  rows,
  className = "mb-4",
}: {
  rows: Array<{
    label: ReactNode;
    value: ReactNode;
    badge?: ReactNode;
  }>;
  className?: string;
}) {
  return (
    <dl
      className={`grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-2 text-sm ${className}`}
    >
      {rows.map((row, index) => (
        <div key={index} className="contents">
          <dt className="min-w-0 font-mono text-xs text-secondary">
            {row.label}
          </dt>
          <dd className="min-w-0 break-words font-mono text-sm text-primary">
            <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
              {row.value}
              {row.badge}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
