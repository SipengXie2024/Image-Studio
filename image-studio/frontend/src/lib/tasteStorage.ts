export const TASTE_DB_NAME = "image-studio-taste";

const DB_VERSION = 5;
const FEEDBACK_STORE = "feedbackEvents";
const DECISION_STORE = "candidateDecisions";
const DOCUMENT_STORE = "documents";
const VISUAL_EXEMPLAR_STORE = "visualExemplars";
const PROMPT_SUGGESTION_STORE = "promptSuggestionDecisions";
const SUGGESTION_OUTCOME_STORE = "suggestionOutcomes";
const INDUCED_RULE_STORE = "inducedRuleProposals";
const CREATED_AT_INDEX = "createdAt";
const PROFILE_KEY = "profile";
const STATE_KEY = "state";

export type TasteFeedbackType = "pick" | "edit" | "reject";
export type TasteDecisionValue = "approve" | "reject";

export interface TasteFeedbackInput {
  id?: string;
  type: TasteFeedbackType;
  batchId: string;
  originalPrompt: string;
  submittedPrompt: string;
  itemId?: string | null;
  imageIds?: readonly string[];
  note?: string | null;
  // Reference images the user explicitly carried over into the follow-up edit
  // round; records iteration continuity (local only, never sent upstream).
  attachedSourcePaths?: readonly string[] | null;
  visualExemplars?: readonly TasteVisualExemplarInput[];
  createdAt?: number;
}

export interface TasteVisualExemplarInput {
  itemId: string;
  savedPath?: string | null;
  imageB64?: string | null;
  imageBlob?: Blob | null;
  mimeType?: string | null;
  name?: string | null;
}

export interface TasteVisualExemplarAsset {
  itemId: string;
  savedPath: string | null;
  imageB64: string | null;
  imageBlob: Blob | null;
  mimeType: string | null;
  name: string | null;
  updatedAt: number;
}

export interface TasteFeedbackEvent {
  id: string;
  type: TasteFeedbackType;
  batchId: string;
  originalPrompt: string;
  submittedPrompt: string;
  itemId: string | null;
  imageIds: string[];
  note: string | null;
  // Optional for records written before this field existed.
  attachedSourcePaths?: string[] | null;
  createdAt: number;
}

export interface TasteDecisionInput {
  id?: string;
  candidateId: string;
  decision: TasteDecisionValue;
  createdAt?: number;
}

export interface TasteCandidateDecision {
  id: string;
  candidateId: string;
  decision: TasteDecisionValue;
  createdAt: number;
}

export type PromptSuggestionDecisionValue = "accepted" | "modified" | "rejected";

export interface PromptSuggestionDecisionInput {
  id?: string;
  batchId: string;
  originalPrompt: string;
  rejectNote?: string | null;
  draftPrompt: string;
  finalPrompt?: string | null;
  decision: PromptSuggestionDecisionValue;
  createdAt?: number;
}

export interface PromptSuggestionDecision {
  id: string;
  batchId: string;
  originalPrompt: string;
  rejectNote: string | null;
  draftPrompt: string;
  finalPrompt: string | null;
  decision: PromptSuggestionDecisionValue;
  createdAt: number;
}

// Links an adopted suggestion decision to the batch it produced, so the
// panel can answer "did batches generated from suggestions do better?".
export interface PromptSuggestionOutcomeInput {
  id?: string;
  decisionId: string;
  resultBatchId: string;
  createdAt?: number;
}

export interface PromptSuggestionOutcome {
  id: string;
  decisionId: string;
  resultBatchId: string;
  createdAt: number;
}

// Fact record for a rule the AI induced from accumulated history. Candidates
// are rebuilt from fact tables on every profile refresh, so an induced rule
// needs its own durable record — otherwise it would vanish before the user
// ever gets to approve or reject it.
export interface InducedRuleProposalInput {
  id?: string;
  rule: string;
  evidence?: string | null;
  createdAt?: number;
}

export interface InducedRuleProposal {
  id: string;
  rule: string;
  evidence: string | null;
  createdAt: number;
}

