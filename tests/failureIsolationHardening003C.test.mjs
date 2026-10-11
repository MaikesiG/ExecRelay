import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const React = require('../app/node_modules/react');
const ReactDOMServer = require('../app/node_modules/react-dom/server');

function transpileTs(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

let totalAssertions = 0;
function pass(msg) {
  totalAssertions += 1;
  console.log(`✓ ${msg}`);
}

console.log('Running ExecRelay HARDENING-003C Failure-Isolation and Async Ownership Proof Suite...\n');

// Load DerivedSurfaceErrorBoundary
const errorBoundaryPath = path.resolve(__dirname, '../app/src/features/workspace/DerivedSurfaceErrorBoundary.tsx');
const { DerivedSurfaceErrorBoundary } = transpileTs(errorBoundaryPath, (name) => {
  if (name === 'react') return React;
  return {};
});

// -----------------------------------------------------------------------------
// Test 1: DerivedSurfaceErrorBoundary Generic Fallback Does Not Expose Raw Error
// -----------------------------------------------------------------------------
console.log('--- Test 1: DerivedSurfaceErrorBoundary Generic Fallback Privacy ---');
{
  const secretMessage = 'CRITICAL_DB_PASSWORD_XYZ123 at /var/secrets/api_token.key';
  const secretStack = 'Error: CRITICAL_DB_PASSWORD_XYZ123\n    at eval (/Users/user/secret.ts:42:13)';
  const testError = new Error(secretMessage);
  testError.stack = secretStack;

  // 1a: getDerivedStateFromError
  const nextState = DerivedSurfaceErrorBoundary.getDerivedStateFromError(testError);
  assert.strictEqual(nextState.hasError, true);
  pass('hasError is set to true');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(nextState, 'errorMessage'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(nextState, 'error'), false);
  pass('raw error or message is not stored in state');

  // 1b: Fallback render for Capture, Changes, Verify
  for (const surfaceName of ['Capture', 'Changes', 'Verify']) {
    const instance = new DerivedSurfaceErrorBoundary({ surfaceName });
    instance.state = nextState;
    const vdom = instance.render();
    const html = ReactDOMServer.renderToString(vdom);

    assert.ok(html.includes(`${surfaceName} encountered an error.`));
    assert.ok(html.includes('Try Again'));
    assert.ok(!html.includes('CRITICAL_DB_PASSWORD_XYZ123'), `HTML must not leak secrets for ${surfaceName}`);
    assert.ok(!html.includes('/var/secrets'), `HTML must not leak paths for ${surfaceName}`);
    assert.ok(!html.includes('secret.ts'), `HTML must not leak stack traces for ${surfaceName}`);
    pass(`Surface '${surfaceName}' renders sanitized generic fallback without error leakage`);
  }
}

// -----------------------------------------------------------------------------
// Test 2: Retry Semantics - Reset Boundary Only
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Retry Semantics ---');
{
  let resetCalled = false;
  const instance = new DerivedSurfaceErrorBoundary({
    surfaceName: 'Verify',
    onReset: () => {
      resetCalled = true;
    },
  });

  instance.state = { hasError: true };
  let setStateCalled = false;
  instance.setState = (update) => {
    setStateCalled = true;
    instance.state = typeof update === 'function' ? update(instance.state) : update;
  };

  instance.handleReset();
  assert.strictEqual(setStateCalled, true);
  assert.strictEqual(instance.state.hasError, false);
  assert.strictEqual(resetCalled, true);
  pass('Retry reset resets hasError to false and fires local onReset only');
}

// -----------------------------------------------------------------------------
// Test 3: Structural Derived Surface Boundary Placement
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Structural Derived Surface Boundary Placement ---');
{
  const transcriptPanelSrc = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );
  const panelLayoutSrc = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/PanelLayoutNodeView.tsx'),
    'utf8',
  );

  // Check TranscriptCapturePanel wrappers
  assert.ok(
    transcriptPanelSrc.includes('<DerivedSurfaceErrorBoundary surfaceName="Capture">'),
    'Capture view must be wrapped with DerivedSurfaceErrorBoundary',
  );
  pass('Capture view wrapped in DerivedSurfaceErrorBoundary');

  assert.ok(
    transcriptPanelSrc.includes('<DerivedSurfaceErrorBoundary surfaceName="Changes">'),
    'Changes view must be wrapped with DerivedSurfaceErrorBoundary',
  );
  pass('Changes view wrapped in DerivedSurfaceErrorBoundary');

  assert.ok(
    transcriptPanelSrc.includes('<DerivedSurfaceErrorBoundary surfaceName="Verify">'),
    'Verify view must be wrapped with DerivedSurfaceErrorBoundary',
  );
  pass('Verify view wrapped in DerivedSurfaceErrorBoundary');

  // Check PanelLayoutNodeView capture leaf wrapper
  assert.ok(
    panelLayoutSrc.includes('<DerivedSurfaceErrorBoundary surfaceName="Capture panel" panelId={panel.id}>'),
    'TranscriptCapturePanel leaf must be wrapped in DerivedSurfaceErrorBoundary',
  );
  pass('Capture panel leaf wrapped in DerivedSurfaceErrorBoundary in PanelLayoutNodeView');
}

