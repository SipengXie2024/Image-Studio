import assert from "node:assert/strict";
import test from "node:test";

const {
  buildPromptSuggestionRequestText,
  parsePromptSuggestionResponse,
  withApprovedTastePreferences,
} = await import("../src/lib/promptSuggestion.ts");

function offer(overrides = {}) {
  return {
    batchId: "batch-1",
    originalPrompt: "  a forest archer\r\nchibi  ",
    submittedPrompt: "  a forest archer\r\nchibi  ",
    rejectNote: "  人物比例太成熟。  ",
    mode: "generate",
    sourcePaths: [],
    createdAt: 100,
    ...overrides,
  };
}

function feedbackEvent(id, overrides = {}) {
  return {
    id,
    type: "pick",
    batchId: "batch-0",
    originalPrompt: "hero",
    submittedPrompt: "hero",
    itemId: null,
    imageIds: [],
    note: "构图不错",
    createdAt: 1,
    ...overrides,
  };
}

test("build keeps prompt and reject reason bytes verbatim and excludes the current batch reject", () => {
  const current = offer();
  const text = buildPromptSuggestionRequestText({
    offer: current,
    feedback: [
      feedbackEvent("f-1", { type: "reject", batchId: "batch-1", note: "重复的本批理由", createdAt: 90 }),
      feedbackEvent("f-2", { type: "reject", batchId: "batch-0", note: "旧批的理由", createdAt: 80 }),
      feedbackEvent("f-3", { note: "   ", createdAt: 70 }),
    ],
    suggestionDecisions: [],
  });
  const parsed = JSON.parse(text);
  assert.equal(parsed.operation, "suggest");
  assert.equal(parsed.originalPrompt, current.originalPrompt);
  assert.equal(parsed.rejectReason, current.rejectNote);
  assert.equal(parsed.referenceImageCount, 0);
  assert.deepEqual(parsed.recentFeedback.map((entry) => entry.note), ["旧批的理由"]);
});

test("build truncates history to the newest entries", () => {
  const feedback = Array.from({ length: 8 }, (_, index) => (
    feedbackEvent(`f-${index}`, { note: `note-${index}`, createdAt: index })
  ));
  const decisions = Array.from({ length: 8 }, (_, index) => ({
    id: `ps-${index}`,
    batchId: "batch-0",
    originalPrompt: "hero",
    rejectNote: null,
    draftPrompt: `draft-${index}`,
    finalPrompt: null,
    decision: "rejected",
    createdAt: index,
  }));
  const parsed = JSON.parse(buildPromptSuggestionRequestText({
    offer: offer(),
    feedback,
    suggestionDecisions: decisions,
  }));
  assert.deepEqual(parsed.recentFeedback.map((entry) => entry.note), [
    "note-7", "note-6", "note-5", "note-4", "note-3",
  ]);
  assert.deepEqual(parsed.pastSuggestionDecisions.map((entry) => entry.draftPrompt), [
    "draft-7", "draft-6", "draft-5", "draft-4", "draft-3",
  ]);
  assert.deepEqual(Object.keys(parsed.pastSuggestionDecisions[0]).sort(), [
    "decision", "draftPrompt", "finalPrompt", "rejectNote",
  ]);
});

test("build exposes an explicit edit delta for modified decisions", () => {
  const parsed = JSON.parse(buildPromptSuggestionRequestText({
    offer: offer(),
    feedback: [],
    suggestionDecisions: [{
      id: "ps-mod",
      batchId: "batch-0",
      originalPrompt: "hero",
      rejectNote: null,
      draftPrompt: "a forest archer, mature proportions, dawn light",
      finalPrompt: "a forest archer, chibi proportions, dawn light",
      decision: "modified",
      createdAt: 1,
    }],
  }));

  assert.deepEqual(parsed.pastSuggestionDecisions[0].editDelta, {
    removed: "mature",
    added: "chibi",
  });
});

