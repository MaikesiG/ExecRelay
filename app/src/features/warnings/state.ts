import type {
  GlobalWarning,
  CaptureWarning,
  CaptureWarningKey,
} from './types';
import {
  buildCaptureWarningKey,
  isGlobalWarningCode,
  isCaptureWarningCode,
} from './types';
import type { LogicalWorkspace } from '../workspace/types';

/**
 * ============================================================================
 * Global Warning State Actions
 * ============================================================================
 */

/**
 * Adds a new GlobalWarning to the list.
 * Enforces scope validation:
 * - App-scoped: scope === 'app', workspaceId must be undefined
 * - Workspace-scoped: scope === 'workspace', workspaceId must be defined
 * - Global warnings must never include paneId or captureSessionId
 * - Rejects non-global codes and pane-shortcut messages
 */
export function addGlobalWarning(
  warnings: GlobalWarning[],
  warning: GlobalWarning,
): GlobalWarning[] {
  if (
    !warning ||
    typeof warning !== 'object' ||
    !isGlobalWarningCode(warning.code) ||
    warning.message === 'Maximum of 6 panes per terminal tab' ||
    warning.message === 'Maximum of 2 panes per terminal tab' ||
    warning.message === 'Cannot close the last pane'
  ) {
    return warnings;
  }

  // Validate scope rules
  const normalizedWarning: GlobalWarning = {
    ...warning,
    workspaceId: warning.scope === 'app' ? undefined : warning.workspaceId,
  };

  const withoutExisting = warnings.filter((w) => w.id !== normalizedWarning.id);
  return [...withoutExisting, normalizedWarning];
}

/**
 * Dismisses a GlobalWarning by ID.
 * Must only remove a GlobalWarning; does not inspect or mutate Capture state.
 */
export function dismissGlobalWarning(
  warnings: GlobalWarning[],
  warningId: string,
): GlobalWarning[] {
  return warnings.filter((w) => w.id !== warningId);
}

/**
 * Clears all Workspace-scoped GlobalWarnings belonging to a specific workspace.
 * Preserves App-scoped warnings and warnings belonging to other workspaces.
 */
export function clearWorkspaceGlobalWarnings(
  warnings: GlobalWarning[],
  workspaceId: string,
): GlobalWarning[] {
  return warnings.filter(
    (w) => !(w.scope === 'workspace' && w.workspaceId === workspaceId),
  );
}

/**
 * Filters visible GlobalWarnings for the active workspace.
 * App-scoped warnings are always visible across all workspaces.
 * Workspace-scoped warnings are visible only when their workspaceId matches activeWorkspaceId.
 */
export function filterVisibleGlobalWarnings(
  warnings: GlobalWarning[],
  activeWorkspaceId: string | null,
): GlobalWarning[] {
  return warnings.filter((warning) => {
    if (
      !warning ||
      !isGlobalWarningCode(warning.code) ||
      warning.message === 'Maximum of 6 panes per terminal tab' ||
    warning.message === 'Maximum of 2 panes per terminal tab' ||
      warning.message === 'Cannot close the last pane'
    ) {
      return false;
    }
    if (warning.scope === 'app') return true;
    return (
      warning.scope === 'workspace' &&
      warning.workspaceId !== undefined &&
      warning.workspaceId === activeWorkspaceId
    );
  });
}

/**
 * ============================================================================
 * Capture Warning State Actions (Pane-scoped in Workspace domain)
 * ============================================================================
 */

/**
 * Sets a CaptureWarning for a specific pane's capture session.
 * Rejects non-capture codes and pane-shortcut messages.
 * Safely no-ops if target workspace/tab/pane does not exist.
 */
export function setCaptureWarningInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
  captureSessionId: string,
  warning: CaptureWarning,
): LogicalWorkspace[] {
  if (
    !warning ||
    typeof warning !== 'object' ||
    !isCaptureWarningCode(warning.code) ||
    !warning.captureSessionId ||
    warning.message === 'Maximum of 6 panes per terminal tab' ||
    warning.message === 'Maximum of 2 panes per terminal tab' ||
    warning.message === 'Cannot close the last pane'
  ) {
    return workspaces;
  }

  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    return {
      ...ws,
      terminalTabs: ws.terminalTabs.map((tab) => {
        if (tab.id !== terminalTabId) return tab;
        return {
          ...tab,
          panes: tab.panes.map((p) => {
            if (p.id !== paneId) return p;
            return {
              ...p,
              capture: {
                ...p.capture,
                sessionId: captureSessionId,
                warning,
              },
            };
          }),
        };
      }),
      panes: ws.panes.map((p) => {
        if (p.id !== paneId) return p;
        return {
          ...p,
          capture: {
            ...p.capture,
            sessionId: captureSessionId,
            warning,
          },
        };
      }),
    };
  });
}

/**
 * Dismisses a CaptureWarning for a specific pane and session.
 * Affects only the exact target Capture warning matching warningId and captureSessionId.
 * Safely no-ops if target no longer exists.
 */
export function dismissCaptureWarningInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
  captureSessionId: string,
  warningId: string,
): LogicalWorkspace[] {
  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    return {
      ...ws,
      terminalTabs: ws.terminalTabs.map((tab) => {
        if (tab.id !== terminalTabId) return tab;
        return {
          ...tab,
          panes: tab.panes.map((p) => {
            if (p.id !== paneId) return p;
            if (
              p.capture.warning &&
              p.capture.warning.id === warningId &&
              p.capture.warning.captureSessionId === captureSessionId
            ) {
              return {
                ...p,
                capture: {
                  ...p.capture,
                  warning: null,
                },
              };
            }
            return p;
          }),
        };
      }),
      panes: ws.panes.map((p) => {
        if (p.id !== paneId) return p;
        if (
          p.capture.warning &&
          p.capture.warning.id === warningId &&
          p.capture.warning.captureSessionId === captureSessionId
        ) {
          return {
            ...p,
            capture: {
              ...p.capture,
              warning: null,
            },
          };
        }
        return p;
      }),
    };
  });
}

