import assert from "node:assert/strict";
import test from "node:test";

const { createPromptSuggestionActions } = await import("../src/state/studioStore.suggestion.ts");

function offer(overrides = {}) {
  return {
    batchId: "batch-1",
    originalPrompt: "  a forest archer\r\nchibi  ",
    submittedPrompt: "  a forest archer\r\nchibi  ",
    rejectNote: "人物比例太成熟",
    mode: "generate",
    sourcePaths: [],
    createdAt: 100,
    ...overrides,
  };
}

const DRAFT = "a forest archer, chibi, softer facial proportions";

function createHarness(options = {}) {
  const data = {
    feedback: [...(options.feedback ?? [])],
    suggestionDecisions: [...(options.suggestionDecisions ?? [])],
  };
  const calls = {
    submitted: [],
    clearedSources: 0,
    toasts: [],
    optimizeRequests: [],
    appended: [],
    outcomes: [],
  };
  const state = {
    promptRetryOffer: options.offer === null ? null : options.offer ?? offer(),
    promptSuggestion: options.suggestion ?? null,
    promptSuggestionDrafting: options.drafting ?? false,
    promptSuggestionSubmitting: false,
    tasteProfile: options.tasteProfile ?? {
      schemaVersion: 1,
      candidates: [],
      approvedCandidateIds: [],
      updatedAt: 0,
      bootstrapAcknowledged: false,
    },
    prompt: "untouched",
    sources: [{ path: "C:\\images\\old.png", name: "old.png" }],
    mode: "edit",
    editSourceMode: "manual",
    isRunning: options.isRunning ?? false,
    errorMessage: null,
    profiles: options.profiles ?? [{
      id: "profile-ai",
      name: "AI 渠道",
      apiMode: "responses",
      baseURL: "https://ai.example.com",
      textModelID: "gpt-5.5",
    }],
    aiProfileId: options.aiProfileId ?? "profile-ai",
    activeProfileId: options.activeProfileId ?? "profile-ai",
    proxyMode: "system",
    proxyURL: "",
    kernelRuntimeMode: "local",
    clearSources() {
      calls.clearedSources += 1;
      state.sources = [];
      state.mode = "generate";
      state.editSourceMode = "manual";
    },
    async submit(submitOptions) {
      calls.submitted.push({
        prompt: state.prompt,
        sources: structuredClone(state.sources),
        options: submitOptions ?? null,
      });
      if (options.submitError) throw options.submitError;
      if (options.submitDoesNotStart) {
        state.errorMessage = options.submitErrorMessage ?? "上游配置无效";
        return undefined;
      }
      state.isRunning = true;
      state.promptRetryOffer = null;
      return { batchId: options.newBatchId ?? "batch-new" };
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
    optimizePrompt: async (request) => {
      calls.optimizeRequests.push(structuredClone(request));
      if (options.optimizeBehavior) return options.optimizeBehavior(state);
      if (options.optimizeError) throw options.optimizeError;
      return options.draftResponse ?? DRAFT;
    },
    getStoredAPIKey: async () => options.apiKey ?? "sk-test",
    listRecentFeedback: async () => structuredClone(data.feedback),
    listRecentSuggestionDecisions: async () => structuredClone(data.suggestionDecisions),
    appendSuggestionOutcome: async (input) => {
      if (options.outcomeError) throw options.outcomeError;
      const record = { id: `suggestion-outcome-${calls.outcomes.length + 1}`, createdAt: 300, ...input };
      calls.outcomes.push(structuredClone(record));
      return record;
    },
    appendSuggestionDecision: async (input) => {
      if (options.appendError) throw options.appendError;
      const record = {
        id: `prompt-suggestion-${calls.appended.length + 1}`,
        batchId: input.batchId,
        originalPrompt: input.originalPrompt,
        rejectNote: input.rejectNote || null,
        draftPrompt: input.draftPrompt,
        finalPrompt: input.finalPrompt ?? null,
        decision: input.decision,
        createdAt: input.createdAt ?? 200,
      };
      calls.appended.push(structuredClone(record));
      return record;
    },
    isAndroid: () => options.isAndroid === true,
  };

  return {
    actions: createPromptSuggestionActions(store, dependencies),
    calls,
    data,
    state,
  };
}

test("drafting sends a suggest request built from the offer and opens the review modal", async () => {
  const harness = createHarness();
  await harness.actions.draftPromptSuggestion();

  assert.equal(harness.calls.optimizeRequests.length, 1);
  const request = harness.calls.optimizeRequests[0];
  assert.equal(request.mode, "suggest");
  assert.deepEqual(request.imagePaths, []);
  const parsed = JSON.parse(request.prompt);
  assert.equal(parsed.originalPrompt, offer().originalPrompt);
  assert.equal(parsed.rejectReason, offer().rejectNote);
  assert.equal(harness.state.promptSuggestion.draftPrompt, DRAFT);
  assert.equal(harness.state.promptSuggestionDrafting, false);
});

test("drafting sends only approved taste rules and reports the applied count", async () => {
  const candidate = (id, rule, status) => ({
    schemaVersion: 1,
    id,
    status,
    target: "critic",
    kind: "feedback",
    rule,
    source: { type: "feedback", eventId: `event-${id}`, note: rule, feedbackType: "reject" },
  });
  const harness = createHarness({
    tasteProfile: {
      schemaVersion: 1,
      candidates: [
        candidate("c-1", "评审时优先冷色调", "approved"),
        candidate("c-2", "避免高光过曝", "pending"),
        candidate("c-3", "画面要写实", "rejected"),
      ],
      approvedCandidateIds: ["c-1"],
      updatedAt: 0,
      bootstrapAcknowledged: false,
    },
  });

  await harness.actions.draftPromptSuggestion();

  const payload = JSON.parse(harness.calls.optimizeRequests[0].prompt);
  assert.deepEqual(payload.approvedRules, ["评审时优先冷色调"]);
  assert.equal(harness.state.promptSuggestion.appliedRuleCount, 1);
});

test("drafting without approved rules sends an empty rule list and zero count", async () => {
  const harness = createHarness();
  await harness.actions.draftPromptSuggestion();

  const payload = JSON.parse(harness.calls.optimizeRequests[0].prompt);
  assert.deepEqual(payload.approvedRules, []);
  assert.equal(harness.state.promptSuggestion.appliedRuleCount, 0);
});

test("drafting refuses to call the AI channel when no responses profile exists", async () => {
  const harness = createHarness({ profiles: [{ id: "img", name: "生图", apiMode: "images", baseURL: "https://x", textModelID: "" }] });
  await harness.actions.draftPromptSuggestion();

  assert.equal(harness.calls.optimizeRequests.length, 0);
  assert.equal(harness.state.promptSuggestion, null);
  assert.equal(harness.calls.toasts.some((toast) => toast.kind === "warn"), true);
});

test("drafting is single-flight while a request is in progress", async () => {
  const harness = createHarness({ drafting: true });
  await harness.actions.draftPromptSuggestion();
  assert.equal(harness.calls.optimizeRequests.length, 0);
});

test("a double-click cannot enqueue a second billable draft request", async () => {
  const harness = createHarness();
  const first = harness.actions.draftPromptSuggestion();
  const second = harness.actions.draftPromptSuggestion();
  await Promise.all([first, second]);

  assert.equal(harness.calls.optimizeRequests.length, 1);
  assert.equal(harness.state.promptSuggestionDrafting, false);
  assert.equal(harness.state.promptSuggestion.draftPrompt, DRAFT);
});

test("deciding against a superseded batch closes the orphan draft without recording", async () => {
  const harness = createHarness({ offer: null, suggestion: { offer: offer(), draftPrompt: DRAFT } });
  await harness.actions.decidePromptSuggestion({ decision: "accept", finalPrompt: DRAFT });

  assert.equal(harness.calls.appended.length, 0);
  assert.equal(harness.calls.submitted.length, 0);
  assert.equal(harness.state.promptSuggestion, null);
  assert.equal(harness.calls.toasts.some((toast) => toast.kind === "warn"), true);
});

test("a draft that returns after the offer expired is dropped", async () => {
  const harness = createHarness({
    optimizeBehavior: (state) => {
      state.promptRetryOffer = null;
      return DRAFT;
    },
  });
  await harness.actions.draftPromptSuggestion();
  assert.equal(harness.state.promptSuggestion, null);
});

test("accepting the draft records the decision before submitting a sourceless run", async () => {
  const harness = createHarness({ suggestion: { offer: offer(), draftPrompt: DRAFT } });
  await harness.actions.decidePromptSuggestion({ decision: "accept", finalPrompt: DRAFT });

  assert.equal(harness.calls.appended.length, 1);
  const record = harness.calls.appended[0];
  assert.equal(record.decision, "accepted");
  assert.equal(record.finalPrompt, DRAFT);
  assert.equal(record.rejectNote, "人物比例太成熟");

  assert.equal(harness.calls.submitted.length, 1);
  const submitted = harness.calls.submitted[0];
  assert.deepEqual(submitted.sources, []);
  assert.equal(submitted.prompt, DRAFT);
  assert.deepEqual(submitted.options, { promptProvenance: "user-controls", disableLoop: true });
  assert.equal(harness.calls.clearedSources, 1);
  assert.equal(harness.state.promptSuggestion, null);
  assert.equal(harness.state.promptRetryOffer, null);
  assert.equal(harness.state.promptSuggestionSubmitting, false);

  assert.equal(harness.calls.outcomes.length, 1);
  assert.equal(harness.calls.outcomes[0].decisionId, harness.calls.appended[0].id);
  assert.equal(harness.calls.outcomes[0].resultBatchId, "batch-new");
});

test("adopting a draft from an edit batch reruns with the same reference images", async () => {
  const editOffer = offer({
    mode: "edit",
    sourcePaths: ["C:\\images\\ref-1.png", "C:\\images\\ref-2.png"],
  });
  const harness = createHarness({ offer: editOffer, suggestion: { offer: editOffer, draftPrompt: DRAFT } });
  await harness.actions.decidePromptSuggestion({ decision: "accept", finalPrompt: DRAFT });

  assert.equal(harness.calls.clearedSources, 1);
  const submitted = harness.calls.submitted[0];
  assert.equal(harness.state.mode, "edit");
  assert.deepEqual(submitted.sources.map((source) => source.path), [
    "C:\\images\\ref-1.png",
    "C:\\images\\ref-2.png",
  ]);
  assert.equal(submitted.prompt, DRAFT);
});

test("an edited draft is recorded as modified with the user's final text verbatim", async () => {
  const finalText = "  a forest archer, chibi, rounder face\r\n  ";
  const harness = createHarness({ suggestion: { offer: offer(), draftPrompt: DRAFT } });
  await harness.actions.decidePromptSuggestion({ decision: "accept", finalPrompt: finalText });

  assert.equal(harness.calls.appended[0].decision, "modified");
  assert.equal(harness.calls.appended[0].finalPrompt, finalText);
  assert.equal(harness.calls.submitted[0].prompt, finalText);
});

test("rejecting the draft records the decision, keeps the offer, and never generates", async () => {
  const harness = createHarness({ suggestion: { offer: offer(), draftPrompt: DRAFT } });
  await harness.actions.decidePromptSuggestion({ decision: "reject" });

  assert.equal(harness.calls.appended[0].decision, "rejected");
  assert.equal(harness.calls.appended[0].finalPrompt, null);
  assert.equal(harness.calls.submitted.length, 0);
  assert.equal(harness.state.promptSuggestion, null);
  assert.notEqual(harness.state.promptRetryOffer, null);
});

test("a submit exception keeps exactly one recorded decision and warns without retrying", async () => {
  const harness = createHarness({
    suggestion: { offer: offer(), draftPrompt: DRAFT },
    submitError: new Error("network down"),
  });
  await harness.actions.decidePromptSuggestion({ decision: "accept", finalPrompt: DRAFT });

  assert.equal(harness.calls.appended.length, 1);
  assert.equal(harness.calls.submitted.length, 1);
  const warning = harness.calls.toasts.find((toast) => toast.kind === "warn");
  assert.match(warning.message, /无需再次操作/);
  assert.equal(harness.state.promptSuggestionSubmitting, false);
});

test("a submit that does not start warns while preserving the recorded decision", async () => {
  const harness = createHarness({
    suggestion: { offer: offer(), draftPrompt: DRAFT },
    submitDoesNotStart: true,
  });
  await harness.actions.decidePromptSuggestion({ decision: "accept", finalPrompt: DRAFT });

  assert.equal(harness.calls.appended.length, 1);
  const warning = harness.calls.toasts.find((toast) => toast.kind === "warn");
  assert.match(warning.message, /无需再次操作/);
});

test("a failed decision write keeps the modal open and never submits", async () => {
  const harness = createHarness({
    suggestion: { offer: offer(), draftPrompt: DRAFT },
    appendError: new Error("storage unavailable"),
  });
  await harness.actions.decidePromptSuggestion({ decision: "accept", finalPrompt: DRAFT });

  assert.equal(harness.calls.submitted.length, 0);
  assert.notEqual(harness.state.promptSuggestion, null);
  assert.equal(harness.calls.toasts.some((toast) => toast.kind === "error"), true);
  assert.equal(harness.state.promptSuggestionSubmitting, false);
});

test("dismissing the offer and closing the modal never write records", async () => {
  const harness = createHarness({ suggestion: { offer: offer(), draftPrompt: DRAFT } });
  harness.actions.closePromptSuggestion();
  harness.actions.dismissPromptRetryOffer();

  assert.equal(harness.state.promptSuggestion, null);
  assert.equal(harness.state.promptRetryOffer, null);
  assert.equal(harness.calls.appended.length, 0);
  assert.equal(harness.calls.submitted.length, 0);
});
