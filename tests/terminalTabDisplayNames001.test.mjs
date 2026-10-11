/** TAB-NAME-001 — synchronized semantic terminal tab names and visual indices. */

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

const moduleCache = new Map();
function loadTs(relPath, customRequire = () => ({})) {
  const absPath = path.resolve(__dirname, relPath);
  if (moduleCache.has(absPath)) return moduleCache.get(absPath);
  const mod = { exports: {} };
  moduleCache.set(absPath, mod.exports);
  const js = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;

  new Function('module', 'exports', 'require', 'React', js)(
    mod,
    mod.exports,
    (id) => {
      if (id === 'react') return React;
      if (id.includes('.css')) return {};
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(absPath), id);
        for (const candidate of [
          `${resolved}.ts`,
          `${resolved}.tsx`,
          path.join(resolved, 'index.ts'),
          path.join(resolved, 'index.tsx'),
        ]) {
          if (fs.existsSync(candidate)) return loadTs(candidate, customRequire);
        }
      }
      return customRequire(id);
    },
    React,
  );
  moduleCache.set(absPath, mod.exports);
  return mod.exports;
}

const verificationModel = loadTs('../app/src/features/verification/verificationModel.ts');
const verificationState = loadTs(
  '../app/src/features/verification/verificationState.ts',
  (id) => (id.includes('verificationModel') ? verificationModel : {}),
);
const verificationReconciliation = loadTs(
  '../app/src/features/verification/verificationReconciliation.ts',
  (id) => {
    if (id.includes('verificationModel')) return verificationModel;
    if (id.includes('verificationState')) return verificationState;
    return {};
  },
);
const verification = {
  ...verificationModel,
  ...verificationState,
  ...verificationReconciliation,
};

const factory = loadTs(
  '../app/src/features/workspace/createDefaultWorkspace.ts',
  (id) => (id.includes('verification') ? verification : {}),
);
const names = loadTs('../app/src/features/workspace/terminalTabName.ts');
const reorder = loadTs('../app/src/features/workspace/workspaceReorder.ts');
const persistence = loadTs(
  '../app/src/features/workspace/workspacePersistence.ts',
  (id) => (id.includes('verification') ? verification : {}),
);

const displayNames = (tabs) =>
  tabs.map((tab) => names.getTerminalTabDisplayName(tab));

console.log('Running TAB-NAME-001 tests...');

const first = factory.createDefaultTerminalTab('tab-a', 'ws-1', 'Terminal 1', 'pane-a');
const second = factory.createDefaultTerminalTab('tab-b', 'ws-1', 'Terminal 2', 'pane-b');
const third = factory.createDefaultTerminalTab('tab-c', 'ws-1', 'Terminal 3', 'pane-c');

assert.strictEqual(first.baseName, 'Terminal');
assert.deepStrictEqual(displayNames([first, second, third]), [
  'Terminal',
  'Terminal',
  'Terminal',
]);

let workspace = factory.createDefaultLogicalWorkspace('ws-1', 'Workspace', 'tab-a', 'pane-a');
workspace = {
  ...workspace,
  terminalTabs: [first, second, third],
  terminalTabIds: [first.id, second.id, third.id],
  panes: [first.panes[0], second.panes[0], third.panes[0]],
};

let renamed = factory.renameTerminalTabInWorkspaces(
  [workspace],
  workspace.id,
  second.id,
  '  Backend  ',
)[0];
renamed = factory.renameTerminalTabInWorkspaces(
  [renamed],
  renamed.id,
  third.id,
  'API',
)[0];
assert.deepStrictEqual(displayNames(renamed.terminalTabs), [
  'Terminal',
  'Backend',
  'API',
]);
assert.strictEqual(renamed.terminalTabs[1].baseName, 'Backend');
assert.ok(!renamed.terminalTabs[1].baseName.includes(' 2'));

const duplicateTabs = renamed.terminalTabs.slice(0, 2).map((tab) => ({
  ...tab,
  baseName: 'API',
  name: 'API',
  label: 'API',
}));
assert.deepStrictEqual(displayNames(duplicateTabs), ['API', 'API']);

const blankRename = factory.renameTerminalTabInWorkspaces(
  [renamed],
  renamed.id,
  second.id,
  '   ',
)[0];
assert.strictEqual(blankRename, renamed, 'blank rename preserves existing validation behavior');

const originalIds = renamed.terminalTabs.map((tab) => tab.id);
const originalPanes = new Map(renamed.terminalTabs.map((tab) => [tab.id, tab.panes]));
const originalCapture = new Map(renamed.terminalTabs.map((tab) => [tab.id, tab.capture]));

const afterClose = renamed.terminalTabs.filter((tab) => tab.id !== second.id);
assert.deepStrictEqual(displayNames(afterClose), ['Terminal', 'API']);
assert.strictEqual(afterClose[1].baseName, 'API');

const appended = factory.createDefaultTerminalTab('tab-d', 'ws-1', 'Terminal', 'pane-d');
assert.deepStrictEqual(displayNames([...renamed.terminalTabs, appended]), [
  'Terminal',
  'Backend',
  'API',
  'Terminal',
]);

const reordered = reorder.reorderTerminalTabs(
  renamed.terminalTabs,
  third.id,
  first.id,
  'before',
);
assert.deepStrictEqual(displayNames(reordered), ['API', 'Terminal', 'Backend']);
assert.deepStrictEqual(reordered.map((tab) => tab.id), [third.id, first.id, second.id]);
assert.deepStrictEqual([...originalIds].sort(), reordered.map((tab) => tab.id).sort());
for (const tab of reordered) {
  assert.strictEqual(tab.panes, originalPanes.get(tab.id), 'pane identity is unchanged');
  assert.strictEqual(tab.capture, originalCapture.get(tab.id), 'Capture association is unchanged');
}

const serialized = persistence.serializeWorkspaceState([renamed], renamed.id);
assert.strictEqual(serialized.workspaces[0].terminalTabs[1].baseName, 'Backend');
assert.strictEqual(serialized.workspaces[0].terminalTabs[1].name, 'Backend');
assert.strictEqual(serialized.workspaces[0].terminalTabs[1].label, 'Backend');
const restored = persistence.deserializeWorkspaceState(serialized);
assert.ok(restored);
assert.deepStrictEqual(displayNames(restored.workspaces[0].terminalTabs), [
  'Terminal',
  'Backend',
  'API',
]);

const legacyDefault = { ...first, baseName: undefined, name: 'Terminal 1', label: 'Terminal 1' };
assert.strictEqual(names.getTerminalTabDisplayName(legacyDefault), 'Terminal');
assert.strictEqual(
  names.getTerminalTabDisplayName({ ...second, baseName: 'Backend' }),
  'Backend',
  'canonical semantic names never receive a position suffix',
);

const workspaceTabsSource = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.tsx'),
  'utf8',
);
const appSource = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
assert.match(workspaceTabsSource, /getTerminalTabDisplayName\(tab\)/);
assert.match(workspaceTabsSource, /setEditingTerminalTabName\(getTerminalTabBaseName\(tab\)\)/);
assert.match(appSource, /label: getTerminalTabDisplayName\(tab\)/);

console.log('✓ Terminal tab semantic names, persistence, and identity invariants pass');