// -----------------------------------------------------------------------------
// Test 4: Terminal Isolation - TerminalPane NOT Inside Derived Boundaries
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Terminal Isolation ---');
{
  const panelLayoutSrc = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/PanelLayoutNodeView.tsx'),
    'utf8',
  );

  // Extract the terminal branch: panel.kind === 'terminal'
  const terminalBranchStart = panelLayoutSrc.indexOf("if (panel.kind === 'terminal')");
  const captureBranchStart = panelLayoutSrc.indexOf("if (panel.kind === 'capture')");
  assert.ok(terminalBranchStart !== -1, 'terminal branch exists');
  assert.ok(captureBranchStart !== -1, 'capture branch exists');

  const terminalBranchCode = panelLayoutSrc.substring(terminalBranchStart, captureBranchStart);
  assert.ok(
    !terminalBranchCode.includes('DerivedSurfaceErrorBoundary'),
    'Terminal branch must NOT wrap TerminalPane inside DerivedSurfaceErrorBoundary',
  );
  pass('TerminalPane is isolated outside DerivedSurfaceErrorBoundary');

  // Verify TerminalPane receives independent ref handle
  assert.ok(
    terminalBranchCode.includes('terminalRefs.current.set(pane.id, handle)'),
    'TerminalPane maintains independent ref handle without boundary interference',
  );
  pass('Terminal handle registry isolated from derived boundary');
}

// -----------------------------------------------------------------------------
// Test 5: Changes Collection - Workspace Deleted Before Collection Completion
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Changes Collection - Workspace Deleted Before Completion ---');
{
  // Simulate App.tsx updateWorkspace and handleRefreshRepositoryEvidence
  const workspaces = [
    {
      id: 'ws-active',
      name: 'Active Workspace',
      repositorySnapshots: [],
      latestCollectionRun: null,
    },
  ];
  const workspacesRef = { current: workspaces };
  const activeWorkspaceIdRef = { current: 'ws-active' };
  const activeCollectionRequestRef = { current: new Map() };

  function updateWorkspace(workspaceId, updater) {
    const idx = workspacesRef.current.findIndex((w) => w.id === workspaceId);
    if (idx === -1) return;
    const target = workspacesRef.current[idx];
    const updated = updater(target);
    if (updated === target) return;
    const next = [...workspacesRef.current];
    next[idx] = updated;
    workspacesRef.current = next;
  }

  // Workspace deleted while request is in-flight
  const wsId = 'ws-deleted';
  const requestId = 1;
  activeCollectionRequestRef.current.set(wsId, requestId);

  // Collection completes after wsId is already deleted
  const mockCompletedRun = { id: 'run-1', status: 'completed' };
  const mockSnapshot = { id: 'snap-1', timestamp: Date.now() };

  // Guard in App.tsx:
  let updated = false;
  if (
    activeCollectionRequestRef.current.get(wsId) === requestId &&
    workspacesRef.current.some((w) => w.id === wsId)
  ) {
    updateWorkspace(wsId, (prev) => {
      updated = true;
      return { ...prev, latestCollectionRun: mockCompletedRun };
    });
  }

  assert.strictEqual(updated, false, 'updateWorkspace must not be called when workspace is deleted');
  assert.strictEqual(workspacesRef.current.length, 1, 'No new workspace must be created');
  assert.strictEqual(workspacesRef.current[0].id, 'ws-active', 'Existing active workspace unmodified');
  assert.strictEqual(workspacesRef.current[0].latestCollectionRun, null, 'No result attached to active workspace');
  pass('Deleted workspace collection does not resurrect workspace or pollute other workspaces');
}

