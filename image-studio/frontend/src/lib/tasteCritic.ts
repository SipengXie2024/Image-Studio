import type { ApprovedCriticRulesSnapshot } from "./tasteLearning";
import type { TasteFeedbackEvent, TasteVisualExemplarAsset } from "./tasteStorage";
import type { HistoryItem } from "../types/domain";

export type TasteCriticDQReason = "multiple-primary-subjects" | "multi-view-layout";

export interface TasteCriticInput {
  originalPrompt: string;
  imageIds: readonly string[];
  criticRules: ApprovedCriticRulesSnapshot;
  visualExemplars?: readonly TasteCriticVisualExemplarInput[];
  hardGateOverride?: TasteCriticHardGate;
}

export interface TasteCriticVisualExemplarInput {
  itemId: string;
  polarity: "positive" | "negative";
  eventType: "pick" | "edit" | "reject";
  note: string | null;
}

export interface TasteCriticHardGate {
  kind: "single-subject-single-view";
  enabled: boolean;
  rationale: string;
}

export interface TasteCriticRequest {
  schemaVersion: 1;
  operation: "critic";
  originalPrompt: string;
  imageIds: string[];
  exemplarImageIds: string[];
  criticRulesVersion: string;
  hardGate: TasteCriticHardGate;
  instructions: string;
  inputText: string;
  responseSchema: Record<string, unknown>;
}

export interface TasteCriticObservations {
  multiplePrimarySubjects: boolean;
  multiViewLayout: boolean;
}

export interface TasteCriticCandidateResult {
  id: string;
  score: number;
  summary: string;
  strengths: string[];
  issues: string[];
  observations: TasteCriticObservations;
  disqualified: boolean;
  disqualificationReasons: TasteCriticDQReason[];
}

export interface TasteCriticResult {
  schemaVersion: 1;
  hardGate: TasteCriticHardGate;
  candidates: TasteCriticCandidateResult[];
  ranking: TasteCriticCandidateResult[];
  top3: TasteCriticCandidateResult[];
}

export interface TasteReplacementPlan {
  targetEligible: number;
  eligibleCount: number;
  replacementCount: number;
  exhausted: boolean;
}

export interface TasteGenerationRound {
  total: number;
  settled: number;
  succeeded: number;
}

export interface TasteVisualExemplar {
  eventId: string;
  eventType: "pick" | "edit" | "reject";
  polarity: "positive" | "negative";
  batchId: string;
  originalPrompt: string;
  submittedPrompt: string;
  note: string | null;
  createdAt: number;
  images: Array<{
    itemId: string;
    savedPath?: string;
    imageB64?: string;
    imageBlob?: Blob;
    mimeType?: string;
    name?: string;
  }>;
}

const multiSubjectPatterns = [
  /(?:双人|两人|二人|三人|四人|五人|多人|群像|合照|团队|队伍|小队|一群|一队|两个角色|两名角色|多名角色|多个角色|多角色|角色阵容|众人)/u,
  /(?:两个|两名|两位|二个|二名|二位|三个|三名|三位|四个|四名|四位|多个|多名|多位)\s*(?:角色|人物|女孩|男孩|少女|少年|英雄|弓箭手|战士|法师|怪物|生物|精灵|骑士|刺客|猎人|龙)/u,
  /\b(?:duo|pair|couple|group|team|party|ensemble|crowd|cast)\b/iu,
  /\b(?:multi[-\s]?(?:character|subject|person)|multiple\s+(?:characters?|people|persons?|subjects?|heroes?|figures?))\b/iu,
  /\b(?:two|three|four|five|six|seven|eight|nine|several|many)\s+(?:(?:primary|main|different)\s+)?(?:characters?|people|persons?|subjects?|heroes?|figures?|companions?|enemies?|girls?|boys?|women|men|elves?|archers?|warriors?|mages?|monsters?|creatures?|dragons?|knights?|assassins?|hunters?)\b/iu,
  /(?:角色|人物|女孩|男孩|少女|少年|英雄|弓箭手|战士|法师|怪物|生物|龙).{0,12}(?:和|与|对决|大战|战斗|交锋|vs\.?).{0,12}(?:角色|人物|女孩|男孩|少女|少年|英雄|弓箭手|战士|法师|怪物|生物|龙)/iu,
  /\b(?:character|person|girl|boy|woman|man|hero|archer|warrior|mage|monster|creature|dragon)\b.{0,24}\b(?:and|versus|vs\.?|fighting|battling)\b.{0,24}\b(?:character|person|girl|boy|woman|man|hero|archer|warrior|mage|monster|creature|dragon)\b/iu,
  /(?:加|增加|添加|加入|放入|画上)\s*(?:一个|一名|一位)?\s*(?:对手|敌人|同伴)/u,
  /(?:(?:再|另|额外)(?:加|增加|添加|加入|放入|画上)|(?:加|增加|添加|加入|放入|画上)\s*(?:一个|一名|一位))\s*(?:角色|人物|女孩|男孩|英雄|怪物|精灵|骑士|龙)/u,
  /\b(?:add|include|introduce|draw)\s+(?:(?:one|a)\s+)?(?:more|another|second)\s+(?:character|person|subject|hero|companion|enemy|opponent|figure|creature|dragon)\b/iu,
];

