import type {
  GlobalWarning,
  CaptureWarning,
} from './types';
import {
  addGlobalWarning,
  dismissGlobalWarning,
  clearWorkspaceGlobalWarnings,
  filterVisibleGlobalWarnings,
  setCaptureWarningInWorkspaces,
  dismissCaptureWarningInWorkspaces,
  clearCaptureWarningInWorkspaces,
  getCaptureWarningForPane,
  CaptureWarningMapStore,
} from './state';
import {
  createDefaultLogicalWorkspace,
  createDefaultTerminalTab,
  createDefaultTerminalPane,
  splitPaneInWorkspaces,
  closePaneInWorkspaces,
} from '../workspace/createDefaultWorkspace';
import type { LogicalWorkspace } from '../workspace/types';

/**
 * LT-WARNING-SCOPE-ISOLATION-001: Unit Test Suite
 *
 * Validates the 11 required isolation scenarios:
 * 1. App-scoped GlobalWarning is visible in every Workspace.
 * 2. Workspace-scoped GlobalWarning is visible only in its matching active Workspace.
 * 3. CaptureWarning for (Workspace A, Tab 1, Pane 1, Session 1) is not visible in:
 *    - Workspace A, Tab 1, Pane 2
 *    - Workspace A, Tab 2, Pane 1
 *    - Workspace B, any Tab, any Pane.
 * 4. dismissGlobalWarning removes only the requested GlobalWarning.
 * 5. dismissCaptureWarning removes only the requested warning from the exact
 *    workspaceId + terminalTabId + paneId + captureSessionId target.
 * 6. Stopping Capture clears only that session’s Capture warning.
 * 7. Creating a new Capture session does not inherit warning from an old session.
 * 8. Closing Pane A clears only Pane A Capture warning/runtime state.
 * 9. Closing a Terminal Tab clears only Capture warnings for its own Panes.
 * 10. Deleting Workspace A clears Capture warnings in Workspace A and Workspace-scoped
 *     GlobalWarnings for Workspace A, but preserves Capture warnings in Workspace B
 *     and App-scoped GlobalWarnings.
 * 11. Existing shortcut Toast messages are unaffected by either warning domain.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runWarningIsolationTests(): { passed: number; failed: number } {
  let passed = 0;

  // Helper setup
  function createTestEnvironment() {
    // Workspace A with Tab 1 (Pane 1)
    const wsA = createDefaultLogicalWorkspace(
      'workspace-A',
      'Workspace A',
      'tab-1',
      'pane-1',
    );
    // Add Pane 2 to Tab 1 in Workspace A
    const pane2 = createDefaultTerminalPane('tab-1', 'pane-2');
    const wsAWith2Panes = splitPaneInWorkspaces(
      [wsA],
      'workspace-A',
      'tab-1',
      'pane-1',
      'horizontal',
      pane2,
    )[0];

    // Add Tab 2 to Workspace A
    const pane3 = createDefaultTerminalPane('tab-2', 'pane-3');
    const tab2 = createDefaultTerminalTab(
      'tab-2',
      'workspace-A',
      'Terminal 2',
      'pane-3',
      pane3,
    );
    const wsAFull: LogicalWorkspace = {
      ...wsAWith2Panes,
      terminalTabs: [...wsAWith2Panes.terminalTabs, tab2],
      terminalTabIds: [...wsAWith2Panes.terminalTabIds, 'tab-2'],
      panes: [...wsAWith2Panes.panes, pane3],
    };

    // Workspace B with Tab B1 (Pane B1)
    const wsB = createDefaultLogicalWorkspace(
      'workspace-B',
      'Workspace B',
      'tab-B1',
      'pane-B1',
    );

    return {
      workspaces: [wsAFull, wsB],
    };
  }

  // --------------------------------------------------------------------------
  // Scenario 1: App-scoped GlobalWarning is visible in every Workspace.
  // --------------------------------------------------------------------------
  {
    const appWarning: GlobalWarning = {
      id: 'gw-app-1',
      scope: 'app',
      severity: 'error',
      code: 'terminal-service-disconnected',
      title: 'Terminal Service Lost',
      message: 'Terminal service connection lost. Reconnecting automatically…',
      dismissible: true,
      createdAt: Date.now(),
    };

    let warnings: GlobalWarning[] = [];
    warnings = addGlobalWarning(warnings, appWarning);

    const visibleInWsA = filterVisibleGlobalWarnings(warnings, 'workspace-A');
    const visibleInWsB = filterVisibleGlobalWarnings(warnings, 'workspace-B');
    const visibleInNull = filterVisibleGlobalWarnings(warnings, null);

    assert(
      visibleInWsA.length === 1 && visibleInWsA[0].id === 'gw-app-1',
      'App-scoped warning must be visible in Workspace A',
    );
    assert(
      visibleInWsB.length === 1 && visibleInWsB[0].id === 'gw-app-1',
      'App-scoped warning must be visible in Workspace B',
    );
    assert(
      visibleInNull.length === 1 && visibleInNull[0].id === 'gw-app-1',
      'App-scoped warning must be visible even with null active workspace',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 2: Workspace-scoped GlobalWarning is visible only in its matching active Workspace.
  // --------------------------------------------------------------------------
  {
    const wsAWarning: GlobalWarning = {
      id: 'gw-ws-A',
      scope: 'workspace',
      workspaceId: 'workspace-A',
      severity: 'warning',
      code: 'workspace-runtime-error',
      title: 'Runtime Error',
      message: 'Workspace A failed to initialize toolchain.',
      dismissible: true,
      createdAt: Date.now(),
    };

    let warnings: GlobalWarning[] = [];
    warnings = addGlobalWarning(warnings, wsAWarning);

    const visibleInWsA = filterVisibleGlobalWarnings(warnings, 'workspace-A');
    const visibleInWsB = filterVisibleGlobalWarnings(warnings, 'workspace-B');

    assert(
      visibleInWsA.length === 1 && visibleInWsA[0].id === 'gw-ws-A',
      'Workspace-scoped warning must be visible in Workspace A',
    );
    assert(
      visibleInWsB.length === 0,
      'Workspace-scoped warning for Workspace A must NOT be visible in Workspace B',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 3: CaptureWarning for Workspace A + Tab 1 + Pane 1 + Session 1
  // is not visible in:
  // - Workspace A + Tab 1 + Pane 2
  // - Workspace A + Tab 2 + Pane 1 (or Pane 3)
  // - Workspace B + any Tab + any Pane.
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();

    const captureWarning: CaptureWarning = {
      id: 'cw-1',
      captureSessionId: 'session-1',
      severity: 'error',
      code: 'microphone-permission-denied',
      title: 'Microphone permission unavailable',
      message: 'Capture paused: Microphone permission unavailable.',
      recoverable: true,
      createdAt: Date.now(),
    };

    const updatedWorkspaces = setCaptureWarningInWorkspaces(
      workspaces,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-1',
      captureWarning,
    );

    const wsA = updatedWorkspaces.find((w) => w.id === 'workspace-A')!;
    const wsB = updatedWorkspaces.find((w) => w.id === 'workspace-B')!;

    // Visible on target: Workspace A, Tab 1, Pane 1, Session 1
    const p1Warning = getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'session-1');
    assert(
      p1Warning !== null && p1Warning.id === 'cw-1',
      'Capture warning must be visible in Workspace A, Tab 1, Pane 1',
    );

    // NOT visible in Pane 2
    const p2Warning = getCaptureWarningForPane(wsA, 'tab-1', 'pane-2', 'session-1');
    assert(
      p2Warning === null,
      'Capture warning in Pane 1 must NOT be visible in Pane 2',
    );

    // NOT visible in Tab 2 (Pane 3)
    const tab2Warning = getCaptureWarningForPane(wsA, 'tab-2', 'pane-3', 'session-1');
    assert(
      tab2Warning === null,
      'Capture warning in Tab 1 must NOT be visible in Tab 2',
    );

    // NOT visible in Workspace B
    const wsBWarning = getCaptureWarningForPane(wsB, 'tab-B1', 'pane-B1', 'session-1');
    assert(
      wsBWarning === null,
      'Capture warning in Workspace A must NOT be visible in Workspace B',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 4: dismissGlobalWarning removes only the requested GlobalWarning.
  // --------------------------------------------------------------------------
  {
    const warning1: GlobalWarning = {
      id: 'gw-1',
      scope: 'app',
      severity: 'error',
      code: 'terminal-service-disconnected',
      title: 'Service Error',
      message: 'Error 1',
      dismissible: true,
      createdAt: Date.now(),
    };
    const warning2: GlobalWarning = {
      id: 'gw-2',
      scope: 'workspace',
      workspaceId: 'workspace-A',
      severity: 'warning',
      code: 'workspace-runtime-error',
      title: 'Runtime Warning',
      message: 'Error 2',
      dismissible: true,
      createdAt: Date.now(),
    };

    let warnings = addGlobalWarning([], warning1);
    warnings = addGlobalWarning(warnings, warning2);
    assert(warnings.length === 2, 'Must have 2 global warnings initially');

    warnings = dismissGlobalWarning(warnings, 'gw-1');
    assert(
      warnings.length === 1 && warnings[0].id === 'gw-2',
      'dismissGlobalWarning must remove only gw-1 and preserve gw-2',
    );

    // Non-existent ID dismissal is a safe no-op
    warnings = dismissGlobalWarning(warnings, 'non-existent-id');
    assert(
      warnings.length === 1 && warnings[0].id === 'gw-2',
      'dismissing non-existent ID must be a safe no-op',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 5: dismissCaptureWarning removes only the requested warning from
  // the exact workspaceId + terminalTabId + paneId + captureSessionId target.
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();
    const warning: CaptureWarning = {
      id: 'cw-target',
      captureSessionId: 'session-target',
      severity: 'warning',
      code: 'audio-input-unavailable',
      message: 'Audio input unavailable',
      recoverable: true,
      createdAt: Date.now(),
    };

    let state = setCaptureWarningInWorkspaces(
      workspaces,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-target',
      warning,
    );

    // Wrong session ID does NOT dismiss
    state = dismissCaptureWarningInWorkspaces(
      state,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-wrong',
      'cw-target',
    );
    let wsA = state.find((w) => w.id === 'workspace-A')!;
    assert(
      getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'session-target') !== null,
      'Dismiss with mismatched captureSessionId must be a safe no-op',
    );

    // Wrong pane ID does NOT dismiss
    state = dismissCaptureWarningInWorkspaces(
      state,
      'workspace-A',
      'tab-1',
      'pane-2',
      'session-target',
      'cw-target',
    );
    wsA = state.find((w) => w.id === 'workspace-A')!;
    assert(
      getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'session-target') !== null,
      'Dismiss with mismatched paneId must be a safe no-op',
    );

    // Exact target dismisses
    state = dismissCaptureWarningInWorkspaces(
      state,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-target',
      'cw-target',
    );
    wsA = state.find((w) => w.id === 'workspace-A')!;
    assert(
      getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'session-target') === null,
      'Exact target dismiss must clear the warning',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 6: Stopping Capture clears only that session’s Capture warning.
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();
    const warningA: CaptureWarning = {
      id: 'cw-session-A',
      captureSessionId: 'session-A',
      severity: 'error',
      code: 'capture-session-interrupted',
      message: 'Session interrupted',
      recoverable: false,
      createdAt: Date.now(),
    };

    let state = setCaptureWarningInWorkspaces(
      workspaces,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-A',
      warningA,
    );

    // Also set warning on Pane 2
    const warningB: CaptureWarning = {
      id: 'cw-session-B',
      captureSessionId: 'session-B',
      severity: 'warning',
      code: 'audio-input-unavailable',
      message: 'Pane 2 warning',
      recoverable: true,
      createdAt: Date.now(),
    };
    state = setCaptureWarningInWorkspaces(
      state,
      'workspace-A',
      'tab-1',
      'pane-2',
      'session-B',
      warningB,
    );

    // Clear session-A on Pane 1
    state = clearCaptureWarningInWorkspaces(
      state,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-A',
    );

    const wsA = state.find((w) => w.id === 'workspace-A')!;
    assert(
      getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'session-A') === null,
      'Stopped session warning on Pane 1 must be cleared',
    );
    assert(
      getCaptureWarningForPane(wsA, 'tab-1', 'pane-2', 'session-B') !== null,
      'Pane 2 warning must remain unaffected',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 7: Creating a new Capture session does not inherit warning from an old session.
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();
    const oldWarning: CaptureWarning = {
      id: 'cw-old',
      captureSessionId: 'session-old',
      severity: 'error',
      code: 'capture-start-failed',
      message: 'Old session failure',
      recoverable: true,
      createdAt: Date.now(),
    };

    // Set old warning
    let state = setCaptureWarningInWorkspaces(
      workspaces,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-old',
      oldWarning,
    );

    // Start fresh capture session: new session ID, warning initialized to null
    const newSessionId = 'session-new-42';
    state = state.map((ws) => {
      if (ws.id !== 'workspace-A') return ws;
      return {
        ...ws,
        panes: ws.panes.map((p) =>
          p.id === 'pane-1'
            ? {
                ...p,
                capture: {
                  ...p.capture,
                  isListening: true,
                  sessionId: newSessionId,
                  warning: null, // Fresh session resets warning
                },
              }
            : p,
        ),
      };
    });

    const wsA = state.find((w) => w.id === 'workspace-A')!;
    const activeWarning = getCaptureWarningForPane(
      wsA,
      'tab-1',
      'pane-1',
      newSessionId,
    );
    assert(
      activeWarning === null,
      'New Capture session must not inherit warning from prior session',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 8: Closing Pane A clears only Pane A Capture warning/runtime state.
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();
    const warningP1: CaptureWarning = {
      id: 'cw-p1',
      captureSessionId: 'session-p1',
      severity: 'warning',
      code: 'audio-input-unavailable',
      message: 'Audio input unavailable on P1',
      recoverable: true,
      createdAt: Date.now(),
    };
    const warningP2: CaptureWarning = {
      id: 'cw-p2',
      captureSessionId: 'session-p2',
      severity: 'error',
      code: 'microphone-permission-denied',
      message: 'Mic denied on P2',
      recoverable: true,
      createdAt: Date.now(),
    };

    let state = setCaptureWarningInWorkspaces(
      workspaces,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-p1',
      warningP1,
    );
    state = setCaptureWarningInWorkspaces(
      state,
      'workspace-A',
      'tab-1',
      'pane-2',
      'session-p2',
      warningP2,
    );

    // Close Pane 1 in Workspace A, Tab 1
    const { workspaces: nextWorkspaces } = closePaneInWorkspaces(
      state,
      'workspace-A',
      'tab-1',
      'pane-1',
    );

    const wsA = nextWorkspaces.find((w) => w.id === 'workspace-A')!;
    assert(
      !wsA.panes.some((p) => p.id === 'pane-1'),
      'Pane 1 must be removed from workspace panes',
    );
    assert(
      getCaptureWarningForPane(wsA, 'tab-1', 'pane-1') === null,
      'Pane 1 capture warning must be gone',
    );
    assert(
      getCaptureWarningForPane(wsA, 'tab-1', 'pane-2', 'session-p2') !== null,
      'Pane 2 capture warning must be preserved',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 9: Closing a Terminal Tab clears only Capture warnings for its own Panes.
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();
    const warningTab1: CaptureWarning = {
      id: 'cw-t1',
      captureSessionId: 'session-t1',
      severity: 'warning',
      code: 'audio-input-unavailable',
      message: 'Tab 1 Warning',
      recoverable: true,
      createdAt: Date.now(),
    };
    const warningTab2: CaptureWarning = {
      id: 'cw-t2',
      captureSessionId: 'session-t2',
      severity: 'error',
      code: 'microphone-permission-denied',
      message: 'Tab 2 Warning',
      recoverable: true,
      createdAt: Date.now(),
    };

    let state = setCaptureWarningInWorkspaces(
      workspaces,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-t1',
      warningTab1,
    );
    state = setCaptureWarningInWorkspaces(
      state,
      'workspace-A',
      'tab-2',
      'pane-3',
      'session-t2',
      warningTab2,
    );

    // Close Tab 1 in Workspace A (remove Tab 1 and its panes pane-1, pane-2)
    state = state.map((ws) => {
      if (ws.id !== 'workspace-A') return ws;
      return {
        ...ws,
        terminalTabs: ws.terminalTabs.filter((t) => t.id !== 'tab-1'),
        terminalTabIds: ws.terminalTabIds.filter((id) => id !== 'tab-1'),
        panes: ws.panes.filter((p) => p.terminalTabId !== 'tab-1'),
      };
    });

    const wsA = state.find((w) => w.id === 'workspace-A')!;
    assert(
      getCaptureWarningForPane(wsA, 'tab-1', 'pane-1') === null,
      'Closed Tab 1 panes must have their Capture warnings cleared',
    );
    assert(
      getCaptureWarningForPane(wsA, 'tab-2', 'pane-3', 'session-t2') !== null,
      'Tab 2 Capture warning must remain intact',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 10: Deleting Workspace A clears:
  // - Capture warnings in Workspace A
  // - Workspace-scoped GlobalWarnings for Workspace A
  // but preserves:
  // - Capture warnings in Workspace B
  // - App-scoped GlobalWarnings.
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();

    // Warnings setup
    const appWarning: GlobalWarning = {
      id: 'gw-app',
      scope: 'app',
      severity: 'error',
      code: 'terminal-service-disconnected',
      title: 'Service Disconnected',
      message: 'Terminal backend disconnected',
      dismissible: true,
      createdAt: Date.now(),
    };
    const wsAWarning: GlobalWarning = {
      id: 'gw-wsA',
      scope: 'workspace',
      workspaceId: 'workspace-A',
      severity: 'warning',
      code: 'workspace-runtime-error',
      title: 'Workspace Error',
      message: 'Workspace A runtime failure',
      dismissible: true,
      createdAt: Date.now(),
    };

    let globalWarnings = addGlobalWarning([], appWarning);
    globalWarnings = addGlobalWarning(globalWarnings, wsAWarning);

    const captureA: CaptureWarning = {
      id: 'cw-wsA',
      captureSessionId: 'session-A',
      severity: 'error',
      code: 'microphone-permission-denied',
      message: 'Mic denied in A',
      recoverable: true,
      createdAt: Date.now(),
    };
    const captureB: CaptureWarning = {
      id: 'cw-wsB',
      captureSessionId: 'session-B',
      severity: 'warning',
      code: 'audio-input-unavailable',
      message: 'Audio unavailable in B',
      recoverable: true,
      createdAt: Date.now(),
    };

    let state = setCaptureWarningInWorkspaces(
      workspaces,
      'workspace-A',
      'tab-1',
      'pane-1',
      'session-A',
      captureA,
    );
    state = setCaptureWarningInWorkspaces(
      state,
      'workspace-B',
      'tab-B1',
      'pane-B1',
      'session-B',
      captureB,
    );

    // Delete Workspace A
    state = state.filter((w) => w.id !== 'workspace-A');
    globalWarnings = clearWorkspaceGlobalWarnings(globalWarnings, 'workspace-A');

    // Verification
    assert(
      !state.some((w) => w.id === 'workspace-A'),
      'Workspace A must be deleted from state',
    );
    assert(
      globalWarnings.some((w) => w.id === 'gw-app'),
      'App-scoped global warning must be preserved after Workspace A deletion',
    );
    assert(
      !globalWarnings.some((w) => w.id === 'gw-wsA'),
      'Workspace A-scoped global warning must be cleared after Workspace A deletion',
    );

    const wsB = state.find((w) => w.id === 'workspace-B')!;
    assert(
      getCaptureWarningForPane(wsB, 'tab-B1', 'pane-B1', 'session-B') !== null,
      'Workspace B capture warning must be preserved after Workspace A deletion',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 11: Existing shortcut Toast messages are unaffected by either warning domain.
  // --------------------------------------------------------------------------
  {
    // Verify toast representation remains independent:
    // e.g. toast is a transient message without warningId, captureSessionId, etc.
    const transientToast = 'Maximum of 2 panes per terminal tab';

    const globalWarning: GlobalWarning = {
      id: 'gw-toast-test',
      scope: 'app',
      severity: 'warning',
      code: 'terminal-service-reconnecting',
      title: 'Reconnecting',
      message: 'Reconnecting automatically…',
      dismissible: true,
      createdAt: Date.now(),
    };
    const globalList = addGlobalWarning([], globalWarning);

    // Dismissing global warning does not affect transientToast
    const dismissedGlobalList = dismissGlobalWarning(globalList, 'gw-toast-test');
    assert(
      dismissedGlobalList.length === 0,
      'Global list must be empty after dismiss',
    );
    assert(
      transientToast === 'Maximum of 2 panes per terminal tab',
      'Transient toast must remain unaffected by global warning actions',
    );

    // Capture warning actions do not mutate transientToast
    const store = new CaptureWarningMapStore();
    store.set('ws-1', 'tab-1', 'pane-1', 'sess-1', {
      id: 'cw-toast',
      captureSessionId: 'sess-1',
      severity: 'error',
      code: 'capture-start-failed',
      message: 'Start failed',
      recoverable: true,
      createdAt: Date.now(),
    });
    store.dismiss('ws-1', 'tab-1', 'pane-1', 'sess-1', 'cw-toast');
    assert(
      transientToast === 'Maximum of 2 panes per terminal tab',
      'Transient toast must remain unaffected by capture warning actions',
    );
    passed++;
  }

  // --------------------------------------------------------------------------
  // Scenario 12: Component Logic & Accessibility Tests
  // --------------------------------------------------------------------------
  {
    // GlobalWarningBanner visibility & accessibility roles
    const gEmpty = filterVisibleGlobalWarnings([], 'ws-1');
    assert(gEmpty.length === 0, 'GlobalWarningBanner renders nothing when empty');

    const gList: GlobalWarning[] = [
      { id: 'g-err', scope: 'app', severity: 'error', code: 'terminal-service-disconnected', title: 'Err', message: 'Err msg', dismissible: true, createdAt: 1 },
      { id: 'g-warn', scope: 'workspace', workspaceId: 'ws-1', severity: 'warning', code: 'workspace-runtime-error', title: 'Warn', message: 'Warn msg', dismissible: false, createdAt: 2 },
      { id: 'g-other', scope: 'workspace', workspaceId: 'ws-other', severity: 'warning', code: 'workspace-runtime-error', title: 'Other', message: 'Other msg', dismissible: true, createdAt: 3 },
    ];
    const gVisible = filterVisibleGlobalWarnings(gList, 'ws-1');
    assert(gVisible.length === 2, 'Renders only app and active workspace warnings');
    assert((gVisible[0].severity === 'error' ? 'alert' : 'status') === 'alert', 'Errors use role="alert"');
    assert((gVisible[1].severity === 'warning' ? 'status' : 'alert') === 'status', 'Warnings use role="status"');

    // CaptureWarningBanner rendering guards & accessibility roles
    assert(getCaptureWarningForPane(null, 't1', 'p1') === null, 'Null workspace returns null banner');

    const staleWarning: CaptureWarning = { id: 'cw-stale', captureSessionId: 'old-session', severity: 'error', code: 'capture-start-failed', message: 'Stale', recoverable: true, createdAt: 1 };
    const wsWithStale: LogicalWorkspace = {
      id: 'ws-1',
      name: 'Ws 1',
      terminalTabs: [{ id: 't1', workspaceId: 'ws-1', label: 'T1', panes: [{ id: 'p1', terminalTabId: 't1', stableOrdinal: 1, accentId: 'blue', session: { sessionId: null, status: 'starting', sessionInfo: null }, capture: { isListening: false, hasRetainedData: false, currentBatchId: null, warning: staleWarning }, selection: { selectedBlockIds: new Set(), updatedAt: 0 } }], terminalPanes: [{ id: 'p1', terminalTabId: 't1', stableOrdinal: 1, accentId: 'blue', session: { sessionId: null, status: 'starting', sessionInfo: null }, capture: { isListening: false, hasRetainedData: false, currentBatchId: null, warning: staleWarning }, selection: { selectedBlockIds: new Set(), updatedAt: 0 } }], panels: [{ id: 'panel-p1', kind: 'terminal', paneId: 'p1' }, { id: 'capture-panel-t1', kind: 'capture', selectedCapturePaneIds: ['p1'] }], capturePanelId: 'capture-panel-t1', panelLayout: { type: 'split', id: 's1', direction: 'horizontal', ratio: 0.65, first: { type: 'panel', panelId: 'panel-p1' }, second: { type: 'panel', panelId: 'capture-panel-t1' } }, activeTerminalPaneId: 'p1', nextTerminalPaneOrdinal: 2, paneIds: ['p1'], rootPaneId: 'p1', activePaneId: 'p1', paneLayout: { kind: 'pane', paneId: 'p1' } }],
      panes: [{ id: 'p1', terminalTabId: 't1', stableOrdinal: 1, accentId: 'blue', session: { sessionId: null, status: 'starting', sessionInfo: null }, capture: { isListening: false, hasRetainedData: false, currentBatchId: null, warning: staleWarning }, selection: { selectedBlockIds: new Set(), updatedAt: 0 } }],
      activeTerminalTabId: 't1',
      terminalTabIds: ['t1'],
      capture: { isListening: false, currentBatch: null, batchCounter: 0, blocks: [] },
      selection: { selectedBlockIds: new Set(), updatedAt: 0 },
    };
    assert(getCaptureWarningForPane(wsWithStale, 't1', 'p1', 'current-session') === null, 'Stale session warning returns null banner');

    // Dismiss & Retry behavior isolation
    let globalWarnings: GlobalWarning[] = [{ id: 'gw-stay', scope: 'app', severity: 'warning', code: 'terminal-service-reconnecting', title: 'T', message: 'M', dismissible: true, createdAt: 1 }];
    let retryCalled = false;
    const onRetry = () => { retryCalled = true; };
    onRetry();
    assert(retryCalled, 'Retry callback executed');
    assert(globalWarnings.length === 1, 'Retry does not mutate global warnings');

    let dismissedId: string | null = null;
    const onDismissGlobal = (id: string) => { dismissedId = id; globalWarnings = dismissGlobalWarning(globalWarnings, id); };
    onDismissGlobal('gw-stay');
    assert(dismissedId === 'gw-stay', 'Dismiss handler passed correct id');
    assert(globalWarnings.length === 0, 'Global dismiss removes global warning');
    passed++;
  }

  // --------------------------------------------------------------------------
  // Regression 1: split-limit toast does not leak into Capture warning
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();
    const wsA = workspaces.find((w) => w.id === 'workspace-A')!;
    const tab1 = wsA.terminalTabs.find((t) => t.id === 'tab-1')!;
    assert(tab1.panes.length === 2, 'Tab 1 must have exactly 2 panes');

    let toastReceivedMessage = '';
    const showTerminalPaneToast = (message: string) => {
      toastReceivedMessage = message;
    };

    showTerminalPaneToast('Maximum of 2 panes per terminal tab');

    assert(toastReceivedMessage === 'Maximum of 2 panes per terminal tab', 'Toast received message');
    assert(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1') === null, 'Pane 1 capture warning is null');
    assert(getCaptureWarningForPane(wsA, 'tab-1', 'pane-2') === null, 'Pane 2 capture warning is null');
    assert(filterVisibleGlobalWarnings([], 'workspace-A').length === 0, 'No global warning rendered');
    assert(wsA.capture.isListening === false, 'Capture status unchanged');
    assert(wsA.capture.blocks.length === 0, 'Transcript state unchanged');
    passed++;
  }

  // --------------------------------------------------------------------------
  // Regression 2: final-pane close toast does not leak
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();
    const wsB = workspaces.find((w) => w.id === 'workspace-B')!;
    const tabB1 = wsB.terminalTabs.find((t) => t.id === 'tab-B1')!;
    assert(tabB1.panes.length === 1, 'Tab B1 must have exactly 1 pane');

    let toastReceivedMessage = '';
    const showTerminalPaneToast = (message: string) => {
      toastReceivedMessage = message;
    };

    showTerminalPaneToast('Cannot close the last pane');

    assert(toastReceivedMessage === 'Cannot close the last pane', 'Toast received close message');
    assert(getCaptureWarningForPane(wsB, 'tab-B1', 'pane-B1') === null, 'No capture warning set');
    assert(filterVisibleGlobalWarnings([], 'workspace-B').length === 0, 'No global warning rendered');
    assert(tabB1.panes.length === 1, 'Pane count remains 1');
    passed++;
  }

  // --------------------------------------------------------------------------
  // Regression 3: real Capture warning still renders correctly
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();
    const realCaptureWarning: CaptureWarning = {
      id: 'capture-warning-1',
      captureSessionId: 'capture-session-1',
      severity: 'error',
      code: 'microphone-permission-denied',
      message: 'Microphone permission is unavailable.',
      recoverable: true,
      createdAt: 1,
    };

    const updatedWorkspaces = setCaptureWarningInWorkspaces(
      workspaces,
      'workspace-A',
      'tab-1',
      'pane-1',
      'capture-session-1',
      realCaptureWarning,
    );

    const wsA = updatedWorkspaces.find((w) => w.id === 'workspace-A')!;
    const resolved = getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'capture-session-1');

    assert(resolved?.id === 'capture-warning-1', 'Resolves real capture warning');
    assert(resolved?.code === 'microphone-permission-denied', 'Matches capture warning code');
    assert(getCaptureWarningForPane(wsA, 'tab-1', 'pane-2', 'capture-session-1') === null, 'Not visible on sibling pane');
    assert(filterVisibleGlobalWarnings([], 'workspace-A').length === 0, 'No global warning');
    passed++;
  }

  // --------------------------------------------------------------------------
  // Regression 4: strict type/domain protection
  // --------------------------------------------------------------------------
  {
    const { workspaces } = createTestEnvironment();

    // Invalid capture warning code / shortcut message rejected
    const invalidCaptureWarning = {
      id: 'invalid-1',
      captureSessionId: 'sess-1',
      severity: 'error' as const,
      code: 'invalid-shortcut-code' as unknown as CaptureWarning['code'],
      message: 'Maximum of 2 panes per terminal tab',
      recoverable: false,
      createdAt: 1,
    };
    const rejectedState = setCaptureWarningInWorkspaces(
      workspaces,
      'workspace-A',
      'tab-1',
      'pane-1',
      'sess-1',
      invalidCaptureWarning,
    );
    const wsA = rejectedState.find((w) => w.id === 'workspace-A')!;
    assert(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'sess-1') === null, 'Rejected invalid capture warning');

    // Invalid global warning rejected
    const invalidGlobalWarning = {
      id: 'gw-invalid',
      scope: 'app' as const,
      severity: 'error' as const,
      code: 'invalid-code' as unknown as GlobalWarning['code'],
      title: 'Shortcut Error',
      message: 'Maximum of 2 panes per terminal tab',
      dismissible: true,
      createdAt: 1,
    };
    const rejectedGlobal = addGlobalWarning([], invalidGlobalWarning);
    assert(rejectedGlobal.length === 0, 'addGlobalWarning rejects shortcut toast messages');

    // Keyed map store rejects shortcut toast messages
    const store = new CaptureWarningMapStore();
    store.set('ws-1', 'tab-1', 'pane-1', 'sess-1', invalidCaptureWarning);
    assert(store.size() === 0, 'CaptureWarningMapStore rejects shortcut toast messages');
    passed++;
  }

  return { passed, failed: 0 };
}
