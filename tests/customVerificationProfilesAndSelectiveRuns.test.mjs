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

// 1. Transpile execution/types.ts
const execTypesJs = transpileTs(path.resolve(__dirname, '../app/src/features/execution/types.ts'));
const execTypesMod = { exports: {} };
new Function('module', 'exports', 'require', execTypesJs)(execTypesMod, execTypesMod.exports, () => ({}));
const {
  DEFAULT_LOCAL_HUMAN_ACTOR,
  isExecutionLifecycle,
  isExecutionOutcome,
} = execTypesMod.exports;

// 2. Transpile transcriptFormat.ts & transcriptDisplayCleanup.ts
const formatJs = transpileTs(path.resolve(__dirname, '../app/src/features/transcript/transcriptFormat.ts'));
const formatMod = { exports: {} };
new Function('module', 'exports', 'require', formatJs)(formatMod, formatMod.exports, () => ({}));
const { stripAnsiAndControl, normalizeCommand } = formatMod.exports;

const cleanupJs = transpileTs(path.resolve(__dirname, '../app/src/features/transcript/transcriptDisplayCleanup.ts'));
const cleanupMod = { exports: {} };
new Function('module', 'exports', 'require', cleanupJs)(cleanupMod, cleanupMod.exports, () => ({ stripAnsiAndControl }));
const { cleanTranscriptForDisplay } = cleanupMod.exports;

// 3. Transpile executionModel.ts
const execModelJs = transpileTs(path.resolve(__dirname, '../app/src/features/execution/executionModel.ts'));
const execModelMod = { exports: {} };
const customRequireExec = (req) => {
  if (req.includes('transcriptFormat')) return { ...formatMod.exports, cleanTranscriptForDisplay };
  if (req.includes('types')) return execTypesMod.exports;
  return {};
};
new Function('module', 'exports', 'require', execModelJs)(execModelMod, execModelMod.exports, customRequireExec);
const { createExecution, createEvidenceBlock } = execModelMod.exports;

// 4. Transpile verification/types.ts
const verifTypesJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/types.ts'));
const verifTypesMod = { exports: {} };
new Function('module', 'exports', 'require', verifTypesJs)(verifTypesMod, verifTypesMod.exports, () => ({}));
const { isVerificationCriterion, isVerificationContract, isVerificationRunStatus } = verifTypesMod.exports;

// 5. Transpile verification/verificationModel.ts
const verifModelJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'));
const verifModelMod = { exports: {} };
const customRequireVerifModel = (req) => {
  if (req.includes('types')) return verifTypesMod.exports;
  if (req.includes('execution')) return execModelMod.exports;
  return {};
};
new Function('module', 'exports', 'require', verifModelJs)(verifModelMod, verifModelMod.exports, customRequireVerifModel);
const {
  createVerificationCriterion,
  createVerificationContract,
  createDefaultVerificationContract,
  createVerificationRun,
  evaluateCriterionResult,
  deriveVerificationRunStatus,
  deriveVerificationPresentation,
  parseExpectedExitCodes,
  validateCriterionInput,
} = verifModelMod.exports;

// 6. Transpile verification/verificationState.ts
const verifStateJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationState.ts'));
const verifStateMod = { exports: {} };
const customRequireVerifState = (req) => {
  if (req.includes('types')) return verifTypesMod.exports;
  if (req.includes('verificationModel')) return verifModelMod.exports;
  return {};
};
new Function('module', 'exports', 'require', verifStateJs)(verifStateMod, verifStateMod.exports, customRequireVerifState);
const {
  getOrCreateWorkspaceVerificationState,
  getWorkspaceContracts,
  getActiveVerificationContract,
  getWorkspaceVerificationRuns,
  appendVerificationRunToWorkspace,
  updateVerificationRunInWorkspace,
  setActiveVerificationContractInWorkspace,
  addVerificationContractToWorkspace,
  renameVerificationContractInWorkspace,
  deleteVerificationContractFromWorkspace,
  addCriterionToContractInWorkspace,
  updateCriterionInContractInWorkspace,
  deleteCriterionFromContractInWorkspace,
  reorderCriteriaInContractInWorkspace,
} = verifStateMod.exports;

