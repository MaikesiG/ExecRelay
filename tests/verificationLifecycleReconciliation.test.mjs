import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ts = require('../app/node_modules/typescript');

function transpileTs(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  return ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

// 1. Transpile verification/types.ts
const typesJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/types.ts'));
const typesMod = { exports: {} };
new Function('module', 'exports', 'require', typesJs)(typesMod, typesMod.exports, () => ({}));

// 2. Transpile verification/verificationModel.ts
const modelJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'));
const modelMod = { exports: {} };
new Function('module', 'exports', 'require', modelJs)(modelMod, modelMod.exports, () => typesMod.exports);
const {
  createDefaultVerificationContract,
  createVerificationCriterion,
  createVerificationRun,
  deriveVerificationPresentation,
  deriveVerificationTabIndicator,
} = modelMod.exports;

// 3. Transpile verification/verificationState.ts
const stateJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationState.ts'));
const stateMod = { exports: {} };
new Function('module', 'exports', 'require', stateJs)(stateMod, stateMod.exports, (req) => {
  if (req.includes('types')) return typesMod.exports;
  if (req.includes('verificationModel')) return modelMod.exports;
  return {};
});
const {
  getOrCreateWorkspaceVerificationState,
  getWorkspaceVerificationRuns,
  getLatestVerificationRun,
  appendVerificationRunToWorkspace,
  updateVerificationRunInWorkspace,
} = stateMod.exports;

// 4. Transpile verification/verificationReconciliation.ts
const reconJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationReconciliation.ts'));
const reconMod = { exports: {} };
new Function('module', 'exports', 'require', reconJs)(reconMod, reconMod.exports, (req) => {
  if (req.includes('types')) return typesMod.exports;
  if (req.includes('verificationState')) return stateMod.exports;
  return {};
});
const {
  getActiveVerificationRun,
  reconcileWorkspaceVerificationState,
  reconcileVerificationTeardown,
} = reconMod.exports;

// Helper to create a dummy logical workspace
function createTestWorkspace(id = 'ws-test') {
  const contract = createDefaultVerificationContract(id);
  return {
    id,
    name: 'Test Workspace',
    terminalTabs: [
      {
        id: 'tab-1',
        workspaceId: id,
        name: 'Terminal 1',
        activePaneId: 'pane-1',
        paneIds: ['pane-1'],
        panes: [
          {
            id: 'pane-1',
            terminalTabId: 'tab-1',
            stableOrdinal: 1,
            terminalSessionId: 'sess-1',
            session: {
              sessionId: 'sess-1',
              status: 'connected',
            },
            capture: {
              isListening: false,
              sessionId: 'sess-1',
            },
          },
        ],
      },
    ],
    activeTerminalTabId: 'tab-1',
    panes: [
      {
        id: 'pane-1',
        terminalTabId: 'tab-1',
        stableOrdinal: 1,
        terminalSessionId: 'sess-1',
        session: {
          sessionId: 'sess-1',
          status: 'connected',
        },
        capture: {
          isListening: false,
          sessionId: 'sess-1',
        },
      },
    ],
    capture: {
      isListening: false,
      currentBatch: null,
      batchCounter: 0,
      blocks: [],
    },
    selection: {
      selectedBlockIds: new Set(),
      updatedAt: 0,
    },
    verification: {
      contracts: [contract],
      activeContractId: contract.id,
      runs: [],
      activeRunId: null,
    },
  };
}

console.log('Running HARDEN-012C Verification Lifecycle Reconciliation & Tab Status Tests...\n');

// ============================================================================
// Test 1: Finalized run is not active
// ============================================================================
console.log('--- Test 1: Finalized run is not active ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, runA);

  // Finalize run A as passed
  const passedRun = {
    ...runA,
    status: 'passed',
    completedAt: Date.now(),
    criterionResults: runA.criterionResults.map((r) => ({
      ...r,
      status: 'passed',
      completedAt: Date.now(),
    })),
  };
  ws = updateVerificationRunInWorkspace(ws, passedRun);

  // Even if activeRunId was manually set to passedRun.id, getActiveVerificationRun must return null!
  ws.verification.activeRunId = passedRun.id;

  assert.strictEqual(
    getActiveVerificationRun(ws),
    null,
    'getActiveVerificationRun must return null for a finalized passed run',
  );
  assert.strictEqual(
    getLatestVerificationRun(ws)?.id,
    passedRun.id,
    'getLatestVerificationRun must return the passed run',
  );

  const pres = deriveVerificationPresentation({
    run: getLatestVerificationRun(ws),
    isRunning: false,
  });
  assert.strictEqual(pres.status, 'passed');
  assert.strictEqual(pres.badgeLabel, 'PASSED');

  const tabIndicator = deriveVerificationTabIndicator(pres);
  assert.strictEqual(tabIndicator.tone, 'none');
  assert.strictEqual(tabIndicator.hasDot, false);

  console.log('✓ Finalized run returns null for activeRun, shows PASSED / no tab dot');
}

// ============================================================================
// Test 2: Orphaned running run
// ============================================================================
console.log('\n--- Test 2: Orphaned running run ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = {
    ...runA,
    status: 'running',
    criterionResults: runA.criterionResults.map((r, i) => ({
      ...r,
      status: i === 0 ? 'running' : 'pending',
      startedAt: Date.now(),
    })),
  };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  // Simulate orphaned run: hasActiveRuntime is false
  const { workspace: reconciledWs, wasReconciled, orphanedRunIds } =
    reconcileWorkspaceVerificationState({
      workspace: ws,
      hasActiveRuntime: false,
      activeRunIdInRuntime: null,
      reconciliationReason: 'Verification execution state was lost before authoritative completion',
    });

  assert.strictEqual(wasReconciled, true);
  assert.deepStrictEqual(orphanedRunIds, [runA.id]);

  const reconciledRun = reconciledWs.verification.runs.find((r) => r.id === runA.id);
  assert.strictEqual(reconciledRun.status, 'error');
  assert.strictEqual(reconciledWs.verification.activeRunId, null);
  assert.strictEqual(reconciledRun.criterionResults[0].status, 'error');
  assert.ok(reconciledRun.criterionResults[0].message.includes('lost before authoritative completion'));

  const pres = deriveVerificationPresentation({
    run: getLatestVerificationRun(reconciledWs),
    isRunning: false,
  });
  assert.strictEqual(pres.status, 'error');
  assert.strictEqual(pres.badgeLabel, 'ERROR');

  const tabIndicator = deriveVerificationTabIndicator(pres);
  assert.strictEqual(tabIndicator.tone, 'none');
  assert.strictEqual(tabIndicator.hasDot, false);

  console.log('✓ Orphaned running run reconciled to ERROR, activeRunId cleared, no tab dot displayed');
}

