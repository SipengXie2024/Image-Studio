import { extractColdStartTasteCandidates, feedbackEventToTasteCandidate } from "../lib/tasteLearning.ts";
import {
  appendTasteDecision,
  appendTasteFeedback,
  listTasteDecisions,
  listTasteFeedback,
  readTasteProfile,
  readTasteState,
  writeTasteProfile,
  writeTasteState,
} from "../lib/tasteStorage.ts";
import { detectImageMimeTypeFromBase64 } from "../lib/images.ts";
import { loadAllHistory } from "../lib/storage.ts";
import { readRuntimePlatformState } from "../platform/index.ts";
import { ReadImageAsBase64 } from "../platform/runtime/host.ts";
import type {
  TasteCandidateDecision,
  TasteFeedbackEvent,
  TasteFeedbackInput,
  TasteVisualExemplarInput,
} from "../lib/tasteStorage.ts";
import type { HistoryItem } from "../types/domain.ts";
import type { StudioState, TasteProfileState } from "./studioStore.types.ts";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

type TasteBootstrapState = { snoozedUntil?: number };

const TASTE_BOOTSTRAP_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

type TasteActionDependencies = {
  loadHistory: () => Promise<HistoryItem[]>;
  appendFeedback: (input: TasteFeedbackInput) => Promise<TasteFeedbackEvent>;
  listFeedback: () => Promise<TasteFeedbackEvent[]>;
  appendDecision: (input: {
    candidateId: string;
    decision: "approve" | "reject";
    createdAt?: number;
  }) => Promise<TasteCandidateDecision>;
  listDecisions: (candidateId?: string) => Promise<TasteCandidateDecision[]>;
  readProfile: () => Promise<TasteProfileState | null>;
  writeProfile: (profile: TasteProfileState) => Promise<void>;
  readBootstrapState: () => Promise<TasteBootstrapState | null>;
  writeBootstrapState: (state: TasteBootstrapState & { schemaVersion: 1 }) => Promise<void>;
  readImageAsBase64: (path: string) => Promise<string>;
  fetchImageBlob: (url: string) => Promise<Blob | null>;
  isAndroid: () => boolean;
  now: () => number;
};

const defaultDependencies: TasteActionDependencies = {
  loadHistory: loadAllHistory,
  appendFeedback: appendTasteFeedback,
  listFeedback: listTasteFeedback,
  appendDecision: appendTasteDecision,
  listDecisions: listTasteDecisions,
  readProfile: () => readTasteProfile<TasteProfileState>(),
  writeProfile: writeTasteProfile,
  readBootstrapState: () => readTasteState<TasteBootstrapState>(),
  writeBootstrapState: writeTasteState,
  readImageAsBase64: ReadImageAsBase64,
  fetchImageBlob: async (url) => {
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
  },
  isAndroid: () => readRuntimePlatformState().isAndroid,
  now: Date.now,
};

function candidateFromStoredFeedback(event: TasteFeedbackEvent) {
  return feedbackEventToTasteCandidate({
    id: event.id,
    type: event.type,
    itemId: event.itemId ?? undefined,
    note: event.note ?? undefined,
  });
}

function latestDecisionByCandidate(
  decisions: readonly TasteCandidateDecision[],
): Map<string, TasteCandidateDecision> {
  const latest = new Map<string, TasteCandidateDecision>();
  for (const decision of decisions) {
    const current = latest.get(decision.candidateId);
    if (!current
      || decision.createdAt > current.createdAt
      || (decision.createdAt === current.createdAt && decision.id.localeCompare(current.id) > 0)) {
      latest.set(decision.candidateId, decision);
    }
  }
  return latest;
}

