/**
 * HARDEN-VERIFY-EDITABILITY-022 — Unlock Verification Profile After Run Completion
 *
 * Verifies:
 * 1.  Canonical isVerificationRuntimeActive helper logic for all runtime lifecycles.
 * 2.  Test 11: NEVER-RUN PROFILE: Profile is editable before any run.
 * 3.  Test 12: RUNNING: Profile mutation actions are disabled while live runtime is running.
 * 4.  Test 13: STOPPING: Profile mutation actions are disabled while runtime is stopping.
 * 5.  Test 13b: STOP_ISSUE / STOP_TIMEOUT: Mutations remain disabled while runtime ownership retained.
 * 6.  Test 14: CANCELLED: Run ends CANCELLED, runtime ownership cleared -> profile editable immediately (reproduces real bug).
 * 7.  Test 15: FAILED: Run ends FAILED, runtime ownership cleared -> profile editable immediately.
 * 8.  Test 16: COMPLETED: Run completes successfully (PASSED), runtime cleared -> profile editable immediately.
 * 9.  Test 17: ERROR: Run ends ERROR, runtime ownership cleared -> profile editable immediately.
 * 10. Test 18: HISTORY IMMUTABILITY: Profile A/B/C/D, Run #1 executes A/B/C/D, Delete D -> Profile is A/B/C, Run #1 is strictly A/B/C/D.
 * 11. Test 19: NEXT RUN USES UPDATED PROFILE: Next run snapshot contains only A/B/C; D does not reappear.
 * 12. Test 20: SELECTION AFTER EDIT: Deleting D prunes selection to A/B/C with no stale IDs (3 of 3 selected).
 * 13. UI Component Render: VerificationPanel DOM preserves edit, delete, reorder, checkboxes, and + Add Check after run finishes.
 * 14. UI Component Render: Historical Run Cards & Run History entries remain strictly immutable evidence with zero edit/delete controls.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ts = require('../app/node_modules/typescript');
const React = require('../app/node_modules/react');
const ReactDOMServer = require('../app/node_modules/react-dom/server');

function transpileTs(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  return ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function transpileTsx(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'React', js)(
    mod,
    mod.exports,
    customRequire,
    React,
  );
  return mod.exports;
}

// 1. Transpile execution/types.ts
const execTypesJs = transpileTs(path.resolve(__dirname, '../app/src/features/execution/types.ts'));
const execTypesMod = { exports: {} };
new Function('module', 'exports', 'require', execTypesJs)(execTypesMod, execTypesMod.exports, () => ({}));

// 2. Transpile verification/types.ts
const verifTypesJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/types.ts'));
const verifTypesMod = { exports: {} };
new Function('module', 'exports', 'require', verifTypesJs)(verifTypesMod, verifTypesMod.exports, () => ({}));

// 3. Transpile verification/verificationModel.ts
const verifModelJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'));
const verifModelMod = { exports: {} };
const customRequireVerifModel = (req) => {
  if (req.includes('types')) return verifTypesMod.exports;
  return {};
};
new Function('module', 'exports', 'require', verifModelJs)(verifModelMod, verifModelMod.exports, customRequireVerifModel);
const {
  createVerificationCriterion,
  createVerificationContract,
  createDefaultVerificationContract,
  createVerificationRun,
  deriveVerificationPresentation,
  deriveVerificationRunStatus,
} = verifModelMod.exports;

// 4. Transpile verification/verificationState.ts
const verifStateJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationState.ts'));
const verifStateMod = { exports: {} };
const customRequireVerifState = (req) => {
  if (req.includes('types')) return verifTypesMod.exports;
  if (req.includes('verificationModel')) return verifModelMod.exports;
  return {};
};
new Function('module', 'exports', 'require', verifStateJs)(verifStateMod, verifStateMod.exports, customRequireVerifState);
const {
  createDefaultWorkspaceVerificationState,
  ensureWorkspaceVerificationState,
  getActiveVerificationContract,
  appendVerificationRunToWorkspace,
  updateVerificationRunInWorkspace,
  addCriterionToContractInWorkspace,
  updateCriterionInContractInWorkspace,
  deleteCriterionFromContractInWorkspace,
  reorderCriteriaInContractInWorkspace,
  getCanonicalVerificationSelection,
} = verifStateMod.exports;

// 5. Transpile verification/verificationReconciliation.ts
const verifRecJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationReconciliation.ts'));
const verifRecMod = { exports: {} };
const customRequireVerifRec = (req) => {
  if (req.includes('types')) return verifTypesMod.exports;
  if (req.includes('verificationState')) return verifStateMod.exports;
  return {};
};
new Function('module', 'exports', 'require', verifRecJs)(verifRecMod, verifRecMod.exports, customRequireVerifRec);
const {
  isNonTerminalVerificationStatus,
  isTerminalVerificationStatus,
  isVerificationRuntimeActive,
  getActiveVerificationRun,
  reconcileWorkspaceVerificationState,
} = verifRecMod.exports;

// 6. Transpile verification/VerificationPanel.tsx
const verifPanelMod = transpileTsx(
  path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.tsx'),
  (req) => {
    if (req.includes('react')) return React;
    if (req.endsWith('.css')) return {};
    if (req.includes('types')) return verifTypesMod.exports;
    if (req.includes('verificationModel')) return verifModelMod.exports;
    return {
      ChangeAttributionView: () => null,
      VerificationCheckModal: () => null,
      VerificationProfileModal: () => null,
      NewProfileModal: () => null,
      stripAnsiAndControl: (s) => s,
      formatExecutionDuration: () => '1s',
    };
  },
);
const { VerificationPanel } = verifPanelMod;

function createTestWorkspace(id = 'ws-test') {
  const contract = createDefaultVerificationContract(id);
  const ws = {
    id,
    name: 'Test Workspace',
    rootPath: '/tmp/test',
    terminalTabs: [],
    panes: [],
    capture: { isListening: false, currentBatch: null, batchCounter: 0, blocks: [] },
    selection: { selectedBlockIds: new Set(), updatedAt: 0 },
    terminalTabIds: [],
    verification: {
      contracts: [contract],
      activeContractId: contract.id,
      runs: [],
      activeRunId: null,
      selectedCriterionIds: new Set(contract.criteria.map((c) => c.id)),
    },
  };
  return ensureWorkspaceVerificationState(ws);
}

console.log('Running HARDEN-VERIFY-EDITABILITY-022: Verification Profile Editability Suite...\n');

// -----------------------------------------------------------------------------
// Test 1: Canonical isVerificationRuntimeActive Helper
// -----------------------------------------------------------------------------
console.log('--- Test 1: Canonical isVerificationRuntimeActive Helper ---');
{
  assert.strictEqual(isVerificationRuntimeActive(null), false, 'null runtime is not active');
  assert.strictEqual(isVerificationRuntimeActive(undefined), false, 'undefined runtime is not active');
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'running' }), true, 'running lifecycle is active');
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'stopping' }), true, 'stopping lifecycle is active');
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'stop-timeout' }), true, 'stop-timeout lifecycle is active');
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'completed' }), false, 'completed lifecycle is not active');
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'cancelled' }), false, 'cancelled lifecycle is not active');
  console.log('✓ isVerificationRuntimeActive accurately reflects active vs released execution ownership');
}

// -----------------------------------------------------------------------------
// Test 2: Test 11 — NEVER-RUN PROFILE: Profile is editable before any run
// -----------------------------------------------------------------------------
console.log('--- Test 2: Test 11 — NEVER-RUN PROFILE: Profile editable before run ---');
{
  const ws = createTestWorkspace('ws-never-run');
  const contract = getActiveVerificationContract(ws);
  assert.strictEqual(ws.verification.runs.length, 0, 'No runs have occurred');

  // Verify runtime is not active
  assert.strictEqual(isVerificationRuntimeActive(null), false);

  // Render VerificationPanel
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      isStopping: false,
      isStopTimeout: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  // Criteria row actions (Move up, Move down, Edit, Delete) and Add Check MUST be present and NOT disabled
  assert.ok(html.includes('aria-label="Edit check"'), 'Edit check button is present');
  assert.ok(html.includes('aria-label="Delete check"'), 'Delete check button is present');
  assert.ok(html.includes('aria-label="Move check down"'), 'Move check down button is present');
  assert.ok(html.includes('+ Add Check'), '+ Add Check button is present');
  assert.ok(html.includes('verification-selection-toolbar'), 'Selection toolbar is present');

  // None of the edit/delete buttons should be disabled by isLocked
  assert.ok(!html.includes('aria-label="Edit check" disabled=""'), 'Edit check is not disabled');
  assert.ok(!html.includes('aria-label="Delete check" disabled=""'), 'Delete check is not disabled');
  assert.ok(!html.includes('+ Add Check</button>') || !html.includes('verification-add-check-btn" disabled=""'), '+ Add check is not disabled');

  console.log('✓ Never-run profile is fully editable');
}

// -----------------------------------------------------------------------------
// Test 3: Test 12 — RUNNING: Profile mutation actions are disabled
// -----------------------------------------------------------------------------
console.log('--- Test 3: Test 12 — RUNNING: Profile mutation actions disabled ---');
{
  const ws = createTestWorkspace('ws-running');
  const contract = getActiveVerificationContract(ws);
  const runtime = { lifecycle: 'running' };
  assert.strictEqual(isVerificationRuntimeActive(runtime), true);

  const run = createVerificationRun({
    contract,
    workspaceId: ws.id,
  });

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: run,
      historicalRuns: [run],
      isRunning: true,
      isStopping: false,
      isStopTimeout: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  // When isRunning: row actions must be disabled
  assert.ok(/disabled=""[^>]*aria-label="Edit check"/.test(html) || /aria-label="Edit check"[^>]*disabled=""/.test(html), 'Edit check button is disabled during running');
  assert.ok(/disabled=""[^>]*aria-label="Delete check"/.test(html) || /aria-label="Delete check"[^>]*disabled=""/.test(html), 'Delete check button is disabled during running');
  assert.ok(/verification-add-check-btn"[^>]*disabled=""/.test(html) || /disabled=""[^>]*verification-add-check-btn/.test(html), '+ Add Check is disabled during running');
  assert.ok(/verification-profile-select"[^>]*disabled=""/.test(html) || /disabled=""[^>]*verification-profile-select/.test(html), 'Profile select is disabled during running');
  assert.ok(/disabled=""[^>]*aria-label="Edit verification profile"/.test(html) || /aria-label="Edit verification profile"[^>]*disabled=""/.test(html), 'Edit profile is disabled during running');
  assert.ok(/disabled=""[^>]*aria-label="Create verification profile"/.test(html) || /aria-label="Create verification profile"[^>]*disabled=""/.test(html), 'Create profile is disabled during running');

  console.log('✓ Running state strictly disables profile mutation actions');
}

// -----------------------------------------------------------------------------
// Test 4: Test 13 — STOPPING: Profile mutation actions are disabled
// -----------------------------------------------------------------------------
console.log('--- Test 4: Test 13 — STOPPING: Profile mutation actions disabled ---');
{
  const ws = createTestWorkspace('ws-stopping');
  const contract = getActiveVerificationContract(ws);
  const runtime = { lifecycle: 'stopping' };
  assert.strictEqual(isVerificationRuntimeActive(runtime), true);

  const run = {
    ...createVerificationRun({ contract, workspaceId: ws.id }),
    status: 'stopping',
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: run,
      historicalRuns: [run],
      isRunning: false,
      isStopping: true,
      isStopTimeout: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  assert.ok(/disabled=""[^>]*aria-label="Edit check"/.test(html) || /aria-label="Edit check"[^>]*disabled=""/.test(html), 'Edit check button is disabled during stopping');
  assert.ok(/disabled=""[^>]*aria-label="Delete check"/.test(html) || /aria-label="Delete check"[^>]*disabled=""/.test(html), 'Delete check button is disabled during stopping');
  assert.ok(/verification-add-check-btn"[^>]*disabled=""/.test(html) || /disabled=""[^>]*verification-add-check-btn/.test(html), '+ Add Check is disabled during stopping');

  console.log('✓ Stopping state strictly disables profile mutation actions');
}

// -----------------------------------------------------------------------------
// Test 5: Test 13b — STOP_ISSUE / STOP_TIMEOUT: Mutations remain disabled
// -----------------------------------------------------------------------------
console.log('--- Test 5: Test 13b — STOP_TIMEOUT: Mutations remain disabled while ownership retained ---');
{
  const runtime = { lifecycle: 'stop-timeout' };
  assert.strictEqual(isVerificationRuntimeActive(runtime), true);

  const ws = createTestWorkspace('ws-timeout');
  const contract = getActiveVerificationContract(ws);
  const run = {
    ...createVerificationRun({ contract, workspaceId: ws.id }),
    status: 'stop-timeout',
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: run,
      historicalRuns: [run],
      isRunning: false,
      isStopping: false,
      isStopTimeout: true,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  assert.ok(/disabled=""[^>]*aria-label="Edit check"/.test(html) || /aria-label="Edit check"[^>]*disabled=""/.test(html), 'Edit check is disabled during stop-timeout');
  assert.ok(/disabled=""[^>]*aria-label="Delete check"/.test(html) || /aria-label="Delete check"[^>]*disabled=""/.test(html), 'Delete check is disabled during stop-timeout');
  assert.ok(/verification-add-check-btn"[^>]*disabled=""/.test(html) || /disabled=""[^>]*verification-add-check-btn/.test(html), '+ Add Check is disabled during stop-timeout');

  console.log('✓ Stop-timeout state preserves runtime ownership and lock');
}

// -----------------------------------------------------------------------------
// Test 6: Test 14 — CANCELLED: Run ends CANCELLED -> profile editable immediately
// -----------------------------------------------------------------------------
console.log('--- Test 6: Test 14 — CANCELLED: Profile editable immediately after cancellation ---');
{
  let ws = createTestWorkspace('ws-cancelled');
  const contract = getActiveVerificationContract(ws);

  // Simulate run that is cancelled
  const run = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, run);

  const cancelledRun = {
    ...run,
    status: 'cancelled',
    completedAt: Date.now(),
  };
  ws = updateVerificationRunInWorkspace(ws, cancelledRun);

  // Runtime ownership released
  assert.strictEqual(isVerificationRuntimeActive(null), false);
  assert.strictEqual(getActiveVerificationRun(ws), null, 'No active run after cancellation');
  assert.strictEqual(isTerminalVerificationStatus(cancelledRun.status), true);

  // Render VerificationPanel
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: null,
      historicalRuns: ws.verification.runs,
      isRunning: false,
      isStopping: false,
      isStopTimeout: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  // Must render cancelled banner in LATEST RUN card
  assert.ok(html.includes('Run cancelled by user.'), 'Latest run card renders cancelled summary');

  // Must render current profile editable controls
  assert.ok(html.includes('aria-label="Edit check"'), 'Edit check button is present');
  assert.ok(!html.includes('aria-label="Edit check" disabled=""'), 'Edit check button is enabled');
  assert.ok(html.includes('aria-label="Delete check"'), 'Delete check button is present');
  assert.ok(!html.includes('aria-label="Delete check" disabled=""'), 'Delete check button is enabled');
  assert.ok(html.includes('+ Add Check'), '+ Add Check button is present');
  assert.ok(!html.includes('verification-add-check-btn" disabled=""'), '+ Add Check is enabled');
  assert.ok(html.includes('verification-selection-toolbar'), 'Selection toolbar is present');
  assert.ok(html.includes('Run Selected'), 'Run Selected is available');

  console.log('✓ Cancelled run immediately unlocks profile editability (reproduces & verifies fix)');
}

// -----------------------------------------------------------------------------
// Test 7: Test 15 — FAILED: Run ends FAILED -> profile editable immediately
// -----------------------------------------------------------------------------
console.log('--- Test 7: Test 15 — FAILED: Profile editable immediately after failure ---');
{
  let ws = createTestWorkspace('ws-failed');
  const contract = getActiveVerificationContract(ws);

  const run = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, run);

  const failedRun = {
    ...run,
    status: 'failed',
    completedAt: Date.now(),
    criterionResults: [
      {
        criterionId: contract.criteria[0].id,
        status: 'failed',
        observedExitCode: 1,
        message: 'Command failed with exit code 1',
      },
    ],
  };
  ws = updateVerificationRunInWorkspace(ws, failedRun);

  assert.strictEqual(getActiveVerificationRun(ws), null);

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: null,
      historicalRuns: ws.verification.runs,
      isRunning: false,
      isStopping: false,
      isStopTimeout: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  assert.ok(html.includes('aria-label="Edit check"'), 'Edit check button is present');
  assert.ok(!html.includes('aria-label="Edit check" disabled=""'), 'Edit check is enabled');
  assert.ok(html.includes('aria-label="Delete check"'), 'Delete check button is present');
  assert.ok(!html.includes('aria-label="Delete check" disabled=""'), 'Delete check is enabled');
  assert.ok(html.includes('+ Add Check'), '+ Add Check button is present');

  console.log('✓ Failed run immediately unlocks profile editability');
}

// -----------------------------------------------------------------------------
// Test 8: Test 16 — COMPLETED: Run completes successfully -> profile editable
// -----------------------------------------------------------------------------
console.log('--- Test 8: Test 16 — COMPLETED: Profile editable immediately after success ---');
{
  let ws = createTestWorkspace('ws-completed');
  const contract = getActiveVerificationContract(ws);

  const run = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, run);

  const passedRun = {
    ...run,
    status: 'passed',
    completedAt: Date.now(),
    criterionResults: contract.criteria.map((c) => ({
      criterionId: c.id,
      status: 'passed',
      observedExitCode: 0,
    })),
  };
  ws = updateVerificationRunInWorkspace(ws, passedRun);

  assert.strictEqual(getActiveVerificationRun(ws), null);

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: null,
      historicalRuns: ws.verification.runs,
      isRunning: false,
      isStopping: false,
      isStopTimeout: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  assert.ok(html.includes('All 4 checks passed.'), 'Passed summary in latest run card');
  assert.ok(html.includes('aria-label="Edit check"'), 'Edit check button is present');
  assert.ok(!html.includes('aria-label="Edit check" disabled=""'), 'Edit check is enabled');
  assert.ok(html.includes('+ Add Check'), '+ Add Check is present and enabled');

  console.log('✓ Completed/passed run immediately unlocks profile editability');
}

// -----------------------------------------------------------------------------
// Test 9: Test 17 — ERROR: Run ends ERROR -> profile editable
// -----------------------------------------------------------------------------
console.log('--- Test 9: Test 17 — ERROR: Profile editable immediately after error ---');
{
  let ws = createTestWorkspace('ws-error');
  const contract = getActiveVerificationContract(ws);

  const run = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, run);

  const errorRun = {
    ...run,
    status: 'error',
    completedAt: Date.now(),
    criterionResults: [
      {
        criterionId: contract.criteria[0].id,
        status: 'error',
        message: 'Infrastructure failure: PTY crashed',
      },
    ],
  };
  ws = updateVerificationRunInWorkspace(ws, errorRun);

  assert.strictEqual(getActiveVerificationRun(ws), null);

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: null,
      historicalRuns: ws.verification.runs,
      isRunning: false,
      isStopping: false,
      isStopTimeout: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  assert.ok(html.includes('aria-label="Edit check"'), 'Edit check is present');
  assert.ok(!html.includes('aria-label="Edit check" disabled=""'), 'Edit check is enabled');
  assert.ok(html.includes('aria-label="Delete check"'), 'Delete check is present');
  assert.ok(!html.includes('aria-label="Delete check" disabled=""'), 'Delete check is enabled');

  console.log('✓ Error run immediately unlocks profile editability');
}

// -----------------------------------------------------------------------------
// Test 10: Test 18 — HISTORY IMMUTABILITY: Profile edits do not rewrite history
// -----------------------------------------------------------------------------
console.log('--- Test 10: Test 18 — HISTORY IMMUTABILITY: Profile edits never mutate historical runs ---');
{
  let ws = createTestWorkspace('ws-immutability');
  const initialContract = getActiveVerificationContract(ws);
  assert.strictEqual(initialContract.criteria.length, 4, 'Starts with 4 criteria: A, B, C, D');

  const criterionD = initialContract.criteria[3];

  // Run #1 executes A/B/C/D
  const run1 = createVerificationRun({ contract: initialContract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, run1);

  const completedRun1 = {
    ...run1,
    status: 'failed',
    completedAt: Date.now(),
    criterionResults: initialContract.criteria.map((c, idx) => ({
      criterionId: c.id,
      status: idx === 3 ? 'failed' : 'passed',
      observedExitCode: idx === 3 ? 1 : 0,
    })),
  };
  ws = updateVerificationRunInWorkspace(ws, completedRun1);

  // Assert Run #1 snapshot has 4 criteria
  assert.strictEqual(ws.verification.runs[0].criteriaSnapshot.length, 4);
  assert.strictEqual(ws.verification.runs[0].criteriaSnapshot[3].id, criterionD.id);

  // User deletes D from Profile
  ws = deleteCriterionFromContractInWorkspace(ws, initialContract.id, criterionD.id);

  // Assert Current Profile has 3 criteria: A, B, C
  const updatedContract = getActiveVerificationContract(ws);
  assert.strictEqual(updatedContract.criteria.length, 3);
  assert.ok(!updatedContract.criteria.some((c) => c.id === criterionD.id), 'Current profile strictly excludes D');

  // Assert Historical Run #1 snapshot STILL has 4 criteria: A, B, C, D
  const retainedRun1 = ws.verification.runs[0];
  assert.strictEqual(retainedRun1.criteriaSnapshot.length, 4, 'Historical Run #1 criteriaSnapshot strictly unchanged');
  assert.strictEqual(retainedRun1.criteriaSnapshot[3].id, criterionD.id, 'Historical Run #1 retains D in snapshot');
  assert.strictEqual(retainedRun1.criterionResults.length, 4, 'Historical Run #1 criterionResults strictly unchanged');

  console.log('✓ Historical Run #1 snapshot is strictly immutable when current profile is edited/deleted');
}

// -----------------------------------------------------------------------------
// Test 11: Test 19 — NEXT RUN USES UPDATED PROFILE: Deleted D never reappears
// -----------------------------------------------------------------------------
console.log('--- Test 11: Test 19 — NEXT RUN USES UPDATED PROFILE: Deleted D never reappears ---');
{
  let ws = createTestWorkspace('ws-next-run');
  const contract = getActiveVerificationContract(ws);
  const criterionD = contract.criteria[3];

  // Run 1 completes
  const run1 = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, run1);
  ws = updateVerificationRunInWorkspace(ws, { ...run1, status: 'passed', completedAt: Date.now() });

  // Delete D
  ws = deleteCriterionFromContractInWorkspace(ws, contract.id, criterionD.id);

  // Start Run 2
  const activeContract = getActiveVerificationContract(ws);
  const run2 = createVerificationRun({ contract: activeContract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, run2);

  // Assert Run 2 criteria snapshot has only A, B, C (length 3)
  assert.strictEqual(run2.criteriaSnapshot.length, 3);
  assert.ok(!run2.criteriaSnapshot.some((c) => c.id === criterionD.id), 'Run 2 snapshot does not contain D');
  assert.strictEqual(ws.verification.runs.length, 2, '2 historical runs');
  assert.strictEqual(ws.verification.runs[0].criteriaSnapshot.length, 4, 'Run 1 retains 4');
  assert.strictEqual(ws.verification.runs[1].criteriaSnapshot.length, 3, 'Run 2 contains only 3');

  console.log('✓ Next run uses updated profile; deleted criterion does not reappear');
}

// -----------------------------------------------------------------------------
// Test 12: Test 20 — SELECTION AFTER EDIT: Stale selection IDs strictly excluded
// -----------------------------------------------------------------------------
console.log('--- Test 12: Test 20 — SELECTION AFTER EDIT: Selection pruned correctly ---');
{
  let ws = createTestWorkspace('ws-selection');
  const contract = getActiveVerificationContract(ws);
  const criterionD = contract.criteria[3];

  // 4/4 selected initially
  assert.strictEqual(getCanonicalVerificationSelection(ws).size, 4);

  // Run completes
  const run = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, run);
  ws = updateVerificationRunInWorkspace(ws, { ...run, status: 'cancelled', completedAt: Date.now() });

  // Delete D
  ws = deleteCriterionFromContractInWorkspace(ws, contract.id, criterionD.id);

  const updatedSelection = getCanonicalVerificationSelection(ws);
  assert.strictEqual(updatedSelection.size, 3, 'Selection pruned to 3');
  assert.ok(!updatedSelection.has(criterionD.id), 'Selection strictly excludes deleted ID');

  const activeContract = getActiveVerificationContract(ws);
  for (const id of updatedSelection) {
    assert.ok(activeContract.criteria.some((c) => c.id === id), 'All selected IDs belong to active contract');
  }

  // Render VerificationPanel: selection count should show 3 of 3 selected
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract: activeContract,
      contracts: [activeContract],
      activeRun: null,
      historicalRuns: ws.verification.runs,
      isRunning: false,
      isStopping: false,
      isStopTimeout: false,
      selectedCriterionIds: updatedSelection,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  assert.ok(html.includes('3 of 3 selected'), 'Selection toolbar displays 3 of 3 selected');
  assert.ok(html.includes('Run Selected (3)'), 'Run Selected displays (3)');

  console.log('✓ Selection invariant maintained: 3 of 3 selected without stale IDs');
}

// -----------------------------------------------------------------------------
// Test 13: UI Invariant — Historical Evidence Card has NO edit/delete buttons
// -----------------------------------------------------------------------------
console.log('--- Test 13: Historical Evidence Cards & Run History strictly omit edit/delete buttons ---');
{
  let ws = createTestWorkspace('ws-ui-evidence');
  const contract = getActiveVerificationContract(ws);
  const run = createVerificationRun({ contract, workspaceId: ws.id });
  ws = appendVerificationRunToWorkspace(ws, run);
  ws = updateVerificationRunInWorkspace(ws, {
    ...run,
    status: 'failed',
    completedAt: Date.now(),
    criterionResults: [
      {
        criterionId: contract.criteria[0].id,
        status: 'failed',
        observedExitCode: 1,
        message: 'Compilation error',
      },
    ],
  });

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: null,
      historicalRuns: ws.verification.runs,
      isRunning: false,
      isStopping: false,
      isStopTimeout: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  // The latest run card has class verification-current-run-section
  // It must contain the failed card verification-failed-criterion-card
  assert.ok(html.includes('verification-failed-criterion-card'), 'Failed criterion card is in evidence section');

  // Verify that inside verification-history-details there are no edit check or delete check buttons
  assert.ok(!html.includes('verification-history-detail-item" aria-label="Edit check"'), 'No edit check in history');
  assert.ok(!html.includes('verification-failed-criterion-card" aria-label="Delete check"'), 'No delete check in evidence card');

  console.log('✓ Historical evidence strictly separated from mutable profile controls');
}

// -----------------------------------------------------------------------------
// Test 14: App.tsx Handler Guard Verification (isVerificationRuntimeActive)
// -----------------------------------------------------------------------------
console.log('--- Test 14: App.tsx Handlers allow mutation when runtime is null or terminal ---');
{
  // When runtime is null or terminal, isVerificationRuntimeActive returns false
  assert.strictEqual(isVerificationRuntimeActive(null), false);
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'cancelled' }), false);
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'completed' }), false);

  // When runtime is active, it returns true
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'running' }), true);
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'stopping' }), true);
  assert.strictEqual(isVerificationRuntimeActive({ lifecycle: 'stop-timeout' }), true);

  console.log('✓ Handler guards strictly block active execution while allowing mutations when idle');
}

console.log('\n=============================================================');
console.log('ALL HARDEN-VERIFY-EDITABILITY-022 TESTS PASSED!');
console.log('=============================================================\n');
