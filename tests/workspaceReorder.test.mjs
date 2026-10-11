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
assert.match(tabBarSource, /onReorderWorkspace\(draggedId, ws\.id, dropPlacement\)/);
assert.match(tabBarSource, /onRequestDeleteWorkspace\(ws\.id\)/);
assert.match(appSource, /workspacesRef\.current = next/);
assert.match(appSource, /activeWorkspaceId=\{activeWorkspaceId\}/);

console.log('UX-REORDER-001 tests passed.');
