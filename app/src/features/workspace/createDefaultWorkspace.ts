/**
 * Default LogicalWorkspace, TerminalTab, and TerminalPane Factories
 *
 * Creates deterministic initial state for a single logical workspace, its initial terminal tab,
 * and its initial terminal pane using the recursive Panel Layout Tree model.
 */

import type {
  LogicalWorkspace,
  TerminalTab,
  TerminalPane,
  TerminalTabId,
  TerminalPaneId,
  LogicalWorkspaceId,
  PaneLayoutDirection,
  PaneAccentId,
  TerminalPanel,
  CapturePanel,
  SplitNode,
} from './types';
import { getAccentForOrdinal, getNextUnusedStableOrdinal } from './types';
import {
  clampSplitRatio,
  replacePanelNode,
  removePanelNodeAndCollapse,
  updateSplitRatio,
} from './panelLayoutTree';

export function createDefaultTerminalPane(
  terminalTabId: TerminalTabId = 'tab-1',
  id: TerminalPaneId = 'pane-1',
  stableOrdinal: number = 1,
  accentId?: PaneAccentId,
  terminalSessionId?: string | null,
): TerminalPane {
  return {
    id,
    terminalTabId,
    stableOrdinal,
    accentId: accentId ?? getAccentForOrdinal(stableOrdinal),
    customTitle: null,
    terminalSessionId: terminalSessionId ?? null,
    session: {
      sessionId: terminalSessionId ?? null,
      status: 'starting',
      sessionInfo: null,
    },
    capture: {
      isListening: false,
      hasRetainedData: false,
      currentBatchId: null,
      sessionId: null,
      warning: null,
    },
    selection: {
      selectedBlockIds: new Set<string>(),
      updatedAt: 0,
    },
  };
}

export function createDefaultTerminalTab(
  id: TerminalTabId = 'tab-1',
  workspaceId: LogicalWorkspaceId = 'workspace-1',
  label: string = 'Terminal 1',
  initialPaneId: TerminalPaneId = 'pane-1',
  initialPane?: TerminalPane,
): TerminalTab {
  const pane =
    initialPane ?? createDefaultTerminalPane(id, initialPaneId, 1, 'blue');

  const terminalPanel: TerminalPanel = {
    id: `panel-${pane.id}`,
    kind: 'terminal',
    paneId: pane.id,
    terminalSessionId: pane.terminalSessionId ?? pane.session.sessionId ?? null,
  };

  const capturePanel: CapturePanel = {
    id: `capture-panel-${id}`,
    kind: 'capture',
    selectedCapturePaneIds: [pane.id],
  };

  const panelLayout: SplitNode = {
    type: 'split',
    id: `split-root-${id}`,
    direction: 'horizontal',
    ratio: 0.65,
    first: {
      type: 'panel',
      panelId: terminalPanel.id,
    },
    second: {
      type: 'panel',
      panelId: capturePanel.id,
    },
  };

  return {
    id,
    workspaceId,
    label,
    name: label,
    terminalPanes: [pane],
    panes: [pane],
    panels: [terminalPanel, capturePanel],
    capturePanelId: capturePanel.id,
    isCapturePanelOpen: true,
    capturePanelWidth: 400,
    panelLayout,
    activeTerminalPaneId: pane.id,
    activePaneId: pane.id,
    nextTerminalPaneOrdinal: 2,
    paneIds: [pane.id],
    rootPaneId: pane.id,
    paneLayoutDirection: null,
    paneSplitRatio: 0.5,
    paneLayout: {
      kind: 'pane',
      paneId: pane.id,
    },
    pane: pane.session,
    capture: pane.capture,
  };
}

export function createDefaultLogicalWorkspace(
  id: LogicalWorkspaceId = 'workspace-1',
  name: string = 'Workspace 1',
  initialTerminalTabId: TerminalTabId = 'tab-1',
  initialPaneId: TerminalPaneId = 'pane-1',
  rootPath?: string,
  repository?: import('./types').RepositoryContext,
): LogicalWorkspace {
  const defaultPane = createDefaultTerminalPane(
    initialTerminalTabId,
    initialPaneId,
  );
  const defaultTab = createDefaultTerminalTab(
    initialTerminalTabId,
    id,
    'Terminal 1',
    initialPaneId,
    defaultPane,
  );

  return {
    id,
    name,
    rootPath: rootPath ?? undefined,
    repository: repository ?? undefined,
    terminalTabs: [defaultTab],
    activeTerminalTabId: initialTerminalTabId,
    panes: [defaultPane],
    capture: {
      isListening: false,
      currentBatch: null,
      batchCounter: 0,
      blocks: [],
    },
    selection: {
      selectedBlockIds: new Set<string>(),
      updatedAt: 0,
    },
    terminalTabIds: [initialTerminalTabId],
  };
}

export const createDefaultWorkspace = createDefaultLogicalWorkspace;

