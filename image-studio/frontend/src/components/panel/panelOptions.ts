import type { QualityValue, SizeValue } from "../../types/domain";
import { classifyImageModel } from "../../../../../shared/kernel/requestModel.js";

// Preset style chips removed on purpose: canned suffixes silently mutated the
// submitted prompt, which conflicts with the taste-loop's verbatim-prompt
// contract. Personal taste now comes from approved rules, not canned tags.
// The styleTag field itself stays for persistence/preset compatibility.
export const STYLE_CHIPS: { id: string; label: string; hint: string }[] = [];

// auto 不展示具体方框形状,留给上游决定。
export const ASPECT_OPTIONS: { value: SizeValue; label: string; w: number; h: number; auto?: boolean }[] = [
  { value: "auto", label: "Auto", w: 18, h: 18, auto: true },
  { value: "1024x1024", label: "1:1", w: 18, h: 18 },
  { value: "1024x1536", label: "2:3", w: 14, h: 20 },
  { value: "1152x2048", label: "9:16", w: 12, h: 22 },
  { value: "1536x1024", label: "3:2", w: 22, h: 14 },
  { value: "2048x1152", label: "16:9", w: 24, h: 13 },
];

export const QUALITY_TIERS: { value: QualityValue; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "low", label: "快速" },
  { value: "medium", label: "标准" },
  { value: "high", label: "精修" },
  { value: "standard", label: "standard" },
  { value: "hd", label: "hd" },
];

export function availableQualityOptions(imageModelID?: string): Array<{ value: QualityValue; label: string }> {
  const family = classifyImageModel(imageModelID || "");
  if (family === "dalle2") {
    return QUALITY_TIERS.filter((item) => item.value === "auto" || item.value === "standard");
  }
  if (family === "dalle3") {
    return QUALITY_TIERS.filter((item) => item.value === "auto" || item.value === "standard" || item.value === "hd");
  }
  return QUALITY_TIERS.filter((item) => item.value === "auto" || item.value === "low" || item.value === "medium" || item.value === "high");
}

export function normalizeQualitySelection(value: string, imageModelID?: string): QualityValue {
  const allowed = availableQualityOptions(imageModelID);
  return allowed.some((item) => item.value === value) ? value as QualityValue : allowed[0].value;
}