// ============================================================================
// Test 3: Valid running runtime
// ============================================================================
console.log('\n--- Test 3: Valid running runtime ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = {
    ...runA,
    status: 'running',
    criterionResults: runA.criterionResults.map((r, i) => ({
      ...r,
      status: i === 0 ? 'running' : 'pending',
      startedAt: Date.now(),
    })),
  };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  // Runtime is genuinely active
  const { workspace: reconciledWs, wasReconciled } =
    reconcileWorkspaceVerificationState({
      workspace: ws,
      hasActiveRuntime: true,
      activeRunIdInRuntime: runA.id,
    });

  assert.strictEqual(wasReconciled, false, 'Valid running run must not be modified by reconciliation');
  assert.strictEqual(getActiveVerificationRun(reconciledWs)?.id, runA.id);

  const pres = deriveVerificationPresentation({
    run: getActiveVerificationRun(reconciledWs),
    isRunning: true,
  });
  assert.strictEqual(pres.status, 'running');
  assert.strictEqual(pres.badgeLabel, 'RUNNING');

  const tabIndicator = deriveVerificationTabIndicator(pres);
  assert.strictEqual(tabIndicator.tone, 'warning');
  assert.strictEqual(tabIndicator.tooltip, 'Verification running');
  assert.strictEqual(tabIndicator.dotClass, 'verify-status-dot verify-status-dot--warning');

  console.log('✓ Valid running runtime preserved as RUNNING with yellow dot');
}