export function renameTerminalTabInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  name: string,
): LogicalWorkspace[] {
  const trimmed = name.trim();
  if (!trimmed) return workspaces;
  const finalName = trimmed.slice(0, 40);

  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tabExists = ws.terminalTabs.some((t) => t.id === terminalTabId);
    if (!tabExists) return ws;
    return {
      ...ws,
      terminalTabs: ws.terminalTabs.map((t) =>
        t.id === terminalTabId
          ? { ...t, label: finalName, name: finalName }
          : t,
      ),
    };
  });
}

export const renameTerminalTab = renameTerminalTabInWorkspaces;

export function renameTerminalPaneInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
  nextCustomTitle: string | null,
): LogicalWorkspace[] {
  const trimmed = nextCustomTitle ? nextCustomTitle.trim() : '';
  const finalTitle = trimmed.length > 0 ? trimmed.slice(0, 40) : null;

  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
    if (!tab) return ws;
    if (!tab.panes.some((p) => p.id === paneId)) return ws;

    const updatedPanes = tab.panes.map((p) => {
      if (p.id !== paneId) return p;
      return {
        ...p,
        customTitle: finalTitle,
      };
    });

    const updatedTabs = ws.terminalTabs.map((t) => {
      if (t.id !== terminalTabId) return t;
      return {
        ...t,
        terminalPanes: updatedPanes,
        panes: updatedPanes,
      };
    });

    const updatedWorkspacePanes = ws.panes.map((p) => {
      if (p.id !== paneId) return p;
      return {
        ...p,
        customTitle: finalTitle,
      };
    });

    return {
      ...ws,
      terminalTabs: updatedTabs,
      panes: updatedWorkspacePanes,
    };
  });
}

export const renameTerminalPane = renameTerminalPaneInWorkspaces;