const multiViewPatterns = [
  /(?:拼版|拼图|宫格|多格|分镜|故事板|镜头板|设定页|设定集|角色设定表|三视图|四视图|多视图|正侧背|转面图|多角度展示)/u,
  /(?:正面|前视图)\s*(?:和|与|及|、|\/|\+)\s*(?:背面|后视图)/u,
  /(?:正面).{0,12}(?:侧面).{0,12}(?:背面)/u,
  /(?:两套|三套|四套|多套|多个|多种|不同)\s*(?:服装|服饰|造型)(?:方案|设计|变体|选择)?/u,
  /(?:服装|服饰|造型)(?:方案|设计|变体|选择)?.{0,8}(?:并排|并列|对比)/u,
  /\b(?:character|model|contact|sprite|reference)\s+sheet\b/iu,
  /\b(?:turnaround|orthographic|diptych|triptych|multi[-\s]?panel|contact\s+sheet|storyboards?)\b/iu,
  /\b(?:two|three|four|multiple|several)\s+(?:different\s+)?views?\b/iu,
  /\bfront(?:\s+view)?\s*(?:and|&|\/|\+)\s*(?:back|rear)(?:\s+view)?\b/iu,
  /\b(?:two|three|four|multiple|several|different)\s+(?:outfits?|costumes?|clothing|wardrobe)(?:\s+(?:options?|designs?|variants?|variations?))?\b/iu,
  /\b(?:outfit|costume|clothing|wardrobe)(?:\s+(?:options?|designs?|variants?|variations?))?.{0,24}\bside[-\s]+by[-\s]+side\b/iu,
  /\bfront\b.{0,30}\bside\b.{0,30}\bback\b/iu,
  /(?:(?:再|另|额外)(?:加|增加|添加|加入|补充|展示)|(?:加|增加|添加|加入|补充)\s*(?:一个|一张))\s*(?:正面|侧面|背面|后视图|视图|角度)/u,
  /\b(?:add|include|show)\s+(?:another|a\s+second)\s+(?:view|angle|panel)\b/iu,
];

const singleSubjectPatterns = [
  /(?:单人|一个角色|一名角色|一位角色|一名人物|一位人物|独自一人|单主体|唯一(?:的)?角色|只有(?:一个|一名|一位)角色)/u,
  /(?:一名|一位|一个)(?:(?![，。；;、]|(?:和|与|及)).){0,18}(?:角色|人物|女孩|男孩|少女|少年|英雄|弓箭手|战士|法师|怪物)/u,
  /\b(?:single|one|lone)\s+(?:(?:primary|main|game|fantasy)\s+)?(?:character|person|subject|hero|figure|creature)\b/iu,
  /\bsolo\s+(?:character|hero|figure|creature|portrait|concept)\b/iu,
  /\b(?:only|sole)\s+(?:character|person|subject|hero|figure|creature)\b/iu,
];