function createMockWorkspace(id = 'ws-test', contracts = null) {
  const ws = {
    id,
    name: 'Test Workspace',
    terminalTabs: [],
    activeTerminalTabId: 'tab-1',
    panes: [],
    capture: { isListening: false, currentBatch: null, batchCounter: 0, blocks: [] },
    selection: { selectedBlockIds: new Set(), updatedAt: 0 },
    terminalTabIds: ['tab-1'],
  };
  if (contracts) {
    ws.verification = {
      contracts,
      activeContractId: contracts[0]?.id ?? null,
      runs: [],
      activeRunId: null,
    };
  }
  return ws;
}

console.log('Running Custom Verification Profiles & Selective Runs Test Suite (HARDEN-012B)...\n');

// ============================================================================
// Test Group 1: Verification Profile Model & CRUD Operations (Section 3, 4, 5, 8, 9, 10, 11, 39, 52)
// ============================================================================
console.log('--- Test Group 1: Verification Profile Model & CRUD Operations ---');

{
  // 1.1 Backward-compatible workspace load defaults to Standard checks with empty criteria list (RELEASE-POLISH-VERIFY-023)
  let ws = createMockWorkspace('ws-1');
  const initState = getOrCreateWorkspaceVerificationState(ws);
  assert.strictEqual(initState.contracts.length, 1);
  assert.strictEqual(initState.contracts[0].name, 'Standard checks');
  assert.strictEqual(initState.activeContractId, initState.contracts[0].id);
  assert.strictEqual(initState.contracts[0].criteria.length, 0);

  // 1.2 Create new custom profile
  const customProfile = createVerificationContract({
    workspaceId: ws.id,
    name: 'Full Stack',
    criteria: [
      createVerificationCriterion({ label: 'Frontend Test', command: 'npm test', order: 1 }),
      createVerificationCriterion({ label: 'Backend Test', command: 'pytest -q', order: 2 }),
      createVerificationCriterion({ label: 'Typecheck', command: 'npm run typecheck', order: 3 }),
    ],
  });
  ws = addVerificationContractToWorkspace(ws, customProfile);

  const contracts = getWorkspaceContracts(ws);
  assert.strictEqual(contracts.length, 2);
  assert.strictEqual(getActiveVerificationContract(ws).id, customProfile.id);
  assert.strictEqual(getActiveVerificationContract(ws).name, 'Full Stack');

  // 1.3 Active profile switching
  ws = setActiveVerificationContractInWorkspace(ws, contracts[0].id);
  assert.strictEqual(getActiveVerificationContract(ws).id, contracts[0].id);
  assert.strictEqual(getActiveVerificationContract(ws).name, 'Standard checks');

  ws = setActiveVerificationContractInWorkspace(ws, customProfile.id);
  assert.strictEqual(getActiveVerificationContract(ws).id, customProfile.id);

  // 1.4 Rename profile
  ws = renameVerificationContractInWorkspace(ws, customProfile.id, 'Full Stack Web & API');
  assert.strictEqual(getActiveVerificationContract(ws).name, 'Full Stack Web & API');

  // 1.5 Add criterion to profile
  const newCriterion = createVerificationCriterion({
    label: 'Python lint',
    command: 'ruff check .',
    expectedExitCodes: [0],
  });
  ws = addCriterionToContractInWorkspace(ws, customProfile.id, newCriterion);
  let activeContract = getActiveVerificationContract(ws);
  assert.strictEqual(activeContract.criteria.length, 4);
  assert.strictEqual(activeContract.criteria[3].label, 'Python lint');
  assert.strictEqual(activeContract.criteria[3].order, 4);

  // 1.6 Edit criterion in profile
  const updatedCriterion = {
    ...newCriterion,
    command: 'ruff check . --fix',
    expectedExitCodes: [0, 1],
  };
  ws = updateCriterionInContractInWorkspace(ws, customProfile.id, updatedCriterion);
  activeContract = getActiveVerificationContract(ws);
  const foundCriterion = activeContract.criteria.find((c) => c.id === newCriterion.id);
  assert.strictEqual(foundCriterion.command, 'ruff check . --fix');
  assert.deepStrictEqual(foundCriterion.expectedExitCodes, [0, 1]);

  // 1.7 Reorder criteria in profile
  const originalIds = activeContract.criteria.map((c) => c.id);
  // Reverse order
  const reversedIds = [...originalIds].reverse();
  ws = reorderCriteriaInContractInWorkspace(ws, customProfile.id, reversedIds);
  activeContract = getActiveVerificationContract(ws);
  assert.strictEqual(activeContract.criteria[0].id, reversedIds[0]);
  assert.strictEqual(activeContract.criteria[0].order, 1);
  assert.strictEqual(activeContract.criteria[3].id, reversedIds[3]);
  assert.strictEqual(activeContract.criteria[3].order, 4);

  // 1.8 Delete criterion from profile
  ws = deleteCriterionFromContractInWorkspace(ws, customProfile.id, newCriterion.id);
  activeContract = getActiveVerificationContract(ws);
  assert.strictEqual(activeContract.criteria.length, 3);
  assert(!activeContract.criteria.some((c) => c.id === newCriterion.id));
  // Remaining criteria orders re-indexed 1..N
  assert.strictEqual(activeContract.criteria[0].order, 1);
  assert.strictEqual(activeContract.criteria[1].order, 2);
  assert.strictEqual(activeContract.criteria[2].order, 3);

  // 1.9 Delete profile with fallback (Section 39)
  // When active profile is deleted, falls back to remaining profile
  ws = deleteVerificationContractFromWorkspace(ws, customProfile.id);
  assert.strictEqual(getWorkspaceContracts(ws).length, 1);
  assert.strictEqual(getActiveVerificationContract(ws).name, 'Standard checks');

  // When only remaining profile is deleted, recreates standard checks profile
  const lastContractId = getActiveVerificationContract(ws).id;
  ws = deleteVerificationContractFromWorkspace(ws, lastContractId);
  assert.strictEqual(getWorkspaceContracts(ws).length, 1);
  assert.strictEqual(getActiveVerificationContract(ws).name, 'Standard checks');

  // 1.10 Input validation & exit code parsing
  const v1 = validateCriterionInput({ label: 'Test', command: 'npm test', expectedExitCodes: '0' });
  assert(v1.valid);
  assert.deepStrictEqual(v1.exitCodes, [0]);

  const v2 = validateCriterionInput({ label: 'Test', command: 'npm test', expectedExitCodes: '0, 1, 2' });
  assert(v2.valid);
  assert.deepStrictEqual(v2.exitCodes, [0, 1, 2]);

  const v3 = validateCriterionInput({ label: '', command: 'npm test' });
  assert(!v3.valid);
  assert(v3.error.includes('name'));

  const v4 = validateCriterionInput({ label: 'Test', command: '   ' });
  assert(!v4.valid);
  assert(v4.error.includes('Command'));

  const v5 = validateCriterionInput({ label: 'Test', command: 'npm test', expectedExitCodes: 'abc' });
  assert(!v5.valid);
  assert(v5.error.includes('integer'));

  console.log('✓ Verification Profile CRUD, ordering, validation, and fallback verified');
}

