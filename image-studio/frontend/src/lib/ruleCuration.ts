import { stripWrappedCodeFence } from "./textCleanup.ts";

// Request/response plumbing for the "curate-rules" AI mode: the model reads
// the approved rule set and proposes merges (several overlapping rules → one
// combined rule) and retirements (drop a duplicated or contradicted rule).
// Every proposal is reviewed in an explicit modal and decided by the user —
// curation never silently rewrites the approved set (CLAUDE.md 2.4).

// Budget on the approved rule set. Rules ride along on every critic review
// and both advisor channels, so an oversized set dilutes each rule's weight;
// the budget makes that cost visible instead of silently truncating.
export const RULE_BUDGET = 12;
// Soft threshold (80% of budget) where the panel starts nudging toward
// curation, mirroring how capacity-pressure curation works elsewhere.
export const RULE_BUDGET_WARN_AT = Math.ceil(RULE_BUDGET * 0.8);

const DEFAULT_MAX_FEEDBACK = 15;
const MAX_CURATION_PROPOSALS = 6;
// Feedback notes get the usual truncation; approved/rejected rule texts do
// NOT — the model must quote them exactly for replaces-matching to work.
const MAX_CONTEXT_FIELD_CHARS = 600;

function truncateForContext(text: string): string {
  if (text.length <= MAX_CONTEXT_FIELD_CHARS) return text;
  const half = Math.floor((MAX_CONTEXT_FIELD_CHARS - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

export interface RuleCurationRequestInput {
  approvedRules: readonly string[];
  rejectedRules: readonly string[];
  feedback: readonly {
    type: string;
    note?: string | null;
  }[];
  maxFeedback?: number;
}

export function buildRuleCurationRequestText(input: RuleCurationRequestInput): string {
  const maxFeedback = input.maxFeedback ?? DEFAULT_MAX_FEEDBACK;
  const feedbackCases = input.feedback
    .filter((event) => (event.note ?? "").trim() !== "")
    .slice(-maxFeedback)
    .map((event) => ({ type: event.type, note: truncateForContext(event.note ?? "") }));
  return JSON.stringify({
    schemaVersion: 1,
    operation: "curate-rules",
    approvedRules: [...input.approvedRules],
    rejectedRules: input.rejectedRules.map(truncateForContext),
    feedbackCases,
  });
}

export interface RuleCurationDraft {
  action: "merge" | "retire";
  rule: string | null;
  replaces: string[];
  reason: string | null;
}

export function parseRuleCurationResponse(raw: string): RuleCurationDraft[] {
  const text = stripWrappedCodeFence(String(raw ?? "").trim());
  if (!text) throw new Error("AI 返回了空响应");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI 返回的不是有效 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI 响应缺少 proposals 数组");
  }
  const proposals = (parsed as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals)) throw new Error("AI 响应缺少 proposals 数组");

  const drafts: RuleCurationDraft[] = [];
  for (const entry of proposals) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("AI 响应里有格式错误的提案条目");
    }
    const record = entry as { action?: unknown; rule?: unknown; replaces?: unknown; reason?: unknown };
    if (record.action !== "merge" && record.action !== "retire") {
      throw new Error("AI 响应里有未知的提案类型");
    }
    if (!Array.isArray(record.replaces)) {
      throw new Error("AI 响应里有缺少 replaces 数组的提案");
    }
    const replaces = record.replaces.map((value) => (typeof value === "string" ? value.trim() : ""));
    if (replaces.some((value) => value === "")) {
      throw new Error("AI 响应里有 replaces 文本为空的提案");
    }
    if (record.action === "merge") {
      if (typeof record.rule !== "string" || !record.rule.trim()) {
        throw new Error("AI 响应里有缺少合并后规则文本的提案");
      }
      if (replaces.length < 1) {
        throw new Error("AI 响应里有未指明被合并规则的提案");
      }
    } else {
      if (record.rule != null && (typeof record.rule !== "string" || record.rule.trim() !== "")) {
        throw new Error("AI 响应里有携带规则文本的废弃提案");
      }
      if (replaces.length !== 1) {
        throw new Error("AI 响应里有未指明单条目标规则的废弃提案");
      }
    }
    const reason = typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : null;
    drafts.push({
      action: record.action,
      rule: record.action === "merge" ? (record.rule as string).trim() : null,
      replaces,
      reason,
    });
  }
  return drafts.slice(0, MAX_CURATION_PROPOSALS);
}

// One reviewable proposal in the explicit curation modal. `candidateId` is
// what the decide action targets: the curated merge candidate for merges, or
// the existing approved candidate for retirements.
export interface RuleCurationReviewItem {
  key: string;
  action: "merge" | "retire";
  candidateId: string;
  rule: string;
  replaces: { candidateId: string; rule: string }[];
  reason: string | null;
}

export interface RuleCurationReview {
  items: RuleCurationReviewItem[];
}
