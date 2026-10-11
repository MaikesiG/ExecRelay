import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

const targetScopePath = path.resolve(
  __dirname,
  '../app/src/features/transcript/captureTargetScope.ts',
);
const compiled = ts.transpileModule(fs.readFileSync(targetScopePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const targetScopeModule = { exports: {} };
new Function('module', 'exports', 'require', compiled)(
  targetScopeModule,
  targetScopeModule.exports,
  () => ({}),
);
const { getCaptureTargetScope, resolveCaptureTargetPaneIds } = targetScopeModule.exports;

const pane = (id, terminalTabId) => ({ id, terminalTabId });
const workspace = (panes, targetScope) => ({
  panes,
  terminalTabs: [...new Set(panes.map((item) => item.terminalTabId))].map((id) => ({ id })),
  capture: { targetScope, blocks: [{ id: 'history-A' }] },
});

console.log('Running CAPTURE-UX-002R dynamic ALL target tests...');

{
  const initial = workspace([pane('A1', 'A')]);
  assert.strictEqual(getCaptureTargetScope(initial).mode, 'all');
  assert.deepStrictEqual(resolveCaptureTargetPaneIds(initial), ['A1']);

  const addedTab = workspace([pane('A1', 'A'), pane('B1', 'B')]);
  assert.deepStrictEqual(resolveCaptureTargetPaneIds(addedTab), ['A1', 'B1']);
  assert.strictEqual(addedTab.terminalTabs.length, 2);
  assert.deepStrictEqual(addedTab.capture.blocks, [{ id: 'history-A' }]);

  const addedSplit = workspace([
    pane('A1', 'A'),
    pane('A2', 'A'),
    pane('B1', 'B'),
  ]);
  assert.deepStrictEqual(resolveCaptureTargetPaneIds(addedSplit), ['A1', 'A2', 'B1']);

  const closedSplit = workspace([pane('A1', 'A'), pane('B1', 'B')]);
  assert.deepStrictEqual(resolveCaptureTargetPaneIds(closedSplit), ['A1', 'B1']);

  const closedTab = workspace([pane('A1', 'A')]);
  assert.deepStrictEqual(resolveCaptureTargetPaneIds(closedTab), ['A1']);
}

{
  const explicit = workspace(
    [pane('A1', 'A'), pane('B1', 'B')],
    { mode: 'explicit', paneIds: ['A1'] },
  );
  assert.deepStrictEqual(resolveCaptureTargetPaneIds(explicit), ['A1']);

  const reordered = workspace([pane('B1', 'B'), pane('A1', 'A')]);
  assert.deepStrictEqual(
    new Set(resolveCaptureTargetPaneIds(reordered)),
    new Set(['A1', 'B1']),
  );

  const anotherWorkspace = workspace([pane('C1', 'C')]);
  assert.deepStrictEqual(resolveCaptureTargetPaneIds(anotherWorkspace), ['C1']);
  assert.strictEqual(resolveCaptureTargetPaneIds(anotherWorkspace).includes('A1'), false);
}

{
  const listeners = new Map([['A1', { identity: 'listener-A', captures: 0 }]]);
  const reconcile = (desiredIds) => {
    for (const id of [...listeners.keys()]) {
      if (!desiredIds.includes(id)) listeners.delete(id);
    }
    for (const id of desiredIds) {
      if (!listeners.has(id)) listeners.set(id, { identity: `listener-${id}`, captures: 0 });
    }
  };
  reconcile(['A1', 'B1']);
  assert.strictEqual(listeners.size, 2);
  assert.strictEqual(listeners.get('A1').identity, 'listener-A');
  reconcile(['A1', 'B1']);
  assert.strictEqual(listeners.size, 2);
  listeners.get('A1').captures += 1;
  listeners.get('B1').captures += 1;
  assert.strictEqual(listeners.get('A1').captures, 1);
  assert.strictEqual(listeners.get('B1').captures, 1);
  reconcile(['A1']);
  assert.strictEqual(listeners.has('B1'), false);
}

{
  const app = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  const panel = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );
  const layout = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/TerminalPaneLayout.tsx'),
    'utf8',
  );
  const css = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');

  assert.ok(app.includes('prepareDynamicCapturePane'));
  assert.ok(app.includes('runtime.status = existingRuntime.status'));
  assert.ok(app.includes('runtime.currentBatch = workspace.capture.currentBatch'));
  assert.ok(app.includes('resolveCaptureTargetPanes(ws)'));
  assert.ok(app.includes('selectedCapturePaneIds: activeCaptureTargetIds'));
  assert.strictEqual(app.includes('captureTerminalTabCount:'), false);
  assert.ok(layout.includes('blocks={transcriptProps.blocks}'));
  assert.ok(panel.includes("captureTargetMode === 'all'"));
  assert.match(panel, /className='capture-target-all-label'>\s*All\s*<\/span>/);
  assert.strictEqual(panel.includes('terminalTabCount'), false);
  assert.ok(panel.includes('listeningPaneCount ?? selectedPanesCount'));
  assert.match(css, /\.capture-session-card\s*\{[\s\S]*?padding:\s*5px 10px;[\s\S]*?gap:\s*1px;/);
  assert.match(css, /\.capture-session-metric-row\s*\{[\s\S]*?line-height:\s*1\.2;/);
}

console.log('CAPTURE-UX-002R dynamic ALL target tests passed.');
