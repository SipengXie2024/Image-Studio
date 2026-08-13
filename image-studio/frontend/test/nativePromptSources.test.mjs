import assert from "node:assert/strict";
import test from "node:test";

import {
  isNativeFilePath,
  prepareNativePromptImagePaths,
} from "../src/platform/runtime/nativePromptSources.ts";

test("native prompt sources preserve attachment order while materializing memory sources", async () => {
  const imported = [];
  const paths = await prepareNativePromptImagePaths({
    imagePaths: ["C:/stale.png"],
    imagePath: "C:/also-stale.png",
    sourceImages: [
      { path: "C:/images/a.png", name: "a.png" },
      { name: "b.png", imageB64: "Yg==" },
      { name: "c.png", imageBlob: new Blob(["c"], { type: "image/png" }) },
      { path: "C:/images/a.png", name: "duplicate.png" },
      { path: "memory://image/d.png", name: "d.png" },
    ],
  }, {
    importImageFromBase64: async (imageB64, suggestedName) => {
      imported.push({ imageB64, suggestedName });
      return { path: `C:/imports/${suggestedName}` };
    },
    readNonNativePathAsBase64: async (path) => path === "memory://image/d.png" ? "ZA==" : "",
  });

  assert.deepEqual(paths, [
    "C:/images/a.png",
    "C:/imports/002-b.png",
    "C:/imports/003-c.png",
    "C:/images/a.png",
    "C:/imports/005-d.png",
  ]);
  assert.deepEqual(imported, [
    { imageB64: "Yg==", suggestedName: "002-b.png" },
    { imageB64: "Yw==", suggestedName: "003-c.png" },
    { imageB64: "ZA==", suggestedName: "005-d.png" },
  ]);
});

test("native prompt source fallback paths are ordered and deduplicated", async () => {
  assert.deepEqual(await prepareNativePromptImagePaths({
    imagePaths: ["/tmp/a.png", "/tmp/a.png", "/tmp/b.png"],
    imagePath: "/tmp/b.png",
  }, {
    importImageFromBase64: async () => {
      throw new Error("should not import native paths");
    },
  }), ["/tmp/a.png", "/tmp/b.png"]);
  assert.equal(isNativeFilePath("memory://image/a.png"), false);
  assert.equal(isNativeFilePath("blob:preview"), false);
  assert.equal(isNativeFilePath("C:\\images\\a.png"), true);
});

test("native prompt sources reject attachments without a path or bytes", async () => {
  await assert.rejects(
    prepareNativePromptImagePaths({ sourceImages: [{ name: "missing.png" }] }, {
      importImageFromBase64: async () => ({ path: "C:/unexpected.png" }),
    }),
    /第 1 个图片附件/,
  );
});

test("native prompt sources fall back to stored bytes when a file path is no longer readable", async () => {
  const imported = [];
  const paths = await prepareNativePromptImagePaths({
    sourceImages: [{ path: "C:\\gone\\liked.png", imageB64: "ZmFsbGJhY2s=", name: "liked.png" }],
  }, {
    readNativePathAsBase64: async () => { throw new Error("missing"); },
    importImageFromBase64: async (imageB64, suggestedName) => {
      imported.push({ imageB64, suggestedName });
      return { path: "C:\\imports\\liked.png" };
    },
  });

  assert.deepEqual(paths, ["C:\\imports\\liked.png"]);
  assert.deepEqual(imported, [{ imageB64: "ZmFsbGJhY2s=", suggestedName: "001-liked.png" }]);
});

test("native prompt sources treat empty file reads as unreadable", async () => {
  const paths = await prepareNativePromptImagePaths({
    sourceImages: [{ path: "C:\\empty\\liked.png", imageB64: "ZmFsbGJhY2s=", name: "liked.png" }],
  }, {
    readNativePathAsBase64: async () => "",
    importImageFromBase64: async () => ({ path: "C:\\imports\\liked.png" }),
  });

  assert.deepEqual(paths, ["C:\\imports\\liked.png"]);
});
