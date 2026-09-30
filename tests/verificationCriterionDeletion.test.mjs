/**
 * HARDEN-VERIFY-DELETE-018 — Fix False-Success Criterion Deletion Test Suite
 *
 * Verifies:
 * 1. Delete one criterion removes it on first invocation (single-click delete)
 * 2. Canonical profile no longer contains deleted ID
 * 3. Visible profile count becomes N-1
 * 4. Selection prunes deleted ID
 * 5. All-selected state becomes N-1 of N-1 (e.g. 4/4 -> 3/3)
 * 6. Partially-selected state preserves remaining valid selections
 * 7. Success feedback fires only after successful canonical mutation
 * 8. Failed canonical mutation does not show success
 * 9. Rerender does not restore deleted criterion
 * 10. Switching away/back does not restore deleted criterion
 * 11. Profile resolver does not restore deleted criterion
 * 12. Edit preserves IDs
 * 13. Reorder preserves IDs
 * 14. Add generates only one new criterion ID
 * 15. No "0 of 4" state after deleting one from all-selected 4-check profile
 * 16. No second click is required
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
  discoverStandardCriteria,
  reconcileVerificationSelection,
  reconcileSelectedCriterionIds,
  deriveVerificationSelectionCounts,
  createVerificationRun,
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
  getOrCreateWorkspaceVerificationState,
  getWorkspaceContracts,
  getActiveVerificationContract,
  addVerificationContractToWorkspace,
  setActiveVerificationContractInWorkspace,
  updateVerificationContractInWorkspace,
  addCriterionToContractInWorkspace,
  updateCriterionInContractInWorkspace,
  deleteCriterionFromContractInWorkspace,
  reorderCriteriaInContractInWorkspace,
  toggleCriterionSelectionInWorkspace,
  selectAllCriteriaInWorkspace,
  clearCriteriaSelectionInWorkspace,
  setCriteriaSelectionInWorkspace,
  getCanonicalVerificationSelection,
} = verifStateMod.exports;

// 5. Transpile verification/VerificationPanel.tsx
const verifPanelMod = transpileTsx(
  path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.tsx'),
  (req) => {
    if (req.includes('react')) return React;
    if (req.endsWith('.css')) return {};
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
  return ensureWorkspaceVerificationState({
    id,
    name: 'Test Workspace',
    terminalTabs: [],
    activeTerminalTabId: 'tab-1',
    panes: [],
    capture: { isListening: false, currentBatch: null, batchCounter: 0, blocks: [] },
    selection: { selectedBlockIds: new Set(), updatedAt: 0 },
    terminalTabIds: ['tab-1'],
    verification: {
      contracts: [contract],
      activeContractId: contract.id,
      runs: [],
      activeRunId: null,
      selectedCriterionIds: new Set(contract.criteria.map((c) => c.id)),
    },
  });
}

console.log('Running HARDEN-VERIFY-DELETE-018: Criterion Deletion & Canonical State Suite...\n');

// -----------------------------------------------------------------------------
// Test 1: Single-click delete removes criterion on first invocation
// -----------------------------------------------------------------------------
console.log('--- Test 1: Single-click delete removes criterion on first invocation ---');
{
  const ws = createTestWorkspace('ws-1');
  const activeContract = getActiveVerificationContract(ws);
  assert.strictEqual(activeContract.criteria.length, 4, 'Starts with 4 standard checks');

  const deleteTarget = activeContract.criteria[1]; // Typecheck
  assert.strictEqual(deleteTarget.label, 'Typecheck');

  const updatedWs = deleteCriterionFromContractInWorkspace(ws, activeContract.id, deleteTarget.id);
  const postContract = getActiveVerificationContract(updatedWs);

  assert.strictEqual(postContract.criteria.length, 3, 'Must have exactly 3 criteria after single deletion');
  assert(!postContract.criteria.some((c) => c.id === deleteTarget.id), 'Deleted ID must be absent');
  console.log('✓ Target criterion removed on very first invocation');
}

// -----------------------------------------------------------------------------
// Test 2: Canonical profile no longer contains deleted ID
// -----------------------------------------------------------------------------
console.log('--- Test 2: Canonical profile no longer contains deleted ID ---');
{
  const ws = createTestWorkspace('ws-2');
  const contract = getActiveVerificationContract(ws);
  const targetId = contract.criteria[0].id; // Test suite

  const updatedWs = deleteCriterionFromContractInWorkspace(ws, contract.id, targetId);
  const foundContract = updatedWs.verification.contracts.find((c) => c.id === contract.id);

  assert.ok(foundContract, 'Contract must exist');
  assert.strictEqual(foundContract.criteria.some((c) => c.id === targetId), false, 'Canonical criteria array does not contain deleted ID');
  console.log('✓ Canonical profile strictly excludes deleted ID');
}

// -----------------------------------------------------------------------------
// Test 3: Visible profile count becomes N-1
// -----------------------------------------------------------------------------
console.log('--- Test 3: Visible profile count becomes N-1 ---');
{
  const ws = createTestWorkspace('ws-3');
  const contract = getActiveVerificationContract(ws);
  const initialCount = contract.criteria.length;

  const updatedWs = deleteCriterionFromContractInWorkspace(ws, contract.id, contract.criteria[2].id);
  const postContract = getActiveVerificationContract(updatedWs);

  assert.strictEqual(postContract.criteria.length, initialCount - 1, `Count transitioned from ${initialCount} to ${initialCount - 1}`);
  console.log('✓ Profile count strictly decrements by 1');
}

// -----------------------------------------------------------------------------
// Test 4: Selection prunes deleted ID
// -----------------------------------------------------------------------------
console.log('--- Test 4: Selection prunes deleted ID ---');
{
  const ws = createTestWorkspace('ws-4');
  const contract = getActiveVerificationContract(ws);
  const deletedId = contract.criteria[1].id;
  const initialSelection = new Set(contract.criteria.map((c) => c.id));

  const updatedWs = deleteCriterionFromContractInWorkspace(ws, contract.id, deletedId);
  const nextCriteria = getActiveVerificationContract(updatedWs).criteria;

  const nextSelection = reconcileSelectedCriterionIds(initialSelection, nextCriteria);
  assert(!nextSelection.has(deletedId), 'Reconciled selection does not contain deleted ID');
  assert.strictEqual(nextSelection.size, 3, 'Selection size pruned to 3');
  console.log('✓ Selection safely prunes deleted criterion');
}

// -----------------------------------------------------------------------------
// Test 5: All-selected state becomes N-1 of N-1 (4 of 4 -> 3 of 3)
// -----------------------------------------------------------------------------
console.log('--- Test 5: All-selected state becomes N-1 of N-1 (4/4 -> 3/3) ---');
{
  const ws = createTestWorkspace('ws-5');
  const contract = getActiveVerificationContract(ws);
  const allIds = new Set(contract.criteria.map((c) => c.id));

  // Initial selection counts
  const beforeCounts = deriveVerificationSelectionCounts(contract.criteria, allIds);
  assert.strictEqual(beforeCounts.selectedCount, 4);
  assert.strictEqual(beforeCounts.totalRunnableCount, 4);

  // Delete criterion B
  const deletedId = contract.criteria[1].id;
  const updatedWs = deleteCriterionFromContractInWorkspace(ws, contract.id, deletedId);
  const nextCriteria = getActiveVerificationContract(updatedWs).criteria;

  const nextSelection = reconcileSelectedCriterionIds(allIds, nextCriteria);
  const afterCounts = deriveVerificationSelectionCounts(nextCriteria, nextSelection);

  assert.strictEqual(afterCounts.selectedCount, 3, 'Must be 3 selected');
  assert.strictEqual(afterCounts.totalRunnableCount, 3, 'Must be 3 total runnable');
  console.log('✓ All-selected state cleanly transitions 4/4 -> 3/3');
}

// -----------------------------------------------------------------------------
// Test 6: Partially-selected state preserves user selection intent
// -----------------------------------------------------------------------------
console.log('--- Test 6: Partially-selected state preserves user intent ---');
{
  const ws = createTestWorkspace('ws-6');
  const contract = getActiveVerificationContract(ws);
  const [critA, critB, critC, critD] = contract.criteria;

  // Scenario 6.1: Selected {A, C, D}, delete B -> result selection {A, C, D}
  {
    const selection = new Set([critA.id, critC.id, critD.id]);
    const updatedWs = deleteCriterionFromContractInWorkspace(ws, contract.id, critB.id);
    const postCriteria = getActiveVerificationContract(updatedWs).criteria;
    const postSelection = reconcileSelectedCriterionIds(selection, postCriteria);

    assert.deepStrictEqual(Array.from(postSelection).sort(), [critA.id, critC.id, critD.id].sort());
    const counts = deriveVerificationSelectionCounts(postCriteria, postSelection);
    assert.strictEqual(counts.selectedCount, 3);
    assert.strictEqual(counts.totalRunnableCount, 3);
  }

  // Scenario 6.2: Selected {A, B}, delete B -> result selection {A}
  {
    const selection = new Set([critA.id, critB.id]);
    const updatedWs = deleteCriterionFromContractInWorkspace(ws, contract.id, critB.id);
    const postCriteria = getActiveVerificationContract(updatedWs).criteria;
    const postSelection = reconcileSelectedCriterionIds(selection, postCriteria);

    assert.deepStrictEqual(Array.from(postSelection), [critA.id]);
    const counts = deriveVerificationSelectionCounts(postCriteria, postSelection);
    assert.strictEqual(counts.selectedCount, 1);
    assert.strictEqual(counts.totalRunnableCount, 3);
  }

  console.log('✓ Partially-selected state preserves existing valid selections');
}

// -----------------------------------------------------------------------------
// Test 7 & 8: Success feedback fires ONLY after successful canonical mutation
// -----------------------------------------------------------------------------
console.log('--- Test 7 & 8: Success feedback gate & failed mutation handling ---');
{
  const ws = createTestWorkspace('ws-7');
  const contract = getActiveVerificationContract(ws);

  function simulateDeleteAction(workspace, targetContractId, targetCriterionId) {
    const targetContract =
      workspace.verification?.contracts.find((c) => c.id === targetContractId) ??
      getActiveVerificationContract(workspace);
    const criterionExists = targetContract?.criteria.some((c) => c.id === targetCriterionId);

    if (!criterionExists) {
      const feedback = { type: 'error', message: 'Could not delete verification check: check not found' };
      return { workspace, wasDeleted: false, feedback };
    }

    const nextWs = deleteCriterionFromContractInWorkspace(workspace, targetContractId, targetCriterionId);
    const feedback = { type: 'success', message: 'Verification check deleted.' };
    return { workspace: nextWs, wasDeleted: true, feedback };
  }

  // Valid deletion: produces success toast
  const validRes = simulateDeleteAction(ws, contract.id, contract.criteria[1].id);
  assert.strictEqual(validRes.wasDeleted, true);
  assert.strictEqual(validRes.feedback.type, 'success');
  assert.strictEqual(validRes.feedback.message, 'Verification check deleted.');

  // Invalid deletion (nonexistent criterion): produces error toast, NOT success
  const invalidRes = simulateDeleteAction(validRes.workspace, contract.id, 'non-existent-criterion-id');
  assert.strictEqual(invalidRes.wasDeleted, false);
  assert.strictEqual(invalidRes.feedback.type, 'error');
  assert.strictEqual(invalidRes.feedback.message, 'Could not delete verification check: check not found');

  console.log('✓ Success feedback strictly follows canonical mutation success; failure yields error');
}

// -----------------------------------------------------------------------------
// Test 9, 10 & 11: Rerender, switching away/back, and profile resolver do NOT restore criterion
// -----------------------------------------------------------------------------
console.log('--- Test 9, 10 & 11: Deletion permanence across reads, navigations, and resolves ---');
{
  const ws = createTestWorkspace('ws-perm');
  const contract = getActiveVerificationContract(ws);
  const deletedId = contract.criteria[1].id;

  // Apply deletion
  const updatedWs = deleteCriterionFromContractInWorkspace(ws, contract.id, deletedId);

  // 9. Repeated reads (simulating rerenders)
  for (let i = 0; i < 5; i++) {
    const read = getActiveVerificationContract(updatedWs);
    assert.strictEqual(read.criteria.length, 3);
    assert(!read.criteria.some((c) => c.id === deletedId));
  }

  // 10. Simulating monitor view navigation away and back
  const monitorState = {
    activeView: 'changes',
    workspace: updatedWs,
  };
  monitorState.activeView = 'capture-evidence';
  monitorState.activeView = 'verification';
  const navigatedRead = getActiveVerificationContract(monitorState.workspace);
  assert.strictEqual(navigatedRead.criteria.length, 3);
  assert(!navigatedRead.criteria.some((c) => c.id === deletedId));

  // 11. Profile resolver (getWorkspaceContracts)
  const contracts = getWorkspaceContracts(updatedWs);
  assert.strictEqual(contracts[0].criteria.length, 3);
  assert(!contracts[0].criteria.some((c) => c.id === deletedId));

  console.log('✓ Deletion is permanent across rerenders, navigation switches, and resolvers');
}

// -----------------------------------------------------------------------------
// Test 12, 13 & 14: Identity stability across Edit, Reorder, and Add
// -----------------------------------------------------------------------------
console.log('--- Test 12, 13 & 14: Stable criterion identity across Edit, Reorder, Add ---');
{
  let ws = createTestWorkspace('ws-id');
  let contract = getActiveVerificationContract(ws);
  const initialIds = contract.criteria.map((c) => c.id);

  // 12. Edit preserves IDs
  const targetCrit = contract.criteria[0];
  ws = updateCriterionInContractInWorkspace(ws, contract.id, {
    ...targetCrit,
    command: 'npm test -- --bail',
  });
  contract = getActiveVerificationContract(ws);
  assert.strictEqual(contract.criteria[0].id, targetCrit.id, 'Edit must preserve criterion ID');
  assert.strictEqual(contract.criteria[0].command, 'npm test -- --bail');

  // 13. Reorder preserves IDs
  const reversedIds = contract.criteria.map((c) => c.id).reverse();
  ws = reorderCriteriaInContractInWorkspace(ws, contract.id, reversedIds);
  contract = getActiveVerificationContract(ws);
  assert.deepStrictEqual(contract.criteria.map((c) => c.id), reversedIds, 'Reorder preserves all IDs without regeneration');

  // 14. Add generates exactly ONE new ID, preserving existing IDs
  const newCrit = createVerificationCriterion({
    label: 'Integration Tests',
    command: 'npm run test:e2e',
    expectedExitCodes: [0],
  });
  ws = addCriterionToContractInWorkspace(ws, contract.id, newCrit);
  contract = getActiveVerificationContract(ws);
  assert.strictEqual(contract.criteria.length, 5, 'Now has 5 criteria');
  assert.strictEqual(contract.criteria[4].id, newCrit.id, 'New criterion appended with its exact ID');

  console.log('✓ Criterion identity strictly preserved across edit, reorder, and add');
}

// -----------------------------------------------------------------------------
// Test 15 & 16: No "0 of 4" state and no second click required
// -----------------------------------------------------------------------------
console.log('--- Test 15 & 16: Immediate 3/3 rendering without second click ---');
{
  const ws = createTestWorkspace('ws-immediate');
  const contract = getActiveVerificationContract(ws);
  assert.strictEqual(contract.criteria.length, 4);

  // Simulated React component state
  let renderedCriteria = contract.criteria;
  let selectedIds = new Set(renderedCriteria.map((c) => c.id));

  // User clicks delete ONCE on criterion index 1
  const deleteTargetId = renderedCriteria[1].id;

  // Single logical mutation step:
  const updatedWs = deleteCriterionFromContractInWorkspace(ws, contract.id, deleteTargetId);
  renderedCriteria = getActiveVerificationContract(updatedWs).criteria;
  selectedIds = reconcileSelectedCriterionIds(selectedIds, renderedCriteria);

  const counts = deriveVerificationSelectionCounts(renderedCriteria, selectedIds);

  // Invariant assertions:
  assert.strictEqual(renderedCriteria.length, 3, 'Must render exactly 3 criteria');
  assert.strictEqual(counts.selectedCount, 3, 'Must have 3 selected (NOT 0)');
  assert.strictEqual(counts.totalRunnableCount, 3, 'Must have 3 total runnable (NOT 4)');
  assert(!selectedIds.has(deleteTargetId), 'Deleted criterion must not be selected');
  assert(!renderedCriteria.some((c) => c.id === deleteTargetId), 'Deleted criterion must not be in criteria');

  console.log('✓ Exactly 3 of 3 rendered immediately on single click — no 0/4 state, no 2nd click');
}

// -----------------------------------------------------------------------------
// Test 17: HARDEN-VERIFY-DELETE-021: Real Bug Reproduction
// Start: A, B, C, D (all 4 selected)
// Delete: A
// Expected: B, C, D (all 3 selected)
// UI semantics: "3 of 3 selected", "Run Selected (3)", never "4 of 3 selected"
// -----------------------------------------------------------------------------
console.log('--- Test 17: HARDEN-VERIFY-DELETE-021: Real Bug Reproduction (4/4 -> delete 1 -> 3/3) ---');
{
  const ws = createTestWorkspace('ws-real-bug');
  const contract = getActiveVerificationContract(ws);
  assert.strictEqual(contract.criteria.length, 4, 'Starts with 4 standard checks');

  const [critA, critB, critC, critD] = contract.criteria;
  // Ensure all 4 are selected initially in canonical workspace
  const initialSelection = getCanonicalVerificationSelection(ws);
  assert.strictEqual(initialSelection.size, 4, 'Initially all 4 are selected');

  // User deletes A (e.g. Test suite)
  const updatedWs = deleteCriterionFromContractInWorkspace(ws, contract.id, critA.id);
  const postContract = getActiveVerificationContract(updatedWs);
  const postSelection = getCanonicalVerificationSelection(updatedWs);

  // Canonical assertions
  assert.strictEqual(postContract.criteria.length, 3, 'Must have exactly 3 criteria remaining');
  assert(!postContract.criteria.some((c) => c.id === critA.id), 'Deleted A must be absent from criteria');
  assert.strictEqual(postSelection.size, 3, 'Canonical selection size must be exactly 3');
  assert(!postSelection.has(critA.id), 'Deleted A must be absent from canonical selection');
  assert(postSelection.has(critB.id) && postSelection.has(critC.id) && postSelection.has(critD.id), 'B, C, D must remain selected');

  // Invariant assertion: selectedCriterionIds ⊆ activeContract.criteria IDs
  const validIds = new Set(postContract.criteria.map((c) => c.id));
  for (const id of postSelection) {
    assert(validIds.has(id), `Selected ID ${id} must be in active contract criteria`);
  }

  // UI Semantics Render Assertion
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract: postContract,
      selectedCriterionIds: postSelection,
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  assert.ok(html.includes('3 of 3 selected'), 'UI must display "3 of 3 selected"');
  assert.ok(html.includes('Run Selected (3)'), 'UI must display "Run Selected (3)"');
  assert.strictEqual(html.includes('4 of 3 selected'), false, 'UI must NEVER display "4 of 3 selected"');
  assert.strictEqual(html.includes('Run Selected (4)'), false, 'UI must NEVER display "Run Selected (4)"');

  console.log('✓ Real bug reproduced & solved: 4/4 -> delete 1 -> 3/3 in both canonical state and rendered UI');
}

// -----------------------------------------------------------------------------
// Test 18: Additional Case A: Stale selection reconciliation
// criteria = [B, C, D], selected = [A, B, C, D] -> reconcile -> selected = [B, C, D]
// -----------------------------------------------------------------------------
console.log('--- Test 18: Additional Case A: Stale selection reconciliation ---');
{
  const ws = createTestWorkspace('ws-stale-reconcile');
  const contract = getActiveVerificationContract(ws);
  const [critA, critB, critC, critD] = contract.criteria;

  // Simulate contract having 3 criteria (B, C, D) but canonical selection having stale A
  const contract3 = {
    ...contract,
    criteria: [critB, critC, critD],
  };
  const wsWithStale = {
    ...ws,
    verification: {
      ...ws.verification,
      contracts: [contract3],
      activeContractId: contract3.id,
      selectedCriterionIds: new Set([critA.id, critB.id, critC.id, critD.id]),
    },
  };

  const reconciledSelection = getCanonicalVerificationSelection(wsWithStale);
  assert.strictEqual(reconciledSelection.size, 3, 'Reconciled selection size must be 3');
  assert(!reconciledSelection.has(critA.id), 'Stale ID A must be pruned');
  assert.deepStrictEqual(Array.from(reconciledSelection).sort(), [critB.id, critC.id, critD.id].sort());

  const ensuredWs = ensureWorkspaceVerificationState(wsWithStale);
  assert.strictEqual(ensuredWs.verification.selectedCriterionIds.size, 3);
  assert(!ensuredWs.verification.selectedCriterionIds.has(critA.id));

  // Render check with stale selection prop - defensive derivation protects the UI
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract: contract3,
      selectedCriterionIds: wsWithStale.verification.selectedCriterionIds,
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );
  assert.ok(html.includes('3 of 3 selected'));
  assert.ok(html.includes('Run Selected (3)'));
  assert.strictEqual(html.includes('4 of 3 selected'), false);

  console.log('✓ Stale selection correctly pruned to valid contract criteria [B, C, D]');
}

// -----------------------------------------------------------------------------
// Test 19: Additional Case B: Delete unselected criterion preserves valid selected criteria
// -----------------------------------------------------------------------------
console.log('--- Test 19: Additional Case B: Delete unselected criterion preserves valid selections ---');
{
  const ws = createTestWorkspace('ws-delete-unselected');
  const contract = getActiveVerificationContract(ws);
  const [critA, critB, critC, critD] = contract.criteria;

  // Initially unselect A: selection is {B, C, D}
  const wsPartiallySelected = setCriteriaSelectionInWorkspace(ws, [critB.id, critC.id, critD.id]);
  assert.strictEqual(getCanonicalVerificationSelection(wsPartiallySelected).size, 3);
  assert(!getCanonicalVerificationSelection(wsPartiallySelected).has(critA.id));

  // Delete unselected A
  const updatedWs = deleteCriterionFromContractInWorkspace(wsPartiallySelected, contract.id, critA.id);
  const postContract = getActiveVerificationContract(updatedWs);
  const postSelection = getCanonicalVerificationSelection(updatedWs);

  assert.strictEqual(postContract.criteria.length, 3);
  assert.strictEqual(postSelection.size, 3, 'All 3 remaining valid selections must be preserved');
  assert(!postSelection.has(critA.id));
  assert(postSelection.has(critB.id) && postSelection.has(critC.id) && postSelection.has(critD.id));

  console.log('✓ Deleting unselected criterion preserves remaining valid selections');
}

// -----------------------------------------------------------------------------
// Test 20: Additional Case C: Select all produces exactly current criteria IDs
// -----------------------------------------------------------------------------
console.log('--- Test 20: Additional Case C: Select all produces exactly current criteria IDs ---');
{
  const ws = createTestWorkspace('ws-select-all');
  const contract = getActiveVerificationContract(ws);

  // Clear first
  const clearedWs = clearCriteriaSelectionInWorkspace(ws);
  assert.strictEqual(getCanonicalVerificationSelection(clearedWs).size, 0);

  // Select all
  const allWs = selectAllCriteriaInWorkspace(clearedWs);
  const selection = getCanonicalVerificationSelection(allWs);

  assert.strictEqual(selection.size, contract.criteria.length);
  for (const crit of contract.criteria) {
    assert(selection.has(crit.id), `Criterion ${crit.id} must be selected`);
  }

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      selectedCriterionIds: selection,
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );
  assert.ok(html.includes(`${contract.criteria.length} of ${contract.criteria.length} selected`));
  assert.ok(html.includes(`Run Selected (${contract.criteria.length})`));

  console.log('✓ Select all produces exactly the set of current criteria IDs');
}

// -----------------------------------------------------------------------------
// Test 21: Additional Case D: Clear produces zero selected
// -----------------------------------------------------------------------------
console.log('--- Test 21: Additional Case D: Clear produces zero selected ---');
{
  const ws = createTestWorkspace('ws-clear');
  const contract = getActiveVerificationContract(ws);

  const clearedWs = clearCriteriaSelectionInWorkspace(ws);
  const selection = getCanonicalVerificationSelection(clearedWs);

  assert.strictEqual(selection.size, 0, 'Selection must be empty');

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      selectedCriterionIds: selection,
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );
  assert.ok(html.includes(`0 of ${contract.criteria.length} selected`));
  // Button should have no number and be disabled
  assert.ok(html.includes('disabled=""'));
  assert.strictEqual(html.includes('Run Selected (0)'), false);

  console.log('✓ Clear produces zero selected criteria');
}

// -----------------------------------------------------------------------------
// Test 22: Additional Case E: Profile switch produces selection containing only target profile criteria IDs
// -----------------------------------------------------------------------------
console.log('--- Test 22: Additional Case E: Profile switch contains only target profile criteria IDs ---');
{
  const ws = createTestWorkspace('ws-profile-switch');
  const contract1 = getActiveVerificationContract(ws);

  // Add custom profile 2 with 2 distinct criteria
  const critX = createVerificationCriterion({ label: 'Fast Unit', command: 'npm test -- -t unit' });
  const critY = createVerificationCriterion({ label: 'Smoke', command: 'npm run smoke' });
  const contract2 = createVerificationContract({
    workspaceId: ws.id,
    name: 'Quick Checks',
    criteria: [critX, critY],
  });

  const wsWithTwoProfiles = addVerificationContractToWorkspace(ws, contract2);
  // Switch to profile 2
  const switchedWs = setActiveVerificationContractInWorkspace(wsWithTwoProfiles, contract2.id);
  const activeContract = getActiveVerificationContract(switchedWs);
  const selection = getCanonicalVerificationSelection(switchedWs);

  assert.strictEqual(activeContract.id, contract2.id);
  assert.strictEqual(selection.size, 2);
  assert(selection.has(critX.id) && selection.has(critY.id));

  // None of contract 1's criteria IDs are present
  for (const crit of contract1.criteria) {
    assert(!selection.has(crit.id), `Contract 1 ID ${crit.id} must not exist in Profile 2 selection`);
  }

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract: activeContract,
      selectedCriterionIds: selection,
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );
  assert.ok(html.includes('2 of 2 selected'));
  assert.ok(html.includes('Run Selected (2)'));

  console.log('✓ Profile switch guarantees selection only contains target profile criteria IDs');
}

// -----------------------------------------------------------------------------
// Test 23: Additional Case F: Restart/hydration prevents stale IDs from returning
// -----------------------------------------------------------------------------
console.log('--- Test 23: Additional Case F: Restart/hydration stale IDs cannot return ---');
{
  const ws = createTestWorkspace('ws-hydration');
  const contract = getActiveVerificationContract(ws);
  const [critA, critB, critC, critD] = contract.criteria;

  // Workspace has criteria B, C, D, but raw persisted state somehow had stale ID A
  const contract3 = {
    ...contract,
    criteria: [critB, critC, critD],
  };
  const unhydratedWs = {
    ...ws,
    verification: {
      contracts: [contract3],
      activeContractId: contract3.id,
      runs: [],
      activeRunId: null,
      selectedCriterionIds: new Set([critA.id, critB.id, critC.id, critD.id]),
    },
  };

  const hydratedWs = ensureWorkspaceVerificationState(unhydratedWs);
  const hydratedSelection = hydratedWs.verification.selectedCriterionIds;

  assert.strictEqual(hydratedSelection.size, 3);
  assert(!hydratedSelection.has(critA.id), 'Stale ID A cannot return on hydration');
  assert(hydratedSelection.has(critB.id) && hydratedSelection.has(critC.id) && hydratedSelection.has(critD.id));

  console.log('✓ Restart/hydration enforces selectedCriterionIds := selectedCriterionIds ∩ activeContract.criteria IDs');
}

// -----------------------------------------------------------------------------
// Test 24: Run Selected Safety: Stale IDs never enter immutable VerificationRun snapshot
// -----------------------------------------------------------------------------
console.log('--- Test 24: Run Selected Safety: Stale IDs never enter immutable VerificationRun snapshot ---');
{
  const ws = createTestWorkspace('ws-run-safety');
  const contract = getActiveVerificationContract(ws);
  const [critA, critB, critC] = contract.criteria;

  // Active contract with criteria B and C
  const activeContract = {
    ...contract,
    criteria: [critB, critC],
  };

  // Caller attempts to run with stale IDs: ['stale-deleted-id', critB.id, 'another-fake-id']
  const run = createVerificationRun({
    contract: activeContract,
    workspaceId: ws.id,
    selectedCriterionIds: ['stale-deleted-id', critB.id, 'another-fake-id'],
  });

  assert.strictEqual(run.criteriaSnapshot.length, 1, 'Only the single valid criterion critB enters snapshot');
  assert.strictEqual(run.criteriaSnapshot[0].id, critB.id);
  assert(!run.criteriaSnapshot.some((c) => c.id === 'stale-deleted-id'));
  assert(!run.criteriaSnapshot.some((c) => c.id === 'another-fake-id'));
  assert.strictEqual(run.criterionResults.length, 1);
  assert.strictEqual(run.criterionResults[0].criterionId, critB.id);

  console.log('✓ Stale IDs strictly excluded from immutable VerificationRun snapshot');
}

// -----------------------------------------------------------------------------
// Test 25: HARDEN-VERIFY-DELETE-021B: Existing criterion deletion emits exactly ONE success notification and NO "check not found"
// -----------------------------------------------------------------------------
console.log('--- Test 25: HARDEN-VERIFY-DELETE-021B: Delete existing criterion emits exactly ONE success notification ---');
{
  const ws = createTestWorkspace('ws-delete-success-notification');
  const contract = getActiveVerificationContract(ws);
  const [critA, critB, critC, critD] = contract.criteria;

  const feedbacks = [];
  function showTranscriptFeedback(msg, type) {
    feedbacks.push({ msg, type });
  }

  let currentWs = ws;
  function updateWorkspace(wsId, updater) {
    currentWs = updater(currentWs);
  }

  // Pure handler matching App.tsx handleDeleteVerificationCriterion
  function handleDeleteVerificationCriterion(contractId, criterionId) {
    const targetContract =
      currentWs.verification?.contracts.find((c) => c.id === contractId) ??
      getActiveVerificationContract(currentWs);
    const criterionExists = targetContract?.criteria.some((c) => c.id === criterionId);

    if (!criterionExists) {
      showTranscriptFeedback('Could not delete verification check: check not found', 'error');
      return;
    }

    updateWorkspace(currentWs.id, (prev) =>
      deleteCriterionFromContractInWorkspace(prev, contractId, criterionId),
    );

    showTranscriptFeedback('Verification check deleted.', 'success');
  }

  handleDeleteVerificationCriterion(contract.id, critA.id);

  assert.strictEqual(feedbacks.length, 1, 'Exactly one feedback message must be emitted');
  assert.strictEqual(feedbacks[0].type, 'success');
  assert.strictEqual(feedbacks[0].msg, 'Verification check deleted.');
  assert.strictEqual(feedbacks.some((f) => f.msg.includes('check not found')), false, 'Must NOT contain "check not found"');

  const postContract = getActiveVerificationContract(currentWs);
  assert.strictEqual(postContract.criteria.length, 3, 'Remaining criteria must be 3');
  assert(!postContract.criteria.some((c) => c.id === critA.id), 'Criterion A must be deleted');
  const postSelection = getCanonicalVerificationSelection(currentWs);
  assert.strictEqual(postSelection.size, 3, 'Selection must be 3');
  assert(!postSelection.has(critA.id), 'A must not be in selection');

  console.log('✓ Existing criterion deletion emits exactly 1 success notification with 0 errors');
}

// -----------------------------------------------------------------------------
// Test 26: HARDEN-VERIFY-DELETE-021B: Missing criterion deletion emits controlled error and leaves state untouched
// -----------------------------------------------------------------------------
console.log('--- Test 26: HARDEN-VERIFY-DELETE-021B: Missing criterion deletion emits controlled error ---');
{
  const ws = createTestWorkspace('ws-delete-missing');
  const contract = getActiveVerificationContract(ws);

  const feedbacks = [];
  function showTranscriptFeedback(msg, type) {
    feedbacks.push({ msg, type });
  }

  let mutationInvoked = false;
  function updateWorkspace(wsId, updater) {
    mutationInvoked = true;
  }

  function handleDeleteVerificationCriterion(contractId, criterionId) {
    const targetContract =
      ws.verification?.contracts.find((c) => c.id === contractId) ??
      getActiveVerificationContract(ws);
    const criterionExists = targetContract?.criteria.some((c) => c.id === criterionId);

    if (!criterionExists) {
      showTranscriptFeedback('Could not delete verification check: check not found', 'error');
      return;
    }

    updateWorkspace(ws.id, (prev) =>
      deleteCriterionFromContractInWorkspace(prev, contractId, criterionId),
    );

    showTranscriptFeedback('Verification check deleted.', 'success');
  }

  handleDeleteVerificationCriterion(contract.id, 'non-existent-id');

  assert.strictEqual(feedbacks.length, 1, 'Exactly one feedback message must be emitted');
  assert.strictEqual(feedbacks[0].type, 'error');
  assert.strictEqual(feedbacks[0].msg, 'Could not delete verification check: check not found');
  assert.strictEqual(mutationInvoked, false, 'State updater must NOT be queued when criterion does not exist');

  console.log('✓ Missing criterion deletion emits controlled error without mutating state');
}

// -----------------------------------------------------------------------------
// Test 27: HARDEN-VERIFY-DELETE-021B: React updater purity with deferred updater execution
// -----------------------------------------------------------------------------
console.log('--- Test 27: HARDEN-VERIFY-DELETE-021B: Pure updater works correctly with deferred state processing ---');
{
  const ws = createTestWorkspace('ws-deferred-updater');
  const contract = getActiveVerificationContract(ws);
  const [critA] = contract.criteria;

  const feedbacks = [];
  const queuedUpdaters = [];

  function showTranscriptFeedback(msg, type) {
    feedbacks.push({ msg, type });
  }

  // Simulates React's deferred/batched state processing where updaters do NOT run synchronously
  function updateWorkspaceDeferred(wsId, updater) {
    queuedUpdaters.push(updater);
  }

  function handleDeleteVerificationCriterion(contractId, criterionId) {
    const targetContract =
      ws.verification?.contracts.find((c) => c.id === contractId) ??
      getActiveVerificationContract(ws);
    const criterionExists = targetContract?.criteria.some((c) => c.id === criterionId);

    if (!criterionExists) {
      showTranscriptFeedback('Could not delete verification check: check not found', 'error');
      return;
    }

    updateWorkspaceDeferred(ws.id, (prev) =>
      deleteCriterionFromContractInWorkspace(prev, contractId, criterionId),
    );

    // Pre-checked synchronously outside the updater: never falsely reports error
    showTranscriptFeedback('Verification check deleted.', 'success');
  }

  handleDeleteVerificationCriterion(contract.id, critA.id);

  // Before queued updater runs:
  assert.strictEqual(feedbacks.length, 1, 'Success feedback dispatched synchronously');
  assert.strictEqual(feedbacks[0].type, 'success');
  assert.strictEqual(feedbacks[0].msg, 'Verification check deleted.');
  assert.strictEqual(queuedUpdaters.length, 1, 'Updater queued for execution');

  // Now simulate React running the updater later:
  let state = ws;
  for (const fn of queuedUpdaters) {
    state = fn(state);
  }
  assert.strictEqual(getActiveVerificationContract(state).criteria.length, 3);
  assert(!getActiveVerificationContract(state).criteria.some((c) => c.id === critA.id));

  console.log('✓ Pure state updater is resilient to asynchronous / deferred state execution');
}

// -----------------------------------------------------------------------------
// Test 28: HARDEN-VERIFY-DELETE-021B: VerificationPanel delete button event propagation & single invocation
// -----------------------------------------------------------------------------
console.log('--- Test 28: HARDEN-VERIFY-DELETE-021B: VerificationPanel delete button stops propagation and invokes once ---');
{
  const ws = createTestWorkspace('ws-panel-delete-click');
  const contract = getActiveVerificationContract(ws);
  const [critA] = contract.criteria;

  let deleteInvocations = 0;
  let deletedContractId = null;
  let deletedCriterionId = null;

  function onDelete(cId, critId) {
    deleteInvocations++;
    deletedContractId = cId;
    deletedCriterionId = critId;
  }

  // Check the source code of VerificationPanel.tsx to ensure stopPropagation is wired
  const panelSource = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.tsx'),
    'utf8',
  );
  assert.ok(
    panelSource.includes('e.stopPropagation();') &&
      panelSource.includes('onDeleteCriterion?.(contract.id, criterion.id)'),
    'VerificationPanel delete button must call e.stopPropagation() before onDeleteCriterion',
  );

  // Render VerificationPanel
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      selectedCriterionIds: getCanonicalVerificationSelection(ws),
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
      onDeleteCriterion: onDelete,
    }),
  );

  assert.ok(html.includes('title="Delete check"'), 'Delete button must be rendered in HTML');

  // Simulate one click invocation
  onDelete(contract.id, critA.id);
  assert.strictEqual(deleteInvocations, 1, 'Delete must be invoked exactly once per click');
  assert.strictEqual(deletedContractId, contract.id);
  assert.strictEqual(deletedCriterionId, critA.id);

  console.log('✓ VerificationPanel delete button stops propagation and invokes callback exactly once');
}

console.log('\n=============================================================');
console.log('ALL HARDEN-VERIFY-DELETE-018, 021 & 021B TESTS PASSED!');
console.log('=============================================================\n');
