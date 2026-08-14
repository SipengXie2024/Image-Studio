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
    inducedProposals: [...(options.inducedProposals ?? [])],
    curationProposals: [...(options.curationProposals ?? [])],
    profile: options.savedProfile ? structuredClone(options.savedProfile) : null,
    bootstrapState: null,
    clock: options.clock ?? 100,
  };
  const calls = {
    selected: [],
    reused: [],
    submitted: [],
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
    sources: structuredClone(options.sources ?? []),
    isRunning: false,
    errorMessage: null,
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
        const savedPath = item.savedPath ?? `C:\\images\\${item.id}.png`;
        state.mode = "edit";
        state.currentImage = { ...item, savedPath };
        if (!state.sources.some((source) => source.path === savedPath)) {
          state.sources.push({ path: savedPath, name: `${item.id}.png` });
        }
      }
    },
    async submit() {
      calls.submitted.push({
        prompt: state.prompt,
        sources: structuredClone(state.sources),
      });
      if (options.submitError) throw options.submitError;
      if (options.submitDoesNotStart) {
        state.errorMessage = options.submitErrorMessage ?? "上游配置无效";
        return;
      }
      state.isRunning = true;
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
      if (options.appendFeedbackError) throw options.appendFeedbackError;
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
    async listInducedProposals() {
      return structuredClone(data.inducedProposals);
    },
    async listCurationProposals() {
      return structuredClone(data.curationProposals);
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
  const item = historyItem("image-a", { savedPath: "C:\\images\\image-a.png" });
  const note = "  只把弓的纹样加深\r\n其他元素不要动。  ";
  const harness = createHarness({
    batchResults: [item],
    sources: [{ path: "C:\\images\\old-source.png", name: "old-source.png" }],
  });

  await harness.actions.editBatchResult({ item, items: [item], note });

  assert.equal(harness.data.feedback[0].note, note);
  assert.deepEqual(
    [...new TextEncoder().encode(harness.data.feedback[0].note)],
    [...new TextEncoder().encode(note)],
  );
  assert.equal(harness.state.prompt, note);
  assert.deepEqual(harness.calls.reused, ["image-a"]);
  assert.equal(harness.calls.submitted.length, 1);
  assert.deepEqual(harness.calls.submitted[0].sources.map((source) => source.path), [item.savedPath]);
  assert.deepEqual(
    [...new TextEncoder().encode(harness.calls.submitted[0].prompt)],
    [...new TextEncoder().encode(note)],
  );
  assert.equal(harness.calls.toasts.at(-1)?.kind, "success");
});

test("carries kept batch references into the rerun and records iteration continuity", async () => {
  const item = historyItem("image-a", {
    mode: "edit",
    savedPath: "C:\\images\\image-a.png",
    sourcePaths: ["C:\\refs\\pose.png", "C:\\refs\\palette.png"],
  });
  const harness = createHarness({
    batchResults: [item],
    sources: [
      { path: "C:\\refs\\pose.png", name: "pose.png", size: 123 },
      { path: "C:\\images\\stale-source.png", name: "stale-source.png" },
    ],
  });

  await harness.actions.editBatchResult({
    item,
    items: [item],
    note: "保持姿势，参考第二张的配色",
    keepSourcePaths: ["C:\\refs\\pose.png", "C:\\refs\\palette.png"],
  });

  assert.deepEqual(
    harness.calls.submitted[0].sources.map((source) => source.path),
    ["C:\\images\\image-a.png", "C:\\refs\\pose.png", "C:\\refs\\palette.png"],
  );
  // pose.png was still in the source tray, so its prepared entry is reused as-is.
  assert.equal(harness.calls.submitted[0].sources[1].size, 123);
  // palette.png was gone from the tray; a minimal path-only source is rebuilt.
  assert.equal(harness.calls.submitted[0].sources[2].name, "palette.png");
  assert.deepEqual(
    harness.calls.feedbackInputs[0].attachedSourcePaths,
    ["C:\\refs\\pose.png", "C:\\refs\\palette.png"],
  );
});