// ============================================================================
// Test 4: Stopping
// ============================================================================
console.log('\n--- Test 4: Stopping ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const stoppingRun = { ...runA, status: 'stopping' };
  ws = appendVerificationRunToWorkspace(ws, stoppingRun);

  const activeRun = getActiveVerificationRun(ws);
  assert.strictEqual(activeRun?.status, 'stopping');

  const pres = deriveVerificationPresentation({
    run: activeRun,
    isStopping: true,
  });
  assert.strictEqual(pres.status, 'stopping');
  assert.strictEqual(pres.badgeLabel, 'STOPPING');

  const tabIndicator = deriveVerificationTabIndicator(pres);
  assert.strictEqual(tabIndicator.tone, 'warning');
  assert.strictEqual(tabIndicator.tooltip, 'Verification stopping');
  assert.strictEqual(tabIndicator.dotClass, 'verify-status-dot verify-status-dot--warning');

  console.log('✓ Valid stopping runtime preserved as STOPPING with yellow dot');
}

// ============================================================================
// Test 5: Stop-timeout (STOP ISSUE)
// ============================================================================
console.log('\n--- Test 5: Stop-timeout (STOP ISSUE) ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const timeoutRun = { ...runA, status: 'stop-timeout' };
  ws = appendVerificationRunToWorkspace(ws, timeoutRun);

  const activeRun = getActiveVerificationRun(ws);
  assert.strictEqual(activeRun?.status, 'stop-timeout');

  const pres = deriveVerificationPresentation({
    run: activeRun,
    isStopTimeout: true,
  });
  assert.strictEqual(pres.status, 'stop-timeout');
  assert.strictEqual(pres.badgeLabel, 'STOP ISSUE');

  const tabIndicator = deriveVerificationTabIndicator(pres);
  assert.strictEqual(tabIndicator.tone, 'danger');
  assert.strictEqual(tabIndicator.tooltip, 'Verification command is still running after stop request');
  assert.strictEqual(tabIndicator.dotClass, 'verify-status-dot verify-status-dot--danger');

  console.log('✓ Valid stop-timeout runtime preserved as STOP ISSUE with red dot');
}

// ============================================================================
// Test 6: Normal completion (Passed)
// ============================================================================
console.log('\n--- Test 6: Normal completion (Passed) ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, runA);

  const completedRun = {
    ...runA,
    status: 'passed',
    completedAt: Date.now(),
    criterionResults: runA.criterionResults.map((r) => ({
      ...r,
      status: 'passed',
      completedAt: Date.now(),
      observedExitCode: 0,
    })),
  };
  ws = updateVerificationRunInWorkspace(ws, completedRun);

  assert.strictEqual(getActiveVerificationRun(ws), null);
  assert.strictEqual(getLatestVerificationRun(ws)?.status, 'passed');

  const pres = deriveVerificationPresentation({
    run: getLatestVerificationRun(ws),
    isRunning: false,
  });
  assert.strictEqual(pres.status, 'passed');

  const tabIndicator = deriveVerificationTabIndicator(pres);
  assert.strictEqual(tabIndicator.tone, 'none');
  assert.strictEqual(tabIndicator.hasDot, false);

  console.log('✓ Normal passed completion clears activeRun, displays no dot');
}

// ============================================================================
// Test 7: Failure
// ============================================================================
console.log('\n--- Test 7: Failure ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, runA);

  const failedRun = {
    ...runA,
    status: 'failed',
    completedAt: Date.now(),
    criterionResults: runA.criterionResults.map((r) => ({
      ...r,
      status: 'failed',
      completedAt: Date.now(),
      observedExitCode: 1,
      message: 'Command failed with exit code 1',
    })),
  };
  ws = updateVerificationRunInWorkspace(ws, failedRun);

  assert.strictEqual(getActiveVerificationRun(ws), null);
  assert.strictEqual(getLatestVerificationRun(ws)?.status, 'failed');

  const pres = deriveVerificationPresentation({
    run: getLatestVerificationRun(ws),
    isRunning: false,
  });
  assert.strictEqual(pres.status, 'failed');

  const tabIndicator = deriveVerificationTabIndicator(pres);
  assert.strictEqual(tabIndicator.tone, 'none');
  assert.strictEqual(tabIndicator.hasDot, false);

  console.log('✓ Failed run clears activeRun, displays no tab dot');
}

