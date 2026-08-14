import {
  GetStoredAPIKey,
  OptimizePrompt,
  ReadImageAsBase64,
} from "../platform/runtime/host.ts";
import { readRuntimePlatformState } from "../platform/index.ts";
import { detectImageMimeTypeFromBase64 } from "../lib/images.ts";
import { aiChannelFailureMessage, resolveAIChannel } from "../lib/aiChannel.ts";
import { persistHistoryItems } from "../lib/storage.ts";
import {
  buildTasteCriticRequest,
  extractRecentTasteVisualExemplars,
  parseTasteCriticResponse,
  recentTasteVisualExemplarImageIds,
  serializeTasteCriticRequest,
} from "../lib/tasteCritic.ts";
import { buildApprovedCriticRulesSnapshot } from "../lib/tasteLearning.ts";
import { listTasteFeedback, listTasteVisualExemplars } from "../lib/tasteStorage.ts";
import type { TasteCriticHardGate, TasteVisualExemplar } from "../lib/tasteCritic.ts";
import type { PromptOptimizeRequest, StudioState } from "./studioStore.types.ts";
import type { HistoryItem, TasteReview } from "../types/domain.ts";

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

type CriticSourceImage = NonNullable<PromptOptimizeRequest["sourceImages"]>[number];

export interface TasteCriticActionDependencies {
  optimizePrompt: (request: PromptOptimizeRequest) => Promise<string>;
  getStoredAPIKey: (user: string) => Promise<string>;
  persistReviews: (items: HistoryItem[]) => Promise<void>;
  ensureFullItem: (item: HistoryItem, store: StateAdapter) => Promise<HistoryItem>;
  readImageAsBase64: (path: string) => Promise<string>;
  fetchImageBlob: (url: string) => Promise<Blob | null>;
  now: () => number;
  isAndroid: () => boolean;
  listFeedback: typeof listTasteFeedback;
  listVisualExemplars: typeof listTasteVisualExemplars;
}

const defaultDependencies: TasteCriticActionDependencies = {
  optimizePrompt: OptimizePrompt,
  getStoredAPIKey: GetStoredAPIKey,
  persistReviews: persistHistoryItems,
  ensureFullItem: async (item) => item,
  readImageAsBase64: ReadImageAsBase64,
  fetchImageBlob: async (url) => {
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
  },
  now: Date.now,
  isAndroid: () => readRuntimePlatformState().isAndroid,
  listFeedback: listTasteFeedback,
  listVisualExemplars: listTasteVisualExemplars,
};

function fileName(item: HistoryItem): string {
  return item.savedPath?.split(/[\\/]/).pop() || `${item.id}.png`;
}

async function prepareCriticSource(
  item: HistoryItem,
  store: StateAdapter,
  dependencies: TasteCriticActionDependencies,
): Promise<{ item: HistoryItem; source: CriticSourceImage }> {
  const full = await dependencies.ensureFullItem(item, store);
  let imageB64 = full.imageB64?.trim() ?? "";
  let imageBlob = full.imageBlob ?? null;

  if (!imageB64 && !imageBlob && full.savedPath) {
    imageB64 = await dependencies.readImageAsBase64(full.savedPath).catch(() => "");
  }
  if (!imageB64 && !imageBlob && full.fullUrl) {
    imageBlob = await dependencies.fetchImageBlob(full.fullUrl).catch(() => null);
  }
  if (!full.savedPath && !imageB64 && !imageBlob) {
    throw new Error(`无法读取候选图片：${full.id}`);
  }

  return {
    item: full,
    source: {
      path: full.savedPath,
      name: fileName(full),
      mimeType: detectImageMimeTypeFromBase64(imageB64) || imageBlob?.type || null,
      imageB64: imageB64 || undefined,
      imageBlob,
    },
  };
}

