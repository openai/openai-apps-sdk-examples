import { EventEmitter } from "node:events";
import {
  AnswerCard,
  ChatMessage,
  GameState,
  JudgementResult,
  NextActionHint,
  Persona,
  Player,
  PromptCard,
} from "./shared-types.js";

interface InitializeNewGameAction {
  type: "INITIALIZE_NEW_GAME";
  players: PlayerInput[];
  firstPrompt: string;
}

interface DealReplacementCardsAction {
  type: "DEAL_REPLACEMENT_CARDS";
  replacementCards: Array<{ playerId: string; card: AnswerCard }>;
}

interface JudgingAction {
  type: "JUDGING";
}

interface AnnounceWinnerAction {
  type: "ANNOUNCE_WINNER";
  winnerId: string;
}

interface ReturnJudgementAction {
  type: "RETURN_JUDGEMENT";
  result: {
    judgeId: string;
    winningCardId: string;
    winningPlayerId: string;
    reactionToWinningCard?: string;
  };
}

interface PromptReceivedAction {
  type: "PROMPT_RECEIVED";
  prompt: PromptCard;
}

interface PrepareForNextRoundAction {
  type: "PREPARE_FOR_NEXT_ROUND";
}

interface PlayerPlayedAnswerCardAction {
  type: "PLAYER_PLAYED_ANSWER_CARD";
  playerId: string;
  cardId: string;
  playerComment?: string;
}

interface PostBanterAction {
  type: "POST_BANTER";
  messages: ChatMessage[];
}

type GameAction =
  | InitializeNewGameAction
  | DealReplacementCardsAction
  | JudgingAction
  | ReturnJudgementAction
  | PromptReceivedAction
  | PrepareForNextRoundAction
  | AnnounceWinnerAction
  | PlayerPlayedAnswerCardAction
  | PostBanterAction;

interface PlayerInput {
  id: string;
  name: string;
  type: "human" | "cpu";
  persona: Persona | null;
  answerCards: AnswerCard[];
}

interface GameInstanceOptions {
  players: PlayerInput[];
  firstPrompt: string;
}

export class GameInstance extends EventEmitter {
  /** A unique key for the game instance. This can be used later to join the game. */
  readonly key = generateKey();
  private readonly options: GameInstanceOptions;

  private state: GameState = {
    gameKey: this.key,
    prompt: null,
    playedAnswerCards: [],
    players: [],
    status: "initializing",
    currentJudgePlayerIndex: 0,
    answerCards: {},
    discardedPromptCards: [],
    judgementResult: null,
    winnerId: null,
    chatLog: [],
  };

  constructor(options: GameInstanceOptions) {
    super();
    this.options = options;
  }

  getState(): GameState {
    return this.state;
  }

  getNonJudgeHandTexts(): string[] {
    const judge = this.state.players[this.state.currentJudgePlayerIndex] ?? null;
    const texts: string[] = [];

    for (const player of this.state.players) {
      if (player.id === judge?.id) {
        continue;
      }
      for (const cardId of player.answerCards) {
        const card = this.state.answerCards[cardId];
        if (card) {
          texts.push(card.text);
        }
      }
    }

    return texts;
  }

  initializeNewGame() {
    this.dispatchAction({
      type: "INITIALIZE_NEW_GAME",
      players: this.options.players,
      firstPrompt: this.options.firstPrompt,
    });
  }

  playAnswerCard(playerId: string, cardId: string, playerComment?: string) {
    const player = this.state.players.find((entry) => entry.id === playerId);
    if (!player) {
      throw new Error(`Player ${playerId} not found`);
    }
    const judge = this.state.players[this.state.currentJudgePlayerIndex];
    if (judge?.id === playerId) {
      throw new Error(`Judge ${playerId} cannot play an answer card`);
    }
    if (this.state.status !== "waiting-for-answers") {
      throw new Error(
        `Cannot play answer card while game is ${this.state.status}`,
      );
    }
    if (
      this.state.playedAnswerCards.some(
        (played) => played.playerId === playerId,
      )
    ) {
      // Idempotent: already played, return silently
      return;
    }
    if (!player.answerCards.includes(cardId)) {
      throw new Error(
        `Player ${playerId} does not have this card in their hand`,
      );
    }

    this.dispatchAction({
      type: "PLAYER_PLAYED_ANSWER_CARD",
      playerId,
      cardId,
      playerComment,
    });

    // Auto-advance to judging if all cards are in
    if (this.state.playedAnswerCards.length === this.getExpectedAnswerCount()) {
      this.dispatchAction({ type: "JUDGING" });
    }
  }

