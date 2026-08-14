import { GetStoredAPIKey, OptimizePrompt } from "../platform/runtime/host.ts";
import { readRuntimePlatformState } from "../platform/index.ts";
import { aiChannelFailureMessage, resolveAIChannel } from "../lib/aiChannel.ts";
import { parsePromptSuggestionResponse } from "../lib/promptSuggestion.ts";
import { buildRuleInductionRequestText, parseRuleInductionResponse } from "../lib/ruleInduction.ts";
import {
  appendTasteInducedRuleProposal,
  listTasteFeedback,
  listTastePromptSuggestionDecisions,
  writeTasteProfile,
} from "../lib/tasteStorage.ts";
import { inducedProposalToTasteCandidate } from "../lib/tasteLearning.ts";
import type { TasteCandidate } from "../lib/tasteLearning.ts";
import type {
  InducedRuleProposal,
  InducedRuleProposalInput,
  PromptSuggestionDecision,
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
  isAndroid: () => readRuntimePlatformState().isAndroid,
  now: Date.now,
};

// Sentinel busy id for the whole-history induction run; it occupies
// tasteRuleBusyId so per-candidate actions stay disabled while the AI reads
// the history.
export const INDUCE_FROM_HISTORY_BUSY_ID = "induce-from-history";

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
    mode: "distill-rule" | "revise-rule" | "induce-rules",
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
  };
}