async function preparePersistedExemplarSource(
  image: TasteVisualExemplar["images"][number],
  dependencies: TasteCriticActionDependencies,
): Promise<{ path?: string; source: CriticSourceImage }> {
  let imageB64 = "";
  let readablePath: string | undefined;
  if (image.savedPath) {
    imageB64 = await dependencies.readImageAsBase64(image.savedPath).catch(() => "");
    if (imageB64) readablePath = image.savedPath;
  }
  imageB64 ||= image.imageB64?.trim() ?? "";
  const imageBlob = imageB64 ? null : image.imageBlob ?? null;
  if (!readablePath && !imageB64 && !imageBlob) {
    throw new Error(`无法读取品味判例图片：${image.itemId}`);
  }
  return {
    path: readablePath,
    source: {
      path: readablePath,
      name: image.name || image.savedPath?.split(/[\\/]/).pop() || `${image.itemId}.png`,
      mimeType: detectImageMimeTypeFromBase64(imageB64) || imageBlob?.type || image.mimeType || null,
      imageB64: imageB64 || undefined,
      imageBlob,
    },
  };
}

function patchReviewedItem(item: HistoryItem | null, reviews: ReadonlyMap<string, TasteReview>) {
  if (!item) return item;
  const tasteReview = reviews.get(item.id);
  return tasteReview ? { ...item, tasteReview } : item;
}

function configurationFailure(store: StateAdapter, message: string, silent: boolean): false {
  if (!silent) {
    store.setState({ tasteCriticError: message });
    store.getState().pushToast(message, "warn", 5000);
  }
  return false;
}

