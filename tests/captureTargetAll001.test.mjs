import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const helperPath = path.resolve(
  __dirname,
  '../app/src/features/transcript/captureTargetScope.ts',
);
const compiled = ts.transpileModule(fs.readFileSync(helperPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const helperModule = { exports: {} };
new Function('module', 'exports', 'require', compiled)(
  helperModule,
  helperModule.exports,
  () => ({}),
);
const {
  getCaptureTargetScope,
  normalizeCaptureTargetScope,
  resolveCaptureTargetPaneIds,
  toggleCaptureTargetPane,
} = helperModule.exports;

const pane = (id, terminalTabId = id[0]) => ({ id, terminalTabId });
const workspace = (ids, targetScope, id = 'workspace-A') => ({
  id,
  panes: ids.map((paneId) => pane(paneId)),
  capture: { targetScope },
});

console.log('Running CAPTURE-TARGET-ALL-001 tests...');

const targets = ['A', 'B', 'C', 'D'];

// Empty and partial explicit selections remain explicit and visually non-All.
assert.deepStrictEqual(
  normalizeCaptureTargetScope({ mode: 'explicit', paneIds: [] }, targets),
  { mode: 'explicit', paneIds: [] },
);
assert.deepStrictEqual(
  normalizeCaptureTargetScope(
    { mode: 'explicit', paneIds: ['A', 'B', 'C'] },
    targets,
  ),
  { mode: 'explicit', paneIds: ['A', 'B', 'C'] },
);

// Real bug: checking the final missing target atomically becomes semantic All.
const finalTargetScope = toggleCaptureTargetPane(
  { mode: 'explicit', paneIds: ['A', 'B', 'C'] },
  'D',
  targets,
);
assert.deepStrictEqual(finalTargetScope, { mode: 'all' });
const finalTargetWorkspace = workspace(targets, finalTargetScope);
assert.strictEqual(getCaptureTargetScope(finalTargetWorkspace).mode, 'all');
assert.deepStrictEqual(resolveCaptureTargetPaneIds(finalTargetWorkspace), targets);

// All -> deselect one preserves the other targets; reselect returns to All.
const withoutB = toggleCaptureTargetPane({ mode: 'all' }, 'B', targets);
assert.deepStrictEqual(withoutB, {
  mode: 'explicit',
  paneIds: ['A', 'C', 'D'],
});
const allAgain = toggleCaptureTargetPane(withoutB, 'B', targets);
assert.deepStrictEqual(allAgain, { mode: 'all' });

// Set equality is order-independent, prunes stale IDs, and is duplicate-safe.
assert.deepStrictEqual(
  normalizeCaptureTargetScope(
    { mode: 'explicit', paneIds: ['D', 'B', 'A', 'C'] },
    targets,
  ),
  { mode: 'all' },
);
assert.deepStrictEqual(
  normalizeCaptureTargetScope(
    { mode: 'explicit', paneIds: ['A', 'B', 'stale', 'ghost'] },
    targets,
  ),
  { mode: 'explicit', paneIds: ['A', 'B'] },
);
assert.deepStrictEqual(
  normalizeCaptureTargetScope(
    { mode: 'explicit', paneIds: ['A', 'B', 'C', 'D', 'stale'] },
    targets,
  ),
  { mode: 'all' },
);
assert.deepStrictEqual(
  normalizeCaptureTargetScope(
    { mode: 'explicit', paneIds: ['A', 'A', 'B', 'B'] },
    targets,
  ),
  { mode: 'explicit', paneIds: ['A', 'B'] },
);

// Split panes are compared by actual pane ID, not by visible tab count.
const splitTargets = ['A1', 'A2', 'B1'];
assert.deepStrictEqual(
  normalizeCaptureTargetScope(
    { mode: 'explicit', paneIds: ['B1', 'A2', 'A1'] },
    splitTargets,
  ),
  { mode: 'all' },
);
assert.deepStrictEqual(
  normalizeCaptureTargetScope(
    { mode: 'explicit', paneIds: ['A1', 'B1'] },
    splitTargets,
  ),
  { mode: 'explicit', paneIds: ['A1', 'B1'] },
);

// Dynamic All inherits new tabs and split panes; partial explicit scope does not.
assert.deepStrictEqual(
  resolveCaptureTargetPaneIds(workspace(['A', 'B', 'C', 'D', 'E'], allAgain)),
  ['A', 'B', 'C', 'D', 'E'],
);
assert.deepStrictEqual(
  resolveCaptureTargetPaneIds(workspace(['A1', 'A2', 'B1'], { mode: 'all' })),
  ['A1', 'A2', 'B1'],
);
assert.deepStrictEqual(
  resolveCaptureTargetPaneIds(
    workspace(
      ['A', 'B', 'C', 'D', 'E'],
      { mode: 'explicit', paneIds: ['A', 'B', 'C'] },
    ),
  ),
  ['A', 'B', 'C'],
);

// Scope resolution remains workspace-local.
assert.deepStrictEqual(
  resolveCaptureTargetPaneIds(workspace(['X1'], { mode: 'all' }, 'workspace-B')),
  ['X1'],
);

const appSource = fs.readFileSync(
  path.resolve(__dirname, '../app/src/App.tsx'),
  'utf8',
);
const panelSource = fs.readFileSync(
  path.resolve(
    __dirname,
    '../app/src/features/transcript/TranscriptCapturePanel.tsx',
  ),
  'utf8',
);
const workspaceSource = fs.readFileSync(
  path.resolve(
    __dirname,
    '../app/src/features/workspace/createDefaultWorkspace.ts',
  ),
  'utf8',
);

const toggleStart = appSource.indexOf(
  'const handleToggleSelectCapturePane = useCallback',
);
const toggleEnd = appSource.indexOf(
  'const handleSelectAllCapturePanes = useCallback',
  toggleStart,
);
const toggleSource = appSource.slice(toggleStart, toggleEnd);
assert.match(toggleSource, /toggleCaptureTargetPane\(/);
assert.match(toggleSource, /targetScope:\s*nextScope/);
assert.doesNotMatch(toggleSource, /handleStartCaptureGroup|handleStopCaptureGroup/);
assert.doesNotMatch(toggleSource, /getOrCreatePaneCaptureRuntime/);

assert.match(panelSource, /captureTargetMode === 'all'/);
assert.match(panelSource, /checked=\{isAllPanesSelected\}/);
assert.match(
  panelSource,
  /selectedCapturePaneIds\?\.includes\(pane\.id\) \?\? false/,
);
assert.match(
  workspaceSource,
  /getCaptureTargetScope\(ws\)\.mode === 'all'/,
);

console.log('CAPTURE-TARGET-ALL-001 tests passed.');
