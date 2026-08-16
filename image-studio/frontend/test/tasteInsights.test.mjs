import assert from "node:assert/strict";
import test from "node:test";

const { computeSuggestionAdoptionStats } = await import("../src/lib/tasteInsights.ts");

function decision(id, kind) {
  return {
    id,
    batchId: "batch-old",
    originalPrompt: "hero",
    rejectNote: null,
    draftPrompt: "hero, brighter",
    finalPrompt: kind === "rejected" ? null : "hero, brighter",
    decision: kind,
    createdAt: 1,
  };
}

function feedbackEvent(batchId, type) {
  return {
    id: `${batchId}-${type}`,
    type,
    batchId,
    originalPrompt: "hero",
    submittedPrompt: "hero",
    itemId: null,
    imageIds: [],
    note: null,
    createdAt: 1,
  };
}

test("joins adopted suggestion outcomes with per-batch explicit feedback", () => {
  const decisions = [decision("d-1", "accepted"), decision("d-2", "modified"), decision("d-3", "rejected")];
  const outcomes = [
    { id: "o-1", decisionId: "d-1", resultBatchId: "batch-a", createdAt: 2 },
    { id: "o-2", decisionId: "d-2", resultBatchId: "batch-b", createdAt: 3 },
    { id: "o-3", decisionId: "d-ghost", resultBatchId: "batch-c", createdAt: 4 },
  ];
  const feedback = [
    feedbackEvent("batch-a", "pick"),
    feedbackEvent("batch-b", "reject"),
    feedbackEvent("batch-unrelated", "pick"),
  ];

  const stats = computeSuggestionAdoptionStats(decisions, outcomes, feedback);
  assert.deepEqual(stats, {
    totalDecisions: 3,
    accepted: 1,
    modified: 1,
    rejected: 1,
    linkedBatches: 2,
    batchesPicked: 1,
    batchesRejected: 1,
  });
});

test("treats edit feedback as a positive selection and handles empty inputs", () => {
  const stats = computeSuggestionAdoptionStats(
    [decision("d-1", "accepted")],
    [{ id: "o-1", decisionId: "d-1", resultBatchId: "batch-a", createdAt: 2 }],
    [feedbackEvent("batch-a", "edit")],
  );
  assert.equal(stats.batchesPicked, 1);
  assert.equal(stats.batchesRejected, 0);

  assert.deepEqual(computeSuggestionAdoptionStats([], [], []), {
    totalDecisions: 0,
    accepted: 0,
    modified: 0,
    rejected: 0,
    linkedBatches: 0,
    batchesPicked: 0,
    batchesRejected: 0,
  });
});
