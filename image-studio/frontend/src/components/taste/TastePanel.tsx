import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Modal } from "../common/Modal";
import { TasteRuleCard } from "./TasteRuleCard";
import { useStudioStore } from "../../state/studioStore";
import { INDUCE_FROM_HISTORY_BUSY_ID } from "../../state/studioStore.tasteRules";
import { computeSuggestionAdoptionStats } from "../../lib/tasteInsights";
import {
  listTasteFeedback,
  listTastePromptSuggestionDecisions,
  listTasteSuggestionOutcomes,
} from "../../lib/tasteStorage";
import type {
  PromptSuggestionDecision,
  PromptSuggestionOutcome,
  TasteFeedbackEvent,
} from "../../lib/tasteStorage";

type PanelTab = "rules" | "active" | "exemplars" | "suggestions";

const FEEDBACK_TYPE_LABEL: Record<TasteFeedbackEvent["type"], string> = {
  pick: "选定",
  edit: "选定并建议",
  reject: "整批不满意",
};

const DECISION_LABEL: Record<PromptSuggestionDecision["decision"], string> = {
  accepted: "原样采纳",
  modified: "修改后采纳",
  rejected: "拒绝草稿",
};

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return "";
  }
}

// The standing "what has the harness learned" window: rules (editable, with
// provenance), recent explicit exemplars, and the suggestion history with the
// adoption-outcome stats that show whether adopted drafts actually did better.
export function TastePanel({ onClose }: { onClose: () => void }) {
  const profile = useStudioStore((state) => state.tasteProfile);
  const ruleBusyId = useStudioStore((state) => state.tasteRuleBusyId);
  const decideCandidate = useStudioStore((state) => state.decideTasteCandidate);
  const distillRule = useStudioStore((state) => state.distillCandidateRule);
  const updateRule = useStudioStore((state) => state.updateCandidateRule);
  const reviseRule = useStudioStore((state) => state.reviseCandidateRule);
  const induceRules = useStudioStore((state) => state.induceRulesFromHistory);
  const inducing = ruleBusyId === INDUCE_FROM_HISTORY_BUSY_ID;

  const [tab, setTab] = useState<PanelTab>("rules");
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<TasteFeedbackEvent[] | null>(null);
  const [decisions, setDecisions] = useState<PromptSuggestionDecision[] | null>(null);
  const [outcomes, setOutcomes] = useState<PromptSuggestionOutcome[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [feedbackRows, decisionRows, outcomeRows] = await Promise.all([
          listTasteFeedback(),
          listTastePromptSuggestionDecisions(),
          listTasteSuggestionOutcomes(),
        ]);
        if (!alive) return;
        setFeedback(feedbackRows);
        setDecisions(decisionRows);
        setOutcomes(outcomeRows);
      } catch (error) {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const candidateGroups = useMemo(
    () => {
      const relevant = profile.candidates.filter((candidate) => (
        candidate.source.type === "feedback"
        || candidate.source.type === "induced"
        || candidate.source.signal === "style-tag"
        || candidate.source.signal === "negative-prompt"
      ));
      return {
        pending: relevant.filter((candidate) => candidate.status === "pending"),
        approved: relevant.filter((candidate) => candidate.status === "approved"),
        rejected: relevant.filter((candidate) => candidate.status === "rejected"),
      };
    },
    [profile.candidates],
  );
  const candidateTotal = candidateGroups.pending.length + candidateGroups.approved.length + candidateGroups.rejected.length;
  const approvedCount = candidateGroups.approved.length;
  const [showRejected, setShowRejected] = useState(false);

  const stats = useMemo(
    () => computeSuggestionAdoptionStats(decisions ?? [], outcomes ?? [], feedback ?? []),
    [decisions, outcomes, feedback],
  );
  const recentFeedback = useMemo(
    () => (feedback ? [...feedback].slice(-30).reverse() : []),
    [feedback],
  );
  const recentDecisions = useMemo(
    () => (decisions ? [...decisions].reverse() : []),
    [decisions],
  );
  const loading = feedback === null && !loadError;

  return (
    <Modal
      open
      onClose={onClose}
      title="Harness 学到了什么"
      width={760}
      cardClassName="max-w-[94vw]"
      bodyClassName="flex max-h-[80vh] min-h-[420px] min-h-0 flex-col gap-4"
    >
      <div className="taste-tabs">
        <button type="button" className={`taste-tab ${tab === "rules" ? "active" : ""}`} onClick={() => setTab("rules")}>
          候选记录{candidateTotal ? ` (${candidateGroups.pending.length} 待确认)` : ""}
        </button>
        <button type="button" className={`taste-tab ${tab === "active" ? "active" : ""}`} onClick={() => setTab("active")}>
          生效规则{approvedCount ? ` (${approvedCount})` : ""}
        </button>
        <button type="button" className={`taste-tab ${tab === "exemplars" ? "active" : ""}`} onClick={() => setTab("exemplars")}>
          反馈判例{feedback ? ` (${feedback.length})` : ""}
        </button>
        <button type="button" className={`taste-tab ${tab === "suggestions" ? "active" : ""}`} onClick={() => setTab("suggestions")}>
          建议采纳史{decisions ? ` (${decisions.length})` : ""}
        </button>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-[10px] bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-600 dark:text-red-300">
          读取品味数据失败:{loadError}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === "rules" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="taste-list-item-meta">也可以让 AI 通读你的判例与建议史,归纳出可确认的规则方向。</p>
              <button
                type="button"
                onClick={() => void induceRules()}
                disabled={ruleBusyId !== null}
                title="AI 从你的反馈判例与建议采纳史里归纳候选规则;是否采纳仍由你逐条决定"
                className="taste-btn taste-btn-ghost taste-btn-sm"
              >
                {inducing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {inducing ? "正在归纳…" : "从历史学习"}
              </button>
            </div>
          {candidateTotal === 0 ? (
            <p className="taste-quote-block">
              还没有规则候选。pick / 选定并建议 / 全部不满意时写下的文字原因,会在这里变成待你确认的规则;只有你「采纳」的规则才会进入评审。
            </p>
          ) : (
            <div className="space-y-3">
              {candidateGroups.pending.length === 0 ? (
                <p className="taste-list-item-meta">没有待确认的候选;新反馈写了文字原因后会出现在这里。</p>
              ) : (
                candidateGroups.pending.map((candidate) => (
                  <TasteRuleCard
                    key={candidate.id}
                    candidate={candidate}
                    busy={false}
                    ruleBusy={ruleBusyId === candidate.id}
                    disabled={ruleBusyId !== null}
                    actions={{
                      onDecide: decideCandidate,
                      onDistill: distillRule,
                      onUpdateRule: updateRule,
                      onRevise: reviseRule,
                    }}
                  />
                ))
              )}

              {candidateGroups.approved.length > 0 ? (
                <button type="button" className="taste-group-toggle" onClick={() => setTab("active")}>
                  <ChevronRight className="h-3.5 w-3.5" />
                  生效中的 {candidateGroups.approved.length} 条规则在「生效规则」页查看与打磨
                </button>
              ) : null}

              {candidateGroups.rejected.length > 0 ? (
                <>
                  <button type="button" className="taste-group-toggle" onClick={() => setShowRejected((value) => !value)}>
                    {showRejected ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    已忽略 ({candidateGroups.rejected.length})
                  </button>
                  {showRejected ? candidateGroups.rejected.map((candidate) => (
                    <TasteRuleCard
                      key={candidate.id}
                      candidate={candidate}
                      busy={false}
                      ruleBusy={ruleBusyId === candidate.id}
                      disabled={ruleBusyId !== null}
                      actions={{
                        onDecide: decideCandidate,
                        onDistill: distillRule,
                        onUpdateRule: updateRule,
                        onRevise: reviseRule,
                      }}
                    />
                  )) : null}
                </>
              ) : null}
            </div>
          )}
          </div>
        ) : null}

        {tab === "active" ? (
          candidateGroups.approved.length === 0 ? (
            <p className="taste-quote-block">
              还没有生效中的规则。在「候选记录」里采纳候选后,它们会出现在这里,并参与之后每一次评审的打分与排序。
            </p>
          ) : (
            <div className="space-y-3">
              <p className="taste-list-item-meta">
                这些规则正在参与每次评审。建议让每条都经过「AI 提炼」或本人修改——原话模板的执行效果最弱。
              </p>
              {candidateGroups.approved.map((candidate) => (
                <TasteRuleCard
                  key={candidate.id}
                  candidate={candidate}
                  busy={false}
                  ruleBusy={ruleBusyId === candidate.id}
                  disabled={ruleBusyId !== null}
                  highlightUnrefined
                  actions={{
                    onDecide: decideCandidate,
                    onDistill: distillRule,
                    onUpdateRule: updateRule,
                    onRevise: reviseRule,
                  }}
                />
              ))}
            </div>
          )
        ) : null}

        {tab === "exemplars" ? (
          loading ? (
            <p className="taste-quote-block"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />正在读取判例...</p>
          ) : recentFeedback.length === 0 ? (
            <p className="taste-quote-block">还没有显式反馈。每次「选定」「选定并提建议」「全部不满意」都会在这里留下判例,评审会带上最近的判例图片与原文。</p>
          ) : (
            <div className="taste-list">
              {recentFeedback.map((event) => (
                <div key={event.id} className="taste-list-item">
                  <div className="taste-list-item-meta">
                    <span className={`taste-chip ${event.type === "reject" ? "taste-chip-danger" : ""}`}>
                      {FEEDBACK_TYPE_LABEL[event.type]}
                    </span>
                    <span>{formatTime(event.createdAt)}</span>
                  </div>
                  {event.note?.trim()
                    ? <div>{event.note}</div>
                    : <div className="taste-list-item-meta">(未填写文字,仅作为视觉判例)</div>}
                  {event.attachedSourcePaths?.length
                    ? <div className="taste-list-item-meta">迭代延续:下一轮带上了 {event.attachedSourcePaths.length} 张本批参考图</div>
                    : null}
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === "suggestions" ? (
          loading ? (
            <p className="taste-quote-block"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />正在读取建议史...</p>
          ) : (
            <div className="space-y-3">
              <div className="taste-stat-grid">
                <div className="taste-stat">
                  <p className="taste-stat-value">{stats.totalDecisions}</p>
                  <p className="taste-stat-label">草稿总数(采纳 {stats.accepted + stats.modified} · 拒绝 {stats.rejected})</p>
                </div>
                <div className="taste-stat">
                  <p className="taste-stat-value">{stats.modified}</p>
                  <p className="taste-stat-label">修改后采纳(你的编辑是最强学习信号)</p>
                </div>
                <div className="taste-stat">
                  <p className="taste-stat-value">
                    {stats.linkedBatches === 0 ? "—" : `${stats.batchesPicked}/${stats.linkedBatches}`}
                  </p>
                  <p className="taste-stat-label">采纳后生成的批次中,你选定了图的批次</p>
                </div>
                <div className="taste-stat">
                  <p className="taste-stat-value">
                    {stats.linkedBatches === 0 ? "—" : `${stats.batchesRejected}/${stats.linkedBatches}`}
                  </p>
                  <p className="taste-stat-label">采纳后仍被你整批否决的批次</p>
                </div>
              </div>

              {recentDecisions.length === 0 ? (
                <p className="taste-quote-block">还没有建议记录。reject 后点「在 harness 辅助下再来一次」,你对草稿的采纳/修改/拒绝都会记在这里,并喂给下一次起草。</p>
              ) : (
                <div className="taste-list">
                  {recentDecisions.map((decision) => (
                    <div key={decision.id} className="taste-list-item">
                      <div className="taste-list-item-meta">
                        <span className={`taste-chip ${decision.decision === "rejected" ? "taste-chip-danger" : ""}`}>
                          {DECISION_LABEL[decision.decision]}
                        </span>
                        <span>{formatTime(decision.createdAt)}</span>
                      </div>
                      <div>草稿:{decision.draftPrompt}</div>
                      {decision.decision === "modified" && decision.finalPrompt ? (
                        <div>你改成:{decision.finalPrompt}</div>
                      ) : null}
                      {decision.rejectNote ? (
                        <div className="taste-list-item-meta">当时的原因:{decision.rejectNote}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        ) : null}
      </div>

      <div className="taste-modal-actions">
        <button type="button" onClick={onClose} className="taste-btn taste-btn-ghost">
          关闭
        </button>
      </div>
    </Modal>
  );
}
