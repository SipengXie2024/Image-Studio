import { useState } from "react";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import type { RuleCurationReviewItem } from "../../lib/ruleCuration";

// Explicit review modal for AI rule-curation proposals. Every merge/retire is
// decided here by the user, one by one — nothing changes without a click.
// Decisions route through decideTasteCandidate, the same append-only path the
// taste panel uses (approving a merge auto-retires the rules it replaces).
export function RuleCurationModal({ onClose }: { onClose: () => void }) {
  const review = useStudioStore((state) => state.ruleCuration);
  const decideCandidate = useStudioStore((state) => state.decideTasteCandidate);
  const settleItem = useStudioStore((state) => state.settleRuleCurationItem);
  const pushToast = useStudioStore((state) => state.pushToast);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!review) return null;
  const items = review.items;

  async function decide(item: RuleCurationReviewItem, adopt: boolean) {
    if (busyKey) return;
    // "Keep" on a retire proposal changes nothing — just settle the item.
    if (item.action === "retire" && !adopt) {
      settleItem(item.key);
      return;
    }
    setBusyKey(item.key);
    setError("");
    try {
      if (item.action === "merge") {
        await decideCandidate(item.candidateId, adopt ? "approve" : "reject");
      } else {
        await decideCandidate(item.candidateId, "reject");
      }
      settleItem(item.key);
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : String(decideError));
    } finally {
      setBusyKey(null);
    }
  }

  function handleClose() {
    if (busyKey) return;
    pushToast("稍后再说:未决定的合并提案保留在「候选记录」里;废弃建议此次不生效", "info", 6000);
    onClose();
  }

  return (
    <Modal
      open
      onClose={handleClose}
      title="整理规则库:请逐条审阅"
      width={640}
      cardClassName="max-w-[94vw]"
      bodyClassName="flex max-h-[80vh] min-h-0 flex-col gap-4"
    >
      <p className="taste-list-item-meta">
        AI 建议对你的生效规则做 {items.length} 项整理。每一项都由你决定,不采纳则一切不变;
        被替换或废弃的规则会移入「已忽略」留档,随时可以在学习经验面板恢复。
      </p>

      {error ? (
        <p role="alert" className="rounded-[10px] bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-600 dark:text-red-300">
          操作失败:{error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {items.map((item) => {
          const busy = busyKey === item.key;
          const disabled = busyKey !== null;
          return (
            <article key={item.key} className="rounded-[16px] border border-black/[0.08] bg-[var(--surface)] p-4 dark:border-white/[0.08]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)]">
                  {item.action === "merge" ? `合并 ${item.replaces.length} 条规则` : "建议废弃"}
                </span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">AI 推理 · 采纳前请核对</span>
              </div>

              {item.action === "merge" ? (
                <>
                  <p className="mt-3 text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-100">{item.rule}</p>
                  <div className="mt-2 space-y-1.5">
                    <p className="taste-list-item-meta">采纳后,以下 {item.replaces.length} 条现行规则将被这条替代:</p>
                    {item.replaces.map((replaced) => (
                      <p key={replaced.candidateId} className="taste-quote-block">{replaced.rule}</p>
                    ))}
                  </div>
                </>
              ) : (
                <p className="taste-quote-block mt-3">{item.rule}</p>
              )}

              {item.reason ? (
                <p className="taste-list-item-meta mt-2">整理依据:{item.reason}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void decide(item, false)}
                  disabled={disabled}
                  className="taste-btn taste-btn-ghost taste-btn-sm"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  {item.action === "merge" ? "忽略" : "保留"}
                </button>
                {item.action === "merge" ? (
                  <button
                    type="button"
                    onClick={() => void decide(item, true)}
                    disabled={disabled}
                    title="采纳合并后的新规则,并把被替代的旧规则移入已忽略"
                    className="taste-btn taste-btn-primary taste-btn-sm"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    采纳合并
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void decide(item, true)}
                    disabled={disabled}
                    title="把这条规则移入已忽略(留档,可恢复)"
                    className="taste-btn taste-btn-danger taste-btn-sm"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    废弃这条
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="taste-modal-actions">
        <button type="button" onClick={handleClose} disabled={busyKey !== null} className="taste-btn taste-btn-ghost">
          稍后再说
        </button>
      </div>
    </Modal>
  );
}
