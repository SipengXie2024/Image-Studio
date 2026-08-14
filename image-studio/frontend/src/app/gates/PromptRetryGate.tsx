import { Sparkles } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { aiChannelLooksReady } from "../../lib/aiChannel";
import { PromptSuggestionModal } from "../../components/taste/PromptSuggestionModal";

export function PromptRetryGate() {
  const offer = useStudioStore((state) => state.promptRetryOffer);
  const suggestion = useStudioStore((state) => state.promptSuggestion);
  const drafting = useStudioStore((state) => state.promptSuggestionDrafting);
  const submitting = useStudioStore((state) => state.promptSuggestionSubmitting);
  const profiles = useStudioStore((state) => state.profiles);
  const aiProfileId = useStudioStore((state) => state.aiProfileId);
  const activeProfileId = useStudioStore((state) => state.activeProfileId);
  const isRunning = useStudioStore((state) => state.isRunning);
  const draftSuggestion = useStudioStore((state) => state.draftPromptSuggestion);
  const decideSuggestion = useStudioStore((state) => state.decidePromptSuggestion);
  const dismissOffer = useStudioStore((state) => state.dismissPromptRetryOffer);
  const closeSuggestion = useStudioStore((state) => state.closePromptSuggestion);
  const settingsOpen = useStudioStore((state) => state.settingsOpen);
  const upstreamModalOpen = useStudioStore((state) => state.upstreamModalOpen);
  const appUpdateModalOpen = useStudioStore((state) => state.appUpdateModalOpen);
  const tasteBootstrapOpen = useStudioStore((state) => state.tasteBootstrapOpen);

  if (settingsOpen || upstreamModalOpen || appUpdateModalOpen || tasteBootstrapOpen) return null;

  if (suggestion) {
    return (
      <PromptSuggestionModal
        originalPrompt={suggestion.offer.originalPrompt}
        draftPrompt={suggestion.draftPrompt}
        sourcePaths={suggestion.offer.sourcePaths}
        appliedRuleCount={suggestion.appliedRuleCount}
        submitting={submitting}
        onDecide={decideSuggestion}
        onClose={closeSuggestion}
      />
    );
  }

  if (!offer) return null;
  const aiReady = aiChannelLooksReady(profiles, aiProfileId, activeProfileId);
  const disabled = !aiReady || drafting || isRunning;

  return (
    <div className="taste-retry-card">
      <p className="taste-retry-card-title">本批已记录为不满意</p>
      <p className="taste-retry-card-note">要不要让 harness 基于你的反馈改进提示词?</p>
      <div className="taste-retry-card-actions">
        <button
          type="button"
          onClick={() => void draftSuggestion()}
          disabled={disabled}
          title={!aiReady ? "先在上游配置里新建一个 Responses 渠道并「设为 AI」" : undefined}
          className="taste-btn taste-btn-primary"
        >
          <Sparkles aria-hidden="true" />
          {drafting ? "起草中..." : "在 harness 辅助下再来一次"}
        </button>
        <button
          type="button"
          onClick={dismissOffer}
          disabled={drafting}
          className="taste-btn taste-btn-ghost"
        >
          忽略
        </button>
      </div>
    </div>
  );
}
