import { GetStoredAPIKey, OptimizePrompt } from "../platform/runtime/host.ts";
import { readRuntimePlatformState } from "../platform/index.ts";
import { aiChannelFailureMessage, resolveAIChannel } from "../lib/aiChannel.ts";
import {
  buildPromptSuggestionRequestText,
  parsePromptSuggestionResponse,
  prepareApprovedRulesForContext,
} from "../lib/promptSuggestion.ts";
import {
  appendTastePromptSuggestionDecision,
  appendTasteSuggestionOutcome,
  listRecentTasteFeedback,
  listRecentTastePromptSuggestionDecisions,
} from "../lib/tasteStorage.ts";
import type {
  PromptSuggestionDecision,
  PromptSuggestionDecisionInput,
  PromptSuggestionDecisionValue,
  PromptSuggestionOutcome,
  PromptSuggestionOutcomeInput,
  TasteFeedbackEvent,
} from "../lib/tasteStorage.ts";
import type { PromptOptimizeRequest, StudioState } from "./studioStore.types.ts";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

// How many recent records the draft context reads via the createdAt cursor;
// buildPromptSuggestionRequestText filters and trims this down to its top 5.
const RECENT_HISTORY_READ_LIMIT = 50;

export interface PromptSuggestionActionDependencies {
  optimizePrompt: (request: PromptOptimizeRequest) => Promise<string>;
  getStoredAPIKey: (user: string) => Promise<string>;
  listRecentFeedback: (limit: number) => Promise<TasteFeedbackEvent[]>;
  listRecentSuggestionDecisions: (limit: number) => Promise<PromptSuggestionDecision[]>;
  appendSuggestionDecision: (input: PromptSuggestionDecisionInput) => Promise<PromptSuggestionDecision>;
  appendSuggestionOutcome: (input: PromptSuggestionOutcomeInput) => Promise<PromptSuggestionOutcome>;
  isAndroid: () => boolean;
}

const defaultDependencies: PromptSuggestionActionDependencies = {
  optimizePrompt: OptimizePrompt,
  getStoredAPIKey: GetStoredAPIKey,
  listRecentFeedback: listRecentTasteFeedback,
  listRecentSuggestionDecisions: listRecentTastePromptSuggestionDecisions,
  appendSuggestionDecision: appendTastePromptSuggestionDecision,
  appendSuggestionOutcome: appendTasteSuggestionOutcome,
  isAndroid: () => readRuntimePlatformState().isAndroid,
};

