import { useState } from "react";
import { Check, Loader2, Pencil, Sparkles, Wand2, X } from "lucide-react";
import type { TasteCandidate } from "../../lib/tasteLearning";

export interface TasteRuleActions {
  onDecide: (candidateId: string, decision: "approve" | "reject") => Promise<void>;
  onDistill: (candidateId: string) => Promise<void>;
  onUpdateRule: (candidateId: string, ruleText: string) => Promise<void>;
  onRevise: (candidateId: string, instruction: string) => Promise<void>;
}

// Shared rule card for the bootstrap modal and the taste panel: shows the rule
// with its verbatim provenance, and lets the user reshape it three ways —
// AI distill, manual edit, or "tell the AI how to change it". Approval is
// still a separate explicit step; reshaping never auto-activates a rule.
export function TasteRuleCard({
  candidate,
  busy,
  ruleBusy,
  disabled,
  actions,
  highlightUnrefined = false,
}: {
  candidate: TasteCandidate;
  busy: boolean;
  ruleBusy: boolean;
  disabled: boolean;
  actions: TasteRuleActions;
  highlightUnrefined?: boolean;
}) {
  const [editor, setEditor] = useState<null | { mode: "edit" | "revise"; text: string }>(null);
  const source = candidate.source;
  const sourceLabel = source.type === "history"
    ? source.signal === "style-tag" ? "历史 · 风格标签" : "历史 · 明确排除项"
    : source.type === "induced" ? "AI 从历史归纳" : "明确反馈";
  const evidenceLabel = source.type === "history"
    ? `${source.itemIds.length} 条历史证据 · 曾请求≠喜欢`
    : source.type === "induced" ? "AI 推理 · 采纳前请核对" : "来自你主动提交的反馈";
  const anyBusy = disabled || ruleBusy;

  async function submitEditor() {
    if (!editor) return;
    const text = editor.text;
    setEditor(null);
    if (editor.mode === "edit") await actions.onUpdateRule(candidate.id, text);
    else await actions.onRevise(candidate.id, text);
  }

  return (
    <article className="rounded-[16px] border border-black/[0.08] bg-[var(--surface)] p-4 dark:border-white/[0.08]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)]">{sourceLabel}</span>
          {candidate.refined === "ai" ? (
            <span className="taste-chip">✦ AI 打磨过</span>
          ) : candidate.refined === "user" ? (
            <span className="taste-chip">本人修改过</span>
          ) : highlightUnrefined ? (
            <span className="taste-chip taste-chip-danger">原话模板 · 建议打磨</span>
          ) : null}
        </span>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{evidenceLabel}</span>
      </div>

      {editor?.mode === "edit" ? (
        <textarea
          autoFocus
          value={editor.text}
          onChange={(event) => setEditor({ mode: "edit", text: event.currentTarget.value })}
          rows={3}
          className="focus-ring mt-3 w-full resize-y rounded-[12px] border border-black/[0.1] bg-[var(--surface)] px-3 py-2 text-sm leading-6 text-zinc-900 outline-none dark:border-white/[0.1] dark:text-zinc-100"
        />
      ) : (
        <p className="mt-3 text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-100">
          {ruleBusy ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin text-[var(--accent)]" /> : null}
          {candidate.rule}
        </p>
      )}

      {source.type === "feedback" && source.verbatimNote ? (
        <p className="taste-quote-block mt-2">你的原话:{source.verbatimNote}</p>
      ) : null}

      {source.type === "induced" && source.evidence ? (
        <p className="taste-quote-block mt-2">归纳依据:{source.evidence}</p>
      ) : null}

      {editor?.mode === "revise" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={editor.text}
            onChange={(event) => setEditor({ mode: "revise", text: event.currentTarget.value })}
            placeholder="例如:范围别限定在弓箭手,所有角色都适用"
            className="focus-ring min-w-0 flex-1 rounded-[10px] border border-black/[0.1] bg-[var(--surface)] px-3 py-1.5 text-xs leading-5 text-zinc-900 outline-none dark:border-white/[0.1] dark:text-zinc-100"
          />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {editor ? (
            <>
              <button
                type="button"
                onClick={() => void submitEditor()}
                disabled={anyBusy || !editor.text.trim()}
                className="taste-btn taste-btn-primary taste-btn-sm"
              >
                {editor.mode === "edit" ? "保存" : "让 AI 这样改"}
              </button>
              <button
                type="button"
                onClick={() => setEditor(null)}
                disabled={ruleBusy}
                className="taste-btn taste-btn-ghost taste-btn-sm"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void actions.onDistill(candidate.id)}
                disabled={anyBusy}
                title="让 AI 把原话提炼成可复用规则"
                className="taste-btn taste-btn-ghost taste-btn-sm"
              >
                {ruleBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI 提炼
              </button>
              <button
                type="button"
                onClick={() => setEditor({ mode: "edit", text: candidate.rule })}
                disabled={anyBusy}
                title="直接编辑规则文本"
                className="taste-btn taste-btn-ghost taste-btn-sm"
              >
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </button>
              <button
                type="button"
                onClick={() => setEditor({ mode: "revise", text: "" })}
                disabled={anyBusy}
                title="告诉 AI 你希望怎么改,由它改写"
                className="taste-btn taste-btn-ghost taste-btn-sm"
              >
                <Wand2 className="h-3.5 w-3.5" />
                提意见
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void actions.onDecide(candidate.id, "reject")}
            disabled={disabled || busy || candidate.status === "rejected"}
            className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-[9px] border px-3 text-xs font-medium disabled:cursor-not-allowed ${candidate.status === "rejected" ? "border-zinc-400/30 bg-zinc-500/10 text-zinc-500" : "border-black/[0.08] text-zinc-600 hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.05]"}`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            {candidate.status === "rejected" ? "已忽略" : "忽略"}
          </button>
          <button
            type="button"
            onClick={() => void actions.onDecide(candidate.id, "approve")}
            disabled={disabled || busy || candidate.status === "approved"}
            className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-[9px] border px-3 text-xs font-medium disabled:cursor-not-allowed ${candidate.status === "approved" ? "border-[color:var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[color:var(--accent)]/25 text-[var(--accent)] hover:bg-[var(--accent-soft)]"}`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {candidate.status === "approved" ? "已采纳" : "采纳"}
          </button>
        </div>
      </div>
    </article>
  );
}
