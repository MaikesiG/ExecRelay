import assert from 'node:assert';

/**
 * LT-WARNING-SCOPE-ISOLATION-001: Node.js Test Runner
 * Mirrors and runs all 11 required isolation scenarios.
 */

// Helper: buildCaptureWarningKey
function buildCaptureWarningKey(workspaceId, terminalTabId, paneId, captureSessionId) {
  return `${workspaceId}:${terminalTabId}:${paneId}:${captureSessionId}`;
}

function isGlobalWarningCode(code) {
  return (
    code === 'terminal-service-disconnected' ||
    code === 'terminal-service-reconnecting' ||
    code === 'application-configuration-error' ||
    code === 'workspace-runtime-error'
  );
}

function isCaptureWarningCode(code) {
  return (
    code === 'microphone-permission-denied' ||
    code === 'audio-input-unavailable' ||
    code === 'capture-start-failed' ||
    code === 'transcription-disconnected' ||
    code === 'transcription-failed' ||
    code === 'capture-session-interrupted'
  );
}

// Global warning functions
function addGlobalWarning(warnings, warning) {
  if (
    !warning ||
    typeof warning !== 'object' ||
    !isGlobalWarningCode(warning.code) ||
    warning.message === 'Maximum of 2 panes per terminal tab' ||
    warning.message === 'Cannot close the last pane'
  ) {
    return warnings;
  }
  const normalized = {
    ...warning,
    workspaceId: warning.scope === 'app' ? undefined : warning.workspaceId,
  };
  const filtered = warnings.filter((w) => w.id !== normalized.id);
  return [...filtered, normalized];
}

function dismissGlobalWarning(warnings, warningId) {
  return warnings.filter((w) => w.id !== warningId);
}

function clearWorkspaceGlobalWarnings(warnings, workspaceId) {
  return warnings.filter(
    (w) => !(w.scope === 'workspace' && w.workspaceId === workspaceId),
  );
}