export function splitPaneInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  sourcePaneId: string,
  direction: PaneLayoutDirection,
  newPane: TerminalPane,
): LogicalWorkspace[] {
  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
    if (!tab) return ws;
    // Invariant: terminalTab supports at most 6 terminal panes
    if (tab.panes.length >= 6) return ws;
    if (!tab.panes.some((p) => p.id === sourcePaneId)) return ws;

    const sourcePanel = tab.panels?.find(
      (p): p is TerminalPanel =>
        p.kind === 'terminal' && p.paneId === sourcePaneId,
    );
    if (!sourcePanel) return ws;

    const newPanel: TerminalPanel = {
      id: `panel-${newPane.id}`,
      kind: 'terminal',
      paneId: newPane.id,
      terminalSessionId:
        newPane.terminalSessionId ?? newPane.session?.sessionId ?? null,
    };

    const newSplit: SplitNode = {
      type: 'split',
      id: `split-${tab.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      direction,
      ratio: 0.5,
      first: {
        type: 'panel',
        panelId: sourcePanel.id,
      },
      second: {
        type: 'panel',
        panelId: newPanel.id,
      },
    };

    const updatedLayout = replacePanelNode(
      tab.panelLayout,
      sourcePanel.id,
      newSplit,
    );
    const updatedPanes = [...tab.panes, newPane];
    const updatedPanels = [...tab.panels, newPanel];
    const nextOrdinal = getNextUnusedStableOrdinal(updatedPanes);

    const updatedTabs = ws.terminalTabs.map((t) => {
      if (t.id !== terminalTabId) return t;
      return {
        ...t,
        terminalPanes: updatedPanes,
        panes: updatedPanes,
        panels: updatedPanels,
        panelLayout: updatedLayout,
        paneIds: [...t.paneIds, newPane.id],
        activeTerminalPaneId: newPane.id,
        activePaneId: newPane.id,
        nextTerminalPaneOrdinal: nextOrdinal,
        paneLayoutDirection: direction,
        paneSplitRatio: t.paneSplitRatio ?? 0.5,
      };
    });

    return {
      ...ws,
      terminalTabs: updatedTabs,
      panes: [...ws.panes, newPane],
    };
  });
}

export function closePaneInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
): { workspaces: LogicalWorkspace[]; nextActivePaneId: string | null } {
  let nextActivePaneId: string | null = null;

  const nextWorkspaces = workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
    if (!tab) return ws;
    // Invariant: terminalTab.panes.length is always >= 1
    if (tab.panes.length <= 1) return ws;
    if (!tab.panes.some((p) => p.id === paneId)) return ws;

    const remainingPanes = tab.panes.filter((p) => p.id !== paneId);
    const sibling = remainingPanes[0];
    nextActivePaneId =
      tab.activePaneId === paneId ? (sibling?.id ?? null) : tab.activePaneId;

    const targetPanel = tab.panels?.find(
      (p): p is TerminalPanel => p.kind === 'terminal' && p.paneId === paneId,
    );

    let updatedLayout = tab.panelLayout;
    if (targetPanel && tab.panelLayout) {
      const collapsed = removePanelNodeAndCollapse(
        tab.panelLayout,
        targetPanel.id,
      );
      if (collapsed) {
        updatedLayout = collapsed;
      }
    }

    const survivingActiveId = nextActivePaneId ?? remainingPanes[0]?.id;
    const updatedPanels = (tab.panels ?? [])
      .map((p) => {
        if (p.kind === 'capture') {
          const remainingTargets = p.selectedCapturePaneIds.filter(
            (id) => id !== paneId,
          );
          const finalTargets =
            remainingTargets.length === 0 && survivingActiveId
              ? [survivingActiveId]
              : remainingTargets;
          return {
            ...p,
            selectedCapturePaneIds: finalTargets,
          };
        }
        return p;
      })
      .filter((p) => p.id !== targetPanel?.id);

    const nextOrdinal = getNextUnusedStableOrdinal(remainingPanes);

    const updatedTabs = ws.terminalTabs.map((t) => {
      if (t.id !== terminalTabId) return t;
      return {
        ...t,
        terminalPanes: remainingPanes,
        panes: remainingPanes,
        panels: updatedPanels,
        panelLayout: updatedLayout,
        paneIds: remainingPanes.map((p) => p.id),
        activeTerminalPaneId: nextActivePaneId ?? t.activeTerminalPaneId,
        activePaneId: nextActivePaneId ?? t.activePaneId,
        nextTerminalPaneOrdinal: nextOrdinal,
        paneLayoutDirection: null,
        paneSplitRatio: 0.5,
      };
    });

    return {
      ...ws,
      terminalTabs: updatedTabs,
      panes: ws.panes.filter((p) => p.id !== paneId),
    };
  });

  return { workspaces: nextWorkspaces, nextActivePaneId };
}

export function setActivePaneInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
): LogicalWorkspace[] {
  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
    if (!tab || !tab.panes.some((p) => p.id === paneId)) return ws;

    const updatedTabs = ws.terminalTabs.map((t) => {
      if (t.id !== terminalTabId) return t;
      return {
        ...t,
        activeTerminalPaneId: paneId,
        activePaneId: paneId,
      };
    });

    return {
      ...ws,
      terminalTabs: updatedTabs,
    };
  });
}

export function resizePaneLayoutInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  splitRatio: number,
): LogicalWorkspace[] {
  const clamped = clampSplitRatio(splitRatio);
  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
    if (!tab) return ws;

    const termSplitId = `split-terminals-${tab.id}`;
    let updatedLayout = tab.panelLayout;
    if (tab.panelLayout) {
      updatedLayout = updateSplitRatio(tab.panelLayout, termSplitId, clamped);
      if (
        updatedLayout === tab.panelLayout &&
        tab.panelLayout.type === 'split'
      ) {
        updatedLayout = { ...tab.panelLayout, ratio: clamped };
      }
    }

    const updatedTabs = ws.terminalTabs.map((t) => {
      if (t.id !== terminalTabId) return t;
      return {
        ...t,
        paneSplitRatio: clamped,
        panelLayout: updatedLayout,
      };
    });

    return {
      ...ws,
      terminalTabs: updatedTabs,
    };
  });
}

export function resizeSplitInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  splitId: string,
  splitRatio: number,
): LogicalWorkspace[] {
  const clamped = clampSplitRatio(splitRatio);
  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
    if (!tab || !tab.panelLayout) return ws;

    const updatedLayout = updateSplitRatio(tab.panelLayout, splitId, clamped);

    const updatedTabs = ws.terminalTabs.map((t) => {
      if (t.id !== terminalTabId) return t;
      return {
        ...t,
        panelLayout: updatedLayout,
        paneSplitRatio: clamped,
      };
    });

    return {
      ...ws,
      terminalTabs: updatedTabs,
    };
  });
}

export function toggleCapturePanelInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
): LogicalWorkspace[] {
  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
    if (!tab) return ws;

    const isOpen = tab.isCapturePanelOpen ?? true;
    const updatedTabs = ws.terminalTabs.map((t) => {
      if (t.id !== terminalTabId) return t;
      return {
        ...t,
        isCapturePanelOpen: !isOpen,
      };
    });

    return {
      ...ws,
      terminalTabs: updatedTabs,
    };
  });
}

export function setCapturePanelWidthInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  width: number,
): LogicalWorkspace[] {
  const clampedWidth = Math.max(260, Math.min(1200, Math.round(width)));
  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    const tab = ws.terminalTabs.find((t) => t.id === terminalTabId);
    if (!tab) return ws;

    const updatedTabs = ws.terminalTabs.map((t) => {
      if (t.id !== terminalTabId) return t;
      return {
        ...t,
        capturePanelWidth: clampedWidth,
      };
    });

    return {
      ...ws,
      terminalTabs: updatedTabs,
    };
  });
}
