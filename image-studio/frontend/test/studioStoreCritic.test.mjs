import assert from "node:assert/strict";
import test from "node:test";

const { createTasteCriticActions } = await import("../src/state/studioStore.critic.ts");

function historyItem(id, batchId = "batch-1") {
  return {
    id,
    batchId,
    prompt: "一名森林弓箭手，角色概念图",
    originalPrompt: "  一名森林弓箭手，角色概念图  ",
    submittedPrompt: "  一名森林弓箭手，角色概念图  ",
    mode: "generate",
    size: "1024x1024",
    quality: "high",
    createdAt: 1,
    savedPath: `C:\\images\\${id}.png`,
  };
}

function state(overrides = {}) {
  const items = [historyItem("img-1"), historyItem("img-2")];
  return {
    prompt: "  用户输入保持原样  ",
    profiles: [{
      id: "ai",
      name: "AI",
      apiMode: "responses",
      baseURL: "https://example.test/v1",
      textModelID: "gpt-test",
      imageModelID: "image-test",
      requestPolicy: "openai",
      responsesTransport: "sse",
      imagesNewAPICompat: false,
      allowInsecureConnection: false,
      reasoningEffort: "high",
      concurrencyLimit: 1,
      createdAt: 1,
    }],
    aiProfileId: "ai",
    activeProfileId: "ai",
    kernelRuntimeMode: "remote",
    proxyMode: "system",
    proxyURL: "",
    tasteProfile: {
      schemaVersion: 1,
      candidates: [{
        schemaVersion: 1,
        id: "rule-1",
        status: "approved",
        target: "critic",
        kind: "feedback",
        rule: "降低塑料质感",
        source: {
          type: "feedback",
          eventKey: "event-1",
          eventType: "reject",
          tags: [],
          inference: "explicit-feedback",
        },
      }],
      approvedCandidateIds: ["rule-1"],
      updatedAt: 1,
      bootstrapAcknowledged: true,
    },
    tasteCriticRunning: false,
    tasteCriticError: null,
    tasteCriticBatchId: null,
    batchResults: items,
    history: items,
    currentImage: items[0],
    resultDetail: items[1],
    compareB: items[1],
    pushToast() {},
    ...overrides,
  };
}

function adapter(initial) {
  let current = initial;
  return {
    getState: () => current,
    setState(patch) {
      current = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    },
  };
}

function validResponse() {
  return JSON.stringify({
    schemaVersion: 1,
    candidates: [
      {
        id: "img-2",
        score: 99,
        summary: "错误拼版",
        strengths: ["细节丰富"],
        issues: ["出现多视图"],
        observations: { multiplePrimarySubjects: false, multiViewLayout: true },
      },
      {
        id: "img-1",
        score: 88,
        summary: "单角色构图",
        strengths: ["主体清晰"],
        issues: [],
        observations: { multiplePrimarySubjects: false, multiViewLayout: false },
      },
    ],
  });
}

test("silent automatic review skips when no AI profile and never touches the prompt", async () => {
  const store = adapter(state({ profiles: [], aiProfileId: "", activeProfileId: "" }));
  let called = false;
  const actions = createTasteCriticActions(store, {
    listFeedback: async () => [],
    optimizePrompt: async () => { called = true; return ""; },
  });

  assert.equal(await actions.reviewBatchWithTasteCritic({ silent: true }), false);
  assert.equal(called, false);
  assert.equal(store.getState().prompt, "  用户输入保持原样  ");
  assert.equal(store.getState().tasteCriticError, null);
});

test("reviews candidates in attachment order, applies approved rules only, and persists DQ/top-3", async () => {
  const store = adapter(state());
  let optimizerRequest;
  let persisted;
  const actions = createTasteCriticActions(store, {
    listFeedback: async () => [],
    getStoredAPIKey: async () => "secret",
    ensureFullItem: async (item) => ({ ...item, imageB64: `base64-${item.id}` }),
    readImageAsBase64: async () => "",
    optimizePrompt: async (request) => {
      optimizerRequest = request;
      return validResponse();
    },
    persistReviews: async (items) => { persisted = items; },
    now: () => 1234,
    isAndroid: () => false,
  });

  assert.equal(await actions.reviewBatchWithTasteCritic(), true);
  assert.equal(store.getState().prompt, "  用户输入保持原样  ");
  assert.equal(optimizerRequest.mode, "critic");
  assert.deepEqual(optimizerRequest.sourceImages.map((source) => source.imageB64), ["base64-img-1", "base64-img-2"]);
  const envelope = JSON.parse(optimizerRequest.prompt);
  assert.equal(envelope.evaluationInput.originalPrompt, "  一名森林弓箭手，角色概念图  ");
  assert.deepEqual(envelope.evaluationInput.candidateOrder.map((entry) => entry.id), ["img-1", "img-2"]);
  assert.deepEqual(envelope.evaluationInput.criticRules.map((entry) => entry.rule), ["降低塑料质感"]);
  assert.equal("submittedPrompt" in envelope.evaluationInput, false);

  assert.equal(persisted[0].tasteReview.rank, 1);
  assert.equal(persisted[0].tasteReview.top3, true);
  assert.equal(persisted[1].tasteReview.disqualified, true);
  assert.equal(persisted[1].tasteReview.rank, null);
  assert.deepEqual(persisted[1].tasteReview.disqualificationReasons, ["multi-view-layout"]);
  assert.equal(store.getState().batchResults[0].tasteReview.reviewedAt, 1234);
  assert.equal(store.getState().history[1].tasteReview.disqualified, true);
  assert.equal(store.getState().currentImage.tasteReview.rank, 1);
  assert.equal(store.getState().resultDetail.tasteReview.disqualified, true);
  assert.equal(store.getState().tasteCriticRunning, false);
  assert.equal(store.getState().tasteCriticError, null);
});

