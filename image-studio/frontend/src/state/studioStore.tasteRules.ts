import { GetStoredAPIKey, OptimizePrompt } from "../platform/runtime/host.ts";
import { readRuntimePlatformState } from "../platform/index.ts";
import { aiChannelFailureMessage, resolveAIChannel } from "../lib/aiChannel.ts";
import { parsePromptSuggestionResponse } from "../lib/promptSuggestion.ts";
import { buildRuleInductionRequestText, parseRuleInductionResponse } from "../lib/ruleInduction.ts";
import { buildRuleCurationRequestText, parseRuleCurationResponse } from "../lib/ruleCuration.ts";
import {
  appendTasteInducedRuleProposal,
  appendTasteRuleCurationProposal,
  listTasteFeedback,
  listTastePromptSuggestionDecisions,
  writeTasteProfile,
} from "../lib/tasteStorage.ts";
import { canonicalRuleText, curatedProposalToTasteCandidate, inducedProposalToTasteCandidate } from "../lib/tasteLearning.ts";
import type { TasteCandidate } from "../lib/tasteLearning.ts";
import type { RuleCurationReviewItem } from "../lib/ruleCuration.ts";
import type {
  InducedRuleProposal,
  InducedRuleProposalInput,
  PromptSuggestionDecision,
  RuleCurationProposal,
  RuleCurationProposalInput,
  TasteFeedbackEvent,
} from "../lib/tasteStorage.ts";
import type { PromptOptimizeRequest, StudioState, TasteProfileState } from "./studioStore.types.ts";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

export interface TasteRuleActionDependencies {
  optimizePrompt: (request: PromptOptimizeRequest) => Promise<string>;
  getStoredAPIKey: (user: string) => Promise<string>;
  writeProfile: (profile: TasteProfileState) => Promise<void>;
  listFeedback: () => Promise<TasteFeedbackEvent[]>;
  listSuggestionDecisions: () => Promise<PromptSuggestionDecision[]>;
  appendInducedProposal: (input: InducedRuleProposalInput) => Promise<InducedRuleProposal>;
  appendCurationProposal: (input: RuleCurationProposalInput) => Promise<RuleCurationProposal>;
  isAndroid: () => boolean;
  now: () => number;
}

const defaultDependencies: TasteRuleActionDependencies = {
  optimizePrompt: OptimizePrompt,
  getStoredAPIKey: GetStoredAPIKey,
  writeProfile: writeTasteProfile,
  listFeedback: listTasteFeedback,
  listSuggestionDecisions: listTastePromptSuggestionDecisions,
  appendInducedProposal: appendTasteInducedRuleProposal,
  appendCurationProposal: appendTasteRuleCurationProposal,
  isAndroid: () => readRuntimePlatformState().isAndroid,
  now: Date.now,
};

// Sentinel busy id for the whole-history induction run; it occupies
// tasteRuleBusyId so per-candidate actions stay disabled while the AI reads
// the history.
export const INDUCE_FROM_HISTORY_BUSY_ID = "induce-from-history";
// Same idea for the rule-curation run over the approved set.
export const CURATE_RULES_BUSY_ID = "curate-rules";

function candidateNote(candidate: TasteCandidate): string {
  return candidate.source.type === "feedback"
    ? candidate.source.verbatimNote ?? ""
    : "";
}

function candidateFeedbackType(candidate: TasteCandidate): string {
  return candidate.source.type === "feedback" ? candidate.source.eventType : "history";
}

