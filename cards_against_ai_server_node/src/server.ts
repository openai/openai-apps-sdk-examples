/**
 * Cards Against AI MCP server (Node).
 *
 * Exposes game tools over MCP. All game state flows through tool responses.
 * Uses McpServer + StreamableHTTP + ext-apps (MCP Apps standard).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// ext-apps wrappers that add MCP Apps metadata (widget UI binding, CSP
// configuration) automatically when registering tools and resources.
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { GameInstance } from "./GameInstance.js";
import type { IntroDialogEntry } from "./shared-types.js";

// Use express from the SDK's own dependencies
import express from "express";
import cors from "cors";

interface GameRecord {
  id: string;
  key: string;
  instance: GameInstance;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");
// `ui://widget/...` tells ChatGPT which widget HTML to render in the iframe.
// `rules://` URIs are context documents the model reads before acting.
const TEMPLATE_URI = "ui://widget/cards-against-ai.html";
const RULES_URI = "rules://cards-against-ai";
const ANSWER_GUIDANCE_URI = "rules://cards-against-ai/answer-deck";
const MARKDOWN_MIME_TYPE = "text/markdown";
const RULES_PATH = path.resolve(
  ROOT_DIR,
  "cards_against_ai_server_node",
  "RULES.md",
);
const ANSWER_GUIDANCE_PATH = path.resolve(
  ROOT_DIR,
  "cards_against_ai_server_node",
  "ANSWER_DECK_GUIDANCE.md",
);

dotenv.config({ path: path.resolve(ROOT_DIR, ".env.local") });

// Single BASE_URL — both assets and API are served from the same origin.
const BASE_URL = normalizeBaseUrl(
  process.env.BASE_URL ??
    process.env.VITE_BASE_URL ??
    "",
);
const BASE_ORIGIN = parseOrigin(BASE_URL);

// The widget is fully self-contained (JS/CSS/images inlined into HTML), so no
// resourceDomains are needed. Only connectDomains for SSE game-state streaming.
const widgetCspDomains = {
  connectDomains: BASE_ORIGIN ? [BASE_ORIGIN] : ([] as string[]),
  resourceDomains: [] as string[],
};

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const gamesById = new Map<string, GameRecord>();

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function parseOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function findAssetFile(prefix: string, ext: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "pnpm run build" before starting the server.`,
    );
  }

  // Try exact name first (e.g. "cards-against-ai.js")
  const exact = path.join(ASSETS_DIR, `${prefix}${ext}`);
  if (fs.existsSync(exact)) return exact;

  // Try hashed name (e.g. "cards-against-ai-2d2b.js")
  const candidates = fs
    .readdirSync(ASSETS_DIR)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(ext) && !f.endsWith(`.${ext}.map`))
    .sort();
  const match = candidates[candidates.length - 1];
  if (match) return path.join(ASSETS_DIR, match);

  throw new Error(
    `Asset file "${prefix}*${ext}" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate assets.`,
  );
}

function readWidgetHtml(): string {
  const jsPath = findAssetFile("cards-against-ai", ".js");
  const cssPath = findAssetFile("cards-against-ai", ".css");

  const jsContent = fs.readFileSync(jsPath, "utf8");
  const cssContent = fs.readFileSync(cssPath, "utf8");

  const effectiveBaseUrl = BASE_URL ?? `http://localhost:${port}`;

  // Build a fully self-contained HTML page with all JS/CSS/images inlined.
  // This eliminates external asset loading from the ChatGPT iframe sandbox,
  // avoiding CSP/URL mismatch issues entirely.
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${cssContent}</style>
  <script>
    window.__APP_URL_CONFIG__ = ${JSON.stringify({
      apiBaseUrl: effectiveBaseUrl,
      assetsBaseUrl: effectiveBaseUrl,
    })};
  </script>
</head>
<body>
  <div id="cards-against-ai-root"></div>
  <script type="module">${jsContent}</script>
</body>
</html>`;
}

function readMarkdownFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Cards Against AI ${label} not found. Expected file ${filePath}.`,
    );
  }

  return fs.readFileSync(filePath, "utf8");
}

const widgetHtml = readWidgetHtml();
const rulesMarkdown = readMarkdownFile(RULES_PATH, "rules");
const answerGuidanceMarkdown = readMarkdownFile(
  ANSWER_GUIDANCE_PATH,
  "answer deck guidance",
);

// The tool descriptor links each game tool to its registered MCP UI resource.
const toolUiMeta = {
  ui: {
    resourceUri: TEMPLATE_URI,
  },
};

const answerCardOutputSchema = z.object({
  id: z.string(),
  type: z.literal("answer"),
  text: z.string(),
});
const promptCardOutputSchema = z.object({
  id: z.string(),
  type: z.literal("prompt"),
  text: z.string(),
});
const personaOutputSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    personality: z.string(),
    likes: z.array(z.string()),
    dislikes: z.array(z.string()),
    humorStyle: z.array(z.string()),
    favoriteJokeTypes: z.array(z.string()),
    catchphrase: z.string().optional(),
    quirks: z.array(z.string()).optional(),
    backstory: z.string().optional(),
    voiceTone: z.string().optional(),
    competitiveness: z.number().optional(),
  })
  .nullable();
const gameStateOutputSchema = z.object({
  gameKey: z.string(),
  prompt: promptCardOutputSchema.nullable(),
  playedAnswerCards: z.array(
    z.object({
      cardId: z.string(),
      playerId: z.string(),
      playerComment: z.string().optional(),
    }),
  ),
  players: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["human", "cpu"]),
      persona: personaOutputSchema,
      wonPromptCards: z.array(promptCardOutputSchema),
      answerCards: z.array(z.string()),
    }),
  ),
  status: z.enum([
    "initializing",
    "waiting-for-answers",
    "judging",
    "game-ended",
    "display-judgement",
    "prepare-for-next-round",
    "announce-winner",
  ]),
  winnerId: z.string().nullable(),
  currentJudgePlayerIndex: z.number().int(),
  answerCards: z.record(z.string(), answerCardOutputSchema),
  discardedPromptCards: z.array(promptCardOutputSchema),
  judgementResult: z
    .object({
      judgeId: z.string(),
      winningCardId: z.string(),
      winningPlayerId: z.string(),
      reactionToWinningCard: z.string().optional(),
    })
    .nullable(),
  chatLog: z.array(
    z.object({
      playerId: z.string(),
      playerName: z.string(),
      message: z.string(),
    }),
  ),
});
const nextActionOutputSchema = z.object({
  action: z.string(),
  description: z.string(),
  notifyModel: z.boolean(),
});
const cpuContextOutputSchema = z.object({
  prompt: z.object({ text: z.string() }).nullable(),
  cpuPlayers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      persona: personaOutputSchema,
      hand: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
  ),
  playedAnswers: z
    .array(z.object({ cardId: z.string(), text: z.string() }))
    .optional(),
  previousPromptTexts: z.array(z.string()),
  handTexts: z.array(z.string()),
  judge: z.object({ id: z.string(), name: z.string() }).nullable(),
});
const gameToolOutputSchema = {
  invocation: z.string(),
  gameId: z.string(),
  gameKey: z.string(),
  gameState: gameStateOutputSchema,
  nextAction: nextActionOutputSchema.optional(),
  cpuContext: cpuContextOutputSchema.optional(),
};

// registerAppTool accepts Zod shapes (not JSON Schema objects).
// The SDK converts these to JSON Schema for the model automatically.

const cpuPersonaParser = z.object({
  id: z.string(),
  name: z.string(),
  personality: z.string(),
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  humorStyle: z.array(z.string()),
  favoriteJokeTypes: z.array(z.string()),
  catchphrase: z.string().optional(),
  quirks: z.array(z.string()).optional(),
  backstory: z.string().optional(),
  voiceTone: z.string().optional(),
  competitiveness: z.number().min(1).max(10).optional(),
});

const answerCardParser = z.object({
  id: z.string(),
  type: z.literal("answer"),
  text: z.string(),
});

const introDialogEntryParser = z.object({
  playerId: z.string(),
  playerName: z.string(),
  dialog: z.string(),
});

const playerInputParser = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["human", "cpu"]),
  persona: cpuPersonaParser.optional(),
  answerCards: z.array(answerCardParser),
});

const startGameShape = {
  players: z.array(playerInputParser).min(4).max(4),
  firstPrompt: z.string(),
  introDialog: z.array(introDialogEntryParser),
};

const playAnswerCardShape = {
  gameId: z.string(),
  playerId: z.string(),
  cardId: z.string(),
};

const judgeAnswerCardShape = {
  gameId: z.string(),
  playerId: z.string(),
  winningCardId: z.string(),
};

const playCpuAnswerCardsShape = {
  gameId: z.string(),
  cpuAnswerChoices: z.array(
    z.object({
      playerId: z.string(),
      cardId: z.string(),
      playerComment: z.string().optional(),
    }),
  ),
};

const cpuJudgeAnswerCardShape = {
  gameId: z.string(),
  winningCardId: z.string(),
  reactionToWinningCard: z.string().optional(),
};

const replacementCardParser = z.object({
  playerId: z.string(),
  card: answerCardParser,
});

const submitPromptShape = {
  gameId: z.string(),
  promptText: z.string(),
  replacementCards: z.array(replacementCardParser),
};

// --- Game logic helpers ---

/**
 * The tool descriptor binds the widget through `ui.resourceUri`. Both `content`
 * and `structuredContent` are visible to the model; the widget reads
 * `structuredContent` through `callServerTool` responses and `ontoolresult`.
 */