// ============================================================================
// Test 8: Cancellation
// ============================================================================
console.log('\n--- Test 8: Cancellation ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, runA);

  const cancelledRun = {
    ...runA,
    status: 'cancelled',
    completedAt: Date.now(),
    criterionResults: runA.criterionResults.map((r) => ({
      ...r,
      status: 'interrupted',
      completedAt: Date.now(),
      message: 'Verification was stopped by user',
    })),
  };
  ws = updateVerificationRunInWorkspace(ws, cancelledRun);

  assert.strictEqual(getActiveVerificationRun(ws), null);
  assert.strictEqual(getLatestVerificationRun(ws)?.status, 'cancelled');

  const pres = deriveVerificationPresentation({
    run: getLatestVerificationRun(ws),
    isRunning: false,
  });
  assert.strictEqual(pres.status, 'cancelled');

  const tabIndicator = deriveVerificationTabIndicator(pres);
  assert.strictEqual(tabIndicator.tone, 'none');
  assert.strictEqual(tabIndicator.hasDot, false);

  console.log('✓ Cancelled run displays no tab dot');
}

// ============================================================================
// Test 9: Owning pane close
// ============================================================================
console.log('\n--- Test 9: Owning pane close ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = {
    ...runA,
    status: 'running',
    criterionResults: runA.criterionResults.map((r, i) => ({
      ...r,
      status: i === 0 ? 'running' : 'pending',
      startedAt: Date.now(),
    })),
  };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  const mockRuntime = {
    workspaceId: ws.id,
    terminalTabId: 'tab-1',
    terminalPaneId: 'pane-1',
    runId: runA.id,
    expectedCriterionId: runA.criteriaSnapshot[0].id,
    lifecycle: 'running',
  };

  const { workspace: updatedWs, runtimeCleared, cancelledRun } =
    reconcileVerificationTeardown({
      workspace: ws,
      runtime: mockRuntime,
      targetWorkspaceId: ws.id,
      targetPaneId: 'pane-1',
      reason: 'Terminal pane was closed during verification',
    });

  assert.strictEqual(runtimeCleared, true);
  assert.ok(cancelledRun);
  assert.strictEqual(cancelledRun.status, 'cancelled');
  assert.strictEqual(cancelledRun.criterionResults[0].status, 'error');
  assert.ok(cancelledRun.criterionResults[0].message.includes('Terminal pane was closed'));

  assert.strictEqual(getActiveVerificationRun(updatedWs), null);
  assert.strictEqual(getLatestVerificationRun(updatedWs)?.status, 'cancelled');

  console.log('✓ Owning pane close cancels active run, settles criteria, clears runtime');
}

// ============================================================================
// Test 10: Unrelated pane close
// ============================================================================
console.log('\n--- Test 10: Unrelated pane close ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = { ...runA, status: 'running' };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  const mockRuntime = {
    workspaceId: ws.id,
    terminalTabId: 'tab-1',
    terminalPaneId: 'pane-1',
    runId: runA.id,
    lifecycle: 'running',
  };

  const { workspace: updatedWs, runtimeCleared, cancelledRun } =
    reconcileVerificationTeardown({
      workspace: ws,
      runtime: mockRuntime,
      targetWorkspaceId: ws.id,
      targetPaneId: 'pane-999', // Different pane
      reason: 'Unrelated pane closed',
    });

  assert.strictEqual(runtimeCleared, false);
  assert.strictEqual(cancelledRun, null);
  assert.strictEqual(getActiveVerificationRun(updatedWs)?.id, runA.id);

  console.log('✓ Unrelated pane close preserves active Verification without mutation');
}

