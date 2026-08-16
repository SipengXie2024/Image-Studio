import { keyringUserFor, pickAIProfile } from "./profiles.ts";
import { cleanBaseURL } from "./security.ts";
import type { UpstreamProfile } from "../types/domain.ts";

export interface ResolvedAIChannel {
  aiProfile: UpstreamProfile;
  baseURL: string;
  textModelID: string;
  apiKey: string;
}

export type AIChannelFailure =
  | { kind: "no-profile" }
  | { kind: "insecure-remote"; profileName: string }
  | { kind: "incomplete"; profileName: string }
  | { kind: "missing-key"; profileName: string };

export type AIChannelResolution =
  | { ok: true; channel: ResolvedAIChannel }
  | { ok: false; failure: AIChannelFailure };

// Shared validation pipeline for every taste-loop consumer of the Responses AI
// channel (critic review, prompt suggestion). Keeping it in one place prevents
// the copies from drifting apart.
export async function resolveAIChannel(input: {
  profiles: UpstreamProfile[];
  aiProfileId: string;
  activeProfileId: string;
  kernelRuntimeMode: string;
  isAndroid: () => boolean;
  getStoredAPIKey: (user: string) => Promise<string>;
}): Promise<AIChannelResolution> {
  const aiProfile = pickAIProfile(input.profiles, input.aiProfileId, input.activeProfileId);
  if (!aiProfile) return { ok: false, failure: { kind: "no-profile" } };
  if (aiProfile.allowInsecureConnection && input.kernelRuntimeMode === "remote" && !input.isAndroid()) {
    return { ok: false, failure: { kind: "insecure-remote", profileName: aiProfile.name } };
  }
  const baseURL = cleanBaseURL(aiProfile.baseURL);
  const textModelID = aiProfile.textModelID.trim();
  if (!baseURL || !textModelID) {
    return { ok: false, failure: { kind: "incomplete", profileName: aiProfile.name } };
  }
  const apiKey = (await input.getStoredAPIKey(keyringUserFor(aiProfile.id)).catch(() => "")).trim();
  if (!apiKey) return { ok: false, failure: { kind: "missing-key", profileName: aiProfile.name } };
  return { ok: true, channel: { aiProfile, baseURL, textModelID, apiKey } };
}

export function aiChannelFailureMessage(purpose: string, failure: AIChannelFailure): string {
  switch (failure.kind) {
    case "no-profile":
      return `未配置可用于 ${purpose}的 Responses 渠道`;
    case "insecure-remote":
      return "允许不安全连接的 AI 渠道需要桌面本地内核";
    case "incomplete":
      return `AI 渠道「${failure.profileName}」配置不完整`;
    case "missing-key":
      return `AI 渠道「${failure.profileName}」缺少 API Key`;
  }
}

// Cheap synchronous readiness probe for UI enable/disable state — mirrors the
// synchronous half of resolveAIChannel (everything except the keyring lookup).
export function aiChannelLooksReady(
  profiles: UpstreamProfile[],
  aiProfileId: string,
  activeProfileId: string,
): boolean {
  const aiProfile = pickAIProfile(profiles, aiProfileId, activeProfileId);
  if (!aiProfile) return false;
  return !!cleanBaseURL(aiProfile.baseURL) && !!aiProfile.textModelID.trim();
}