function buildGameToolResponse(
  toolName: string,
  record: GameRecord,
  textContent: string,
) {
  const nextAction = record.instance.computeNextAction();
  const cpuContext = nextAction?.notifyModel
    ? record.instance.getCpuContext()
    : undefined;

  return {
    content: [{ type: "text" as const, text: textContent || "Done." }],
    structuredContent: {
      invocation: toolName,
      gameId: record.id,
      gameKey: record.key,
      gameState: record.instance.getState(),
      ...(nextAction ? { nextAction } : {}),
      ...(cpuContext ? { cpuContext } : {}),
    },
  };
}

function gameNotFoundError(toolName: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: "Unknown game id" }],
    structuredContent: {
      invocation: toolName,
    },
  };
}

function getGameRecord(gameId: string) {
  return gamesById.get(gameId) ?? null;
}

function formatIntroDialog(introDialog: IntroDialogEntry[]): string {
  if (introDialog.length === 0) {
    return "";
  }

  return introDialog
    .map((entry) => `**${entry.playerName}**: "${entry.dialog}"`)
    .join("\n\n");
}

function formatCpuAnswerQuips(
  choices: Array<{ playerId: string; cardId: string; playerComment?: string }>,
  instance: GameInstance,
): string {
  const state = instance.getState();
  const lines: string[] = [];

  for (const choice of choices) {
    const player = state.players.find((p) => p.id === choice.playerId);
    const name = player?.persona?.name ?? "CPU";
    const comment = choice.playerComment?.trim();

    if (comment) {
      lines.push(`**${name}** slaps down a card:\n"${comment}"`);
    } else {
      lines.push(`**${name}** plays a card silently.`);
    }
  }

  return lines.join("\n\n");
}

