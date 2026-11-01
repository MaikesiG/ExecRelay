/**
 * VERIFY-ACTION-AVAILABILITY-001 — Verify run controls follow whether the target terminal can
 * receive a dispatch.
 *
 * Observed on Windows 11 ARM64: terminal initialization failed (shown as
 * "Failed to initialize session: [object Object]"), yet per-check Run, Run Selected and
 * Continue stayed clickable and each click created an ERROR run and a toast.
 *
 * A. isVerificationTargetDispatchable: running session on the active pane of the active tab only
 * B. Inactive target: per-check Run, Run Selected and Continue are disabled, with visible text;
 *    selection is kept
 * C. Active target: the controls are enabled exactly as before (selection still gates Run Selected)
 * D. App wires every run control to the one helper; run creation and the toast stay inside the
 *    gated handlers; the execution-layer inactive-session guard is still there
 * E. Terminal init rejections render as readable text, never `[object Object]`
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const React = require('../app/node_modules/react');
const ReactDOMServer = require('../app/node_modules/react-dom/server');
const appSrc = path.resolve(__dirname, '../app/src');

function transpile(filePath, customRequire = () => ({})) {
  const js = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'React', js)(mod, mod.exports, customRequire, React);
  return mod.exports;
}

const src = (rel) => path.join(appSrc, rel);
const formatMod = transpile(src('features/transcript/transcriptFormat.ts'));
const execMod = transpile(src('features/execution/executionModel.ts'), (r) => (r.includes('transcriptFormat') ? formatMod : {}));
const modelMod = transpile(src('features/verification/verificationModel.ts'), (r) => (r.includes('execution') ? execMod : {}));
const stateMod = transpile(src('features/verification/verificationState.ts'), (r) => (r.includes('verificationModel') ? modelMod : {}));
const panelMod = transpile(src('features/verification/VerificationPanel.tsx'), (r) => {
  if (r.includes('verificationModel')) return modelMod;
  if (r.includes('transcriptFormat')) return formatMod;
  if (r.includes('execution')) return execMod;
  if (r.includes('ChangeAttributionView')) return { ChangeAttributionView: () => null };
  if (/VerificationCheckModal|VerificationProfileModal|NewProfileModal/.test(r)) {
    return { VerificationCheckModal: () => null, VerificationProfileModal: () => null, NewProfileModal: () => null };
  }
  if (r === 'react') return React;
  return {};
});

const { VerificationPanel } = panelMod;
const { isVerificationTargetDispatchable } = stateMod;
const { createVerificationContract, createVerificationCriterion } = modelMod;
const HINT = 'Start or activate a terminal session to run verification.';

// A. Canonical helper
{
  const ws = (session, { tabId = 't1', activeTabId = 't1', paneId = 'p1', activePaneId = 'p1' } = {}) => ({
    activeTerminalTabId: activeTabId,
    terminalTabs: [{ id: tabId, activePaneId, panes: [{ id: paneId, session }] }],
  });
  assert.equal(isVerificationTargetDispatchable(ws({ sessionId: 's1', status: 'running', sessionInfo: null })), true);
  for (const status of ['starting', 'exited', 'error']) {
    assert.equal(isVerificationTargetDispatchable(ws({ sessionId: 's1', status, sessionInfo: null })), false, status);
  }
  // Windows init failure: no session id, status error
  assert.equal(isVerificationTargetDispatchable(ws({ sessionId: null, status: 'error', sessionInfo: null })), false);
  assert.equal(isVerificationTargetDispatchable(ws({ sessionId: null, status: 'running', sessionInfo: null })), false);
  // A running session elsewhere does not make the target dispatchable
  assert.equal(isVerificationTargetDispatchable(ws({ sessionId: 's1', status: 'running', sessionInfo: null }, { activeTabId: 'other' })), false);
  assert.equal(isVerificationTargetDispatchable(ws({ sessionId: 's1', status: 'running', sessionInfo: null }, { activePaneId: 'other' })), false);
  assert.equal(isVerificationTargetDispatchable(null), false);
  assert.equal(isVerificationTargetDispatchable(undefined), false);
}
console.log('✓ A. Dispatchable only with a running session on the active pane of the active tab');

const contract = createVerificationContract({
  id: 'c1',
  workspaceId: 'ws',
  name: 'Profile',
  criteria: [createVerificationCriterion({ id: 'ls', label: 'List', command: 'ls', workingDirectory: 'apps/web' })],
});
const unfinishedRun = {
  id: 'run-old',
  contractId: contract.id,
  workspaceId: 'ws',
  status: 'cancelled',
  criteriaSnapshot: contract.criteria,
  criterionResults: [{ criterionId: 'ls', status: 'skipped' }],
  startedAt: 1,
  completedAt: 2,
};

function render(props) {
  const calls = [];
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(VerificationPanel, {
      contract,
      activeRun: null,
      historicalRuns: [],
      isRunning: false,
      selectedCriterionIds: new Set(['ls']),
      onRunVerification: (ids) => calls.push(['run', ids]),
      onCancelVerification: () => {},
      onContinueUnfinished: (run) => calls.push(['continue', run.id]),
      ...props,
    }),
  );
  return { html, calls };
}

function button(html, marker) {
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `button ${marker} rendered`);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', at) + 1);
}
const isDisabled = (tag) => /\sdisabled=""/.test(tag);
const RUN_ONE = 'aria-label="Run List"';
const RUN_SELECTED = 'aria-label="Run selected verification checks"';
const CONTINUE = 'class="verification-continue-btn"';

// B. Inactive target
{
  const { html, calls } = render({ isTargetDispatchable: false, historicalRuns: [unfinishedRun] });
  const runOne = button(html, RUN_ONE);
  const runSelected = button(html, RUN_SELECTED);
  const cont = button(html, CONTINUE);
  assert.ok(isDisabled(runOne), 'per-check Run disabled');
  assert.ok(isDisabled(runSelected), 'Run Selected disabled');
  assert.ok(isDisabled(cont), 'Continue disabled');
  for (const tag of [runOne, runSelected, cont]) assert.ok(tag.includes(`title="${HINT}"`), `tooltip on ${tag}`);
  assert.ok(runSelected.includes('aria-describedby="verification-target-inactive-hint"'));
  assert.ok(html.includes(`data-testid="verification-target-inactive-hint">${HINT}</div>`), 'visible explanation');
  assert.ok(html.includes('Run Selected (1)'), 'selection kept');
  assert.equal(calls.length, 0, 'rendering dispatches nothing');
}
console.log('✓ B. Inactive target: Run, Run Selected and Continue disabled with visible explanation; selection kept');

// C. Active target (and the prop's default) keeps the existing behavior
for (const props of [{ isTargetDispatchable: true }, {}]) {
  const { html } = render({ ...props, historicalRuns: [unfinishedRun] });
  assert.ok(!isDisabled(button(html, RUN_ONE)), 'per-check Run enabled');
  assert.ok(!isDisabled(button(html, RUN_SELECTED)), 'Run Selected enabled with a selection');
  assert.ok(!isDisabled(button(html, CONTINUE)), 'Continue enabled');
  assert.ok(button(html, RUN_ONE).includes('title="Run List only"'));
  assert.ok(!html.includes(HINT), 'no explanation when dispatchable');

  const empty = render({ ...props, selectedCriterionIds: new Set() });
  assert.ok(isDisabled(button(empty.html, RUN_SELECTED)), 'Run Selected still needs a selection');
  assert.ok(!isDisabled(button(empty.html, RUN_ONE)), 'per-check Run does not need a selection');
}
{
  // Running: controls follow the existing lock, and the inactive hint is not shown
  const { html } = render({ isTargetDispatchable: false, isRunning: true });
  assert.ok(!html.includes('verification-target-inactive-hint'), 'no inactive hint while a run is locked');
}
console.log('✓ C. Active target: controls enabled as before; selection still gates Run Selected');

// D. One flag for all controls; run creation stays behind it; execution guard kept
{
  const panel = fs.readFileSync(src('features/verification/VerificationPanel.tsx'), 'utf8');
  assert.equal((panel.match(/onClick=\{\(\) => onRunVerification\(/g) ?? []).length, 2, 'two Run entry points');
  assert.equal((panel.match(/onClick=\{\(\) => onContinueUnfinished\(/g) ?? []).length, 1, 'one Continue entry point');
  assert.ok(panel.includes('disabled={isLocked || !isTargetDispatchable}'));
  assert.ok(panel.includes('disabled={effectiveSelectedCriterionIds.size === 0 || !isTargetDispatchable}'));
  assert.ok(panel.includes('disabled={!isTargetDispatchable}'));

  const app = fs.readFileSync(src('App.tsx'), 'utf8');
  assert.ok(app.includes('isVerificationTargetDispatchable: isVerificationTargetDispatchable(activeWorkspace),'));
  assert.equal((app.match(/isVerificationTargetDispatchable\(/g) ?? []).length, 1, 'one derivation');
  for (const file of ['features/workspace/TerminalPaneLayout.tsx', 'features/workspace/PanelLayoutNodeView.tsx']) {
    assert.ok(fs.readFileSync(src(file), 'utf8').includes('isVerificationTargetDispatchable={transcriptProps.isVerificationTargetDispatchable}'), file);
  }
  assert.ok(fs.readFileSync(src('features/transcript/TranscriptCapturePanel.tsx'), 'utf8').includes('isTargetDispatchable={isVerificationTargetDispatchable}'));

  // Run History entries and the "Starting verification" toast are only created in the two handlers
  // the gated buttons call.
  const handler = (name) => {
    const start = app.indexOf(`const ${name} = useCallback(`);
    assert.ok(start >= 0, name);
    return app.slice(start, app.indexOf('\n  const ', start + 1));
  };
  const run = handler('handleRunVerification');
  const cont = handler('handleContinueUnfinishedVerification');
  assert.ok(run.includes('appendVerificationRunToWorkspace') && run.includes('Starting verification'));
  assert.equal((app.match(/Starting verification/g) ?? []).length, 1, 'toast only in handleRunVerification');
  assert.equal((app.match(/appendVerificationRunToWorkspace\(/g) ?? []).length, (run + cont).match(/appendVerificationRunToWorkspace\(/g).length, 'runs only created by the gated handlers');
  assert.ok(app.includes('onRunVerification: (criterionIds?: string[]) => handleRunVerification(activeWorkspace?.id, criterionIds),'));
  assert.ok(app.includes('onContinueUnfinished: handleContinueUnfinishedVerification,'));

  // Defense in depth: the execution-layer guard is unchanged
  const exec = handler('executeVerificationCriterion');
  assert.ok(exec.includes("message: 'Target terminal session is not active'"));
}
console.log('✓ D. One shared flag gates every run control; run creation and toast stay behind it; execution guard kept');

// E. Terminal init error rendering
{
  if (typeof window === 'undefined') globalThis.window = globalThis;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  let createError = null;
  const mockApi = {
    createSession: async () => { throw createError; },
    closeSession: async () => {},
    close: async () => {},
    resize: async () => {},
    write: async () => {},
    onOutput: async () => () => {},
    onExit: async () => () => {},
    onError: async () => () => {},
  };
  const { Terminal } = require('../app/node_modules/@xterm/xterm/lib/xterm.js');
  class MockTerminal extends Terminal {
    constructor() { super({ rows: 10, cols: 60 }); }
    open() {}
  }
  const terminalTypesMod = transpile(src('features/terminal/types.ts'));
  const registryMod = transpile(src('features/terminal/terminalRuntimeRegistry.ts'), (r) => {
    if (r.includes('terminalApi')) return { terminalApi: mockApi };
    if (r.includes('types')) return terminalTypesMod;
    if (r.includes('shellIntegration')) return transpile(src('features/terminal/shellIntegration.ts'));
    if (r.includes('terminalAnsi')) return transpile(src('features/terminal/terminalAnsi.ts'));
    if (r === '@xterm/xterm') return { Terminal: MockTerminal };
    if (r === '@xterm/addon-fit') return { FitAddon: class { activate() {} fit() {} dispose() {} } };
    return {};
  });
  const { describeTerminalError, TerminalRuntimeRegistry } = registryMod;

  const cases = [
    [new Error('invalid working directory: \\\\VM-WIN11\\ExecRelayUNC\\repo'), 'invalid working directory: \\\\VM-WIN11\\ExecRelayUNC\\repo'],
    // Native TerminalError as serialized over Tauri IPC: #[serde(tag = "kind", content = "message")]
    [{ kind: 'invalidDirectory', message: '\\\\VM-WIN11\\ExecRelayUNC\\repo' }, 'invalid working directory: \\\\VM-WIN11\\ExecRelayUNC\\repo'],
    [{ kind: 'spawnFailed', message: 'shell not found' }, 'shell not found'],
    [{ kind: 'invalidDimensions', message: { cols: 0, rows: 0 } }, 'unknown error'],
    [{ kind: 'emptyPayload' }, 'unknown error'],
    ['plain string failure', 'plain string failure'],
    [undefined, 'unknown error'],
    [null, 'unknown error'],
    [42, 'unknown error'],
    [new Error(''), 'unknown error'],
    [{ stack: 'at secret (internal.js:1)', toString: () => '[object Object]' }, 'unknown error'],
  ];
  for (const [err, expected] of cases) {
    const text = describeTerminalError(err);
    assert.equal(text, expected, `describe ${String(err)}`);
    assert.ok(!text.includes('[object Object]'));
    assert.equal(describeTerminalError(err), text, 'stable');
  }

  // Through the real runtime init-failure path
  for (const [err, expected] of cases.slice(0, 3)) {
    createError = err;
    const runtime = new TerminalRuntimeRegistry().getOrCreate({ paneId: `p-${Math.random()}`, workspaceId: 'ws' });
    assert.equal(await runtime.initPromise, null);
    assert.equal(runtime.status, 'error');
    assert.equal(runtime.errorMessage, `Failed to initialize session: ${expected}`);
  }
}
console.log('✓ E. Terminal init rejections (Error, structured IPC error, unknown) render readable text, never [object Object]');

console.log('\nVERIFY-ACTION-AVAILABILITY-001 tests passed.');