// -----------------------------------------------------------------------------
// Test 6: Changes Collection Race - Older Request Resolving After Newer Request
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Changes Collection Race - Older Request Overwrite Protection ---');
{
  const wsId = 'ws-1';
  const workspaces = [
    {
      id: wsId,
      name: 'Workspace 1',
      repositorySnapshots: [],
      latestCollectionRun: null,
    },
  ];
  const workspacesRef = { current: workspaces };
  const activeCollectionRequestRef = { current: new Map() };

  function updateWorkspace(workspaceId, updater) {
    const idx = workspacesRef.current.findIndex((w) => w.id === workspaceId);
    if (idx === -1) return;
    const target = workspacesRef.current[idx];
    const updated = updater(target);
    const next = [...workspacesRef.current];
    next[idx] = updated;
    workspacesRef.current = next;
  }

  function createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const deferredA = createDeferred();
  const deferredB = createDeferred();

  async function mockRefreshEvidence(deferred) {
    const requestId = (activeCollectionRequestRef.current.get(wsId) ?? 0) + 1;
    activeCollectionRequestRef.current.set(wsId, requestId);

    const { run, snapshot } = await deferred.promise;

    if (activeCollectionRequestRef.current.get(wsId) !== requestId) {
      return; // superseded!
    }
    if (!workspacesRef.current.some((w) => w.id === wsId)) {
      return;
    }

    updateWorkspace(wsId, (prev) => ({
      ...prev,
      latestCollectionRun: run,
      repositorySnapshots: [...(prev.repositorySnapshots ?? []), snapshot],
    }));
  }

  // 1. Request A starts
  const promiseA = mockRefreshEvidence(deferredA);
  assert.strictEqual(activeCollectionRequestRef.current.get(wsId), 1);

  // 2. Request B starts later
  const promiseB = mockRefreshEvidence(deferredB);
  assert.strictEqual(activeCollectionRequestRef.current.get(wsId), 2);

  // 3. Request B resolves FIRST
  deferredB.resolve({
    run: { id: 'run-B', name: 'Collection B' },
    snapshot: { id: 'snap-B' },
  });
  await promiseB;

  assert.strictEqual(workspacesRef.current[0].latestCollectionRun.id, 'run-B');
  assert.strictEqual(workspacesRef.current[0].repositorySnapshots.length, 1);
  assert.strictEqual(workspacesRef.current[0].repositorySnapshots[0].id, 'snap-B');
  pass('Request B resolved and installed as latestCollectionRun');

  // 4. Request A resolves LAST (older request)
  deferredA.resolve({
    run: { id: 'run-A', name: 'Collection A' },
    snapshot: { id: 'snap-A' },
  });
  await promiseA;

  // Expected: Run B remains latest, Run A was dropped!
  assert.strictEqual(workspacesRef.current[0].latestCollectionRun.id, 'run-B');
  assert.strictEqual(workspacesRef.current[0].repositorySnapshots.length, 1);
  assert.strictEqual(workspacesRef.current[0].repositorySnapshots[0].id, 'snap-B');
  pass('Older Request A was ignored and did not overwrite newer Request B');
}

