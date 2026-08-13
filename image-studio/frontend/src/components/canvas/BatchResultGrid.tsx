import { useRef, useState } from "react";
import type { HistoryItem } from "../../types/domain";
import { historyFullSrc, historyPreviewSrc, useBlobURL } from "../../lib/images";
import { batchCompareItemIds, batchTileIntent, resolveBatchFocus, stepBatchFocus } from "../../lib/batchCompareView";
import { DragExportHandle } from "./DragExportHandle";

export type BatchGridSlot =
  | { type: "result"; item: HistoryItem }
  | { type: "preview"; item: HistoryItem }
  | { type: "pending"; id: string };

export function BatchResultGrid({
  items,
  slots,
  currentId,
  onSelect,
  onPreview,
  onClose,
  showClose = true,
  title,
  selectedIds,
  onToggleSelect,
  selectionMode = false,
  livePreview = false,
  onPick,
  onEdit,
  onRejectAll,
  criticRunning = false,
  criticError = null,
  onRunCritic,
}: {
  items: HistoryItem[];
  slots?: BatchGridSlot[];
  currentId: string | null;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onPreview?: (item: HistoryItem) => HistoryItem | Promise<HistoryItem>;
  onClose: () => void;
  showClose?: boolean;
  title?: string;
  selectedIds?: Set<string>;
  onToggleSelect?: (item: HistoryItem) => void;
  selectionMode?: boolean;
  livePreview?: boolean;
  onPick?: (item: HistoryItem) => void | Promise<void>;
  onEdit?: (item: HistoryItem) => void;
  onRejectAll?: (items: HistoryItem[]) => void;
  criticRunning?: boolean;
  criticError?: string | null;
  onRunCritic?: () => void | Promise<unknown>;
}) {
  const orderedItems = slots || selectionMode ? items : sortTasteReviewedItems(items);
  const gridSlots = slots ?? orderedItems.map((item) => ({ type: "result", item }) satisfies BatchGridSlot);
  const singlePendingPreview = livePreview && gridSlots.length === 1 && gridSlots[0]?.type === "pending";
  const singleLivePreview = livePreview && gridSlots.length === 1 && gridSlots[0]?.type !== "pending";
  const reviewEnabled = !livePreview && !selectionMode && items.length > 0 && !!(onPick || onEdit || onRejectAll);
  const tileReviewEnabled = reviewEnabled && !!(onPick || onEdit);
  const columns = singleLivePreview || singlePendingPreview ? 1 : gridSlots.length <= 4 ? 2 : 3;
  const rows = Math.min(3, Math.ceil(Math.max(gridSlots.length, 1) / columns));
  const scrollGrid = !singleLivePreview && !singlePendingPreview && gridSlots.length > 9;
  const fillGrid = !singleLivePreview && !singlePendingPreview && !scrollGrid;
  const [focusedPreview, setFocusedPreview] = useState<HistoryItem | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [focusLoadError, setFocusLoadError] = useState<string | null>(null);
  const focusRequestRef = useRef(0);
  const itemIds = batchCompareItemIds(orderedItems);
  const focusedId = resolveBatchFocus(itemIds, focusedPreview?.id ?? null);
  const focusedBatchItem = focusedId ? orderedItems.find((item) => item.id === focusedId) ?? null : null;
  const focusedItem = focusedBatchItem && focusedPreview?.id === focusedId
    ? { ...focusedBatchItem, ...focusedPreview, tasteReview: focusedBatchItem.tasteReview }
    : focusedBatchItem;

  async function focusItem(item: HistoryItem) {
    const request = ++focusRequestRef.current;
    setFocusedPreview(item);
    setFocusLoadError(null);
    if (!onPreview) return;
    setFocusLoading(true);
    try {
      const full = await onPreview(item);
      if (focusRequestRef.current === request && full.id === item.id) {
        setFocusedPreview(full);
        if (full.previewOnly) setFocusLoadError("完整图片加载失败，当前显示缩略图");
      }
    } catch {
      if (focusRequestRef.current === request) {
        setFocusedPreview(item);
        setFocusLoadError("完整图片加载失败，当前显示缩略图");
      }
    } finally {
      if (focusRequestRef.current === request) setFocusLoading(false);
    }
  }

  function closeFocus() {
    focusRequestRef.current += 1;
    setFocusedPreview(null);
    setFocusLoading(false);
    setFocusLoadError(null);
  }

  if (focusedItem && !livePreview && !selectionMode) {
    return (
      <FocusedBatchPreview
        item={focusedItem}
        items={orderedItems}
        loading={focusLoading}
        loadError={focusLoadError}
        onBack={closeFocus}
        onNavigate={(delta) => {
          const nextId = stepBatchFocus(itemIds, focusedItem.id, delta);
          const nextItem = orderedItems.find((item) => item.id === nextId);
          if (nextItem) void focusItem(nextItem);
        }}
        onOpenInCanvas={() => void onSelect(focusedItem)}
        onPick={reviewEnabled ? onPick : undefined}
        onEdit={reviewEnabled ? onEdit : undefined}
        onShowItem={(item) => void focusItem(item)}
        onRetry={() => void focusItem(focusedItem)}
      />
    );
  }

  if (singlePendingPreview) {
    return (
      <div className="batch-grid-overlay live-preview-grid single-pending">
        <div className="batch-grid-head">
          <span className="batch-grid-title">{title ?? `批次对比 · ${items.length} 张`}</span>
          {showClose ? (
            <button type="button" className="batch-grid-close" onClick={onClose} title="关闭批次对比">
              进入单图编辑
            </button>
          ) : null}
        </div>
        <div className="batch-grid-pending-stage" aria-label="等待第一张预览">
          <div className="batch-grid-pending-stage-card">
            <span className="batch-grid-pending-ring large" />
            <strong className="batch-grid-pending-stage-title">等待第一张预览</strong>
            <span className="batch-grid-pending-stage-note">收到首帧后，这里会自动切成实时预览画面。</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`batch-grid-overlay ${livePreview ? "live-preview-grid" : ""} ${singleLivePreview ? "single-slot" : ""}`}>
      <div className={`batch-grid-head ${singleLivePreview ? "single-slot" : ""}`}>
        <div className="batch-grid-heading">
          <span className="batch-grid-title">{title ?? `批次对比 · ${items.length} 张`}</span>
          {!livePreview && !selectionMode ? <span className="batch-grid-hint">全部图片完整显示；点击任意图片查看大图</span> : null}
        </div>
        {!livePreview && onRunCritic ? (
          <button
            type="button"
            className="batch-grid-critic-button"
            onClick={() => void onRunCritic()}
            disabled={criticRunning}
          >
            {criticRunning ? "AI 评审中…" : items.some((item) => item.tasteReview) ? "重新评审" : "AI 评审"}
          </button>
        ) : null}
        {showClose ? (
          <button type="button" className="batch-grid-close" onClick={onClose} title="关闭批次对比，返回当前图片">
            进入单图编辑
          </button>
        ) : null}
      </div>
      <div
        className={`batch-grid ${singleLivePreview ? "single-slot" : ""} ${fillGrid ? "fill-grid" : ""} ${scrollGrid ? "scroll-grid" : ""}`}
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          ...(fillGrid ? { gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` } : {}),
          ...(scrollGrid ? { gridAutoRows: "clamp(180px, 24vh, 260px)" } : {}),
        }}
      >
        {gridSlots.map((slot, index) => {
          if (slot.type === "pending") {
            return <PendingGridTile key={slot.id} index={index} singleLayout={singleLivePreview} />;
          }
          return (
            <BatchGridTile
              key={slot.item.id}
              item={slot.item}
              index={index}
              active={slot.type === "result" && slot.item.id === currentId}
              preview={slot.type === "preview"}
              onSelect={onSelect}
              onPreview={!livePreview && !selectionMode && onPreview ? focusItem : undefined}
              selected={slot.type === "result" && !!selectedIds?.has(slot.item.id)}
              onToggleSelect={onToggleSelect}
              selectionMode={selectionMode}
              singleLayout={singleLivePreview}
              onPick={tileReviewEnabled ? onPick : undefined}
              onEdit={tileReviewEnabled ? onEdit : undefined}
            />
          );
        })}
      </div>
      {reviewEnabled ? (
        <div className="batch-grid-review-footer">
          <span>
            {criticError
              ? criticError
              : criticRunning
                ? "正在按原提示词与已确认品味评审；不会改写提示词。"
                : items.some((item) => item.tasteReview)
                  ? "Top-3 已前置；DQ 只会被淘汰。点击图片只看大图，不会退出或记录选择。"
                  : "点击图片只看大图；只有“选定”或“全部不满意”才会记录你的选择。"}
          </span>
          {onRejectAll ? (
            <button type="button" className="batch-grid-reject-button" onClick={() => onRejectAll(items)}>
              全部不满意
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BatchGridTile({
  item,
  index,
  active,
  preview,
  onSelect,
  onPreview,
  selected,
  onToggleSelect,
  selectionMode,
  singleLayout,
  onPick,
  onEdit,
}: {
  item: HistoryItem;
  index: number;
  active: boolean;
  preview: boolean;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onPreview?: (item: HistoryItem) => void | Promise<void>;
  selected: boolean;
  onToggleSelect?: (item: HistoryItem) => void;
  selectionMode: boolean;
  singleLayout: boolean;
  onPick?: (item: HistoryItem) => void | Promise<void>;
  onEdit?: (item: HistoryItem) => void;
}) {
  const previewURL = useBlobURL(item.imageBlob ?? item.previewBlob ?? null, item.imageB64 ?? null);
  const src = historyPreviewSrc(item, previewURL);
  const reviewEnabled = !!(onPick || onEdit);
  const tasteReview = item.tasteReview;
  const [pickBusy, setPickBusy] = useState(false);
  const pickBusyRef = useRef(false);
  async function pick() {
    if (!onPick || pickBusyRef.current) return;
    pickBusyRef.current = true;
    setPickBusy(true);
    try {
      await onPick(item);
    } catch {
      pickBusyRef.current = false;
      setPickBusy(false);
    }
  }
  return (
    <div
      className={`batch-grid-tile ${active ? "active" : ""} ${preview ? "previewing" : ""} ${selected ? "selected" : ""} ${selectionMode ? "selection-mode" : ""} ${reviewEnabled ? "review-mode" : ""}`}
      title={item.prompt}
    >
      <button
        type="button"
        className={`batch-grid-tile-button ${singleLayout ? "single-layout" : ""}`}
        onClick={() => {
          switch (batchTileIntent({ selectionMode, preview, canFocusPreview: !!onPreview })) {
            case "toggle-selection":
              onToggleSelect?.(item);
              break;
            case "focus-preview":
              void onPreview?.(item);
              break;
            case "open-single":
              void onSelect(item);
              break;
          }
        }}
        disabled={preview}
        title={!preview && onPreview ? "查看大图（不会退出本批）" : undefined}
      >
        <span className="batch-grid-media">
          <img
            src={src}
            alt={item.prompt || `batch result ${index + 1}`}
            loading="eager"
            decoding="async"
            draggable={false}
          />
        </span>
        {singleLayout ? (
          <span className="batch-grid-single-note">
            {preview ? "流式预览会持续刷新，最终结果生成后会自动替换。" : "当前结果已就绪，生成完成后可继续在画布中处理。"}
          </span>
        ) : null}
        <span className="batch-grid-index">{index + 1}</span>
        {selectionMode && !preview ? <span className="batch-grid-check">{selected ? "已选" : "未选"}</span> : null}
        {preview ? <span className="batch-grid-meta">预览中</span> : null}
        {!preview && item.elapsedSec ? <span className="batch-grid-meta">{item.elapsedSec}s</span> : null}
        {!preview && !selectionMode && tasteReview ? (
          <span
            className={`batch-grid-critic-badge ${tasteReview.disqualified ? "dq" : tasteReview.top3 ? "top" : ""}`}
            title={tasteReview.disqualified
              ? tasteReview.disqualificationReasons.map(criticReasonLabel).join("、")
              : tasteReview.summary}
          >
            {tasteReview.disqualified
              ? `DQ · ${tasteReview.disqualificationReasons.map(criticReasonLabel).join("/")}`
              : `${tasteReview.rank ? `#${tasteReview.rank} · ` : ""}${Math.round(tasteReview.score)} 分`}
          </span>
        ) : null}
      </button>
      {!preview ? <DragExportHandle item={item} className="batch-grid-drag-export" /> : null}
      {!preview && reviewEnabled ? (
        <div className="batch-grid-review-actions">
          {onPick ? (
            <button type="button" className="batch-grid-review-button pick" onClick={() => void pick()} disabled={pickBusy}>
              {pickBusy ? "记录中…" : tasteReview?.disqualified ? "仍选定" : "选定"}
            </button>
          ) : null}
          {onEdit ? (
            <button type="button" className="batch-grid-review-button edit" onClick={() => onEdit(item)}>
              <span className="review-label-wide">{tasteReview?.disqualified ? "仍选定并提建议" : "选定并提建议"}</span>
              <span className="review-label-compact">选定+建议</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FocusedBatchPreview({
  item,
  items,
  loading,
  loadError,
  onBack,
  onNavigate,
  onOpenInCanvas,
  onPick,
  onEdit,
  onShowItem,
  onRetry,
}: {
  item: HistoryItem;
  items: HistoryItem[];
  loading: boolean;
  loadError: string | null;
  onBack: () => void;
  onNavigate: (delta: -1 | 1) => void;
  onOpenInCanvas: () => void;
  onPick?: (item: HistoryItem) => void | Promise<void>;
  onEdit?: (item: HistoryItem) => void;
  onShowItem: (item: HistoryItem) => void;
  onRetry: () => void;
}) {
  const objectURL = useBlobURL(item.imageBlob ?? item.previewBlob ?? null, item.imageB64 ?? null);
  const src = historyFullSrc(item, objectURL);
  const index = items.findIndex((candidate) => candidate.id === item.id);
  const [pickBusy, setPickBusy] = useState(false);
  const pickBusyRef = useRef(false);

  async function pick() {
    if (!onPick || pickBusyRef.current) return;
    pickBusyRef.current = true;
    setPickBusy(true);
    try {
      await onPick(item);
    } catch {
      pickBusyRef.current = false;
      setPickBusy(false);
    }
  }

  return (
    <div className="batch-grid-overlay batch-focus-overlay">
      <div className="batch-grid-head">
        <div className="batch-grid-heading">
          <span className="batch-grid-title">大图预览 · {index + 1}/{items.length}</span>
          <span className="batch-grid-hint">预览不会退出本批，下面可直接切换其他图片</span>
        </div>
        <button type="button" className="batch-grid-close batch-focus-back" onClick={onBack}>
          返回全部 {items.length} 张
        </button>
      </div>
      <div className="batch-focus-stage">
        <button type="button" className="batch-focus-nav previous" onClick={() => onNavigate(-1)} aria-label="上一张">
          ‹
        </button>
        <div className="batch-focus-media">
          <img src={src} alt={item.prompt || `batch result ${index + 1}`} draggable={false} />
          {loading ? <span className="batch-focus-loading">正在加载完整图片…</span> : null}
          {!loading && loadError ? (
            <button type="button" className="batch-focus-loading error" onClick={onRetry}>
              {loadError} · 重试
            </button>
          ) : null}
          {item.tasteReview ? (
            <span className={`batch-grid-critic-badge ${item.tasteReview.disqualified ? "dq" : item.tasteReview.top3 ? "top" : ""}`}>
              {item.tasteReview.disqualified
                ? `DQ · ${item.tasteReview.disqualificationReasons.map(criticReasonLabel).join("/")}`
                : `${item.tasteReview.rank ? `#${item.tasteReview.rank} · ` : ""}${Math.round(item.tasteReview.score)} 分`}
            </span>
          ) : null}
        </div>
        <button type="button" className="batch-focus-nav next" onClick={() => onNavigate(1)} aria-label="下一张">
          ›
        </button>
      </div>
      <div className="batch-focus-strip" aria-label="本批全部图片">
        {items.map((candidate, candidateIndex) => (
          <FocusThumbnail
            key={candidate.id}
            item={candidate}
            index={candidateIndex}
            active={candidate.id === item.id}
            onClick={() => onShowItem(candidate)}
          />
        ))}
      </div>
      <div className="batch-focus-actions">
        <button type="button" className="batch-focus-secondary" onClick={onOpenInCanvas}>
          在单图画布编辑
        </button>
        <span className="batch-focus-spacer" />
        {onPick ? (
          <button type="button" className="batch-grid-review-button pick" onClick={() => void pick()} disabled={pickBusy}>
            {pickBusy ? "记录中…" : item.tasteReview?.disqualified ? "仍选定这张" : "选定这张"}
          </button>
        ) : null}
        {onEdit ? (
          <button type="button" className="batch-grid-review-button edit" onClick={() => onEdit(item)}>
            {item.tasteReview?.disqualified ? "仍选定并提建议" : "选定并提建议"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FocusThumbnail({
  item,
  index,
  active,
  onClick,
}: {
  item: HistoryItem;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const objectURL = useBlobURL(item.imageBlob ?? item.previewBlob ?? null, item.imageB64 ?? null);
  const src = historyPreviewSrc(item, objectURL);
  return (
    <button
      type="button"
      className={`batch-focus-thumb ${active ? "active" : ""}`}
      onClick={onClick}
      aria-label={`查看第 ${index + 1} 张`}
      aria-current={active ? "true" : undefined}
    >
      <img src={src} alt="" draggable={false} />
      <span>{index + 1}</span>
    </button>
  );
}

function sortTasteReviewedItems(items: HistoryItem[]): HistoryItem[] {
  if (!items.some((item) => item.tasteReview)) return items;
  return [...items].sort((left, right) => {
    const leftReview = left.tasteReview;
    const rightReview = right.tasteReview;
    if (!!leftReview !== !!rightReview) return leftReview ? -1 : 1;
    if (!leftReview || !rightReview) return (left.batchIndex ?? 0) - (right.batchIndex ?? 0);
    if (leftReview.disqualified !== rightReview.disqualified) return leftReview.disqualified ? 1 : -1;
    const rankDelta = (leftReview.rank ?? Number.MAX_SAFE_INTEGER) - (rightReview.rank ?? Number.MAX_SAFE_INTEGER);
    return rankDelta || (left.batchIndex ?? 0) - (right.batchIndex ?? 0);
  });
}

function criticReasonLabel(reason: "multiple-primary-subjects" | "multi-view-layout"): string {
  return reason === "multiple-primary-subjects" ? "多主体" : "拼版/多视图";
}

function PendingGridTile({ index, singleLayout }: { index: number; singleLayout: boolean }) {
  return (
    <div className="batch-grid-tile pending" aria-label={`等待第 ${index + 1} 张预览`}>
      <span className="batch-grid-index">{index + 1}</span>
      <span className="batch-grid-pending-ring" />
      <span className="batch-grid-pending-label">{singleLayout ? "等待第一张预览" : "等待预览"}</span>
      {singleLayout ? <span className="batch-grid-single-note pending-note">收到首帧后，这里会自动切成实时预览画面。</span> : null}
    </div>
  );
}