export type TasteJsonPrimitive = string | number | boolean | null;
export type TasteJsonValue = TasteJsonPrimitive | TasteJsonValue[] | TasteJsonObject;
export interface TasteJsonObject {
  [key: string]: TasteJsonValue;
}
export type TasteProfile = TasteJsonObject;
export type TasteState = TasteJsonObject;

export interface TasteStorage {
  appendFeedback(input: TasteFeedbackInput): Promise<TasteFeedbackEvent>;
  listFeedback(batchId?: string): Promise<TasteFeedbackEvent[]>;
  listVisualExemplars(itemIds: readonly string[]): Promise<TasteVisualExemplarAsset[]>;
  appendDecision(input: TasteDecisionInput): Promise<TasteCandidateDecision>;
  listDecisions(candidateId?: string): Promise<TasteCandidateDecision[]>;
  appendPromptSuggestionDecision(input: PromptSuggestionDecisionInput): Promise<PromptSuggestionDecision>;
  listPromptSuggestionDecisions(): Promise<PromptSuggestionDecision[]>;
  appendSuggestionOutcome(input: PromptSuggestionOutcomeInput): Promise<PromptSuggestionOutcome>;
  listSuggestionOutcomes(): Promise<PromptSuggestionOutcome[]>;
  appendInducedRuleProposal(input: InducedRuleProposalInput): Promise<InducedRuleProposal>;
  listInducedRuleProposals(): Promise<InducedRuleProposal[]>;
  listRecentFeedback(limit: number): Promise<TasteFeedbackEvent[]>;
  listRecentPromptSuggestionDecisions(limit: number): Promise<PromptSuggestionDecision[]>;
  readProfile<T = TasteProfile>(): Promise<T | null>;
  writeProfile<T extends object>(profile: T): Promise<void>;
  readState<T = TasteState>(): Promise<T | null>;
  writeState<T extends object>(state: T): Promise<void>;
}

interface TasteDocumentRecord {
  key: string;
  value: TasteJsonObject;
}

interface SerializationDefaults {
  id?: string;
  createdAt?: number;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function promptString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  return value;
}

function optionalString(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new TypeError(`${name} must be a string or null`);
  return value;
}