export function createTasteCriticActions(
  store: StateAdapter,
  overrides: Partial<TasteCriticActionDependencies> = {},
) {
  const dependencies: TasteCriticActionDependencies = { ...defaultDependencies, ...overrides };

  return {
    async reviewBatchWithTasteCritic(options: {
      items?: HistoryItem[];
      silent?: boolean;
      hardGateOverride?: TasteCriticHardGate;
    } = {}): Promise<boolean> {
      const initial = store.getState();
      if (initial.tasteCriticRunning) return false;
      const silent = options.silent === true;
      const items = options.items?.length ? [...options.items] : [...initial.batchResults];
      if (items.length === 0) return configurationFailure(store, "没有可评审的批次图片", silent);

      const batchIDs = new Set(items.map((item) => item.batchId).filter(Boolean));
      if (batchIDs.size > 1) return configurationFailure(store, "候选图片不属于同一批次", silent);
      const batchId = items[0].batchId || `selection:${items[0].id}`;
      const originalPrompt = items[0].originalPrompt ?? items[0].prompt;
      if (!originalPrompt) return configurationFailure(store, "这批结果缺少原始提示词", silent);
      if (items.some((item) => (item.originalPrompt ?? item.prompt) !== originalPrompt)) {
        return configurationFailure(store, "候选图片的原始提示词不一致", silent);
      }

      const resolution = await resolveAIChannel({
        profiles: initial.profiles,
        aiProfileId: initial.aiProfileId,
        activeProfileId: initial.activeProfileId,
        kernelRuntimeMode: initial.kernelRuntimeMode,
        isAndroid: dependencies.isAndroid,
        getStoredAPIKey: dependencies.getStoredAPIKey,
      });
      if (!resolution.ok) {
        return configurationFailure(store, aiChannelFailureMessage("AI 评审", resolution.failure), silent);
      }
      const { aiProfile, baseURL, textModelID, apiKey } = resolution.channel;

      store.setState({
        tasteCriticRunning: true,
        tasteCriticError: null,
        tasteCriticBatchId: batchId,
      });

      try {
        const prepared = await Promise.all(items.map((item) => prepareCriticSource(item, store, dependencies)));
        const feedback = await dependencies.listFeedback();
        const currentCandidateIDs = new Set(items.map((item) => item.id));
        const exemplarIDs = recentTasteVisualExemplarImageIds(feedback, 6, currentCandidateIDs);
        const exemplarAssets = await dependencies.listVisualExemplars(exemplarIDs);
        const exemplarGroups = extractRecentTasteVisualExemplars(
          feedback,
          exemplarAssets,
          6,
          currentCandidateIDs,
        );
        const exemplarInputs = exemplarGroups.flatMap((group) => group.images.map((image) => ({
            image,
            itemId: image.itemId,
            polarity: group.polarity,
            eventType: group.eventType,
            note: group.note,
        })));
        const preparedExemplars = (await Promise.all(exemplarInputs.map(async (entry) => {
          const preparedSource = await preparePersistedExemplarSource(entry.image, dependencies).catch(() => null);
          return preparedSource ? { ...entry, ...preparedSource } : null;
        }))).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        const rules = buildApprovedCriticRulesSnapshot(initial.tasteProfile.candidates);
        const request = buildTasteCriticRequest({
          originalPrompt,
          imageIds: items.map((item) => item.id),
          criticRules: rules,
          hardGateOverride: options.hardGateOverride,
          visualExemplars: preparedExemplars.map(({ itemId, polarity, eventType, note }) => ({
            itemId,
            polarity,
            eventType,
            note,
          })),
        });
        const sourceImages = [
          ...prepared.map(({ source }) => source),
          ...preparedExemplars.map(({ source }) => source),
        ];
        const raw = await dependencies.optimizePrompt({
          apiKey,
          prompt: serializeTasteCriticRequest(request),
          mode: "critic",
          baseURL,
          textModelID,
          proxyMode: initial.proxyMode,
          proxyURL: initial.proxyURL,
          allowInsecureConnection: aiProfile.allowInsecureConnection === true,
          imagePaths: [
            ...prepared.map(({ item }) => item.savedPath),
            ...preparedExemplars.map(({ path }) => path),
          ].filter((path): path is string => !!path),
          imagePath: "",
          sourceImages,
        });
        const result = parseTasteCriticResponse(raw, request);
        const reviewedAt = dependencies.now();
        const rankByID = new Map(result.ranking.map((candidate, index) => [candidate.id, index + 1]));
        const top3 = new Set(result.top3.map((candidate) => candidate.id));
        const reviews = new Map<string, TasteReview>();
        for (const candidate of result.candidates) {
          reviews.set(candidate.id, {
            schemaVersion: 1,
            criticRulesVersion: request.criticRulesVersion,
            appliedRuleCount: rules.rules.length,
            appliedExemplarCount: preparedExemplars.length,
            reviewedAt,
            score: candidate.score,
            summary: candidate.summary,
            strengths: [...candidate.strengths],
            issues: [...candidate.issues],
            observations: { ...candidate.observations },
            hardGate: { ...result.hardGate },
            disqualified: candidate.disqualified,
            disqualificationReasons: [...candidate.disqualificationReasons],
            rank: rankByID.get(candidate.id) ?? null,
            top3: top3.has(candidate.id),
          });
        }

        const persisted = items.map((item) => ({ ...item, tasteReview: reviews.get(item.id) }));
        await dependencies.persistReviews(persisted);
        store.setState((state) => ({
          history: state.history.map((item) => patchReviewedItem(item, reviews) as HistoryItem),
          batchResults: state.batchResults.map((item) => patchReviewedItem(item, reviews) as HistoryItem),
          currentImage: patchReviewedItem(state.currentImage, reviews),
          resultDetail: patchReviewedItem(state.resultDetail, reviews),
          compareB: patchReviewedItem(state.compareB, reviews),
          tasteCriticRunning: false,
          tasteCriticError: null,
          tasteCriticBatchId: batchId,
        }));
        if (!silent) store.getState().pushToast("AI 评审已完成", "success");
        return true;
      } catch (error) {
        const message = `AI 评审失败：${error instanceof Error ? error.message : String(error)}`;
        store.setState({
          tasteCriticRunning: false,
          tasteCriticError: message,
          tasteCriticBatchId: batchId,
        });
        if (!silent) store.getState().pushToast(message, "error", 6000);
        return false;
      }
    },
  };
}
