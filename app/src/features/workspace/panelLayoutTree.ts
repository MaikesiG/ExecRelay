/**
 * LT-PANEL-LAYOUT-TREE-001: Pure Panel Layout Tree Helpers & Migration
 *
 * Implements pure, testable operations for recursive SplitNode / PanelLeafNode trees:
 * - findPanelNode
 * - findParentSplit
 * - replacePanelNode
 * - updateSplitRatio (with ratio clamping 0.2 to 0.8)
 * - collectPanelIds
 * - removePanelNodeAndCollapse
 * - validatePanelLayout
 * - migrateTerminalTabToPanelLayoutTree
 */

import type {
  PanelLayoutNode,
  PanelLeafNode,
  SplitNode,
  TabPanel,
  TerminalPanel,
  CapturePanel,
  TerminalPane,
  TerminalTab,
} from './types';
import { getAccentForOrdinal } from './types';

export interface LayoutValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Clamps ratio to the supported minimum (0.2) through maximum (0.8) range.
 */
export function clampSplitRatio(ratio: number): number {
  if (typeof ratio !== 'number' || Number.isNaN(ratio)) {
    return 0.5;
  }
  return Math.max(0.2, Math.min(0.8, ratio));
}

/**
 * Extracts the terminal-only layout subtree from a tab layout.
 * When the capture panel is right-docked as a top-level side panel,
 * the terminal main region renders only the terminal panes and their internal splits.
 */
export function extractTerminalLayoutNode(
  layout: PanelLayoutNode,
  capturePanelId?: string,
): PanelLayoutNode {
  if (!layout) return layout;
  if (layout.type === 'split') {
    const isSecondCapture =
      layout.second.type === 'panel' &&
      (layout.second.panelId === capturePanelId ||
        layout.second.panelId.startsWith('capture-panel') ||
        layout.second.panelId.includes('capture'));
    if (isSecondCapture) {
      return layout.first;
    }
    const isFirstCapture =
      layout.first.type === 'panel' &&
      (layout.first.panelId === capturePanelId ||
        layout.first.panelId.startsWith('capture-panel') ||
        layout.first.panelId.includes('capture'));
    if (isFirstCapture) {
      return layout.second;
    }
  }
  return layout;
}


/**
 * Searches the layout tree for a panel leaf with the specified panelId.
 */
export function findPanelNode(
  node: PanelLayoutNode | null | undefined,
  panelId: string,
): PanelLeafNode | null {
  if (!node) return null;
  if (node.type === 'panel') {
    return node.panelId === panelId ? node : null;
  }
  return (
    findPanelNode(node.first, panelId) || findPanelNode(node.second, panelId)
  );
}

/**
 * Finds the immediate parent SplitNode that contains the panel leaf as a direct child.
 */
export function findParentSplit(
  node: PanelLayoutNode | null | undefined,
  panelId: string,
): SplitNode | null {
  if (!node || node.type === 'panel') {
    return null;
  }
  if (
    (node.first.type === 'panel' && node.first.panelId === panelId) ||
    (node.second.type === 'panel' && node.second.panelId === panelId)
  ) {
    return node;
  }
  return (
    findParentSplit(node.first, panelId) ||
    findParentSplit(node.second, panelId)
  );
}

/**
 * Immutably replaces a panel leaf with a replacement node.
 */
export function replacePanelNode(
  node: PanelLayoutNode,
  panelId: string,
  replacement: PanelLayoutNode,
): PanelLayoutNode {
  if (node.type === 'panel') {
    return node.panelId === panelId ? replacement : node;
  }
  return {
    ...node,
    first: replacePanelNode(node.first, panelId, replacement),
    second: replacePanelNode(node.second, panelId, replacement),
  };
}

/**
 * Immutably updates the ratio of a specific SplitNode by splitId.
 */
export function updateSplitRatio(
  node: PanelLayoutNode,
  splitId: string,
  ratio: number,
): PanelLayoutNode {
  if (node.type === 'panel') {
    return node;
  }
  if (node.id === splitId) {
    return {
      ...node,
      ratio: clampSplitRatio(ratio),
    };
  }
  return {
    ...node,
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio),
  };
}

/**
 * Collects all panel IDs present in the layout tree in traversal order.
 */
export function collectPanelIds(node: PanelLayoutNode | null | undefined): string[] {
  if (!node) return [];
  if (node.type === 'panel') {
    return [node.panelId];
  }
  return [...collectPanelIds(node.first), ...collectPanelIds(node.second)];
}

/**
 * Removes a panel node and collapses the tree recursively.
 * If a SplitNode has one surviving child after removal, it is replaced with the survivor.
 */
