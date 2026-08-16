import type { HistoryItem } from "../types/domain";

export type TasteCandidateStatus = "pending" | "approved" | "rejected";
export type TasteCandidateKind = "style-request" | "negative-constraint" | "feedback";
export type FeedbackEventType = "pick" | "reject" | "edit" | "note";

export type TasteHistoryItem = Pick<
  HistoryItem,
  "id" | "prompt" | "revisedPrompt" | "styleTag" | "negativePrompt" | "createdAt"
>;

export interface HistoryTasteSource {
  type: "history";
  signal: "style-tag" | "negative-prompt";
  itemIds: string[];
  inference: "requested-not-liked";
}

export interface FeedbackTasteSource {
  type: "feedback";
  eventKey: string;
  eventType: FeedbackEventType;
  itemId?: string;
  run?: string;
  image?: string;
  verbatimNote?: string;
  tags: string[];
  inference: "explicit-feedback";
}

export interface InducedTasteSource {
  type: "induced";
  proposalId: string;
  evidence?: string;
  inference: "ai-induced";
}

// A merge proposal from AI rule curation: one combined rule that, once the
// user approves it, supersedes the approved rules listed in `replaces`.
export interface CuratedTasteSource {
  type: "curated";
  proposalId: string;
  replaces: { candidateId: string; rule: string }[];
  reason?: string;
  inference: "ai-curated";
}

export interface TasteCandidate {
  schemaVersion: 1;
  id: string;
  status: TasteCandidateStatus;
  target: "critic";
  kind: TasteCandidateKind;
  rule: string;
  // Set when the rule text was polished after generation; collectTasteProfile
  // preserves refined text instead of regenerating the raw template.
  refined?: "ai" | "user";
  source: HistoryTasteSource | FeedbackTasteSource | InducedTasteSource | CuratedTasteSource;
}

export interface TasteFeedbackEvent {
  id?: string;
  caseId?: string;
  eventIndex?: number;
  type: FeedbackEventType;
  itemId?: string;
  run?: string;
  image?: string;
  note?: string;
  tags?: readonly string[];
}

export interface ApprovedCriticRule {
  candidateId: string;
  rule: string;
  sourceType: "history" | "feedback" | "induced" | "curated";
}

export interface ApprovedCriticRulesSnapshot {
  schemaVersion: 1;
  target: "critic";
  version: string;
  rules: ApprovedCriticRule[];
}

interface HistorySignalGroup {
  kind: "style-request" | "negative-constraint";
  signal: "style-tag" | "negative-prompt";
  canonicalValue: string;
  displayValues: Set<string>;
  itemIds: Set<string>;
}

