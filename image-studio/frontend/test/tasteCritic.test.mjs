import assert from "node:assert/strict";
import test from "node:test";

const critic = await import("../src/lib/tasteCritic.ts");

function rules(overrides = {}) {
  return {
    schemaVersion: 1,
    target: "critic",
    version: "critic-test",
    rules: [
      {
        candidateId: "taste-1",
        rule: "评审时降低出现塑料质感的结果",
        sourceType: "feedback",
      },
    ],
    ...overrides,
  };
}

function request(overrides = {}) {
  return critic.buildTasteCriticRequest({
    originalPrompt: "一名森林怪物女孩弓箭手，游戏角色概念图",
    imageIds: ["img-1", "img-2", "img-3", "img-4"],
    criticRules: rules(),
    ...overrides,
  });
}

function responseCandidate(id, score, observations = {}) {
  return {
    id,
    score,
    summary: `${id} summary`,
    strengths: ["造型清晰"],
    issues: [],
    observations: {
      multiplePrimarySubjects: false,
      multiViewLayout: false,
      ...observations,
    },
  };
}

test("enables the hard gate only for an explicit single-subject concept-art prompt", () => {
  assert.equal(
    critic.classifyTasteCriticHardGate("一名森林怪物女孩弓箭手，游戏角色概念图").enabled,
    true,
  );
  assert.equal(
    critic.classifyTasteCriticHardGate("A single fantasy hero character concept art").enabled,
    true,
  );
  assert.equal(
    critic.classifyTasteCriticHardGate("森林怪物女孩弓箭手").enabled,
    true,
  );
  assert.equal(
    critic.classifyTasteCriticHardGate("solo concert poster").enabled,
    false,
  );
});

test("natural character prompts use the hard gate unless they clearly request another subject", () => {
  assert.equal(critic.classifyTasteCriticHardGate("forest monster girl archer").enabled, true);
  assert.equal(critic.classifyTasteCriticHardGate("森林女孩弓箭手与一条龙对决").enabled, false);
  assert.equal(critic.classifyTasteCriticHardGate("girl archer fighting a dragon").enabled, false);
});

test("explicit multi-subject, sheet, and turnaround requests always disable the hard gate", () => {
  const prompts = [
    "一名英雄和两名同伴的多人游戏角色概念图",
    "两个女孩在森林里冒险",
    "两个精灵角色概念图",
    "一个角色的三视图角色概念设计",
    "一个角色的正面和背面",
    "角色动作分镜故事板",
    "同一角色的服装方案并排展示",
    "single character concept art, front side back turnaround",
    "single elf character, front and back views",
    "single hero character concept art contact sheet",
    "a storyboard for an elf character entrance",
    "character outfit options side by side",
    "two elves in a forest",
    "two characters concept art",
  ];
  for (const prompt of prompts) {
    assert.equal(critic.classifyTasteCriticHardGate(prompt).enabled, false, prompt);
  }
});

test("negative constraints against multi-character layouts do not disable a clear single request", () => {
  assert.equal(
    critic.classifyTasteCriticHardGate(
      "一名森林弓箭手，角色概念图，不要多角色，不要拼版，不要三视图",
    ).enabled,
    true,
  );
  assert.equal(
    critic.classifyTasteCriticHardGate(
      "single hero character concept art, without multiple characters or a contact sheet",
    ).enabled,
    true,
  );
  assert.equal(
    critic.classifyTasteCriticHardGate(
      "一名精灵角色，不要画两个精灵，不要做正面和背面，不要多套服装方案，不要服装方案并排",
    ).enabled,
    true,
  );
  assert.equal(
    critic.classifyTasteCriticHardGate("一名森林弓箭手，角色概念图，不要再加一个对手").enabled,
    true,
  );
  assert.equal(
    critic.classifyTasteCriticHardGate(
      "single elf character, without two elves, no storyboard, without multiple outfit options, do not show outfit options side by side",
    ).enabled,
    true,
  );
});

test("inherits a reviewed source hard gate for a short edit delta without changing its bytes", () => {
  const editNote = "  上身和腿部的肌肉量再增加一点\r\n背景纯白  ";
  const singleSourceGate = critic.classifyTasteCriticHardGate("一名森林弓箭手，角色概念图");
  const inheritedGate = critic.resolveEditTasteCriticHardGate({
    editPrompt: editNote,
    sourceHardGate: singleSourceGate,
  });
  const built = request({
    originalPrompt: editNote,
    imageIds: ["edit-1"],
    hardGateOverride: inheritedGate,
  });
  const parsed = critic.parseTasteCriticResponse({
    schemaVersion: 1,
    candidates: [responseCandidate("edit-1", 95, { multiViewLayout: true })],
  }, built);

  assert.equal(built.originalPrompt, editNote);
  assert.deepEqual([...new TextEncoder().encode(built.originalPrompt)], [...new TextEncoder().encode(editNote)]);
  assert.equal(built.hardGate.enabled, true);
  assert.equal(parsed.candidates[0].disqualified, true);
  assert.deepEqual(parsed.candidates[0].disqualificationReasons, ["multi-view-layout"]);
});