export function createPromptSuggestionActions(
  store: StateAdapter,
  overrides: Partial<PromptSuggestionActionDependencies> = {},
) {
  const dependencies: PromptSuggestionActionDependencies = { ...defaultDependencies, ...overrides };

  return {
    async draftPromptSuggestion(): Promise<void> {
      const initial = store.getState();
      const offer = initial.promptRetryOffer;
      if (!offer || initial.promptSuggestionDrafting || initial.isRunning) return;
      // Set the single-flight flag synchronously, before any await, so a
      // double-click cannot enqueue a second billable draft request.
      store.setState({ promptSuggestionDrafting: true });
      try {
        const resolution = await resolveAIChannel({
          profiles: initial.profiles,
          aiProfileId: initial.aiProfileId,
          activeProfileId: initial.activeProfileId,
          kernelRuntimeMode: initial.kernelRuntimeMode,
          isAndroid: dependencies.isAndroid,
          getStoredAPIKey: dependencies.getStoredAPIKey,
        });
        if (!resolution.ok) {
          store.getState().pushToast(aiChannelFailureMessage("AI 建议", resolution.failure), "warn", 5000);
          return;
        }
        const { aiProfile, baseURL, textModelID, apiKey } = resolution.channel;
        const [feedback, suggestionDecisions] = await Promise.all([
          dependencies.listRecentFeedback(RECENT_HISTORY_READ_LIMIT),
          dependencies.listRecentSuggestionDecisions(RECENT_HISTORY_READ_LIMIT),
        ]);
        // Approved rules are long-standing preferences the user already
        // confirmed; the draft stays a user-reviewed proposal either way.
        const approvedRules = prepareApprovedRulesForContext(
          initial.tasteProfile.candidates
            .filter((candidate) => candidate.status === "approved")
            .map((candidate) => candidate.rule),
        );
        const requestText = buildPromptSuggestionRequestText({ offer, feedback, suggestionDecisions, approvedRules });
        const raw = await dependencies.optimizePrompt({
          apiKey,
          prompt: requestText,
          mode: "suggest",
          baseURL,
          textModelID,
          proxyMode: initial.proxyMode,
          proxyURL: initial.proxyURL,
          allowInsecureConnection: aiProfile.allowInsecureConnection === true,
          imagePaths: [],
          imagePath: "",
        });
        const draftPrompt = parsePromptSuggestionResponse(raw);
        const current = store.getState();
        // The offer may have been cleared by a new run while drafting; drop a stale draft.
        if (!current.promptRetryOffer || current.promptRetryOffer.batchId !== offer.batchId) return;
        store.setState({ promptSuggestion: { offer, draftPrompt, appliedRuleCount: approvedRules.length } });
      } catch (error) {
        store.getState().pushToast(
          `起草改进提示词失败:${error instanceof Error ? error.message : String(error)}`,
          "error",
          6000,
        );
      } finally {
        store.setState({ promptSuggestionDrafting: false });
      }
    },

    async decidePromptSuggestion(input: { decision: "accept" | "reject"; finalPrompt?: string }): Promise<void> {
      const state = store.getState();
      const suggestion = state.promptSuggestion;
      if (!suggestion || state.promptSuggestionSubmitting) return;
      const { offer, draftPrompt } = suggestion;
      // A run started after drafting (e.g. via the global submit shortcut)
      // clears the offer; a decision against that superseded batch would be
      // recorded with stale context, so close the orphan draft instead.
      if (!state.promptRetryOffer || state.promptRetryOffer.batchId !== offer.batchId) {
        store.setState({ promptSuggestion: null });
        state.pushToast("该草稿对应的批次已被新的生成覆盖,草稿已关闭", "warn", 5000);
        return;
      }
      const isReject = input.decision === "reject";
      const finalText = isReject ? null : input.finalPrompt ?? draftPrompt;
      if (!isReject && !finalText?.trim()) {
        state.pushToast("修改后的提示词不能为空", "warn", 5000);
        return;
      }
      const decision: PromptSuggestionDecisionValue = isReject
        ? "rejected"
        : finalText === draftPrompt ? "accepted" : "modified";

      store.setState({ promptSuggestionSubmitting: true });
      let decisionRecord: PromptSuggestionDecision | null = null;
      try {
        try {
          decisionRecord = await dependencies.appendSuggestionDecision({
            batchId: offer.batchId,
            originalPrompt: offer.originalPrompt,
            rejectNote: offer.rejectNote,
            draftPrompt,
            finalPrompt: finalText,
            decision,
          });
        } catch (error) {
          state.pushToast(
            `记录决定失败:${error instanceof Error ? error.message : String(error)}`,
            "error",
            6000,
          );
          return;
        }

        if (isReject) {
          store.setState({ promptSuggestion: null });
          state.pushToast("已记录:草稿被拒绝。可重新起草或忽略", "success");
          return;
        }

        state.clearSources();
        if (offer.mode === "edit" && offer.sourcePaths.length > 0) {
          // The rejected batch was generated against reference images; rerun
          // with the same ones instead of silently degrading to text-to-image.
          store.setState({
            mode: "edit",
            sources: offer.sourcePaths.map((path) => ({
              path,
              name: path.split(/[\\/]/).pop() || path,
              size: 0,
            })),
          });
        }
        store.setState({ prompt: finalText!, promptSuggestion: null, promptRetryOffer: null });
        const beforeSubmit = store.getState();
        const wasRunning = beforeSubmit.isRunning;
        let submitResult: { batchId: string } | void;
        try {
          // disableLoop: adopting a draft means "one new batch", never a loop
          // fan-out even when loop generation is enabled in the workspace.
          submitResult = await beforeSubmit.submit({ promptProvenance: "user-controls", disableLoop: true });
        } catch (error) {
          beforeSubmit.pushToast(
            `已记录你的决定,但自动生图未启动:${error instanceof Error ? error.message : String(error)}。无需再次操作`,
            "warn",
            7000,
          );
          return;
        }
        const submitted = store.getState();
        if (wasRunning || !submitted.isRunning) {
          const reason = submitted.errorMessage?.trim();
          submitted.pushToast(
            `已记录你的决定,但自动生图未启动${reason ? `:${reason}` : ""}。无需再次操作`,
            "warn",
            7000,
          );
          return;
        }
        if (submitResult?.batchId && decisionRecord) {
          // Metric link only — a failed outcome write must never disturb the run.
          await dependencies
            .appendSuggestionOutcome({ decisionId: decisionRecord.id, resultBatchId: submitResult.batchId })
            .catch(() => {});
        }
        submitted.pushToast("已按改进后的提示词开始生成新一批", "success", 6000);
      } finally {
        store.setState({ promptSuggestionSubmitting: false });
      }
    },

    dismissPromptRetryOffer(): void {
      store.setState({ promptRetryOffer: null });
    },

    closePromptSuggestion(): void {
      store.setState({ promptSuggestion: null });
    },

    // Rewrites a hand-written edit suggestion into an explicit edit instruction.
    // Returns the draft text for the caller to place back into the textarea —
    // the user reviews and can edit it again before anything is submitted.
    async refineEditNote(input: { note: string; originalPrompt: string }): Promise<string | null> {
      const state = store.getState();
      if (state.editNoteRefining) return null;
      if (!input.note.trim()) {
        state.pushToast("先写下你的建议再让 AI 优化", "warn", 5000);
        return null;
      }
      store.setState({ editNoteRefining: true });
      try {
        const resolution = await resolveAIChannel({
          profiles: state.profiles,
          aiProfileId: state.aiProfileId,
          activeProfileId: state.activeProfileId,
          kernelRuntimeMode: state.kernelRuntimeMode,
          isAndroid: dependencies.isAndroid,
          getStoredAPIKey: dependencies.getStoredAPIKey,
        });
        if (!resolution.ok) {
          store.getState().pushToast(aiChannelFailureMessage("AI 优化", resolution.failure), "warn", 5000);
          return null;
        }
        const { aiProfile, baseURL, textModelID, apiKey } = resolution.channel;
        const raw = await dependencies.optimizePrompt({
          apiKey,
          prompt: JSON.stringify({
            schemaVersion: 1,
            operation: "refine-note",
            note: input.note,
            originalPrompt: input.originalPrompt,
          }),
          mode: "refine-note",
          baseURL,
          textModelID,
          proxyMode: state.proxyMode,
          proxyURL: state.proxyURL,
          allowInsecureConnection: aiProfile.allowInsecureConnection === true,
          imagePaths: [],
          imagePath: "",
        });
        return parsePromptSuggestionResponse(raw);
      } catch (error) {
        store.getState().pushToast(
          `优化建议失败:${error instanceof Error ? error.message : String(error)}`,
          "error",
          6000,
        );
        return null;
      } finally {
        store.setState({ editNoteRefining: false });
      }
    },
  };
}
