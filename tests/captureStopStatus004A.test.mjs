/**
 * HARDENING-004A — "Stop Capture does nothing" after a terminal is created during Capture.
 *
 * Root cause (pre-existing): pane capture state is stored on workspace.panes (maintained by
 * Start/Pause/Resume/Stop) and copied into terminalTabs[].panes when a pane is created. The
 * Capture status read the nested copies, so a pane created mid-capture stayed "listening"
 * forever: Stop stopped every runtime, but the panel kept showing Capturing and a Stop button
 * that could never take effect. Real desktop reproduction on clean HEAD and on the worktree.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

const src = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/transcript/captureTargetScope.ts'),
  'utf8',
);
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const { resolveListeningCaptureTargetIds } = mod.exports;

const pane = (id, tabId, isListening) => ({
  id,
  terminalTabId: tabId,
  capture: { isListening, hasRetainedData: true, currentBatchId: 1 },
});

function workspace({ maintained, nested, targetScope }) {
  return {
    id: 'ws',
    capture: { isListening: false, blocks: [], targetScope },
    panes: maintained,
    terminalTabs: [
      { id: 'tab-1', panes: [nested[0]] },
      { id: 'tab-2', panes: [nested[1]] },
    ],
  };
}

console.log('Running HARDENING-004A capture stop status tests...');

// The exact observed state: Stop stopped both panes (workspace.panes), but the pane created
// during Capture still carries its creation-time "listening" copy inside tab-2.
{
  const ws = workspace({
    maintained: [pane('p1', 'tab-1', false), pane('p2', 'tab-2', false)],
    nested: [pane('p1', 'tab-1', false), pane('p2', 'tab-2', true)],
  });
  assert.deepStrictEqual(resolveListeningCaptureTargetIds(ws), [], 'stopped Capture is not listening');
}

// While capturing, the maintained state is authoritative for every target.
{
  const ws = workspace({
    maintained: [pane('p1', 'tab-1', true), pane('p2', 'tab-2', true)],
    nested: [pane('p1', 'tab-1', false), pane('p2', 'tab-2', true)],
  });
  assert.deepStrictEqual(resolveListeningCaptureTargetIds(ws), ['p1', 'p2']);
}

// Explicit target scope still applies: a listening pane outside the scope is not counted.
{
  const ws = workspace({
    maintained: [pane('p1', 'tab-1', true), pane('p2', 'tab-2', true)],
    nested: [pane('p1', 'tab-1', true), pane('p2', 'tab-2', true)],
    targetScope: { mode: 'explicit', paneIds: ['p2'] },
  });
  assert.deepStrictEqual(resolveListeningCaptureTargetIds(ws), ['p2']);
}

// The Capture panel status and listening count come from the maintained state.
{
  const app = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  assert.match(app, /const listeningCapturePaneCount = activeWorkspace\s*\?\s*resolveListeningCaptureTargetIds\(activeWorkspace\)\.length/);
  assert.match(app, /const aggregateCaptureStatus = listeningCapturePaneCount > 0/);
  assert.doesNotMatch(app, /activeCaptureTargetPanes\.some\(\s*\(pane\) => pane\.capture\.isListening/);
}

console.log('HARDENING-004A capture stop status tests passed.');