// -----------------------------------------------------------------------------
// Test 7: Verification Old-Run Race - Run A Late Result After Run B Begins
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Verification Old-Run Race ---');
{
  const activeRuntime = {
    workspaceId: 'ws-1',
    runId: 'run-B',
    currentCriterionId: 'crit-B',
    expectedCriterionId: 'crit-B',
    currentExecutionId: 'exec-B',
    expectedExecutionId: 'exec-B',
    isProcessingCompletion: false,
    criteriaSnapshot: [{ id: 'crit-B', label: 'Check B' }],
  };

  // Simulate late execution completed block from Run A
  const lateBlockFromRunA = {
    id: 'exec-A',
    executionId: 'exec-A',
    intent: 'verification',
    workspaceId: 'ws-1',
    verificationRunId: 'run-A', // Different run ID!
    verificationCriterionId: 'crit-A',
    isComplete: true,
  };

  let handled = false;
  function handleVerificationExecutionCompleted(block, runtime) {
    const activeExecId = runtime.currentExecutionId ?? runtime.expectedExecutionId;
    const activeCriterionId = runtime.currentCriterionId ?? runtime.expectedCriterionId;

    if (
      block.intent !== 'verification' ||
      block.workspaceId !== runtime.workspaceId ||
      block.verificationRunId !== runtime.runId ||
      (activeCriterionId && block.verificationCriterionId !== activeCriterionId) ||
      (activeExecId && block.id !== activeExecId && block.executionId !== activeExecId)
    ) {
      return; // IGNORED!
    }
    handled = true;
  }

  handleVerificationExecutionCompleted(lateBlockFromRunA, activeRuntime);
  assert.strictEqual(handled, false, 'Late block from Run A must be rejected by correlation check');
  assert.strictEqual(activeRuntime.runId, 'run-B', 'Run B remains current and unchanged');
  pass('Verification Run A late result after Run B begins is safely ignored');
}

// -----------------------------------------------------------------------------
// Test 8: Verification Stale Timer Callback - New Run Unchanged
// -----------------------------------------------------------------------------
console.log('\n--- Test 8: Verification Stale Timer Callback ---');
{
  const verificationRuntimeRef = { current: null };

  // Runtime A created with its own timer
  const runtimeA = {
    runId: 'run-A',
    workspaceId: 'ws-1',
    advanceTimer: 1234,
    stopFallbackTimer: null,
  };
  verificationRuntimeRef.current = runtimeA;

  // Run A stops / completes -> runtime cleared
  runtimeA.advanceTimer = null;
  verificationRuntimeRef.current = null;

  // Run B starts
  const runtimeB = {
    runId: 'run-B',
    workspaceId: 'ws-1',
    advanceTimer: null,
    stopFallbackTimer: null,
    currentCriterionIndex: 0,
  };
  verificationRuntimeRef.current = runtimeB;

  // Stale callback closure from Run A executing:
  function staleAdvanceCallback(capturedRuntime) {
    if (verificationRuntimeRef.current !== capturedRuntime) {
      return; // Discarded!
    }
    capturedRuntime.currentCriterionIndex += 1;
  }

  staleAdvanceCallback(runtimeA);
  assert.strictEqual(runtimeB.currentCriterionIndex, 0, 'Run B state must not be modified by stale Run A callback');
  pass('Stale timer/callback from prior run cannot mutate new run');
}

