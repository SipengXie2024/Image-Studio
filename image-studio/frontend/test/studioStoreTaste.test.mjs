import assert from "node:assert/strict";
import test from "node:test";

const { createTasteActions } = await import("../src/state/studioStore.taste.ts");

function historyItem(id, overrides = {}) {
  return {
    id,
    prompt: "  original prompt\r\nwith spacing  ",
    originalPrompt: "  original prompt\r\nwith spacing  ",
    submittedPrompt: "  original prompt\r\nwith spacing  ",
    batchId: "batch-1",
    mode: "generate",
    size: "1024x1024",
    quality: "medium",
    createdAt: 1,
    ...overrides,
  };
}

function createHarness(options = {}) {
  const data = {
    history: [...(options.history ?? [])],
    feedback: [],
    decisions: [],
    profile: null,
    bootstrapState: null,
    clock: options.clock ?? 100,
  };
  const calls = {
    selected: [],
    reused: [],
    closed: 0,
    toasts: [],
    feedbackInputs: [],
  };
  const emptyProfile = {
    schemaVersion: 1,
    candidates: [],
    approvedCandidateIds: [],
    updatedAt: 0,
    bootstrapAcknowledged: false,
  };
  const state = {
    prompt: options.prompt ?? "prompt must remain untouched",
    mode: "generate",
    currentImage: null,
    batchResults: [...(options.batchResults ?? [])],
    tasteProfile: structuredClone(emptyProfile),
    tasteLoading: false,
    tasteBootstrapOpen: false,
    async selectBatchResult(item) {
      if (options.selectError) throw options.selectError;
      calls.selected.push(item.id);
    },
    async reuseAsSource(item) {
      calls.reused.push(item.id);
      if (options.reuseError) throw options.reuseError;
      if (!options.reuseSilentlyFails) {
        state.mode = "edit";
        state.currentImage = item;
      }
    },
    closeResultGrid() {
      calls.closed += 1;
    },
    pushToast(message, kind) {
      calls.toasts.push({ message, kind });
    },
  };
  const store = {
    getState: () => state,
    setState(patch) {
      Object.assign(state, typeof patch === "function" ? patch(state) : patch);
    },
  };
  const dependencies = {
    async loadHistory() {
      return structuredClone(data.history);
    },
    async appendFeedback(input) {
      calls.feedbackInputs.push(structuredClone(input));
      const event = {
        id: input.id ?? `feedback-${data.feedback.length + 1}`,
        type: input.type,
        batchId: input.batchId,
        originalPrompt: input.originalPrompt,
        submittedPrompt: input.submittedPrompt,
        itemId: input.itemId ?? null,
        imageIds: [...(input.imageIds ?? [])],
        note: input.note ?? null,
        createdAt: input.createdAt ?? data.clock,
      };
      data.feedback.push(structuredClone(event));
      return event;
    },
    async listFeedback() {
      if (options.refreshErrorAfterAppend && data.feedback.length > 0) {
        throw new Error("profile refresh unavailable");
      }
      return structuredClone(data.feedback);
    },
    async appendDecision(input) {
      const record = {
        id: `decision-${data.decisions.length + 1}`,
        candidateId: input.candidateId,
        decision: input.decision,
        createdAt: input.createdAt ?? data.clock,
      };
      data.decisions.push(structuredClone(record));
      return record;
    },
    async listDecisions(candidateId) {
      const records = candidateId === undefined
        ? data.decisions
        : data.decisions.filter((entry) => entry.candidateId === candidateId);
      return structuredClone(records);
    },
    async readProfile() {
      return data.profile === null ? null : structuredClone(data.profile);
    },
    async writeProfile(profile) {
      data.profile = structuredClone(profile);
    },
    async readBootstrapState() {
      return data.bootstrapState === null ? null : structuredClone(data.bootstrapState);
    },
    async writeBootstrapState(nextState) {
      data.bootstrapState = structuredClone(nextState);
    },
    fetchImageBlob: options.fetchImageBlob ?? (async () => null),
    readImageAsBase64: options.readImageAsBase64 ?? (async () => ""),
    isAndroid: () => options.isAndroid === true,
    now: () => data.clock,
  };

  return {
    actions: createTasteActions(store, dependencies),
    calls,
    data,
    state,
  };
}