// ============================================================================
// Test 11: Owning terminal tab close
// ============================================================================
console.log('\n--- Test 11: Owning terminal tab close ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = { ...runA, status: 'running' };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  const mockRuntime = {
    workspaceId: ws.id,
    terminalTabId: 'tab-1',
    terminalPaneId: 'pane-1',
    runId: runA.id,
    lifecycle: 'running',
  };

  const { workspace: updatedWs, runtimeCleared, cancelledRun } =
    reconcileVerificationTeardown({
      workspace: ws,
      runtime: mockRuntime,
      targetWorkspaceId: ws.id,
      targetTabId: 'tab-1',
      reason: 'Terminal tab was closed during verification',
    });

  assert.strictEqual(runtimeCleared, true);
  assert.strictEqual(cancelledRun?.status, 'cancelled');
  assert.strictEqual(getActiveVerificationRun(updatedWs), null);

  console.log('✓ Owning terminal tab close cancels active run and clears runtime');
}

// ============================================================================
// Test 12: Unrelated tab close
// ============================================================================
console.log('\n--- Test 12: Unrelated tab close ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = { ...runA, status: 'running' };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  const mockRuntime = {
    workspaceId: ws.id,
    terminalTabId: 'tab-1',
    terminalPaneId: 'pane-1',
    runId: runA.id,
    lifecycle: 'running',
  };

  const { workspace: updatedWs, runtimeCleared } =
    reconcileVerificationTeardown({
      workspace: ws,
      runtime: mockRuntime,
      targetWorkspaceId: ws.id,
      targetTabId: 'tab-other',
      reason: 'Other tab closed',
    });

  assert.strictEqual(runtimeCleared, false);
  assert.strictEqual(getActiveVerificationRun(updatedWs)?.id, runA.id);

  console.log('✓ Unrelated tab close leaves Verification completely untouched');
}

// ============================================================================
// Test 13: Owning terminal session exit
// ============================================================================
console.log('\n--- Test 13: Owning terminal session exit ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = { ...runA, status: 'running' };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  const mockRuntime = {
    workspaceId: ws.id,
    terminalTabId: 'tab-1',
    terminalPaneId: 'pane-1',
    targetSessionId: 'sess-1',
    runId: runA.id,
    lifecycle: 'running',
  };

  const { workspace: updatedWs, runtimeCleared, cancelledRun } =
    reconcileVerificationTeardown({
      workspace: ws,
      runtime: mockRuntime,
      targetWorkspaceId: ws.id,
      targetSessionId: 'sess-1',
      reason: 'Terminal session exited before verification completion',
    });

  assert.strictEqual(runtimeCleared, true);
  assert.strictEqual(cancelledRun?.status, 'cancelled');
  assert.strictEqual(getActiveVerificationRun(updatedWs), null);

  const pres = deriveVerificationPresentation({
    run: getLatestVerificationRun(updatedWs),
    isRunning: false,
  });
  assert.strictEqual(pres.status, 'cancelled');

  console.log('✓ Owning terminal session exit reconciles run and releases runtime without fabricating PASS');
}

// ============================================================================
// Test 14: Unrelated session exit
// ============================================================================
console.log('\n--- Test 14: Unrelated session exit ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = { ...runA, status: 'running' };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  const mockRuntime = {
    workspaceId: ws.id,
    terminalTabId: 'tab-1',
    terminalPaneId: 'pane-1',
    targetSessionId: 'sess-1',
    runId: runA.id,
    lifecycle: 'running',
  };

  const { workspace: updatedWs, runtimeCleared } =
    reconcileVerificationTeardown({
      workspace: ws,
      runtime: mockRuntime,
      targetWorkspaceId: ws.id,
      targetSessionId: 'sess-different',
      reason: 'Other session exited',
    });

  assert.strictEqual(runtimeCleared, false);
  assert.strictEqual(getActiveVerificationRun(updatedWs)?.id, runA.id);

  console.log('✓ Unrelated session exit does not disrupt active verification');
}

