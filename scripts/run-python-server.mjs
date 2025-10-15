#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import process from "node:process";

const [, , scriptPath, ...scriptArgs] = process.argv;

if (!scriptPath) {
  console.error("Usage: node scripts/run-python-server.mjs <path-to-script> [args...]");
  process.exit(1);
}

const resolvedScript = resolve(process.cwd(), scriptPath);

if (!existsSync(resolvedScript)) {
  console.error(`Cannot find Python entry point at ${resolvedScript}`);
  process.exit(1);
}

const envPreferred = process.env.PYTHON || process.env.PYTHON_CMD;

function tokenizeCommand(value) {
  if (!value) {
    return [];
  }
  const matches = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches) {
    return [];
  }

  return matches
    .map((token) => {
      const trimmed = token.trim();
      if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
      }
      return trimmed;
    })
    .filter((token) => token.length > 0);
}

const candidates = [];

if (envPreferred) {
  const parsed = tokenizeCommand(envPreferred);
  if (parsed.length > 0) {
    candidates.push(parsed);
  }
}

candidates.push(
  ["python3", "-u"],
  ["python", "-u"],
  ["py", "-3", "-u"],
  ["py", "-u"],
);

const errors = [];

for (const candidate of candidates) {
  if (!candidate || candidate.length === 0) {
    continue;
  }
  const [cmd, ...baseArgs] = candidate;
  const result = spawnSync(cmd, [...baseArgs, resolvedScript, ...scriptArgs], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status === 0) {
    process.exit(0);
  }

  const reason = result.error?.message || `exit code ${result.status}`;
  errors.push(`${cmd} ${baseArgs.join(" ")}`.trim() + ` (${reason})`);
}

console.error("Unable to start Python interpreter. Tried:\n" + errors.map((e) => `  - ${e}`).join("\n"));
console.error("Set PYTHON or PYTHON_CMD env var to point at your interpreter if needed.");
process.exit(1);
