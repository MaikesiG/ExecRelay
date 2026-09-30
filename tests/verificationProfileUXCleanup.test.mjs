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

// 1. Transpile verification types
const verifTypesJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/types.ts'));
const verifTypesMod = { exports: {} };
new Function('module', 'exports', 'require', verifTypesJs)(verifTypesMod, verifTypesMod.exports, () => ({}));

// 2. Transpile verificationModel.ts
const verifModelJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'));
const verifModelMod = { exports: {} };
new Function('module', 'exports', 'require', verifModelJs)(verifModelMod, verifModelMod.exports, (req) => {
  if (req.includes('types')) return verifTypesMod.exports;
  return {};
});
const {
  createVerificationCriterion,
  createVerificationContract,
  createDefaultVerificationContract,
  deriveVerificationPresentation,
} = verifModelMod.exports;

// 3. Transpile verificationState.ts
const verifStateJs = transpileTs(path.resolve(__dirname, '../app/src/features/verification/verificationState.ts'));
const verifStateMod = { exports: {} };
new Function('module', 'exports', 'require', verifStateJs)(verifStateMod, verifStateMod.exports, (req) => {
  if (req.includes('types')) return verifTypesMod.exports;
  if (req.includes('verificationModel')) return verifModelMod.exports;
  return {};
});
const {
  getOrCreateWorkspaceVerificationState,
  getWorkspaceContracts,
  getActiveVerificationContract,
  addVerificationContractToWorkspace,
  setActiveVerificationContractInWorkspace,
  deleteVerificationContractFromWorkspace,
} = verifStateMod.exports;

function createMockWorkspace(id = 'ws-cleanup-test', contracts = null) {
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

console.log('Running HARDEN-012B.1 Verification Profile UX Cleanup Tests...\n');

// ============================================================================
// Test 1: Header Structure & Duplicated Title Removal (Section 1, 2, 3, 4, 16)
// ============================================================================
console.log('--- Test 1: Header Structure & Duplicated Title Removal ---');

{
  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.tsx'),
    'utf8',
  );
  const panelCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.css'),
    'utf8',
  );

  // 1.1 Top-level h3 title removed from VerificationPanel
  assert.ok(
    !panelTsx.includes('verification-contract-title'),
    'verification-contract-title h3 must be removed so active profile name is not duplicated',
  );
  assert.ok(
    !panelTsx.includes('<h3'),
    'VerificationPanel must not have any h3 header above the profile selector',
  );

  // 1.2 Unified header contains the profile group and run badge in one compact row
  assert.ok(
    panelTsx.includes('className="verification-header"'),
    'VerificationPanel contains verification-header container',
  );
  assert.ok(
    panelTsx.includes('className="verification-header-profile-group"'),
    'VerificationPanel contains verification-header-profile-group',
  );
  assert.ok(
    panelTsx.includes('className="verification-profile-select"'),
    'VerificationPanel contains verification-profile-select as the authoritative active-profile display',
  );
  assert.ok(
    panelTsx.includes('verification-run-badge verification-run-badge--'),
    'VerificationPanel renders canonical verification-run-badge in verification-header',
  );

  // 1.3 CSS alignment: status badge aligned on the right, display flex with gap: 8px
  assert.ok(
    panelCss.includes('.verification-header {') &&
    panelCss.includes('display: flex;') &&
    panelCss.includes('align-items: center;') &&
    panelCss.includes('gap: 8px;'),
    'verification-header has display: flex; align-items: center; gap: 8px',
  );
  assert.ok(
    panelCss.includes('.verification-run-badge {') &&
    panelCss.includes('margin-left: auto;'),
    'verification-run-badge is aligned right using margin-left: auto',
  );

  // 1.4 No separate verification-profile-bar row
  assert.ok(
    !panelTsx.includes('className="verification-profile-bar"'),
    'verification-profile-bar is merged into the single compact verification-header row',
  );

  console.log('✓ Header structure verified: active profile shown once in selector, badge aligned right, no duplicate title');
}

// ============================================================================
// Test 2: New Profile is Empty by Default & NewProfileModal (Section 5, 7, 8, 17)
// ============================================================================
console.log('\n--- Test 2: New Profile is Empty by Default & NewProfileModal ---');

