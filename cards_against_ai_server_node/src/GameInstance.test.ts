import assert from "node:assert/strict";
import { test } from "node:test";
import { GameInstance } from "./GameInstance.js";

test("CPU judgement cannot decide a round assigned to the human judge", () => {
  const game = new GameInstance({
    firstPrompt: "The answer is ____.",
    players: ["human", "cpu-1", "cpu-2", "cpu-3"].map((id) => ({
      id,
      name: id,
      type: id === "human" ? "human" : "cpu",
      persona: null,
      answerCards: Array.from({ length: 7 }, (_, index) => ({
        id: `${id}-${index}`,
        type: "answer",
        text: `Answer ${index}`,
      })),
    })),
  });
  game.initializeNewGame();

  const playRound = () => {
    const state = game.getState();
    const judge = state.players[state.currentJudgePlayerIndex];
    for (const player of state.players) {
      if (player.id !== judge.id) {
        game.playAnswerCard(player.id, player.answerCards[0]);
      }
    }
    assert.equal(game.getState().status, "judging");
  };

  // Advance through the three CPU judges using the normal public game methods.
  for (let round = 0; round < 3; round++) {
    playRound();
    assert.equal(game.computeNextAction()?.action, "cpu-judge-answer-card");
    game.submitCpuJudgement({ winningCardId: game.getState().playedAnswerCards[0].cardId });
    assert.equal(game.getState().status, "display-judgement");
    game.submitPrompt("The next answer is ____.");
  }

  playRound();
  assert.equal(game.computeNextAction()?.action, "human-judge-pending");
  const before = structuredClone(game.getState());
  const winningCard = before.playedAnswerCards[0];
  assert.throws(
    () => game.submitCpuJudgement({ winningCardId: winningCard.cardId }),
    /human judge/i,
  );
  assert.deepEqual(game.getState(), before);

  // The human can still submit their verdict afterward.
  game.judgeAnswers({
    judgeId: "human",
    winningCardId: winningCard.cardId,
    winningPlayerId: winningCard.playerId,
  });
  assert.equal(game.getState().status, "display-judgement");
  assert.equal(game.getState().judgementResult?.judgeId, "human");
});
