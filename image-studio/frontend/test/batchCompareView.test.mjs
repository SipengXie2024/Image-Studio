import assert from "node:assert/strict";
import test from "node:test";

const {
  batchCompareItemIds,
  batchTileIntent,
  resolveBatchFocus,
  stepBatchFocus,
} = await import("../src/lib/batchCompareView.ts");
const { buildBatchComparePreview, buildMacWorkspacePreview } = await import("../src/app/dev/previewData.ts");

test("batch comparison keeps every result available while one item is focused", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const ids = batchCompareItemIds(items);

  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.equal(resolveBatchFocus(ids, "b"), "b");
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("batch focus rejects stale items from another batch", () => {
  assert.equal(resolveBatchFocus(["new-a", "new-b"], "old-a"), null);
  assert.equal(resolveBatchFocus(["new-a", "new-b"], null), null);
});

test("batch focus navigation wraps without changing result order", () => {
  const ids = ["a", "b", "c"];

  assert.equal(stepBatchFocus(ids, "a", -1), "c");
  assert.equal(stepBatchFocus(ids, "c", 1), "a");
  assert.equal(stepBatchFocus(ids, "b", 1), "c");
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("batch focus navigation ignores a non-member item", () => {
  assert.equal(stepBatchFocus(["a", "b"], "missing", 1), null);
});

test("ordinary tile clicks focus inside comparison instead of opening single view", () => {
  assert.equal(batchTileIntent({ selectionMode: false, preview: false, canFocusPreview: true }), "focus-preview");
  assert.equal(batchTileIntent({ selectionMode: false, preview: false, canFocusPreview: false }), "open-single");
});

test("selection grids and streaming previews keep their original click behavior", () => {
  assert.equal(batchTileIntent({ selectionMode: true, preview: false, canFocusPreview: true }), "toggle-selection");
  assert.equal(batchTileIntent({ selectionMode: false, preview: true, canFocusPreview: true }), "ignore");
});

test("batch comparison preview keeps existing visual fixtures unchanged", () => {
  const baseline = buildMacWorkspacePreview("baseline");
  const comparison = buildBatchComparePreview("comparison");

  assert.equal(baseline.history.some((item) => item.batchId === "preview-batch"), false);
  assert.equal(baseline.history[0].previewUrl.includes("width%3D%22480%22"), true);
  assert.equal(comparison.history.slice(0, 6).some((item) => item.batchId), false);
  assert.equal(new Set(comparison.history.slice(0, 6).map((item) => item.previewUrl)).size, 6);
});
