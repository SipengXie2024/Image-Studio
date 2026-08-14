import { useRef, useState, type FormEvent } from "react";
import { Loader2, Wand2 } from "lucide-react";
import type { HistoryItem } from "../../types/domain";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import { SourceLightbox, SourceThumb, type SourcePreviewImage } from "./sourceThumbs";

export type FeedbackModalRequest =
  | { kind: "edit"; item: HistoryItem; items: HistoryItem[] }
  | { kind: "reject"; items: HistoryItem[] };

export type BatchReviewCallbacks = {
  onPick?: (item: HistoryItem) => void | Promise<void>;
  onEdit?: (input: { item: HistoryItem; items: HistoryItem[]; note: string; keepSourcePaths?: readonly string[] }) => void | Promise<void>;
  onReject?: (input: { items: HistoryItem[]; note: string }) => void | Promise<void>;
};

export function FeedbackModal({
  request,
  onClose,
  onSubmit,
}: {
  request: FeedbackModalRequest;
  onClose: () => void;
  onSubmit: (note: string, keepSourcePaths: string[]) => void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const [previewImage, setPreviewImage] = useState<SourcePreviewImage | null>(null);
  const [keptPaths, setKeptPaths] = useState<readonly string[]>([]);
  const refineEditNote = useStudioStore((state) => state.refineEditNote);
  const refining = useStudioStore((state) => state.editNoteRefining);
  const isEdit = request.kind === "edit";
  const trimmedNote = note.trim();
  const prompt = isEdit ? request.item.prompt.trim() : "";
  const basePath = isEdit ? request.item.savedPath?.trim() ?? "" : "";
  // Reference images the rejected batch was generated with; each can be kept
  // for the next edit round alongside the selected base image.
  const referencePaths = isEdit
    ? Array.from(new Set((request.item.sourcePaths ?? []).filter((path) => path.trim() && path !== basePath)))
    : [];

  function toggleKept(path: string) {
    setKeptPaths((current) => (
      current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path]
    ));
  }

  async function refine() {
    if (!isEdit || refining || submitting) return;
    const refined = await refineEditNote({ note, originalPrompt: request.item.prompt });
    if (refined) setNote(refined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || (isEdit && !trimmedNote)) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(note, referencePaths.filter((path) => keptPaths.includes(path)));
    } catch (submitError) {
      submittingRef.current = false;
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={isEdit ? "选定并提建议" : "全部不满意"}
      width={520}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-2">
          <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
            {isEdit
              ? "这张图会被记为选定。你的建议将按原文保存，不会被自动改写。"
              : `本批 ${request.items.length} 张都会被记为不满意。原因可以留空。`}
          </p>
          {prompt ? (
            <p className="line-clamp-2 rounded-[12px] border border-black/[0.06] bg-black/[0.025] px-3 py-2 text-xs leading-5 text-zinc-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-zinc-300">
              {prompt}
            </p>
          ) : null}
        </div>

        {isEdit ? (
          <div className="space-y-1.5">
            <p className="taste-list-item-meta">下一轮将以这张选定图为基底进行编辑:</p>
            <div className="taste-source-thumbs">
              {basePath
                ? <SourceThumb path={basePath} onPreview={setPreviewImage} />
                : <span className="taste-chip taste-chip-muted">选中图(本地文件不可用)</span>}
            </div>
            {referencePaths.length > 0 ? (
              <>
                <p className="taste-list-item-meta">本批生成时的参考图 · 勾选后随基底图一起进入下一轮,harness 会记住你延续了哪些参考:</p>
                <div className="taste-source-thumbs">
                  {referencePaths.map((path) => (
                    <label
                      key={path}
                      className={`taste-source-keep ${keptPaths.includes(path) ? "kept" : ""}`}
                      title="勾选后这张参考图继续参与下一轮编辑"
                    >
                      <input
                        type="checkbox"
                        checked={keptPaths.includes(path)}
                        onChange={() => toggleKept(path)}
                        disabled={submitting}
                      />
                      <SourceThumb path={path} onPreview={setPreviewImage} />
                    </label>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        <label className="block space-y-2">
          <span className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
            {isEdit ? "你的建议（必填）" : "不满意的原因（选填）"}
            {isEdit ? (
              <button
                type="button"
                onClick={() => void refine()}
                disabled={refining || submitting || !trimmedNote}
                title="让 harness 把你的建议改写成更明确的编辑指令;结果回填后你仍可修改"
                className="taste-btn taste-btn-ghost taste-btn-sm"
              >
                {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {refining ? "优化中..." : "让 harness 优化"}
              </button>
            ) : null}
          </span>
          <textarea
            autoFocus
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder={isEdit ? "例如：保留构图，但让角色比例更修长。" : "例如：角色数量和构图方向都不符合预期。"}
            rows={5}
            className="focus-ring w-full resize-y rounded-[12px] border border-black/[0.1] bg-[var(--surface)] px-3 py-2.5 text-sm leading-6 text-zinc-900 outline-none dark:border-white/[0.1] dark:text-zinc-100"
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-[10px] bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-600 dark:text-red-300">
            提交失败：{error}
          </p>
        ) : null}

        <div className="taste-modal-actions">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="taste-btn taste-btn-ghost"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting || (isEdit && !trimmedNote)}
            className={`taste-btn ${isEdit ? "taste-btn-primary" : "taste-btn-danger"}`}
          >
            {submitting ? "提交中..." : isEdit ? "确认选定并提交建议" : "确认全部不满意"}
          </button>
        </div>
      </form>
      {previewImage ? <SourceLightbox image={previewImage} onClose={() => setPreviewImage(null)} /> : null}
    </Modal>
  );
}
