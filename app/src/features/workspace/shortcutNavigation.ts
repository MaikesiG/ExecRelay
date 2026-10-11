import type { LogicalWorkspace, PanelLayoutNode, TabPanel, TerminalTab } from './types';
import { extractTerminalLayoutNode } from './panelLayoutTree';

export type PaneFocusDirection = 'left' | 'right' | 'up' | 'down';

interface PaneRect {
  paneId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function findAdjacentId(
  ids: readonly string[],
  activeId: string,
  direction: -1 | 1,
): string | null {
  if (ids.length <= 1) return null;
  const activeIndex = ids.indexOf(activeId);
  if (activeIndex < 0) return null;
  return ids[(activeIndex + direction + ids.length) % ids.length] ?? null;
}

export function selectAdjacentTerminalTab(
  workspace: LogicalWorkspace,
  direction: -1 | 1,
): LogicalWorkspace {
  const nextTabId = findAdjacentId(
    workspace.terminalTabs.map((tab) => tab.id),
    workspace.activeTerminalTabId,
    direction,
  );
  if (!nextTabId) return workspace;

  const targetTab = workspace.terminalTabs.find((tab) => tab.id === nextTabId);
  const targetPane = targetTab
    ? workspace.panes.find((pane) => pane.id === targetTab.activePaneId)
    : null;
  const targetIsListening =
    targetPane?.capture?.isListening ?? targetTab?.capture?.isListening ?? false;

  return {
    ...workspace,
    activeTerminalTabId: nextTabId,
    capture: {
      ...workspace.capture,
      isListening: targetIsListening,
    },
  };
}

function collectPaneRects(
  node: PanelLayoutNode,
  panelsById: ReadonlyMap<string, TabPanel>,
  bounds: Omit<PaneRect, 'paneId'>,
  result: PaneRect[],
): void {
  if (node.type === 'panel') {
    const panel = panelsById.get(node.panelId);
    if (panel?.kind === 'terminal') {
      result.push({ paneId: panel.paneId, ...bounds });
    }
    return;
  }

  const ratio = Math.max(0, Math.min(1, node.ratio));
  if (node.direction === 'horizontal') {
    const divider = bounds.left + (bounds.right - bounds.left) * ratio;
    collectPaneRects(node.first, panelsById, { ...bounds, right: divider }, result);
    collectPaneRects(node.second, panelsById, { ...bounds, left: divider }, result);
  } else {
    const divider = bounds.top + (bounds.bottom - bounds.top) * ratio;
    collectPaneRects(node.first, panelsById, { ...bounds, bottom: divider }, result);
    collectPaneRects(node.second, panelsById, { ...bounds, top: divider }, result);
  }
}

function intervalGap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (aEnd < bStart) return bStart - aEnd;
  if (bEnd < aStart) return aStart - bEnd;
  return 0;
}

export function findDirectionalPaneId(
  tab: TerminalTab,
  activePaneId: string,
  direction: PaneFocusDirection,
): string | null {
  if (!tab.panelLayout || tab.panes.length <= 1) return null;

  const panelsById = new Map(tab.panels.map((panel) => [panel.id, panel]));
  const paneRects: PaneRect[] = [];
  collectPaneRects(
    extractTerminalLayoutNode(tab.panelLayout, tab.capturePanelId),
    panelsById,
    { left: 0, top: 0, right: 1, bottom: 1 },
    paneRects,
  );

  const livePaneIds = new Set(tab.panes.map((pane) => pane.id));
  const active = paneRects.find(
    (rect) => rect.paneId === activePaneId && livePaneIds.has(rect.paneId),
  );
  if (!active) return null;

  const epsilon = 1e-9;
  const candidates = paneRects
    .filter((candidate) => {
      if (!livePaneIds.has(candidate.paneId) || candidate.paneId === activePaneId) return false;
      if (direction === 'left') return candidate.right <= active.left + epsilon;
      if (direction === 'right') return candidate.left >= active.right - epsilon;
      if (direction === 'up') return candidate.bottom <= active.top + epsilon;
      return candidate.top >= active.bottom - epsilon;
    })
    .map((candidate) => {
      const horizontal = direction === 'left' || direction === 'right';
      const primaryGap = horizontal
        ? direction === 'left'
          ? active.left - candidate.right
          : candidate.left - active.right
        : direction === 'up'
          ? active.top - candidate.bottom
          : candidate.top - active.bottom;
      const perpendicularGap = horizontal
        ? intervalGap(active.top, active.bottom, candidate.top, candidate.bottom)
        : intervalGap(active.left, active.right, candidate.left, candidate.right);
      const perpendicularCenterDistance = horizontal
        ? Math.abs((active.top + active.bottom) / 2 - (candidate.top + candidate.bottom) / 2)
        : Math.abs((active.left + active.right) / 2 - (candidate.left + candidate.right) / 2);
      return { candidate, primaryGap, perpendicularGap, perpendicularCenterDistance };
    });

  candidates.sort((a, b) =>
    a.primaryGap - b.primaryGap ||
    a.perpendicularGap - b.perpendicularGap ||
    a.perpendicularCenterDistance - b.perpendicularCenterDistance ||
    a.candidate.top - b.candidate.top ||
    a.candidate.left - b.candidate.left ||
    a.candidate.paneId.localeCompare(b.candidate.paneId),
  );

  return candidates[0]?.candidate.paneId ?? null;
}