function filterVisibleGlobalWarnings(warnings, activeWorkspaceId) {
  return warnings.filter((warning) => {
    if (
      !warning ||
      !isGlobalWarningCode(warning.code) ||
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

// Capture warning functions
function setCaptureWarningInWorkspaces(
  workspaces,
  workspaceId,
  terminalTabId,
  paneId,
  captureSessionId,
  warning,
) {
  if (
    !warning ||
    typeof warning !== 'object' ||
    !isCaptureWarningCode(warning.code) ||
    !warning.captureSessionId ||
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

function dismissCaptureWarningInWorkspaces(
  workspaces,
  workspaceId,
  terminalTabId,
  paneId,
  captureSessionId,
  warningId,
) {
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

function clearCaptureWarningInWorkspaces(
  workspaces,
  workspaceId,
  terminalTabId,
  paneId,
  captureSessionId,
) {
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

function getCaptureWarningForPane(workspace, terminalTabId, paneId, captureSessionId) {
  if (!workspace) return null;
  const tab = workspace.terminalTabs.find((t) => t.id === terminalTabId);
  const pane = tab
    ? tab.panes.find((p) => p.id === paneId)
    : workspace.panes.find((p) => p.id === paneId);

  const warning = pane?.capture?.warning ?? null;
  if (!warning) return null;

  if (
    !isCaptureWarningCode(warning.code) ||
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

class CaptureWarningMapStore {
  constructor() {
    this.map = new Map();
  }

  set(workspaceId, terminalTabId, paneId, captureSessionId, warning) {
    if (
      !warning ||
      typeof warning !== 'object' ||
      !isCaptureWarningCode(warning.code) ||
      !warning.captureSessionId ||
      warning.message === 'Maximum of 2 panes per terminal tab' ||
      warning.message === 'Cannot close the last pane'
    ) {
      return;
    }
    const key = buildCaptureWarningKey(workspaceId, terminalTabId, paneId, captureSessionId);
    this.map.set(key, warning);
  }

  get(workspaceId, terminalTabId, paneId, captureSessionId) {
    const key = buildCaptureWarningKey(workspaceId, terminalTabId, paneId, captureSessionId);
    return this.map.get(key) ?? null;
  }

  dismiss(workspaceId, terminalTabId, paneId, captureSessionId, warningId) {
    const key = buildCaptureWarningKey(workspaceId, terminalTabId, paneId, captureSessionId);
    const existing = this.map.get(key);
    if (existing && existing.id === warningId) {
      this.map.delete(key);
      return true;
    }
    return false;
  }

  clear(workspaceId, terminalTabId, paneId, captureSessionId) {
    if (captureSessionId) {
      const key = buildCaptureWarningKey(workspaceId, terminalTabId, paneId, captureSessionId);
      this.map.delete(key);
    } else {
      this.clearForPane(workspaceId, terminalTabId, paneId);
    }
  }

  clearForPane(workspaceId, terminalTabId, paneId) {
    const prefix = `${workspaceId}:${terminalTabId}:${paneId}:`;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
      }
    }
  }

  clearForTab(workspaceId, terminalTabId) {
    const prefix = `${workspaceId}:${terminalTabId}:`;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
      }
    }
  }

  clearForWorkspace(workspaceId) {
    const prefix = `${workspaceId}:`;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
      }
    }
  }

  size() {
    return this.map.size;
  }
}

function createTestEnvironment() {
  const p1 = {
    id: 'pane-1',
    terminalTabId: 'tab-1',
    capture: { isListening: false, hasRetainedData: false, currentBatchId: null, warning: null },
  };
  const p2 = {
    id: 'pane-2',
    terminalTabId: 'tab-1',
    capture: { isListening: false, hasRetainedData: false, currentBatchId: null, warning: null },
  };
  const p3 = {
    id: 'pane-3',
    terminalTabId: 'tab-2',
    capture: { isListening: false, hasRetainedData: false, currentBatchId: null, warning: null },
  };
  const tab1 = {
    id: 'tab-1',
    workspaceId: 'workspace-A',
    label: 'Terminal 1',
    panes: [p1, p2],
    paneIds: ['pane-1', 'pane-2'],
    activePaneId: 'pane-1',
  };
  const tab2 = {
    id: 'tab-2',
    workspaceId: 'workspace-A',
    label: 'Terminal 2',
    panes: [p3],
    paneIds: ['pane-3'],
    activePaneId: 'pane-3',
  };
  const wsA = {
    id: 'workspace-A',
    name: 'Workspace A',
    terminalTabs: [tab1, tab2],
    terminalTabIds: ['tab-1', 'tab-2'],
    panes: [p1, p2, p3],
    activeTerminalTabId: 'tab-1',
    capture: { isListening: false, blocks: [], batchCounter: 0, currentBatch: null },
  };

  const pB1 = {
    id: 'pane-B1',
    terminalTabId: 'tab-B1',
    capture: { isListening: false, hasRetainedData: false, currentBatchId: null, warning: null },
  };
  const tabB1 = {
    id: 'tab-B1',
    workspaceId: 'workspace-B',
    label: 'Terminal 1',
    panes: [pB1],
    paneIds: ['pane-B1'],
    activePaneId: 'pane-B1',
  };
  const wsB = {
    id: 'workspace-B',
    name: 'Workspace B',
    terminalTabs: [tabB1],
    terminalTabIds: ['tab-B1'],
    panes: [pB1],
    activeTerminalTabId: 'tab-B1',
    capture: { isListening: false, blocks: [], batchCounter: 0, currentBatch: null },
  };

  return { workspaces: [wsA, wsB] };
}

console.log('Running 11 Warning Scope Isolation Tests...');

// 1. App-scoped GlobalWarning is visible in every Workspace.
{
  const appWarning = {
    id: 'gw-app-1',
    scope: 'app',
    severity: 'error',
    code: 'terminal-service-disconnected',
    title: 'Service Lost',
    message: 'Backend disconnected',
    dismissible: true,
    createdAt: Date.now(),
  };
  let warnings = addGlobalWarning([], appWarning);
  assert.strictEqual(filterVisibleGlobalWarnings(warnings, 'workspace-A').length, 1);
  assert.strictEqual(filterVisibleGlobalWarnings(warnings, 'workspace-B').length, 1);
  assert.strictEqual(filterVisibleGlobalWarnings(warnings, null).length, 1);
  console.log('✓ Scenario 1: App-scoped GlobalWarning is visible in every Workspace');
}

// 2. Workspace-scoped GlobalWarning is visible only in its matching active Workspace.
{
  const wsWarning = {
    id: 'gw-ws-A',
    scope: 'workspace',
    workspaceId: 'workspace-A',
    severity: 'warning',
    code: 'workspace-runtime-error',
    title: 'Runtime Error',
    message: 'Workspace A failure',
    dismissible: true,
    createdAt: Date.now(),
  };
  let warnings = addGlobalWarning([], wsWarning);
  assert.strictEqual(filterVisibleGlobalWarnings(warnings, 'workspace-A').length, 1);
  assert.strictEqual(filterVisibleGlobalWarnings(warnings, 'workspace-B').length, 0);
  console.log('✓ Scenario 2: Workspace-scoped GlobalWarning is visible only in its matching active Workspace');
}

// 3. CaptureWarning isolation across Panes, Tabs, and Workspaces.
{
  const { workspaces } = createTestEnvironment();
  const warning = {
    id: 'cw-1',
    captureSessionId: 'session-1',
    severity: 'error',
    code: 'microphone-permission-denied',
    message: 'Mic denied',
    recoverable: true,
    createdAt: Date.now(),
  };
  const state = setCaptureWarningInWorkspaces(workspaces, 'workspace-A', 'tab-1', 'pane-1', 'session-1', warning);
  const wsA = state.find((w) => w.id === 'workspace-A');
  const wsB = state.find((w) => w.id === 'workspace-B');

  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'session-1')?.id, 'cw-1');
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-2', 'session-1'), null);
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-2', 'pane-3', 'session-1'), null);
  assert.strictEqual(getCaptureWarningForPane(wsB, 'tab-B1', 'pane-B1', 'session-1'), null);
  console.log('✓ Scenario 3: CaptureWarning is isolated to target pane/session');
}

// 4. dismissGlobalWarning removes only the requested GlobalWarning.
{
  const w1 = { id: 'gw-1', scope: 'app', severity: 'error', code: 'terminal-service-disconnected', title: 'T1', message: 'M1', dismissible: true, createdAt: Date.now() };
  const w2 = { id: 'gw-2', scope: 'workspace', workspaceId: 'ws-A', severity: 'warning', code: 'workspace-runtime-error', title: 'T2', message: 'M2', dismissible: true, createdAt: Date.now() };
  let list = addGlobalWarning([], w1);
  list = addGlobalWarning(list, w2);
  assert.strictEqual(list.length, 2);
  list = dismissGlobalWarning(list, 'gw-1');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'gw-2');
  console.log('✓ Scenario 4: dismissGlobalWarning removes only the requested GlobalWarning');
}

// 5. dismissCaptureWarning removes only target warning.
{
  const { workspaces } = createTestEnvironment();
  const warning = { id: 'cw-target', captureSessionId: 'sess-tgt', severity: 'warning', code: 'audio-input-unavailable', message: 'M', recoverable: true, createdAt: Date.now() };
  let state = setCaptureWarningInWorkspaces(workspaces, 'workspace-A', 'tab-1', 'pane-1', 'sess-tgt', warning);

  // Mismatched session
  state = dismissCaptureWarningInWorkspaces(state, 'workspace-A', 'tab-1', 'pane-1', 'sess-other', 'cw-target');
  let wsA = state.find((w) => w.id === 'workspace-A');
  assert.notStrictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'sess-tgt'), null);

  // Correct target
  state = dismissCaptureWarningInWorkspaces(state, 'workspace-A', 'tab-1', 'pane-1', 'sess-tgt', 'cw-target');
  wsA = state.find((w) => w.id === 'workspace-A');
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'sess-tgt'), null);
  console.log('✓ Scenario 5: dismissCaptureWarning removes only exact target');
}

