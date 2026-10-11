import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const helperPath = path.resolve(
  __dirname,
  '../app/src/features/transcript/selectionReconciliation.ts',
);
const helperJs = ts.transpileModule(fs.readFileSync(helperPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const helperModule = { exports: {} };
new Function('module', 'exports', helperJs)(helperModule, helperModule.exports);
const {
  reconcileSelectedBlockIds,
  selectAllBlockIds,
  synchronizeBlockSelection,
  toggleSelectedBlockId,
} = helperModule.exports;

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

console.log('Running CAPTURE-UX-002R2 Select All consistency tests...');

const ids = [...'ABCDEFGH'];
const availableIds = new Set(ids);

assert.strictEqual(typeof selectAllBlockIds, 'function');
assert.strictEqual(typeof synchronizeBlockSelection, 'function');
assert.strictEqual(typeof toggleSelectedBlockId, 'function');

// Empty -> Select All uses the same production constructor as App.
const selectAllTransition = synchronizeBlockSelection(
  [
    { id: 'pane-a', selection: { selectedBlockIds: new Set(), updatedAt: 0 } },
    { id: 'pane-b', selection: { selectedBlockIds: new Set(['stale']), updatedAt: 0 } },
  ],
  selectAllBlockIds(ids),
  1,
);
const selectedAll = selectAllTransition.selectedBlockIds;
assert.deepStrictEqual([...selectedAll], ids);
assert.strictEqual(selectedAll.size, 8);
assert.ok(ids.every((id) => selectedAll.has(id)));
assert.ok(
  selectAllTransition.panes.every(
    (pane) =>
      pane.selection.updatedAt === 1 &&
      ids.every((id) => pane.selection.selectedBlockIds.has(id)),
  ),
);

// Partial -> Select All replaces the partial set without duplicates.
const partial = new Set(['A', 'C']);
const selectedFromPartial = synchronizeBlockSelection(
  [{ id: 'pane-a', selection: { selectedBlockIds: partial, updatedAt: 1 } }],
  selectAllBlockIds(ids),
  2,
).selectedBlockIds;
assert.deepStrictEqual([...selectedFromPartial], ids);
assert.strictEqual(selectedFromPartial.size, 8);

// Clear uses the same empty canonical set for workspace and mirrors.
const cleared = selectAllBlockIds([]);
assert.strictEqual(cleared.size, 0);

// Unchecking one after Select All removes it immediately and nothing else.
const withoutC = toggleSelectedBlockId(selectedAll, 'C', availableIds);
assert.deepStrictEqual([...withoutC], ['A', 'B', 'D', 'E', 'F', 'G', 'H']);
assert.strictEqual(withoutC.size, 7);

// Duplicate input is deduped; stale/unavailable toggles cannot enter selection.
assert.deepStrictEqual(
  [...selectAllBlockIds(['A', 'A', 'B', 'B'])],
  ['A', 'B'],
);
assert.deepStrictEqual(
  [...toggleSelectedBlockId(new Set(['A', 'ghost']), 'missing', availableIds)],
  ['A'],
);

// Select All is one-shot: a later block does not silently join the selection.
const oneShot = selectAllBlockIds(['A', 'B', 'C']);
const laterCanonicalIds = new Set(['A', 'B', 'C', 'D']);
assert.deepStrictEqual(
  [...reconcileSelectedBlockIds(oneShot, laterCanonicalIds)],
  ['A', 'B', 'C'],
);

// Deletion reconciles canonical and mirrored state back to zero.
const afterDeleteAvailable = new Set();
assert.strictEqual(
  reconcileSelectedBlockIds(selectedAll, afterDeleteAvailable).size,
  0,
);

// Bulk actions consume exactly the selected IDs from the rendered workspace set.
const blocks = ids.map((id, index) => ({
  id,
  terminalTabId: index < 4 ? 'tab-a' : 'tab-b',
  terminalPaneId: index < 4 ? 'pane-a' : 'pane-b',
}));
const selectedBlocks = blocks.filter((block) => selectedAll.has(block.id));
assert.deepStrictEqual(
  selectedBlocks.map((block) => block.id),
  ids,
);

// Production wiring: visible workspace blocks, workspace selection rendering,
// every pane mirror updated together, and no active-tab filter in bulk copy.
const selectAllStart = appSource.indexOf('const handleSelectAllVisible');
const selectAllEnd = appSource.indexOf('const handleClearSelection', selectAllStart);
const selectAllSource = appSource.slice(selectAllStart, selectAllEnd);
assert.ok(selectAllSource.includes('selectAllBlockIds'));
assert.ok(selectAllSource.includes('synchronizeBlockSelection'));
assert.ok(selectAllSource.includes('prev.capture.blocks'));
assert.doesNotMatch(selectAllSource, /terminalTabId === activeTabId/);

const copyStart = appSource.indexOf('const handleCopySelected');
const copyEnd = appSource.indexOf('const removeTranscriptBlocks', copyStart);
const copyTransition = appSource.slice(copyStart, copyEnd);
assert.ok(copyTransition.includes('ws.selection.selectedBlockIds.has(b.id)'));
assert.doesNotMatch(copyTransition, /b\.terminalTabId === activeTabId/);

const deleteStart = appSource.indexOf('const handleDeleteSelected');
const deleteEnd = appSource.indexOf('// Terminal I/O', deleteStart);
const deleteTransition = appSource.slice(deleteStart, deleteEnd);
assert.ok(
  deleteTransition.includes(
    'const selectedIds = new Set(ws.selection.selectedBlockIds)',
  ),
);
assert.ok(
  deleteTransition.includes(
    'removeTranscriptBlocks(workspaceId, selectedIds)',
  ),
);

const clearStart = appSource.indexOf('const handleClearSelection');
const clearEnd = appSource.indexOf('const handleCopyBlock', clearStart);
const clearTransition = appSource.slice(clearStart, clearEnd);
assert.ok(clearTransition.includes('selectAllBlockIds([])'));
assert.ok(clearTransition.includes('synchronizeBlockSelection'));

assert.doesNotMatch(appSource, /nextSelected\.add\(blockId\)/);

const propsStart = appSource.indexOf(
  'const transcriptProps: PanelLayoutTranscriptProps',
);
const propsEnd = appSource.indexOf('feedback: transcriptFeedback', propsStart);
const renderedSelection = appSource.slice(propsStart, propsEnd);
assert.ok(renderedSelection.includes('activeWorkspace?.selection.selectedBlockIds'));
assert.doesNotMatch(renderedSelection, /activeTerminalPane\?\.selection/);

assert.ok(panelSource.includes('const selectedCount = selectedBlockIds.size'));
assert.ok(panelSource.includes('isSelected={selectedBlockIds.has(block.id)}'));

console.log('CAPTURE-UX-002R2 Select All consistency tests passed.');
