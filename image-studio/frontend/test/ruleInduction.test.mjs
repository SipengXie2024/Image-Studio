import assert from "node:assert/strict";
import test from "node:test";

const { buildRuleInductionRequestText, parseRuleInductionResponse } = await import("../src/lib/ruleInduction.ts");

test("builds an induction request from noted feedback, decisions, and existing rules", () => {
  const text = buildRuleInductionRequestText({
    feedback: [
      { type: "pick", note: "  " },
      { type: "reject", note: "高光太爆" },
      { type: "edit", note: "手指画错了", extra: "must-not-leak" },
    ],
    suggestionDecisions: [
      { decision: "modified", draftPrompt: "draft", finalPrompt: "final", rejectNote: "太暖" },
      { decision: "rejected", draftPrompt: "bad draft", finalPrompt: null, rejectNote: null },
    ],
    approvedRules: ["评审时优先冷色调"],
    rejectedRules: ["评审时要求写实"],
  });
  const parsed = JSON.parse(text);

  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.operation, "induce-rules");
  // Blank notes are dropped; surviving notes travel verbatim without extras.
  assert.deepEqual(parsed.feedbackCases, [
    { type: "reject", note: "高光太爆" },
    { type: "edit", note: "手指画错了" },
  ]);
  assert.deepEqual(parsed.suggestionDecisions, [
    { decision: "modified", draftPrompt: "draft", finalPrompt: "final", rejectNote: "太暖" },
    { decision: "rejected", draftPrompt: "bad draft", finalPrompt: null, rejectNote: null },
  ]);
  assert.deepEqual(parsed.approvedRules, ["评审时优先冷色调"]);
  assert.deepEqual(parsed.rejectedRules, ["评审时要求写实"]);
});

test("keeps only the newest entries when history exceeds the caps", () => {
  const feedback = Array.from({ length: 40 }, (_, index) => ({
    type: "reject",
    note: `原因 ${index}`,
  }));
  const decisions = Array.from({ length: 15 }, (_, index) => ({
    decision: "accepted",
    draftPrompt: `draft ${index}`,
    finalPrompt: `draft ${index}`,
  }));

  const parsed = JSON.parse(buildRuleInductionRequestText({
    feedback,
    suggestionDecisions: decisions,
    approvedRules: [],
    rejectedRules: [],
  }));

  assert.equal(parsed.feedbackCases.length, 30);
  assert.equal(parsed.feedbackCases[0].note, "原因 10");
  assert.equal(parsed.feedbackCases.at(-1).note, "原因 39");
  assert.equal(parsed.suggestionDecisions.length, 10);
  assert.equal(parsed.suggestionDecisions[0].draftPrompt, "draft 5");
});

test("caps oversized stored prompts instead of bloating the request", () => {
  const huge = "长".repeat(2000);
  const parsed = JSON.parse(buildRuleInductionRequestText({
    feedback: [{ type: "reject", note: huge }],
    suggestionDecisions: [{ decision: "accepted", draftPrompt: huge, finalPrompt: huge }],
    approvedRules: [huge],
    rejectedRules: [],
  }));

  assert.ok(parsed.feedbackCases[0].note.length <= 600);
  assert.ok(parsed.feedbackCases[0].note.includes("…"));
  assert.ok(parsed.suggestionDecisions[0].draftPrompt.length <= 600);
  assert.ok(parsed.approvedRules[0].length <= 600);
});

test("parses a strict JSON response into trimmed rule drafts", () => {
  const drafts = parseRuleInductionResponse(JSON.stringify({
    rules: [
      { rule: "  评审时降低过曝  ", evidence: "  三条 reject 提到  " },
      { rule: "评审时优先冷色调", evidence: "" },
    ],
  }));

  assert.deepEqual(drafts, [
    { rule: "评审时降低过曝", evidence: "三条 reject 提到" },
    { rule: "评审时优先冷色调", evidence: null },
  ]);
});

test("strips a markdown fence before parsing", () => {
  const raw = "```json\n{\"rules\":[{\"rule\":\"评审时降低过曝\",\"evidence\":\"reject 判例\"}]}\n```";
  assert.deepEqual(parseRuleInductionResponse(raw), [
    { rule: "评审时降低过曝", evidence: "reject 判例" },
  ]);
});

test("caps the response at five rules", () => {
  const rules = Array.from({ length: 8 }, (_, index) => ({ rule: `规则 ${index}` }));
  const drafts = parseRuleInductionResponse(JSON.stringify({ rules }));
  assert.equal(drafts.length, 5);
  assert.equal(drafts[0].rule, "规则 0");
});

test("accepts an empty rules array as a valid no-pattern answer", () => {
  assert.deepEqual(parseRuleInductionResponse("{\"rules\":[]}"), []);
});

test("rejects malformed induction responses", () => {
  assert.throws(() => parseRuleInductionResponse(""), /空响应/);
  assert.throws(() => parseRuleInductionResponse("我觉得可以这样"), /不是有效 JSON/);
  assert.throws(() => parseRuleInductionResponse("[]"), /rules 数组/);
  assert.throws(() => parseRuleInductionResponse("{\"rules\":{}}"), /rules 数组/);
  assert.throws(() => parseRuleInductionResponse("{\"rules\":[{\"evidence\":\"没有规则\"}]}"), /缺少规则文本/);
  assert.throws(() => parseRuleInductionResponse("{\"rules\":[\"裸字符串\"]}"), /格式错误/);
});
