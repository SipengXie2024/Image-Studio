import assert from "node:assert/strict";
import test from "node:test";

const taste = await import("../src/lib/tasteStorage.ts");

class MemoryStore {
  constructor(keyPath) {
    this.keyPath = keyPath;
    this.records = new Map();
  }

  request(action) {
    const request = {};
    queueMicrotask(() => {
      try {
        request.result = action();
        request.onsuccess?.();
      } catch (error) {
        request.error = error;
        request.onerror?.();
      }
    });
    return request;
  }

  add(value) {
    return this.request(() => {
      const key = value[this.keyPath];
      if (this.records.has(key)) throw new Error(`duplicate key: ${key}`);
      this.records.set(key, structuredClone(value));
      return key;
    });
  }

  put(value) {
    return this.request(() => {
      const key = value[this.keyPath];
      this.records.set(key, structuredClone(value));
      return key;
    });
  }

  get(key) {
    return this.request(() => {
      const value = this.records.get(key);
      return value === undefined ? undefined : structuredClone(value);
    });
  }

  getAll() {
    return this.request(() => Array.from(this.records.values(), (value) => structuredClone(value)));
  }
}

class MemoryDatabase {
  constructor() {
    this.stores = new Map();
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
  }

  createObjectStore(name, options) {
    const store = new MemoryStore(options.keyPath);
    this.stores.set(name, store);
    return store;
  }

  transaction(storeName) {
    const transaction = {
      error: null,
      objectStore: (name) => this.stores.get(name),
    };
    setTimeout(() => transaction.oncomplete?.(), 0);
    return transaction;
  }
}

