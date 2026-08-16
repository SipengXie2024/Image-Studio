import assert from "node:assert/strict";
import test from "node:test";

test("Wails OptimizePrompt materializes source images into complete ordered imagePaths", async () => {
  const realWindow = globalThis.window;
  const realNavigator = globalThis.navigator;
  const imports = [];
  let optimized = null;

  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
        userAgentData: { platform: "Windows" },
      },
    });
    globalThis.window = {
      location: { search: "" },
      runtime: {},
      go: {
        backend: {
          Service: {
            Generate: async () => ({ jobId: "unused" }),
            Edit: async () => ({ jobId: "unused" }),
            ImportImageFromB64: async (imageB64, suggestedName) => {
              imports.push({ imageB64, suggestedName });
              return { path: `C:/imports/${suggestedName}` };
            },
            ReadImageAsBase64: async (path) => path === "C:/images/a.png" ? "YQ==" : "",
            OptimizePrompt: async (options) => {
              optimized = options;
              return "{}";
            },
          },
        },
      },
    };

    const host = await import(`../src/platform/runtime/host.ts?wails-optimize=${Date.now()}`);
    await host.OptimizePrompt({
      apiKey: "key",
      prompt: "critic request",
      mode: "critic",
      baseURL: "https://example.com",
      textModelID: "gpt-5.5",
      imagePaths: ["C:/stale.png"],
      imagePath: "C:/also-stale.png",
      sourceImages: [
        { path: "C:/images/a.png", name: "a.png" },
        { name: "b.png", imageB64: "Yg==" },
        { name: "c.png", imageBlob: new Blob(["c"], { type: "image/png" }) },
        { path: "C:/images/a.png", name: "duplicate.png" },
      ],
    });

    assert.deepEqual(imports, [
      { imageB64: "Yg==", suggestedName: "002-b.png" },
      { imageB64: "Yw==", suggestedName: "003-c.png" },
    ]);
    assert.deepEqual(optimized.imagePaths, [
      "C:/images/a.png",
      "C:/imports/002-b.png",
      "C:/imports/003-c.png",
      "C:/images/a.png",
    ]);
    assert.equal(optimized.imagePath, "");
    assert.equal("sourceImages" in optimized, false);
  } finally {
    globalThis.window = realWindow;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: realNavigator,
    });
  }
});
