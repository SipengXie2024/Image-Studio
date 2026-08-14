import assert from "node:assert/strict";
import test from "node:test";

const { createTasteRuleActions, INDUCE_FROM_HISTORY_BUSY_ID } = await import("../src/state/studioStore.tasteRules.ts");
const { inducedProposalToTasteCandidate } = await import("../src/lib/tasteLearning.ts");

const INDUCED_RESPONSE = JSON.stringify({
  rules: [
    { rule: "评审时降低高光过曝的结果", evidence: "三条 reject 提到过曝" },
    { rule: "评审时优先保留冷色调", evidence: "modified 决定持续压暖色" },
  ],
});

function createHarness(options = {}) {
  const calls = {
    optimizeRequests: [],
    appended: [],
    refreshes: 0,
    toasts: [],
  };
  const state = {
    tasteRuleBusyId: options.busyId ?? null,
    tasteProfile: {
      schemaVersion: 1,
      candidates: [...(options.candidates ?? [])],
      approvedCandidateIds: [],
      updatedAt: 0,
      bootstrapAcknowledged: false,
    },
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
    async refreshTasteProfile() {
      calls.refreshes += 1;
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
  const actions = createTasteRuleActions(store, {
    optimizePrompt: async (request) => {
      calls.optimizeRequests.push(structuredClone(request));
      if (options.optimizeError) throw options.optimizeError;
      return options.optimizeResponse ?? INDUCED_RESPONSE;
    },
    getStoredAPIKey: async () => options.apiKey ?? "sk-test",
    writeProfile: async () => {},
    listFeedback: async () => structuredClone(options.feedback ?? []),
    listSuggestionDecisions: async () => structuredClone(options.suggestionDecisions ?? []),
    appendInducedProposal: async (input) => {
      if (options.appendError) throw options.appendError;
      const record = {
        id: `induced-${calls.appended.length + 1}`,
        rule: input.rule,
        evidence: input.evidence ?? null,
        createdAt: 100,
      };
      calls.appended.push(structuredClone(record));
      return record;
    },
    isAndroid: () => false,
    now: () => 100,
  });

  return { actions, calls, state };
}

const NOTED_FEEDBACK = [
  { id: "f1", type: "reject", note: "高光太爆", createdAt: 10 },
  { id: "f2", type: "pick", note: null, createdAt: 11 },
];

test("induces rules from history, persists proposals, and refreshes the profile", async () => {
  const harness = createHarness({ feedback: NOTED_FEEDBACK });

  await harness.actions.induceRulesFromHistory();

  assert.equal(harness.calls.optimizeRequests.length, 1);
  const request = harness.calls.optimizeRequests[0];
  assert.equal(request.mode, "induce-rules");
  const payload = JSON.parse(request.prompt);
  assert.equal(payload.operation, "induce-rules");
  assert.deepEqual(payload.feedbackCases, [{ type: "reject", note: "高光太爆" }]);

  assert.deepEqual(
    harness.calls.appended.map((entry) => [entry.rule, entry.evidence]),
    [
      ["评审时降低高光过曝的结果", "三条 reject 提到过曝"],
      ["评审时优先保留冷色调", "modified 决定持续压暖色"],
    ],
  );
  assert.equal(harness.calls.refreshes, 1);
  assert.equal(harness.state.tasteRuleBusyId, null);
  assert.ok(harness.calls.toasts.some((toast) => toast.kind === "success" && toast.message.includes("2 条")));
});

test("sends approved and rejected rule texts as context so the AI avoids repeats", async () => {
  const approved = {
    ...inducedProposalToTasteCandidate({ id: "p1", rule: "评审时优先冷色调" }),
    status: "approved",
  };
  const rejected = {
    ...inducedProposalToTasteCandidate({ id: "p2", rule: "评审时要求写实" }),
    status: "rejected",
  };
  const harness = createHarness({ feedback: NOTED_FEEDBACK, candidates: [approved, rejected] });

  await harness.actions.induceRulesFromHistory();

  const payload = JSON.parse(harness.calls.optimizeRequests[0].prompt);
  assert.deepEqual(payload.approvedRules, ["评审时优先冷色调"]);
  assert.deepEqual(payload.rejectedRules, ["评审时要求写实"]);
});

test("skips proposals whose rule text already exists as a candidate", async () => {
  const existing = inducedProposalToTasteCandidate({
    id: "old-proposal",
    rule: "评审时降低高光过曝的结果",
  });
  const harness = createHarness({ feedback: NOTED_FEEDBACK, candidates: [existing] });

  await harness.actions.induceRulesFromHistory();

  assert.deepEqual(
    harness.calls.appended.map((entry) => entry.rule),
    ["评审时优先保留冷色调"],
  );
  assert.equal(harness.calls.refreshes, 1);
});

test("does not call the AI when there is nothing to induce from", async () => {
  const harness = createHarness({ feedback: [{ id: "f1", type: "pick", note: "  ", createdAt: 1 }] });

  await harness.actions.induceRulesFromHistory();

  assert.equal(harness.calls.optimizeRequests.length, 0);
  assert.equal(harness.calls.appended.length, 0);
  assert.ok(harness.calls.toasts.some((toast) => toast.kind === "warn" && toast.message.includes("素材")));
  assert.equal(harness.state.tasteRuleBusyId, null);
});

test("reports when the AI finds no new pattern and appends nothing", async () => {
  const harness = createHarness({
    feedback: NOTED_FEEDBACK,
    optimizeResponse: JSON.stringify({ rules: [] }),
  });

  await harness.actions.induceRulesFromHistory();

  assert.equal(harness.calls.appended.length, 0);
  assert.equal(harness.calls.refreshes, 0);
  assert.ok(harness.calls.toasts.some((toast) => toast.kind === "warn"));
});

test("surfaces induction failures as an error toast and releases the busy flag", async () => {
  const harness = createHarness({
    feedback: NOTED_FEEDBACK,
    optimizeError: new Error("upstream down"),
  });

  await harness.actions.induceRulesFromHistory();

  assert.equal(harness.calls.appended.length, 0);
  assert.ok(harness.calls.toasts.some((toast) => (
    toast.kind === "error" && toast.message.includes("upstream down")
  )));
  assert.equal(harness.state.tasteRuleBusyId, null);
});

test("warns instead of calling the AI when no responses channel is configured", async () => {
  const harness = createHarness({
    feedback: NOTED_FEEDBACK,
    profiles: [{ id: "img", name: "生图", apiMode: "images", baseURL: "https://x", textModelID: "" }],
    aiProfileId: "img",
    activeProfileId: "img",
  });

  await harness.actions.induceRulesFromHistory();

  assert.equal(harness.calls.optimizeRequests.length, 0);
  assert.equal(harness.calls.appended.length, 0);
  assert.ok(harness.calls.toasts.some((toast) => toast.kind === "warn"));
  assert.equal(harness.state.tasteRuleBusyId, null);
});

test("re-entry is ignored while an induction run is already busy", async () => {
  const harness = createHarness({ feedback: NOTED_FEEDBACK, busyId: INDUCE_FROM_HISTORY_BUSY_ID });

  await harness.actions.induceRulesFromHistory();

  assert.equal(harness.calls.optimizeRequests.length, 0);
  assert.equal(harness.state.tasteRuleBusyId, INDUCE_FROM_HISTORY_BUSY_ID);
});
