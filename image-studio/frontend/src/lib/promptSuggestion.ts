import { stripWrappedCodeFence, stripWrappedQuotes } from "./textCleanup.ts";
import type { PromptSuggestionDecision, TasteFeedbackEvent } from "./tasteStorage";

export interface PromptRetryOffer {
  batchId: string;
  originalPrompt: string;
  submittedPrompt: string;
  rejectNote: string;
  // Generation context of the rejected batch, so an adopted draft reruns with
  // the same reference images instead of silently dropping them.
  mode: "generate" | "edit";
  sourcePaths: string[];
  createdAt: number;
}

const DEFAULT_MAX_FEEDBACK = 5;
const DEFAULT_MAX_DECISIONS = 5;
// History entries can carry very long LLM-generated prompts; cap each field so
// one oversized record cannot permanently bloat every subsequent request.
const MAX_CONTEXT_FIELD_CHARS = 600;

function truncateForContext(text: string): string {
  if (text.length <= MAX_CONTEXT_FIELD_CHARS) return text;
  const half = Math.floor((MAX_CONTEXT_FIELD_CHARS - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

// Cap the rule count so a large approved-rule library cannot crowd out the
// actual task content in either channel that carries rules.
const MAX_APPROVED_RULES_IN_CONTEXT = 10;

// Shared normalization for approved rules riding along as request context:
// drop blanks, cap the count, truncate each rule. Idempotent, so callers may
// pre-compute the list to learn how many rules were actually applied.
export function prepareApprovedRulesForContext(rules: readonly string[]): string[] {
  return rules
    .map((rule) => rule.trim())
    .filter((rule) => rule !== "")
    .slice(0, MAX_APPROVED_RULES_IN_CONTEXT)
    .map(truncateForContext);
}

// Wraps the optimize-channel prompt with the user's approved taste rules as a
// clearly marked guidance section. The instruction on both request paths tells
// the model to bias toward the preferences and never copy the section into its
// output, so the rewritten prompt stays a plain image prompt.
export function withApprovedTastePreferences(
  prompt: string,
  rules: readonly string[],
): { text: string; appliedRuleCount: number } {
  const prepared = prepareApprovedRulesForContext(rules);
  if (prepared.length === 0) return { text: prompt, appliedRuleCount: 0 };
  const section = [
    "Approved taste preferences (guidance for the rewrite; do not copy this section into the output):",
    ...prepared.map((rule) => `- ${rule}`),
  ].join("\n");
  return { text: `${prompt}\n\n${section}`, appliedRuleCount: prepared.length };
}

// Makes the user's edit explicit instead of leaving the model to diff two long
// near-identical prompts: strip the common prefix/suffix and expose the change.
function computeEditDelta(draft: string, final: string): { removed: string; added: string } | null {
  if (draft === final) return null;
  let start = 0;
  const minLength = Math.min(draft.length, final.length);
  while (start < minLength && draft[start] === final[start]) start += 1;
  let draftEnd = draft.length;
  let finalEnd = final.length;
  while (draftEnd > start && finalEnd > start && draft[draftEnd - 1] === final[finalEnd - 1]) {
    draftEnd -= 1;
    finalEnd -= 1;
  }
  return {
    removed: truncateForContext(draft.slice(start, draftEnd)),
    added: truncateForContext(final.slice(start, finalEnd)),
  };
}

export interface PromptSuggestionRequestInput {
  offer: PromptRetryOffer;
  feedback: readonly TasteFeedbackEvent[];
  suggestionDecisions: readonly PromptSuggestionDecision[];
  approvedRules?: readonly string[];
  maxFeedback?: number;
  maxDecisions?: number;
}

export function buildPromptSuggestionRequestText(input: PromptSuggestionRequestInput): string {
  const { offer } = input;
  const maxFeedback = input.maxFeedback ?? DEFAULT_MAX_FEEDBACK;
  const maxDecisions = input.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  // The reject event for the current batch is surfaced separately as rejectReason.
  // Inputs arrive oldest-first from the storage layer (compareRecords), so the
  // newest N entries are the tail — no re-sort needed.
  const recentFeedback = input.feedback
    .filter((event) => (event.note ?? "").trim() !== "")
    .filter((event) => !(event.type === "reject" && event.batchId === offer.batchId))
    .slice(-maxFeedback)
    .reverse()
    .map((event) => ({ type: event.type, note: truncateForContext(event.note ?? ""), createdAt: event.createdAt }));
  const pastSuggestionDecisions = input.suggestionDecisions
    .slice(-maxDecisions)
    .reverse()
    .map((decision) => ({
      decision: decision.decision,
      draftPrompt: truncateForContext(decision.draftPrompt),
      finalPrompt: decision.finalPrompt === null ? null : truncateForContext(decision.finalPrompt),
      rejectNote: decision.rejectNote === null ? null : truncateForContext(decision.rejectNote),
      ...(decision.decision === "modified" && decision.finalPrompt !== null
        ? { editDelta: computeEditDelta(decision.draftPrompt, decision.finalPrompt) }
        : {}),
    }));
  return JSON.stringify({
    schemaVersion: 1,
    operation: "suggest",
    originalPrompt: offer.originalPrompt,
    rejectReason: offer.rejectNote,
    // Tells the model whether "参考图" phrases in the prompt refer to real
    // attached reference images that will be present again on the rerun.
    referenceImageCount: offer.sourcePaths.length,
    recentFeedback,
    pastSuggestionDecisions,
    approvedRules: prepareApprovedRulesForContext(input.approvedRules ?? []),
  });
}

export function parsePromptSuggestionResponse(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) throw new Error("建议响应为空");
  const text = stripWrappedQuotes(stripWrappedCodeFence(trimmed));
  if (!text) throw new Error("建议响应为空");
  return text;
}