test("build truncates oversized history fields but keeps the core inputs verbatim", () => {
  const longText = "x".repeat(2000);
  const parsed = JSON.parse(buildPromptSuggestionRequestText({
    offer: offer({ rejectNote: longText }),
    feedback: [feedbackEvent("f-long", { note: longText, createdAt: 1 })],
    suggestionDecisions: [{
      id: "ps-long",
      batchId: "batch-0",
      originalPrompt: "hero",
      rejectNote: null,
      draftPrompt: longText,
      finalPrompt: null,
      decision: "rejected",
      createdAt: 1,
    }],
  }));

  assert.equal(parsed.rejectReason, longText);
  assert.equal(parsed.recentFeedback[0].note.length < 700, true);
  assert.equal(parsed.recentFeedback[0].note.includes("…"), true);
  assert.equal(parsed.pastSuggestionDecisions[0].draftPrompt.length < 700, true);
});

test("build carries approved rules and defaults to an empty list", () => {
  const withRules = JSON.parse(buildPromptSuggestionRequestText({
    offer: offer(),
    feedback: [],
    suggestionDecisions: [],
    approvedRules: ["  评审时优先冷色调  ", "   ", "画面避免高光过曝"],
  }));
  assert.deepEqual(withRules.approvedRules, ["评审时优先冷色调", "画面避免高光过曝"]);

  const withoutRules = JSON.parse(buildPromptSuggestionRequestText({
    offer: offer(),
    feedback: [],
    suggestionDecisions: [],
  }));
  assert.deepEqual(withoutRules.approvedRules, []);
});

test("build caps and truncates approved rules like other history fields", () => {
  const rules = Array.from({ length: 14 }, (_, index) => `规则 ${index}`);
  rules[0] = "长".repeat(2000);
  const parsed = JSON.parse(buildPromptSuggestionRequestText({
    offer: offer(),
    feedback: [],
    suggestionDecisions: [],
    approvedRules: rules,
  }));
  assert.equal(parsed.approvedRules.length, 10);
  assert.equal(parsed.approvedRules[0].length <= 600, true);
  assert.equal(parsed.approvedRules[0].includes("…"), true);
  assert.equal(parsed.approvedRules[1], "规则 1");
});

test("withApprovedTastePreferences appends a marked guidance section", () => {
  const result = withApprovedTastePreferences("a forest archer", ["评审时优先冷色调", "   ", "避免高光过曝"]);
  assert.equal(result.appliedRuleCount, 2);
  assert.equal(result.text.startsWith("a forest archer\n\nApproved taste preferences"), true);
  assert.equal(result.text.includes("do not copy this section into the output"), true);
  assert.equal(result.text.includes("- 评审时优先冷色调"), true);
  assert.equal(result.text.includes("- 避免高光过曝"), true);
});

test("withApprovedTastePreferences leaves the prompt untouched without usable rules", () => {
  const blankOnly = withApprovedTastePreferences("a forest archer", ["   "]);
  assert.equal(blankOnly.text, "a forest archer");
  assert.equal(blankOnly.appliedRuleCount, 0);

  const empty = withApprovedTastePreferences("a forest archer", []);
  assert.equal(empty.text, "a forest archer");
  assert.equal(empty.appliedRuleCount, 0);
});

test("parse trims responses and strips fences and paired quotes", () => {
  assert.equal(parsePromptSuggestionResponse("  a cleaner prompt  "), "a cleaner prompt");
  assert.equal(parsePromptSuggestionResponse("```\na fenced prompt\n```"), "a fenced prompt");
  assert.equal(parsePromptSuggestionResponse("```text\na tagged prompt\n```"), "a tagged prompt");
  assert.equal(parsePromptSuggestionResponse('"a quoted prompt"'), "a quoted prompt");
  assert.equal(parsePromptSuggestionResponse("“中文引号提示词”"), "中文引号提示词");
});

test("parse rejects empty responses", () => {
  assert.throws(() => parsePromptSuggestionResponse(""), /建议响应为空/);
  assert.throws(() => parsePromptSuggestionResponse("   \n  "), /建议响应为空/);
  assert.throws(() => parsePromptSuggestionResponse('""'), /建议响应为空/);
});