test("keeps the hard gate disabled when a short edit inherits an explicit multi-subject source", () => {
  const multiSourceGate = critic.classifyTasteCriticHardGate("两个精灵角色概念图");
  const built = request({
    originalPrompt: "背景改成纯白",
    imageIds: ["edit-1"],
    hardGateOverride: multiSourceGate,
  });
  const parsed = critic.parseTasteCriticResponse({
    schemaVersion: 1,
    candidates: [responseCandidate("edit-1", 95, { multiplePrimarySubjects: true })],
  }, built);

  assert.equal(built.hardGate.enabled, false);
  assert.equal(parsed.candidates[0].disqualified, false);
});

test("an explicit second-character edit overrides an enabled source hard gate", () => {
  const sourceGate = critic.classifyTasteCriticHardGate("一名森林弓箭手，角色概念图");
  const editPrompt = "保留现有角色，再加一个对手站在旁边";
  const resolved = critic.resolveEditTasteCriticHardGate({
    editPrompt,
    sourceHardGate: sourceGate,
  });
  const built = request({
    originalPrompt: editPrompt,
    imageIds: ["edit-1"],
    hardGateOverride: resolved,
  });
  const parsed = critic.parseTasteCriticResponse({
    schemaVersion: 1,
    candidates: [responseCandidate("edit-1", 95, { multiplePrimarySubjects: true })],
  }, built);

  assert.equal(resolved.enabled, false);
  assert.equal(parsed.candidates[0].disqualified, false);
});

test("an explicit additional-view edit also overrides an enabled source hard gate", () => {
  const sourceGate = critic.classifyTasteCriticHardGate("一名森林弓箭手，角色概念图");
  const resolved = critic.resolveEditTasteCriticHardGate({
    editPrompt: "保留正面，再加一个背面视图",
    sourceHardGate: sourceGate,
  });

  assert.equal(resolved.enabled, false);
});

test("does not mistake increasing a character trait for adding another character", () => {
  const sourceGate = critic.classifyTasteCriticHardGate("一名森林弓箭手，角色概念图");
  const resolved = critic.resolveEditTasteCriticHardGate({
    editPrompt: "增加角色的肌肉量和正面光照",
    sourceHardGate: sourceGate,
  });

  assert.equal(resolved.enabled, true);
});

test("runs the critic and replacement loop for ordinary multi-result generate and edit batches", () => {
  assert.equal(critic.shouldRunTasteCriticLoop("generate", 3, false, false), true);
  assert.equal(critic.shouldRunTasteCriticLoop("edit", 3, false, false), true);
  assert.equal(critic.shouldRunTasteCriticLoop("edit", 1, false, false), false);
  assert.equal(critic.shouldRunTasteCriticLoop("edit", 3, true, false), false);
  assert.equal(critic.shouldRunTasteCriticLoop("edit", 3, false, true), false);
});

test("builds an immutable critic-only request with exact prompt bytes and a strict schema", () => {
  const originalPrompt = "  一名弓箭手\r\n角色概念图，keep  two spaces  ";
  const snapshot = rules();
  const before = structuredClone(snapshot);
  const built = request({ originalPrompt, criticRules: snapshot });

  assert.equal(built.operation, "critic");
  assert.equal(built.originalPrompt, originalPrompt);
  assert.deepEqual([...new TextEncoder().encode(built.originalPrompt)], [...new TextEncoder().encode(originalPrompt)]);
  assert.equal("submittedPrompt" in built, false);
  assert.equal("prompt" in built, false);
  assert.match(built.instructions, /never rewrite, expand, or improve the prompt/i);
  assert.match(built.instructions, /JSON only/i);
  assert.deepEqual(snapshot, before);

  const input = JSON.parse(built.inputText);
  assert.equal(input.originalPrompt, originalPrompt);
  assert.deepEqual(input.candidateOrder.map((item) => item.id), built.imageIds);
  assert.deepEqual(input.criticRules, snapshot.rules);
  assert.equal(input.submittedPrompt, undefined);
  assert.equal(built.responseSchema.additionalProperties, false);
  assert.equal(built.responseSchema.properties.candidates.minItems, built.imageIds.length);
  assert.equal(built.responseSchema.properties.candidates.maxItems, built.imageIds.length);
});