test("appends persisted taste images after current candidates without reading them from history", async () => {
  const store = adapter(state());
  let optimizerRequest;
  const actions = createTasteCriticActions(store, {
    listFeedback: async () => [{
      id: "pick-1",
      type: "pick",
      batchId: "old-batch",
      originalPrompt: "old prompt",
      submittedPrompt: "old prompt",
      itemId: "liked",
      imageIds: ["liked"],
      note: null,
      createdAt: 10,
    }],
    listVisualExemplars: async (itemIds) => {
      assert.deepEqual(itemIds, ["liked"]);
      return [{
        itemId: "liked",
        savedPath: null,
        imageB64: "base64-liked",
        imageBlob: null,
        mimeType: "image/png",
        name: "liked.png",
        updatedAt: 10,
      }];
    },
    getStoredAPIKey: async () => "secret",
    ensureFullItem: async (item) => ({ ...item, imageB64: `base64-${item.id}` }),
    optimizePrompt: async (request) => {
      optimizerRequest = request;
      return validResponse();
    },
    persistReviews: async () => {},
    isAndroid: () => false,
  });

  assert.equal(await actions.reviewBatchWithTasteCritic(), true);
  assert.deepEqual(optimizerRequest.sourceImages.map((source) => source.imageB64), [
    "base64-img-1",
    "base64-img-2",
    "base64-liked",
  ]);
  const envelope = JSON.parse(optimizerRequest.prompt);
  assert.equal(envelope.evaluationInput.tasteExemplarOrder[0].itemId, "liked");
  assert.equal(envelope.evaluationInput.tasteExemplarOrder[0].attachmentPosition, 3);
  assert.equal(store.getState().prompt, "  用户输入保持原样  ");
});

test("uses a stored preview blob when a desktop exemplar path has moved", async () => {
  const store = adapter(state());
  let optimizerRequest;
  const fallback = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
  const actions = createTasteCriticActions(store, {
    listFeedback: async () => [{
      id: "pick-moved",
      type: "pick",
      batchId: "old-batch",
      originalPrompt: "old prompt",
      submittedPrompt: "old prompt",
      itemId: "moved",
      imageIds: ["moved"],
      note: null,
      createdAt: 10,
    }],
    listVisualExemplars: async () => [{
      itemId: "moved",
      savedPath: "C:\\gone\\moved.png",
      imageB64: null,
      imageBlob: fallback,
      mimeType: "image/webp",
      name: "moved.webp",
      updatedAt: 10,
    }],
    getStoredAPIKey: async () => "secret",
    ensureFullItem: async (item) => ({ ...item, imageB64: `base64-${item.id}` }),
    readImageAsBase64: async () => { throw new Error("file moved"); },
    optimizePrompt: async (request) => {
      optimizerRequest = request;
      return validResponse();
    },
    persistReviews: async () => {},
    isAndroid: () => false,
  });

  assert.equal(await actions.reviewBatchWithTasteCritic(), true);
  assert.equal(optimizerRequest.sourceImages[2].imageBlob, fallback);
  assert.equal(optimizerRequest.sourceImages[2].path, undefined);
  assert.deepEqual(optimizerRequest.imagePaths, [
    "C:\\images\\img-1.png",
    "C:\\images\\img-2.png",
  ]);
});

test("a failed review keeps the original batch and exposes a retryable error", async () => {
  const initial = state();
  const store = adapter(initial);
  const actions = createTasteCriticActions(store, {
    listFeedback: async () => [],
    getStoredAPIKey: async () => "secret",
    ensureFullItem: async (item) => ({ ...item, imageB64: "base64" }),
    optimizePrompt: async () => "not-json",
    persistReviews: async () => { throw new Error("must not persist"); },
    isAndroid: () => false,
  });

  assert.equal(await actions.reviewBatchWithTasteCritic({ silent: true }), false);
  assert.deepEqual(store.getState().batchResults, initial.batchResults);
  assert.match(store.getState().tasteCriticError, /strict JSON/);
  assert.equal(store.getState().tasteCriticRunning, false);
});