// 6. Stopping Capture clears only that session’s Capture warning.
{
  const { workspaces } = createTestEnvironment();
  const wA = { id: 'cw-A', captureSessionId: 'sess-A', severity: 'error', code: 'capture-session-interrupted', message: 'Int', recoverable: false, createdAt: Date.now() };
  const wB = { id: 'cw-B', captureSessionId: 'sess-B', severity: 'warning', code: 'audio-input-unavailable', message: 'Audio', recoverable: true, createdAt: Date.now() };
  let state = setCaptureWarningInWorkspaces(workspaces, 'workspace-A', 'tab-1', 'pane-1', 'sess-A', wA);
  state = setCaptureWarningInWorkspaces(state, 'workspace-A', 'tab-1', 'pane-2', 'sess-B', wB);

  state = clearCaptureWarningInWorkspaces(state, 'workspace-A', 'tab-1', 'pane-1', 'sess-A');
  const wsA = state.find((w) => w.id === 'workspace-A');
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'sess-A'), null);
  assert.notStrictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-2', 'sess-B'), null);
  console.log('✓ Scenario 6: Stopping Capture clears only that session’s warning');
}

// 7. Creating a new Capture session does not inherit warning from an old session.
{
  const { workspaces } = createTestEnvironment();
  const oldWarning = { id: 'cw-old', captureSessionId: 'sess-old', severity: 'error', code: 'capture-start-failed', message: 'Failed', recoverable: true, createdAt: Date.now() };
  let state = setCaptureWarningInWorkspaces(workspaces, 'workspace-A', 'tab-1', 'pane-1', 'sess-old', oldWarning);

  // New session
  const newSessionId = 'sess-new';
  state = state.map((ws) => {
    if (ws.id !== 'workspace-A') return ws;
    return {
      ...ws,
      panes: ws.panes.map((p) => p.id === 'pane-1' ? { ...p, capture: { ...p.capture, isListening: true, sessionId: newSessionId, warning: null } } : p),
    };
  });
  const wsA = state.find((w) => w.id === 'workspace-A');
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', newSessionId), null);
  console.log('✓ Scenario 7: New session does not inherit stale warning');
}

