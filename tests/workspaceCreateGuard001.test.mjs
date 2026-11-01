/**
 * WORKSPACE-CREATE-GUARD-001 Test Suite
 *
 * Real failure: Add Workspace ("+") awaits a native folder picker that runs off the main
 * thread; clicking "+" again while it was pending started another picker, and each one
 * that returned a folder created a workspace.
 *
 * Validates the transient "folder flow pending" guard, wired as App wires it:
 * 1. Rapid repeated clicks before the first flow finishes: one picker, one workspace.
 * 2. "+" (and the per-workspace Open Folder action) is disabled while pending, enabled after.
 * 3. A cancelled picker creates nothing and releases the guard.
 * 4. A failing flow releases the guard and still reports its error to the caller.
 * 5. A later, intentional creation works: the guard blocks concurrency, not future use.
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

function load(relPath, customRequire = () => ({})) {
  const src = fs.readFileSync(path.resolve(__dirname, '../app/src', relPath), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'React', js)(mod, mod.exports, customRequire, React);
  return mod.exports;
}

const { runExclusive } = load('features/workspace/workspaceCreationGuard.ts');

// The App wiring: one pending ref, a pending-state setter, and the folder flow (picker, then
// create). The picker's answer is controlled by the test.
const pendingRef = { current: false };
const pendingStates = [];
let pickerCalls = 0;
const created = [];
let answerPicker;
const handleOpenFolder = () =>
  runExclusive(pendingRef, (isPending) => pendingStates.push(isPending), async () => {
    pickerCalls += 1;
    const selected = await new Promise((resolve, reject) => {
      answerPicker = { resolve, reject };
    });
    if (!selected) return null;
    const workspace = { id: `ws-${created.length + 1}`, rootPath: selected };
    created.push(workspace);
    return workspace;
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// 1. Rapid repeated clicks
{
  const first = handleOpenFolder();
  const second = handleOpenFolder();
  const third = handleOpenFolder();
  assert.strictEqual(pickerCalls, 1, 'one picker for three clicks');
  assert.strictEqual(pendingRef.current, true);
  assert.strictEqual(await second, null, 'second click ignored');
  assert.strictEqual(await third, null, 'third click ignored');
  answerPicker.resolve('C:\\Users\\maike\\Documents\\My Test Folder');
  const workspace = await first;
  assert.strictEqual(created.length, 1, 'one workspace created');
  assert.strictEqual(workspace.rootPath, 'C:\\Users\\maike\\Documents\\My Test Folder');
  assert.strictEqual(pendingRef.current, false, 'released after success');
  assert.deepStrictEqual(pendingStates, [true, false]);
  console.log('✓ 1. Rapid repeated clicks open one picker and create one workspace');
}

// 2. Visual state on the real WorkspaceTabBar
{
  const tabBar = load('features/workspace/WorkspaceTabBar.tsx', (id) => {
    if (id === 'react') return React;
    if (id.includes('.css')) return {};
    if (id.includes('useTabStripScroll')) {
      return { useTabStripScroll: () => ({ containerRef: { current: null } }) };
    }
    if (id === './types') return load('features/workspace/types.ts');
    if (id === './workspaceReorder') return load('features/workspace/workspaceReorder.ts');
    return {};
  });
  const render = (isFolderFlowPending) =>
    ReactDOMServer.renderToStaticMarkup(
      React.createElement(tabBar.WorkspaceTabBar, {
        workspaces: [
          { id: 'ws-a', name: 'Bound', rootPath: 'C:\\a', capture: { isListening: false, currentBatch: null, blocks: [] }, terminalTabs: [], panes: [] },
          { id: 'ws-b', name: 'Unbound', rootPath: undefined, capture: { isListening: false, currentBatch: null, blocks: [] }, terminalTabs: [], panes: [] },
        ],
        activeWorkspaceId: 'ws-a',
        onSelectWorkspace: () => {},
        onCreateWorkspace: () => {},
        onOpenFolder: () => {},
        onRequestDeleteWorkspace: () => {},
        onRenameWorkspace: () => {},
        onReorderWorkspace: () => {},
        isFolderFlowPending,
      }),
    );
  const addButton = (html) => html.match(/<button[^>]*class="workspace-tab-bar-add"[^>]*>/)[0];
  const bindChip = (html) => html.match(/<span[^>]*class="workspace-tab-bind-folder-btn"[^>]*>/)[0];

  const pending = render(true);
  assert.match(addButton(pending), /disabled=""/, '"+" disabled while pending');
  assert.match(addButton(pending), /aria-busy="true"/);
  assert.match(bindChip(pending), /aria-disabled="true"/, 'Open Folder chip unavailable while pending');
  const idle = render(false);
  assert.doesNotMatch(addButton(idle), /disabled/, '"+" enabled when idle');
  assert.doesNotMatch(bindChip(idle), /aria-disabled/);
  console.log('✓ 2. "+" and Open Folder are disabled while pending and enabled after');
}

// 3. Cancelled picker
{
  const flow = handleOpenFolder();
  assert.strictEqual(pickerCalls, 2);
  answerPicker.resolve(null);
  assert.strictEqual(await flow, null);
  assert.strictEqual(created.length, 1, 'cancel creates no workspace');
  assert.strictEqual(pendingRef.current, false, 'released after cancel');
  console.log('✓ 3. A cancelled picker creates nothing and releases the guard');
}

// 4. Failure
{
  const flow = handleOpenFolder();
  assert.strictEqual(handleOpenFolder() instanceof Promise, true);
  assert.strictEqual(pickerCalls, 3, 'still one picker while the failing flow is pending');
  answerPicker.reject(new Error('dialog failed'));
  await assert.rejects(flow, /dialog failed/, 'the error still reaches the caller');
  await settle();
  assert.strictEqual(pendingRef.current, false, 'released after failure');
  assert.strictEqual(created.length, 1);
  console.log('✓ 4. A failing flow releases the guard and keeps its error');
}

// 5. Later intentional creation
{
  const flow = handleOpenFolder();
  assert.strictEqual(pickerCalls, 4, 'a new flow starts after the previous one ended');
  answerPicker.resolve('C:\\Users\\maike\\Documents\\测试 文件夹');
  const workspace = await flow;
  assert.strictEqual(created.length, 2);
  assert.strictEqual(workspace.rootPath, 'C:\\Users\\maike\\Documents\\测试 文件夹');
  assert.strictEqual(pendingRef.current, false);
  console.log('✓ 5. A later intentional creation still works');
}

console.log('WORKSPACE-CREATE-GUARD-001 tests passed.');
