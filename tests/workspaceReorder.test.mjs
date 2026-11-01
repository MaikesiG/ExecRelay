import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const sourcePath = path.resolve(
  __dirname,
  '../app/src/features/workspace/workspaceReorder.ts',
);
const source = fs.readFileSync(sourcePath, 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const reorderModule = { exports: {} };
new Function('module', 'exports', 'require', js)(
  reorderModule,
  reorderModule.exports,
  require,
);
const { reorderWorkspaces } = reorderModule.exports;

function workspace(id) {
  return {
    id,
    name: id,
    rootPath: `/projects/${id}`,
    terminalTabs: [{ id: `tab-${id}`, panes: [{ id: `pane-${id}` }] }],
    panes: [{ id: `pane-${id}`, terminalSessionId: `session-${id}` }],
    capture: { blocks: [{ id: `block-${id}`, workspaceId: id }] },
    verification: { runs: [{ id: `run-${id}`, workspaceId: id }] },
  };
}

const a = workspace('a');
const b = workspace('b');
const c = workspace('c');
const d = workspace('d');
const ids = (items) => items.map((item) => item.id);

console.log('Running UX-REORDER-001 tests...');

assert.deepStrictEqual(ids(reorderWorkspaces([a, b, c], 'a', 'c', 'after')), ['b', 'c', 'a']);
assert.deepStrictEqual(ids(reorderWorkspaces([a, b, c], 'c', 'a', 'before')), ['c', 'a', 'b']);
assert.deepStrictEqual(ids(reorderWorkspaces([a, b, c], 'b', 'a', 'before')), ['b', 'a', 'c']);
assert.deepStrictEqual(ids(reorderWorkspaces([a, b, c], 'b', 'c', 'after')), ['a', 'c', 'b']);
assert.deepStrictEqual(ids(reorderWorkspaces([a, b, c], 'b', 'c', 'before')), ['a', 'b', 'c']);

const original = [a, b, c];
assert.strictEqual(reorderWorkspaces(original, 'b', 'b', 'before'), original);
assert.strictEqual(reorderWorkspaces(original, 'missing', 'b', 'before'), original);
assert.strictEqual(reorderWorkspaces(original, 'a', 'missing', 'after'), original);

const activeWorkspaceId = 'b';
const reordered = reorderWorkspaces([a, b, c, d], 'd', 'a', 'after');
assert.deepStrictEqual(ids(reordered), ['a', 'd', 'b', 'c']);
assert.strictEqual(activeWorkspaceId, 'b');
for (const ws of [a, b, c, d]) {
  assert.strictEqual(reordered.find((candidate) => candidate.id === ws.id), ws);
}
assert.strictEqual(reordered.find((ws) => ws.id === 'b').panes[0].terminalSessionId, 'session-b');
assert.strictEqual(reordered.find((ws) => ws.id === 'b').terminalTabs[0].panes[0].id, 'pane-b');
assert.strictEqual(reordered.find((ws) => ws.id === 'b').capture.blocks[0].workspaceId, 'b');
assert.strictEqual(reordered.find((ws) => ws.id === 'b').verification.runs[0].workspaceId, 'b');

assert.deepStrictEqual(ids(reordered.filter((ws) => ws.id !== 'a')), ['d', 'b', 'c']);
assert.deepStrictEqual(ids([...reordered, workspace('e')]), ['a', 'd', 'b', 'c', 'e']);
const renamed = reordered.map((ws) =>
  ws.id === 'd' ? { ...ws, name: 'renamed-d' } : ws,
);
assert.deepStrictEqual(ids(renamed), ['a', 'd', 'b', 'c']);
assert.strictEqual(renamed.find((ws) => ws.id === 'd').name, 'renamed-d');

const tabBarSource = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabBar.tsx'),
  'utf8',
);
const appSource = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
assert.match(tabBarSource, /key=\{ws\.id\}/);
assert.doesNotMatch(tabBarSource, /key=\{index\}/);
// HARDENING-004: workspace tabs use the terminal-tab pointer reorder model. HTML5
// drag-and-drop never reaches the Tauri webview while native drag-drop handling is enabled.
assert.match(tabBarSource, /onReorderWorkspace\(draggedId, target\.tabId, target\.placement\)/);
assert.doesNotMatch(tabBarSource, /\bdraggable\b|onDragStart|onDragOver|onDrop=|dataTransfer/);
assert.match(tabBarSource, /resolveTabDropTarget\(/);
assert.match(tabBarSource, /TAB_DRAG_THRESHOLD_PX/);
assert.match(tabBarSource, /onPointerDown=\{\(e\) => handlePointerDown\(e, ws\)\}/);
assert.match(tabBarSource, /window\.addEventListener\('pointermove'/);
assert.match(tabBarSource, /window\.removeEventListener\('pointerup'/);
assert.match(tabBarSource, /data-workspace-id=\{ws\.id\}/);
assert.match(tabBarSource, /suppressClickRef\.current = true/, 'a completed drag does not also activate');
assert.match(
  tabBarSource,
  /className="workspace-tab-item-close[^"]*"\s+onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/,
  'pressing close never starts a drag',
);
assert.match(tabBarSource, /onRequestDeleteWorkspace\(ws\.id\)/);
assert.match(appSource, /workspacesRef\.current = next/);
assert.match(appSource, /activeWorkspaceId=\{activeWorkspaceId\}/);

// HARDENING-004 milestone sequence: identity and active workspace follow IDs, not indexes.
{
  const { findAdjacentId } = (() => {
    const src = fs.readFileSync(path.resolve(__dirname, '../app/src/features/workspace/shortcutNavigation.ts'), 'utf8');
    const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const m = { exports: {} };
    new Function('module', 'exports', 'require', out)(m, m.exports, () => ({}));
    return m.exports;
  })();
  let order = [a, b, c, d];
  const active = 'b';
  order = reorderWorkspaces(order, 'd', 'a', 'before');
  order = reorderWorkspaces(order, 'a', 'c', 'before');
  assert.deepStrictEqual(ids(order), ['d', 'b', 'a', 'c'], 'A B C D -> D B A C');
  order = reorderWorkspaces(order, 'b', 'd', 'before');
  order = reorderWorkspaces(order, 'a', 'c', 'after');
  assert.deepStrictEqual(ids(order), ['b', 'd', 'c', 'a'], 'D B A C -> B D C A');
  for (const original of [a, b, c, d]) {
    assert.strictEqual(order.find((ws) => ws.id === original.id), original, 'same workspace object, nothing recreated');
  }
  assert.strictEqual(findAdjacentId(ids(order), active, 1), 'd', 'Next follows visual order');
  assert.strictEqual(findAdjacentId(ids(order), active, -1), 'a', 'Previous follows visual order (wraps)');
  assert.deepStrictEqual(ids(order.filter((ws) => ws.id !== 'd')), ['b', 'c', 'a'], 'close after reorder keeps order');
}

console.log('UX-REORDER-001 tests passed.');