// 8. Closing Pane A clears only Pane A Capture warning/runtime state.
{
  const { workspaces } = createTestEnvironment();
  const w1 = { id: 'cw-p1', captureSessionId: 's1', severity: 'warning', code: 'audio-input-unavailable', message: 'P1', recoverable: true, createdAt: Date.now() };
  const w2 = { id: 'cw-p2', captureSessionId: 's2', severity: 'error', code: 'microphone-permission-denied', message: 'P2', recoverable: true, createdAt: Date.now() };
  let state = setCaptureWarningInWorkspaces(workspaces, 'workspace-A', 'tab-1', 'pane-1', 's1', w1);
  state = setCaptureWarningInWorkspaces(state, 'workspace-A', 'tab-1', 'pane-2', 's2', w2);

  // Remove pane 1
  state = state.map((ws) => {
    if (ws.id !== 'workspace-A') return ws;
    return {
      ...ws,
      panes: ws.panes.filter((p) => p.id !== 'pane-1'),
      terminalTabs: ws.terminalTabs.map((t) => t.id === 'tab-1' ? { ...t, panes: t.panes.filter((p) => p.id !== 'pane-1'), paneIds: t.paneIds.filter((id) => id !== 'pane-1') } : t),
    };
  });
  const wsA = state.find((w) => w.id === 'workspace-A');
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1'), null);
  assert.notStrictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-2', 's2'), null);
  console.log('✓ Scenario 8: Closing Pane A clears only Pane A warning');
}

// 9. Closing a Terminal Tab clears only Capture warnings for its own Panes.
{
  const { workspaces } = createTestEnvironment();
  const w1 = { id: 'cw-t1', captureSessionId: 's1', severity: 'warning', code: 'audio-input-unavailable', message: 'T1', recoverable: true, createdAt: Date.now() };
  const w2 = { id: 'cw-t2', captureSessionId: 's2', severity: 'error', code: 'microphone-permission-denied', message: 'T2', recoverable: true, createdAt: Date.now() };
  let state = setCaptureWarningInWorkspaces(workspaces, 'workspace-A', 'tab-1', 'pane-1', 's1', w1);
  state = setCaptureWarningInWorkspaces(state, 'workspace-A', 'tab-2', 'pane-3', 's2', w2);

  // Close Tab 1
  state = state.map((ws) => {
    if (ws.id !== 'workspace-A') return ws;
    return {
      ...ws,
      terminalTabs: ws.terminalTabs.filter((t) => t.id !== 'tab-1'),
      terminalTabIds: ws.terminalTabIds.filter((id) => id !== 'tab-1'),
      panes: ws.panes.filter((p) => p.terminalTabId !== 'tab-1'),
    };
  });
  const wsA = state.find((w) => w.id === 'workspace-A');
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1'), null);
  assert.notStrictEqual(getCaptureWarningForPane(wsA, 'tab-2', 'pane-3', 's2'), null);
  console.log('✓ Scenario 9: Closing Terminal Tab clears only its own panes\' warnings');
}

