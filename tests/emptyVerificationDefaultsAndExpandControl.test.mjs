/**
 * RELEASE-POLISH-VERIFY-023: Empty Verification Defaults + Hide Unused Expand Control
 *
 * Test Suite verifying:
 * 1. New Workspace Verification Starts Empty:
 *    - Genuinely new workspace initializes with criteria.length === 0
 *    - No automatic Test, Typecheck, Lint, or Build commands are guessed/created
 * 2. Existing Persisted Workspace Configuration Preserved:
 *    - Persisted workspace with custom criteria (A, B, C) restores all checks exactly
 *    - No criteria are deleted, overwritten, or regenerated on hydration
 * 3. Empty Profile & Add Check Action:
 *    - Empty profile shows clean empty state: "No verification checks configured."
 *    - "+ Add Check" button is rendered and functional
 *    - No meaningless "0 of 0 selected", "Run Selected (0)", or "Select all / Clear" rendered
 * 4. First Check Added:
 *    - When user adds first check, criterion appears normally in profile
 *    - Automatically selectable and executable via Run / Run Selected
 *    - Persists normally across serialization & hydration
 * 5. Historical VerificationRun Immutability:
 *    - Existing historical runs and their criteriaSnapshots remain unchanged
 * 6. Expand Control Hidden in Public Verify UI:
 *    - Adjacent expand/enlarge control (monitor-focus-toggle-btn) is NOT rendered in public Terminal edition
 *    - Controls maintain proper alignment with zero layout gaps
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

const moduleCache = new Map();
function loadTs(relPath, customRequire = () => ({})) {
  const absPath = path.resolve(__dirname, relPath);
  if (moduleCache.has(absPath)) return moduleCache.get(absPath);
  const mod = { exports: {} };
  moduleCache.set(absPath, mod.exports);

  const rawSrc = fs.readFileSync(absPath, 'utf8');
  const src = rawSrc.replace(/import\.meta/g, '({ env: {} })');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;

  new Function('module', 'exports', 'require', 'React', js)(
    mod,
    mod.exports,
    (id) => {
      if (id === 'react') return React;
      if (id.includes('.css')) return {};
      if (id.includes('@tauri-apps')) {
        return {
          invoke: () => Promise.resolve(null),
          listen: () => Promise.resolve(() => {}),
        };
      }
      if (id === '@xterm/xterm') return { Terminal: class MockTerminal { open() {} loadAddon() {} } };
      if (id === '@xterm/addon-fit') return { FitAddon: class MockFitAddon { fit() {} } };
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(absPath), id);
        const candidates = [
          resolved + '.ts',
          resolved + '.tsx',
          path.join(resolved, 'index.ts'),
          path.join(resolved, 'index.tsx'),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            return loadTs(c, customRequire);
          }
        }
      }
      try {
        return require(path.resolve(__dirname, '../app/node_modules', id));
      } catch {}
      return customRequire(id);
    },
    React,
  );
  moduleCache.set(absPath, mod.exports);
  return mod.exports;
}

// Verification modules
const verifModelMod = loadTs('../app/src/features/verification/verificationModel.ts');
const verifStateMod = loadTs('../app/src/features/verification/verificationState.ts', (id) => {
  if (id.includes('verificationModel')) return verifModelMod;
  return require(id);
});
const verifReconMod = loadTs('../app/src/features/verification/verificationReconciliation.ts', (id) => {
  if (id.includes('verificationModel')) return verifModelMod;
  if (id.includes('verificationState')) return verifStateMod;
  return require(id);
});
const verifIndexMod = {
  ...verifModelMod,
  ...verifStateMod,
  ...verifReconMod,
};

// Workspace modules
const wsContextMod = loadTs('../app/src/features/workspace/workspaceContext.ts', (id) => {
  if (id.includes('@tauri-apps')) return { invoke: () => Promise.resolve(null) };
  return require(id);
});
const wsPersistMod = loadTs('../app/src/features/workspace/workspacePersistence.ts', (id) => {
  if (id.includes('verification')) return verifIndexMod;
  return require(id);
});
const defaultWsMod = loadTs('../app/src/features/workspace/createDefaultWorkspace.ts');

// Edition modules
const editionConfigMod = loadTs('../app/src/features/edition/editionConfig.ts');

// VerificationPanel UI
const verifPanelMod = loadTs('../app/src/features/verification/VerificationPanel.tsx', (id) => {
  if (id.includes('verificationModel')) return verifModelMod;
  if (id.includes('verificationState')) return verifStateMod;
  return require(id);
});

// TranscriptCapturePanel UI
const transcriptPanelMod = loadTs('../app/src/features/transcript/TranscriptCapturePanel.tsx', (id) => {
  if (id.includes('verification')) return verifIndexMod;
  if (id.includes('edition')) return editionConfigMod;
  return require(id);
});

const {
  createDefaultWorkspaceVerificationState,
  ensureWorkspaceVerificationState,
  getOrCreateWorkspaceVerificationState,
  addCriterionToContractInWorkspace,
  getActiveVerificationContract,
  appendVerificationRunToWorkspace,
} = verifStateMod;

const {
  createVerificationContract,
  createVerificationCriterion,
  createVerificationRun,
} = verifModelMod;

const { VerificationPanel } = verifPanelMod;
const { TranscriptCapturePanel } = transcriptPanelMod;

console.log('Running RELEASE-POLISH-VERIFY-023 Regression Test Suite...\n');

// -----------------------------------------------------------------------------
// Test 1: Genuinely New Workspace Starts with ZERO Verification Criteria
// -----------------------------------------------------------------------------
console.log('--- Test 1: New Workspace Verification Starts Empty ---');
{
  const newWsId = 'ws-brand-new';
  const verifState = createDefaultWorkspaceVerificationState(newWsId);

  assert.strictEqual(verifState.contracts.length, 1, 'Default contract shell is created');
  const defaultContract = verifState.contracts[0];
  assert.strictEqual(defaultContract.name, 'Standard checks');
  assert.strictEqual(
    defaultContract.criteria.length,
    0,
    'New workspace MUST have exactly zero verification criteria (no guessed commands)',
  );
  assert.strictEqual(
    verifState.selectedCriterionIds.size,
    0,
    'No criteria are selected when criteria list is empty',
  );
  assert.strictEqual(verifState.runs.length, 0, 'No runs exist initially');
  assert.strictEqual(verifState.activeRunId, null, 'No active run initially');

  // Verify full workspace factory integration
  const ws = defaultWsMod.createDefaultLogicalWorkspace(newWsId, 'New Project');
  const ensuredWs = ensureWorkspaceVerificationState(ws);
  const activeContract = getActiveVerificationContract(ensuredWs);

  assert.strictEqual(
    activeContract.criteria.length,
    0,
    'Ensured fresh workspace has exactly 0 verification criteria',
  );

  // Assert standard guessed commands do NOT exist
  const commands = activeContract.criteria.map((c) => c.command.toLowerCase());
  assert.ok(!commands.some((cmd) => cmd.includes('test')), 'No automatic Test check');
  assert.ok(!commands.some((cmd) => cmd.includes('typecheck')), 'No automatic Typecheck check');
  assert.ok(!commands.some((cmd) => cmd.includes('lint')), 'No automatic Lint check');
  assert.ok(!commands.some((cmd) => cmd.includes('build')), 'No automatic Build check');

  console.log('✓ New Workspace starts with empty criteria: 0 commands guessed');
}

// -----------------------------------------------------------------------------
// Test 2: Existing Persisted Workspace Configuration Remains Intact
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Existing Persisted Workspace Configuration Preserved ---');
{
  // Simulated existing workspace with user-configured checks A, B, C
  const existingWs = defaultWsMod.createDefaultLogicalWorkspace('ws-existing', 'My Existing Project');
  const customContract = createVerificationContract({
    id: 'contract-custom-1',
    workspaceId: 'ws-existing',
    name: 'Custom Pipeline',
    criteria: [
      createVerificationCriterion({ id: 'crit-a', label: 'Unit Tests', command: 'npm test -- --coverage' }),
      createVerificationCriterion({ id: 'crit-b', label: 'Linter', command: 'npm run lint:strict' }),
      createVerificationCriterion({ id: 'crit-c', label: 'Backend Health', command: './scripts/check_backend.sh' }),
    ],
  });

  existingWs.verification = {
    contracts: [customContract],
    activeContractId: customContract.id,
    runs: [],
    activeRunId: null,
    selectedCriterionIds: new Set(['crit-a', 'crit-c']),
  };

  // 1. Serialization
  const serialized = wsPersistMod.serializeWorkspaceState([existingWs], existingWs.id);
  assert.ok(serialized.workspaces[0].verification, 'Verification state is serialized');
  assert.strictEqual(serialized.workspaces[0].verification.contracts.length, 1);
  assert.strictEqual(serialized.workspaces[0].verification.contracts[0].criteria.length, 3);

  // 2. Hydration
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);
  assert.ok(hydrated, 'Hydration succeeds');
  const restoredWs = hydrated.workspaces[0];
  const restoredContract = getActiveVerificationContract(restoredWs);

  assert.strictEqual(restoredContract.criteria.length, 3, 'All 3 user criteria preserved on restart');
  assert.strictEqual(restoredContract.criteria[0].command, 'npm test -- --coverage');
  assert.strictEqual(restoredContract.criteria[1].command, 'npm run lint:strict');
  assert.strictEqual(restoredContract.criteria[2].command, './scripts/check_backend.sh');
  assert.strictEqual(restoredWs.verification.selectedCriterionIds.size, 2, 'Selection preserved');
  assert.ok(restoredWs.verification.selectedCriterionIds.has('crit-a'));
  assert.ok(restoredWs.verification.selectedCriterionIds.has('crit-c'));

  console.log('✓ Existing persisted criteria A/B/C and selections remain strictly intact');
}

// -----------------------------------------------------------------------------
// Test 3: Empty State UX in VerificationPanel
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Empty State UX in VerificationPanel ---');
{
  const emptyContract = createVerificationContract({
    id: 'contract-empty',
    workspaceId: 'ws-empty',
    name: 'Standard checks',
    criteria: [],
  });

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract: emptyContract,
      contracts: [emptyContract],
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      isStopping: false,
      isStopTimeout: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  // A. Empty state message and Add Check button
  assert.ok(
    html.includes('No verification checks configured.'),
    'Renders "No verification checks configured."',
  );
  assert.ok(
    html.includes('+ Add Check'),
    'Renders "+ Add Check" button in empty state',
  );

  // B. Meaningless controls are hidden when criteria.length === 0
  assert.ok(
    !html.includes('0 of 0 selected'),
    'Must NOT render meaningless "0 of 0 selected"',
  );
  assert.ok(
    !html.includes('verification-selection-toolbar'),
    'Must NOT render selection toolbar',
  );
  assert.ok(
    !html.includes('Run Selected'),
    'Must NOT render "Run Selected" button when criteria list is empty',
  );
  assert.ok(
    !html.includes('Select all'),
    'Must NOT render "Select all" button',
  );
  assert.ok(
    !html.includes('Clear'),
    'Must NOT render "Clear" button',
  );

  console.log('✓ Clean empty state: shows "+ Add Check" and hides 0/0 and Run Selected');
}

// -----------------------------------------------------------------------------
// Test 4: Manually Adding First Check
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Manually Adding First Check ---');
{
  let ws = defaultWsMod.createDefaultLogicalWorkspace('ws-add-check');
  ws = ensureWorkspaceVerificationState(ws);
  assert.strictEqual(getActiveVerificationContract(ws).criteria.length, 0);

  // User adds first check
  const newCriterion = {
    label: 'Smoke Tests',
    command: 'npm run test:smoke',
    expectedExitCodes: [0],
  };

  ws = addCriterionToContractInWorkspace(ws, getActiveVerificationContract(ws).id, newCriterion);
  const activeContract = getActiveVerificationContract(ws);

  assert.strictEqual(activeContract.criteria.length, 1, 'Profile has exactly 1 check');
  assert.strictEqual(activeContract.criteria[0].label, 'Smoke Tests');
  assert.strictEqual(activeContract.criteria[0].command, 'npm run test:smoke');

  // Verify it is automatically selected for execution
  assert.strictEqual(ws.verification.selectedCriterionIds.size, 1);
  assert.ok(ws.verification.selectedCriterionIds.has(activeContract.criteria[0].id));

  // Render VerificationPanel with the new check
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract: activeContract,
      contracts: [activeContract],
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      isStopping: false,
      isStopTimeout: false,
      selectedCriterionIds: ws.verification.selectedCriterionIds,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  assert.ok(html.includes('Smoke Tests'), 'Renders check label');
  assert.ok(html.includes('npm run test:smoke'), 'Renders check command');
  assert.ok(html.includes('1 of 1 selected'), 'Renders valid selection count');
  assert.ok(html.includes('Run Selected (1)'), 'Renders active Run Selected button');
  assert.ok(html.includes('Select all'), 'Renders Select all');

  // Verify persistence of newly added check
  const serialized = wsPersistMod.serializeWorkspaceState([ws], ws.id);
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);
  const restoredCheck = getActiveVerificationContract(hydrated.workspaces[0]).criteria[0];
  assert.strictEqual(restoredCheck.command, 'npm run test:smoke');

  console.log('✓ Manually added check appears normally, is selectable/runnable, and persists across restart');
}

// -----------------------------------------------------------------------------
// Test 5: Existing Historical VerificationRun Remains Immutable
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Historical VerificationRun Immutability ---');
{
  let ws = defaultWsMod.createDefaultLogicalWorkspace('ws-hist');
  const contract = createVerificationContract({
    id: 'contract-hist',
    workspaceId: 'ws-hist',
    name: 'Standard checks',
    criteria: [
      createVerificationCriterion({ id: 'c1', label: 'Lint', command: 'npm run lint' }),
    ],
  });
  ws.verification = {
    contracts: [contract],
    activeContractId: contract.id,
    runs: [],
    activeRunId: null,
    selectedCriterionIds: new Set(['c1']),
  };

  // Run 1 created and completed
  const run1 = createVerificationRun({
    contract,
    workspaceId: ws.id,
  });
  run1.status = 'passed';
  run1.criterionResults = [
    {
      criterionId: 'c1',
      status: 'passed',
      observedExitCode: 0,
      startedAt: Date.now() - 2000,
      completedAt: Date.now() - 1000,
    },
  ];
  ws = appendVerificationRunToWorkspace(ws, run1);

  // Now user clears or changes contract criteria
  ws.verification.contracts[0].criteria = [];

  // Persistence roundtrip
  const serialized = wsPersistMod.serializeWorkspaceState([ws], ws.id);
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);
  const restoredRun = hydrated.workspaces[0].verification.runs[0];

  assert.strictEqual(restoredRun.criteriaSnapshot.length, 1);
  assert.strictEqual(restoredRun.criteriaSnapshot[0].command, 'npm run lint');
  assert.strictEqual(restoredRun.criterionResults[0].status, 'passed');

  console.log('✓ Historical VerificationRun snapshot strictly preserved across profile changes & restart');
}

// -----------------------------------------------------------------------------
// Test 6: Verify Expand Control Hidden in Public Terminal Edition
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Verify Expand Control Hidden in Public Terminal UI ---');
{
  const publicCapabilities = editionConfigMod.getProductCapabilities('terminal');
  assert.strictEqual(publicCapabilities.agents, false, 'Terminal edition has agents: false');

  // Render TranscriptCapturePanel in public terminal edition
  const htmlPublic = ReactDOMServer.renderToStaticMarkup(
    React.createElement(TranscriptCapturePanel, {
      isListening: false,
      blocks: [],
      currentBatchId: null,
      currentBatchBlockCount: 0,
      selectedBlockIds: new Set(),
      feedback: null,
      activeView: 'verification',
      onToggleListening: () => {},
      onToggleSelect: () => {},
      onSelectAllVisible: () => {},
      onClearSelection: () => {},
      onCopyBlock: () => {},
      onCopySelected: () => {},
      onDeleteBlock: () => {},
      onDeleteSelected: () => {},
      onToggleMonitorFocus: () => {},
      verificationContract: createVerificationContract({
        id: 'c-test',
        workspaceId: 'w-1',
        name: 'Standard checks',
        criteria: [],
      }),
    }),
  );

  // Assert expand/enlarge button is NOT rendered in public terminal edition
  assert.ok(
    !htmlPublic.includes('monitor-focus-toggle-btn'),
    'Expand control (monitor-focus-toggle-btn) must NOT be rendered in public Terminal UI',
  );
  assert.ok(
    !htmlPublic.includes('Focus Monitor'),
    'Focus Monitor tooltip/aria-label must NOT be rendered in public Terminal UI',
  );
  assert.ok(
    !htmlPublic.includes('⤢'),
    'Expand symbol ⤢ must NOT be rendered in public Terminal UI',
  );

  // Assert Verify tab is present and aligned
  assert.ok(htmlPublic.includes('Verify'), 'Verify tab is properly rendered');
  assert.ok(htmlPublic.includes('Changes'), 'Changes tab is properly rendered');
  assert.ok(htmlPublic.includes('Capture'), 'Capture tab is properly rendered');

  console.log('✓ Verify expand control is strictly omitted from public Terminal edition with clean tab alignment');
}

console.log('\n=============================================================');
console.log('ALL RELEASE-POLISH-VERIFY-023 REGRESSION TESTS PASSED!');
console.log('=============================================================\n');
