import { useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Sparkles, X } from "lucide-react";
import type { TasteCandidate } from "../../lib/tasteLearning";
import { Modal } from "../common/Modal";

type TasteProfileView = {
  candidates: TasteCandidate[];
};

export function TasteBootstrapModal({
  profile,
  loading,
  onDecide,
  onAcknowledge,
  onClose,
}: {
  profile: TasteProfileView;
  loading: boolean;
  onDecide: (candidateId: string, decision: "approve" | "reject") => Promise<void>;
  onAcknowledge: () => Promise<void>;
  onClose: () => void;
}) {
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");
  const candidates = useMemo(
    () => profile.candidates.filter((candidate) => (
      candidate.source.type === "feedback"
      || candidate.source.signal === "style-tag"
      || candidate.source.signal === "negative-prompt"
    )),
    [profile.candidates],
  );
  const approvedCount = candidates.filter((candidate) => candidate.status === "approved").length;
  const rejectedCount = candidates.filter((candidate) => candidate.status === "rejected").length;
  const pendingCount = candidates.length - approvedCount - rejectedCount;
  const busy = loading || completing || busyCandidateId !== null;

  async function decide(candidateId: string, decision: "approve" | "reject") {
    if (busy) return;
    setBusyCandidateId(candidateId);
    setError("");
    try {
      await onDecide(candidateId, decision);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : String(decisionError));
    } finally {
      setBusyCandidateId(null);
    }
  }

  async function acknowledge() {
    if (busy) return;
    setCompleting(true);
    setError("");
    try {
      await onAcknowledge();
    } catch (acknowledgeError) {
      setError(acknowledgeError instanceof Error ? acknowledgeError.message : String(acknowledgeError));
      setCompleting(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="从历史记录归纳品味"
      width={720}
      cardClassName="max-w-[94vw]"
      bodyClassName="flex max-h-[78vh] min-h-0 flex-col gap-4"
    >
      <div className="rounded-[14px] border border-amber-500/25 bg-amber-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">曾经请求过，不等于你喜欢</p>
            <p className="text-xs leading-5 text-amber-800/90 dark:text-amber-100/80">
              旧历史只能提供风格标签和明确排除项等线索。普通提示词、优化后提示词、最近查看或尚未删除，都不会被当作偏好。
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-300">
        <span>请逐条选择“采纳”或“忽略”；未确认的候选不会生效。</span>
        {candidates.length > 0 ? (
          <span className="font-mono-token">待确认 {pendingCount} · 已采纳 {approvedCount} · 已忽略 {rejectedCount}</span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="grid min-h-[220px] place-items-center text-sm text-zinc-500 dark:text-zinc-300">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> 正在归纳历史证据...</span>
          </div>
        ) : candidates.length === 0 ? (
          <div className="grid min-h-[220px] place-items-center rounded-[16px] border border-dashed border-black/[0.1] px-6 text-center dark:border-white/[0.1]">
            <div className="max-w-md space-y-2">
              <Sparkles className="mx-auto h-5 w-5 text-zinc-400" />
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">没有足够明确的品味证据</p>
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                即使存在普通生成记录，系统也不会仅凭提示词或图片仍在历史中就推断你喜欢它。
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {candidates.map((candidate) => (
              <TasteCandidateCard
                key={candidate.id}
                candidate={candidate}
                busy={busyCandidateId === candidate.id}
                disabled={busy}
                onDecide={decide}
              />
            ))}
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="rounded-[10px] bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-600 dark:text-red-300">
          操作失败：{error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="platform-action-btn rounded-[10px] border border-black/[0.08] px-4 py-2 text-sm text-zinc-700 disabled:opacity-50 dark:border-white/[0.08] dark:text-zinc-300"
        >
          稍后再说
        </button>
        <button
          type="button"
          onClick={() => void acknowledge()}
          disabled={busy || pendingCount > 0}
          className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-2)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {pendingCount > 0 ? `还有 ${pendingCount} 条待确认` : "完成确认"}
        </button>
      </div>
    </Modal>
  );
}

function TasteCandidateCard({
  candidate,
  busy,
  disabled,
  onDecide,
}: {
  candidate: TasteCandidate;
  busy: boolean;
  disabled: boolean;
  onDecide: (candidateId: string, decision: "approve" | "reject") => Promise<void>;
}) {
  const source = candidate.source;
  const sourceLabel = source.type === "history"
    ? source.signal === "style-tag" ? "历史 · 风格标签" : "历史 · 明确排除项"
    : "明确反馈";
  const evidenceLabel = source.type === "history"
    ? `${source.itemIds.length} 条历史证据 · 曾请求≠喜欢`
    : "来自你主动提交的反馈";

  return (
    <article className="rounded-[16px] border border-black/[0.08] bg-[var(--surface)] p-4 dark:border-white/[0.08]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)]">{sourceLabel}</span>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{evidenceLabel}</span>
      </div>
      <p className="mt-3 text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-100">{candidate.rule}</p>
      {source.type === "feedback" && source.verbatimNote ? (
        <p className="mt-2 whitespace-pre-wrap rounded-[10px] bg-black/[0.03] px-3 py-2 text-xs leading-5 text-zinc-500 dark:bg-white/[0.04] dark:text-zinc-300">
          你的原话：{source.verbatimNote}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void onDecide(candidate.id, "reject")}
          disabled={disabled || candidate.status === "rejected"}
          className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-[9px] border px-3 text-xs font-medium disabled:cursor-not-allowed ${candidate.status === "rejected" ? "border-zinc-400/30 bg-zinc-500/10 text-zinc-500" : "border-black/[0.08] text-zinc-600 hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.05]"}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          {candidate.status === "rejected" ? "已忽略" : "忽略"}
        </button>
        <button
          type="button"
          onClick={() => void onDecide(candidate.id, "approve")}
          disabled={disabled || candidate.status === "approved"}
          className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-[9px] border px-3 text-xs font-medium disabled:cursor-not-allowed ${candidate.status === "approved" ? "border-[color:var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[color:var(--accent)]/25 text-[var(--accent)] hover:bg-[var(--accent-soft)]"}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {candidate.status === "approved" ? "已采纳" : "采纳"}
        </button>
      </div>
    </article>
  );
}