// --- Logging helper ---

function logToolCall(toolName: string, args: unknown, result: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ===== TOOL CALL: ${toolName} =====`);
  console.log(`[${timestamp}] INPUT:`, JSON.stringify(args, null, 2));
  console.log(`[${timestamp}] OUTPUT:`, JSON.stringify(result, null, 2));
  console.log(`[${timestamp}] ===== END: ${toolName} =====\n`);
}

// --- Server creation ---

// Tool annotations hint to ChatGPT whether to show a confirmation dialog
// before calling the tool. Setting readOnlyHint: true tells ChatGPT the tool
// is safe to call without asking the user first.
const toolAnnotations = {
  readOnlyHint: true as const,
  destructiveHint: false as const,
  openWorldHint: false as const,
};

// Creates a fresh McpServer per request (stateless pattern). Game state lives
// in the `gamesById` map, not in the MCP session — so the server doesn't need
// to track which client is connected.
function createCardsAgainstAiServer(): McpServer {
  const server = new McpServer(
    {
      name: "cards-against-ai-node",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  // --- Register resources ---

  // The widget HTML is served as an MCP resource so ChatGPT can fetch and
  // render it in an iframe. CSP metadata tells the iframe which external
  // domains to allow for network requests and script/image loading.
  registerAppResource(
    server,
    "Cards Against AI widget",
    TEMPLATE_URI,
    {
      description: "Cards Against AI widget markup",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: TEMPLATE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              csp: {
                connectDomains: widgetCspDomains.connectDomains,
                resourceDomains: widgetCspDomains.resourceDomains,
              },
            },
          },
        },
      ],
    }),
  );

  // `rules://` resources are context documents. ChatGPT reads these before
  // the game starts to understand the rules and card creation guidelines.
  // They aren't displayed in the UI — they inform the model's behavior.
  registerAppResource(
    server,
    "Cards Against AI rules",
    RULES_URI,
    {
      description: "Cards Against AI game rules",
      mimeType: MARKDOWN_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: RULES_URI,
          mimeType: MARKDOWN_MIME_TYPE,
          text: rulesMarkdown,
        },
      ],
    }),
  );

  registerAppResource(
    server,
    "Cards Against AI answer deck guidance",
    ANSWER_GUIDANCE_URI,
    {
      description: "Guidance for crafting the answer deck",
      mimeType: MARKDOWN_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: ANSWER_GUIDANCE_URI,
          mimeType: MARKDOWN_MIME_TYPE,
          text: answerGuidanceMarkdown,
        },
      ],
    }),
  );

  // --- Register tools ---
  // Tools registered with `registerAppTool` automatically get MCP Apps
  // metadata (widget binding, display hints) added to their responses.

  registerAppTool(
    server,
    "start-game",
    {
      title: "Start a Cards Against AI game",
      description:
        "Creates a new game instance and returns its gameId/gameKey along with the initial gameState. Provide exactly 4 players (1 human + 3 CPU recommended). Each player needs: id, name, type ('human' or 'cpu'), answerCards (7 cards each), and persona (required for CPU, optional for human). Persona supports optional fields for richer characters: catchphrase (signature phrase), quirks (behavioral tics), backstory (1-2 sentences), voiceTone ('sarcastic', 'enthusiastic', etc.), and competitiveness (1-10 scale). Populate these richly for CPU players. The firstPrompt is the first round's prompt card text (must contain ____). The introDialog array contains role-played introductions from each CPU character. The response includes gameState and nextAction — use nextAction to determine what tool to call next. First to 5 wins! Full rules are in rules://cards-against-ai. Answer card guidance in rules://cards-against-ai/answer-deck.",
      inputSchema: startGameShape,
      outputSchema: gameToolOutputSchema,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      if (!args.firstPrompt.includes("____")) {
        const result = {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "firstPrompt must contain ____ (four underscores) for the blank.",
            },
          ],
        };
        logToolCall("start-game", args, result);
        return result;
      }

      const gameId = randomUUID();
      const instance = new GameInstance({
        players: args.players.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          persona: p.persona ?? null,
          answerCards: p.answerCards,
        })),
        firstPrompt: args.firstPrompt,
      });
      instance.initializeNewGame();

      const gameKey = instance.key;
      const record = { id: gameId, key: gameKey, instance };
      gamesById.set(gameId, record);

      const introTextContent = formatIntroDialog(args.introDialog);
      const result = buildGameToolResponse("start-game", record, introTextContent);
      logToolCall("start-game", args, result);
      return result;
    },
  );

  registerAppTool(
    server,
    "play-answer-card",
    {
      title: "Play an answer card",
      description:
        "Plays an answer card from the human player's hand. The human will provide gameId, playerId, and cardId via chat. Returns updated gameState and nextAction. CRITICAL: You MUST always check nextAction in the response and call the indicated tool immediately. If nextAction is 'play-cpu-answer-cards', you MUST call play-cpu-answer-cards as your very next tool call or the game will stall.",
      inputSchema: playAnswerCardShape,
      outputSchema: gameToolOutputSchema,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) {
        const result = gameNotFoundError("play-answer-card");
        logToolCall("play-answer-card", args, result);
        return result;
      }

      try {
        record.instance.playAnswerCard(args.playerId, args.cardId);
      } catch (error) {
        const result = {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to play answer card.",
            },
          ],
        };
        logToolCall("play-answer-card", args, result);
        return result;
      }

      const result = buildGameToolResponse("play-answer-card", record, "");
      logToolCall("play-answer-card", args, result);
      return result;
    },
  );

  registerAppTool(
    server,
    "judge-answer-card",
    {
      title: "Judge the winning answer card",
      description:
        "Records the human judge's winning card choice. The human will provide gameId, playerId, and winningCardId via chat. Returns updated gameState and nextAction.",
      inputSchema: judgeAnswerCardShape,
      outputSchema: gameToolOutputSchema,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) {
        const result = gameNotFoundError("judge-answer-card");
        logToolCall("judge-answer-card", args, result);
        return result;
      }

      const state = record.instance.getState();
      const playedCard = state.playedAnswerCards.find(
        (played) => played.cardId === args.winningCardId,
      );
      if (!playedCard) {
        const result = {
          isError: true as const,
          content: [{ type: "text" as const, text: "Winning card not found in played cards." }],
        };
        logToolCall("judge-answer-card", args, result);
        return result;
      }

      try {
        record.instance.judgeAnswers({
          judgeId: args.playerId,
          winningCardId: args.winningCardId,
          winningPlayerId: playedCard.playerId,
        });
      } catch (error) {
        const result = {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to judge answer card.",
            },
          ],
        };
        logToolCall("judge-answer-card", args, result);
        return result;
      }

      const result = buildGameToolResponse("judge-answer-card", record, "");
      logToolCall("judge-answer-card", args, result);
      return result;
    },
  );

  registerAppTool(
    server,
    "play-cpu-answer-cards",
    {
      title: "CPU players play answer cards",
      description:
        "When nextAction.action === 'play-cpu-answer-cards', use this tool to submit CPU player card selections. Provide cpuAnswerChoices with playerId, cardId, and optional playerComment for each CPU player. Read CPU persona details and card hands from structuredContent.cpuContext in the previous response. CRITICAL: After receiving the response, if the current judge is a CPU, you MUST call cpu-judge-answer-card IMMEDIATELY as your very next tool call. In your response text, write a brief in-character quip from each CPU player as they play their card (1-2 sentences each, using persona details). Occasionally reference or tease the human player by name. Returns updated gameState and nextAction.",
      inputSchema: playCpuAnswerCardsShape,
      outputSchema: gameToolOutputSchema,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) {
        const result = gameNotFoundError("play-cpu-answer-cards");
        logToolCall("play-cpu-answer-cards", args, result);
        return result;
      }

      try {
        record.instance.submitCpuAnswers(args.cpuAnswerChoices);
      } catch (error) {
        const result = {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to play CPU answer cards.",
            },
          ],
        };
        logToolCall("play-cpu-answer-cards", args, result);
        return result;
      }

      const answerQuips = formatCpuAnswerQuips(args.cpuAnswerChoices, record.instance);
      const result = buildGameToolResponse("play-cpu-answer-cards", record, answerQuips);
      logToolCall("play-cpu-answer-cards", args, result);
      return result;
    },
  );

  registerAppTool(
    server,
    "cpu-judge-answer-card",
    {
      title: "CPU judge picks the winning answer card",
      description:
        "When nextAction.action === 'cpu-judge-answer-card', you MUST call this tool immediately — the game will stall if you don't. Submit the CPU judge's verdict with winningCardId and optional reactionToWinningCard. Read the played answer cards from structuredContent.cpuContext in the previous response. In your response text, narrate the judge's dramatic reveal and have 1-2 other players react (groans, celebrations, accusations). Reference the human player sometimes — tease their card, congratulate them, etc. Returns updated gameState and nextAction.",
      inputSchema: cpuJudgeAnswerCardShape,
      outputSchema: gameToolOutputSchema,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) {
        const result = gameNotFoundError("cpu-judge-answer-card");
        logToolCall("cpu-judge-answer-card", args, result);
        return result;
      }

      const stateBefore = record.instance.getState();
      const judge = stateBefore.players[stateBefore.currentJudgePlayerIndex];
      const judgeName = judge?.persona?.name ?? "The Judge";

      try {
        record.instance.submitCpuJudgement({
          winningCardId: args.winningCardId,
          reactionToWinningCard: args.reactionToWinningCard,
        });
      } catch (error) {
        const result = {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to submit CPU judgement.",
            },
          ],
        };
        logToolCall("cpu-judge-answer-card", args, result);
        return result;
      }

      const stateAfter = record.instance.getState();
      const winningCard = stateAfter.answerCards[args.winningCardId];
      const winningPlayer = stateAfter.players.find(
        (p) => p.id === stateAfter.judgementResult?.winningPlayerId,
      );
      const winnerName = winningPlayer?.persona?.name ?? "Someone";
      const cardText = winningCard?.text ?? "???";
      const reaction = args.reactionToWinningCard?.trim() ?? "This one wins!";
      const textContent = `**${judgeName}** picks up a card and announces:\n\n"${cardText}"\n\n*${reaction}*\n\n**${winnerName}** wins this round!`;

      const result = buildGameToolResponse("cpu-judge-answer-card", record, textContent);
      logToolCall("cpu-judge-answer-card", args, result);
      return result;
    },
  );

  registerAppTool(
    server,
    "submit-prompt",
    {
      title: "Submit a prompt card for the round",
      description:
        "When nextAction.action === 'submit-prompt', provide a new prompt card and replacement answer cards. Only callable when the game is in display-judgement or prepare-for-next-round status — calling at other times will return an error with the correct nextAction. The promptText must include exactly one blank (____). The replacementCards array should include one new answer card for each player who played last round (not the judge). In your response text, include brief between-round banter from 1-2 CPU players. Address the human player occasionally. Returns updated gameState and nextAction.",
      inputSchema: submitPromptShape,
      outputSchema: gameToolOutputSchema,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) {
        const result = gameNotFoundError("submit-prompt");
        logToolCall("submit-prompt", args, result);
        return result;
      }

      if (!args.promptText.includes("____")) {
        const result = {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "promptText must contain ____ (four underscores) for the blank.",
            },
          ],
        };
        logToolCall("submit-prompt", args, result);
        return result;
      }

      try {
        record.instance.submitPrompt(args.promptText, args.replacementCards);
      } catch (error) {
        const nextAction = record.instance.computeNextAction();
        const result = {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `${error instanceof Error ? error.message : "Failed to submit prompt."} Current nextAction: ${JSON.stringify(nextAction)}`,
            },
          ],
        };
        logToolCall("submit-prompt", args, result);
        return result;
      }

      const result = buildGameToolResponse("submit-prompt", record, "");
      logToolCall("submit-prompt", args, result);
      return result;
    },
  );

  return server;
}

