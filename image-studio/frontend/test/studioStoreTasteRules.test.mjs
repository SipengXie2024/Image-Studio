import assert from "node:assert/strict";
import test from "node:test";

const { createTasteRuleActions, CURATE_RULES_BUSY_ID, INDUCE_FROM_HISTORY_BUSY_ID } = await import("../src/state/studioStore.tasteRules.ts");
const { curatedProposalToTasteCandidate, inducedProposalToTasteCandidate } = await import("../src/lib/tasteLearning.ts");

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
    curationAppended: [],
    refreshes: 0,
    toasts: [],
  };
  const state = {
    tasteRuleBusyId: options.busyId ?? null,
    tastePanelOpen: true,
    ruleCuration: null,
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
    appendCurationProposal: async (input) => {
      if (options.appendError) throw options.appendError;
      const record = {
        id: `curation-${calls.curationAppended.length + 1}`,
        action: input.action,
        rule: input.rule ?? null,
        replaces: structuredClone(input.replaces),
        reason: input.reason ?? null,
        createdAt: input.createdAt ?? 100,
      };
      calls.curationAppended.push(structuredClone(record));
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

function approvedRule(proposalId, rule) {
  return { ...inducedProposalToTasteCandidate({ id: proposalId, rule }), status: "approved" };
}

const CURATION_RULES = [
  approvedRule("p-a", "评审时优先冷色调"),
  approvedRule("p-b", "评审时压低暖色"),
  approvedRule("p-c", "评审时检查构图重心"),
];

function curationResponse(proposals) {
  return JSON.stringify({ proposals });
}

test("curates rules: appends proposals, matches replaces to candidate ids, and opens the review modal", async () => {
  const harness = createHarness({
    candidates: CURATION_RULES,
    feedback: NOTED_FEEDBACK,
    optimizeResponse: curationResponse([
      {
        action: "merge",
        rule: "评审时保持冷色调基调,避免暖色偏移",
        replaces: ["评审时优先冷色调", "评审时压低暖色"],
        reason: "两条规则重叠",
      },
      { action: "retire", rule: null, replaces: ["评审时检查构图重心"], reason: "近期反馈不再支持" },
    ]),
  });

  await harness.actions.curateRules();

  const request = harness.calls.optimizeRequests[0];
  assert.equal(request.mode, "curate-rules");
  const payload = JSON.parse(request.prompt);
  assert.equal(payload.operation, "curate-rules");
  assert.deepEqual(payload.approvedRules, CURATION_RULES.map((entry) => entry.rule));
  assert.deepEqual(payload.feedbackCases, [{ type: "reject", note: "高光太爆" }]);

  assert.deepEqual(
    harness.calls.curationAppended.map((entry) => [entry.action, entry.rule]),
    [
      ["merge", "评审时保持冷色调基调,避免暖色偏移"],
      ["retire", null],
    ],
  );
  assert.deepEqual(
    harness.calls.curationAppended[0].replaces,
    [
      { candidateId: CURATION_RULES[0].id, rule: CURATION_RULES[0].rule },
      { candidateId: CURATION_RULES[1].id, rule: CURATION_RULES[1].rule },
    ],
    "AI-quoted texts must be matched onto approved candidate ids",
  );

  assert.equal(harness.state.tastePanelOpen, false, "the taste panel closes so the review modal stands alone");
  assert.ok(harness.state.ruleCuration, "the explicit review modal must open");
  const items = harness.state.ruleCuration.items;
  assert.equal(items.length, 2);
  assert.equal(items[0].action, "merge");
  assert.equal(items[0].rule, "评审时保持冷色调基调,避免暖色偏移");
  assert.equal(items[1].action, "retire");
  assert.equal(items[1].candidateId, CURATION_RULES[2].id, "retire items target the existing approved candidate");
  assert.equal(items[1].rule, CURATION_RULES[2].rule);
  assert.equal(harness.calls.refreshes, 1);
  assert.equal(harness.state.tasteRuleBusyId, null);
});

test("curation needs at least two approved rules", async () => {
  const harness = createHarness({ candidates: [CURATION_RULES[0]] });

  await harness.actions.curateRules();

  assert.equal(harness.calls.optimizeRequests.length, 0);
  assert.ok(harness.calls.toasts.some((toast) => toast.kind === "warn" && toast.message.includes("不足")));
});

test("an empty proposals array reports a tight rule set and opens nothing", async () => {
  const harness = createHarness({
    candidates: CURATION_RULES,
    optimizeResponse: curationResponse([]),
  });

  await harness.actions.curateRules();

  assert.equal(harness.calls.curationAppended.length, 0);
  assert.equal(harness.state.ruleCuration, null);
  assert.equal(harness.state.tastePanelOpen, true);
  assert.ok(harness.calls.toasts.some((toast) => toast.kind === "success" && toast.message.includes("紧凑")));
});

test("proposals quoting unknown rules are dropped whole as hallucination defense", async () => {
  const harness = createHarness({
    candidates: CURATION_RULES,
    optimizeResponse: curationResponse([
      {
        action: "merge",
        rule: "合并出的新规则",
        replaces: ["评审时优先冷色调", "这条规则并不存在"],
        reason: null,
      },
    ]),
  });

  await harness.actions.curateRules();

  assert.equal(harness.calls.curationAppended.length, 0);
  assert.equal(harness.state.ruleCuration, null);
  assert.ok(harness.calls.toasts.some((toast) => toast.kind === "warn" && toast.message.includes("对不上")));
});

test("a previously rejected merge text does not resurface; a pending duplicate re-enters review without a second append", async () => {
  const mergedRule = "评审时保持冷色调基调";
  const rejectedProbe = {
    ...curatedProposalToTasteCandidate({
      id: "old", action: "merge", rule: mergedRule,
      replaces: [{ candidateId: CURATION_RULES[0].id, rule: CURATION_RULES[0].rule }],
    }),
    status: "rejected",
  };
  const rejectedHarness = createHarness({
    candidates: [...CURATION_RULES, rejectedProbe],
    optimizeResponse: curationResponse([
      { action: "merge", rule: mergedRule, replaces: ["评审时优先冷色调"], reason: null },
    ]),
  });
  await rejectedHarness.actions.curateRules();
  assert.equal(rejectedHarness.calls.curationAppended.length, 0);
  assert.equal(rejectedHarness.state.ruleCuration, null);

  const pendingProbe = { ...rejectedProbe, status: "pending" };
  const pendingHarness = createHarness({
    candidates: [...CURATION_RULES, pendingProbe],
    optimizeResponse: curationResponse([
      { action: "merge", rule: mergedRule, replaces: ["评审时优先冷色调"], reason: null },
    ]),
  });
  await pendingHarness.actions.curateRules();
  assert.equal(pendingHarness.calls.curationAppended.length, 0, "no duplicate fact-table append");
  assert.ok(pendingHarness.state.ruleCuration, "a still-pending duplicate re-enters the review modal");
  assert.equal(pendingHarness.state.ruleCuration.items.length, 1);
});

test("curation failures surface as an error toast and release the busy flag", async () => {
  const harness = createHarness({
    candidates: CURATION_RULES,
    optimizeError: new Error("upstream down"),
  });

  await harness.actions.curateRules();

  assert.equal(harness.calls.curationAppended.length, 0);
  assert.ok(harness.calls.toasts.some((toast) => toast.kind === "error" && toast.message.includes("upstream down")));
  assert.equal(harness.state.tasteRuleBusyId, null);
});

test("curation re-entry is ignored while a run is busy", async () => {
  const harness = createHarness({ candidates: CURATION_RULES, busyId: CURATE_RULES_BUSY_ID });

  await harness.actions.curateRules();

  assert.equal(harness.calls.optimizeRequests.length, 0);
  assert.equal(harness.state.tasteRuleBusyId, CURATE_RULES_BUSY_ID);
});
