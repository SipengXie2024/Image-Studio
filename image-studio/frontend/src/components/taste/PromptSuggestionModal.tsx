import { useRef, useState } from "react";
import { Modal } from "../common/Modal";
import { SourceLightbox, SourceThumb, type SourcePreviewImage } from "./sourceThumbs";

export function PromptSuggestionModal({
  originalPrompt,
  draftPrompt,
  sourcePaths,
  appliedRuleCount,
  submitting,
  onDecide,
  onClose,
}: {
  originalPrompt: string;
  draftPrompt: string;
  sourcePaths: readonly string[];
  appliedRuleCount: number;
  submitting: boolean;
  onDecide: (input: { decision: "accept" | "reject"; finalPrompt?: string }) => void | Promise<void>;
  onClose: () => void;
}) {
  const sourceNames = sourcePaths.map((path) => path.split(/[\\/]/).pop() || path);
  const [previewImage, setPreviewImage] = useState<SourcePreviewImage | null>(null);
  const [text, setText] = useState(draftPrompt);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const edited = text !== draftPrompt;
  const canAccept = !!text.trim() && !submitting;

  async function decide(decision: "accept" | "reject") {
    if (submittingRef.current || submitting) return;
    if (decision === "accept" && !text.trim()) return;
    submittingRef.current = true;
    setError("");
    try {
      await onDecide(decision === "accept" ? { decision, finalPrompt: text } : { decision });
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : String(decideError));
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!submitting) onClose();
      }}
      title="Harness 改进建议"
      width={560}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">原提示词</span>
          <p className="taste-quote-block">{originalPrompt}</p>
        </div>

        {sourceNames.length > 0 ? (
          <div className="space-y-1.5">
            <p className="taste-list-item-meta">采纳后将带原批次的 {sourceNames.length} 张参考图重新生成:</p>
            <div className="taste-source-thumbs">
              {sourcePaths.map((path) => (
                <SourceThumb key={path} path={path} onPreview={setPreviewImage} />
              ))}
            </div>
          </div>
        ) : (
          <p className="taste-list-item-meta">采纳后为纯文生图重新生成(原批次没有参考图)。</p>
        )}

        {appliedRuleCount > 0 ? (
          <p className="taste-list-item-meta">起草时参考了你已采纳的 {appliedRuleCount} 条口味规则。</p>
        ) : null}

        <label className="block space-y-2">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
            改进建议(可直接编辑;采纳后按此文本重新生成)
          </span>
          <textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            rows={7}
            className="focus-ring w-full resize-y rounded-[12px] border border-black/[0.1] bg-[var(--surface)] px-3 py-2.5 text-sm leading-6 text-zinc-900 outline-none dark:border-white/[0.1] dark:text-zinc-100"
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-[10px] bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-600 dark:text-red-300">
            操作失败:{error}
          </p>
        ) : null}

        <div className="taste-modal-actions taste-modal-actions-split">
          <button
            type="button"
            onClick={() => void decide("reject")}
            disabled={submitting}
            className="taste-btn taste-btn-danger"
          >
            拒绝草稿
          </button>
          <div className="taste-modal-actions-group">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="taste-btn taste-btn-ghost"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void decide("accept")}
              disabled={!canAccept}
              className="taste-btn taste-btn-primary"
            >
              {submitting ? "提交中..." : edited ? "按修改采纳并生成" : "原样采纳并生成"}
            </button>
          </div>
        </div>
      </div>
      {previewImage ? <SourceLightbox image={previewImage} onClose={() => setPreviewImage(null)} /> : null}
    </Modal>
  );
}