// --- HTTP server using Express + StreamableHTTP ---

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(ASSETS_DIR));

// MCP JSON-RPC endpoint. Each request gets a fresh server + transport.
// `sessionIdGenerator: undefined` disables server-side sessions (stateless).
// `enableJsonResponse: true` returns JSON instead of SSE streams.
app.post("/mcp", async (req, res) => {
  const body = req.body;
  const method = Array.isArray(body) ? body.map((m: { method?: string }) => m.method).join(", ") : body?.method;
  console.log(`[mcp] POST /mcp — method: ${method}`);

  const server = createCardsAgainstAiServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Required by the MCP protocol for SSE-based transports. ChatGPT may use GET
// for server-sent events during the MCP handshake.
app.get("/mcp", async (req, res) => {
  const server = createCardsAgainstAiServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

// MCP protocol expects this endpoint. We return 405 because we're stateless
// (no sessions to delete).
app.delete("/mcp", async (_req, res) => {
  res.status(405).end();
});

// --- Custom SSE endpoint (separate from MCP) ---
// The widget opens an EventSource here after learning the gameId.
// GameInstance emits "change" on every state mutation, which pushes the
// full game state to the widget in real-time. This is NOT part of the MCP
// protocol — it's a custom endpoint for widget ↔ server real-time sync.

app.get("/mcp/game/:gameId/state-stream", (req, res) => {
  const record = getGameRecord(req.params.gameId);
  if (!record) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const sendState = () => {
    const nextAction = record.instance.computeNextAction();
    const cpuContext = nextAction?.notifyModel
      ? record.instance.getCpuContext()
      : undefined;
    const data = JSON.stringify({
      gameState: record.instance.getState(),
      nextAction,
      ...(cpuContext ? { cpuContext } : {}),
    });
    res.write(`data: ${data}\n\n`);
  };

  // Send current state immediately
  sendState();

  // Push on every change
  record.instance.on("change", sendState);

  req.on("close", () => {
    record.instance.removeListener("change", sendState);
  });
});

app.get("/health", (_req, res) => {
  res.json({
    baseUrl: BASE_URL,
    baseOrigin: BASE_ORIGIN,
    csp: widgetCspDomains,
    widgetHtmlLength: widgetHtml.length,
  });
});

app.listen(port, () => {
  console.log(
    `Cards Against AI MCP server listening on http://localhost:${port}`,
  );
  console.log(`  MCP endpoint: POST http://localhost:${port}/mcp`);
  console.log(`  Static assets: http://localhost:${port}/ (from ${ASSETS_DIR})`);
  if (BASE_URL) {
    console.log(`  BASE_URL: ${BASE_URL}`);
  }
});