test("adds explicit visual exemplars after candidates without turning them into ranked outputs", () => {
  const built = request({
    imageIds: ["new-1", "new-2"],
    visualExemplars: [
      { itemId: "liked", polarity: "positive", eventType: "pick", note: null },
      { itemId: "rejected", polarity: "negative", eventType: "reject", note: "  不要塑料感  " },
    ],
  });
  const input = JSON.parse(built.inputText);
  assert.deepEqual(built.exemplarImageIds, ["liked", "rejected"]);
  assert.deepEqual(input.candidateOrder.map((entry) => entry.id), ["new-1", "new-2"]);
  assert.deepEqual(input.tasteExemplarOrder.map((entry) => entry.attachmentPosition), [3, 4]);
  assert.equal(input.tasteExemplarOrder[1].note, "  不要塑料感  ");
  assert.equal(built.responseSchema.properties.candidates.maxItems, 2);
});

test("treats edit exemplars as baselines with a verbatim required delta", () => {
  const built = request({
    visualExemplars: [
      { itemId: "selected", polarity: "positive", eventType: "edit", note: "  腿部肌肉再明显一点\r\n其他元素不变  " },
    ],
  });

  const input = JSON.parse(built.inputText);
  assert.equal(input.tasteExemplarOrder[0].note, "  腿部肌肉再明显一点\r\n其他元素不变  ");
  assert.match(built.instructions, /edit exemplar is a selected baseline/i);
  assert.match(built.instructions, /note as the required change/i);
});

test("rejects invalid candidate ids and non-critic rule snapshots", () => {
  assert.throws(() => request({ imageIds: [] }), /at least one/);
  assert.throws(() => request({ imageIds: ["img-1", " img-1 "] }), /unique/);
  assert.throws(
    () => request({ criticRules: rules({ target: "generator" }) }),
    /critic-only/,
  );
  assert.throws(
    () => request({ criticRules: rules({ rules: [rules().rules[0], rules().rules[0]] }) }),
    /duplicate critic rule/,
  );
});

test("derives DQ locally, excludes DQ candidates from ranking, and returns top three", () => {
  const built = request();
  const raw = {
    schemaVersion: 1,
    candidates: [
      responseCandidate("img-4", 88),
      responseCandidate("img-2", 99, { multiViewLayout: true }),
      responseCandidate("img-1", 88),
      responseCandidate("img-3", 75),
    ],
  };
  const result = critic.parseTasteCriticResponse(JSON.stringify(raw), built);

  assert.deepEqual(result.candidates.map((item) => item.id), built.imageIds);
  assert.equal(result.candidates[1].disqualified, true);
  assert.deepEqual(result.candidates[1].disqualificationReasons, ["multi-view-layout"]);
  assert.deepEqual(result.ranking.map((item) => item.id), ["img-1", "img-4", "img-3"]);
  assert.deepEqual(result.top3.map((item) => item.id), ["img-1", "img-4", "img-3"]);
  assert.equal(result.ranking.some((item) => item.id === "img-2"), false);
});

test("the same visual observations are not DQ when the prompt intentionally requests a sheet", () => {
  const built = request({
    originalPrompt: "single character concept art, three-view turnaround sheet",
    imageIds: ["sheet"],
  });
  const result = critic.parseTasteCriticResponse({
    schemaVersion: 1,
    candidates: [responseCandidate("sheet", 96, {
      multiplePrimarySubjects: true,
      multiViewLayout: true,
    })],
  }, built);

  assert.equal(built.hardGate.enabled, false);
  assert.equal(result.candidates[0].disqualified, false);
  assert.deepEqual(result.ranking.map((item) => item.id), ["sheet"]);
});

test("strict parsing rejects markdown, extra keys, duplicate ids, and invalid scores", () => {
  const built = request({ imageIds: ["img-1", "img-2"] });
  const valid = {
    schemaVersion: 1,
    candidates: [responseCandidate("img-1", 80), responseCandidate("img-2", 70)],
  };

  assert.throws(
    () => critic.parseTasteCriticResponse(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, built),
    /strict JSON/,
  );
  assert.throws(
    () => critic.parseTasteCriticResponse({ ...valid, ranking: ["img-1"] }, built),
    /exactly/,
  );
  assert.throws(
    () => critic.parseTasteCriticResponse({
      schemaVersion: 1,
      candidates: [responseCandidate("img-1", 80), responseCandidate("img-1", 70)],
    }, built),
    /duplicate candidate id/,
  );
  assert.throws(
    () => critic.parseTasteCriticResponse({
      schemaVersion: 1,
      candidates: [responseCandidate("img-1", 101), responseCandidate("img-2", 70)],
    }, built),
    /between 0 and 100/,
  );
});