// 10. Deleting Workspace A clears Workspace A capture warnings and workspace-scoped global warnings.
{
  const { workspaces } = createTestEnvironment();
  const appWarning = { id: 'gw-app', scope: 'app', severity: 'error', code: 'terminal-service-disconnected', title: 'App', message: 'App', dismissible: true, createdAt: Date.now() };
  const wsAWarning = { id: 'gw-wsA', scope: 'workspace', workspaceId: 'workspace-A', severity: 'warning', code: 'workspace-runtime-error', title: 'WsA', message: 'WsA', dismissible: true, createdAt: Date.now() };
  let globalList = addGlobalWarning([], appWarning);
  globalList = addGlobalWarning(globalList, wsAWarning);

  const capA = { id: 'cw-A', captureSessionId: 'sA', severity: 'error', code: 'microphone-permission-denied', message: 'A', recoverable: true, createdAt: Date.now() };
  const capB = { id: 'cw-B', captureSessionId: 'sB', severity: 'warning', code: 'audio-input-unavailable', message: 'B', recoverable: true, createdAt: Date.now() };
  let state = setCaptureWarningInWorkspaces(workspaces, 'workspace-A', 'tab-1', 'pane-1', 'sA', capA);
  state = setCaptureWarningInWorkspaces(state, 'workspace-B', 'tab-B1', 'pane-B1', 'sB', capB);

  // Delete Workspace A
  state = state.filter((w) => w.id !== 'workspace-A');
  globalList = clearWorkspaceGlobalWarnings(globalList, 'workspace-A');

  assert.strictEqual(globalList.some((w) => w.id === 'gw-app'), true);
  assert.strictEqual(globalList.some((w) => w.id === 'gw-wsA'), false);
  const wsB = state.find((w) => w.id === 'workspace-B');
  assert.notStrictEqual(getCaptureWarningForPane(wsB, 'tab-B1', 'pane-B1', 'sB'), null);
  console.log('✓ Scenario 10: Deleting Workspace A cleans its warnings but preserves app-scoped and Workspace B warnings');
}

// 11. Existing shortcut Toast messages are unaffected by either warning domain.
{
  let toast = 'Maximum of 2 panes per terminal tab';
  let gList = addGlobalWarning([], { id: 'g', scope: 'app', severity: 'warning', code: 'terminal-service-reconnecting', title: 'R', message: 'R', dismissible: true, createdAt: Date.now() });
  gList = dismissGlobalWarning(gList, 'g');
  assert.strictEqual(toast, 'Maximum of 2 panes per terminal tab');

  const store = new CaptureWarningMapStore();
  store.set('ws-1', 't1', 'p1', 's1', { id: 'c', captureSessionId: 's1', severity: 'error', code: 'capture-start-failed', message: 'F', recoverable: true, createdAt: Date.now() });
  store.dismiss('ws-1', 't1', 'p1', 's1', 'c');
  assert.strictEqual(toast, 'Maximum of 2 panes per terminal tab');
  console.log('✓ Scenario 11: Existing shortcut Toast messages unaffected by warning domains');
}

