import assert from 'node:assert';

/**
 * LT-CLOSE-CAPTURED-PANE-001
 * Close Captured Panes with Targeted Capture Finalization Tests
 */

function getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId) {
  return `${workspaceId}:${terminalTabId}:${paneId}`;
}

function createPaneCaptureRuntime(workspaceId, terminalTabId, paneId, paneOrdinal = 1) {
  return {
    workspaceId,
    terminalTabId,
    paneId,
    paneOrdinal,
    status: 'idle',
    captureSessionId: null,
    captureGroupId: null,
    currentBatch: null,
    batchCounter: 0,
    activeBlockId: null,
    activeBlockParser: null,
    inputBuffer: '',
    flushTimer: null,
    textDecoder: new TextDecoder(),
    blocks: [],
  };
}

function isPaneCaptureActive(workspaceId, terminalTabId, paneId, paneCaptureRuntimes) {
  const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId);
  const runtime = paneCaptureRuntimes?.get(key);
  if (!runtime) return false;
  return runtime.status === 'capturing' || runtime.status === 'paused';
}

function getPaneCaptureCloseImpact(workspaceId, terminalTabId, paneId, paneCaptureRuntimes, tabOrPanes) {
  const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId);
  const runtime = paneCaptureRuntimes?.get(key);
  const captureStatus = runtime?.status === 'paused' ? 'paused' : 'capturing';

  let paneOrdinal = runtime?.paneOrdinal ?? 1;
  const panesList = Array.isArray(tabOrPanes) ? tabOrPanes : tabOrPanes?.panes;

  if (panesList) {
    const found = panesList.find((p) => p.id === paneId);
    if (found && typeof found.stableOrdinal === 'number') {
      paneOrdinal = found.stableOrdinal;
    }
  }

  let otherActiveCapturedPaneCount = 0;
  if (panesList) {
    for (const p of panesList) {
      if (p.id !== paneId && isPaneCaptureActive(workspaceId, terminalTabId, p.id, paneCaptureRuntimes)) {
        otherActiveCapturedPaneCount++;
      }
    }
  } else if (paneCaptureRuntimes) {
    for (const r of paneCaptureRuntimes.values()) {
      if (
        r.workspaceId === workspaceId &&
        r.terminalTabId === terminalTabId &&
        r.paneId !== paneId &&
        (r.status === 'capturing' || r.status === 'paused')
      ) {
        otherActiveCapturedPaneCount++;
      }
    }
  }

  const isOnlyActiveCapturedTarget = otherActiveCapturedPaneCount === 0;

  return {
    paneOrdinal,
    captureStatus,
    otherActiveCapturedPaneCount,
    isOnlyActiveCapturedTarget,
  };
}

function getCaptureGroupStatus(workspaceId, terminalTabId, selectedPaneIds, paneCaptureRuntimes) {
  if (!selectedPaneIds || selectedPaneIds.length === 0) {
    return 'ready';
  }
  const groupRuntimes = [];
  for (const paneId of selectedPaneIds) {
    const key = getPaneCaptureRuntimeKey(workspaceId, terminalTabId, paneId);
    const r = paneCaptureRuntimes.get(key);
    if (r) groupRuntimes.push(r);
  }

  const isAnyCapturing = groupRuntimes.some((r) => r.status === 'capturing');
  if (isAnyCapturing) return 'capturing';

  const isAnyPaused = groupRuntimes.some((r) => r.status === 'paused');
  if (isAnyPaused) return 'paused';

  const isAnyError = groupRuntimes.some((r) => r.status === 'error');
  if (isAnyError) return 'error';

  return 'ready';
}

console.log('Running Close Captured Pane Tests...\n');

