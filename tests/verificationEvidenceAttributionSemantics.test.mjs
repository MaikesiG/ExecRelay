/**
 * HARDEN-VERIFY-EVIDENCE-020: Verification Result & Repository Change Semantics Test Suite
 *
 * Verifies that:
 * 1. Dirty baseline + 0 changes during run reports "0 new files changed during this run"
 *    and NEVER lists baseline files under the run changes list.
 * 2. Dirty baseline is represented separately and collapsed by default with explicit labeling.
 * 3. Clean baseline + 0 changes produces no baseline section and 0 new changes.
 * 4. Clean baseline + 2 changes shows exactly 2 run changes and no baseline section.
 * 5. Dirty baseline + 1 newly modified file keeps baseline list and run-change list distinct.
 * 6. Failed Verification shows the failed criterion before repository attribution.
 * 7. Failed criterion exposes canonical Execution ID, observed exit code, and failure evidence.
 * 8. Historical run uses captured immutable snapshots, not current repository state.
 * 9. Unavailable attribution does not fall back to current dirty working tree.
 * 10. "Observed during verification run" is never used for baseline-only rows.
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

// 1. Transpile dependencies
const fileStatusMod = transpileTsx(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/fileStatusPresentation.ts'),
);

const deltaEngineMod = transpileTsx(
  path.resolve(__dirname, '../app/src/features/attribution/deltaEngine.ts'),
);

const changeAttrMod = transpileTsx(
  path.resolve(__dirname, '../app/src/features/attribution/ChangeAttributionView.tsx'),
  (req) => {
    if (req.includes('fileStatusPresentation')) return fileStatusMod;
    if (req.includes('react')) return React;
    if (req.endsWith('.css')) return {};
    return {};
  },
);

const formatMod = transpileTsx(
  path.resolve(__dirname, '../app/src/features/transcript/transcriptFormat.ts'),
);

const execMod = transpileTsx(
  path.resolve(__dirname, '../app/src/features/execution/executionModel.ts'),
  (req) => {
    if (req.includes('transcriptFormat')) return formatMod;
    return {};
  },
);

const verifModelMod = transpileTsx(
  path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'),
  (req) => {
    if (req.includes('execution')) return execMod;
    return {};
  },
);

const verifPanelMod = transpileTsx(
  path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.tsx'),
  (req) => {
    if (req.includes('verificationModel')) return verifModelMod;
    if (req.includes('ChangeAttributionView')) return changeAttrMod;
    if (req.includes('transcriptFormat')) return formatMod;
    if (req.includes('execution')) return execMod;
    if (
      req.includes('VerificationCheckModal') ||
      req.includes('VerificationProfileModal') ||
      req.includes('NewProfileModal')
    ) {
      return {
        VerificationCheckModal: () => null,
        VerificationProfileModal: () => null,
        NewProfileModal: () => null,
      };
    }
    if (req.includes('react')) return React;
    if (req.endsWith('.css')) return {};
    return {};
  },
);

const { ChangeAttributionView } = changeAttrMod;
const { VerificationPanel } = verifPanelMod;
const { computeRepositoryDelta } = deltaEngineMod;

console.log('Running HARDEN-VERIFY-EVIDENCE-020: Verification Result & Repository Change Semantics Suite...\n');

// -----------------------------------------------------------------------------
// Test 1: Dirty baseline + zero changes during run
// -----------------------------------------------------------------------------
console.log('--- Test 1: Dirty Baseline + Zero Changes During Run ---');
{
  const beforeSnapshot = {
    id: 'snap-before-1',
    workspaceId: 'ws-1',
    repositoryRoot: '/repo',
    status: {
      clean: false,
      files: [
        { path: 'app/src/App.tsx', status: 'modified', staged: false, unstaged: true },
        { path: 'app/package.json', status: 'modified', staged: false, unstaged: true },
      ],
    },
    diffSummary: {
      files: [
        { path: 'app/src/App.tsx', insertions: 10, deletions: 2 },
        { path: 'app/package.json', insertions: 1, deletions: 1 },
      ],
    },
    collectedAt: Date.now() - 5000,
  };

  const afterSnapshot = {
    id: 'snap-after-1',
    workspaceId: 'ws-1',
    repositoryRoot: '/repo',
    status: {
      clean: false,
      files: [
        { path: 'app/src/App.tsx', status: 'modified', staged: false, unstaged: true },
        { path: 'app/package.json', status: 'modified', staged: false, unstaged: true },
      ],
    },
    diffSummary: {
      files: [
        { path: 'app/src/App.tsx', insertions: 10, deletions: 2 },
        { path: 'app/package.json', insertions: 1, deletions: 1 },
      ],
    },
    collectedAt: Date.now(),
  };

  const delta = computeRepositoryDelta(beforeSnapshot, afterSnapshot);
  assert.strictEqual(delta.filesChanged, 0, 'filesChanged must be 0 when nothing changed during run');

  const attribution = {
    id: 'attr-1',
    workspaceId: 'ws-1',
    targetType: 'verification-run',
    targetId: 'run-1',
    repositoryRoot: '/repo',
    beforeSnapshotId: beforeSnapshot.id,
    afterSnapshotId: afterSnapshot.id,
    status: 'completed',
    scope: delta.deltaScope,
    delta,
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
    limitations: [],
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ChangeAttributionView, { attribution }),
  );

  assert.ok(
    html.includes('0 new files changed during this run'),
    'Must report "0 new files changed during this run"',
  );

  // Assert baseline files are NOT rendered as run changes:
  // Since showFiles defaults to true for run changes, if runChanges is empty, attribution-files-section should NOT render!
  assert.ok(
    !html.includes('attribution-files-section'),
    'Must NOT render attribution-files-section when zero files changed during run',
  );

  console.log('✓ 0 new files changed reported; baseline files strictly excluded from run changes');
}

// -----------------------------------------------------------------------------
// Test 2: Dirty baseline is represented separately
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Dirty Baseline Represented Separately & Explicitly Labeled ---');
{
  const attribution = {
    id: 'attr-2',
    workspaceId: 'ws-1',
    targetType: 'verification-run',
    targetId: 'run-2',
    repositoryRoot: '/repo',
    status: 'completed',
    scope: 'dirty-baseline',
    delta: {
      filesChanged: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      deltaScope: 'dirty-baseline',
      files: [
        { path: 'app/src/App.tsx', status: 'modified', deltaKind: 'unchanged-existing' },
        { path: 'app/package.json', status: 'modified', deltaKind: 'unchanged-existing' },
      ],
    },
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
    limitations: [],
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ChangeAttributionView, { attribution }),
  );

  assert.ok(
    html.includes('attribution-baseline-section'),
    'Must render a separate attribution-baseline-section',
  );
  assert.ok(
    html.includes('Pre-existing changes before verification'),
    'Must clearly title pre-existing baseline section',
  );
  assert.ok(
    html.includes('These changes existed before this VerificationRun started.'),
    'Must explicitly state that baseline changes existed prior to this VerificationRun',
  );
  assert.ok(
    html.includes('Show baseline'),
    'Must provide button to expand baseline files',
  );
  // Collapsed by default: baseline files list must NOT be rendered initially
  assert.ok(
    !html.includes('attribution-baseline-list'),
    'Baseline file list must be collapsed by default',
  );

  console.log('✓ Dirty baseline is separated, collapsed by default, and truthfully labeled');
}

// -----------------------------------------------------------------------------
// Test 3: Clean baseline + zero changes
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Clean Baseline + Zero Changes ---');
{
  const attribution = {
    id: 'attr-3',
    workspaceId: 'ws-1',
    targetType: 'verification-run',
    targetId: 'run-3',
    repositoryRoot: '/repo',
    status: 'completed',
    scope: 'clean-baseline',
    delta: {
      filesChanged: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      deltaScope: 'clean-baseline',
      files: [],
    },
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
    limitations: [],
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ChangeAttributionView, { attribution }),
  );

  assert.ok(
    html.includes('0 new files changed during this run'),
    'Must report 0 new files changed',
  );
  assert.ok(
    !html.includes('attribution-baseline-section'),
    'Must NOT render baseline section when baseline was clean',
  );
  assert.ok(
    html.includes('Clean baseline'),
    'Must show clean baseline badge',
  );

  console.log('✓ Clean baseline + 0 changes renders 0 new changes and omits baseline section');
}

// -----------------------------------------------------------------------------
// Test 4: Clean baseline + 2 changes during run
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Clean Baseline + 2 Changes During Run ---');
{
  const attribution = {
    id: 'attr-4',
    workspaceId: 'ws-1',
    targetType: 'verification-run',
    targetId: 'run-4',
    repositoryRoot: '/repo',
    status: 'completed',
    scope: 'clean-baseline',
    delta: {
      filesChanged: 2,
      addedCount: 1,
      modifiedCount: 1,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      deltaScope: 'clean-baseline',
      files: [
        { path: 'dist/bundle.js', status: 'added', deltaKind: 'introduced' },
        { path: 'build.log', status: 'modified', deltaKind: 'introduced' },
      ],
    },
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
    limitations: [],
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ChangeAttributionView, { attribution }),
  );

  assert.ok(
    html.includes('2 files changed during this run'),
    'Must report exactly 2 files changed',
  );
  assert.ok(
    html.includes('dist/bundle.js'),
    'Must list first changed file',
  );
  assert.ok(
    html.includes('build.log'),
    'Must list second changed file',
  );
  assert.ok(
    !html.includes('attribution-baseline-section'),
    'Clean baseline must not have baseline section',
  );

  console.log('✓ Exactly 2 run changes rendered; clean baseline preserved');
}

// -----------------------------------------------------------------------------
// Test 5: Dirty baseline + 1 newly modified file
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Dirty Baseline + 1 Newly Modified File ---');
{
  const attribution = {
    id: 'attr-5',
    workspaceId: 'ws-1',
    targetType: 'verification-run',
    targetId: 'run-5',
    repositoryRoot: '/repo',
    status: 'completed',
    scope: 'dirty-baseline',
    delta: {
      filesChanged: 1,
      addedCount: 0,
      modifiedCount: 1,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      deltaScope: 'dirty-baseline',
      files: [
        { path: 'dist/new-output.js', status: 'modified', deltaKind: 'introduced' },
        { path: 'app/src/App.tsx', status: 'modified', deltaKind: 'unchanged-existing' },
        { path: 'app/package.json', status: 'modified', deltaKind: 'unchanged-existing' },
      ],
    },
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
    limitations: [],
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ChangeAttributionView, { attribution }),
  );

  assert.ok(
    html.includes('1 file changed during this run'),
    'Must report 1 file changed during run',
  );
  assert.ok(
    html.includes('dist/new-output.js'),
    'Run change list must contain newly modified file',
  );
  // The run-changes section must NOT contain the pre-existing files
  const runChangesSection = html.slice(
    html.indexOf('attribution-files-section'),
    html.indexOf('attribution-baseline-section'),
  );
  assert.ok(
    !runChangesSection.includes('app/src/App.tsx'),
    'Run changes list must NOT contain pre-existing file app/src/App.tsx',
  );
  assert.ok(
    !runChangesSection.includes('app/package.json'),
    'Run changes list must NOT contain pre-existing file app/package.json',
  );
  assert.ok(
    html.includes('Pre-existing changes before verification'),
    'Must include separate baseline section for the 2 pre-existing files',
  );

  console.log('✓ Run change list and baseline list are strictly disjoint');
}

// -----------------------------------------------------------------------------
// Test 6: Failed Verification shows failed criterion before repository attribution
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Failed Verification Shows Failed Criterion Before Repository Attribution ---');
{
  const contract = {
    id: 'contract-1',
    workspaceId: 'ws-1',
    name: 'Standard verification',
    criteria: [
      {
        id: 'crit-build',
        contractId: 'contract-1',
        label: 'Production build',
        command: 'npm run build',
        expectedExitCodes: [0],
        availability: 'available',
        sortOrdinal: 1,
      },
    ],
  };

  const failedRun = {
    id: 'run-failed-6',
    contractId: 'contract-1',
    profileName: 'Standard verification',
    workspaceId: 'ws-1',
    status: 'failed',
    criteriaSnapshot: contract.criteria,
    criterionResults: [
      {
        criterionId: 'crit-build',
        status: 'failed',
        executionId: 'exec-build-6',
        observedExitCode: 2,
        startedAt: Date.now() - 4000,
        completedAt: Date.now(),
        message: 'Observed exit code 2 does not satisfy expected [0]',
      },
    ],
    startedAt: Date.now() - 4000,
    completedAt: Date.now(),
  };

  const blocks = [
    {
      id: 'exec-build-6',
      executionId: 'exec-build-6',
      batchId: 1,
      command: 'npm run build',
      output: 'error TS2322: Type mismatch in App.tsx',
      startedAt: Date.now() - 4000,
      completedAt: Date.now(),
      isComplete: true,
      terminalPaneId: 'pane-1',
      terminalLabelAtCapture: 'Terminal 1',
    },
  ];

  const attribution = {
    id: 'attr-6',
    workspaceId: 'ws-1',
    targetType: 'verification-run',
    targetId: 'run-failed-6',
    repositoryRoot: '/repo',
    status: 'completed',
    scope: 'dirty-baseline',
    startedAt: Date.now() - 4000,
    completedAt: Date.now(),
    limitations: [],
    delta: {
      filesChanged: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      deltaScope: 'dirty-baseline',
      files: [
        { path: 'app/src/App.tsx', status: 'modified', deltaKind: 'unchanged-existing' },
      ],
    },
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      activeRun: null,
      historicalRuns: [failedRun],
      isRunning: false,
      blocks,
      changeAttributions: [attribution],
      onRunVerification: () => {},
      onCancelVerification: () => {},
      onSelectExecution: () => {},
    }),
  );

  const criterionIndex = html.indexOf('Production build');
  const attributionIndex = html.indexOf('0 new files changed during this run');

  assert.ok(criterionIndex !== -1, 'Failed criterion must be present in HTML');
  assert.ok(attributionIndex !== -1, 'Repository Impact must be present in HTML');
  assert.ok(
    criterionIndex < attributionIndex,
    'Failed criterion must appear BEFORE Repository Impact in the information hierarchy',
  );

  console.log('✓ Failed criterion rendered before repository attribution');
}

// -----------------------------------------------------------------------------
// Test 7: Failed criterion exposes canonical Execution / evidence reference
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Failed Criterion Exposes Execution Identity & Bounded Evidence ---');
{
  const contract = {
    id: 'contract-1',
    workspaceId: 'ws-1',
    name: 'Standard verification',
    criteria: [
      {
        id: 'crit-build',
        contractId: 'contract-1',
        label: 'Production build',
        command: 'npm run build',
        expectedExitCodes: [0],
        availability: 'available',
        sortOrdinal: 1,
      },
    ],
  };

  const failedRun = {
    id: 'run-failed-7',
    contractId: 'contract-1',
    profileName: 'Standard verification',
    workspaceId: 'ws-1',
    status: 'failed',
    criteriaSnapshot: contract.criteria,
    criterionResults: [
      {
        criterionId: 'crit-build',
        status: 'failed',
        executionId: 'exec-build-7',
        observedExitCode: 2,
        startedAt: Date.now() - 4000,
        completedAt: Date.now(),
        message: 'Observed exit code 2 does not satisfy expected [0]',
      },
    ],
    startedAt: Date.now() - 4000,
    completedAt: Date.now(),
  };

  const blocks = [
    {
      id: 'exec-build-7',
      executionId: 'exec-build-7',
      batchId: 1,
      command: 'npm run build',
      output: 'src/App.tsx(2736,21): error TS2322: Type mismatch in App.tsx',
      startedAt: Date.now() - 4000,
      completedAt: Date.now(),
      isComplete: true,
      terminalPaneId: 'pane-1',
      terminalLabelAtCapture: 'Terminal 1',
    },
  ];

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      activeRun: null,
      historicalRuns: [failedRun],
      isRunning: false,
      blocks,
      changeAttributions: [],
      onRunVerification: () => {},
      onCancelVerification: () => {},
      onSelectExecution: () => {},
    }),
  );

  assert.ok(html.includes('Execution: <code>exec-build-7</code>'), 'Must expose canonical execution ID');
  assert.ok(html.includes('Observed: exit 2'), 'Must expose observed non-zero exit code');
  assert.ok(html.includes('Failure evidence:'), 'Must label failure evidence');
  assert.ok(html.includes('error TS2322'), 'Must expose bounded failure evidence text');
  assert.ok(html.includes('View execution'), 'Must provide View execution button');

  console.log('✓ Canonical Execution ID, exit code, failure evidence, and drill-down exposed');
}

// -----------------------------------------------------------------------------
// Test 8: Historical run uses captured snapshots, not current repository state
// -----------------------------------------------------------------------------
console.log('\n--- Test 8: Historical Run Uses Captured Snapshots (Immutability) ---');
{
  const historicalRun = {
    id: 'run-hist-8',
    contractId: 'contract-1',
    profileName: 'Profile',
    workspaceId: 'ws-1',
    status: 'passed',
    attributionId: 'attr-hist-8',
    criteriaSnapshot: [
      { id: 'crit-test', contractId: 'contract-1', label: 'Test', command: 'npm test', expectedExitCodes: [0] },
    ],
    criterionResults: [
      { criterionId: 'crit-test', status: 'passed', executionId: 'exec-test-8', observedExitCode: 0 },
    ],
    startedAt: 1000,
    completedAt: 2000,
  };

  const histAttribution = {
    id: 'attr-hist-8',
    workspaceId: 'ws-1',
    targetType: 'verification-run',
    targetId: 'run-hist-8',
    repositoryRoot: '/repo',
    beforeSnapshotId: 'snap-before-historical-1000',
    afterSnapshotId: 'snap-after-historical-2000',
    status: 'completed',
    scope: 'clean-baseline',
    delta: {
      filesChanged: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      deltaScope: 'clean-baseline',
      files: [],
    },
    startedAt: 1000,
    completedAt: 2000,
    limitations: [],
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract: { id: 'contract-1', workspaceId: 'ws-1', name: 'Profile', criteria: [] },
      activeRun: null,
      historicalRuns: [historicalRun],
      isRunning: false,
      changeAttributions: [histAttribution],
      onRunVerification: () => {},
      onCancelVerification: () => {},
      onViewSnapshot: () => {},
    }),
  );

  // Must render attribution linked to historical run
  assert.ok(html.includes('0 new files changed during this run'), 'Must render historical attribution');
  assert.ok(html.includes('Before: snap-before-hist'), 'Must link to immutable historical before snapshot');
  assert.ok(html.includes('After: snap-after-histo'), 'Must link to immutable historical after snapshot');

  console.log('✓ Historical run renders immutable captured snapshots');
}

// -----------------------------------------------------------------------------
// Test 9: Unavailable attribution does not fall back to current dirty working tree
// -----------------------------------------------------------------------------
console.log('\n--- Test 9: Unavailable Attribution Does Not Fall Back to Working Tree ---');
{
  const historicalRun = {
    id: 'run-no-attr-9',
    contractId: 'contract-1',
    profileName: 'Profile',
    workspaceId: 'ws-1',
    status: 'passed',
    criteriaSnapshot: [
      { id: 'crit-test', contractId: 'contract-1', label: 'Test', command: 'npm test', expectedExitCodes: [0] },
    ],
    criterionResults: [
      { criterionId: 'crit-test', status: 'passed', executionId: 'exec-test-9', observedExitCode: 0 },
    ],
    startedAt: 1000,
    completedAt: 2000,
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract: { id: 'contract-1', workspaceId: 'ws-1', name: 'Profile', criteria: [] },
      activeRun: null,
      historicalRuns: [historicalRun],
      isRunning: false,
      changeAttributions: [], // No attribution available
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  assert.ok(
    html.includes('Repository attribution unavailable for this run.'),
    'Must report attribution unavailable honestly',
  );
  assert.ok(
    !html.includes('attribution-files-list'),
    'Must NOT render any working tree file list',
  );

  console.log('✓ Unavailable attribution reported honestly without fabricating file list');
}

// -----------------------------------------------------------------------------
// Test 10: "Observed during verification run" is never used for baseline-only rows
// -----------------------------------------------------------------------------
console.log('\n--- Test 10: "Observed during verification run" Not Used for Baseline-Only State ---');
{
  const attribution = {
    id: 'attr-10',
    workspaceId: 'ws-1',
    targetType: 'verification-run',
    targetId: 'run-10',
    repositoryRoot: '/repo',
    status: 'completed',
    scope: 'dirty-baseline',
    delta: {
      filesChanged: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      deltaScope: 'dirty-baseline',
      files: [
        { path: 'app/src/App.tsx', status: 'modified', deltaKind: 'unchanged-existing' },
      ],
    },
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
    limitations: [],
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ChangeAttributionView, { attribution }),
  );

  assert.ok(
    !html.includes('Observed during verification run'),
    'Must NOT use "Observed during verification run" when 0 files changed during run',
  );
  assert.ok(
    html.includes('Pre-existing before verification'),
    'Must accurately describe window note as pre-existing before verification',
  );

  console.log('✓ Truthful wording preserved: baseline-only state is never described as observed during run');
}

console.log('\n=============================================================');
console.log('ALL HARDEN-VERIFY-EVIDENCE-020 REGRESSION TESTS PASSED (10/10)!');
console.log('=============================================================\n');