{
  let ws = createMockWorkspace('ws-new-profile');
  const initState = getOrCreateWorkspaceVerificationState(ws);
  assert.strictEqual(initState.contracts.length, 1);

  // 2.1 createVerificationContract without criteria defaults to empty array []
  const newProfile = createVerificationContract({
    workspaceId: ws.id,
    name: 'Backend',
    criteria: [],
  });
  assert.strictEqual(newProfile.name, 'Backend');
  assert.strictEqual(newProfile.criteria.length, 0);

  // 2.2 Adding new profile to workspace
  ws = addVerificationContractToWorkspace(ws, newProfile);
  const activeContract = getActiveVerificationContract(ws);
  assert.strictEqual(activeContract.id, newProfile.id);
  assert.strictEqual(activeContract.name, 'Backend');
  assert.strictEqual(activeContract.criteria.length, 0);

  // 2.3 Verify NewProfileModal code has no seedWithStandard checkbox
  const modalTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/NewProfileModal.tsx'),
    'utf8',
  );
  assert.ok(!modalTsx.includes('seedWithStandard'), 'NewProfileModal must not have seedWithStandard state');
  assert.ok(!modalTsx.includes('Start with default standard checks'), 'NewProfileModal must not offer seeding default checks');
  assert.ok(modalTsx.includes('onConfirm(trimmed)'), 'NewProfileModal passes only the trimmed profile name');

  // 2.4 Verify App.tsx handleCreateVerificationProfile creates empty profile
  const appTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/App.tsx'),
    'utf8',
  );
  assert.ok(
    appTsx.includes("handleCreateVerificationProfile = useCallback(\n    (name: string) => {"),
    'handleCreateVerificationProfile takes name only without seedWithStandard',
  );
  assert.ok(
    appTsx.includes("criteria: [],"),
    'handleCreateVerificationProfile creates profile with criteria: []',
  );

  console.log('✓ New profile creation is strictly empty by default (criteria: [])');
}

// ============================================================================
// Test 3: Standard checks Preserved as Default & Fallback (Section 6, 14, 18)
// ============================================================================
console.log('\n--- Test 3: Standard checks Preserved as Default & Fallback ---');

{
  // 3.1 Brand new uninitialized workspace gets Standard checks with empty criteria list (RELEASE-POLISH-VERIFY-023)
  const freshWs = createMockWorkspace('ws-fresh');
  const state = getOrCreateWorkspaceVerificationState(freshWs);
  assert.strictEqual(state.contracts.length, 1);
  assert.strictEqual(state.contracts[0].name, 'Standard checks');
  assert.strictEqual(state.contracts[0].criteria.length, 0);
  assert.deepStrictEqual(
    state.contracts[0].criteria.map((c) => c.label),
    [],
  );

  // 3.2 Fallback when only profile is deleted recreates Standard checks
  let wsWithSingle = createMockWorkspace('ws-fallback');
  const customProfile = createVerificationContract({
    workspaceId: wsWithSingle.id,
    name: 'Solo Profile',
    criteria: [],
  });
  wsWithSingle = addVerificationContractToWorkspace(wsWithSingle, customProfile);
  // Delete the initial default contract so customProfile is the only one
  const initialContracts = getWorkspaceContracts(wsWithSingle);
  const defaultContractId = initialContracts.find((c) => c.name === 'Standard checks').id;
  wsWithSingle = deleteVerificationContractFromWorkspace(wsWithSingle, defaultContractId);
  assert.strictEqual(getWorkspaceContracts(wsWithSingle).length, 1);
  assert.strictEqual(getActiveVerificationContract(wsWithSingle).name, 'Solo Profile');

  // Now delete the only remaining profile
  wsWithSingle = deleteVerificationContractFromWorkspace(wsWithSingle, customProfile.id);
  const fallbackContracts = getWorkspaceContracts(wsWithSingle);
  assert.strictEqual(fallbackContracts.length, 1);
  assert.strictEqual(fallbackContracts[0].name, 'Standard checks');
  assert.strictEqual(fallbackContracts[0].criteria.length, 0);

  console.log('✓ Standard checks preserved as workspace default and deletion recovery fallback');
}

// ============================================================================
// Test 4: Existing Profiles with Criteria Remain Intact (Section 13, 19)
// ============================================================================
console.log('\n--- Test 4: Existing Profiles with Criteria Remain Intact ---');

{
  const customContract = createVerificationContract({
    workspaceId: 'ws-existing',
    name: 'Custom Pipeline',
    criteria: [
      createVerificationCriterion({ label: 'Check 1', command: 'cmd1', order: 1 }),
      createVerificationCriterion({ label: 'Check 2', command: 'cmd2', order: 2 }),
    ],
  });

  const ws = createMockWorkspace('ws-existing', [customContract]);
  const state = getOrCreateWorkspaceVerificationState(ws);
  assert.strictEqual(state.contracts.length, 1);
  assert.strictEqual(state.contracts[0].name, 'Custom Pipeline');
  assert.strictEqual(state.contracts[0].criteria.length, 2);
  assert.strictEqual(state.contracts[0].criteria[0].command, 'cmd1');
  assert.strictEqual(state.contracts[0].criteria[1].command, 'cmd2');

  console.log('✓ Existing profiles and criteria remain intact without mutation');
}