async function collectTasteProfile(dependencies: TasteActionDependencies): Promise<TasteProfileState> {
  const [history, feedback, decisions, savedProfile] = await Promise.all([
    dependencies.loadHistory(),
    dependencies.listFeedback(),
    dependencies.listDecisions(),
    dependencies.readProfile(),
  ]);
  const byId = new Map(extractColdStartTasteCandidates(history).map((candidate) => [candidate.id, candidate]));
  for (const event of feedback) {
    const candidate = candidateFromStoredFeedback(event);
    if (candidate) byId.set(candidate.id, candidate);
  }
  const latest = latestDecisionByCandidate(decisions);
  const savedById = new Map((savedProfile?.candidates ?? []).map((candidate) => [candidate.id, candidate]));
  for (const candidate of savedById.values()) {
    if ((candidate.status === "approved" || latest.has(candidate.id)) && !byId.has(candidate.id)) {
      byId.set(candidate.id, candidate);
    }
  }
  const candidates = Array.from(byId.values())
    .map((candidate) => ({
      ...candidate,
      status: latest.get(candidate.id)?.decision === "approve"
        ? "approved" as const
        : latest.get(candidate.id)?.decision === "reject"
          ? "rejected" as const
          : savedById.get(candidate.id)?.status === "approved"
            ? "approved" as const
            : "pending" as const,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    candidates,
    approvedCandidateIds: candidates.filter((candidate) => candidate.status === "approved").map((candidate) => candidate.id),
    updatedAt: dependencies.now(),
    bootstrapAcknowledged: savedProfile?.bootstrapAcknowledged === true,
  };
}

function feedbackContext(item: HistoryItem | undefined, items: readonly HistoryItem[]) {
  const representative = item ?? items[0];
  if (!representative?.batchId) throw new Error("这批结果缺少可追溯的 batch ID，请重新生成后再反馈");
  if (items.length === 0 || items.some((entry) => entry.batchId !== representative.batchId)) {
    throw new Error("反馈批次不一致，请重新打开本批结果后再提交");
  }
  if (item && !items.some((entry) => entry.id === item.id)) {
    throw new Error("所选图片不属于当前反馈批次，请重新选择");
  }
  return {
    batchId: representative.batchId,
    originalPrompt: representative.originalPrompt ?? representative.prompt,
    submittedPrompt: representative.submittedPrompt ?? representative.prompt,
    imageIds: items.map((entry) => entry.id),
  };
}

function assertCurrentFeedbackBatch(snapshot: readonly HistoryItem[], current: readonly HistoryItem[]) {
  const snapshotContext = feedbackContext(undefined, snapshot);
  const currentContext = feedbackContext(undefined, current);
  const snapshotIDs = [...snapshotContext.imageIds].sort();
  const currentIDs = [...currentContext.imageIds].sort();
  if (
    snapshotContext.batchId !== currentContext.batchId
    || snapshotIDs.length !== currentIDs.length
    || snapshotIDs.some((id, index) => id !== currentIDs[index])
  ) {
    throw new Error("结果批次已变化，请在当前批次中重新提交反馈");
  }
  return snapshotContext;
}

function imageName(item: HistoryItem): string {
  return item.savedPath?.split(/[\\/]/).pop() || `${item.id}.png`;
}

async function captureVisualExemplar(
  item: HistoryItem,
  dependencies: TasteActionDependencies,
): Promise<TasteVisualExemplarInput | null> {
  const savedPath = item.savedPath && !item.savedPath.startsWith("memory://")
    ? item.savedPath
    : null;
  let imageBlob = item.previewBlob ?? null;
  let imageB64 = "";

  if (!imageBlob && item.previewUrl) {
    imageBlob = await dependencies.fetchImageBlob(item.previewUrl).catch(() => null);
  }
  if (!imageBlob && !imageB64 && item.thumbPath) {
    imageB64 = await dependencies.readImageAsBase64(item.thumbPath).catch(() => "");
  }
  if (!imageBlob && (!savedPath || dependencies.isAndroid())) {
    imageBlob ??= item.imageBlob ?? null;
    imageB64 ||= item.imageB64?.trim() ?? "";
    if (!imageBlob && !imageB64 && item.fullUrl) {
      imageBlob = await dependencies.fetchImageBlob(item.fullUrl).catch(() => null);
    }
    if (!imageBlob && !imageB64 && item.savedPath) {
      imageB64 = await dependencies.readImageAsBase64(item.savedPath).catch(() => "");
    }
  }
  if (!savedPath && !imageBlob && !imageB64) return null;

  return {
    itemId: item.id,
    savedPath,
    imageB64: imageB64 || null,
    imageBlob,
    mimeType: imageBlob?.type || detectImageMimeTypeFromBase64(imageB64),
    name: imageName(item),
  };
}

async function captureVisualExemplars(
  items: readonly HistoryItem[],
  dependencies: TasteActionDependencies,
): Promise<TasteVisualExemplarInput[]> {
  const unique = Array.from(new Map(items.map((item) => [item.id, item])).values());
  const captured = await Promise.all(unique.map((item) => captureVisualExemplar(item, dependencies)));
  return captured.filter((entry): entry is TasteVisualExemplarInput => entry !== null);
}

export function createTasteActions(
  store: StateAdapter,
  overrides: Partial<TasteActionDependencies> = {},
) {
  const dependencies: TasteActionDependencies = { ...defaultDependencies, ...overrides };

  const refresh = async () => {
    const profile = await collectTasteProfile(dependencies);
    store.setState({ tasteProfile: profile, tasteLoading: false });
    await dependencies.writeProfile(profile);
    return profile;
  };

  const refreshAfterFeedback = async (state: StudioState) => {
    try {
      await refresh();
      return true;
    } catch (error) {
      state.pushToast(
        `反馈已记录，但品味摘要刷新失败：${error instanceof Error ? error.message : String(error)}`,
        "warn",
        6000,
      );
      return false;
    }
  };

  return {
    async bootstrapTaste() {
      store.setState({ tasteLoading: true });
      try {
        const [profile, state] = await Promise.all([
          refresh(),
          dependencies.readBootstrapState(),
        ]);
        if (!profile.bootstrapAcknowledged
            && profile.candidates.length > 0
            && (state?.snoozedUntil ?? 0) <= dependencies.now()) {
          store.setState({ tasteBootstrapOpen: true });
        }
      } catch (error) {
        store.setState({ tasteLoading: false });
        if (typeof console !== "undefined") console.warn("taste bootstrap failed", error);
      }
    },

    async rescanTasteHistory() {
      store.setState({ tasteLoading: true, tasteBootstrapOpen: true });
      try {
        await refresh();
      } catch (error) {
        store.setState({ tasteLoading: false });
        throw error;
      }
    },

    async decideTasteCandidate(candidateId: string, decision: "approve" | "reject") {
      const existing = await dependencies.listDecisions(candidateId);
      const latestCreatedAt = existing.reduce((latest, entry) => Math.max(latest, entry.createdAt), -1);
      await dependencies.appendDecision({
        candidateId,
        decision,
        createdAt: Math.max(dependencies.now(), latestCreatedAt + 1),
      });
      await refresh();
    },

    async acknowledgeTasteBootstrap() {
      const current = store.getState().tasteProfile;
      const profile = { ...current, bootstrapAcknowledged: true, updatedAt: dependencies.now() };
      await dependencies.writeProfile(profile);
      store.setState({ tasteProfile: profile, tasteBootstrapOpen: false });
    },

    closeTasteBootstrap() {
      store.setState({ tasteBootstrapOpen: false });
      void dependencies.writeBootstrapState({
        schemaVersion: 1,
        snoozedUntil: dependencies.now() + TASTE_BOOTSTRAP_SNOOZE_MS,
      });
    },

    async pickBatchResult(item: HistoryItem) {
      const state = store.getState();
      try {
        const snapshot = [...state.batchResults];
        assertCurrentFeedbackBatch(snapshot, store.getState().batchResults);
        const context = feedbackContext(item, snapshot);
        await state.selectBatchResult(item);
        assertCurrentFeedbackBatch(snapshot, store.getState().batchResults);
        const visualExemplars = await captureVisualExemplars([item], dependencies);
        assertCurrentFeedbackBatch(snapshot, store.getState().batchResults);
        await dependencies.appendFeedback({ ...context, type: "pick", itemId: item.id, visualExemplars });
        if (await refreshAfterFeedback(state)) state.pushToast("已记录你的选择", "success");
      } catch (error) {
        state.pushToast(`记录选择失败：${error instanceof Error ? error.message : String(error)}`, "error", 6000);
        throw error;
      }
    },

    async editBatchResult(input: { item: HistoryItem; items: HistoryItem[]; note: string }) {
      const state = store.getState();
      assertCurrentFeedbackBatch(input.items, state.batchResults);
      const context = feedbackContext(input.item, input.items);
      await state.reuseAsSource(input.item);
      const prepared = store.getState();
      const selectedPath = prepared.currentImage?.savedPath;
      const selectedSource = selectedPath
        ? prepared.sources.find((source) => source.path === selectedPath)
        : undefined;
      if (prepared.mode !== "edit" || prepared.currentImage?.id !== input.item.id || !selectedSource) {
        throw new Error("源图准备失败，请重试后再提交建议");
      }
      assertCurrentFeedbackBatch(input.items, prepared.batchResults);
      store.setState({ prompt: input.note, sources: [selectedSource] });
      const visualExemplars = await captureVisualExemplars([input.item], dependencies);
      assertCurrentFeedbackBatch(input.items, store.getState().batchResults);
      await dependencies.appendFeedback({
        ...context,
        type: "edit",
        itemId: input.item.id,
        note: input.note,
        visualExemplars,
      });
      const refreshed = await refreshAfterFeedback(state);
      const beforeSubmit = store.getState();
      const wasRunning = beforeSubmit.isRunning;
      try {
        await beforeSubmit.submit();
      } catch (error) {
        store.getState().pushToast(
          `建议已记录，但自动生图未启动：${error instanceof Error ? error.message : String(error)}。无需再次提交反馈`,
          "warn",
          7000,
        );
        return;
      }
      const submitted = store.getState();
      if (wasRunning || !submitted.isRunning) {
        const reason = submitted.errorMessage?.trim();
        submitted.pushToast(
          `建议已记录，但自动生图未启动${reason ? `：${reason}` : ""}。无需再次提交反馈`,
          "warn",
          7000,
        );
        return;
      }
      if (refreshed) {
        submitted.pushToast("已记录选择与建议，正在按建议生成新一批", "success", 6000, {
          label: "确认长期规则",
          onClick: () => store.setState({ tasteBootstrapOpen: true }),
        });
      }
    },

    async rejectBatch(input: { items: HistoryItem[]; note: string }) {
      const state = store.getState();
      const context = assertCurrentFeedbackBatch(input.items, state.batchResults);
      const visualExemplars = await captureVisualExemplars(input.items, dependencies);
      assertCurrentFeedbackBatch(input.items, store.getState().batchResults);
      state.closeResultGrid();
      await dependencies.appendFeedback({ ...context, type: "reject", note: input.note, visualExemplars });
      if (await refreshAfterFeedback(state)) {
        state.pushToast(input.note.trim() ? "已记录全否原因" : "已记录本批全部不满意", "success", 6000,
          input.note.trim()
            ? { label: "确认长期规则", onClick: () => store.setState({ tasteBootstrapOpen: true }) }
            : undefined);
      }
    },
  };
}