function timestamp(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`);
  }
  return value;
}

function newRecordId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return `${prefix}-${randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function serializeTasteFeedback(
  input: TasteFeedbackInput,
  defaults: SerializationDefaults = {},
): TasteFeedbackEvent {
  if (input.type !== "pick" && input.type !== "edit" && input.type !== "reject") {
    throw new TypeError("type must be pick, edit, or reject");
  }
  if (input.itemId !== undefined && input.itemId !== null) {
    requiredString(input.itemId, "itemId");
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    throw new TypeError("note must be a string or null");
  }
  const imageIds = input.imageIds ?? [];
  if (!Array.isArray(imageIds)) throw new TypeError("imageIds must be an array");
  for (const imageId of imageIds) requiredString(imageId, "imageIds entry");
  const attachedSourcePaths = input.attachedSourcePaths ?? null;
  if (attachedSourcePaths !== null) {
    if (!Array.isArray(attachedSourcePaths)) throw new TypeError("attachedSourcePaths must be an array or null");
    for (const path of attachedSourcePaths) requiredString(path, "attachedSourcePaths entry");
  }

  return {
    id: requiredString(input.id ?? defaults.id ?? newRecordId("feedback"), "id"),
    type: input.type,
    batchId: requiredString(input.batchId, "batchId"),
    originalPrompt: promptString(input.originalPrompt, "originalPrompt"),
    submittedPrompt: promptString(input.submittedPrompt, "submittedPrompt"),
    itemId: input.itemId ?? null,
    imageIds: [...imageIds],
    note: input.note ?? null,
    attachedSourcePaths: attachedSourcePaths && attachedSourcePaths.length > 0 ? [...attachedSourcePaths] : null,
    createdAt: timestamp(input.createdAt ?? defaults.createdAt ?? Date.now(), "createdAt"),
  };
}

export function serializeTasteVisualExemplar(
  input: TasteVisualExemplarInput,
  updatedAt: number,
): TasteVisualExemplarAsset {
  const imageBlob = input.imageBlob ?? null;
  if (imageBlob !== null && !(imageBlob instanceof Blob)) {
    throw new TypeError("imageBlob must be a Blob or null");
  }
  const asset = {
    itemId: requiredString(input.itemId, "itemId"),
    savedPath: optionalString(input.savedPath, "savedPath"),
    imageB64: optionalString(input.imageB64, "imageB64"),
    imageBlob,
    mimeType: optionalString(input.mimeType, "mimeType"),
    name: optionalString(input.name, "name"),
    updatedAt: timestamp(updatedAt, "updatedAt"),
  };
  if (!asset.savedPath && !asset.imageB64 && !asset.imageBlob) {
    throw new TypeError("visual exemplar must include a readable image source");
  }
  return asset;
}

export function serializeTasteDecision(
  input: TasteDecisionInput,
  defaults: SerializationDefaults = {},
): TasteCandidateDecision {
  if (input.decision !== "approve" && input.decision !== "reject") {
    throw new TypeError("decision must be approve or reject");
  }
  return {
    id: requiredString(input.id ?? defaults.id ?? newRecordId("decision"), "id"),
    candidateId: requiredString(input.candidateId, "candidateId"),
    decision: input.decision,
    createdAt: timestamp(input.createdAt ?? defaults.createdAt ?? Date.now(), "createdAt"),
  };
}

export function serializePromptSuggestionDecision(
  input: PromptSuggestionDecisionInput,
  defaults: SerializationDefaults = {},
): PromptSuggestionDecision {
  if (input.decision !== "accepted" && input.decision !== "modified" && input.decision !== "rejected") {
    throw new TypeError("decision must be accepted, modified, or rejected");
  }
  const draftPrompt = requiredString(input.draftPrompt, "draftPrompt");
  const finalPrompt = input.finalPrompt ?? null;
  if (finalPrompt !== null && typeof finalPrompt !== "string") {
    throw new TypeError("finalPrompt must be a string or null");
  }
  if (input.decision === "rejected" && finalPrompt !== null) {
    throw new TypeError("rejected suggestions must not carry a finalPrompt");
  }
  if (input.decision === "accepted" && finalPrompt !== draftPrompt) {
    throw new TypeError("accepted suggestions must keep finalPrompt equal to draftPrompt");
  }
  if (input.decision === "modified" && (finalPrompt === null || finalPrompt === draftPrompt)) {
    throw new TypeError("modified suggestions must carry a finalPrompt different from draftPrompt");
  }
  return {
    id: requiredString(input.id ?? defaults.id ?? newRecordId("prompt-suggestion"), "id"),
    batchId: requiredString(input.batchId, "batchId"),
    originalPrompt: promptString(input.originalPrompt, "originalPrompt"),
    rejectNote: optionalString(input.rejectNote, "rejectNote"),
    draftPrompt,
    finalPrompt,
    decision: input.decision,
    createdAt: timestamp(input.createdAt ?? defaults.createdAt ?? Date.now(), "createdAt"),
  };
}

export function serializePromptSuggestionOutcome(
  input: PromptSuggestionOutcomeInput,
  defaults: SerializationDefaults = {},
): PromptSuggestionOutcome {
  return {
    id: requiredString(input.id ?? defaults.id ?? newRecordId("suggestion-outcome"), "id"),
    decisionId: requiredString(input.decisionId, "decisionId"),
    resultBatchId: requiredString(input.resultBatchId, "resultBatchId"),
    createdAt: timestamp(input.createdAt ?? defaults.createdAt ?? Date.now(), "createdAt"),
  };
}

export function serializeInducedRuleProposal(
  input: InducedRuleProposalInput,
  defaults: SerializationDefaults = {},
): InducedRuleProposal {
  return {
    id: requiredString(input.id ?? defaults.id ?? newRecordId("induced"), "id"),
    rule: requiredString(input.rule, "rule"),
    evidence: optionalString(input.evidence, "evidence"),
    createdAt: timestamp(input.createdAt ?? defaults.createdAt ?? Date.now(), "createdAt"),
  };
}

function isForbiddenDocumentKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "authorization"
    || normalized === "password"
    || normalized === "apikey"
    || normalized.endsWith("apikey")
    || normalized === "token"
    || normalized.endsWith("token")
    || normalized === "secret"
    || normalized.endsWith("secret")
    || normalized === "privatekey"
    || normalized.endsWith("privatekey");
}

function cloneTasteJson(value: TasteJsonValue, path: string): TasteJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneTasteJson(entry, `${path}[${index}]`));
  }
  if (typeof value !== "object") throw new TypeError(`${path} must be JSON-compatible`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain objects`);
  }

  const clone: TasteJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isForbiddenDocumentKey(key)) {
      throw new Error(`${path}.${key} is a sensitive field and cannot be persisted`);
    }
    clone[key] = cloneTasteJson(entry, `${path}.${key}`);
  }
  return clone;
}

export function serializeTasteDocument<T extends object>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("taste document must be an object");
  }
  return cloneTasteJson(value as unknown as TasteJsonObject, "taste document") as unknown as T;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function compareRecords(
  left: { id: string; createdAt: number },
  right: { id: string; createdAt: number },
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

export function createTasteStorage(indexedDBFactory?: IDBFactory): TasteStorage {
  let databasePromise: Promise<IDBDatabase> | null = null;

  const openDatabase = (): Promise<IDBDatabase> => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const factory = indexedDBFactory ?? globalThis.indexedDB;
      if (!factory) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }
      const request = factory.open(TASTE_DB_NAME, DB_VERSION);
      request.onblocked = () => {
        databasePromise = null;
        reject(new Error("品味数据库升级被其他连接阻塞,请关闭其他窗口后重试"));
      };
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(FEEDBACK_STORE)) {
          database.createObjectStore(FEEDBACK_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(DECISION_STORE)) {
          database.createObjectStore(DECISION_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
          database.createObjectStore(DOCUMENT_STORE, { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains(VISUAL_EXEMPLAR_STORE)) {
          database.createObjectStore(VISUAL_EXEMPLAR_STORE, { keyPath: "itemId" });
        }
        if (!database.objectStoreNames.contains(PROMPT_SUGGESTION_STORE)) {
          database.createObjectStore(PROMPT_SUGGESTION_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(SUGGESTION_OUTCOME_STORE)) {
          database.createObjectStore(SUGGESTION_OUTCOME_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(INDUCED_RULE_STORE)) {
          database.createObjectStore(INDUCED_RULE_STORE, { keyPath: "id" });
        }
        const upgradeTransaction = request.transaction;
        if (upgradeTransaction) {
          for (const storeName of [FEEDBACK_STORE, PROMPT_SUGGESTION_STORE]) {
            const store = upgradeTransaction.objectStore(storeName);
            if (!store.indexNames.contains(CREATED_AT_INDEX)) {
              store.createIndex(CREATED_AT_INDEX, "createdAt");
            }
          }
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        // Yield to a future upgrade from another realm instead of blocking it forever.
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error ?? new Error("Unable to open taste database"));
      };
    });
    return databasePromise;
  };

  const addRecord = async <T>(storeName: string, record: T): Promise<void> => {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const done = transactionDone(transaction);
    const added = requestAsPromise(transaction.objectStore(storeName).add(record));
    await Promise.all([added, done]);
  };

  const getAllRecords = async <T>(storeName: string): Promise<T[]> => {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    const done = transactionDone(transaction);
    const records = requestAsPromise<T[]>(transaction.objectStore(storeName).getAll());
    const [result] = await Promise.all([records, done]);
    return result;
  };

  // Reads only the newest `limit` records via the createdAt index instead of
  // materializing the whole (append-only, ever-growing) table.
  const getRecentRecords = async <T>(storeName: string, limit: number): Promise<T[]> => {
    if (limit <= 0) return [];
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    const done = transactionDone(transaction);
    const index = transaction.objectStore(storeName).index(CREATED_AT_INDEX);
    const records: T[] = [];
    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || records.length >= limit) {
          resolve();
          return;
        }
        records.push(cursor.value as T);
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
    });
    await done;
    // Return oldest-first to match the ordering contract of the full list* reads.
    return records.reverse();
  };

  const getRecords = async <T>(storeName: string, keys: readonly string[]): Promise<T[]> => {
    if (keys.length === 0) return [];
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(storeName);
    const records = keys.map((key) => requestAsPromise<T | undefined>(store.get(key)));
    const result = await Promise.all(records);
    await done;
    return result.flatMap((record) => (record === undefined ? [] : [record as T]));
  };

  const readDocument = async <T>(key: string): Promise<T | null> => {
    const database = await openDatabase();
    const transaction = database.transaction(DOCUMENT_STORE, "readonly");
    const done = transactionDone(transaction);
    const record = requestAsPromise<TasteDocumentRecord | undefined>(
      transaction.objectStore(DOCUMENT_STORE).get(key),
    );
    const [result] = await Promise.all([record, done]);
    return result ? serializeTasteDocument(result.value) as unknown as T : null;
  };

  const writeDocument = async <T extends object>(key: string, value: T): Promise<void> => {
    const safeValue = serializeTasteDocument(value);
    const database = await openDatabase();
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
    const done = transactionDone(transaction);
    const written = requestAsPromise(transaction.objectStore(DOCUMENT_STORE).put({ key, value: safeValue }));
    await Promise.all([written, done]);
  };

  return {
    async appendFeedback(input) {
      const event = serializeTasteFeedback(input);
      const assets = (input.visualExemplars ?? []).map((asset) => (
        serializeTasteVisualExemplar(asset, event.createdAt)
      ));
      const database = await openDatabase();
      const storeNames = assets.length > 0
        ? [FEEDBACK_STORE, VISUAL_EXEMPLAR_STORE]
        : [FEEDBACK_STORE];
      const transaction = database.transaction(storeNames, "readwrite");
      const done = transactionDone(transaction);
      const writes: Promise<unknown>[] = [
        requestAsPromise(transaction.objectStore(FEEDBACK_STORE).add(event)),
      ];
      if (assets.length > 0) {
        const store = transaction.objectStore(VISUAL_EXEMPLAR_STORE);
        writes.push(...assets.map((asset) => requestAsPromise(store.put(asset))));
      }
      await Promise.all([...writes, done]);
      return event;
    },
    async listFeedback(batchId) {
      const events = await getAllRecords<TasteFeedbackEvent>(FEEDBACK_STORE);
      return events
        .filter((event) => batchId === undefined || event.batchId === batchId)
        .map((event) => ({ ...event, imageIds: [...event.imageIds] }))
        .sort(compareRecords);
    },
    async listVisualExemplars(itemIds) {
      const uniqueIDs = Array.from(new Set(itemIds));
      for (const itemId of uniqueIDs) requiredString(itemId, "itemIds entry");
      const assets = await getRecords<TasteVisualExemplarAsset>(VISUAL_EXEMPLAR_STORE, uniqueIDs);
      const byID = new Map(assets.map((asset) => [asset.itemId, asset]));
      return uniqueIDs.flatMap((itemId) => {
        const asset = byID.get(itemId);
        return asset ? [{ ...asset }] : [];
      });
    },
    async appendDecision(input) {
      const decision = serializeTasteDecision(input);
      await addRecord(DECISION_STORE, decision);
      return decision;
    },
    async listDecisions(candidateId) {
      const decisions = await getAllRecords<TasteCandidateDecision>(DECISION_STORE);
      return decisions
        .filter((decision) => candidateId === undefined || decision.candidateId === candidateId)
        .map((decision) => ({ ...decision }))
        .sort(compareRecords);
    },
    async appendPromptSuggestionDecision(input) {
      const decision = serializePromptSuggestionDecision(input);
      await addRecord(PROMPT_SUGGESTION_STORE, decision);
      return decision;
    },
    async listPromptSuggestionDecisions() {
      const decisions = await getAllRecords<PromptSuggestionDecision>(PROMPT_SUGGESTION_STORE);
      return decisions.map((decision) => ({ ...decision })).sort(compareRecords);
    },
    async appendSuggestionOutcome(input) {
      const outcome = serializePromptSuggestionOutcome(input);
      await addRecord(SUGGESTION_OUTCOME_STORE, outcome);
      return outcome;
    },
    async listSuggestionOutcomes() {
      const outcomes = await getAllRecords<PromptSuggestionOutcome>(SUGGESTION_OUTCOME_STORE);
      return outcomes.map((outcome) => ({ ...outcome })).sort(compareRecords);
    },
    async appendInducedRuleProposal(input) {
      const proposal = serializeInducedRuleProposal(input);
      await addRecord(INDUCED_RULE_STORE, proposal);
      return proposal;
    },
    async listInducedRuleProposals() {
      const proposals = await getAllRecords<InducedRuleProposal>(INDUCED_RULE_STORE);
      return proposals.map((proposal) => ({ ...proposal })).sort(compareRecords);
    },
    async listRecentFeedback(limit) {
      const events = await getRecentRecords<TasteFeedbackEvent>(FEEDBACK_STORE, limit);
      return events.map((event) => ({ ...event, imageIds: [...event.imageIds] }));
    },
    async listRecentPromptSuggestionDecisions(limit) {
      const decisions = await getRecentRecords<PromptSuggestionDecision>(PROMPT_SUGGESTION_STORE, limit);
      return decisions.map((decision) => ({ ...decision }));
    },
    readProfile<T = TasteProfile>() {
      return readDocument<T>(PROFILE_KEY);
    },
    writeProfile<T extends object>(profile: T) {
      return writeDocument(PROFILE_KEY, profile);
    },
    readState<T = TasteState>() {
      return readDocument<T>(STATE_KEY);
    },
    writeState<T extends object>(state: T) {
      return writeDocument(STATE_KEY, state);
    },
  };
}

let defaultStorage: TasteStorage | null = null;

function getDefaultStorage(): TasteStorage {
  defaultStorage ??= createTasteStorage();
  return defaultStorage;
}

export function appendTasteFeedback(input: TasteFeedbackInput): Promise<TasteFeedbackEvent> {
  return getDefaultStorage().appendFeedback(input);
}

export function listTasteFeedback(batchId?: string): Promise<TasteFeedbackEvent[]> {
  return getDefaultStorage().listFeedback(batchId);
}

export function listTasteVisualExemplars(
  itemIds: readonly string[],
): Promise<TasteVisualExemplarAsset[]> {
  return getDefaultStorage().listVisualExemplars(itemIds);
}

export function appendTasteDecision(input: TasteDecisionInput): Promise<TasteCandidateDecision> {
  return getDefaultStorage().appendDecision(input);
}

export function listTasteDecisions(candidateId?: string): Promise<TasteCandidateDecision[]> {
  return getDefaultStorage().listDecisions(candidateId);
}

export function appendTastePromptSuggestionDecision(
  input: PromptSuggestionDecisionInput,
): Promise<PromptSuggestionDecision> {
  return getDefaultStorage().appendPromptSuggestionDecision(input);
}

export function listTastePromptSuggestionDecisions(): Promise<PromptSuggestionDecision[]> {
  return getDefaultStorage().listPromptSuggestionDecisions();
}

export function appendTasteSuggestionOutcome(
  input: PromptSuggestionOutcomeInput,
): Promise<PromptSuggestionOutcome> {
  return getDefaultStorage().appendSuggestionOutcome(input);
}

export function listTasteSuggestionOutcomes(): Promise<PromptSuggestionOutcome[]> {
  return getDefaultStorage().listSuggestionOutcomes();
}

export function appendTasteInducedRuleProposal(
  input: InducedRuleProposalInput,
): Promise<InducedRuleProposal> {
  return getDefaultStorage().appendInducedRuleProposal(input);
}

export function listTasteInducedRuleProposals(): Promise<InducedRuleProposal[]> {
  return getDefaultStorage().listInducedRuleProposals();
}

export function listRecentTasteFeedback(limit: number): Promise<TasteFeedbackEvent[]> {
  return getDefaultStorage().listRecentFeedback(limit);
}

export function listRecentTastePromptSuggestionDecisions(
  limit: number,
): Promise<PromptSuggestionDecision[]> {
  return getDefaultStorage().listRecentPromptSuggestionDecisions(limit);
}

export function readTasteProfile<T = TasteProfile>(): Promise<T | null> {
  return getDefaultStorage().readProfile<T>();
}

export function writeTasteProfile<T extends object>(profile: T): Promise<void> {
  return getDefaultStorage().writeProfile(profile);
}

export function readTasteState<T = TasteState>(): Promise<T | null> {
  return getDefaultStorage().readState<T>();
}

export function writeTasteState<T extends object>(state: T): Promise<void> {
  return getDefaultStorage().writeState(state);
}