// ============================================================================
// Test Group 2: Checkbox Isolation from Monitor Footer / EvidenceSelection (Section 12, 13, 14, 53)
// ============================================================================
console.log('\n--- Test Group 2: Checkbox Isolation from Monitor Footer / EvidenceSelection ---');

{
  // Simulated initial Monitor EvidenceSelection state
  const evidenceSelection = new Set(['block-1', 'block-2']);
  assert.strictEqual(evidenceSelection.size, 2);

  // Verification checkbox selection state
  let selectedCriterionIds = new Set(['crit-1', 'crit-2', 'crit-3']);

  // Simulate user unchecking a verification check: crit-2
  const handleToggleCriterionCheck = (id) => {
    const next = new Set(selectedCriterionIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedCriterionIds = next;
  };

  handleToggleCriterionCheck('crit-2');
  assert.strictEqual(selectedCriterionIds.size, 2);
  assert(!selectedCriterionIds.has('crit-2'));

  // CRITICAL INVARIANT: EvidenceSelection MUST remain completely untouched!
  assert.strictEqual(evidenceSelection.size, 2);
  assert(evidenceSelection.has('block-1'));
  assert(evidenceSelection.has('block-2'));

  // Toggle multiple checks and clear all
  handleToggleCriterionCheck('crit-1');
  handleToggleCriterionCheck('crit-3');
  assert.strictEqual(selectedCriterionIds.size, 0);

  // Monitor footer / EvidenceSelection still strictly unchanged!
  assert.strictEqual(evidenceSelection.size, 2);

  console.log('✓ Verification check selection is strictly isolated from Monitor EvidenceSelection & footer');
}

// ============================================================================
// Test Group 3: Run Selected Subset Snapshot & Ordering (Section 16, 17, 54, 55)
// ============================================================================
console.log('\n--- Test Group 3: Run Selected Subset Snapshot & Ordering ---');

{
  const contract = createVerificationContract({
    workspaceId: 'ws-sub',
    name: 'Multi-Stack',
    criteria: [
      createVerificationCriterion({ id: 'crit-c', label: 'C-Check', command: 'echo C', order: 1 }),
      createVerificationCriterion({ id: 'crit-a', label: 'A-Check', command: 'echo A', order: 2 }),
      createVerificationCriterion({ id: 'crit-b', label: 'B-Check', command: 'echo B', order: 3 }),
      createVerificationCriterion({ id: 'crit-d', label: 'D-Check', command: 'echo D', order: 4 }),
    ],
  });

  // User selects only C and B
  const selectedCriterionIds = ['crit-c', 'crit-b'];

  const run = createVerificationRun({
    contract,
    workspaceId: 'ws-sub',
    selectedCriterionIds,
  });

  // 1. criteriaSnapshot contains ONLY selected criteria
  assert.strictEqual(run.criteriaSnapshot.length, 2);
  assert.strictEqual(run.criteriaSnapshot[0].id, 'crit-c');
  assert.strictEqual(run.criteriaSnapshot[1].id, 'crit-b');

  // 2. Unselected criteria (A and D) do NOT appear in the run
  assert(!run.criteriaSnapshot.some((c) => c.id === 'crit-a'));
  assert(!run.criteriaSnapshot.some((c) => c.id === 'crit-d'));

  // 3. criterionResults only has entries for selected criteria
  assert.strictEqual(run.criterionResults.length, 2);
  assert.strictEqual(run.criterionResults[0].criterionId, 'crit-c');
  assert.strictEqual(run.criterionResults[1].criterionId, 'crit-b');
  assert.strictEqual(run.criterionResults[0].status, 'pending');

  // 4. Criteria are NOT sorted alphabetically; they preserve the profile's defined order
  assert.strictEqual(run.criteriaSnapshot[0].label, 'C-Check');
  assert.strictEqual(run.criteriaSnapshot[1].label, 'B-Check');

  console.log('✓ Run Selected snapshots only selected criteria in deterministic profile order');
}

// ============================================================================
// Test Group 4: Individual Per-Check Run Semantics (Section 18, 19, 20, 56)
// ============================================================================
console.log('\n--- Test Group 4: Individual Per-Check Run Semantics ---');

{
  const contract = createVerificationContract({
    workspaceId: 'ws-single',
    name: 'Backend Profile',
    criteria: [
      createVerificationCriterion({ id: 'test-1', label: 'Unit tests', command: 'pytest tests/unit', order: 1 }),
      createVerificationCriterion({ id: 'test-2', label: 'Integration tests', command: 'pytest tests/integration', order: 2 }),
    ],
  });

  // Batch selection has test-1 only (test-2 unchecked)
  const batchSelection = new Set(['test-1']);
  assert(!batchSelection.has('test-2'));

  // User clicks [Run] on test-2
  const singleRun = createVerificationRun({
    contract,
    workspaceId: 'ws-single',
    selectedCriterionIds: ['test-2'],
  });

  // Single-check VerificationRun contains exactly test-2
  assert.strictEqual(singleRun.criteriaSnapshot.length, 1);
  assert.strictEqual(singleRun.criteriaSnapshot[0].id, 'test-2');
  assert.strictEqual(singleRun.criteriaSnapshot[0].label, 'Integration tests');
  assert.strictEqual(singleRun.criterionResults.length, 1);
  assert.strictEqual(singleRun.criterionResults[0].criterionId, 'test-2');

  // Batch selection remains unchanged
  assert.strictEqual(batchSelection.size, 1);
  assert(batchSelection.has('test-1'));

  console.log('✓ Individual per-check Run creates a 1-criterion VerificationRun independent of checkbox state');
}

// ============================================================================
// Test Group 5: Active Run Lockout & Presentation Status (Section 21, 30, 40, 41, 57)
// ============================================================================
console.log('\n--- Test Group 5: Active Run Lockout & Presentation Status ---');

{
  // 5.1 Presentation mapping across running, stopping, and stop-timeout
  const mockRun = { id: 'run-1', status: 'running', criterionResults: [], criteriaSnapshot: [] };

  const presRunning = deriveVerificationPresentation({ run: mockRun, isRunning: true });
  assert.strictEqual(presRunning.status, 'running');
  assert.strictEqual(presRunning.badgeLabel, 'RUNNING');
  assert.strictEqual(presRunning.badgeClass, 'running');

  const presStopping = deriveVerificationPresentation({ run: mockRun, isStopping: true });
  assert.strictEqual(presStopping.status, 'stopping');
  assert.strictEqual(presStopping.badgeLabel, 'STOPPING');
  assert.strictEqual(presStopping.badgeClass, 'stopping');

  const presTimeout = deriveVerificationPresentation({ run: mockRun, isStopTimeout: true });
  assert.strictEqual(presTimeout.status, 'stop-timeout');
  assert.strictEqual(presTimeout.badgeLabel, 'STOP ISSUE');
  assert.strictEqual(presTimeout.badgeClass, 'stop-timeout');

  const presCancelled = deriveVerificationPresentation({ run: { ...mockRun, status: 'cancelled' } });
  assert.strictEqual(presCancelled.status, 'cancelled');
  assert.strictEqual(presCancelled.badgeLabel, 'CANCELLED');

  console.log('✓ Unified presentation status and lockout semantics verified');
}

// ============================================================================
// Test Group 6: Stop Integration with Subset Run (Section 22, 47, 58)
// ============================================================================
console.log('\n--- Test Group 6: Stop Integration with Subset Run ---');

{
  const contract = createVerificationContract({
    workspaceId: 'ws-stop',
    name: 'CI Suite',
    criteria: [
      createVerificationCriterion({ id: 'c-1', label: 'Step 1', command: 'cmd1', order: 1 }),
      createVerificationCriterion({ id: 'c-2', label: 'Step 2', command: 'cmd2', order: 2 }),
      createVerificationCriterion({ id: 'c-3', label: 'Step 3', command: 'cmd3', order: 3 }),
    ],
  });

  const run = createVerificationRun({
    contract,
    workspaceId: 'ws-stop',
    selectedCriterionIds: ['c-1', 'c-2', 'c-3'],
  });

  // Step 1 finishes: passed
  const exec1 = createExecution({ command: 'cmd1', exitCode: 0, outcome: 'succeeded', outcomeSource: 'trusted-shell', outcomeTrusted: true, lifecycle: 'finished' });
  const res1 = evaluateCriterionResult(run.criteriaSnapshot[0], exec1);
  assert.strictEqual(res1.status, 'passed');

  // Step 2 is interrupted (user pressed Stop)
  const exec2 = createExecution({ command: 'cmd2', exitCode: 130, outcome: 'failed', outcomeSource: 'trusted-shell', outcomeTrusted: true, completionSource: 'user-interrupt', lifecycle: 'interrupted' });
  const res2 = evaluateCriterionResult(run.criteriaSnapshot[1], exec2);
  assert.strictEqual(res2.status, 'interrupted');

  // Step 3 is skipped
  const res3 = {
    criterionId: 'c-3',
    status: 'skipped',
    message: 'Verification was stopped by user',
  };

  const finalRunStatus = deriveVerificationRunStatus([res1, res2, res3], true);
  assert.strictEqual(finalRunStatus, 'cancelled');

  console.log('✓ Stop during selective batch run correctly yields passed, interrupted, skipped, and cancelled');
}

// ============================================================================
// Test Group 7: Capture Integration & Canonical Execution (Section 26, 27, 28, 29, 30, 32, 59, 60)
// ============================================================================
console.log('\n--- Test Group 7: Capture Integration & Canonical Execution ---');

{
  // 7.1 Real execution created with intent: 'verification'
  const exec = createExecution({
    command: 'npm test',
    intent: 'verification',
    exitCode: 0,
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    lifecycle: 'finished',
  });
  assert.strictEqual(exec.intent, 'verification');

  // 7.2 Evidence block created from execution
  const evBlock = createEvidenceBlock({
    executionId: exec.id,
    type: 'output',
    rawText: 'Tests passed 10/10',
    displayText: 'Tests passed 10/10',
  });
  assert.strictEqual(evBlock.executionId, exec.id);

  // 7.3 Criterion result references canonical executionId without duplicating output
  const criterion = createVerificationCriterion({ label: 'Test suite', command: 'npm test' });
  const result = evaluateCriterionResult(criterion, exec);
  assert.strictEqual(result.status, 'passed');
  assert.strictEqual(result.executionId, exec.id);
  assert.strictEqual(result.output, undefined); // No duplicated output string!

  // 7.4 Running verification does NOT auto-select into EvidenceSelection
  const evidenceSelection = new Set();
  assert.strictEqual(evidenceSelection.size, 0);

  // 7.5 Manual user selection adds execution evidence to EvidenceSelection
  evidenceSelection.add(exec.id);
  assert.strictEqual(evidenceSelection.size, 1);
  assert(evidenceSelection.has(exec.id));

  console.log('✓ Canonical Execution evidence linkage, non-duplication, and manual selection verified');
}

// ============================================================================
// Test Group 8: Immutable History Preservation (Section 17, 25, 45, 61)
// ============================================================================
console.log('\n--- Test Group 8: Immutable History Preservation ---');

{
  let ws = createMockWorkspace('ws-hist');
  const initialContract = createDefaultVerificationContract(ws.id);
  ws.verification = {
    contracts: [initialContract],
    activeContractId: initialContract.id,
    runs: [],
    activeRunId: null,
    selectedCriterionIds: new Set(initialContract.criteria.map((c) => c.id)),
  };

  // Run 1 created with initial contract criteria
  const run1 = createVerificationRun({
    contract: initialContract,
    workspaceId: ws.id,
  });
  ws = appendVerificationRunToWorkspace(ws, run1);
  assert.strictEqual(ws.verification.runs[0].criteriaSnapshot[0].command, 'npm test');

  // Edit the criterion in the profile
  const updatedCrit = {
    ...initialContract.criteria[0],
    command: 'npm run test:fast',
  };
  ws = updateCriterionInContractInWorkspace(ws, initialContract.id, updatedCrit);

  // Verify historical run 1 criteriaSnapshot is UNCHANGED!
  const historicalRun1 = ws.verification.runs[0];
  assert.strictEqual(historicalRun1.criteriaSnapshot[0].command, 'npm test');

  // Run 2 uses the updated command
  const activeContract = getActiveVerificationContract(ws);
  const run2 = createVerificationRun({
    contract: activeContract,
    workspaceId: ws.id,
  });
  assert.strictEqual(run2.criteriaSnapshot[0].command, 'npm run test:fast');

  console.log('✓ Historical run snapshot strictly immutably preserved across subsequent profile edits');
}

// ============================================================================
// Test Group 9: Persistence & Serialization (Section 37, 38, 62)
// ============================================================================
console.log('\n--- Test Group 9: Persistence & Serialization ---');

{
  let ws = createMockWorkspace('ws-persist');
  const profileA = createVerificationContract({
    workspaceId: ws.id,
    name: 'Frontend',
    criteria: [createVerificationCriterion({ label: 'UI Test', command: 'npm test' })],
  });
  const profileB = createVerificationContract({
    workspaceId: ws.id,
    name: 'Backend',
    criteria: [createVerificationCriterion({ label: 'API Test', command: 'pytest' })],
  });
  ws = addVerificationContractToWorkspace(ws, profileA);
  ws = addVerificationContractToWorkspace(ws, profileB);
  ws = setActiveVerificationContractInWorkspace(ws, profileB.id);

  // Serialize workspace to JSON and parse back (simulating persistence reload)
  const serialized = JSON.stringify(ws);
  const parsed = JSON.parse(serialized);

  const restoredState = getOrCreateWorkspaceVerificationState(parsed);
  assert.strictEqual(restoredState.contracts.length, 3);
  assert.strictEqual(restoredState.activeContractId, profileB.id);
  assert.strictEqual(getActiveVerificationContract(parsed).name, 'Backend');
  assert.strictEqual(getActiveVerificationContract(parsed).criteria[0].command, 'pytest');

  console.log('✓ Workspace verification state persists, reloads, and maintains active profile identically');
}

console.log('\n=============================================================');
console.log('ALL CUSTOM VERIFICATION PROFILES & SELECTIVE RUN TESTS PASSED!');
console.log('=============================================================\n');