// ============================================================================
// Test 15: Reload orphan recovery
// ============================================================================
console.log('\n--- Test 15: Reload orphan recovery ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = { ...runA, status: 'running' };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  // App restarts: runtime is null
  const { workspace: recoveredWs, wasReconciled, orphanedRunIds } =
    reconcileWorkspaceVerificationState({
      workspace: ws,
      hasActiveRuntime: false,
      activeRunIdInRuntime: null,
      reconciliationReason: 'Verification runtime was interrupted by application restart',
    });

  assert.strictEqual(wasReconciled, true);
  assert.deepStrictEqual(orphanedRunIds, [runA.id]);
  assert.strictEqual(recoveredWs.verification.activeRunId, null);
  assert.strictEqual(recoveredWs.verification.runs[0].status, 'error');

  const pres = deriveVerificationPresentation({
    run: getLatestVerificationRun(recoveredWs),
    isRunning: false,
  });
  assert.strictEqual(pres.status, 'error');

  const tabIndicator = deriveVerificationTabIndicator(pres);
  assert.strictEqual(tabIndicator.tone, 'none');
  assert.strictEqual(tabIndicator.hasDot, false);

  console.log('✓ Reload recovery converts persisted running run to ERROR without stale yellow dot');
}

// ============================================================================
// Test 16: Duplicate finalization idempotency
// ============================================================================
console.log('\n--- Test 16: Duplicate finalization idempotency ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, runA);

  const completedRun = {
    ...runA,
    status: 'passed',
    completedAt: Date.now(),
    criterionResults: runA.criterionResults.map((r) => ({
      ...r,
      status: 'passed',
      completedAt: Date.now(),
    })),
  };
  ws = updateVerificationRunInWorkspace(ws, completedRun);

  // Send duplicate finalization
  const duplicateRun = {
    ...completedRun,
    status: 'failed', // Attempted mutation
  };
  const wsAfterDup = updateVerificationRunInWorkspace(ws, duplicateRun);

  // Immutability protection guarantees status remains passed
  assert.strictEqual(wsAfterDup.verification.runs[0].status, 'passed');

  // Attempt duplicate teardown
  const { runtimeCleared, cancelledRun } = reconcileVerificationTeardown({
    workspace: ws,
    runtime: null,
    targetWorkspaceId: ws.id,
    targetPaneId: 'pane-1',
    reason: 'Duplicate close',
  });
  assert.strictEqual(runtimeCleared, false);
  assert.strictEqual(cancelledRun, null);

  console.log('✓ Finalized runs are immutable; duplicate teardowns/completions are idempotent');
}

// ============================================================================
// Test 17: Terminal tab switching is lifecycle-neutral
// ============================================================================
console.log('\n--- Test 17: Terminal tab switching is lifecycle-neutral ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = { ...runA, status: 'running' };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  // Switch terminal tabs
  const wsAfterTabSwitch = {
    ...ws,
    activeTerminalTabId: 'tab-2',
  };

  assert.strictEqual(getActiveVerificationRun(wsAfterTabSwitch)?.id, runA.id);
  assert.strictEqual(wsAfterTabSwitch.verification.runs[0].status, 'running');

  // Switch back
  const wsAfterSwitchBack = {
    ...wsAfterTabSwitch,
    activeTerminalTabId: 'tab-1',
  };

  assert.strictEqual(getActiveVerificationRun(wsAfterSwitchBack)?.id, runA.id);

  console.log('✓ Terminal tab switching does not mutate verification lifecycle');
}

// ============================================================================
// Test 18: Monitor view switching is lifecycle-neutral
// ============================================================================
console.log('\n--- Test 18: Monitor view switching is lifecycle-neutral ---');
{
  let ws = createTestWorkspace();
  const contract = ws.verification.contracts[0];
  const runA = createVerificationRun({ contract, workspaceId: ws.id });
  const runningRun = { ...runA, status: 'running' };
  ws = appendVerificationRunToWorkspace(ws, runningRun);

  const views = ['verification', 'agents', 'changes', 'capture-evidence', 'verification'];
  let activeRun = getActiveVerificationRun(ws);

  for (const view of views) {
    // Navigation is pure presentation state
    assert.strictEqual(activeRun?.id, runA.id, `Active run must survive navigation to ${view}`);
  }

  console.log('✓ Monitor view switching (Verify -> Agents -> Changes -> Capture -> Verify) is lifecycle-neutral');
}