/**
 * Clears CaptureWarning for a specific pane.
 * If captureSessionId is provided, clears only if session matches.
 */
export function clearCaptureWarningInWorkspaces(
  workspaces: LogicalWorkspace[],
  workspaceId: string,
  terminalTabId: string,
  paneId: string,
  captureSessionId?: string,
): LogicalWorkspace[] {
  return workspaces.map((ws) => {
    if (ws.id !== workspaceId) return ws;
    return {
      ...ws,
      terminalTabs: ws.terminalTabs.map((tab) => {
        if (tab.id !== terminalTabId) return tab;
        return {
          ...tab,
          panes: tab.panes.map((p) => {
            if (p.id !== paneId) return p;
            if (
              captureSessionId === undefined ||
              p.capture.warning?.captureSessionId === captureSessionId ||
              p.capture.sessionId === captureSessionId
            ) {
              return {
                ...p,
                capture: {
                  ...p.capture,
                  warning: null,
                },
              };
            }
            return p;
          }),
        };
      }),
      panes: ws.panes.map((p) => {
        if (p.id !== paneId) return p;
        if (
          captureSessionId === undefined ||
          p.capture.warning?.captureSessionId === captureSessionId ||
          p.capture.sessionId === captureSessionId
        ) {
          return {
            ...p,
            capture: {
              ...p.capture,
              warning: null,
            },
          };
        }
        return p;
      }),
    };
  });
}

/**
 * Resolves the active CaptureWarning for a specific pane, verifying session alignment.
 */
export function getCaptureWarningForPane(
  workspace: LogicalWorkspace | null | undefined,
  terminalTabId: string,
  paneId: string,
  captureSessionId?: string,
): CaptureWarning | null {
  if (!workspace) return null;
  const tab = workspace.terminalTabs.find((t) => t.id === terminalTabId);
  const pane = tab
    ? tab.panes.find((p) => p.id === paneId)
    : workspace.panes.find((p) => p.id === paneId);

  const warning = pane?.capture?.warning ?? null;
  if (!warning) return null;

  if (
    !isCaptureWarningCode(warning.code) ||
    warning.message === 'Maximum of 6 panes per terminal tab' ||
    warning.message === 'Maximum of 2 panes per terminal tab' ||
    warning.message === 'Cannot close the last pane'
  ) {
    return null;
  }

  if (captureSessionId && warning.captureSessionId !== captureSessionId) {
    return null;
  }
  return warning;
}

/**
 * ============================================================================
 * Keyed Map Capture Warning Store (Independent domain store)
 * ============================================================================
 */
export class CaptureWarningMapStore {
  private map = new Map<CaptureWarningKey, CaptureWarning>();

  set(
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
    captureSessionId: string,
    warning: CaptureWarning,
  ): void {
    if (
      !warning ||
      typeof warning !== 'object' ||
      !isCaptureWarningCode(warning.code) ||
      !warning.captureSessionId ||
      warning.message === 'Maximum of 6 panes per terminal tab' ||
    warning.message === 'Maximum of 2 panes per terminal tab' ||
      warning.message === 'Cannot close the last pane'
    ) {
      return;
    }

    const key = buildCaptureWarningKey(
      workspaceId,
      terminalTabId,
      paneId,
      captureSessionId,
    );
    this.map.set(key, warning);
  }

  get(
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
    captureSessionId: string,
  ): CaptureWarning | null {
    const key = buildCaptureWarningKey(
      workspaceId,
      terminalTabId,
      paneId,
      captureSessionId,
    );
    const item = this.map.get(key) ?? null;
    if (
      item &&
      (!isCaptureWarningCode(item.code) ||
        item.message === 'Maximum of 6 panes per terminal tab' ||
        item.message === 'Maximum of 2 panes per terminal tab' ||
        item.message === 'Cannot close the last pane')
    ) {
      return null;
    }
    return item;
  }

  dismiss(
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
    captureSessionId: string,
    warningId: string,
  ): boolean {
    const key = buildCaptureWarningKey(
      workspaceId,
      terminalTabId,
      paneId,
      captureSessionId,
    );
    const existing = this.map.get(key);
    if (existing && existing.id === warningId) {
      this.map.delete(key);
      return true;
    }
    return false;
  }

  clear(
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
    captureSessionId?: string,
  ): void {
    if (captureSessionId) {
      const key = buildCaptureWarningKey(
        workspaceId,
        terminalTabId,
        paneId,
        captureSessionId,
      );
      this.map.delete(key);
    } else {
      this.clearForPane(workspaceId, terminalTabId, paneId);
    }
  }

  clearForPane(
    workspaceId: string,
    terminalTabId: string,
    paneId: string,
  ): void {
    const prefix = `${workspaceId}:${terminalTabId}:${paneId}:`;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
      }
    }
  }

  clearForTab(workspaceId: string, terminalTabId: string): void {
    const prefix = `${workspaceId}:${terminalTabId}:`;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
      }
    }
  }

  clearForWorkspace(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
      }
    }
  }

  size(): number {
    return this.map.size;
  }

  getAll(): CaptureWarning[] {
    return Array.from(this.map.values());
  }
}