function createMemoryIndexedDB() {
  const databases = new Map();
  return {
    databases,
    open(name) {
      const request = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        const isNew = !database;
        if (!database) {
          database = new MemoryDatabase();
          databases.set(name, database);
        }
        request.result = database;
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test("serializes raw feedback with prompt and note bytes unchanged", () => {
  const note = "  都不喜欢\r\n因为人物比例太成熟。  ";
  const originalPrompt = "  森林弓箭手\r\nQ 版  ";
  const event = taste.serializeTasteFeedback({
    id: "feedback-1",
    type: "reject",
    batchId: "batch-1",
    originalPrompt,
    submittedPrompt: originalPrompt,
    imageIds: ["image-a", "image-b"],
    note,
    createdAt: 10,
    apiKey: "must-not-persist",
    modelSecret: "must-not-persist",
  });

  assert.equal(event.originalPrompt, originalPrompt);
  assert.equal(event.submittedPrompt, originalPrompt);
  assert.equal(event.note, note);
  assert.deepEqual(event.imageIds, ["image-a", "image-b"]);
  assert.equal("apiKey" in event, false);
  assert.equal("modelSecret" in event, false);
});

test("keeps a reject event when its optional reason is empty", () => {
  const event = taste.serializeTasteFeedback({
    id: "feedback-empty-reason",
    type: "reject",
    batchId: "batch-2",
    originalPrompt: "hero",
    submittedPrompt: "hero",
    imageIds: ["image-c"],
    note: "",
    createdAt: 20,
  });

  assert.equal(event.note, "");
  assert.equal(event.type, "reject");
});

test("uses a separate append-only database for feedback and candidate decisions", async () => {
  const indexedDB = createMemoryIndexedDB();
  const storage = taste.createTasteStorage(indexedDB);

  await storage.appendFeedback({
    id: "feedback-b",
    type: "reject",
    batchId: "batch-1",
    originalPrompt: "hero",
    submittedPrompt: "hero",
    imageIds: ["image-a", "image-b"],
    note: null,
    createdAt: 20,
  });
  await storage.appendFeedback({
    id: "feedback-a",
    type: "pick",
    batchId: "batch-1",
    originalPrompt: "hero",
    submittedPrompt: "hero",
    itemId: "image-a",
    imageIds: ["image-a", "image-b"],
    createdAt: 10,
  });
  await storage.appendDecision({
    id: "decision-1",
    candidateId: "candidate-1",
    decision: "approve",
    createdAt: 30,
  });

  assert.equal(indexedDB.databases.has("image-studio"), false);
  assert.equal(indexedDB.databases.has(taste.TASTE_DB_NAME), true);
  assert.deepEqual((await storage.listFeedback()).map((event) => event.id), ["feedback-a", "feedback-b"]);
  assert.deepEqual(await storage.listFeedback("missing-batch"), []);
  assert.deepEqual((await storage.listDecisions("candidate-1")).map((entry) => entry.decision), ["approve"]);

  await assert.rejects(
    storage.appendFeedback({
      id: "feedback-a",
      type: "edit",
      batchId: "batch-1",
      originalPrompt: "hero",
      submittedPrompt: "hero",
      itemId: "image-a",
      createdAt: 40,
    }),
    /duplicate key/,
  );
});

test("persists deduplicated visual exemplar assets outside the feedback event", async () => {
  const indexedDB = createMemoryIndexedDB();
  const storage = taste.createTasteStorage(indexedDB);
  const preview = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
  const event = await storage.appendFeedback({
    id: "feedback-visual",
    type: "pick",
    batchId: "batch-visual",
    originalPrompt: "hero",
    submittedPrompt: "hero",
    itemId: "image-picked",
    imageIds: ["image-picked", "image-other"],
    createdAt: 50,
    visualExemplars: [{
      itemId: "image-picked",
      savedPath: "C:\\images\\picked.png",
      imageBlob: preview,
      mimeType: "image/webp",
      name: "picked.png",
      apiKey: "must-not-persist",
    }],
  });

  assert.equal("visualExemplars" in event, false);
  assert.deepEqual((await storage.listVisualExemplars(["missing", "image-picked"])) .map((asset) => ({
    itemId: asset.itemId,
    savedPath: asset.savedPath,
    mimeType: asset.mimeType,
    name: asset.name,
    bytes: asset.imageBlob?.size,
    hasSecret: "apiKey" in asset,
  })), [{
    itemId: "image-picked",
    savedPath: "C:\\images\\picked.png",
    mimeType: "image/webp",
    name: "picked.png",
    bytes: 3,
    hasSecret: false,
  }]);

  await storage.appendFeedback({
    id: "feedback-visual-newer",
    type: "edit",
    batchId: "batch-visual",
    originalPrompt: "hero",
    submittedPrompt: "hero",
    itemId: "image-picked",
    imageIds: ["image-picked"],
    createdAt: 60,
    visualExemplars: [{ itemId: "image-picked", imageB64: "new-base64" }],
  });
  const [updated] = await storage.listVisualExemplars(["image-picked"]);
  assert.equal(updated.imageB64, "new-base64");
  assert.equal(updated.savedPath, null);
  assert.equal(updated.updatedAt, 60);
});

test("round-trips profile and state while refusing secrets", async () => {
  const storage = taste.createTasteStorage(createMemoryIndexedDB());
  const profile = {
    schemaVersion: 1,
    approvedCandidateIds: ["candidate-1"],
    summary: "偏好低饱和度单角色构图",
  };
  const state = {
    schemaVersion: 1,
    coldStartCompleted: true,
    lastHistoryCreatedAt: 123,
  };

  await storage.writeProfile(profile);
  await storage.writeState(state);
  const loadedProfile = await storage.readProfile();
  const loadedState = await storage.readState();

  assert.deepEqual(loadedProfile, profile);
  assert.deepEqual(loadedState, state);
  loadedProfile.approvedCandidateIds.push("mutated-after-read");
  assert.deepEqual(await storage.readProfile(), profile);
  await assert.rejects(
    storage.writeProfile({ schemaVersion: 1, apiKey: "must-not-persist" }),
    /sensitive field/,
  );
  await assert.rejects(
    storage.writeState({ nested: { modelSecret: "must-not-persist" } }),
    /sensitive field/,
  );
});