test("persists note-free picks and empty-reason rejects as raw positive and negative exemplars", async () => {
  const first = historyItem("image-a");
  const second = historyItem("image-b");
  const harness = createHarness({ batchResults: [first, second] });

  await harness.actions.pickBatchResult(first);
  await harness.actions.rejectBatch({ items: [first, second], note: "" });

  assert.deepEqual(harness.data.feedback, [
    {
      id: "feedback-1",
      type: "pick",
      batchId: "batch-1",
      originalPrompt: first.originalPrompt,
      submittedPrompt: first.submittedPrompt,
      itemId: "image-a",
      imageIds: ["image-a", "image-b"],
      note: null,
      createdAt: 100,
    },
    {
      id: "feedback-2",
      type: "reject",
      batchId: "batch-1",
      originalPrompt: first.originalPrompt,
      submittedPrompt: first.submittedPrompt,
      itemId: null,
      imageIds: ["image-a", "image-b"],
      note: "",
      createdAt: 100,
    },
  ]);
  assert.equal(harness.state.tasteProfile.candidates.length, 0);
});

test("captures an independent preview fallback with explicit visual feedback", async () => {
  const previewBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
  const item = historyItem("image-persisted", {
    savedPath: "C:\\images\\image-persisted.png",
    previewBlob,
  });
  const harness = createHarness({ batchResults: [item] });

  await harness.actions.pickBatchResult(item);

  const [asset] = harness.calls.feedbackInputs[0].visualExemplars;
  assert.equal(asset.itemId, item.id);
  assert.equal(asset.savedPath, item.savedPath);
  assert.equal(asset.imageBlob.size, 3);
  assert.equal(asset.mimeType, "image/webp");
  assert.equal(asset.name, "image-persisted.png");
});

test("keeps a thumb fallback for Android visual feedback", async () => {
  const item = historyItem("image-android", { thumbPath: "memory://thumb/image-android" });
  const harness = createHarness({
    batchResults: [item],
    isAndroid: true,
    readImageAsBase64: async (path) => path === item.thumbPath ? "dGh1bWI=" : "",
  });

  await harness.actions.pickBatchResult(item);

  const [asset] = harness.calls.feedbackInputs[0].visualExemplars;
  assert.equal(asset.itemId, item.id);
  assert.equal(asset.savedPath, null);
  assert.equal(asset.imageB64, "dGh1bWI=");
});

test("does not save delayed visual feedback into a replacement batch", async () => {
  let releaseFetch;
  const fetchStarted = new Promise((resolve) => { releaseFetch = resolve; });
  let finishFetch;
  const fetched = new Promise((resolve) => { finishFetch = resolve; });
  const item = historyItem("image-old", { previewUrl: "blob:old" });
  const replacement = historyItem("image-new", { batchId: "batch-2" });
  const harness = createHarness({
    batchResults: [item],
    fetchImageBlob: async () => {
      releaseFetch();
      await fetched;
      return new Blob([new Uint8Array([1])], { type: "image/webp" });
    },
  });

  const pending = harness.actions.pickBatchResult(item);
  await fetchStarted;
  harness.state.batchResults = [replacement];
  finishFetch();

  await assert.rejects(pending, /批次已变化/);
  assert.equal(harness.data.feedback.length, 0);
});

test("preserves edit feedback verbatim and only places the user's own edit text in prompt", async () => {
  const item = historyItem("image-a");
  const note = "  只把弓的纹样加深\r\n其他元素不要动。  ";
  const harness = createHarness({ batchResults: [item] });

  await harness.actions.editBatchResult({ item, items: [item], note });

  assert.equal(harness.data.feedback[0].note, note);
  assert.deepEqual(
    [...new TextEncoder().encode(harness.data.feedback[0].note)],
    [...new TextEncoder().encode(note)],
  );
  assert.equal(harness.state.prompt, note);
  assert.deepEqual(harness.calls.reused, ["image-a"]);
});

test("does not append a pick when selecting the image fails", async () => {
  const item = historyItem("image-a");
  const harness = createHarness({ batchResults: [item], selectError: new Error("image unavailable") });

  await assert.rejects(harness.actions.pickBatchResult(item), /image unavailable/);

  assert.equal(harness.data.feedback.length, 0);
  assert.equal(harness.calls.toasts.at(-1)?.kind, "error");
});

test("does not append edit feedback when source preparation silently fails", async () => {
  const item = historyItem("image-a");
  const harness = createHarness({ batchResults: [item], reuseSilentlyFails: true });

  await assert.rejects(
    harness.actions.editBatchResult({ item, items: [item], note: "只改弓" }),
    /源图准备失败/,
  );

  assert.equal(harness.data.feedback.length, 0);
  assert.equal(harness.state.prompt, "prompt must remain untouched");
});

