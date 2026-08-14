import assert from "node:assert/strict";
import test from "node:test";

const {
  RULE_BUDGET,
  RULE_BUDGET_WARN_AT,
  buildRuleCurationRequestText,
  parseRuleCurationResponse,
} = await import("../src/lib/ruleCuration.ts");

test("budget constants stay in a sane relation", () => {
  assert.ok(RULE_BUDGET_WARN_AT > 0);
  assert.ok(RULE_BUDGET_WARN_AT < RULE_BUDGET);
});

test("builds the curation request with verbatim approved rules and filtered, truncated feedback", () => {
  const longRule = "长规则".repeat(400);
  const text = buildRuleCurationRequestText({
    approvedRules: ["评审时优先冷色调", longRule],
    rejectedRules: ["评审时要求写实"],
    feedback: [
      { type: "reject", note: "高光太爆" },
      { type: "pick", note: "   " },
      { type: "pick", note: null },
    ],
  });
  const payload = JSON.parse(text);
  assert.equal(payload.operation, "curate-rules");
  // Approved rules must never be truncated: the model quotes them exactly and
  // replaces-matching depends on the verbatim text round-tripping.
  assert.deepEqual(payload.approvedRules, ["评审时优先冷色调", longRule]);
  assert.deepEqual(payload.rejectedRules, ["评审时要求写实"]);
  assert.deepEqual(payload.feedbackCases, [{ type: "reject", note: "高光太爆" }]);
});

test("keeps only the newest feedback entries up to the cap", () => {
  const feedback = Array.from({ length: 20 }, (_, index) => ({
    type: "reject",
    note: `原因 ${index}`,
  }));
  const payload = JSON.parse(buildRuleCurationRequestText({
    approvedRules: [],
    rejectedRules: [],
    feedback,
  }));
  assert.equal(payload.feedbackCases.length, 15);
  assert.equal(payload.feedbackCases[0].note, "原因 5");
  assert.equal(payload.feedbackCases.at(-1).note, "原因 19");
});

test("parses merge and retire proposals, stripping fences and trimming fields", () => {
  const raw = [
    "```json",
    JSON.stringify({
      proposals: [
        { action: "merge", rule: "  合并后的规则  ", replaces: [" 规则A ", "规则B"], reason: "  重叠  " },
        { action: "retire", rule: null, replaces: ["规则C"], reason: null },
      ],
    }),
    "```",
  ].join("\n");
  const drafts = parseRuleCurationResponse(raw);
  assert.deepEqual(drafts, [
    { action: "merge", rule: "合并后的规则", replaces: ["规则A", "规则B"], reason: "重叠" },
    { action: "retire", rule: null, replaces: ["规则C"], reason: null },
  ]);
});

test("caps the parsed proposals at six", () => {
  const proposals = Array.from({ length: 9 }, (_, index) => ({
    action: "retire",
    rule: null,
    replaces: [`规则 ${index}`],
    reason: null,
  }));
  assert.equal(parseRuleCurationResponse(JSON.stringify({ proposals })).length, 6);
});

test("rejects malformed curation responses", () => {
  assert.throws(() => parseRuleCurationResponse(""), /空响应/);
  assert.throws(() => parseRuleCurationResponse("not json"), /有效 JSON/);
  assert.throws(() => parseRuleCurationResponse("[]"), /proposals/);
  assert.throws(() => parseRuleCurationResponse(JSON.stringify({ rules: [] })), /proposals/);
  assert.throws(
    () => parseRuleCurationResponse(JSON.stringify({ proposals: [{ action: "delete", replaces: ["x"] }] })),
    /未知的提案类型/,
  );
  assert.throws(
    () => parseRuleCurationResponse(JSON.stringify({ proposals: [{ action: "merge", rule: " ", replaces: ["x"] }] })),
    /缺少合并后规则文本/,
  );
  assert.throws(
    () => parseRuleCurationResponse(JSON.stringify({ proposals: [{ action: "merge", rule: "r", replaces: ["", "x"] }] })),
    /replaces 文本为空/,
  );
  assert.throws(
    () => parseRuleCurationResponse(JSON.stringify({ proposals: [{ action: "retire", rule: "带文本", replaces: ["x"] }] })),
    /携带规则文本的废弃提案/,
  );
  assert.throws(
    () => parseRuleCurationResponse(JSON.stringify({ proposals: [{ action: "retire", rule: null, replaces: ["x", "y"] }] })),
    /单条目标规则/,
  );
});
