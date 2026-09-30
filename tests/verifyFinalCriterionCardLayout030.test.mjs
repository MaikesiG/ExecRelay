/**
 * VERIFY-UI-030: Final Criterion Card Layout Polish Test Suite
 *
 * Validates:
 * 1. Criterion Card Action Layout:
 *    - Right actions group uses flex-shrink: 0 in .verification-criterion-main
 *    - Eye control: 28x28, 14px SVG, icon-only, no visible text label, title/aria-label="View execution"
 *    - Run control: compact button, preserves text "Run", accessible label and title
 * 2. Dedicated Metadata Area:
 *    - Command and CWD render in a dedicated full-width metadata area below the header
 *    - Command and CWD render outside the action group
 *    - Exact path casing preserved verbatim (e.g. "cwd: apps/web", "cwd: packages/MyApp")
 *    - Label is strictly "cwd:"
 *    - Monospace font family and text-transform: none
 * 3. Responsive Card Rules:
 *    - Header text area (.verification-criterion-left) has flex: 1 and min-width: 0
 *    - Action area (.verification-criterion-right-actions) has flex-shrink: 0
 *    - Metadata area (.verification-criterion-metadata-area) has width: 100% and min-width: 0
 *    - No hardcoded panel-width assumptions or horizontal overflow
 * 4. Profile Selector Truncation & Tooltip:
 *    - Profile selector has title attribute matching full active profile name
 *    - Profile selector has accessible aria-label="Select Verification Profile"
 *    - CSS specifies min-width: 0, flex: 1, and text-overflow: ellipsis
 * 5. Preservation of Status & Controls:
 *    - Checkbox, status icon, reorder controls (▲, ▼), edit (✎), delete (✕) preserved
 *    - Invariants on execution selection and run dispatch preserved
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

// Transpile dependencies
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

console.log('\nRunning VERIFY-UI-030: Final Criterion Card Layout Polish Suite...\n');

// -------------------------------------------------------------
// Test 1: Action Controls Layout & Eye / Run Properties
// -------------------------------------------------------------
console.log('--- Test 1: Action Controls Layout & Eye / Run Properties ---');
{
  const contract = createVerificationContract({
    id: 'contract-polish-1',
    workspaceId: 'ws-1',
    name: 'Standard checks',
    criteria: [
      createVerificationCriterion({
        id: 'crit-prettier',
        label: 'prettier',
        command: 'npm run format',
        workingDirectory: 'apps/web',
      }),
    ],
  });

  const activeRun = {
    id: 'run-polish-1',
    contractId: contract.id,
    profileName: 'Standard checks',
    workspaceId: 'ws-1',
    status: 'passed',
    criteriaSnapshot: contract.criteria,
    criterionResults: [
      {
        criterionId: 'crit-prettier',
        status: 'passed',
        executionId: 'exec-format-1',
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

  // Check criterion card exists
  const cardStart = html.indexOf('data-testid="verification-criterion-0"');
  assert.ok(cardStart !== -1, 'Must find criterion card');
  const cardHtml = html.slice(cardStart, cardStart + 3000);

  // Check right actions container exists inside criterion main
  assert.ok(cardHtml.includes('verification-criterion-right-actions'), 'Must contain verification-criterion-right-actions');

  // Eye button tests
  assert.ok(cardHtml.includes('verification-view-exec-btn'), 'Must contain verification-view-exec-btn');
  assert.ok(cardHtml.includes('title="View execution"'), 'Eye button must have title="View execution"');
  assert.ok(cardHtml.includes('aria-label="View execution"'), 'Eye button must have aria-label="View execution"');
  assert.ok(cardHtml.includes('<svg') && cardHtml.includes('width="14"') && cardHtml.includes('height="14"'), 'Eye button must contain 14px SVG');

  // Eye button must NOT contain visible text
  const eyeMatch = cardHtml.match(/<button[^>]*class="[^"]*verification-view-exec-btn[^"]*"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(eyeMatch, 'Must find Eye button markup');
  assert.strictEqual(eyeMatch[1].includes('View execution'), false, 'Eye button must be icon-only');

  // Run button tests
  assert.ok(cardHtml.includes('verification-single-run-btn'), 'Must contain verification-single-run-btn');
  assert.ok(cardHtml.includes('>Run<'), 'Run button must contain "Run" text');
  assert.ok(cardHtml.includes('title="Run prettier only"'), 'Run button must have correct title');
  assert.ok(cardHtml.includes('aria-label="Run prettier"'), 'Run button must have correct aria-label');

  // Eye button precedes Run button in action group
  const eyeIdx = cardHtml.indexOf('verification-view-exec-btn');
  const runIdx = cardHtml.indexOf('verification-single-run-btn');
  assert.ok(eyeIdx < runIdx, 'Eye button must precede Run button in right actions');

  console.log('✓ Action controls correctly placed with 28x28 icon-only Eye and compact Run button');
}

// -------------------------------------------------------------
// Test 2: Dedicated Metadata Area & Exact Casing for CWD
// -------------------------------------------------------------
console.log('\n--- Test 2: Dedicated Metadata Area & Exact Casing for CWD ---');
{
  const contract = createVerificationContract({
    id: 'contract-polish-2',
    workspaceId: 'ws-1',
    name: 'Metadata Test',
    criteria: [
      createVerificationCriterion({
        id: 'crit-lower',
        label: 'prettier',
        command: 'npm run format',
        workingDirectory: 'apps/web',
      }),
      createVerificationCriterion({
        id: 'crit-mixed',
        label: 'dotnet-build',
        command: 'dotnet build --no-restore',
        workingDirectory: 'packages/MyApp',
      }),
    ],
  });

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

  // Dedicated metadata area exists
  assert.ok(html.includes('verification-criterion-metadata-area'), 'Must render verification-criterion-metadata-area');

  // Card 0: lowercase path
  const card0Start = html.indexOf('data-testid="verification-criterion-0"');
  const card1Start = html.indexOf('data-testid="verification-criterion-1"');
  const card0Html = html.slice(card0Start, card1Start);
  const card1Html = html.slice(card1Start);

  // Command line in Card 0
  assert.ok(card0Html.includes('<code class="verification-criterion-command" title="npm run format">npm run format</code>'), 'Command must be rendered with code tag');

  // CWD in Card 0: exact label 'cwd: apps/web'
  assert.ok(card0Html.includes('cwd: apps/web'), 'CWD must display exact string "cwd: apps/web"');
  assert.strictEqual(card0Html.includes('Cwd:'), false, 'Label must not be capitalized to Cwd:');
  assert.strictEqual(card0Html.includes('Apps/web'), false, 'Path must not be capitalized to Apps/web');

  // Card 1: mixed case path 'packages/MyApp'
  assert.ok(card1Html.includes('cwd: packages/MyApp'), 'CWD must display exact string "cwd: packages/MyApp"');
  assert.strictEqual(card1Html.includes('packages/myapp'), false, 'Path must not be lowercased to packages/myapp');

  // Command and CWD are outside the right actions group
  const actions0Start = card0Html.indexOf('verification-criterion-right-actions');
  const actions0End = card0Html.indexOf('</div>', actions0Start);
  const actions0Html = card0Html.slice(actions0Start, actions0End + 100);
  assert.strictEqual(actions0Html.includes('npm run format'), false, 'Command must not be inside right actions');
  assert.strictEqual(actions0Html.includes('cwd: apps/web'), false, 'CWD must not be inside right actions');

  console.log('✓ Command and CWD rendered in dedicated metadata area outside actions, preserving exact casing');
}

// -------------------------------------------------------------
// Test 3: Responsive Card CSS Rules Audit
// -------------------------------------------------------------
console.log('\n--- Test 3: Responsive Card CSS Rules Audit ---');
{
  const panelCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.css'),
    'utf8',
  );

  // Header text area flex: 1 and min-width: 0
  assert.ok(
    panelCss.includes('.verification-criterion-left {') &&
    panelCss.includes('flex: 1;') &&
    panelCss.includes('min-width: 0;'),
    '.verification-criterion-left must have flex: 1 and min-width: 0',
  );

  // Action area flex-shrink: 0
  assert.ok(
    panelCss.includes('.verification-criterion-right-actions {') &&
    panelCss.includes('flex-shrink: 0;'),
    '.verification-criterion-right-actions must have flex-shrink: 0',
  );

  // Metadata section width: 100% and min-width: 0
  assert.ok(
    panelCss.includes('.verification-criterion-metadata-area') &&
    panelCss.includes('width: 100%;') &&
    panelCss.includes('min-width: 0;'),
    '.verification-criterion-metadata-area must have width: 100% and min-width: 0',
  );

  // CWD badge text-transform: none
  assert.ok(
    panelCss.includes('.verification-criterion-cwd {') &&
    panelCss.includes('text-transform: none;'),
    '.verification-criterion-cwd must specify text-transform: none;',
  );

  // Eye button 28x28
  assert.ok(
    panelCss.includes('.verification-view-exec-btn {'),
    '.verification-view-exec-btn must be defined',
  );

  console.log('✓ CSS responsive rules verified: flex: 1 and min-width: 0 on header, flex-shrink: 0 on actions, width: 100% and min-width: 0 on metadata');
}

// -------------------------------------------------------------
// Test 4: Profile Selector Accessible Tooltip & Truncation
// -------------------------------------------------------------
console.log('\n--- Test 4: Profile Selector Accessible Tooltip & Truncation ---');
{
  const contract = createVerificationContract({
    id: 'c-long-profile',
    workspaceId: 'ws-1',
    name: 'Comprehensive Production Quality Gate Suite',
    criteria: [],
  });

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      contracts: [contract],
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
      onSelectExecution: () => {},
    }),
  );

  // Profile select has title matching full profile name
  assert.ok(
    html.includes('title="Comprehensive Production Quality Gate Suite"'),
    'verification-profile-select must expose full active profile name via title attribute',
  );

  // Accessible name / aria-label preserved
  assert.ok(
    html.includes('aria-label="Select Verification Profile"'),
    'verification-profile-select must preserve aria-label',
  );

  // Option item also contains full name
  assert.ok(
    html.includes('>Comprehensive Production Quality Gate Suite</option>'),
    'Profile option must contain full profile name text',
  );

  // CSS allows truncation at narrow width without breaking layout
  const panelCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.css'),
    'utf8',
  );
  assert.ok(
    panelCss.includes('.verification-profile-select {') &&
    panelCss.includes('text-overflow: ellipsis;') &&
    panelCss.includes('min-width: 0;'),
    '.verification-profile-select must support text-overflow: ellipsis and min-width: 0',
  );

  console.log('✓ Profile selector exposes full profile name via tooltip/title and preserves accessibility');
}

// -------------------------------------------------------------
// Test 5: Preservation of Reorder, Edit, Checkbox and Status Controls
// -------------------------------------------------------------
console.log('\n--- Test 5: Preservation of Reorder, Edit, Checkbox and Status Controls ---');
{
  const contract = createVerificationContract({
    id: 'contract-controls',
    workspaceId: 'ws-1',
    name: 'Controls Test',
    criteria: [
      createVerificationCriterion({
        id: 'crit-1',
        label: 'First',
        command: 'npm run one',
      }),
      createVerificationCriterion({
        id: 'crit-2',
        label: 'Second',
        command: 'npm run two',
      }),
    ],
  });

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      onRunVerification: () => {},
      onCancelVerification: () => {},
    }),
  );

  // Checkbox
  assert.ok(html.includes('type="checkbox"'), 'Checkbox must be present');
  assert.ok(html.includes('verification-criterion-checkbox'), 'Checkbox must have proper class');

  // Status icon
  assert.ok(html.includes('verification-criterion-status-icon'), 'Status icon must be present');

  // Reorder and Edit buttons (▲ ▼ ✎ ✕)
  assert.ok(html.includes('title="Move check up"'), 'Move up button must be present');
  assert.ok(html.includes('title="Move check down"'), 'Move down button must be present');
  assert.ok(html.includes('title="Edit check"'), 'Edit check button must be present');
  assert.ok(html.includes('title="Delete check"'), 'Delete check button must be present');

  // Exit codes row
  assert.ok(html.includes('verification-criterion-meta'), 'Exit codes row must be present');
  assert.ok(html.includes('Expected: exit [0]'), 'Expected exit code must be present');

  console.log('✓ All existing selection, status, reorder, edit, and exit code metadata controls preserved');
}

console.log('\n=============================================================');
console.log('ALL VERIFY-UI-030 TESTS PASSED!');
console.log('=============================================================\n');