// ---------------------------------------------------------------------------
// Test 1: delete idle/unselected pane
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Delete idle/unselected pane ---');
  const wsId = 'ws-1';
  const tabId = 'tab-1';
  const runtimes = new Map();

  const p1 = createPaneCaptureRuntime(wsId, tabId, 'pane-1', 1);
  const p2 = createPaneCaptureRuntime(wsId, tabId, 'pane-2', 2);
  runtimes.set(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-1'), p1);
  runtimes.set(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-2'), p2);

  const tab = {
    id: tabId,
    panes: [
      { id: 'pane-1', stableOrdinal: 1, accentId: 'blue' },
      { id: 'pane-2', stableOrdinal: 2, accentId: 'violet' },
    ],
    selectedCapturePaneIds: ['pane-1'],
  };

  let modalOpened = false;
  function requestClose(targetPaneId) {
    if (tab.panes.length <= 1) {
      return { action: 'toast', message: 'Cannot close the last pane' };
    }
    if (isPaneCaptureActive(wsId, tabId, targetPaneId, runtimes)) {
      modalOpened = true;
      return { action: 'modal', impact: getPaneCaptureCloseImpact(wsId, tabId, targetPaneId, runtimes, tab) };
    }
    // Close immediately
    tab.panes = tab.panes.filter((p) => p.id !== targetPaneId);
    tab.selectedCapturePaneIds = tab.selectedCapturePaneIds.filter((id) => id !== targetPaneId);
    runtimes.delete(getPaneCaptureRuntimeKey(wsId, tabId, targetPaneId));
    return { action: 'closed' };
  }

  const res = requestClose('pane-2');
  assert.strictEqual(modalOpened, false, 'No modal should open for idle unselected pane');
  assert.strictEqual(res.action, 'closed');
  assert.strictEqual(tab.panes.length, 1);
  assert.strictEqual(tab.panes[0].id, 'pane-1');
  assert.strictEqual(tab.panes[0].stableOrdinal, 1, 'Pane 1 ordinal must remain unchanged');
  console.log('✓ Pane 2 closed immediately with no modal; Pane 1 unchanged');
}

// ---------------------------------------------------------------------------
// Test 2: delete selected but idle pane
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 2: Delete selected but idle pane ---');
  const wsId = 'ws-1';
  const tabId = 'tab-1';
  const runtimes = new Map();

  const p1 = createPaneCaptureRuntime(wsId, tabId, 'pane-1', 1);
  const p2 = createPaneCaptureRuntime(wsId, tabId, 'pane-2', 2);
  runtimes.set(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-1'), p1);
  runtimes.set(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-2'), p2);

  // Both selected while Capture is NOT running
  const tab = {
    id: tabId,
    panes: [
      { id: 'pane-1', stableOrdinal: 1, accentId: 'blue' },
      { id: 'pane-2', stableOrdinal: 2, accentId: 'violet' },
    ],
    selectedCapturePaneIds: ['pane-1', 'pane-2'],
  };

  let modalOpened = false;
  function requestClose(targetPaneId) {
    if (tab.panes.length <= 1) {
      return { action: 'toast', message: 'Cannot close the last pane' };
    }
    if (isPaneCaptureActive(wsId, tabId, targetPaneId, runtimes)) {
      modalOpened = true;
      return { action: 'modal' };
    }
    tab.panes = tab.panes.filter((p) => p.id !== targetPaneId);
    tab.selectedCapturePaneIds = tab.selectedCapturePaneIds.filter((id) => id !== targetPaneId);
    runtimes.delete(getPaneCaptureRuntimeKey(wsId, tabId, targetPaneId));
    return { action: 'closed' };
  }

  const res = requestClose('pane-2');
  assert.strictEqual(modalOpened, false, 'No modal should open for selected but idle pane');
  assert.strictEqual(res.action, 'closed');
  assert.strictEqual(tab.panes.length, 1);
  assert.strictEqual(tab.selectedCapturePaneIds.includes('pane-2'), false, 'Pane 2 removed from selectedCapturePaneIds');
  assert.deepStrictEqual(tab.selectedCapturePaneIds, ['pane-1']);
  console.log('✓ Selected idle pane closes immediately and is removed from selectedCapturePaneIds');
}

// ---------------------------------------------------------------------------
// Test 3: delete one of two captured panes
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 3: Delete one of two captured panes ---');
  const wsId = 'ws-1';
  const tabId = 'tab-1';
  const runtimes = new Map();

  const p1 = createPaneCaptureRuntime(wsId, tabId, 'pane-1', 1);
  const p2 = createPaneCaptureRuntime(wsId, tabId, 'pane-2', 2);
  runtimes.set(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-1'), p1);
  runtimes.set(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-2'), p2);

  // Both capturing
  const groupId = 'cg-123';
  p1.status = 'capturing';
  p1.captureGroupId = groupId;
  p1.captureSessionId = 'sess-p1';
  p1.activeBlockId = 'b1';
  p1.activeBlockParser = { command: 'echo p1', buffer: 'output p1\n', echoChecked: true };

  p2.status = 'capturing';
  p2.captureGroupId = groupId;
  p2.captureSessionId = 'sess-p2';
  p2.activeBlockId = 'b2';
  p2.activeBlockParser = { command: 'echo p2', buffer: 'output p2\n', echoChecked: true };

  const tab = {
    id: tabId,
    panes: [
      { id: 'pane-1', stableOrdinal: 1, accentId: 'blue' },
      { id: 'pane-2', stableOrdinal: 2, accentId: 'violet' },
    ],
    selectedCapturePaneIds: ['pane-1', 'pane-2'],
  };

  const blocks = [
    { id: 'b1', command: 'echo p1', output: '', isComplete: false, sourcePaneOrdinal: 1 },
    { id: 'b2', command: 'echo p2', output: '', isComplete: false, sourcePaneOrdinal: 2 },
  ];

  // 1. Request close pane-1
  assert.strictEqual(isPaneCaptureActive(wsId, tabId, 'pane-1', runtimes), true);
  const impact = getPaneCaptureCloseImpact(wsId, tabId, 'pane-1', runtimes, tab);
  assert.strictEqual(impact.paneOrdinal, 1);
  assert.strictEqual(impact.captureStatus, 'capturing');
  assert.strictEqual(impact.otherActiveCapturedPaneCount, 1);
  assert.strictEqual(impact.isOnlyActiveCapturedTarget, false);

  // 2. Confirm close
  // Finalize active block for pane-1
  const finalized = blocks.find((b) => b.id === p1.activeBlockId);
  finalized.output = p1.activeBlockParser.buffer;
  finalized.isComplete = true;

  // Clear target runtime
  p1.activeBlockId = null;
  p1.activeBlockParser = null;
  p1.status = 'idle';
  runtimes.delete(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-1'));

  // Update tab
  tab.panes = tab.panes.filter((p) => p.id !== 'pane-1');
  tab.selectedCapturePaneIds = tab.selectedCapturePaneIds.filter((id) => id !== 'pane-1');

  // Reconcile group status
  const groupStatus = getCaptureGroupStatus(wsId, tabId, tab.selectedCapturePaneIds, runtimes);
  assert.strictEqual(groupStatus, 'capturing', 'Aggregate group status remains capturing because pane-2 is capturing');

  // Assertions
  assert.strictEqual(runtimes.has(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-1')), false, 'Pane 1 runtime disposed');
  assert.strictEqual(tab.selectedCapturePaneIds.includes('pane-1'), false, 'Pane 1 removed from selector');
  assert.strictEqual(p2.status, 'capturing', 'Pane 2 runtime still capturing');
  assert.strictEqual(p2.captureGroupId, groupId, 'Pane 2 captureGroupId preserved');
  assert.strictEqual(p2.captureSessionId, 'sess-p2', 'Pane 2 captureSessionId preserved');

  // Route output in pane-2
  p2.activeBlockParser.buffer += 'more output';
  assert.strictEqual(p2.activeBlockParser.buffer, 'output p2\nmore output');

  // Assert pane-1 historical block remains
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].id, 'b1');
  assert.strictEqual(blocks[0].isComplete, true);
  assert.strictEqual(blocks[0].sourcePaneOrdinal, 1);
  console.log('✓ Pane 1 closed with targeted finalization; Pane 2 continues capturing; historical blocks preserved');
}

// ---------------------------------------------------------------------------
// Test 4: delete only captured target
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 4: Delete only captured target ---');
  const wsId = 'ws-1';
  const tabId = 'tab-1';
  const runtimes = new Map();

  const p1 = createPaneCaptureRuntime(wsId, tabId, 'pane-1', 1);
  const p2 = createPaneCaptureRuntime(wsId, tabId, 'pane-2', 2);
  runtimes.set(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-1'), p1);
  runtimes.set(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-2'), p2);

  // Pane 1 capturing, Pane 2 idle
  p1.status = 'capturing';
  p1.captureGroupId = 'cg-solo';
  p1.captureSessionId = 'sess-solo';
  p1.activeBlockId = 'b1';
  p1.activeBlockParser = { command: 'date', buffer: 'Mon Sep 22\n', echoChecked: true };

  p2.status = 'idle';

  const tab = {
    id: tabId,
    panes: [
      { id: 'pane-1', stableOrdinal: 1, accentId: 'blue' },
      { id: 'pane-2', stableOrdinal: 2, accentId: 'violet' },
    ],
    selectedCapturePaneIds: ['pane-1'],
  };

  const blocks = [
    { id: 'b1', command: 'date', output: '', isComplete: false, sourcePaneOrdinal: 1 },
  ];

  // Check impact
  const impact = getPaneCaptureCloseImpact(wsId, tabId, 'pane-1', runtimes, tab);
  assert.strictEqual(impact.paneOrdinal, 1);
  assert.strictEqual(impact.otherActiveCapturedPaneCount, 0);
  assert.strictEqual(impact.isOnlyActiveCapturedTarget, true);

  // Confirm close
  blocks[0].output = p1.activeBlockParser.buffer;
  blocks[0].isComplete = true;
  runtimes.delete(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-1'));

  tab.panes = tab.panes.filter((p) => p.id !== 'pane-1');
  tab.selectedCapturePaneIds = tab.selectedCapturePaneIds.filter((id) => id !== 'pane-1');
  // Fallback target selection for surviving pane
  if (tab.selectedCapturePaneIds.length === 0 && tab.panes.length > 0) {
    tab.selectedCapturePaneIds = [tab.panes[0].id];
  }

  const groupStatus = getCaptureGroupStatus(wsId, tabId, tab.selectedCapturePaneIds, runtimes);
  assert.strictEqual(groupStatus, 'ready', 'Group status becomes ready because no surviving runtimes are capturing');

  const isTargetSelectorLocked = groupStatus === 'capturing' || groupStatus === 'paused';
  assert.strictEqual(isTargetSelectorLocked, false, 'Selector unlocks');

  assert.strictEqual(tab.panes.length, 1);
  assert.strictEqual(tab.panes[0].id, 'pane-2');
  assert.strictEqual(blocks[0].output, 'Mon Sep 22\n');
  assert.strictEqual(blocks[0].isComplete, true);
  console.log('✓ Solo captured target stops capture group, unlocks selector, preserves history');
}

// ---------------------------------------------------------------------------
// Test 5: final-pane guard
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 5: Final-pane guard ---');
  const wsId = 'ws-1';
  const tabId = 'tab-1';
  const runtimes = new Map();

  const p1 = createPaneCaptureRuntime(wsId, tabId, 'pane-1', 1);
  runtimes.set(getPaneCaptureRuntimeKey(wsId, tabId, 'pane-1'), p1);

  const tab = {
    id: tabId,
    panes: [{ id: 'pane-1', stableOrdinal: 1, accentId: 'blue' }],
    selectedCapturePaneIds: ['pane-1'],
  };

  let modalOpened = false;
  let toastMessage = null;

  function requestClose(targetPaneId) {
    if (tab.panes.length <= 1) {
      toastMessage = 'Cannot close the last pane';
      return;
    }
    if (isPaneCaptureActive(wsId, tabId, targetPaneId, runtimes)) {
      modalOpened = true;
      return;
    }
    tab.panes = tab.panes.filter((p) => p.id !== targetPaneId);
  }

  requestClose('pane-1');
  assert.strictEqual(modalOpened, false, 'Modal must not open for final pane');
  assert.strictEqual(tab.panes.length, 1, 'Final pane remains');
  assert.strictEqual(toastMessage, 'Cannot close the last pane', 'Toast shown');
  console.log('✓ Final remaining pane cannot be closed; toast shown');
}

// ---------------------------------------------------------------------------
// Test 6: cross-tab/workspace isolation
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 6: Cross-tab / workspace isolation ---');
  const runtimes = new Map();

  // Workspace A / Tab A
  const pA1 = createPaneCaptureRuntime('ws-A', 'tab-A', 'p-A1', 1);
  const pA2 = createPaneCaptureRuntime('ws-A', 'tab-A', 'p-A2', 2);
  pA1.status = 'capturing';
  pA1.captureGroupId = 'cg-A';
  pA1.captureSessionId = 'sess-A1';
  pA2.status = 'capturing';
  pA2.captureGroupId = 'cg-A';
  pA2.captureSessionId = 'sess-A2';

  runtimes.set(getPaneCaptureRuntimeKey('ws-A', 'tab-A', 'p-A1'), pA1);
  runtimes.set(getPaneCaptureRuntimeKey('ws-A', 'tab-A', 'p-A2'), pA2);

  // Workspace B / Tab B
  const pB1 = createPaneCaptureRuntime('ws-B', 'tab-B', 'p-B1', 1);
  pB1.status = 'capturing';
  pB1.captureGroupId = 'cg-B';
  pB1.captureSessionId = 'sess-B1';
  runtimes.set(getPaneCaptureRuntimeKey('ws-B', 'tab-B', 'p-B1'), pB1);

  // Close p-A1 in Workspace A
  runtimes.delete(getPaneCaptureRuntimeKey('ws-A', 'tab-A', 'p-A1'));

  // Assert pA1 deleted
  assert.strictEqual(runtimes.has(getPaneCaptureRuntimeKey('ws-A', 'tab-A', 'p-A1')), false);
  // Assert pA2 untouched
  assert.strictEqual(pA2.status, 'capturing');
  assert.strictEqual(pA2.captureSessionId, 'sess-A2');
  // Assert pB1 untouched
  assert.strictEqual(pB1.status, 'capturing');
  assert.strictEqual(pB1.captureSessionId, 'sess-B1');
  assert.strictEqual(pB1.captureGroupId, 'cg-B');
  console.log('✓ Closing pane in Workspace A does not leak to Workspace A siblings or Workspace B');
}

console.log('\n=========================================');
console.log('ALL 6 CLOSE CAPTURED PANE TESTS PASSED!');
console.log('=========================================');