  /**
   * Submit CPU answer card choices from ChatGPT.
   */
  submitCpuAnswers(choices: Array<{ playerId: string; cardId: string; playerComment?: string }>) {
    if (this.state.status !== "waiting-for-answers") {
      throw new Error(
        `Cannot submit CPU answers while game is ${this.state.status}`,
      );
    }
    const judge = this.state.players[this.state.currentJudgePlayerIndex];
    const cpuPlayers = this.state.players.filter(
      (player) => player.type === "cpu" && player.id !== judge?.id,
    );

    const choicesByPlayerId = new Map<string, typeof choices[number]>();
    for (const choice of choices) {
      choicesByPlayerId.set(choice.playerId, choice);
    }

    for (const player of cpuPlayers) {
      if (this.state.playedAnswerCards.some((played) => played.playerId === player.id)) {
        continue;
      }

      const choice = choicesByPlayerId.get(player.id);
      let cardIdToPlay: string | null = choice?.cardId ?? null;

      if (!cardIdToPlay || !player.answerCards.includes(cardIdToPlay)) {
        cardIdToPlay = pickRandomAnswerCardId(player.answerCards);
      }

      if (!cardIdToPlay) {
        continue;
      }

      const comment = sanitizeCpuComment(choice?.playerComment, player.persona?.name);
      this.playAnswerCard(player.id, cardIdToPlay, comment);
    }
  }

  /**
   * Submit CPU judgement from ChatGPT.
   */
  submitCpuJudgement(result: { winningCardId: string; reactionToWinningCard?: string }) {
    if (this.state.status !== "judging") {
      throw new Error(
        `Cannot submit CPU judgement while game is ${this.state.status}`,
      );
    }
    const playedAnswerCards = this.state.playedAnswerCards;

    let winningCardId = result.winningCardId;
    if (!findPlayedAnswerCard(playedAnswerCards, winningCardId)) {
      winningCardId = pickRandomPlayedCardId(playedAnswerCards) ?? winningCardId;
    }

    const winningEntry = findPlayedAnswerCard(playedAnswerCards, winningCardId);
    if (!winningEntry) {
      throw new Error("CPU judgement winning card not found in played answers");
    }

    const judge = this.state.players[this.state.currentJudgePlayerIndex];
    if (!judge) {
      throw new Error("No judge found");
    }
    if (judge.type === "human") {
      throw new Error("Cannot submit CPU judgement while waiting for the human judge");
    }

    const reaction = sanitizeCpuReaction(
      result.reactionToWinningCard,
      judge.persona?.name,
    );
    this.judgeAnswers({
      judgeId: judge.id,
      winningCardId,
      winningPlayerId: winningEntry.playerId,
      reactionToWinningCard: reaction,
    });
  }

  /**
   * Submit a prompt card from ChatGPT along with replacement cards.
   * Internally calls prepareForNextRound first, then sets the new prompt.
   */
  submitPrompt(promptText: string, replacementCards?: Array<{ playerId: string; card: AnswerCard }>) {
    if (this.state.status !== "display-judgement" && this.state.status !== "prepare-for-next-round") {
      throw new Error(
        `Cannot submit prompt while game is ${this.state.status}. Check nextAction for the correct tool to call.`,
      );
    }
    // Prepare for next round (clear played cards, rotate judge, etc.)
    this.dispatchAction({ type: "PREPARE_FOR_NEXT_ROUND" });

    // Deal replacement cards only to players who actually played (hand < 7 cards)
    // Re-key cards server-side to avoid duplicates from model-generated IDs
    if (replacementCards && replacementCards.length > 0) {
      const usedIds = new Set(Object.keys(this.state.answerCards));
      const filtered = replacementCards
        .filter((rc) => {
          const player = this.state.players.find((p) => p.id === rc.playerId);
          return player && player.answerCards.length < 7;
        })
        .map((rc) => {
          let id = rc.card.id;
          if (usedIds.has(id)) {
            id = `ans-${crypto.randomUUID().slice(0, 8)}`;
          }
          usedIds.add(id);
          return { ...rc, card: { ...rc.card, id } };
        });
      if (filtered.length > 0) {
        this.dispatchAction({ type: "DEAL_REPLACEMENT_CARDS", replacementCards: filtered });
      }
    }

    const prompt: PromptCard = {
      id: `prompt-${crypto.randomUUID()}`,
      type: "prompt",
      text: promptText.trim(),
    };
    this.dispatchAction({ type: "PROMPT_RECEIVED", prompt });
  }

