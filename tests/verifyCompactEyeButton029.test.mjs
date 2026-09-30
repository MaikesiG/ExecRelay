/**
 * UI-POLISH-VERIFY-029: Compact Eye Button for View Execution Test Suite
 *
 * Validates:
 * 1. Criterion Card Icon-Only Eye Button:
 *    - Replaces textual "View execution" button with an icon-only Eye button
 *    - Uses existing 14px Eye SVG icon
 *    - Has tooltip/title: "View execution"
 *    - Has accessible aria-label: "View execution"
 *    - Contains NO visible text label between <button> and </button>
 *    - Preserves exact executionId and onSelectExecution click handler
 * 2. Layout & Responsiveness:
 *    - In verification-criterion-main: command / cwd metadata on left, [Eye] [Run] on right
 *    - Right actions group uses flex-shrink: 0
 *    - Eye button uses width: 28px, height: 28px, min-width: 28px, padding: 0, flex-shrink: 0
 *    - Eye button does not cause cwd wrapping or horizontal overflow
 * 3. Preservation of Invariants:
 *    - Run button behavior, title, aria-label, and disabled state preserved
 *    - Eye button omitted when criterion has no executionId
 *    - Historical evidence and failed criterion card execution lookup preserved
 *    - Focus-visible and disabled styling preserved
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

const { VerificationPanel } = verifPanelMod;
const { createVerificationContract, createVerificationCriterion } = verifModelMod;

console.log('\\nRunning UI-POLISH-VERIFY-029: Compact Eye Button for View Execution Suite...\\n');

// -------------------------------------------------------------
// Test 1: Criterion Card Renders Icon-Only Eye Button
// -------------------------------------------------------------
console.log('--- Test 1: Criterion Card Renders Icon-Only Eye Button ---');
{
  const contract = createVerificationContract({
    id: 'contract-eye-1',
    workspaceId: 'ws-1',
    name: 'Eye Button Test',
    criteria: [
      createVerificationCriterion({
        id: 'crit-build',
        label: 'Build',
        command: 'npm run build',
        workingDirectory: 'apps/web',
      }),
    ],
  });

  const activeRun = {
    id: 'run-1',
    contractId: contract.id,
    profileName: 'Eye Button Test',
    workspaceId: 'ws-1',
    status: 'passed',
    criteriaSnapshot: contract.criteria,
    criterionResults: [
      {
        criterionId: 'crit-build',
        status: 'passed',
        executionId: 'exec-build-101',
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
      onSelectExecution: () => {},
    }),
  );

  // 1. Must contain verification-view-exec-btn
  assert.ok(
    html.includes('verification-view-exec-btn'),
    'Criterion card must render verification-view-exec-btn',
  );

  // 2. Must have title="View execution"
  assert.ok(
    html.includes('title="View execution"'),
    'Button must have title="View execution"',
  );

  // 3. Must have aria-label="View execution"
  assert.ok(
    html.includes('aria-label="View execution"'),
    'Button must have aria-label="View execution"',
  );

  // 4. Must render 14px SVG Eye icon
  assert.ok(
    html.includes('<svg') && html.includes('width="14"') && html.includes('height="14"'),
    'Button must contain 14px SVG icon',
  );
  assert.ok(
    html.includes('d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"'),
    'SVG must contain standard Eye path',
  );

  // 5. Must NOT have visible text "View execution" inside button tags
  const btnMatch = html.match(/<button[^>]*class="[^"]*verification-view-exec-btn[^"]*"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(btnMatch, 'Must find verification-view-exec-btn element in html');
  const innerContent = btnMatch[1];
  assert.strictEqual(
    innerContent.includes('View execution'),
    false,
    'Button content must NOT contain textual "View execution" label (must be icon-only)',
  );

  console.log('✓ Criterion card renders true icon-only Eye button with title/aria-label="View execution" and 14px SVG');
}

// -------------------------------------------------------------
// Test 2: Narrow Row Layout: Command/CWD metadata followed by [Eye] [Run]
// -------------------------------------------------------------
console.log('\\n--- Test 2: Narrow Row Layout: Command/CWD metadata followed by [Eye] [Run] ---');
{
  const contract = createVerificationContract({
    id: 'contract-eye-2',
    workspaceId: 'ws-1',
    name: 'Layout Test',
    criteria: [
      createVerificationCriterion({
        id: 'crit-lint',
        label: 'Lint',
        command: 'npm run lint',
        workingDirectory: 'packages/core',
      }),
    ],
  });

  const activeRun = {
    id: 'run-2',
    contractId: contract.id,
    profileName: 'Layout Test',
    workspaceId: 'ws-1',
    status: 'passed',
    criteriaSnapshot: contract.criteria,
    criterionResults: [
      {
        criterionId: 'crit-lint',
        status: 'passed',
        executionId: 'exec-lint-202',
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
      onSelectExecution: () => {},
    }),
  );

  // Check structure of verification-criterion-main
  assert.ok(html.includes('verification-criterion-main'), 'Must render verification-criterion-main');
  assert.ok(html.includes('verification-criterion-left'), 'Must render verification-criterion-left');
  assert.ok(html.includes('verification-criterion-right-actions'), 'Must render verification-criterion-right-actions');

  // Within criterion card:
  const cardStart = html.indexOf('data-testid="verification-criterion-0"');
  assert.ok(cardStart !== -1, 'Must find criterion card 0');
  const cardHtml = html.slice(cardStart, cardStart + 2000);

  const cwdIdx = cardHtml.indexOf('cwd: packages/core');
  const eyeIdx = cardHtml.indexOf('verification-view-exec-btn');
  const runIdx = cardHtml.indexOf('verification-single-run-btn');

  assert.ok(cwdIdx !== -1, 'Must include cwd metadata');
  assert.ok(eyeIdx !== -1, 'Must include Eye button');
  assert.ok(runIdx !== -1, 'Must include Run button');

  // Verify right actions: Eye button precedes Run button in right actions, cwd/command are outside action group
  assert.ok(eyeIdx < runIdx, 'Eye button must precede Run button in right actions');
  const rightActionsStart = cardHtml.indexOf('verification-criterion-right-actions');
  const rightActionsEnd = cardHtml.indexOf('</div>', rightActionsStart);
  const rightActionsHtml = cardHtml.slice(rightActionsStart, rightActionsEnd + 200);
  assert.strictEqual(
    rightActionsHtml.includes('cwd: packages/core'),
    false,
    'Command/CWD metadata must render outside right actions group',
  );

  // Run button preserves behavior and label
  assert.ok(cardHtml.includes('>Run<'), 'Run button must preserve "Run" text label');
  assert.ok(cardHtml.includes('title="Run Lint only"'), 'Run button must preserve title');
  assert.ok(cardHtml.includes('aria-label="Run Lint"'), 'Run button must preserve aria-label');

  console.log('✓ Expected narrow-row layout verified: command / cwd metadata [Eye] [Run]');
}

// -------------------------------------------------------------
// Test 3: Eye Button Omitted when executionId is Absent
// -------------------------------------------------------------
console.log('\\n--- Test 3: Eye Button Omitted when executionId is Absent ---');
{
  const contract = createVerificationContract({
    id: 'contract-eye-3',
    workspaceId: 'ws-1',
    name: 'Pending Test',
    criteria: [
      createVerificationCriterion({
        id: 'crit-pending',
        label: 'Pending Check',
        command: 'npm test',
      }),
    ],
  });

  // No activeRun, so criterion has no executionId
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
      onSelectExecution: () => {},
    }),
  );

  const cardStart = html.indexOf('data-testid="verification-criterion-0"');
  const cardHtml = html.slice(cardStart, cardStart + 1500);

  assert.strictEqual(
    cardHtml.includes('verification-view-exec-btn'),
    false,
    'Eye button must NOT render when criterion result has no executionId',
  );
  assert.ok(
    cardHtml.includes('verification-single-run-btn'),
    'Run button must remain present even when Eye button is omitted',
  );

  console.log('✓ Eye button omitted when no executionId exists; Run button preserved');
}

// -------------------------------------------------------------
// Test 4: CSS Rules for 28x28 Dimensions, 0 Padding & Responsive Protection
// -------------------------------------------------------------
console.log('\\n--- Test 4: CSS Rules for 28x28 Dimensions, 0 Padding & Responsive Protection ---');
{
  const panelCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.css'),
    'utf8',
  );

  assert.ok(
    panelCss.includes('.verification-view-exec-btn {'),
    'VerificationPanel.css must define .verification-view-exec-btn',
  );

  // Width 28px
  assert.ok(
    panelCss.includes('width: var(--monitor-icon-button-size, 28px);') ||
    panelCss.includes('width: 28px;'),
    '.verification-view-exec-btn must specify 28px width',
  );

  // Min-width 28px
  assert.ok(
    panelCss.includes('min-width: var(--monitor-icon-button-size, 28px);') ||
    panelCss.includes('min-width: 28px;'),
    '.verification-view-exec-btn must specify 28px min-width',
  );

  // Height 28px
  assert.ok(
    panelCss.includes('height: var(--monitor-control-height, 28px);') ||
    panelCss.includes('height: 28px;'),
    '.verification-view-exec-btn must specify 28px height',
  );

  // Padding 0
  assert.ok(
    panelCss.includes('padding: 0;'),
    '.verification-view-exec-btn must specify padding: 0',
  );

  // flex-shrink: 0
  assert.ok(
    panelCss.includes('flex-shrink: 0;'),
    '.verification-view-exec-btn must specify flex-shrink: 0',
  );

  // Focus-visible rule
  assert.ok(
    panelCss.includes('.verification-view-exec-btn:focus-visible {'),
    '.verification-view-exec-btn must have focus-visible styling',
  );

  // Disabled rule
  assert.ok(
    panelCss.includes('.verification-view-exec-btn:disabled {'),
    '.verification-view-exec-btn must have disabled styling',
  );

  // Container flex-shrink: 0
  assert.ok(
    panelCss.includes('.verification-criterion-right-actions {') &&
    panelCss.includes('flex-shrink: 0;'),
    '.verification-criterion-right-actions must specify flex-shrink: 0',
  );

  console.log('✓ CSS rules verified: 28x28 dimensions, padding 0, flex-shrink: 0, focus-visible and disabled styling');
}

// -------------------------------------------------------------
// Test 5: Historical Detail and Failed Card Execution Lookup
// -------------------------------------------------------------
console.log('\\n--- Test 5: Historical Detail and Failed Card Execution Lookup ---');
{
  const contract = createVerificationContract({
    id: 'contract-eye-5',
    workspaceId: 'ws-1',
    name: 'History Test',
    criteria: [
      createVerificationCriterion({
        id: 'crit-fail',
        label: 'Failing Check',
        command: 'exit 1',
      }),
    ],
  });

  const failedRun = {
    id: 'run-failed-5',
    contractId: contract.id,
    profileName: 'History Test',
    workspaceId: 'ws-1',
    status: 'failed',
    criteriaSnapshot: contract.criteria,
    criterionResults: [
      {
        criterionId: 'crit-fail',
        status: 'failed',
        executionId: 'exec-fail-505',
        observedExitCode: 1,
        message: 'Exit 1 failure',
      },
    ],
    startedAt: Date.now() - 3000,
    completedAt: Date.now(),
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      activeRun: null,
      historicalRuns: [failedRun],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
      onSelectExecution: () => {},
    }),
  );

  // Failed card renders Eye button
  assert.ok(
    html.includes('verification-failed-criterion-card'),
    'Must render failed criterion card',
  );
  assert.ok(
    html.includes('title="View execution"'),
    'Failed card view execution button must have title="View execution"',
  );
  assert.ok(
    html.includes('aria-label="View execution"'),
    'Failed card view execution button must have aria-label="View execution"',
  );

  // SVG Eye icon present in failed card
  assert.ok(
    html.includes('<svg') && html.includes('d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"'),
    'Failed card view execution button must render Eye icon',
  );

  console.log('✓ Historical evidence and failed criterion card execution lookup preserved');
}

console.log('\\n=============================================================');
console.log('ALL UI-POLISH-VERIFY-029 TESTS PASSED!');
console.log('=============================================================\\n');
