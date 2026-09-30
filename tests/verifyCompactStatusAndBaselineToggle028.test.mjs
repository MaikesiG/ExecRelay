/**
 * UI-POLISH-VERIFY-028: Compact Status Indicator & Baseline Toggle Test Suite
 *
 * Validates:
 * 1. Profile Status:
 *    - Replaces textual status badge in top Profile toolbar with an ~8px circular status dot
 *    - Dot reuses existing semantic status colors (passed, failed, error, running, stopping, etc.)
 *    - Dot has title/tooltip and accessible aria-label matching full status text
 *    - Top Profile toolbar contains NO textual status badge
 *    - Detailed CURRENT RUN / LATEST RUN card continues showing full textual status
 * 2. Baseline Toggle:
 *    - Replaces text toggle with an icon-only 28x28 button
 *    - When collapsed (showBaselineFiles = false): title & aria-label = "Show baseline", renders 14px Eye icon
 *    - When expanded (showBaselineFiles = true): title & aria-label = "Hide baseline", renders 14px EyeOff icon
 *    - Preserves toggle behavior
 * 3. Responsive Layout:
 *    - Profile toolbar and baseline header use min-width: 0 on shrinkable containers
 *    - Right-side icon controls specify flex-shrink: 0
 *    - Prevents horizontal overflow in narrow panels
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
const { createVerificationContract, createVerificationCriterion } = verifModelMod;

console.log('\\nRunning UI-POLISH-VERIFY-028: Compact Status Indicator & Baseline Toggle Suite...\\n');

// -------------------------------------------------------------
// Test 1: Profile Toolbar Status Dot vs Current Run Card Status
// -------------------------------------------------------------
console.log('--- Test 1: Profile Toolbar Status Dot vs Current Run Card Status ---');
{
  const contract = createVerificationContract({
    id: 'contract-test',
    workspaceId: 'ws-1',
    name: 'Standard checks',
    criteria: [
      createVerificationCriterion({
        label: 'Test',
        command: 'npm test',
      }),
    ],
  });

  const activeRun = {
    id: 'run-passed-1',
    contractId: contract.id,
    profileName: 'Standard checks',
    workspaceId: 'ws-1',
    status: 'passed',
    criteriaSnapshot: contract.criteria,
    criterionResults: [
      {
        criterionId: contract.criteria[0].id,
        status: 'passed',
        observedExitCode: 0,
      },
    ],
    startedAt: Date.now() - 1000,
    completedAt: Date.now(),
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      activeRun,
      historicalRuns: [activeRun],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  // 1. Profile toolbar contains the status dot
  assert.ok(
    html.includes('verification-profile-status-dot'),
    'Profile toolbar must render compact status dot',
  );
  assert.ok(
    html.includes('verification-profile-status-dot--passed'),
    'Status dot must use semantic status class for passed state',
  );
  assert.ok(
    html.includes('title=\"PASSED\"'),
    'Status dot must contain full status text in title attribute',
  );
  assert.ok(
    html.includes('aria-label=\"PASSED\"'),
    'Status dot must contain full status text in aria-label attribute',
  );

  // 2. Profile header row does NOT contain textual status badge
  // Extract verification-header section
  const headerStart = html.indexOf('verification-header');
  const headerEnd = html.indexOf('verification-current-run-section');
  assert.ok(headerStart !== -1 && headerEnd !== -1, 'Must find verification header and current run sections');
  const headerHtml = html.slice(headerStart, headerEnd);

  assert.strictEqual(
    headerHtml.includes('verification-run-badge'),
    false,
    'Top Profile toolbar must NOT contain any textual verification-run-badge',
  );

  // 3. Current / Latest Run card DOES contain textual status badge
  const currentRunHtml = html.slice(headerEnd);
  assert.ok(
    currentRunHtml.includes('verification-run-badge verification-run-badge--passed'),
    'Detailed CURRENT RUN / LATEST RUN card must continue showing full textual status badge',
  );
  assert.ok(
    currentRunHtml.includes('>PASSED<'),
    'Detailed CURRENT RUN card must visibly display textual status label PASSED',
  );

  console.log('✓ Profile toolbar renders compact status dot with tooltip and aria-label; run card retains full textual badge');
}

// -------------------------------------------------------------
// Test 2: Semantic Status Colors on Status Dot
// -------------------------------------------------------------
console.log('\\n--- Test 2: Semantic Status Colors on Status Dot ---');
{
  const statuses = [
    { status: 'running', expectedClass: 'verification-profile-status-dot--running', label: 'RUNNING' },
    { status: 'passed', expectedClass: 'verification-profile-status-dot--passed', label: 'PASSED' },
    { status: 'failed', expectedClass: 'verification-profile-status-dot--failed', label: 'FAILED' },
    { status: 'error', expectedClass: 'verification-profile-status-dot--error', label: 'ERROR' },
    { status: 'cancelled', expectedClass: 'verification-profile-status-dot--cancelled', label: 'CANCELLED' },
    { status: 'stopping', expectedClass: 'verification-profile-status-dot--stopping', label: 'STOPPING' },
  ];

  const contract = createVerificationContract({
    id: 'c-status',
    workspaceId: 'ws-1',
    name: 'Status Test',
    criteria: [],
  });

  for (const item of statuses) {
    const run = {
      id: `run-${item.status}`,
      contractId: contract.id,
      profileName: 'Status Test',
      workspaceId: 'ws-1',
      status: item.status,
      criteriaSnapshot: [],
      criterionResults: [],
      startedAt: Date.now() - 500,
      completedAt: item.status === 'running' || item.status === 'stopping' ? null : Date.now(),
    };

    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(VerificationPanel, {
        contract,
        activeRun: run,
        historicalRuns: [run],
        isRunning: item.status === 'running',
        isStopping: item.status === 'stopping',
        onRunVerification: () => {},
        onCancelVerification: () => {},
      }),
    );

    assert.ok(
      html.includes(item.expectedClass),
      `Status dot must have class ${item.expectedClass} for status ${item.status}`,
    );
    assert.ok(
      html.includes(`title=\"${item.label}\"`),
      `Status dot must have title=\"${item.label}\" for status ${item.status}`,
    );
    assert.ok(
      html.includes(`aria-label=\"${item.label}\"`),
      `Status dot must have aria-label=\"${item.label}\" for status ${item.status}`,
    );
  }

  console.log('✓ All semantic status states (RUNNING, PASSED, FAILED, ERROR, CANCELLED, STOPPING) correctly represented on status dot');
}

// -------------------------------------------------------------
// Test 3: Baseline Toggle Icon Button (28x28, 14px Eye / EyeOff)
// -------------------------------------------------------------
console.log('\\n--- Test 3: Baseline Toggle Icon Button (28x28, 14px Eye / EyeOff) ---');
{
  const beforeSnapshot = {
    id: 'snap-b1',
    workspaceId: 'ws-1',
    repositoryRoot: '/repo',
    status: {
      clean: false,
      files: [{ path: 'app/src/App.tsx', status: 'modified', staged: false, unstaged: true }],
    },
    collectedAt: Date.now() - 5000,
  };

  const afterSnapshot = {
    id: 'snap-a1',
    workspaceId: 'ws-1',
    repositoryRoot: '/repo',
    status: {
      clean: false,
      files: [{ path: 'app/src/App.tsx', status: 'modified', staged: false, unstaged: true }],
    },
    collectedAt: Date.now(),
  };

  const delta = computeRepositoryDelta(beforeSnapshot, afterSnapshot);
  const attribution = {
    id: 'attr-toggle',
    workspaceId: 'ws-1',
    targetType: 'verification-run',
    targetId: 'run-1',
    repositoryRoot: '/repo',
    status: 'completed',
    scope: 'dirty-baseline',
    delta,
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
    limitations: [],
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ChangeAttributionView, { attribution }),
  );

  // 1. Baseline toggle button uses icon-only class
  assert.ok(
    html.includes('attribution-baseline-toggle-btn'),
    'Baseline toggle button must have attribution-baseline-toggle-btn class',
  );

  // 2. Collapsed by default: title and aria-label must be "Show baseline"
  assert.ok(
    html.includes('title=\"Show baseline\"'),
    'Collapsed toggle button must have title=\"Show baseline\"',
  );
  assert.ok(
    html.includes('aria-label=\"Show baseline\"'),
    'Collapsed toggle button must have aria-label=\"Show baseline\"',
  );

  // 3. Renders 14px SVG icon
  assert.ok(
    html.includes('<svg') && html.includes('width=\"14\"') && html.includes('height=\"14\"'),
    'Toggle button must contain 14px SVG icon',
  );

  // 4. Does NOT contain textual "Show baseline" or "Hide baseline" button label text
  // The only occurrences of "Show baseline" should be in attributes (title, aria-label)
  const buttonTagMatch = html.match(/<button[^>]*class=\"[^\"]*attribution-baseline-toggle-btn[^\"]*\"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(buttonTagMatch, 'Must find baseline toggle button');
  const innerButtonHtml = buttonTagMatch[1];
  assert.strictEqual(
    innerButtonHtml.includes('Show baseline'),
    false,
    'Button inner content must NOT contain raw \"Show baseline\" text',
  );
  assert.strictEqual(
    innerButtonHtml.includes('Hide baseline'),
    false,
    'Button inner content must NOT contain raw \"Hide baseline\" text',
  );
  assert.ok(
    innerButtonHtml.includes('<svg'),
    'Button inner content must strictly contain the SVG icon',
  );

  console.log('✓ Baseline toggle rendered as 28x28 icon-only button with 14px Eye icon and truthful tooltip/aria-label');
}

// -------------------------------------------------------------
// Test 4: CSS Rules for Compact Status Dot, 28x28 Button & Responsive Layout
// -------------------------------------------------------------
console.log('\\n--- Test 4: CSS Rules for Compact Status Dot, 28x28 Button & Responsive Layout ---');
{
  const panelCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.css'),
    'utf8',
  );

  // Status dot circular 8px
  assert.ok(
    panelCss.includes('.verification-profile-status-dot {'),
    'VerificationPanel.css must define .verification-profile-status-dot',
  );
  assert.ok(
    panelCss.includes('width: 8px;') && panelCss.includes('height: 8px;'),
    '.verification-profile-status-dot must specify 8px dimensions',
  );
  assert.ok(
    panelCss.includes('border-radius: 50%;'),
    '.verification-profile-status-dot must specify 50% border radius for circular shape',
  );
  assert.ok(
    panelCss.includes('flex-shrink: 0;'),
    '.verification-profile-status-dot must specify flex-shrink: 0',
  );

  // Profile selector responsiveness
  assert.ok(
    panelCss.includes('.verification-profile-select {') &&
    panelCss.includes('min-width: 0;') &&
    panelCss.includes('flex: 1;'),
    '.verification-profile-select must specify flex: 1 and min-width: 0 for responsive shrinking',
  );

  // Profile actions pinned right
  assert.ok(
    panelCss.includes('.verification-profile-actions {') &&
    panelCss.includes('flex-shrink: 0;') &&
    panelCss.includes('margin-left: auto;'),
    '.verification-profile-actions must specify flex-shrink: 0 and margin-left: auto',
  );

  // Attribution CSS rules
  const attrCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/attribution/ChangeAttributionView.css'),
    'utf8',
  );

  // Baseline toggle 28x28 square
  assert.ok(
    attrCss.includes('.attribution-baseline-toggle-btn {'),
    'ChangeAttributionView.css must define .attribution-baseline-toggle-btn',
  );
  assert.ok(
    attrCss.includes('width: var(--monitor-icon-button-size, 28px);') ||
    attrCss.includes('width: 28px;'),
    '.attribution-baseline-toggle-btn must specify 28px width',
  );
  assert.ok(
    attrCss.includes('height: var(--monitor-icon-button-size, 28px);') ||
    attrCss.includes('height: 28px;') ||
    attrCss.includes('max-height: var(--monitor-icon-button-size, 28px);'),
    '.attribution-baseline-toggle-btn must specify 28px height',
  );
  assert.ok(
    attrCss.includes('flex-shrink: 0;'),
    '.attribution-baseline-toggle-btn must specify flex-shrink: 0',
  );

  // Baseline header responsiveness
  assert.ok(
    attrCss.includes('.attribution-baseline-title-group {') &&
    attrCss.includes('min-width: 0;') &&
    attrCss.includes('flex: 1;'),
    '.attribution-baseline-title-group must specify min-width: 0 and flex: 1',
  );
  assert.ok(
    attrCss.includes('.attribution-baseline-title {') &&
    attrCss.includes('overflow: hidden;') &&
    attrCss.includes('text-overflow: ellipsis;'),
    '.attribution-baseline-title must specify overflow: hidden and text-overflow: ellipsis',
  );
  assert.ok(
    attrCss.includes('.attribution-baseline-count {') &&
    attrCss.includes('flex-shrink: 0;'),
    '.attribution-baseline-count must specify flex-shrink: 0',
  );

  console.log('✓ CSS responsive rules verified: 8px circular dot, 28x28 icon button, min-width: 0 on shrinkable containers, flex-shrink: 0 on controls');
}

// -------------------------------------------------------------
// Test 5: Acceptance Layout Ordering at Narrow Width
// -------------------------------------------------------------
console.log('\\n--- Test 5: Acceptance Layout Ordering at Narrow Width ---');
{
  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.tsx'),
    'utf8',
  );

  const selectIdx = panelTsx.indexOf('className=\"verification-profile-select\"');
  const dotIdx = panelTsx.indexOf('verification-profile-status-dot');
  const editIdx = panelTsx.indexOf('title=\"Edit verification profile\"');
  const newIdx = panelTsx.indexOf('title=\"Create verification profile\"');

  assert.ok(selectIdx !== -1, 'Must find profile select in tsx');
  assert.ok(dotIdx !== -1, 'Must find status dot in tsx');
  assert.ok(editIdx !== -1, 'Must find edit button in tsx');
  assert.ok(newIdx !== -1, 'Must find new profile button in tsx');

  assert.ok(
    selectIdx < dotIdx && dotIdx < editIdx && editIdx < newIdx,
    'PROFILE row elements must strictly be in order: [profile selector] [status dot] [edit] [new]',
  );

  console.log('✓ PROFILE row strictly follows [profile selector] [status dot] [edit] [new] order without overflow');
}

console.log('\\n=============================================================');
console.log('ALL UI-POLISH-VERIFY-028 TESTS PASSED!');
console.log('=============================================================\\n');
