import assert from "node:assert/strict";
import test from "node:test";

const taste = await import("../src/lib/tasteLearning.ts");

function historyItem(overrides = {}) {
  return {
    id: "history-1",
    prompt: "A forest archer",
    mode: "generate",
    size: "1024x1024",
    quality: "medium",
    createdAt: 1,
    ...overrides,
  };
}

test("asserts original and submitted prompt bytes are identical", () => {
  const prompt = "  森林弓箭手\r\nQ 版，é，不要改写。  ";
  assert.doesNotThrow(() => taste.assertPromptByteIdentity(prompt, prompt));
  assert.throws(
    () => taste.assertPromptByteIdentity(prompt, prompt.trim()),
    /differs from the original/,
  );
  assert.throws(
    () => taste.assertPromptByteIdentity("é", "e\u0301"),
    /differs from the original/,
  );
  assert.deepEqual(
    [...new TextEncoder().encode(prompt)],
    [...new TextEncoder().encode(prompt)],
  );
});

test("cold start only proposes pending rules from explicit style fields", () => {
  const generatedOnly = historyItem({
    prompt: "cinematic concept art",
    revisedPrompt: "award-winning cinematic concept art",
  });
  assert.deepEqual(taste.extractColdStartTasteCandidates([generatedOnly]), []);

  const source = historyItem({
    styleTag: "  Low-saturation fantasy  ",
    negativePrompt: "photorealistic face",
    revisedPrompt: "model-authored rendering instructions",
  });
  const before = structuredClone(source);
  const candidates = taste.extractColdStartTasteCandidates([source]);

  assert.deepEqual(source, before);
  assert.equal(candidates.length, 2);
  for (const candidate of candidates) {
    assert.equal(candidate.status, "pending");
    assert.equal(candidate.target, "critic");
    assert.equal(candidate.source.type, "history");
    assert.equal(candidate.source.inference, "requested-not-liked");
  }
  assert.equal(candidates.some((candidate) => candidate.rule.includes(source.prompt)), false);
  assert.equal(candidates.some((candidate) => candidate.rule.includes(source.revisedPrompt ?? "")), false);
});

test("cold-start candidate ids and output are deterministic across history order", () => {
  const first = historyItem({
    id: "b",
    createdAt: 20,
    styleTag: "Painterly Fantasy",
  });
  const second = historyItem({
    id: "a",
    createdAt: 10,
    styleTag: " painterly   fantasy ",
  });

  const forward = taste.extractColdStartTasteCandidates([first, second]);
  const reverse = taste.extractColdStartTasteCandidates([second, first]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.length, 1);
  assert.deepEqual(forward[0].source.itemIds, ["a", "b"]);
  assert.match(forward[0].id, /^taste-[0-9a-f]{16}$/);
});

test("converts explicit feedback to a pending candidate and preserves verbatim note", () => {
  const event = {
    caseId: "forest-archer",
    eventIndex: 7,
    type: "edit",
    itemId: "history-4",
    run: "runs/002",
    image: "img-04.png",
    note: "  弓的细节可以丰富一点\r\n但其他元素不要动。  ",
    tags: [" polish ", "fidelity", "polish"],
  };

  const first = taste.feedbackEventToTasteCandidate(event);
  const second = taste.feedbackEventToTasteCandidate({ ...event, tags: ["fidelity", "polish"] });
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.status, "pending");
  assert.equal(first.target, "critic");
  assert.equal(first.source.verbatimNote, event.note);
  assert.deepEqual(first.source.tags, ["fidelity", "polish"]);
  assert.equal(first.id, second.id);
  assert.notEqual(
    first.id,
    taste.feedbackEventToTasteCandidate({ ...event, note: "只调整弓的细节" }).id,
  );
  assert.equal(taste.feedbackEventToTasteCandidate({ type: "pick" }), null);
});

test("builds a deterministic snapshot from approved critic rules only", () => {
  const pending = taste.feedbackEventToTasteCandidate({
    id: "pending-feedback",
    type: "reject",
    note: "不要多角色拼版",
  });
  const approvedA = {
    ...taste.feedbackEventToTasteCandidate({
      id: "approved-a",
      type: "reject",
      note: "单人 brief 出现拼版时不得进入 top-3",
    }),
    status: "approved",
  };
  const approvedB = {
    ...taste.feedbackEventToTasteCandidate({
      id: "approved-b",
      type: "edit",
      note: "局部编辑应保持未提及元素不变",
    }),
    status: "approved",
  };
  const before = structuredClone([pending, approvedA, approvedB]);

  const forward = taste.buildApprovedCriticRulesSnapshot([pending, approvedB, approvedA]);
  const reverse = taste.buildApprovedCriticRulesSnapshot([approvedA, pending, approvedB]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.target, "critic");
  assert.equal(forward.rules.length, 2);
  assert.equal(forward.rules.some((rule) => rule.candidateId === pending.id), false);
  assert.deepEqual([pending, approvedA, approvedB], before);
  assert.match(forward.version, /^critic-[0-9a-f]{16}$/);
  assert.deepEqual(
    taste.buildCriticRulesSnapshot([...forward.rules].reverse()),
    forward,
  );
});

test("rejects an approved rule that attempts to target prompt generation", () => {
  const candidate = taste.feedbackEventToTasteCandidate({
    id: "unsafe-target",
    type: "note",
    note: "Do not mutate the submitted prompt",
  });
  assert.ok(candidate);

  assert.throws(
    () => taste.buildApprovedCriticRulesSnapshot([{
      ...candidate,
      status: "approved",
      target: "generator",
    }]),
    /only target the critic/,
  );
});

test("taste learning never mutates original or submitted prompts", () => {
  const originalPrompt = "  single hero\r\nkeep  two spaces  ";
  const submittedPrompt = `${originalPrompt}`;
  const item = historyItem({
    prompt: originalPrompt,
    styleTag: "ink wash",
  });

  const candidates = taste.extractColdStartTasteCandidates([item]);
  const snapshot = taste.buildApprovedCriticRulesSnapshot(candidates.map((candidate) => ({
    ...candidate,
    status: "approved",
  })));

  taste.assertPromptByteIdentity(originalPrompt, submittedPrompt);
  assert.deepEqual(
    [...new TextEncoder().encode(originalPrompt)],
    [...new TextEncoder().encode(submittedPrompt)],
  );
  assert.equal("prompt" in snapshot, false);
  assert.equal("submittedPrompt" in snapshot, false);
});
