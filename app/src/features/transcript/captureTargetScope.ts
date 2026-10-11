import type {
  LogicalWorkspace,
  TerminalPane,
  TerminalPaneId,
} from '../workspace/types';

export type CaptureTargetScope =
  | { mode: 'all' }
  | { mode: 'explicit'; paneIds: TerminalPaneId[] };

export function normalizeCaptureTargetScope(
  scope: CaptureTargetScope,
  currentTargetPaneIds: readonly TerminalPaneId[],
): CaptureTargetScope {
  if (scope.mode === 'all') return scope;

  const currentIds = [...new Set(currentTargetPaneIds)];
  const currentIdSet = new Set(currentIds);
  const selectedIdSet = new Set(
    scope.paneIds.filter((paneId) => currentIdSet.has(paneId)),
  );

  if (
    currentIdSet.size > 0 &&
    selectedIdSet.size === currentIdSet.size &&
    currentIds.every((paneId) => selectedIdSet.has(paneId))
  ) {
    return { mode: 'all' };
  }

  return {
    mode: 'explicit',
    paneIds: currentIds.filter((paneId) => selectedIdSet.has(paneId)),
  };
}

export function toggleCaptureTargetPane(
  scope: CaptureTargetScope,
  paneId: TerminalPaneId,
  currentTargetPaneIds: readonly TerminalPaneId[],
): CaptureTargetScope {
  const currentIds = [...new Set(currentTargetPaneIds)];
  if (!currentIds.includes(paneId)) {
    return normalizeCaptureTargetScope(scope, currentIds);
  }

  const normalizedScope = normalizeCaptureTargetScope(scope, currentIds);
  const selectedIds = new Set(
    normalizedScope.mode === 'all' ? currentIds : normalizedScope.paneIds,
  );

  if (selectedIds.has(paneId)) selectedIds.delete(paneId);
  else selectedIds.add(paneId);

  return normalizeCaptureTargetScope(
    { mode: 'explicit', paneIds: [...selectedIds] },
    currentIds,
  );
}

export function getWorkspaceMonitorablePaneIds(
  workspace: LogicalWorkspace,
): TerminalPaneId[] {
  const tabPanes = (workspace.terminalTabs ?? []).flatMap(
    (tab) => tab.panes ?? tab.terminalPanes ?? [],
  );
  if (tabPanes.length > 0) {
    return [...new Set(tabPanes.map((pane) => pane.id))];
  }
  return [...new Set((workspace.panes ?? []).map((pane) => pane.id))];
}

export function getCaptureTargetScope(
  workspace: LogicalWorkspace,
): CaptureTargetScope {
  return normalizeCaptureTargetScope(
    workspace.capture.targetScope ?? { mode: 'all' },
    getWorkspaceMonitorablePaneIds(workspace),
  );
}

export function resolveCaptureTargetPanes(
  workspace: LogicalWorkspace,
): TerminalPane[] {
  const scope = getCaptureTargetScope(workspace);
  const tabPanes = (workspace.terminalTabs ?? []).flatMap(
    (tab) => tab.panes ?? tab.terminalPanes ?? [],
  );
  const allPanes = tabPanes.length > 0 ? tabPanes : (workspace.panes ?? []);
  if (scope.mode === 'all') {
    return allPanes;
  }
  const selectedIds = new Set(scope.paneIds);
  return allPanes.filter((pane) => selectedIds.has(pane.id));
}

export function resolveCaptureTargetPaneIds(
  workspace: LogicalWorkspace,
): TerminalPaneId[] {
  return resolveCaptureTargetPanes(workspace).map((pane) => pane.id);
}