test("drops carry-over paths outside the batch generation and the base image itself", async () => {
  const item = historyItem("image-a", {
    mode: "edit",
    savedPath: "C:\\images\\image-a.png",
    sourcePaths: ["C:\\refs\\pose.png", "C:\\images\\image-a.png"],
  });
  const harness = createHarness({ batchResults: [item] });

  await harness.actions.editBatchResult({
    item,
    items: [item],
    note: "只改弓",
    keepSourcePaths: [
      "C:\\evil\\injected.png",
      "C:\\images\\image-a.png",
      "C:\\refs\\pose.png",
      "C:\\refs\\pose.png",
    ],
  });

  assert.deepEqual(
    harness.calls.submitted[0].sources.map((source) => source.path),
    ["C:\\images\\image-a.png", "C:\\refs\\pose.png"],
  );
  assert.deepEqual(harness.calls.feedbackInputs[0].attachedSourcePaths, ["C:\\refs\\pose.png"]);
});

test("leaves edit feedback without attached paths when nothing is carried over", async () => {
  const item = historyItem("image-a", {
    mode: "edit",
    savedPath: "C:\\images\\image-a.png",
    sourcePaths: ["C:\\refs\\pose.png"],
  });
  const harness = createHarness({ batchResults: [item] });

  await harness.actions.editBatchResult({ item, items: [item], note: "只改弓" });

  assert.deepEqual(
    harness.calls.submitted[0].sources.map((source) => source.path),
    ["C:\\images\\image-a.png"],
  );
  assert.equal(harness.calls.feedbackInputs[0].attachedSourcePaths, undefined);
});

test("keeps saved edit feedback closed when automatic generation cannot start", async () => {
  const item = historyItem("image-a", { savedPath: "C:\\images\\image-a.png" });
  const harness = createHarness({
    batchResults: [item],
    submitDoesNotStart: true,
    submitErrorMessage: "未配置图像模型",
  });

  await harness.actions.editBatchResult({ item, items: [item], note: "只改肌肉量" });

  assert.equal(harness.data.feedback.length, 1);
  assert.equal(harness.calls.submitted.length, 1);
  assert.equal(harness.calls.toasts.at(-1)?.kind, "warn");
  assert.match(harness.calls.toasts.at(-1)?.message ?? "", /无需再次提交反馈/);
  assert.match(harness.calls.toasts.at(-1)?.message ?? "", /未配置图像模型/);
});