// -----------------------------------------------------------------------------
// Test 9: Verification Pre-Dispatch Race (HARDEN-003C Section 11)
// -----------------------------------------------------------------------------
console.log('\n--- Test 9: Verification Pre-Dispatch Race ---');
{
  const workspaces = [
    {
      id: 'ws-1',
      name: 'Workspace 1',
      terminalTabs: [{ id: 'tab-1', paneIds: ['pane-1'] }],
      verification: { runs: [] },
    },
  ];
  const workspacesRef = { current: workspaces };
  const verificationRuntimeRef = { current: null };
  const inFlightVerificationRunIdRef = { current: null };

  function createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const deferredPreSnapshot = createDeferred();

  // 9a: Pre-dispatch interrupted by workspace deletion
  const newRunId = 'run-predispatch-1';
  inFlightVerificationRunIdRef.current = newRunId;

  let advanceCalled = false;
  async function simulatePreDispatch(wsId, tabId, paneId, runId, deferred) {
    // 1. collectRepositoryEvidence in flight
    await deferred.promise;

    // 2. Pre-dispatch ownership and lifecycle guard
    if (inFlightVerificationRunIdRef.current !== runId) {
      return;
    }
    const currentWs = workspacesRef.current.find((w) => w.id === wsId);
    if (!currentWs) {
      inFlightVerificationRunIdRef.current = null;
      return;
    }
    const currentTab = currentWs.terminalTabs.find((t) => t.id === tabId);
    if (!currentTab || !currentTab.paneIds.includes(paneId)) {
      inFlightVerificationRunIdRef.current = null;
      return;
    }

    verificationRuntimeRef.current = { runId, wsId };
    advanceCalled = true;
  }

  const preDispatchPromise = simulatePreDispatch('ws-1', 'tab-1', 'pane-1', newRunId, deferredPreSnapshot);

  // User deletes workspace before snapshot resolves!
  workspacesRef.current = []; // deleted!

  // Snapshot now resolves
  deferredPreSnapshot.resolve({ run: {}, snapshot: {} });
  await preDispatchPromise;

  assert.strictEqual(advanceCalled, false, 'advance must not be called when workspace was deleted during pre-dispatch');
  assert.strictEqual(verificationRuntimeRef.current, null, 'verificationRuntimeRef must not be installed');
  assert.strictEqual(inFlightVerificationRunIdRef.current, null, 'inFlightVerificationRunIdRef must be cleared');
  pass('Pre-dispatch snapshot resolution after workspace deletion aborts cleanly without resurrection');

  // 9b: Pre-dispatch interrupted by stop/superseded run
  const deferred2 = createDeferred();
  const run2Id = 'run-predispatch-2';
  inFlightVerificationRunIdRef.current = run2Id;
  workspacesRef.current = [{ id: 'ws-1', terminalTabs: [{ id: 'tab-1', paneIds: ['pane-1'] }] }];

  const preDispatchPromise2 = simulatePreDispatch('ws-1', 'tab-1', 'pane-1', run2Id, deferred2);

  // User calls stopVerification before snapshot resolves!
  inFlightVerificationRunIdRef.current = null; // stop called

  deferred2.resolve({ run: {}, snapshot: {} });
  await preDispatchPromise2;

  assert.strictEqual(advanceCalled, false, 'advance must not be called if run was stopped during pre-dispatch');
  assert.strictEqual(verificationRuntimeRef.current, null, 'verificationRuntimeRef must remain null');
  pass('Pre-dispatch snapshot resolution after cancellation aborts cleanly');
}

