import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildPromptOptimizePayload } from "../../../shared/kernel/requestModel.js";

// The Go backend and the shared JS kernel each hard-code the per-mode
// instruction. This parity test is the guard that keeps the two copies
// byte-identical (CLAUDE.md: cross-platform request behavior must not fork).
const goSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backend", "prompt_optimize.go"),
  "utf8",
);

const TEXT_MODES = ["suggest", "distill-rule", "revise-rule", "refine-note", "induce-rules"];

function goInstructionFor(mode) {
  const pattern = new RegExp(
    `operation == "${mode}" \\{\\s*\\n\\s*instruction = "([^"]*)"`,
  );
  const match = goSource.match(pattern);
  assert.ok(match, `Go backend has no instruction branch for mode "${mode}"`);
  return match[1];
}

for (const mode of TEXT_MODES) {
  test(`mode "${mode}" instruction is byte-identical between Go backend and shared kernel`, () => {
    const payload = buildPromptOptimizePayload({
      prompt: "{}",
      mode,
      textModelID: "gpt-5.5",
    }, []);
    assert.equal(payload.instructions, goInstructionFor(mode));
    assert.equal(payload.text, undefined);
    assert.equal(payload.input[0].content.length, 1);
  });
}

// The default and edit instructions are seed assignments in Go, not
// `operation ==` branches, so the loop above cannot see them; guard the seed
// and the edit suffix separately.
function goSeedInstruction() {
  const match = goSource.match(/instruction := "([^"]*)"/);
  assert.ok(match, "Go backend has no default instruction assignment");
  return match[1];
}

test("default optimize instruction is byte-identical between Go backend and shared kernel", () => {
  const payload = buildPromptOptimizePayload({
    prompt: "x",
    mode: "generate",
    textModelID: "gpt-5.5",
  }, []);
  assert.equal(payload.instructions, goSeedInstruction());
});

test("edit optimize instruction is byte-identical between Go backend and shared kernel", () => {
  const suffixMatch = goSource.match(/instruction \+= "([^"]*)"/);
  assert.ok(suffixMatch, "Go backend has no edit instruction suffix");
  const payload = buildPromptOptimizePayload({
    prompt: "x",
    mode: "edit",
    textModelID: "gpt-5.5",
  }, []);
  assert.equal(payload.instructions, goSeedInstruction() + suffixMatch[1]);
});