  /**
   * Append banter messages to the chat log.
   */
  addBanter(messages: ChatMessage[]) {
    this.dispatchAction({ type: "POST_BANTER", messages });
  }

  /**
   * Builds the data package sent to the model when it needs to make CPU
   * decisions. Includes CPU player hands, the current prompt, already-played
   * cards, and judge info — everything the model needs to play in-character.
   * This is included in `structuredContent` and `content` (assistant-only)
   * when `nextAction.notifyModel` is true.
   */
  getCpuContext() {
    const judge = this.state.players[this.state.currentJudgePlayerIndex] ?? null;

    const cpuPlayers = this.state.players
      .filter(
        (player) =>
          player.type === "cpu" &&
          player.id !== judge?.id &&
          !this.state.playedAnswerCards.some(
            (played) => played.playerId === player.id,
          ),
      )
      .map((player) => ({
        id: player.id,
        name: player.persona?.name ?? "CPU",
        persona: player.persona,
        hand: player.answerCards
          .map((cardId) => {
            const card = this.state.answerCards[cardId];
            return card ? { id: card.id, text: card.text } : null;
          })
          .filter((card): card is { id: string; text: string } => card !== null),
      }));

    const playedAnswers = this.state.playedAnswerCards.map((played) => {
      const card = this.state.answerCards[played.cardId];
      return {
        cardId: played.cardId,
        text: card?.text ?? "",
      };
    });

    return {
      prompt: this.state.prompt ? { text: this.state.prompt.text } : null,
      cpuPlayers,
      playedAnswers: playedAnswers.length > 0 ? playedAnswers : undefined,
      previousPromptTexts: this.state.discardedPromptCards.map((p) => p.text),
      handTexts: this.getNonJudgeHandTexts(),
      judge: judge ? { id: judge.id, name: judge.persona?.name ?? "Unknown" } : null,
    };
  }

  /**
   * The routing brain. Returns a NextActionHint that tells the widget and
   * model what should happen next:
   * - `notifyModel: true` → model needs to act (CPU plays, CPU judges).
   *   The widget will sendMessage to prompt the model.
   * - `notifyModel: false` → waiting for human input (play card, judge,
   *   click "Next Round"). The widget just waits.
   */
  computeNextAction(): NextActionHint {
    const { status, players, currentJudgePlayerIndex, playedAnswerCards } = this.state;
    const judge = players[currentJudgePlayerIndex] ?? null;

    if (status === "announce-winner" || status === "game-ended") {
      const winner = players.find((p) => p.id === this.state.winnerId);
      return {
        action: "game-over",
        description: `Game over! ${winner?.persona?.name ?? "Someone"} wins with ${winner?.wonPromptCards.length ?? 0} points.`,
        notifyModel: false,
      };
    }

    if (status === "waiting-for-answers") {
      // Human plays FIRST
      const humanPlayerPending = players.some(
        (p) =>
          p.type === "human" &&
          p.id !== judge?.id &&
          !playedAnswerCards.some((played) => played.playerId === p.id),
      );

      if (humanPlayerPending) {
        return {
          action: "human-answer-pending",
          description: "Waiting for the human player to play an answer card.",
          notifyModel: false,
        };
      }

      // CPU players need to play
      const cpuPlayersWhoNeedToPlay = players.filter(
        (p) =>
          p.type === "cpu" &&
          p.id !== judge?.id &&
          !playedAnswerCards.some((played) => played.playerId === p.id),
      );

      if (cpuPlayersWhoNeedToPlay.length > 0) {
        const judgeIsHuman = judge?.type === "human";
        let description = "CPU players need to play answer cards.";
        if (judgeIsHuman) {
          description += " The human player is the judge this round — do NOT mention their hand cards. They will judge in the widget after cards are played.";
        }
        description += " Use the play-cpu-answer-cards tool now.";
        return { action: "play-cpu-answer-cards", description, notifyModel: true };
      }

      return null;
    }

    if (status === "judging") {
      if (judge?.type === "cpu") {
        return {
          action: "cpu-judge-answer-card",
          description: `${judge.persona?.name ?? "CPU judge"} needs to pick the winning card. Use the cpu-judge-answer-card tool now.`,
          notifyModel: true,
        };
      }

      return {
        action: "human-judge-pending",
        description: "Waiting for the human player to judge the cards.",
        notifyModel: false,
      };
    }

    if (status === "display-judgement") {
      // After judgement, check for winner
      const winner = players.find((p) => p.wonPromptCards.length >= 5);
      if (winner) {
        return {
          action: "game-over",
          description: `${winner.persona?.name ?? "Someone"} has won the game with ${winner.wonPromptCards.length} points!`,
          notifyModel: false,
        };
      }

      return {
        action: "wait-for-next-round",
        description: "Round complete. Wait for the human to click 'Next Round' before submitting a new prompt.",
        notifyModel: false,
      };
    }

    if (status === "prepare-for-next-round") {
      return {
        action: "submit-prompt",
        description: "Submit a new prompt card and replacement answer cards for the next round.",
        notifyModel: false,
      };
    }

    return null;
  }