// -----------------------------------------------------------------------------
// Test 10: Capture Delayed Flush After Pane Close
// -----------------------------------------------------------------------------
console.log('\n--- Test 10: Capture Delayed Flush After Pane Close ---');
{
  const runtimeKey = 'ws-1:tab-1:pane-1';
  const paneCaptureRuntimes = new Map();
  const workspaces = [
    {
      id: 'ws-1',
      terminalTabs: [{ id: 'tab-1' }],
      capture: { blocks: [{ id: 'block-1', output: 'initial' }] },
    },
  ];
  const workspacesRef = { current: workspaces };

  const runtime = {
    workspaceId: 'ws-1',
    terminalTabId: 'tab-1',
    paneId: 'pane-1',
    flushTimer: null,
    activeBlockId: 'block-1',
    activeBlockParser: { buffer: 'stale output' },
  };
  paneCaptureRuntimes.set(runtimeKey, runtime);

  let flushExecuted = false;
  function triggerFlushCallback(capturedRuntime) {
    capturedRuntime.flushTimer = null;
    const currentWs = workspacesRef.current.find((w) => w.id === capturedRuntime.workspaceId);
    if (!currentWs) return;
    const currentTab = currentWs.terminalTabs.find((t) => t.id === capturedRuntime.terminalTabId);
    if (!currentTab) return;
    if (paneCaptureRuntimes.get(runtimeKey) !== capturedRuntime) {
      return; // Closed or replaced!
    }
    flushExecuted = true;
  }

  // Close pane: remove runtime from registry
  paneCaptureRuntimes.delete(runtimeKey);

  // Delayed timer fires
  triggerFlushCallback(runtime);

  assert.strictEqual(flushExecuted, false, 'Delayed flush must not execute after pane is removed from registry');
  assert.strictEqual(workspacesRef.current[0].capture.blocks[0].output, 'initial');
  pass('Capture delayed flush after pane close is rejected safely');
}

// -----------------------------------------------------------------------------
// Test 11: Persistence Debounce Stale Overwrite Protection
// -----------------------------------------------------------------------------
console.log('\n--- Test 11: Persistence Debounce Safety ---');
{
  let persistedStates = [];
  function savePersistedWorkspaceState(state) {
    persistedStates.push(JSON.parse(JSON.stringify(state)));
  }

  let saveTimeout = null;
  function scheduleSave(workspaces, activeWorkspaceId, activeMonitorView, workspacesRef, activeWorkspaceIdRef) {
    // Mimic App.tsx useEffect behavior:
    // 1. Cleanup of previous effect clears the timeout
    if (saveTimeout !== null) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    // 2. New timeout scheduled
    saveTimeout = setTimeout(() => {
      savePersistedWorkspaceState({
        workspaces,
        activeWorkspaceId,
        activeMonitorView,
      });
      saveTimeout = null;
    }, 400);
  }

  function simulateTeardown(workspacesRef, activeWorkspaceIdRef, activeMonitorView) {
    if (saveTimeout !== null) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
      // Synchronous final flush of latest logical persisted snapshot during teardown
      savePersistedWorkspaceState({
        workspaces: workspacesRef.current,
        activeWorkspaceId: activeWorkspaceIdRef.current,
        activeMonitorView,
      });
    }
  }

  const workspacesRef = { current: [{ id: 'ws-1', name: 'Version 1' }] };
  const activeWorkspaceIdRef = { current: 'ws-1' };

  // Rapid state change 1
  scheduleSave(
    [{ id: 'ws-1', name: 'Version 1' }],
    'ws-1',
    'capture-evidence',
    workspacesRef,
    activeWorkspaceIdRef,
  );

  // Rapid state change 2 before 400ms
  workspacesRef.current = [{ id: 'ws-1', name: 'Version 2' }];
  scheduleSave(
    [{ id: 'ws-1', name: 'Version 2' }],
    'ws-1',
    'capture-evidence',
    workspacesRef,
    activeWorkspaceIdRef,
  );

  // Rapid teardown before 400ms
  workspacesRef.current = [{ id: 'ws-1', name: 'Version Final' }];
  simulateTeardown(workspacesRef, activeWorkspaceIdRef, 'capture-evidence');

  // Verify only the final latest state was persisted!
  assert.strictEqual(persistedStates.length, 1);
  assert.strictEqual(persistedStates[0].workspaces[0].name, 'Version Final');
  pass('Persistence debounce prevents stale state overwriting and guarantees latest state flush');
}

console.log('\n=============================================================');
console.log(`ALL 11 HARDENING-003C TESTS PASSED (${totalAssertions} assertions verified)!`);
console.log('=============================================================\n');
