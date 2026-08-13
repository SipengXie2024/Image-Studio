import { useRef, useState, type FormEvent } from "react";
import type { HistoryItem } from "../../types/domain";
import { Modal } from "../common/Modal";

export type FeedbackModalRequest =
  | { kind: "edit"; item: HistoryItem; items: HistoryItem[] }
  | { kind: "reject"; items: HistoryItem[] };

export type BatchReviewCallbacks = {
  onPick?: (item: HistoryItem) => void | Promise<void>;
  onEdit?: (input: { item: HistoryItem; items: HistoryItem[]; note: string }) => void | Promise<void>;
  onReject?: (input: { items: HistoryItem[]; note: string }) => void | Promise<void>;
};

export function FeedbackModal({
  request,
  onClose,
  onSubmit,
}: {
  request: FeedbackModalRequest;
  onClose: () => void;
  onSubmit: (note: string) => void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const isEdit = request.kind === "edit";
  const trimmedNote = note.trim();
  const prompt = isEdit ? request.item.prompt.trim() : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || (isEdit && !trimmedNote)) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(note);
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

        <label className="block space-y-2">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
            {isEdit ? "你的建议（必填）" : "不满意的原因（选填）"}
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

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="platform-action-btn rounded-[10px] border border-black/[0.08] px-4 py-2 text-sm text-zinc-700 disabled:opacity-50 dark:border-white/[0.08] dark:text-zinc-300"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting || (isEdit && !trimmedNote)}
            className={`inline-flex items-center justify-center rounded-[10px] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${isEdit ? "bg-[var(--accent)] hover:bg-[var(--accent-2)]" : "bg-red-500 hover:bg-red-600"}`}
          >
            {submitting ? "提交中..." : isEdit ? "确认选定并提交建议" : "确认全部不满意"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
