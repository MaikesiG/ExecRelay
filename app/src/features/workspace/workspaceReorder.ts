import type {
  LogicalWorkspace,
  LogicalWorkspaceId,
  TerminalTab,
  TerminalTabId,
} from './types';

export type WorkspaceDropPlacement = 'before' | 'after';
export type TerminalTabDropPlacement = WorkspaceDropPlacement;

export function reorderById<T extends { id: string }>(
  items: T[],
  draggedId: string,
  targetId: string,
  placement: WorkspaceDropPlacement,
): T[] {
  const fromIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);

  if (
    fromIndex === -1 ||
    targetIndex === -1 ||
    draggedId === targetId
  ) {
    return items;
  }

  const next = [...items];
  const [draggedItem] = next.splice(fromIndex, 1);
  const remainingTargetIndex = next.findIndex(
    (item) => item.id === targetId,
  );
  const insertionIndex =
    placement === 'after' ? remainingTargetIndex + 1 : remainingTargetIndex;

  next.splice(insertionIndex, 0, draggedItem);

  const hasChanged = next.some((item, i) => item !== items[i]);
  if (!hasChanged) {
    return items;
  }

  return next;
}

export function reorderWorkspaces(
  workspaces: LogicalWorkspace[],
  draggedWorkspaceId: LogicalWorkspaceId,
  targetWorkspaceId: LogicalWorkspaceId,
  placement: WorkspaceDropPlacement,
): LogicalWorkspace[] {
  return reorderById(
    workspaces,
    draggedWorkspaceId,
    targetWorkspaceId,
    placement,
  );
}

export function reorderTerminalTabs(
  tabs: TerminalTab[],
  draggedTabId: TerminalTabId,
  targetTabId: TerminalTabId,
  placement: TerminalTabDropPlacement,
): TerminalTab[] {
  return reorderById(tabs, draggedTabId, targetTabId, placement);
}

export const TAB_DRAG_THRESHOLD_PX = 5;

export interface TabRectInfo {
  tabId: TerminalTabId;
  rect: { left: number; right: number; width: number };
}

export function resolveTabDropTarget(
  tabElements: ReadonlyArray<TabRectInfo>,
  clientX: number,
  draggedTabId: TerminalTabId,
): { tabId: TerminalTabId; placement: TerminalTabDropPlacement } | null {
  if (tabElements.length === 0) {
    return null;
  }

  // Pointer is to the left of the first tab
  if (clientX < tabElements[0].rect.left) {
    const targetId = tabElements[0].tabId;
    if (targetId === draggedTabId) return null;
    return { tabId: targetId, placement: 'before' };
  }

  // Pointer is to the right of the last tab
  const lastIndex = tabElements.length - 1;
  if (clientX > tabElements[lastIndex].rect.right) {
    const targetId = tabElements[lastIndex].tabId;
    if (targetId === draggedTabId) return null;
    return { tabId: targetId, placement: 'after' };
  }

  // Pointer is directly within a tab's horizontal span
  for (const item of tabElements) {
    if (clientX >= item.rect.left && clientX <= item.rect.right) {
      if (item.tabId === draggedTabId) {
        return null;
      }
      const midpoint = item.rect.left + item.rect.width / 2;
      const placement: TerminalTabDropPlacement =
        clientX < midpoint ? 'before' : 'after';
      return { tabId: item.tabId, placement };
    }
  }

  // Pointer is in a gap between tabs: find the nearest tab
  let nearestItem = tabElements[0];
  let minDistance = Math.abs(
    clientX - (nearestItem.rect.left + nearestItem.rect.width / 2),
  );
  for (let i = 1; i < tabElements.length; i++) {
    const item = tabElements[i];
    const center = item.rect.left + item.rect.width / 2;
    const dist = Math.abs(clientX - center);
    if (dist < minDistance) {
      minDistance = dist;
      nearestItem = item;
    }
  }

  if (nearestItem.tabId === draggedTabId) {
    return null;
  }
  const midpoint = nearestItem.rect.left + nearestItem.rect.width / 2;
  const placement: TerminalTabDropPlacement =
    clientX < midpoint ? 'before' : 'after';
  return { tabId: nearestItem.tabId, placement };
}