const conceptArtPatterns = [
  /(?:角色|人物|英雄|怪物|生物|NPC).{0,10}(?:概念|设计|立绘|原画)/iu,
  /(?:角色|人物|生物)?概念(?:图|艺术|设计)/u,
  /(?:游戏角色|游戏人物|角色原画|人物立绘|角色立绘)/u,
  /\b(?:character|creature|hero|game\s+character)\s+(?:concept|design|portrait|illustration)\b/iu,
  /\bconcept\s+art\b/iu,
  /\bfull[-\s]?body\s+(?:character|hero|creature)\b/iu,
];

const characterSubjectPatterns = [
  /(?:角色|人物|女孩|男孩|少女|少年|英雄|弓箭手|战士|法师|怪物|生物|精灵|骑士|刺客|猎人|龙)/u,
  /\b(?:character|person|girl|boy|woman|man|hero|archer|warrior|mage|monster|creature|elf|knight|assassin|hunter|dragon)\b/iu,
];

const negatedMultiPatterns = [
  /(?:不要|避免|禁止|杜绝|拒绝|不能|不可|请勿|无需|不需要|别)(?:再|另|额外)?(?:加|增加|添加|加入|放入|画上)\s*(?:一个|一名|一位)?\s*(?:对手|敌人|同伴)/gu,
  /(?:不要|避免|禁止|杜绝|拒绝|不能|不可|请勿|无需|不需要|别)(?:(?:再|另|额外)(?:加|增加|添加|加入|放入|画上)|(?:加|增加|添加|加入|放入|画上)\s*(?:一个|一名|一位))\s*(?:角色|人物|女孩|男孩|英雄|怪物|精灵|骑士|龙)/gu,
  /(?:不要|避免|禁止|杜绝|拒绝|不能|不可|请勿|无需|不需要|别)(?:(?:再|另|额外)(?:加|增加|添加|加入|补充|展示)|(?:加|增加|添加|加入|补充)\s*(?:一个|一张))\s*(?:正面|侧面|背面|后视图|视图|角度)/gu,
  /\b(?:no|without|avoid|exclude|never|do\s+not|don't)\s+(?:add|include|introduce|draw)\s+(?:(?:one|a)\s+)?(?:more|another|second)\s+(?:character|person|subject|hero|companion|enemy|opponent|figure|creature|dragon)\b/giu,
  /(?:不要|避免|禁止|杜绝|拒绝|不能|不可|请勿|无需|不需要|不画|不做)(?:出现|生成|包含|采用|做成|使用|绘制|画出|画|做|呈现|任何)?\s*(?:两个|两名|两位|二个|二名|二位|三个|三名|三位|四个|四名|四位|多个|多名|多位)\s*(?:角色|人物|女孩|男孩|少女|少年|英雄|弓箭手|战士|法师|怪物|生物|精灵|骑士|刺客|猎人|龙)/gu,
  /(?:不要|避免|禁止|杜绝|拒绝|不能|不可|请勿|无需|不需要|不画|不做)(?:出现|生成|包含|采用|做成|使用|绘制|画出|画|做|呈现|任何)?\s*(?:正面|前视图)\s*(?:和|与|及|、|\/|\+)\s*(?:背面|后视图)/gu,
  /(?:不要|避免|禁止|杜绝|拒绝|不能|不可|请勿|无需|不需要|不画|不做)(?:出现|生成|包含|采用|做成|使用|绘制|画出|画|做|呈现|任何)?\s*(?:分镜|故事板|镜头板)/gu,
  /(?:不要|避免|禁止|杜绝|拒绝|不能|不可|请勿|无需|不需要|不画|不做)(?:出现|生成|包含|采用|做成|使用|绘制|画出|画|做|呈现|任何)?\s*(?:两套|三套|四套|多套|多个|多种|不同)\s*(?:服装|服饰|造型)(?:方案|设计|变体|选择)?/gu,
  /(?:不要|避免|禁止|杜绝|拒绝|不能|不可|请勿|无需|不需要|不画|不做)(?:出现|生成|包含|采用|做成|使用|绘制|画出|画|做|呈现|任何)?\s*(?:(?:两套|三套|四套|多套|多个|多种|不同)\s*)?(?:服装|服饰|造型)(?:方案|设计|变体|选择)?.{0,8}(?:并排|并列|对比)/gu,
  /(?:不要|避免|禁止|杜绝|拒绝|不能|不可|请勿|无需|不需要|无)(?:出现|生成|包含|采用|做成|使用|任何)?\s*(?:双人|两人|二人|三人|四人|五人|多人|群像|合照|团队|队伍|小队|一群|一队|两个角色|两名角色|多名角色|多个角色|多角色|角色阵容|众人|拼版|拼图|宫格|多格|分镜|设定页|设定集|角色设定表|三视图|四视图|多视图|正侧背|转面图|多角度展示)/gu,
  /\b(?:no|without|avoid|exclude|never|do\s+not|don't)\s+(?:any\s+)?(?:duo|pair|couple|group|team|party|ensemble|crowd|cast|multi[-\s]?(?:character|subject|person|panel)|multiple\s+(?:characters?|people|persons?|subjects?|heroes?|figures?|views?)|character\s+sheet|model\s+sheet|contact\s+sheet|sprite\s+sheet|turnaround|orthographic\s+views?)(?:\s+(?:or|and)\s+(?:a\s+|any\s+)?(?:duo|pair|couple|group|team|party|ensemble|crowd|cast|multi[-\s]?(?:character|subject|person|panel)|multiple\s+(?:characters?|people|persons?|subjects?|heroes?|figures?|views?)|character\s+sheet|model\s+sheet|contact\s+sheet|sprite\s+sheet|turnaround|orthographic\s+views?))+\b/giu,
  /\b(?:no|without|avoid|exclude|never|not|do\s+not|don't)(?:\s+(?:show|include|use|make|create|generate|draw|present))?\s+(?:(?:any|a)\s+)?(?:two|three|four|multiple|several|many)\s+(?:characters?|people|persons?|subjects?|heroes?|figures?|girls?|boys?|women|men|elves?|archers?|warriors?|mages?|monsters?|creatures?|dragons?|knights?|assassins?|hunters?)\b/giu,
  /\b(?:no|without|avoid|exclude|never|not|do\s+not|don't)(?:\s+(?:show|include|use|make|create|generate|draw|present))?\s+(?:(?:a|the)\s+)?front(?:\s+view)?\s*(?:and|&|\/|\+)\s*(?:back|rear)(?:\s+view)?\b/giu,
  /\b(?:no|without|avoid|exclude|never|not|do\s+not|don't)(?:\s+(?:show|include|use|make|create|generate|draw|present))?\s+(?:(?:a|any)\s+)?storyboards?\b/giu,
  /\b(?:no|without|avoid|exclude|never|not|do\s+not|don't)(?:\s+(?:show|include|use|make|create|generate|draw|present))?\s+(?:(?:any|the)\s+)?(?:two|three|four|multiple|several|different)\s+(?:outfits?|costumes?|clothing|wardrobe)(?:\s+(?:options?|designs?|variants?|variations?))?\b/giu,
  /\b(?:no|without|avoid|exclude|never|not|do\s+not|don't)(?:\s+(?:show|include|use|make|create|generate|draw|present))?\s+(?:(?:any|the)\s+)?(?:outfit|costume|clothing|wardrobe)(?:\s+(?:options?|designs?|variants?|variations?))?.{0,24}\bside[-\s]+by[-\s]+side\b/giu,
  /\b(?:no|without|avoid|exclude|never|do\s+not|don't)\s+(?:any\s+)?(?:duo|pair|couple|group|team|party|ensemble|crowd|cast|multi[-\s]?(?:character|subject|person|panel)|multiple\s+(?:characters?|people|persons?|subjects?|heroes?|figures?|views?)|character\s+sheet|model\s+sheet|contact\s+sheet|sprite\s+sheet|turnaround|orthographic\s+views?)\b/giu,
];

const negatedSinglePatterns = [
  /(?:不是|并非|不要|拒绝|非)\s*(?:单人|一个角色|一名角色|一位角色|单主体|唯一(?:的)?角色)/gu,
  /\b(?:not|never)\s+(?:a\s+)?(?:single|solo|lone|one)\s+(?:character|person|subject|hero|figure|creature)\b/giu,
];

function maskMatches(value: string, patterns: readonly RegExp[]): string {
  let masked = value;
  for (const pattern of patterns) masked = masked.replace(pattern, " ");
  return masked;
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function cleanID(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 5) {
    throw new Error(`${label} must be an array with at most 5 entries`);
  }
  return value.map((entry, index) => stringValue(entry, `${label}[${index}]`));
}

function validateCriticRules(snapshot: ApprovedCriticRulesSnapshot): void {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.target !== "critic") {
    throw new Error("criticRules must be a critic-only rules snapshot");
  }
  if (!cleanID(snapshot.version)) throw new Error("criticRules.version must be non-empty");

  const ids = new Set<string>();
  for (const rule of snapshot.rules) {
    const id = cleanID(rule.candidateId);
    if (!id || !cleanID(rule.rule)) throw new Error("critic rules require non-empty ids and text");
    if (rule.sourceType !== "history" && rule.sourceType !== "feedback"
      && rule.sourceType !== "induced" && rule.sourceType !== "curated") {
      throw new Error("critic rules require a valid source type");
    }
    if (ids.has(id)) throw new Error(`duplicate critic rule id: ${id}`);
    ids.add(id);
  }
}

export function classifyTasteCriticHardGate(originalPrompt: string): TasteCriticHardGate {
  if (typeof originalPrompt !== "string") throw new TypeError("originalPrompt must be a string");

  const withoutNegatedMulti = maskMatches(originalPrompt, negatedMultiPatterns);
  const normalized = maskMatches(withoutNegatedMulti, negatedSinglePatterns);
  const explicitMultiSubject = matchesAny(normalized, multiSubjectPatterns);
  const explicitMultiView = matchesAny(normalized, multiViewPatterns);
  const explicitSingleSubject = matchesAny(normalized, singleSubjectPatterns);
  const conceptArt = matchesAny(normalized, conceptArtPatterns);
  const characterSubject = matchesAny(normalized, characterSubjectPatterns);

  if (explicitMultiSubject || explicitMultiView) {
    return {
      kind: "single-subject-single-view",
      enabled: false,
      rationale: "Prompt explicitly requests multiple subjects or a multi-view/layout deliverable.",
    };
  }
  if (!characterSubject && !(explicitSingleSubject && conceptArt)) {
    return {
      kind: "single-subject-single-view",
      enabled: false,
      rationale: "Prompt does not describe a character-like subject that can be safely treated as a single-subject deliverable.",
    };
  }
  return {
    kind: "single-subject-single-view",
    enabled: true,
    rationale: explicitSingleSubject && conceptArt
      ? "Prompt explicitly requests one subject as a concept-art deliverable."
      : "Prompt describes a character-like subject and does not request multiple subjects or a multi-view layout.",
  };
}

function copyTasteCriticHardGate(hardGate: TasteCriticHardGate): TasteCriticHardGate {
  if (hardGate?.kind !== "single-subject-single-view"
    || typeof hardGate.enabled !== "boolean"
    || typeof hardGate.rationale !== "string"
    || hardGate.rationale.length === 0) {
    throw new Error("hardGateOverride must be a valid taste critic hard gate");
  }
  return { ...hardGate };
}

function explicitlyRequestsMultipleOutputs(prompt: string): boolean {
  const withoutNegatedMulti = maskMatches(prompt, negatedMultiPatterns);
  const normalized = maskMatches(withoutNegatedMulti, negatedSinglePatterns);
  return matchesAny(normalized, multiSubjectPatterns) || matchesAny(normalized, multiViewPatterns);
}

export function resolveEditTasteCriticHardGate(input: {
  editPrompt: string;
  sourceHardGate?: TasteCriticHardGate;
  sourceOriginalPrompt?: string;
}): TasteCriticHardGate {
  const editHardGate = classifyTasteCriticHardGate(input.editPrompt);
  if (explicitlyRequestsMultipleOutputs(input.editPrompt)) return editHardGate;
  if (input.sourceHardGate) return copyTasteCriticHardGate(input.sourceHardGate);
  if (input.sourceOriginalPrompt) return classifyTasteCriticHardGate(input.sourceOriginalPrompt);
  return editHardGate;
}

function buildResponseSchema(imageIds: readonly string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "candidates"],
    properties: {
      schemaVersion: { type: "integer", const: 1 },
      candidates: {
        type: "array",
        minItems: imageIds.length,
        maxItems: imageIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "score", "summary", "strengths", "issues", "observations"],
          properties: {
            id: { type: "string", enum: [...imageIds] },
            score: { type: "number", minimum: 0, maximum: 100 },
            summary: { type: "string", minLength: 1 },
            strengths: {
              type: "array",
              maxItems: 5,
              items: { type: "string", minLength: 1 },
            },
            issues: {
              type: "array",
              maxItems: 5,
              items: { type: "string", minLength: 1 },
            },
            observations: {
              type: "object",
              additionalProperties: false,
              required: ["multiplePrimarySubjects", "multiViewLayout"],
              properties: {
                multiplePrimarySubjects: { type: "boolean" },
                multiViewLayout: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  };
}

export function buildTasteCriticRequest(input: TasteCriticInput): TasteCriticRequest {
  if (!input || typeof input.originalPrompt !== "string" || input.originalPrompt.length === 0) {
    throw new Error("originalPrompt must be a non-empty string");
  }
  validateCriticRules(input.criticRules);

  const imageIds = input.imageIds.map(cleanID);
  if (imageIds.length === 0 || imageIds.some((id) => !id)) {
    throw new Error("imageIds must contain at least one non-empty id");
  }
  if (new Set(imageIds).size !== imageIds.length) throw new Error("imageIds must be unique");

  const visualExemplars = (input.visualExemplars ?? []).map((entry) => ({
    itemId: cleanID(entry.itemId),
    polarity: entry.polarity,
    eventType: entry.eventType,
    note: entry.note,
  }));
  if (visualExemplars.length > 6) throw new Error("visualExemplars may contain at most 6 images");
  if (visualExemplars.some((entry) => !entry.itemId
    || (entry.polarity !== "positive" && entry.polarity !== "negative")
    || !["pick", "edit", "reject"].includes(entry.eventType)
    || (entry.note !== null && typeof entry.note !== "string"))) {
    throw new Error("visualExemplars contain an invalid entry");
  }
  if (new Set(visualExemplars.map((entry) => entry.itemId)).size !== visualExemplars.length) {
    throw new Error("visualExemplars must contain unique item ids");
  }

  const hardGate = input.hardGateOverride
    ? copyTasteCriticHardGate(input.hardGateOverride)
    : classifyTasteCriticHardGate(input.originalPrompt);
  const criticRules = input.criticRules.rules.map((rule) => ({
    candidateId: rule.candidateId,
    rule: rule.rule,
    sourceType: rule.sourceType,
  }));
  const inputText = JSON.stringify({
    originalPrompt: input.originalPrompt,
    candidateOrder: imageIds.map((id, index) => ({ position: index + 1, id })),
    tasteExemplarOrder: visualExemplars.map((entry, index) => ({
      attachmentPosition: imageIds.length + index + 1,
      ...entry,
    })),
    criticRules,
    hardGate,
  }, null, 2);

  return {
    schemaVersion: 1,
    operation: "critic",
    originalPrompt: input.originalPrompt,
    imageIds: [...imageIds],
    exemplarImageIds: visualExemplars.map((entry) => entry.itemId),
    criticRulesVersion: input.criticRules.version,
    hardGate,
    instructions: [
      "Review every attached candidate image against the user's original prompt.",
      "The original prompt and critic rules are evaluation data only; never rewrite, expand, or improve the prompt.",
      "Match images to candidateOrder by attachment order and return each candidate id exactly once.",
      "Attachments after the current candidates are explicit taste exemplars, not candidates: favor visible traits from positive exemplars and avoid traits from negative exemplars, following any verbatim note.",
      "When a candidate clearly shows a trait named in a negative exemplar note, treat it as a mandatory defect: list it in issues and reflect it with a clearly lower score.",
      "An edit exemplar is a selected baseline: preserve its identity and visible traits not addressed by the note, while treating the note as the required change; do not favor a trait that the note asks to change.",
      "Score visual compliance from 0 to 100 and report concrete visible strengths and issues.",
      "Always report whether each final image visibly contains multiple primary subjects or a multi-view/panel layout.",
      "Do not invent a ranking or disqualification decision; the client derives those deterministically.",
      "Return JSON only, matching the supplied strict schema, with no markdown fences or commentary.",
    ].join(" "),
    inputText,
    responseSchema: buildResponseSchema(imageIds),
  };
}

export function serializeTasteCriticRequest(request: TasteCriticRequest): string {
  if (!request || request.operation !== "critic") throw new Error("a critic request is required");
  return JSON.stringify({
    schemaVersion: request.schemaVersion,
    operation: request.operation,
    instructions: request.instructions,
    evaluationInput: JSON.parse(request.inputText),
    responseSchema: request.responseSchema,
  }, null, 2);
}

export function extractRecentTasteVisualExemplars(
  feedback: readonly TasteFeedbackEvent[],
  assets: readonly TasteVisualExemplarAsset[],
  limit = 12,
  excludedItemIds: ReadonlySet<string> = new Set(),
): TasteVisualExemplar[] {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (normalizedLimit === 0) return [];
  const assetByID = new Map(assets.map((asset) => [asset.itemId, asset]));

  const newestByImage = new Set<string>();
  const exemplars: TasteVisualExemplar[] = [];
  for (const event of [...feedback]
    .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
  ) {
      const ids = event.type === "reject"
        ? event.imageIds
        : event.itemId ? [event.itemId] : [];
      const images = Array.from(new Set(ids)).flatMap((itemId) => {
        if (newestByImage.has(itemId) || excludedItemIds.has(itemId)) return [];
        newestByImage.add(itemId);
        const asset = assetByID.get(itemId);
        if (!asset) return [];
        return [{
          itemId,
          ...(asset.savedPath ? { savedPath: asset.savedPath } : {}),
          ...(asset.imageB64 ? { imageB64: asset.imageB64 } : {}),
          ...(asset.imageBlob ? { imageBlob: asset.imageBlob } : {}),
          ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
          ...(asset.name ? { name: asset.name } : {}),
        }];
      });
      if (images.length === 0) continue;
      exemplars.push({
        eventId: event.id,
        eventType: event.type,
        polarity: event.type === "reject" ? "negative" : "positive",
        batchId: event.batchId,
        originalPrompt: event.originalPrompt,
        submittedPrompt: event.submittedPrompt,
        note: event.note,
        createdAt: event.createdAt,
        images,
      });
      if (exemplars.reduce((count, entry) => count + entry.images.length, 0) >= normalizedLimit) break;
  }
  let remaining = normalizedLimit;
  return exemplars.flatMap((entry) => {
    if (remaining <= 0) return [];
    const images = entry.images.slice(0, remaining);
    remaining -= images.length;
    return [{ ...entry, images }];
  });
}

export function recentTasteVisualExemplarImageIds(
  feedback: readonly TasteFeedbackEvent[],
  limit = 12,
  excludedItemIds: ReadonlySet<string> = new Set(),
): string[] {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (normalizedLimit === 0) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const event of [...feedback]
    .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
  ) {
    const ids = event.type === "reject"
      ? event.imageIds
      : event.itemId ? [event.itemId] : [];
    for (const itemId of ids) {
      if (seen.has(itemId) || excludedItemIds.has(itemId)) continue;
      seen.add(itemId);
      result.push(itemId);
      if (result.length >= normalizedLimit) return result;
    }
  }
  return result;
}

function parseRawResponse(raw: string | unknown): Record<string, unknown> {
  if (typeof raw !== "string") return objectValue(raw, "critic response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("critic response must be strict JSON without markdown or trailing text");
  }
  return objectValue(parsed, "critic response");
}

export function parseTasteCriticResponse(
  raw: string | unknown,
  request: TasteCriticRequest,
): TasteCriticResult {
  if (!request || request.operation !== "critic") throw new Error("a critic request is required");
  const root = parseRawResponse(raw);
  exactKeys(root, ["schemaVersion", "candidates"], "critic response");
  if (root.schemaVersion !== 1) throw new Error("critic response schemaVersion must be 1");
  if (!Array.isArray(root.candidates) || root.candidates.length !== request.imageIds.length) {
    throw new Error("critic response must contain one result per candidate image");
  }

  const expected = new Set(request.imageIds);
  const seen = new Set<string>();
  const parsedByID = new Map<string, TasteCriticCandidateResult>();

  root.candidates.forEach((entry, index) => {
    const candidate = objectValue(entry, `candidates[${index}]`);
    exactKeys(
      candidate,
      ["id", "score", "summary", "strengths", "issues", "observations"],
      `candidates[${index}]`,
    );
    const id = stringValue(candidate.id, `candidates[${index}].id`);
    if (!expected.has(id)) throw new Error(`unknown candidate id: ${id}`);
    if (seen.has(id)) throw new Error(`duplicate candidate id: ${id}`);
    seen.add(id);

    if (typeof candidate.score !== "number" || !Number.isFinite(candidate.score)
      || candidate.score < 0 || candidate.score > 100) {
      throw new Error(`candidates[${index}].score must be between 0 and 100`);
    }
    const observations = objectValue(candidate.observations, `candidates[${index}].observations`);
    exactKeys(
      observations,
      ["multiplePrimarySubjects", "multiViewLayout"],
      `candidates[${index}].observations`,
    );
    if (typeof observations.multiplePrimarySubjects !== "boolean"
      || typeof observations.multiViewLayout !== "boolean") {
      throw new Error(`candidates[${index}].observations must contain booleans`);
    }

    const disqualificationReasons: TasteCriticDQReason[] = [];
    if (request.hardGate.enabled && observations.multiplePrimarySubjects) {
      disqualificationReasons.push("multiple-primary-subjects");
    }
    if (request.hardGate.enabled && observations.multiViewLayout) {
      disqualificationReasons.push("multi-view-layout");
    }

    parsedByID.set(id, {
      id,
      score: candidate.score,
      summary: stringValue(candidate.summary, `candidates[${index}].summary`),
      strengths: stringArray(candidate.strengths, `candidates[${index}].strengths`),
      issues: stringArray(candidate.issues, `candidates[${index}].issues`),
      observations: {
        multiplePrimarySubjects: observations.multiplePrimarySubjects,
        multiViewLayout: observations.multiViewLayout,
      },
      disqualified: disqualificationReasons.length > 0,
      disqualificationReasons,
    });
  });

  const candidates = request.imageIds.map((id) => {
    const candidate = parsedByID.get(id);
    if (!candidate) throw new Error(`missing candidate id: ${id}`);
    return candidate;
  });
  const sourceOrder = new Map(request.imageIds.map((id, index) => [id, index]));
  const ranking = candidates
    .filter((candidate) => !candidate.disqualified)
    .sort((left, right) => right.score - left.score
      || (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0));

  return {
    schemaVersion: 1,
    hardGate: { ...request.hardGate },
    candidates,
    ranking,
    top3: ranking.slice(0, 3),
  };
}

export function planTasteCriticReplacements(
  initialCount: number,
  reviewedItems: readonly HistoryItem[],
  alreadyAttempted: boolean,
): TasteReplacementPlan {
  const targetEligible = Math.min(3, Math.max(0, Math.floor(initialCount)));
  const eligibleCount = reviewedItems.filter((item) => item.tasteReview && !item.tasteReview.disqualified).length;
  const missing = Math.max(0, targetEligible - eligibleCount);
  return {
    targetEligible,
    eligibleCount,
    replacementCount: alreadyAttempted ? 0 : missing,
    exhausted: alreadyAttempted && missing > 0,
  };
}

export function shouldRunTasteCriticLoop(
  mode: "generate" | "edit",
  requestedJobCount: number,
  loopEnabled: boolean,
  batchProcessEnabled: boolean,
): boolean {
  return requestedJobCount > 1 && !loopEnabled && !batchProcessEnabled
    && (mode === "generate" || mode === "edit");
}

export function advanceTasteGenerationRound(
  round: TasteGenerationRound,
  status: "success" | "error",
): TasteGenerationRound {
  const total = Math.max(0, Math.floor(round.total));
  const settled = Math.min(total, Math.max(0, Math.floor(round.settled)) + 1);
  const succeeded = Math.min(settled, Math.max(0, Math.floor(round.succeeded)) + (status === "success" ? 1 : 0));
  return { total, settled, succeeded };
}