  judgeAnswers(result: JudgementResult) {
    // Idempotent: if not in judging state, return silently
    if (this.state.status !== "judging") {
      return;
    }

    const currentJudge = this.state.players[this.state.currentJudgePlayerIndex];
    if (!currentJudge || currentJudge.id !== result.judgeId) {
      throw new Error(`Player ${result.judgeId} is not the current judge`);
    }

    this.dispatchAction({ type: "RETURN_JUDGEMENT", result });

    // Check for winner (first to 5 wins)
    const winner = this.state.players.find((p) => p.wonPromptCards.length >= 5);
    if (winner) {
      this.dispatchAction({ type: "ANNOUNCE_WINNER", winnerId: winner.id });
    }
  }

  private reducer(prevState: GameState, action: GameAction): GameState {
    switch (action.type) {
      case "INITIALIZE_NEW_GAME": {
        // Build answerCards map from all player hands
        const answerCards: Record<string, AnswerCard> = {};
        for (const playerInput of action.players) {
          for (const card of playerInput.answerCards) {
            answerCards[card.id] = card;
          }
        }

        // Create players from input
        const players: Player[] = action.players.map((playerInput) => ({
          id: playerInput.id,
          type: playerInput.type,
          persona: playerInput.persona ?? {
            id: playerInput.id,
            name: playerInput.name,
            personality: "",
            likes: [],
            dislikes: [],
            humorStyle: [],
            favoriteJokeTypes: [],
          },
          wonPromptCards: [],
          answerCards: playerInput.answerCards.map((card) => card.id),
        }));

        // Create first prompt
        const firstPrompt: PromptCard = {
          id: `prompt-${crypto.randomUUID()}`,
          type: "prompt",
          text: action.firstPrompt,
        };

        // Find first CPU player to be judge (human should never judge first)
        const firstCpuIndex = players.findIndex((p) => p.type === "cpu");
        const judgeIndex = firstCpuIndex >= 0 ? firstCpuIndex : 0;

        return {
          ...prevState,
          status: "waiting-for-answers",
          players,
          answerCards,
          prompt: firstPrompt,
          currentJudgePlayerIndex: judgeIndex,
        };
      }
      case "DEAL_REPLACEMENT_CARDS": {
        const newAnswerCards = { ...prevState.answerCards };
        const updatedPlayers = prevState.players.map((player) => {
          const replacement = action.replacementCards.find((r) => r.playerId === player.id);
          if (!replacement) return player;
          newAnswerCards[replacement.card.id] = replacement.card;
          return {
            ...player,
            answerCards: [...player.answerCards, replacement.card.id],
          };
        });
        return {
          ...prevState,
          answerCards: newAnswerCards,
          players: updatedPlayers,
        };
      }
      case "JUDGING": {
        return {
          ...prevState,
          status: "judging",
        };
      }
      case "RETURN_JUDGEMENT": {
        const prompt = prevState.prompt;
        const winningPlayerId = action.result.winningPlayerId;
        const players = prompt
          ? prevState.players.map((player) => {
              if (player.id === winningPlayerId) {
                return {
                  ...player,
                  wonPromptCards: Array.from(new Set([...player.wonPromptCards, prompt])),
                };
              }
              return player;
            })
          : prevState.players;
        return {
          ...prevState,
          status: "display-judgement",
          judgementResult: action.result,
          players,
        };
      }
      case "PREPARE_FOR_NEXT_ROUND": {
        const discardedPromptCards = prevState.prompt
          ? [...prevState.discardedPromptCards, prevState.prompt]
          : prevState.discardedPromptCards;
        return {
          ...prevState,
          status: "prepare-for-next-round",
          playedAnswerCards: [],
          discardedPromptCards,
          prompt: null,
          judgementResult: null,
          currentJudgePlayerIndex:
            (prevState.currentJudgePlayerIndex + 1) % prevState.players.length,
        };
      }
      case "ANNOUNCE_WINNER": {
        return {
          ...prevState,
          status: "announce-winner",
          winnerId: action.winnerId,
        };
      }
      case "PROMPT_RECEIVED": {
        return {
          ...prevState,
          status: "waiting-for-answers",
          prompt: action.prompt,
          playedAnswerCards: [],
        };
      }
      case "PLAYER_PLAYED_ANSWER_CARD": {
        return {
          ...prevState,
          playedAnswerCards: [
            ...prevState.playedAnswerCards,
            {
              playerId: action.playerId,
              cardId: action.cardId,
              playerComment: action.playerComment,
            },
          ],
          players: prevState.players.map((player) =>
            player.id === action.playerId
              ? {
                  ...player,
                  answerCards: player.answerCards.filter(
                    (cardId) => cardId !== action.cardId,
                  ),
                }
              : player,
          ),
        };
      }
      case "POST_BANTER": {
        return {
          ...prevState,
          chatLog: [...prevState.chatLog, ...action.messages],
        };
      }
      default: {
        return prevState;
      }
    }
  }

