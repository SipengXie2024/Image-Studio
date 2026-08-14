import { stripWrappedCodeFence } from "./textCleanup.ts";

// Request/response plumbing for the "induce-rules" AI mode: the model reads
// the accumulated explicit-feedback history and proposes reusable critic
// rules. Proposals only ever become pending candidates — approval stays with
// the user (CLAUDE.md 2.2/2.4).

const DEFAULT_MAX_FEEDBACK = 30;
const DEFAULT_MAX_DECISIONS = 10;
const MAX_INDUCED_RULES = 5;
// Same cap rationale as promptSuggestion: one oversized stored prompt must not
// permanently bloat every induction request.
const MAX_CONTEXT_FIELD_CHARS = 600;

function truncateForContext(text: string): string {
  if (text.length <= MAX_CONTEXT_FIELD_CHARS) return text;
  const half = Math.floor((MAX_CONTEXT_FIELD_CHARS - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

export interface RuleInductionRequestInput {
  feedback: readonly {
    type: string;
    note?: string | null;
  }[];
  suggestionDecisions: readonly {
    decision: string;
    draftPrompt: string;
    finalPrompt?: string | null;
    rejectNote?: string | null;
  }[];
  approvedRules: readonly string[];
  rejectedRules: readonly string[];
  maxFeedback?: number;
  maxDecisions?: number;
}

export function buildRuleInductionRequestText(input: RuleInductionRequestInput): string {
  const maxFeedback = input.maxFeedback ?? DEFAULT_MAX_FEEDBACK;
  const maxDecisions = input.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  // Inputs arrive oldest-first from the storage layer, so the newest N entries
  // are the tail — no re-sort needed.
  const feedbackCases = input.feedback
    .filter((event) => (event.note ?? "").trim() !== "")
    .slice(-maxFeedback)
    .map((event) => ({ type: event.type, note: truncateForContext(event.note ?? "") }));
  const suggestionDecisions = input.suggestionDecisions
    .slice(-maxDecisions)
    .map((decision) => ({
      decision: decision.decision,
      draftPrompt: truncateForContext(decision.draftPrompt),
      finalPrompt: decision.finalPrompt == null ? null : truncateForContext(decision.finalPrompt),
      rejectNote: decision.rejectNote == null ? null : truncateForContext(decision.rejectNote),
    }));
  return JSON.stringify({
    schemaVersion: 1,
    operation: "induce-rules",
    feedbackCases,
    suggestionDecisions,
    approvedRules: input.approvedRules.map(truncateForContext),
    rejectedRules: input.rejectedRules.map(truncateForContext),
  });
}

export interface InducedRuleDraft {
  rule: string;
  evidence: string | null;
}

export function parseRuleInductionResponse(raw: string): InducedRuleDraft[] {
  const text = stripWrappedCodeFence(String(raw ?? "").trim());
  if (!text) throw new Error("AI 返回了空响应");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI 返回的不是有效 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI 响应缺少 rules 数组");
  }
  const rules = (parsed as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) throw new Error("AI 响应缺少 rules 数组");

  const drafts: InducedRuleDraft[] = [];
  for (const entry of rules) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("AI 响应里有格式错误的规则条目");
    }
    const record = entry as { rule?: unknown; evidence?: unknown };
    if (typeof record.rule !== "string" || !record.rule.trim()) {
      throw new Error("AI 响应里有缺少规则文本的条目");
    }
    const evidence = typeof record.evidence === "string" && record.evidence.trim()
      ? record.evidence.trim()
      : null;
    drafts.push({ rule: record.rule.trim(), evidence });
  }
  return drafts.slice(0, MAX_INDUCED_RULES);
}