// ============================================================================
// Test 5: Empty Profile UI & Selection Toolbar Behavior (Section 9, 10, 11, 20)
// ============================================================================
console.log('\n--- Test 5: Empty Profile UI & Selection Toolbar Behavior ---');

{
  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.tsx'),
    'utf8',
  );

  // 5.1 Clean empty state message
  assert.ok(
    panelTsx.includes('<p>No verification checks yet.</p>') ||
    panelTsx.includes('<p>No verification checks configured.</p>'),
    'Empty profile renders clean empty state message',
  );
  assert.ok(
    panelTsx.includes('<small>Add the commands you want to run for this profile.</small>'),
    'Empty profile renders "Add the commands you want to run for this profile."',
  );

  // 5.2 Selection toolbar hidden when criteria.length === 0
  assert.ok(
    panelTsx.includes('!isViewingHistoricalRun && contract.criteria.length > 0 && (\n        <div className="verification-selection-toolbar">') ||
    panelTsx.includes('contract.criteria.length > 0 && (\n        <div className="verification-selection-toolbar">'),
    'Selection toolbar is strictly guarded by contract.criteria.length > 0 so "0 of 0 selected" is not rendered',
  );

  // 5.3 Run Selected hidden when criteria.length === 0 and not running
  assert.ok(
    panelTsx.includes('(isLocked || contract.criteria.length > 0) && (\n        <div className="verification-actions">') ||
    panelTsx.includes('!isLocked && contract.criteria.length > 0 && (\n        <div className="verification-actions">'),
    'Action controls / Run Selected button row is hidden when empty and idle',
  );

  // 5.4 + Add Check remains visible and enabled
  assert.ok(
    panelTsx.includes('<div className="verification-add-check-area">') &&
    panelTsx.includes('+ Add Check'),
    '+ Add Check button remains available and prominent in empty profile',
  );

  console.log('✓ Empty profile UI renders clean empty state; hides selection toolbar and Run Selected; shows + Add Check');
}

// ============================================================================
// Test 6: Persistence of Empty Profile & Valid Domain Invariant (Section 21, 22)
// ============================================================================
console.log('\n--- Test 6: Persistence of Empty Profile & Valid Domain Invariant ---');

{
  let ws = createMockWorkspace('ws-persist-empty');
  const emptyProfile = createVerificationContract({
    workspaceId: ws.id,
    name: 'Intentional Empty Profile',
    criteria: [],
  });
  ws = addVerificationContractToWorkspace(ws, emptyProfile);
  ws = setActiveVerificationContractInWorkspace(ws, emptyProfile.id);

  assert.strictEqual(getActiveVerificationContract(ws).name, 'Intentional Empty Profile');
  assert.strictEqual(getActiveVerificationContract(ws).criteria.length, 0);

  // Serialize to JSON and parse back (simulating app reload / disk restoration)
  const jsonStr = JSON.stringify(ws);
  const reloadedWs = JSON.parse(jsonStr);

  // Reload state through getOrCreateWorkspaceVerificationState
  const restoredState = getOrCreateWorkspaceVerificationState(reloadedWs);

  // Verify the empty profile is PRESERVED and NOT overwritten by Standard checks!
  const restoredEmptyProfile = restoredState.contracts.find((c) => c.id === emptyProfile.id);
  assert.ok(restoredEmptyProfile, 'Empty profile must exist after reload');
  assert.strictEqual(restoredEmptyProfile.name, 'Intentional Empty Profile');
  assert.strictEqual(restoredEmptyProfile.criteria.length, 0, 'criteria array must remain strictly empty after reload');
  assert.deepStrictEqual(restoredEmptyProfile.criteria, [], 'criteria must be empty array [] without auto-seeded checks');
  assert.strictEqual(restoredState.activeContractId, emptyProfile.id, 'Empty profile remains active after reload');

  console.log('✓ Critical Invariant: Empty profile is a valid domain state and stays empty after reload');
}

console.log('\n=============================================================');
console.log('ALL HARDEN-012B.1 VERIFICATION PROFILE UX CLEANUP TESTS PASSED!');
console.log('=============================================================\n');