// Rule text edits go through the profile document (a mutable snapshot, not the
// append-only event tables); the candidate keeps its source verbatimNote as
// provenance and still requires an explicit approve before it takes effect.
export function createTasteRuleActions(
  store: StateAdapter,
  overrides: Partial<TasteRuleActionDependencies> = {},
) {
  const dependencies: TasteRuleActionDependencies = { ...defaultDependencies, ...overrides };

  async function applyRuleText(
    candidateId: string,
    ruleText: string,
    refinedBy: "ai" | "user",
  ): Promise<boolean> {
    const state = store.getState();
    const trimmed = ruleText.trim();
    if (!trimmed) {
      state.pushToast("规则内容不能为空", "warn", 5000);
      return false;
    }
    const profile = state.tasteProfile;
    if (!profile.candidates.some((candidate) => candidate.id === candidateId)) {
      state.pushToast("该候选规则已不存在", "warn", 5000);
      return false;
    }
    const next: TasteProfileState = {
      ...profile,
      candidates: profile.candidates.map((candidate) => (
        candidate.id === candidateId ? { ...candidate, rule: trimmed, refined: refinedBy } : candidate
      )),
      updatedAt: dependencies.now(),
    };
    await dependencies.writeProfile(next);
    store.setState({ tasteProfile: next });
    return true;
  }

  async function callRuleChannel(
    mode: "distill-rule" | "revise-rule" | "induce-rules" | "curate-rules",
    requestText: string,
  ): Promise<string | null> {
    const state = store.getState();
    const resolution = await resolveAIChannel({
      profiles: state.profiles,
      aiProfileId: state.aiProfileId,
      activeProfileId: state.activeProfileId,
      kernelRuntimeMode: state.kernelRuntimeMode,
      isAndroid: dependencies.isAndroid,
      getStoredAPIKey: dependencies.getStoredAPIKey,
    });
    if (!resolution.ok) {
      state.pushToast(aiChannelFailureMessage("AI 提炼", resolution.failure), "warn", 5000);
      return null;
    }
    const { aiProfile, baseURL, textModelID, apiKey } = resolution.channel;
    const raw = await dependencies.optimizePrompt({
      apiKey,
      prompt: requestText,
      mode,
      baseURL,
      textModelID,
      proxyMode: state.proxyMode,
      proxyURL: state.proxyURL,
      allowInsecureConnection: aiProfile.allowInsecureConnection === true,
      imagePaths: [],
      imagePath: "",
    });
    return parsePromptSuggestionResponse(raw);
  }

  async function runRuleChannel(
    candidateId: string,
    mode: "distill-rule" | "revise-rule",
    buildRequest: (candidate: TasteCandidate) => string,
    successToast: string,
  ): Promise<void> {
    const initial = store.getState();
    if (initial.tasteRuleBusyId) return;
    const candidate = initial.tasteProfile.candidates.find((entry) => entry.id === candidateId);
    if (!candidate) {
      initial.pushToast("该候选规则已不存在", "warn", 5000);
      return;
    }
    store.setState({ tasteRuleBusyId: candidateId });
    try {
      const ruleText = await callRuleChannel(mode, buildRequest(candidate));
      if (ruleText === null) return;
      if (await applyRuleText(candidateId, ruleText, "ai")) {
        store.getState().pushToast(successToast, "success", 5000);
      }
    } catch (error) {
      store.getState().pushToast(
        `AI 提炼失败:${error instanceof Error ? error.message : String(error)}`,
        "error",
        6000,
      );
    } finally {
      store.setState({ tasteRuleBusyId: null });
    }
  }

  return {
    async updateCandidateRule(candidateId: string, ruleText: string): Promise<void> {
      const state = store.getState();
      if (state.tasteRuleBusyId) return;
      store.setState({ tasteRuleBusyId: candidateId });
      try {
        if (await applyRuleText(candidateId, ruleText, "user")) {
          store.getState().pushToast("规则已更新;采纳后才会生效", "success", 5000);
        }
      } catch (error) {
        store.getState().pushToast(
          `保存规则失败:${error instanceof Error ? error.message : String(error)}`,
          "error",
          6000,
        );
      } finally {
        store.setState({ tasteRuleBusyId: null });
      }
    },

    async distillCandidateRule(candidateId: string): Promise<void> {
      await runRuleChannel(
        candidateId,
        "distill-rule",
        (candidate) => JSON.stringify({
          schemaVersion: 1,
          operation: "distill-rule",
          note: candidateNote(candidate) || candidate.rule,
          feedbackType: candidateFeedbackType(candidate),
          currentRule: candidate.rule,
        }),
        "已提炼为可复用规则;采纳后才会生效",
      );
    },

    async reviseCandidateRule(candidateId: string, instruction: string): Promise<void> {
      const trimmed = instruction.trim();
      if (!trimmed) {
        store.getState().pushToast("先写一句你希望怎么改", "warn", 5000);
        return;
      }
      await runRuleChannel(
        candidateId,
        "revise-rule",
        (candidate) => JSON.stringify({
          schemaVersion: 1,
          operation: "revise-rule",
          currentRule: candidate.rule,
          instruction: trimmed,
          note: candidateNote(candidate),
        }),
        "已按你的意见改写;采纳后才会生效",
      );
    },

    async induceRulesFromHistory(): Promise<void> {
      const initial = store.getState();
      if (initial.tasteRuleBusyId) return;
      store.setState({ tasteRuleBusyId: INDUCE_FROM_HISTORY_BUSY_ID });
      try {
        const [feedback, suggestionDecisions] = await Promise.all([
          dependencies.listFeedback(),
          dependencies.listSuggestionDecisions(),
        ]);
        const notedFeedback = feedback.filter((event) => (event.note ?? "").trim() !== "");
        if (notedFeedback.length === 0 && suggestionDecisions.length === 0) {
          store.getState().pushToast("还没有可归纳的素材;先积累几条写了文字的反馈或建议决定", "warn", 6000);
          return;
        }
        const profile = store.getState().tasteProfile;
        const requestText = buildRuleInductionRequestText({
          feedback: notedFeedback,
          suggestionDecisions,
          approvedRules: profile.candidates
            .filter((candidate) => candidate.status === "approved")
            .map((candidate) => candidate.rule),
          rejectedRules: profile.candidates
            .filter((candidate) => candidate.status === "rejected")
            .map((candidate) => candidate.rule),
        });
        const responseText = await callRuleChannel("induce-rules", requestText);
        if (responseText === null) return;
        const drafts = parseRuleInductionResponse(responseText);
        if (drafts.length === 0) {
          store.getState().pushToast("AI 没有从历史里归纳出新的规律;积累更多反馈后再试", "warn", 6000);
          return;
        }
        // The candidate id is derived from the rule text, so probing with a
        // placeholder proposal id is enough to detect duplicates.
        const existingIds = new Set(profile.candidates.map((candidate) => candidate.id));
        const fresh = drafts.filter((draft) => {
          const probe = inducedProposalToTasteCandidate({ id: "probe", rule: draft.rule, evidence: draft.evidence });
          return probe !== null && !existingIds.has(probe.id);
        });
        if (fresh.length === 0) {
          store.getState().pushToast("AI 归纳出的方向都已在候选记录里了", "warn", 6000);
          return;
        }
        for (const draft of fresh) {
          await dependencies.appendInducedProposal({ rule: draft.rule, evidence: draft.evidence });
        }
        await store.getState().refreshTasteProfile();
        store.getState().pushToast(`从历史归纳出 ${fresh.length} 条候选规则;采纳后才会生效`, "success", 6000);
      } catch (error) {
        store.getState().pushToast(
          `从历史学习失败:${error instanceof Error ? error.message : String(error)}`,
          "error",
          6000,
        );
      } finally {
        store.setState({ tasteRuleBusyId: null });
      }
    },

    // Ask the AI to propose merges/retirements over the approved rule set,
    // then hand every surviving proposal to the explicit review modal — the
    // user decides each one, and nothing changes until they do.
    async curateRules(): Promise<void> {
      const initial = store.getState();
      if (initial.tasteRuleBusyId) return;
      const approved = initial.tasteProfile.candidates.filter((candidate) => candidate.status === "approved");
      if (approved.length < 2) {
        initial.pushToast("生效规则不足两条,还不需要整理", "warn", 5000);
        return;
      }
      store.setState({ tasteRuleBusyId: CURATE_RULES_BUSY_ID });
      try {
        const feedback = await dependencies.listFeedback();
        const profile = store.getState().tasteProfile;
        const requestText = buildRuleCurationRequestText({
          approvedRules: approved.map((candidate) => candidate.rule),
          rejectedRules: profile.candidates
            .filter((candidate) => candidate.status === "rejected")
            .map((candidate) => candidate.rule),
          feedback: feedback.filter((event) => (event.note ?? "").trim() !== ""),
        });
        const responseText = await callRuleChannel("curate-rules", requestText);
        if (responseText === null) return;
        const drafts = parseRuleCurationResponse(responseText);
        if (drafts.length === 0) {
          store.getState().pushToast("AI 认为当前规则库已经足够紧凑,没有整理建议", "success", 6000);
          return;
        }

        // Match the AI-quoted replaces texts back onto approved candidates.
        // A proposal citing any rule we cannot match is dropped whole — a
        // hallucinated quote must never retire a real rule.
        const approvedByCanonical = new Map<string, TasteCandidate>();
        for (const candidate of approved) {
          const key = canonicalRuleText(candidate.rule);
          if (!approvedByCanonical.has(key)) approvedByCanonical.set(key, candidate);
        }
        const existingById = new Map(profile.candidates.map((candidate) => [candidate.id, candidate]));
        const items: RuleCurationReviewItem[] = [];
        const seenKeys = new Set<string>();
        let droppedUnmatched = 0;
        for (const draft of drafts) {
          const matched: { candidateId: string; rule: string }[] = [];
          const matchedIds = new Set<string>();
          let unmatched = false;
          for (const quoted of draft.replaces) {
            const target = approvedByCanonical.get(canonicalRuleText(quoted));
            if (!target) {
              unmatched = true;
              break;
            }
            if (matchedIds.has(target.id)) continue;
            matchedIds.add(target.id);
            matched.push({ candidateId: target.id, rule: target.rule });
          }
          if (unmatched || matched.length === 0) {
            droppedUnmatched += 1;
            continue;
          }
          if (draft.action === "merge") {
            const probe = curatedProposalToTasteCandidate({
              id: "probe",
              action: "merge",
              rule: draft.rule,
              replaces: matched,
              reason: draft.reason,
            });
            if (!probe || seenKeys.has(probe.id)) continue;
            const existing = existingById.get(probe.id);
            // A previously rejected (or already approved) merge text must not
            // resurface; a still-pending duplicate re-enters review without a
            // second fact-table append.
            if (existing && existing.status !== "pending") continue;
            if (!existing) {
              await dependencies.appendCurationProposal({
                action: "merge",
                rule: draft.rule,
                replaces: matched,
                reason: draft.reason,
                createdAt: dependencies.now(),
              });
            }
            seenKeys.add(probe.id);
            items.push({
              key: probe.id,
              action: "merge",
              candidateId: probe.id,
              rule: draft.rule ?? "",
              replaces: matched,
              reason: draft.reason,
            });
          } else {
            const target = matched[0];
            const key = `retire-${target.candidateId}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            await dependencies.appendCurationProposal({
              action: "retire",
              rule: null,
              replaces: [target],
              reason: draft.reason,
              createdAt: dependencies.now(),
            });
            items.push({
              key,
              action: "retire",
              candidateId: target.candidateId,
              rule: target.rule,
              replaces: [],
              reason: draft.reason,
            });
          }
        }
        if (items.length === 0) {
          store.getState().pushToast(
            droppedUnmatched > 0
              ? "AI 的整理提案引用的规则与现有规则对不上,已全部忽略"
              : "AI 的整理提案都已处理过,没有需要审阅的内容",
            "warn",
            6000,
          );
          return;
        }
        await store.getState().refreshTasteProfile();
        if (droppedUnmatched > 0) {
          store.getState().pushToast(`有 ${droppedUnmatched} 条提案引用的规则对不上,已忽略`, "warn", 6000);
        }
        // Close the taste panel first so the review modal is the only thing
        // on screen — curation decisions deserve full attention.
        store.setState({ tastePanelOpen: false, ruleCuration: { items } });
      } catch (error) {
        store.getState().pushToast(
          `整理规则库失败:${error instanceof Error ? error.message : String(error)}`,
          "error",
          6000,
        );
      } finally {
        store.setState({ tasteRuleBusyId: null });
      }
    },
  };
}