export function removePanelNodeAndCollapse(
  node: PanelLayoutNode,
  panelId: string,
): PanelLayoutNode | null {
  if (node.type === 'panel') {
    return node.panelId === panelId ? null : node;
  }

  const newFirst = removePanelNodeAndCollapse(node.first, panelId);
  const newSecond = removePanelNodeAndCollapse(node.second, panelId);

  if (newFirst === null && newSecond === null) {
    return null;
  }
  if (newFirst === null) {
    return newSecond;
  }
  if (newSecond === null) {
    return newFirst;
  }

  return {
    ...node,
    first: newFirst,
    second: newSecond,
  };
}

/**
 * Validates the layout tree against registered panels and terminal panes.
 *
 * Rules:
 * - Every panel leaf references a registered TabPanel.
 * - Every registered TabPanel appears exactly once in the tree.
 * - No panel ID appears twice.
 * - Exactly one CapturePanel is present.
 * - Every terminal panel references an existing terminal pane.
 * - No terminal pane has more than one terminal panel.
 * - Every split node has two children.
 * - Every ratio is clamped to the supported minimum/maximum range.
 */
export function validatePanelLayout(
  layout: PanelLayoutNode | null | undefined,
  panels: TabPanel[],
  terminalPanes?: TerminalPane[],
): LayoutValidationResult {
  const errors: string[] = [];

  if (!layout) {
    return {
      isValid: false,
      errors: ['Layout tree is null or undefined'],
    };
  }

  const panelMap = new Map<string, TabPanel>();
  for (const p of panels) {
    if (panelMap.has(p.id)) {
      errors.push(`Duplicate panel registered with id: ${p.id}`);
    }
    panelMap.set(p.id, p);
  }

  const capturePanels = panels.filter((p): p is CapturePanel => p.kind === 'capture');
  if (capturePanels.length !== 1) {
    errors.push(`Expected exactly 1 CapturePanel, but found ${capturePanels.length}`);
  }

  if (terminalPanes) {
    const paneIdSet = new Set(terminalPanes.map((p) => p.id));
    const terminalPanels = panels.filter(
      (p): p is TerminalPanel => p.kind === 'terminal',
    );
    const seenPaneIds = new Set<string>();
    for (const tp of terminalPanels) {
      if (!paneIdSet.has(tp.paneId)) {
        errors.push(
          `TerminalPanel ${tp.id} references non-existent paneId: ${tp.paneId}`,
        );
      }
      if (seenPaneIds.has(tp.paneId)) {
        errors.push(`Multiple TerminalPanels reference paneId: ${tp.paneId}`);
      }
      seenPaneIds.add(tp.paneId);
    }
  }

  const seenPanelIdsInTree = new Set<string>();

  function validateNode(node: PanelLayoutNode, path: string) {
    if (!node) {
      errors.push(`Split node at ${path} is missing a child`);
      return;
    }
    if (node.type === 'panel') {
      if (!node.panelId) {
        errors.push(`Panel leaf at ${path} has empty panelId`);
        return;
      }
      if (!panelMap.has(node.panelId)) {
        errors.push(
          `Panel leaf references unregistered panelId: ${node.panelId}`,
        );
      }
      if (seenPanelIdsInTree.has(node.panelId)) {
        errors.push(
          `Panel ID appears more than once in layout tree: ${node.panelId}`,
        );
      }
      seenPanelIdsInTree.add(node.panelId);
    } else if (node.type === 'split') {
      if (!node.first || !node.second) {
        errors.push(`Split node ${node.id || path} must have two children`);
      }
      if (typeof node.ratio !== 'number' || node.ratio < 0.2 || node.ratio > 0.8) {
        errors.push(
          `Split node ${node.id || path} ratio ${node.ratio} is out of bounds [0.2, 0.8]`,
        );
      }
      if (node.first) validateNode(node.first, `${path}.first`);
      if (node.second) validateNode(node.second, `${path}.second`);
    } else {
      errors.push(`Invalid node type at ${path}`);
    }
  }

  validateNode(layout, 'root');

  for (const panel of panels) {
    if (!seenPanelIdsInTree.has(panel.id)) {
      errors.push(
        `Registered panel ${panel.id} does not appear in layout tree`,
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Migrates existing 1-pane or 2-pane TerminalTab states to a recursive PanelLayoutNode tree.
 * Preserves terminal IDs, session state, scrollback, Capture state, active pane, and ratios.
 */
export function migrateTerminalTabToPanelLayoutTree(
  tab: TerminalTab,
  workspaceId: string = tab.workspaceId,
): TerminalTab {
  // 1. Ensure all terminal panes have stableOrdinal and accentId
  const rawPanes: TerminalPane[] =
    tab.terminalPanes && tab.terminalPanes.length > 0
      ? tab.terminalPanes
      : tab.panes && tab.panes.length > 0
        ? tab.panes
        : [];

  const existingOrdinals = new Set(
    rawPanes
      .map((p) => p.stableOrdinal)
      .filter((n): n is number => typeof n === 'number' && n >= 1 && n <= 6),
  );

  let nextAutoOrdinal = 1;
  const migratedPanes: TerminalPane[] = rawPanes.map((pane) => {
    let ordinal = pane.stableOrdinal;
    if (typeof ordinal !== 'number' || ordinal < 1 || ordinal > 6) {
      while (existingOrdinals.has(nextAutoOrdinal) && nextAutoOrdinal <= 6) {
        nextAutoOrdinal++;
      }
      ordinal = nextAutoOrdinal;
      existingOrdinals.add(ordinal);
      nextAutoOrdinal++;
    }
    const accentId = pane.accentId || getAccentForOrdinal(ordinal);
    return {
      ...pane,
      stableOrdinal: ordinal,
      accentId,
    };
  });

  const activePaneId =
    tab.activeTerminalPaneId ||
    tab.activePaneId ||
    migratedPanes[0]?.id ||
    'pane-1';

  // If already migrated with valid panels and panelLayout, check and return
  if (
    tab.panelLayout &&
    tab.panelLayout.type &&
    tab.panels &&
    tab.panels.length > 0 &&
    tab.capturePanelId
  ) {
    const nextOrdinal =
      tab.nextTerminalPaneOrdinal ||
      Math.max(...migratedPanes.map((p) => p.stableOrdinal), 0) + 1;

    return {
      ...tab,
      terminalPanes: migratedPanes,
      panes: migratedPanes,
      activeTerminalPaneId: activePaneId,
      activePaneId,
      nextTerminalPaneOrdinal: nextOrdinal,
      isCapturePanelOpen: tab.isCapturePanelOpen ?? true,
      capturePanelWidth: tab.capturePanelWidth ?? 400,
    };
  }

  // Otherwise, construct new tree according to migration specs:
  const terminalPanels: TerminalPanel[] = migratedPanes.map((p) => ({
    id: `panel-${p.id}`,
    kind: 'terminal',
    paneId: p.id,
  }));

  const capturePanelId = tab.capturePanelId || `capture-panel-${tab.id}`;
  const capturePanel: CapturePanel = {
    id: capturePanelId,
    kind: 'capture',
    selectedCapturePaneIds: [activePaneId],
  };

  let panelLayout: PanelLayoutNode;

  if (terminalPanels.length <= 1) {
    const singlePanel = terminalPanels[0] ?? {
      id: `panel-${activePaneId}`,
      kind: 'terminal',
      paneId: activePaneId,
    };
    if (terminalPanels.length === 0) {
      terminalPanels.push(singlePanel);
    }
    panelLayout = {
      type: 'split',
      id: `split-root-${tab.id}`,
      direction: 'horizontal',
      ratio: 0.65,
      first: {
        type: 'panel',
        panelId: singlePanel.id,
      },
      second: {
        type: 'panel',
        panelId: capturePanel.id,
      },
    };
  } else {
    // 2 existing terminal panes:
    const [p1, p2] = terminalPanels;
    const direction = tab.paneLayoutDirection ?? 'horizontal';
    const splitRatio = tab.paneSplitRatio ?? 0.5;

    const terminalSplit: SplitNode = {
      type: 'split',
      id: `split-terminals-${tab.id}`,
      direction,
      ratio: clampSplitRatio(splitRatio),
      first: {
        type: 'panel',
        panelId: p1.id,
      },
      second: {
        type: 'panel',
        panelId: p2.id,
      },
    };

    panelLayout = {
      type: 'split',
      id: `split-root-${tab.id}`,
      direction: 'horizontal',
      ratio: 0.65,
      first: terminalSplit,
      second: {
        type: 'panel',
        panelId: capturePanel.id,
      },
    };
  }

  const panels: TabPanel[] = [...terminalPanels, capturePanel];
  const maxOrdinal = Math.max(...migratedPanes.map((p) => p.stableOrdinal), 0);
  const nextOrdinal = tab.nextTerminalPaneOrdinal || maxOrdinal + 1;

  return {
    ...tab,
    workspaceId,
    terminalPanes: migratedPanes,
    panes: migratedPanes,
    panels,
    capturePanelId,
    panelLayout,
    activeTerminalPaneId: activePaneId,
    activePaneId,
    nextTerminalPaneOrdinal: nextOrdinal,
    paneIds: migratedPanes.map((p) => p.id),
    isCapturePanelOpen: tab.isCapturePanelOpen ?? true,
    capturePanelWidth: tab.capturePanelWidth ?? 400,
  };
}
