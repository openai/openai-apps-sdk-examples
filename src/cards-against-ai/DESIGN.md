# Cards Against AI — Architecture

## MCP Apps Protocol

Uses `@modelcontextprotocol/ext-apps` — widget communicates via `postMessage` (JSON-RPC), not `window.openai` globals.

## Data Channels

Hybrid approach — two mechanisms for widget→server communication, plus SSE for state delivery:

1. **`callServerTool`** — direct tool calls that bypass the model. Used for `play-answer-card` and `judge-answer-card`. No confirmation dialog, instant execution.
2. **`sendFollowUp`** — helper that prefers `window.openai.sendFollowUpMessage` (scrolls to bottom) with fallback to `app.sendMessage`. Routes through the model. Triggered when `nextAction.notifyModel` is `true` (e.g. after play-answer-card when CPU needs to act). Also used for `submit-prompt` (next round button) and the watchdog timer.
3. **SSE** (`/mcp/game/:gameId/state-stream`) — server pushes full `gameState` on every state change. Single `EventSource` per game, opened when `gameId` is known.

`ontoolresult` is kept solely for bootstrapping: it delivers the initial `gameId` from `start-game`, which opens the SSE connection. Game state stays on the server and is returned in `structuredContent`; the server does not assign `openai/widgetSessionId` because the host provides that value.

## Game Loop

```
Human clicks answer card
  → widget calls callServerTool("play-answer-card") → server updates state → SSE pushes
  → if nextAction.notifyModel: widget sends sendMessage → LLM calls play-cpu-answer-cards → SSE pushes
    → if nextAction is cpu-judge-answer-card: LLM calls cpu-judge-answer-card → SSE pushes
  → if nextAction is human-judge-pending: widget shows judge UI (via SSE state)

Human judges card
  → widget calls callServerTool("judge-answer-card") → server updates state → SSE pushes
  → if nextAction.notifyModel: widget sends sendMessage (currently no cases, but future-proof)

Human clicks "Next Round"
  → widget sends sendMessage("Call submit-prompt for gameId=...")
  → LLM calls submit-prompt → server updates state → SSE pushes
```

## MCP Tools

| Tool | Initiator | Purpose |
|------|-----------|---------|
| `start-game` | LLM | Create game with players, cards, first prompt |
| `play-answer-card` | Widget (callServerTool) | Human plays a card (idempotent) |
| `judge-answer-card` | Widget (callServerTool) | Human judge picks winner (idempotent) |
| `play-cpu-answer-cards` | LLM (via sendMessage) | CPU players play their answer cards |
| `cpu-judge-answer-card` | LLM (via sendMessage) | CPU judge picks the winning card |
| `submit-prompt` | LLM (via sendMessage) | New prompt + replacement cards for next round |

## Human as Judge

When the human is the judge, the game loop differs:

1. After `submit-prompt`, `nextAction` is `play-cpu-answer-cards` (not `human-answer-pending`).
2. `cpuContext` is included in the response so the model immediately calls `play-cpu-answer-cards`.
3. All CPU players play their cards, then the human judges via the widget UI.
4. No `sendMessage` needed from the widget — the model acts on the tool response directly.

## CPU Dialog

CPU dialog is generated inline by the model in its response text — there is no separate banter tool. Tool descriptions instruct the model to write in-character quips, reactions, and between-round banter alongside each game action.