test("turns an automatic submit exception into a warning after feedback is saved", async () => {
  const item = historyItem("image-a", { savedPath: "C:\\images\\image-a.png" });
  const harness = createHarness({
    batchResults: [item],
    submitError: new Error("transport unavailable"),
  });

  await harness.actions.editBatchResult({ item, items: [item], note: "只改肌肉量" });

  assert.equal(harness.data.feedback.length, 1);
  assert.equal(harness.calls.submitted.length, 1);
  assert.equal(harness.calls.toasts.at(-1)?.kind, "warn");
  assert.match(harness.calls.toasts.at(-1)?.message ?? "", /transport unavailable/);
  assert.match(harness.calls.toasts.at(-1)?.message ?? "", /无需再次提交反馈/);
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

test("refresh preserves refined rule text instead of regenerating the template", async () => {
  const item = historyItem("image-a", { savedPath: "C:\\images\\image-a.png" });
  const harness = createHarness({ batchResults: [item] });
  await harness.actions.rejectBatch({ items: [item], note: "脸漂移了" });
  const candidate = harness.state.tasteProfile.candidates.find((entry) => entry.source.type === "feedback");
  assert.ok(candidate, "reject with note should create a feedback candidate");
  const templateRule = candidate.rule;

  // Simulate a distill/manual edit persisted into the profile document.
  harness.data.profile = {
    ...harness.state.tasteProfile,
    candidates: harness.state.tasteProfile.candidates.map((entry) => (
      entry.id === candidate.id ? { ...entry, rule: "下装偏好短裙,避免短裤", refined: "ai" } : entry
    )),
  };

  await harness.actions.pickBatchResult(item);
  const refreshed = harness.state.tasteProfile.candidates.find((entry) => entry.id === candidate.id);
  assert.ok(refreshed);
  assert.equal(refreshed.rule, "下装偏好短裙,避免短裤");
  assert.equal(refreshed.refined, "ai");
  assert.notEqual(refreshed.rule, templateRule);
});

test("rejectBatch leaves a prompt retry offer only after feedback is stored", async () => {
  const first = historyItem("image-a");
  const second = historyItem("image-b");
  const harness = createHarness({ batchResults: [first, second] });

  await harness.actions.rejectBatch({ items: [first, second], note: "构图方向不对" });

  assert.deepEqual(harness.state.promptRetryOffer, {
    batchId: "batch-1",
    originalPrompt: first.originalPrompt,
    submittedPrompt: first.submittedPrompt,
    rejectNote: "构图方向不对",
    mode: "generate",
    sourcePaths: [],
    createdAt: 100,
  });
});

test("rejectBatch leaves no retry offer when feedback storage fails", async () => {
  const first = historyItem("image-a");
  const harness = createHarness({
    batchResults: [first],
    appendFeedbackError: new Error("storage unavailable"),
  });

  await assert.rejects(
    harness.actions.rejectBatch({ items: [first], note: "构图方向不对" }),
    /storage unavailable/,
  );
  assert.ok(!harness.state.promptRetryOffer);
});

test("pending induced candidates survive profile rebuilds and honor later decisions", async () => {
  const harness = createHarness({
    inducedProposals: [{
      id: "induced-1",
      rule: "评审时降低高光过曝的结果",
      evidence: "多条 reject 提到过曝",
      createdAt: 50,
    }],
  });

  await harness.actions.refreshTasteProfile();
  const first = harness.data.profile.candidates.find((entry) => entry.source.type === "induced");
  assert.ok(first, "induced proposal should surface as a candidate");
  assert.equal(first.status, "pending");
  assert.equal(first.rule, "评审时降低高光过曝的结果");
  assert.equal(first.source.evidence, "多条 reject 提到过曝");

  // A rebuild without any decision must not drop the still-pending candidate —
  // it is backed by its own fact table, not by the mutable profile snapshot.
  await harness.actions.refreshTasteProfile();
  const second = harness.data.profile.candidates.find((entry) => entry.id === first.id);
  assert.ok(second, "pending induced candidate must survive the rebuild");
  assert.equal(second.status, "pending");

  await harness.actions.decideTasteCandidate(first.id, "approve");
  assert.deepEqual(harness.data.profile.approvedCandidateIds, [first.id]);

  await harness.actions.refreshTasteProfile();
  const third = harness.data.profile.candidates.find((entry) => entry.id === first.id);
  assert.equal(third.status, "approved");
});

const { curatedProposalToTasteCandidate, inducedProposalToTasteCandidate } = await import("../src/lib/tasteLearning.ts");

function approvedInducedCandidate(proposalId, rule) {
  return { ...inducedProposalToTasteCandidate({ id: proposalId, rule }), status: "approved" };
}

test("curated merge proposals surface as pending candidates and survive rebuilds; retire proposals never do", async () => {
  const ruleA = approvedInducedCandidate("p-a", "评审时优先冷色调");
  const ruleB = approvedInducedCandidate("p-b", "评审时压低暖色");
  const harness = createHarness({
    savedProfile: {
      schemaVersion: 1,
      candidates: [ruleA, ruleB],
      approvedCandidateIds: [ruleA.id, ruleB.id],
      updatedAt: 1,
      bootstrapAcknowledged: true,
    },
    curationProposals: [
      {
        id: "curation-1",
        action: "merge",
        rule: "评审时保持冷色调基调,避免暖色偏移",
        replaces: [
          { candidateId: ruleA.id, rule: ruleA.rule },
          { candidateId: ruleB.id, rule: ruleB.rule },
        ],
        reason: "两条规则重叠",
        createdAt: 60,
      },
      {
        id: "curation-2",
        action: "retire",
        rule: null,
        replaces: [{ candidateId: ruleA.id, rule: ruleA.rule }],
        reason: "与另一条重复",
        createdAt: 61,
      },
    ],
  });

  await harness.actions.refreshTasteProfile();
  const curated = harness.data.profile.candidates.find((entry) => entry.source.type === "curated");
  assert.ok(curated, "merge proposal should surface as a candidate");
  assert.equal(curated.status, "pending");
  assert.equal(curated.source.proposalId, "curation-1");
  assert.deepEqual(
    curated.source.replaces.map((entry) => entry.candidateId).sort(),
    [ruleA.id, ruleB.id].sort(),
  );
  assert.equal(curated.source.reason, "两条规则重叠");
  // Exactly one curated candidate: the retire proposal must not create one.
  assert.equal(
    harness.data.profile.candidates.filter((entry) => entry.source.type === "curated").length,
    1,
  );

  await harness.actions.refreshTasteProfile();
  assert.ok(
    harness.data.profile.candidates.some((entry) => entry.id === curated.id && entry.status === "pending"),
    "pending curated candidate must survive the rebuild",
  );
});

test("approving a curated merge appends the approval first, then retires each replaced approved rule", async () => {
  const ruleA = approvedInducedCandidate("p-a", "评审时优先冷色调");
  const ruleB = approvedInducedCandidate("p-b", "评审时压低暖色");
  const merged = curatedProposalToTasteCandidate({
    id: "curation-1",
    action: "merge",
    rule: "评审时保持冷色调基调,避免暖色偏移",
    replaces: [
      { candidateId: ruleA.id, rule: ruleA.rule },
      { candidateId: ruleB.id, rule: ruleB.rule },
    ],
    reason: "重叠",
  });
  const harness = createHarness({
    savedProfile: {
      schemaVersion: 1,
      candidates: [ruleA, ruleB],
      approvedCandidateIds: [ruleA.id, ruleB.id],
      updatedAt: 1,
      bootstrapAcknowledged: true,
    },
    curationProposals: [{
      id: "curation-1",
      action: "merge",
      rule: merged.rule,
      replaces: merged.source.replaces,
      reason: "重叠",
      createdAt: 60,
    }],
  });

  await harness.actions.refreshTasteProfile();
  await harness.actions.decideTasteCandidate(merged.id, "approve");

  assert.deepEqual(
    harness.data.decisions.map((entry) => [entry.candidateId, entry.decision]),
    [
      [merged.id, "approve"],
      [ruleA.id, "reject"],
      [ruleB.id, "reject"],
    ],
    "approval must land before the replaced rules are retired",
  );
  const profile = harness.data.profile;
  assert.equal(profile.candidates.find((entry) => entry.id === merged.id).status, "approved");
  assert.equal(profile.candidates.find((entry) => entry.id === ruleA.id).status, "rejected");
  assert.equal(profile.candidates.find((entry) => entry.id === ruleB.id).status, "rejected");
});

test("curated approval skips replaced rules that are no longer approved", async () => {
  const ruleA = approvedInducedCandidate("p-a", "评审时优先冷色调");
  const ruleB = { ...inducedProposalToTasteCandidate({ id: "p-b", rule: "评审时压低暖色" }), status: "pending" };
  const merged = curatedProposalToTasteCandidate({
    id: "curation-1",
    action: "merge",
    rule: "评审时保持冷色调基调",
    replaces: [
      { candidateId: ruleA.id, rule: ruleA.rule },
      { candidateId: ruleB.id, rule: ruleB.rule },
    ],
  });
  const harness = createHarness({
    savedProfile: {
      schemaVersion: 1,
      candidates: [ruleA],
      approvedCandidateIds: [ruleA.id],
      updatedAt: 1,
      bootstrapAcknowledged: true,
    },
    inducedProposals: [{ id: "p-b", rule: "评审时压低暖色", evidence: null, createdAt: 40 }],
    curationProposals: [{
      id: "curation-1",
      action: "merge",
      rule: merged.rule,
      replaces: merged.source.replaces,
      reason: null,
      createdAt: 60,
    }],
  });

  await harness.actions.refreshTasteProfile();
  await harness.actions.decideTasteCandidate(merged.id, "approve");

  assert.deepEqual(
    harness.data.decisions.map((entry) => [entry.candidateId, entry.decision]),
    [
      [merged.id, "approve"],
      [ruleA.id, "reject"],
    ],
    "a pending replaced rule must not receive a reject decision",
  );
});

test("warns when an approval pushes the approved rule count past the budget", async () => {
  const bulk = Array.from({ length: 12 }, (_, index) => (
    approvedInducedCandidate(`bulk-${index}`, `评审规则占位第${index}条,内容各不相同`)
  ));
  const harness = createHarness({
    savedProfile: {
      schemaVersion: 1,
      candidates: bulk,
      approvedCandidateIds: bulk.map((entry) => entry.id),
      updatedAt: 1,
      bootstrapAcknowledged: true,
    },
    inducedProposals: [{ id: "p-new", rule: "评审时检查构图重心", evidence: null, createdAt: 40 }],
  });
  const fresh = inducedProposalToTasteCandidate({ id: "p-new", rule: "评审时检查构图重心" });

  await harness.actions.refreshTasteProfile();
  await harness.actions.decideTasteCandidate(fresh.id, "approve");

  assert.ok(
    harness.calls.toasts.some((toast) => toast.kind === "warn" && toast.message.includes("预算")),
    "crossing the budget must surface the curation nudge",
  );
});