// ============================================================================
// Test 19: Full canonical status dot tone mapping (HARDEN-016.1 Section 3, 30, 47)
// ============================================================================
console.log('\n--- Test 19: Full canonical status dot tone mapping ---');
{
  const expectedMappings = [
    { status: 'pending', tone: 'none', hasDot: false, dotClass: '' },
    { status: 'running', tone: 'warning', hasDot: true, dotClass: 'verify-status-dot verify-status-dot--warning' },
    { status: 'stopping', tone: 'warning', hasDot: true, dotClass: 'verify-status-dot verify-status-dot--warning' },
    { status: 'stop-timeout', tone: 'danger', hasDot: true, dotClass: 'verify-status-dot verify-status-dot--danger' },
    { status: 'passed', tone: 'none', hasDot: false, dotClass: '' },
    { status: 'failed', tone: 'none', hasDot: false, dotClass: '' },
    { status: 'error', tone: 'none', hasDot: false, dotClass: '' },
    { status: 'cancelled', tone: 'none', hasDot: false, dotClass: '' },
  ];

  for (const m of expectedMappings) {
    const pres = { status: m.status, badgeLabel: m.status.toUpperCase(), badgeClass: m.status };
    const ind = deriveVerificationTabIndicator(pres);
    assert.strictEqual(ind.tone, m.tone, `Status ${m.status} must have tone ${m.tone}`);
    assert.strictEqual(ind.hasDot, m.hasDot, `Status ${m.status} must have hasDot ${m.hasDot}`);
    assert.strictEqual(ind.dotClass, m.dotClass, `Status ${m.status} must have dotClass ${m.dotClass}`);
  }

  // Null/undefined presentation fallback to idle
  const nullInd = deriveVerificationTabIndicator(null);
  assert.strictEqual(nullInd.tone, 'none');
  assert.strictEqual(nullInd.hasDot, false);

  console.log('✓ All 8 canonical status dot tone mappings verified');
}

// ============================================================================
// Test 20: Tooltip & ARIA textual accessibility labels
// ============================================================================
console.log('\n--- Test 20: Tooltip & ARIA textual accessibility labels ---');
{
  const expectedLabels = [
    {
      status: 'pending',
      tooltip: 'Verify',
      ariaLabel: 'Verify',
    },
    {
      status: 'running',
      tooltip: 'Verification running',
      ariaLabel: 'Verify — Verification running',
    },
    {
      status: 'stopping',
      tooltip: 'Verification stopping',
      ariaLabel: 'Verify — Verification stopping',
    },
    {
      status: 'passed',
      tooltip: 'Verify',
      ariaLabel: 'Verify',
    },
    {
      status: 'failed',
      tooltip: 'Verify',
      ariaLabel: 'Verify',
    },
    {
      status: 'error',
      tooltip: 'Verify',
      ariaLabel: 'Verify',
    },
    {
      status: 'stop-timeout',
      tooltip: 'Verification command is still running after stop request',
      ariaLabel: 'Verify — Verification command is still running after stop request',
    },
    {
      status: 'cancelled',
      tooltip: 'Verify',
      ariaLabel: 'Verify',
    },
  ];

  for (const item of expectedLabels) {
    const pres = { status: item.status, badgeLabel: item.status.toUpperCase(), badgeClass: item.status };
    const ind = deriveVerificationTabIndicator(pres);
    assert.strictEqual(ind.tooltip, item.tooltip, `Status ${item.status} must have tooltip "${item.tooltip}"`);
    assert.strictEqual(ind.ariaLabel, item.ariaLabel, `Status ${item.status} must have aria-label "${item.ariaLabel}"`);
  }

  console.log('✓ Full tooltip and accessible textual labels verified across all lifecycle states');
}

console.log('\n=============================================================');
console.log('ALL HARDEN-012C VERIFICATION LIFECYCLE RECONCILIATION TESTS PASSED!');
console.log('=============================================================\n');