  private dispatchAction(action: GameAction) {
    this.state = this.reducer(this.state, action);
    this.emit("change", this.state);
  }

  private getExpectedAnswerCount() {
    const judge = this.state.players[this.state.currentJudgePlayerIndex];
    return this.state.players.reduce((count, player) => {
      if (player.id !== judge?.id) {
        return count + 1;
      }
      return count;
    }, 0);
  }
}

const keyLength = 8;
function generateKey() {
  return Math.random()
    .toString(36)
    .substring(2, keyLength + 2);
}

function sanitizeCpuComment(comment: string | undefined, fallbackName?: string | null) {
  if (typeof comment === "string" && comment.trim().length > 0) {
    return comment.trim();
  }
  const name = fallbackName ?? "CPU";
  return `${name} is feeling this one.`;
}

function sanitizeCpuReaction(reaction: string | undefined, fallbackName?: string | null) {
  if (typeof reaction === "string" && reaction.trim().length > 0) {
    return reaction.trim();
  }
  const name = fallbackName ?? "CPU";
  return `${name} picks this one.`;
}

function pickRandomAnswerCardId(answerCards: string[]) {
  if (!answerCards.length) {
    return null;
  }
  const index = Math.floor(Math.random() * answerCards.length);
  return answerCards[index];
}

function pickRandomPlayedCardId(playedAnswerCards: GameState["playedAnswerCards"]) {
  if (!playedAnswerCards.length) {
    return null;
  }
  const index = Math.floor(Math.random() * playedAnswerCards.length);
  return playedAnswerCards[index].cardId;
}

function findPlayedAnswerCard(
  playedAnswerCards: GameState["playedAnswerCards"],
  cardId: string,
) {
  for (const entry of playedAnswerCards) {
    if (entry.cardId === cardId) {
      return entry;
    }
  }
  return null;
}
