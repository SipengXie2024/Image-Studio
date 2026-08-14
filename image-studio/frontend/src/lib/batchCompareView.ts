export function batchCompareItemIds<T extends { id: string }>(items: T[]): string[] {
  return items.map((item) => item.id);
}

export function collectHistoryBatchItems<
  T extends { batchId?: string; batchIndex?: number; createdAt: number },
>(history: readonly T[], batchId: string): T[] {
  return history
    .filter((item) => item.batchId === batchId)
    .sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0) || a.createdAt - b.createdAt);
}

export function resolveBatchFocus(itemIds: string[], requestedId: string | null): string | null {
  return requestedId && itemIds.includes(requestedId) ? requestedId : null;
}

export function stepBatchFocus(
  itemIds: string[],
  currentId: string,
  delta: -1 | 1,
): string | null {
  const currentIndex = itemIds.indexOf(currentId);
  if (currentIndex < 0 || itemIds.length === 0) return null;
  return itemIds[(currentIndex + delta + itemIds.length) % itemIds.length] ?? null;
}

export type BatchTileIntent = "ignore" | "toggle-selection" | "focus-preview" | "open-single";

export function batchTileIntent({
  selectionMode,
  preview,
  canFocusPreview,
}: {
  selectionMode: boolean;
  preview: boolean;
  canFocusPreview: boolean;
}): BatchTileIntent {
  if (preview) return "ignore";
  if (selectionMode) return "toggle-selection";
  return canFocusPreview ? "focus-preview" : "open-single";
}