const encoder = new TextEncoder();

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function canonicalText(value: unknown): string {
  return compactText(value).normalize("NFC").toLowerCase();
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of encoder.encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function stableCandidateId(identity: readonly unknown[]): string {
  return `taste-${stableHash(JSON.stringify(identity))}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function historyRule(group: HistorySignalGroup, value: string): string {
  if (group.kind === "style-request") {
    return `评审候选图时检查其是否符合用户明确请求的风格标签：${value}`;
  }
  return `评审候选图时降低包含以下用户明确排除项的结果：${value}`;
}

export function assertPromptByteIdentity(originalPrompt: string, submittedPrompt: string): void {
  if (typeof originalPrompt !== "string" || typeof submittedPrompt !== "string") {
    throw new TypeError("originalPrompt and submittedPrompt must be strings");
  }

  const originalBytes = encoder.encode(originalPrompt);
  const submittedBytes = encoder.encode(submittedPrompt);
  if (originalPrompt !== submittedPrompt || originalBytes.length !== submittedBytes.length) {
    throw new Error("submitted prompt differs from the original prompt");
  }
  for (let index = 0; index < originalBytes.length; index += 1) {
    if (originalBytes[index] !== submittedBytes[index]) {
      throw new Error("submitted prompt differs from the original prompt");
    }
  }
}

export function extractColdStartTasteCandidates(
  history: readonly TasteHistoryItem[],
): TasteCandidate[] {
  const groups = new Map<string, HistorySignalGroup>();

  const addSignal = (
    item: TasteHistoryItem,
    kind: HistorySignalGroup["kind"],
    signal: HistorySignalGroup["signal"],
    rawValue: unknown,
  ) => {
    const displayValue = compactText(rawValue);
    const canonicalValue = canonicalText(rawValue);
    if (!displayValue || !canonicalValue) return;

    const key = `${signal}:${canonicalValue}`;
    const existing = groups.get(key);
    if (existing) {
      existing.displayValues.add(displayValue);
      existing.itemIds.add(item.id);
      return;
    }
    groups.set(key, {
      kind,
      signal,
      canonicalValue,
      displayValues: new Set([displayValue]),
      itemIds: new Set([item.id]),
    });
  };

  for (const item of history) {
    addSignal(item, "style-request", "style-tag", item.styleTag);
    addSignal(item, "negative-constraint", "negative-prompt", item.negativePrompt);
  }

  return Array.from(groups.values())
    .map((group): TasteCandidate => {
      const displayValue = Array.from(group.displayValues).sort(compareText)[0];
      const itemIds = Array.from(group.itemIds).sort(compareText);
      return {
        schemaVersion: 1,
        id: stableCandidateId(["history", group.signal, group.canonicalValue]),
        status: "pending",
        target: "critic",
        kind: group.kind,
        rule: historyRule(group, displayValue),
        source: {
          type: "history",
          signal: group.signal,
          itemIds,
          inference: "requested-not-liked",
        },
      };
    })
    .sort((left, right) => compareText(left.id, right.id));
}

function normalizedTags(tags: readonly string[] | undefined): string[] {
  return Array.from(new Set((tags ?? []).map(compactText).filter(Boolean))).sort(compareText);
}

function feedbackRule(type: FeedbackEventType, note: string, tags: readonly string[]): string {
  const evidence = note || tags.join("、");
  if (type === "pick") return `评审候选图时关注用户明确肯定的特征：${evidence}`;
  if (type === "reject") return `评审候选图时降低出现以下用户否决原因的结果：${evidence}`;
  if (type === "edit") return `评审候选图时检查是否满足以下用户修改意见：${evidence}`;
  return `评审候选图时考虑以下用户评语：${evidence}`;
}

export function feedbackEventToTasteCandidate(event: TasteFeedbackEvent): TasteCandidate | null {
  const note = compactText(event.note);
  const tags = normalizedTags(event.tags);
  if (!note && tags.length === 0) return null;

  const eventIdentity = [
    "event",
    event.id ?? "",
    event.caseId ?? "",
    event.eventIndex ?? null,
    event.type,
    event.itemId ?? "",
    event.run ?? "",
    event.image ?? "",
    canonicalText(note),
    tags,
  ];
  const eventKey = stableHash(JSON.stringify(eventIdentity));

  return {
    schemaVersion: 1,
    id: stableCandidateId(["feedback", eventKey]),
    status: "pending",
    target: "critic",
    kind: "feedback",
    rule: feedbackRule(event.type, note, tags),
    source: {
      type: "feedback",
      eventKey,
      eventType: event.type,
      ...(event.itemId ? { itemId: event.itemId } : {}),
      ...(event.run ? { run: event.run } : {}),
      ...(event.image ? { image: event.image } : {}),
      ...(typeof event.note === "string" && event.note.length > 0 ? { verbatimNote: event.note } : {}),
      tags,
      inference: "explicit-feedback",
    },
  };
}

// The candidate id hashes the canonical rule text (not the proposal id), so
// re-inducing the same rule later maps onto the same candidate — an earlier
// approve/reject decision keeps applying instead of resurfacing the rule.
export function inducedProposalToTasteCandidate(proposal: {
  id: string;
  rule: string;
  evidence?: string | null;
}): TasteCandidate | null {
  const rule = compactText(proposal.rule);
  if (!rule) return null;
  const evidence = compactText(proposal.evidence);

  return {
    schemaVersion: 1,
    id: stableCandidateId(["induced", canonicalText(rule)]),
    status: "pending",
    target: "critic",
    kind: "feedback",
    rule,
    source: {
      type: "induced",
      proposalId: proposal.id,
      ...(evidence ? { evidence } : {}),
      inference: "ai-induced",
    },
  };
}

// Exposed so the curation flow can match AI-quoted rule texts against the
// approved candidates with the same normalization the candidate ids use.
export function canonicalRuleText(value: unknown): string {
  return canonicalText(value);
}

// Only merge proposals become candidates: a merge carries a new rule awaiting
// approval, while a retire targets an existing candidate and needs no new one.
// Same text-hash id scheme as induced proposals, so re-proposing the same
// merged rule maps onto the same candidate and past decisions keep applying.
export function curatedProposalToTasteCandidate(proposal: {
  id: string;
  action: "merge" | "retire";
  rule: string | null;
  replaces: readonly { candidateId: string; rule: string }[];
  reason?: string | null;
}): TasteCandidate | null {
  if (proposal.action !== "merge") return null;
  const rule = compactText(proposal.rule);
  if (!rule) return null;
  const reason = compactText(proposal.reason);

  return {
    schemaVersion: 1,
    id: stableCandidateId(["curated", canonicalText(rule)]),
    status: "pending",
    target: "critic",
    kind: "feedback",
    rule,
    source: {
      type: "curated",
      proposalId: proposal.id,
      replaces: proposal.replaces.map((entry) => ({ candidateId: entry.candidateId, rule: entry.rule })),
      ...(reason ? { reason } : {}),
      inference: "ai-curated",
    },
  };
}

export function buildApprovedCriticRulesSnapshot(
  candidates: readonly TasteCandidate[],
): ApprovedCriticRulesSnapshot {
  const approved = new Map<string, ApprovedCriticRule>();

  for (const candidate of candidates) {
    if (candidate.status !== "approved") continue;
    if (candidate.target !== "critic") {
      throw new Error("approved taste rules may only target the critic");
    }
    const rule = compactText(candidate.rule);
    if (!rule) throw new Error(`approved candidate ${candidate.id} has an empty rule`);
    approved.set(candidate.id, {
      candidateId: candidate.id,
      rule,
      sourceType: candidate.source.type,
    });
  }

  return buildCriticRulesSnapshot(Array.from(approved.values()));
}

export function buildCriticRulesSnapshot(
  inputRules: readonly ApprovedCriticRule[],
): ApprovedCriticRulesSnapshot {
  const rulesById = new Map<string, ApprovedCriticRule>();
  for (const input of inputRules) {
    const candidateId = compactText(input.candidateId);
    const rule = compactText(input.rule);
    if (!candidateId || !rule) throw new Error("critic rules require a candidate id and rule");
    if (input.sourceType !== "history" && input.sourceType !== "feedback"
      && input.sourceType !== "induced" && input.sourceType !== "curated") {
      throw new Error("critic rules require a valid source type");
    }
    rulesById.set(candidateId, { candidateId, rule, sourceType: input.sourceType });
  }
  const rules = Array.from(rulesById.values()).sort((left, right) => compareText(left.candidateId, right.candidateId));
  return {
    schemaVersion: 1,
    target: "critic",
    version: `critic-${stableHash(JSON.stringify(rules))}`,
    rules,
  };
}
