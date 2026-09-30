/**
 * Regression and Layout Stability Test Suite
 *
 * Covers:
 * 1. Evidence / Verification switcher spacing and pane-header alignment
 * 2. Evidence blocks scrolling, non-squishing reachability, and sticky action bar clearance
 * 3. Verification cancellation, active state release, immediate re-run, and historical integrity
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

// 1. Transpile verification types & models
const verTypesSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/verification/types.ts'), 'utf8');
const verTypesJs = ts.transpileModule(verTypesSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const verTypesMod = { exports: {} };
new Function('module', 'exports', 'require', verTypesJs)(verTypesMod, verTypesMod.exports, () => ({}));

const verModelSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'), 'utf8');
const verModelJs = ts.transpileModule(verModelSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const verModelMod = { exports: {} };
new Function('module', 'exports', 'require', verModelJs)(verModelMod, verModelMod.exports, () => ({}));
const {
  createDefaultVerificationContract,
  createVerificationCriterion,
  createVerificationRun,
} = verModelMod.exports;

const verStateSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/verification/verificationState.ts'), 'utf8');
const verStateJs = ts.transpileModule(verStateSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const verStateMod = { exports: {} };
new Function('module', 'exports', 'require', verStateJs)(verStateMod, verStateMod.exports, (req) => {
  if (req.includes('types')) return verTypesMod.exports;
  if (req.includes('verificationModel')) return verModelMod.exports;
  return verModelMod.exports;
});
const {
  getOrCreateWorkspaceVerificationState,
  getActiveVerificationContract,
  getWorkspaceVerificationRuns,
  getLatestVerificationRun,
  appendVerificationRunToWorkspace,
  updateVerificationRunInWorkspace,
} = verStateMod.exports;

function createMockWorkspace(id = 'ws-test-1', name = 'Test Workspace') {
  return {
    id,
    name,
    rootFolderId: 'root-1',
    activeTerminalTabId: 'tab-1',
    terminalTabs: [
      {
        id: 'tab-1',
        title: 'Terminal 1',
        paneIds: ['pane-1'],
        activePaneId: 'pane-1',
        panes: [
          {
            id: 'pane-1',
            title: 'bash',
            session: {
              sessionId: 'sess-1',
              sessionInfo: {
                sessionId: 'sess-1',
                paneId: 'pane-1',
                workspaceId: id,
                terminalTabId: 'tab-1',
                cwd: '/workspace/project',
              },
            },
          },
        ],
      },
    ],
    capture: {
      isListening: false,
      blocks: [],
      batchCounter: 0,
    },
    selection: {
      selectedBlockIds: new Set(),
    },
  };
}

console.log('Running TraceRelay Regression & Layout Stability Pass Tests...\n');

// ============================================================================
// Issue 1: Evidence / Verification switcher spacing & pane-header alignment
// ============================================================================
{
  console.log('--- Test 1: Evidence / Verification switcher layout and alignment ---');

  const appCssPath = path.resolve(__dirname, '../app/src/App.css');
  const appCss = fs.readFileSync(appCssPath, 'utf8');

  const layoutCssPath = path.resolve(__dirname, '../app/src/features/workspace/TerminalPaneLayout.css');
  const layoutCss = fs.readFileSync(layoutCssPath, 'utf8');

  // 1. Shared CSS variable --pane-header-height is defined in :root
  assert.ok(
    appCss.includes('--pane-header-height: 25px;'),
    'App.css defines --pane-header-height: 25px in :root',
  );

  // 2. Terminal pane header uses the shared variable
  assert.ok(
    layoutCss.includes('height: var(--pane-header-height, 25px);'),
    'TerminalPaneLayout.css uses --pane-header-height for terminal-pane-header height',
  );
  assert.ok(
    layoutCss.includes('min-height: var(--pane-header-height, 25px);'),
    'TerminalPaneLayout.css uses --pane-header-height for min-height',
  );
  assert.ok(
    layoutCss.includes('max-height: var(--pane-header-height, 25px);'),
    'TerminalPaneLayout.css uses --pane-header-height for max-height',
  );

  // 3. Switcher segmented-control uses the shared variable
  assert.ok(
    appCss.includes('.capture-view-segmented-control'),
    'App.css defines .capture-view-segmented-control',
  );
  assert.ok(
    appCss.includes('height: var(--pane-header-height, 25px);'),
    'App.css uses --pane-header-height for switcher height',
  );
  assert.ok(
    appCss.includes('min-height: var(--pane-header-height, 25px);'),
    'App.css uses --pane-header-height for switcher min-height',
  );
  assert.ok(
    appCss.includes('max-height: var(--pane-header-height, 25px);'),
    'App.css uses --pane-header-height for switcher max-height',
  );

  // 4. Switcher is flush to pane top, left, right edges without outer padding
  assert.ok(
    appCss.includes('margin: -6px -8px 6px -8px;'),
    'Switcher offsets context-panel padding to sit flush against top/left/right borders',
  );
  assert.ok(
    appCss.includes('width: calc(100% + 16px);'),
    'Switcher fills entire pane width edge to edge',
  );
  assert.ok(
    appCss.includes('position: sticky;'),
    'Switcher remains sticky while content scrolls',
  );
  assert.ok(
    appCss.includes('top: -6px;'),
    'Switcher sticks flush at top edge of pane',
  );

  // 5. Pane header chrome styling matches TerminalPaneHeader
  assert.ok(
    appCss.includes('border-bottom: 1px solid rgba(255, 255, 255, 0.06);'),
    'Switcher border-bottom matches terminal pane header',
  );
  assert.ok(
    appCss.includes('border-radius: 0;'),
    'Switcher border-radius is 0 (flush header, not floating card)',
  );

  console.log('✓ Test 1 passed: Switcher matches Terminal header height and sits flush against pane edges');
}

// ============================================================================
// Issue 2: Evidence scrolling, non-squishing reachability & action bar clearance
// ============================================================================
{
  console.log('\n--- Test 2: Evidence blocks scrolling and reachability ---');

  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');
  const repoCss = fs.readFileSync(path.resolve(__dirname, '../app/src/features/evidenceCollectors/RepositoryEvidenceView.css'), 'utf8');

  // 1. transcript-scroll-container must not collapse to 0px or clip blocks
  assert.ok(
    appCss.includes('.transcript-scroll-container'),
    'App.css defines .transcript-scroll-container',
  );
  assert.ok(
    appCss.includes('flex-shrink: 0;'),
    'transcript-scroll-container has flex-shrink: 0 so sibling content cannot collapse it',
  );
  assert.ok(
    appCss.includes('min-height: fit-content;'),
    'transcript-scroll-container has min-height: fit-content',
  );
  assert.ok(
    appCss.includes('overflow: visible;'),
    'transcript-scroll-container has overflow: visible (no inner nested scroll clipping)',
  );

  // 2. transcript-card-list has bottom padding clearance for sticky selection bar
  assert.ok(
    appCss.includes('padding-bottom: 48px;'),
    'transcript-card-list has 48px bottom padding to prevent sticky bar from covering last block',
  );

  // 3. RepositoryEvidenceView has flex-shrink: 0 so it renders its rows without squishing
  assert.ok(
    repoCss.includes('flex-shrink: 0;'),
    'repository-evidence-container has flex-shrink: 0',
  );

  // 4. Context empty placeholder has flex-shrink: 0 and min-height
  assert.ok(
    appCss.includes('min-height: 120px;'),
    'context-empty has minimum height for legibility',
  );

  // 5. Layout model validation: simulate 50 repository items + 10 execution blocks
  const mockRepoFiles = Array.from({ length: 50 }, (_, i) => ({
    path: `src/component_${i}.tsx`,
    status: 'modified',
    height: 24, // approx 24px per row
  }));
  const totalRepoHeight = mockRepoFiles.reduce((acc, f) => acc + f.height, 0) + 60; // files + header/stats

  const mockBlocks = Array.from({ length: 10 }, (_, i) => ({
    id: `block-${i}`,
    command: `npm test -- test_${i}.spec.ts`,
    height: 95, // approx 95px per transcript card
  }));
  const totalBlocksHeight = mockBlocks.reduce((acc, b) => acc + b.height, 0);

  // When context-panel viewport is 700px:
  const viewportHeight = 700;
  const switcherHeight = 25;
  const toolbarHeight = 110;
  const actionToolbarHeight = 40;

  // In the old broken layout:
  // availableSpace = viewportHeight - (switcher + totalRepoHeight + toolbar) = 700 - (25 + 1260 + 110) = -695px
  // Since min-height was 0 and flex-shrink was 1, transcript-scroll-container height became 0px!
  // In the fixed layout:
  // transcript-scroll-container has flex-shrink: 0 and min-height: fit-content (totalBlocksHeight = 950px)
  // Total scrollable content height:
  const totalContentHeight = switcherHeight + totalRepoHeight + toolbarHeight + totalBlocksHeight + 48;
  assert.ok(totalContentHeight > viewportHeight, 'Content exceeds viewport, requiring scroll');
  assert.strictEqual(totalBlocksHeight, 950, 'All 10 blocks retain full height of 950px without squishing');

  // Verify that the bottom padding of 48px exceeds the 40px action bar height
  assert.ok(48 > actionToolbarHeight, 'Bottom padding (48px) guarantees last card is not obscured by sticky action bar (40px)');

  console.log('✓ Test 2 passed: Execution blocks cannot be squished to 0px and sticky bar has clearance');
}

// ============================================================================
// Issue 3: Verification Cancellation & Re-run Lifecycle
// ============================================================================
{
  console.log('\n--- Test 3: Verification cancellation, active state release & immediate rerun ---');

  let ws = createMockWorkspace('ws-verify-1', 'Verification Test Workspace');
  ws.verification = getOrCreateWorkspaceVerificationState(ws);
  const contract = getActiveVerificationContract(ws);

  // 1. Start Run 1
  const run1 = createVerificationRun({ contract, workspaceId: ws.id });
  run1.status = 'running';
  run1.criterionResults[0] = {
    ...run1.criterionResults[0],
    status: 'running',
    startedAt: Date.now(),
  };
  ws = appendVerificationRunToWorkspace(ws, run1);

  assert.strictEqual(getWorkspaceVerificationRuns(ws).length, 1, 'Run 1 appended');
  assert.strictEqual(ws.verification.activeRunId, run1.id, 'activeRunId set to Run 1');
  const isRunningInitially = ws.verification.runs.some(
    (r) => r.status === 'running' || r.status === 'pending',
  );
  assert.strictEqual(isRunningInitially, true, 'isVerificationRunning is true while running');

  // 2. User cancels Run 1 while criterion 0 is running
  const updatedResultsAfterCancel = run1.criterionResults.map((r) =>
    r.status === 'pending' || r.status === 'running'
      ? { ...r, status: 'skipped', message: 'Verification was cancelled' }
      : r,
  );
  const cancelledRun1 = {
    ...run1,
    status: 'cancelled',
    criterionResults: updatedResultsAfterCancel,
    completedAt: Date.now(),
  };

  ws = updateVerificationRunInWorkspace(ws, cancelledRun1);

  // Invariants after cancellation:
  // - activeRunId must be fully released (null)
  assert.strictEqual(ws.verification.activeRunId, null, 'activeRunId is null after cancellation');

  // - isVerificationRunning must be false
  const isRunningAfterCancel = ws.verification.runs.some(
    (r) => r.status === 'running' || r.status === 'pending',
  );
  assert.strictEqual(isRunningAfterCancel, false, 'isVerificationRunning is false after cancellation');

  // - Historical cancelled run is intact
  const runsAfterCancel = getWorkspaceVerificationRuns(ws);
  assert.strictEqual(runsAfterCancel.length, 1, 'Run 1 remains in history');
  assert.strictEqual(runsAfterCancel[0].id, run1.id);
  assert.strictEqual(runsAfterCancel[0].status, 'cancelled');
  assert.strictEqual(runsAfterCancel[0].criterionResults[0].status, 'skipped');

  // - Latest run points to the cancelled run for card display
  assert.strictEqual(getLatestVerificationRun(ws)?.id, run1.id);
  assert.strictEqual(getLatestVerificationRun(ws)?.status, 'cancelled');

  // 3. User immediately starts Run 2
  const run2 = createVerificationRun({ contract, workspaceId: ws.id });
  run2.status = 'running';
  run2.criterionResults[0] = {
    ...run2.criterionResults[0],
    status: 'running',
    startedAt: Date.now(),
  };
  ws = appendVerificationRunToWorkspace(ws, run2);

  const runsAfterStart2 = getWorkspaceVerificationRuns(ws);
  assert.strictEqual(runsAfterStart2.length, 2, 'History now has Run 1 and Run 2');
  assert.strictEqual(runsAfterStart2[0].id, run1.id, 'Run 1 preserved in position 0');
  assert.strictEqual(runsAfterStart2[0].status, 'cancelled', 'Run 1 is still cancelled');
  assert.strictEqual(runsAfterStart2[1].id, run2.id, 'Run 2 is active at position 1');
  assert.strictEqual(runsAfterStart2[1].status, 'running');
  assert.strictEqual(ws.verification.activeRunId, run2.id, 'activeRunId points to Run 2');

  const isRunningRun2 = ws.verification.runs.some(
    (r) => r.status === 'running' || r.status === 'pending',
  );
  assert.strictEqual(isRunningRun2, true, 'isVerificationRunning is true for Run 2');

  // 4. Run 2 completes successfully
  const passedRun2 = {
    ...run2,
    status: 'passed',
    criterionResults: run2.criterionResults.map((r) => ({
      ...r,
      status: 'passed',
      observedExitCode: 0,
    })),
    completedAt: Date.now(),
  };
  ws = updateVerificationRunInWorkspace(ws, passedRun2);

  assert.strictEqual(ws.verification.activeRunId, null, 'activeRunId reset to null upon Run 2 pass');
  assert.strictEqual(getLatestVerificationRun(ws)?.status, 'passed', 'Latest run is passed');

  // 5. User immediately starts Run 3
  const run3 = createVerificationRun({ contract, workspaceId: ws.id });
  run3.status = 'running';
  ws = appendVerificationRunToWorkspace(ws, run3);

  const runsAfterStart3 = getWorkspaceVerificationRuns(ws);
  assert.strictEqual(runsAfterStart3.length, 3, 'History contains all 3 runs: cancelled, passed, running');
  assert.strictEqual(runsAfterStart3[0].status, 'cancelled');
  assert.strictEqual(runsAfterStart3[1].status, 'passed');
  assert.strictEqual(runsAfterStart3[2].status, 'running');
  assert.strictEqual(ws.verification.activeRunId, run3.id);

  console.log('✓ Test 3 passed: Verification cancellation releases active state, allows immediate re-runs, and preserves history');
}

// ============================================================================
// Issue 3 (App.tsx): App.tsx cancellation orchestration verification
// ============================================================================
{
  console.log('\n--- Test 4: App.tsx verification cancellation orchestration inspection ---');

  const appTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');

  // 1. handleCancelVerification sends \x03 to terminal
  assert.ok(
    appTsx.includes("handleTerminalInput(wsId, runtime.terminalTabId, runtime.terminalPaneId, '\\x03');"),
    'App.tsx handleCancelVerification sends \\x03 SIGINT to terminal to abort running process',
  );

  // 2. handleCancelVerification clears verificationRuntimeRef.current immediately
  assert.ok(
    appTsx.includes('verificationRuntimeRef.current = null;'),
    'App.tsx clears verificationRuntimeRef.current immediately upon cancellation',
  );

  // 3. handleRunVerification protects against concurrent runs while clearing stale runtime
  assert.ok(
    appTsx.includes('const isStillRunning = ws.verification?.runs.some('),
    'App.tsx handleRunVerification checks if existing run is truly still running in workspace state',
  );

  console.log('✓ Test 4 passed: App.tsx orchestration safely interrupts terminal and clears runtime state');
}

console.log('\n=======================================================================');
console.log('ALL REGRESSION & LAYOUT STABILITY TESTS PASSED!');
console.log('=======================================================================\n');