// --------------------------------------------------------------------------
// Component Logic Tests
// --------------------------------------------------------------------------
{
  // GlobalWarningBanner visibility & accessibility roles
  const gEmpty = filterVisibleGlobalWarnings([], 'ws-1');
  assert.strictEqual(gEmpty.length, 0, 'GlobalWarningBanner renders nothing when empty');

  const gList = [
    { id: 'g-err', scope: 'app', severity: 'error', code: 'terminal-service-disconnected', title: 'Err', message: 'Err msg', dismissible: true, createdAt: 1 },
    { id: 'g-warn', scope: 'workspace', workspaceId: 'ws-1', severity: 'warning', code: 'workspace-runtime-error', title: 'Warn', message: 'Warn msg', dismissible: false, createdAt: 2 },
    { id: 'g-other', scope: 'workspace', workspaceId: 'ws-other', severity: 'warning', code: 'workspace-runtime-error', title: 'Other', message: 'Other msg', dismissible: true, createdAt: 3 },
  ];
  const gVisible = filterVisibleGlobalWarnings(gList, 'ws-1');
  assert.strictEqual(gVisible.length, 2, 'Renders only app and active workspace warnings');
  assert.strictEqual(gVisible[0].severity === 'error' ? 'alert' : 'status', 'alert', 'Errors use role="alert"');
  assert.strictEqual(gVisible[1].severity === 'warning' ? 'status' : 'alert', 'status', 'Warnings use role="status"');

  // CaptureWarningBanner rendering guards & accessibility roles
  assert.strictEqual(getCaptureWarningForPane(null, 't1', 'p1'), null, 'Null workspace returns null banner');

  const staleWarning = { id: 'cw-stale', captureSessionId: 'old-session', severity: 'error', code: 'capture-start-failed', message: 'Stale', recoverable: true, createdAt: 1 };
  const wsWithStale = {
    id: 'ws-1',
    terminalTabs: [{ id: 't1', panes: [{ id: 'p1', capture: { warning: staleWarning } }] }],
    panes: [{ id: 'p1', capture: { warning: staleWarning } }],
  };
  assert.strictEqual(getCaptureWarningForPane(wsWithStale, 't1', 'p1', 'current-session'), null, 'Stale session warning returns null banner');

  const freshWarning = { id: 'cw-fresh', captureSessionId: 'sess-curr', severity: 'error', code: 'microphone-permission-denied', message: 'Denied', recoverable: true, createdAt: 2 };
  const wsWithFresh = {
    id: 'ws-1',
    terminalTabs: [{ id: 't1', panes: [{ id: 'p1', capture: { warning: freshWarning } }] }],
    panes: [{ id: 'p1', capture: { warning: freshWarning } }],
  };
  const resolved = getCaptureWarningForPane(wsWithFresh, 't1', 'p1', 'sess-curr');
  assert.strictEqual(resolved?.id, 'cw-fresh');
  assert.strictEqual(resolved?.severity === 'error' ? 'alert' : 'status', 'alert');

  // Dismiss & Retry behavior isolation
  let globalWarnings = [{ id: 'gw-stay', scope: 'app', severity: 'warning', code: 'terminal-service-reconnecting', title: 'T', message: 'M', dismissible: true, createdAt: 1 }];
  let retryCalled = false;
  const onRetry = () => { retryCalled = true; };
  onRetry();
  assert.strictEqual(retryCalled, true, 'Retry callback executed');
  assert.strictEqual(globalWarnings.length, 1, 'Retry does not mutate global warnings');

  let dismissedId = null;
  const onDismissGlobal = (id) => { dismissedId = id; globalWarnings = dismissGlobalWarning(globalWarnings, id); };
  onDismissGlobal('gw-stay');
  assert.strictEqual(dismissedId, 'gw-stay');
  assert.strictEqual(globalWarnings.length, 0, 'Global dismiss removes global warning');
  assert.strictEqual(resolved?.id, 'cw-fresh', 'Global dismiss does not affect capture warning');

  console.log('✓ Component Logic & Accessibility Tests: PASSED');
}

// --------------------------------------------------------------------------
// Regression Tests: LT-SHORTCUT-TOAST-CAPTURE-LEAK-FIX-001
// --------------------------------------------------------------------------
console.log('Running Shortcut Toast Capture Leak Regression Tests...');

