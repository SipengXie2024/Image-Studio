import type {
  PromptSuggestionDecision,
  PromptSuggestionOutcome,
  TasteFeedbackEvent,
} from "./tasteStorage.ts";

export interface SuggestionAdoptionStats {
  totalDecisions: number;
  accepted: number;
  modified: number;
  rejected: number;
  // Adopted suggestions whose generated batch is known (outcome link exists).
  linkedBatches: number;
  // Of those, batches where the user picked an image / rejected the whole batch.
  batchesPicked: number;
  batchesRejected: number;
}

// Answers "did batches generated from adopted suggestions do better?" by
// joining outcome links against the user's explicit feedback per batch.
export function computeSuggestionAdoptionStats(
  decisions: readonly PromptSuggestionDecision[],
  outcomes: readonly PromptSuggestionOutcome[],
  feedback: readonly TasteFeedbackEvent[],
): SuggestionAdoptionStats {
  const byBatch = new Map<string, { picked: boolean; rejected: boolean }>();
  for (const event of feedback) {
    const entry = byBatch.get(event.batchId) ?? { picked: false, rejected: false };
    // pick and edit are both explicit positive selections of an image.
    if (event.type === "pick" || event.type === "edit") entry.picked = true;
    if (event.type === "reject") entry.rejected = true;
    byBatch.set(event.batchId, entry);
  }

  const adoptedDecisionIds = new Set(
    decisions.filter((decision) => decision.decision !== "rejected").map((decision) => decision.id),
  );
  let linkedBatches = 0;
  let batchesPicked = 0;
  let batchesRejected = 0;
  for (const outcome of outcomes) {
    if (!adoptedDecisionIds.has(outcome.decisionId)) continue;
    linkedBatches += 1;
    const entry = byBatch.get(outcome.resultBatchId);
    if (entry?.picked) batchesPicked += 1;
    if (entry?.rejected) batchesRejected += 1;
  }

  return {
    totalDecisions: decisions.length,
    accepted: decisions.filter((decision) => decision.decision === "accepted").length,
    modified: decisions.filter((decision) => decision.decision === "modified").length,
    rejected: decisions.filter((decision) => decision.decision === "rejected").length,
    linkedBatches,
    batchesPicked,
    batchesRejected,
  };
}