test("rejects a modal snapshot after the visible batch changes", async () => {
  const oldItems = [historyItem("old-a"), historyItem("old-b")];
  const harness = createHarness({ batchResults: oldItems });
  harness.state.batchResults = [historyItem("new-a", { batchId: "batch-2" })];

  await assert.rejects(
    harness.actions.rejectBatch({ items: oldItems, note: "不符合预期" }),
    /批次已变化/,
  );

  assert.equal(harness.data.feedback.length, 0);
  assert.equal(harness.calls.closed, 0);
});

test("does not mix edit feedback from an old modal into a new batch", async () => {
  const oldItems = [historyItem("old-a"), historyItem("old-b")];
  const harness = createHarness({ batchResults: oldItems });
  harness.state.batchResults = [historyItem("new-a", { batchId: "batch-2" })];

  await assert.rejects(
    harness.actions.editBatchResult({ item: oldItems[0], items: oldItems, note: "保留构图" }),
    /批次已变化/,
  );

  assert.equal(harness.data.feedback.length, 0);
  assert.deepEqual(harness.calls.reused, []);
});

test("does not invite a duplicate retry when the event is saved but profile refresh fails", async () => {
  const item = historyItem("image-a");
  const harness = createHarness({ batchResults: [item], refreshErrorAfterAppend: true });

  await harness.actions.pickBatchResult(item);

  assert.equal(harness.data.feedback.length, 1);
  assert.equal(harness.calls.toasts.at(-1)?.kind, "warn");
  assert.match(harness.calls.toasts.at(-1)?.message ?? "", /反馈已记录/);
});

test("keeps an approved candidate after its source history is cleared without writing its rule into prompt", async () => {
  const harness = createHarness({
    history: [historyItem("history-a", { styleTag: "low-saturation fantasy" })],
    prompt: "user prompt stays byte-identical",
  });

  await harness.actions.bootstrapTaste();
  const candidate = harness.state.tasteProfile.candidates[0];
  assert.ok(candidate);
  await harness.actions.decideTasteCandidate(candidate.id, "approve");

  harness.data.history = [];
  await harness.actions.rescanTasteHistory();

  assert.equal(harness.state.tasteProfile.candidates.length, 1);
  assert.equal(harness.state.tasteProfile.candidates[0].id, candidate.id);
  assert.equal(harness.state.tasteProfile.candidates[0].status, "approved");
  assert.deepEqual(harness.state.tasteProfile.approvedCandidateIds, [candidate.id]);
  assert.equal(harness.state.prompt, "user prompt stays byte-identical");
  assert.equal(harness.state.prompt.includes(candidate.rule), false);
});

test("chooses the newest duplicate decision independent of read order and timestamps a new choice later", async () => {
  const harness = createHarness({
    history: [historyItem("history-a", { negativePrompt: "multi-character collage" })],
    clock: 20,
  });
  await harness.actions.bootstrapTaste();
  const candidateId = harness.state.tasteProfile.candidates[0].id;
  harness.data.decisions = [
    { id: "decision-new", candidateId, decision: "reject", createdAt: 20 },
    { id: "decision-old", candidateId, decision: "approve", createdAt: 10 },
  ];

  await harness.actions.rescanTasteHistory();
  assert.equal(harness.state.tasteProfile.candidates[0].status, "rejected");

  await harness.actions.decideTasteCandidate(candidateId, "approve");
  const appended = harness.data.decisions.at(-1);
  assert.equal(appended.createdAt, 21);
  assert.equal(harness.state.tasteProfile.candidates[0].status, "approved");
});

test("snoozes 'later' for seven days without marking bootstrap acknowledged", async () => {
  const harness = createHarness({
    history: [historyItem("history-a", { styleTag: "ink" })],
    clock: 1_000,
  });
  await harness.actions.bootstrapTaste();
  assert.equal(harness.state.tasteBootstrapOpen, true);

  harness.actions.closeTasteBootstrap();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.state.tasteProfile.bootstrapAcknowledged, false);
  assert.equal(harness.data.bootstrapState.snoozedUntil, 1_000 + 7 * 24 * 60 * 60 * 1000);

  await harness.actions.bootstrapTaste();
  assert.equal(harness.state.tasteBootstrapOpen, false);
  harness.data.clock = harness.data.bootstrapState.snoozedUntil;
  await harness.actions.bootstrapTaste();
  assert.equal(harness.state.tasteBootstrapOpen, true);
});