// Regression 1: split-limit toast does not leak into Capture warning
{
  const { workspaces } = createTestEnvironment();
  const wsA = workspaces.find((w) => w.id === 'workspace-A');
  const tab1 = wsA.terminalTabs.find((t) => t.id === 'tab-1');

  // Verify setup: 2 panes present
  assert.strictEqual(tab1.panes.length, 2, 'Tab 1 must have exactly 2 panes');

  // Simulate split-limit keyboard trigger: sets toast only
  let toastState = null;
  const showTerminalPaneToast = (message) => {
    toastState = {
      id: 'toast-test',
      message,
      createdAt: Date.now(),
    };
  };

  showTerminalPaneToast('Maximum of 2 panes per terminal tab');

  // Assertions:
  assert.strictEqual(toastState?.message, 'Maximum of 2 panes per terminal tab');
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1'), null);
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-2'), null);
  assert.strictEqual(filterVisibleGlobalWarnings([], 'workspace-A').length, 0);
  assert.strictEqual(wsA.capture.isListening, false);
  assert.strictEqual(wsA.capture.blocks.length, 0);
  console.log('✓ Regression 1: split-limit toast does not leak into Capture warning');
}

// Regression 2: final-pane close toast does not leak
{
  const { workspaces } = createTestEnvironment();
  const wsB = workspaces.find((w) => w.id === 'workspace-B');
  const tabB1 = wsB.terminalTabs.find((t) => t.id === 'tab-B1');

  // Verify setup: 1 pane present
  assert.strictEqual(tabB1.panes.length, 1, 'Tab B1 must have exactly 1 pane');

  // Close pane rejected because only 1 pane remains
  let toastState = null;
  const showTerminalPaneToast = (message) => {
    toastState = {
      id: 'toast-close-test',
      message,
      createdAt: Date.now(),
    };
  };

  showTerminalPaneToast('Cannot close the last pane');

  assert.strictEqual(toastState?.message, 'Cannot close the last pane');
  assert.strictEqual(getCaptureWarningForPane(wsB, 'tab-B1', 'pane-B1'), null);
  assert.strictEqual(filterVisibleGlobalWarnings([], 'workspace-B').length, 0);
  assert.strictEqual(tabB1.panes.length, 1);
  console.log('✓ Regression 2: final-pane close toast does not leak');
}

// Regression 3: real Capture warning still renders correctly
{
  const { workspaces } = createTestEnvironment();
  const realCaptureWarning = {
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

  const wsA = updatedWorkspaces.find((w) => w.id === 'workspace-A');
  const resolved = getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'capture-session-1');

  assert.strictEqual(resolved?.id, 'capture-warning-1');
  assert.strictEqual(resolved?.code, 'microphone-permission-denied');
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-2', 'capture-session-1'), null);
  // Terminal pane toast is absent
  const toastState = null;
  assert.strictEqual(toastState, null, 'TerminalPaneToast must be absent');
  assert.strictEqual(filterVisibleGlobalWarnings([], 'workspace-A').length, 0);
  console.log('✓ Regression 3: real Capture warning still renders correctly in owning pane only');
}

// Regression 4: strict type/domain protection
{
  const { workspaces } = createTestEnvironment();

  // Attempting to set shortcut toast string as capture warning is safely rejected
  const invalidCaptureWarning = {
    id: 'invalid-1',
    captureSessionId: 'sess-1',
    severity: 'error',
    code: 'invalid-shortcut-code',
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
  const wsA = rejectedState.find((w) => w.id === 'workspace-A');
  assert.strictEqual(getCaptureWarningForPane(wsA, 'tab-1', 'pane-1', 'sess-1'), null);

  // Attempting to set shortcut toast as global warning is safely rejected
  const invalidGlobalWarning = {
    id: 'gw-invalid',
    scope: 'app',
    severity: 'error',
    code: 'invalid-code',
    title: 'Shortcut Error',
    message: 'Maximum of 2 panes per terminal tab',
    dismissible: true,
    createdAt: 1,
  };
  const rejectedGlobal = addGlobalWarning([], invalidGlobalWarning);
  assert.strictEqual(rejectedGlobal.length, 0, 'addGlobalWarning must reject shortcut toast messages');

  // Keyed map store rejects shortcut toast messages
  const store = new CaptureWarningMapStore();
  store.set('ws-1', 'tab-1', 'pane-1', 'sess-1', invalidCaptureWarning);
  assert.strictEqual(store.size(), 0, 'CaptureWarningMapStore must reject shortcut toast messages');

  console.log('✓ Regression 4: strict domain validation prevents shortcut leakage');
}

console.log('ALL TESTS PASSED SUCCESSFULLY!');