test("extracts only explicit recent visual exemplars without attaching them to critic candidates", () => {
  const assets = [
    { itemId: "picked", savedPath: "picked.png", imageB64: null, imageBlob: null, mimeType: null, name: null, updatedAt: 10 },
    { itemId: "rejected", savedPath: null, imageB64: "rejected-b64", imageBlob: null, mimeType: "image/png", name: "rejected.png", updatedAt: 20 },
  ];
  const events = [
    { id: "old-pick", type: "pick", batchId: "b1", originalPrompt: "P1", submittedPrompt: "P1", itemId: "picked", imageIds: ["picked", "rejected"], note: null, createdAt: 10 },
    { id: "new-reject", type: "reject", batchId: "b2", originalPrompt: "P2", submittedPrompt: "P2", itemId: null, imageIds: ["rejected", "missing"], note: "  原话保留  ", createdAt: 20 },
  ];

  const exemplars = critic.extractRecentTasteVisualExemplars(events, assets, 2);
  assert.deepEqual(exemplars.map((entry) => entry.eventId), ["new-reject", "old-pick"]);
  assert.equal(exemplars[0].polarity, "negative");
  assert.equal(exemplars[0].note, "  原话保留  ");
  assert.deepEqual(exemplars[0].images.map((image) => image.itemId), ["rejected"]);
  assert.equal(exemplars[0].images[0].imageB64, "rejected-b64");
  assert.equal(exemplars[1].polarity, "positive");
  assert.deepEqual(exemplars[1].images.map((image) => image.itemId), ["picked"]);
});

test("the newest explicit decision wins when the same image has conflicting feedback", () => {
  const assets = [{ itemId: "same", savedPath: "same.png", imageB64: null, imageBlob: null, mimeType: null, name: null, updatedAt: 20 }];
  const events = [
    { id: "old-pick", type: "pick", batchId: "b1", originalPrompt: "P", submittedPrompt: "P", itemId: "same", imageIds: ["same"], note: null, createdAt: 10 },
    { id: "new-reject", type: "reject", batchId: "b2", originalPrompt: "P", submittedPrompt: "P", itemId: null, imageIds: ["same"], note: "bad", createdAt: 20 },
  ];
  const exemplars = critic.extractRecentTasteVisualExemplars(events, assets, 6);
  assert.equal(exemplars.length, 1);
  assert.equal(exemplars[0].eventId, "new-reject");
  assert.equal(exemplars[0].polarity, "negative");
});

test("selects only recent non-current visual asset ids before loading blobs", () => {
  const events = [
    { id: "old-pick", type: "pick", batchId: "b1", originalPrompt: "P", submittedPrompt: "P", itemId: "old", imageIds: ["old"], note: null, createdAt: 10 },
    { id: "new-reject", type: "reject", batchId: "b2", originalPrompt: "P", submittedPrompt: "P", itemId: null, imageIds: ["current", "bad-a", "bad-b"], note: "bad", createdAt: 20 },
  ];
  assert.deepEqual(
    critic.recentTasteVisualExemplarImageIds(events, 2, new Set(["current"])),
    ["bad-a", "bad-b"],
  );
});

test("plans at most one replacement round to reach three eligible candidates", () => {
  const pass = { tasteReview: { disqualified: false } };
  const dq = { tasteReview: { disqualified: true } };
  assert.deepEqual(critic.planTasteCriticReplacements(6, [pass, pass, dq, dq, dq, dq], false), {
    targetEligible: 3,
    eligibleCount: 2,
    replacementCount: 1,
    exhausted: false,
  });
  assert.deepEqual(critic.planTasteCriticReplacements(6, [pass, pass, dq], true), {
    targetEligible: 3,
    eligibleCount: 2,
    replacementCount: 0,
    exhausted: true,
  });
  assert.equal(critic.planTasteCriticReplacements(2, [pass, pass], false).replacementCount, 0);
});

test("tracks successful and failed jobs until a generation round is fully settled", () => {
  let round = { total: 3, settled: 0, succeeded: 0 };
  round = critic.advanceTasteGenerationRound(round, "success");
  assert.deepEqual(round, { total: 3, settled: 1, succeeded: 1 });
  round = critic.advanceTasteGenerationRound(round, "error");
  assert.deepEqual(round, { total: 3, settled: 2, succeeded: 1 });
  round = critic.advanceTasteGenerationRound(round, "success");
  assert.deepEqual(round, { total: 3, settled: 3, succeeded: 2 });
});
