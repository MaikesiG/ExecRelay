/** TAB-VISUAL-IDENTITY-001 — semantic names and stable per-tab colors. */

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

const names = loadTs('../app/src/features/workspace/terminalTabName.ts');
const factory = loadTs(
  '../app/src/features/workspace/createDefaultWorkspace.ts',
  (id) => (id.includes('verification') ? verification : {}),
);
const reorder = loadTs('../app/src/features/workspace/workspaceReorder.ts');
const persistence = loadTs(
  '../app/src/features/workspace/workspacePersistence.ts',
  (id) => (id.includes('verification') ? verification : {}),
);
const targetScope = loadTs('../app/src/features/transcript/captureTargetScope.ts');

const createTab = (tabs, id, baseName, paneId) => {
  const colorKey = names.getNextTerminalTabColorKey(tabs);
  return factory.createDefaultTerminalTab(
    id,
    'ws-identity',
    baseName,
    paneId,
    undefined,
    colorKey,
  );
};

console.log('Running TAB-VISUAL-IDENTITY-001 tests...');

const tabs = [];
tabs.push(createTab(tabs, 'tab-a', 'Terminal', 'pane-a'));
tabs.push(createTab(tabs, 'tab-b', 'Backend', 'pane-b'));
tabs.push(createTab(tabs, 'tab-c', 'API', 'pane-c'));
tabs.push(createTab(tabs, 'tab-d', 'Database', 'pane-d'));

assert.deepStrictEqual(
  tabs.map(names.getTerminalTabColorKey),
  ['emerald', 'blue', 'violet', 'amber'],
  'new tabs receive deterministic distinct colors while palette entries remain',
);
assert.deepStrictEqual(
  tabs.map(names.getTerminalTabDisplayName),
  ['Terminal', 'Backend', 'API', 'Database'],
);
assert.strictEqual(names.getTerminalTabDisplayName.length, 1);

const duplicateNames = [
  { ...tabs[0], baseName: 'API', name: 'API', label: 'API' },
  { ...tabs[1], baseName: 'API', name: 'API', label: 'API' },
];
assert.deepStrictEqual(duplicateNames.map(names.getTerminalTabDisplayName), ['API', 'API']);
assert.notStrictEqual(
  names.getTerminalTabColorKey(duplicateNames[0]),
  names.getTerminalTabColorKey(duplicateNames[1]),
);

let workspace = factory.createDefaultLogicalWorkspace(
  'ws-identity',
  'Identity',
  tabs[0].id,
  tabs[0].panes[0].id,
);
workspace = {
  ...workspace,
  terminalTabs: tabs,
  terminalTabIds: tabs.map((tab) => tab.id),
  panes: tabs.flatMap((tab) => tab.panes),
};

const originalTabId = tabs[1].id;
const originalColor = tabs[1].colorKey;
const originalPane = tabs[1].panes[0];
const originalSessionId = originalPane.session.sessionId;
const originalCapture = tabs[1].capture;

const renamedWorkspace = factory.renameTerminalTabInWorkspaces(
  [workspace],
  workspace.id,
  tabs[1].id,
  'Services',
)[0];
const renamedTab = renamedWorkspace.terminalTabs[1];
assert.strictEqual(names.getTerminalTabDisplayName(renamedTab), 'Services');
assert.strictEqual(renamedTab.colorKey, originalColor);
assert.strictEqual(renamedTab.id, originalTabId);
assert.strictEqual(renamedTab.panes[0], originalPane);
assert.strictEqual(renamedTab.panes[0].session.sessionId, originalSessionId);
assert.strictEqual(renamedTab.capture, originalCapture);

const reordered = reorder.reorderTerminalTabs(
  renamedWorkspace.terminalTabs,
  tabs[2].id,
  tabs[0].id,
  'before',
);
assert.deepStrictEqual(reordered.map((tab) => tab.id), [
  tabs[2].id,
  tabs[0].id,
  tabs[1].id,
  tabs[3].id,
]);
for (const tab of reordered) {
  const before = renamedWorkspace.terminalTabs.find((candidate) => candidate.id === tab.id);
  assert.strictEqual(tab.colorKey, before.colorKey, 'reorder preserves tab color');
}

const afterClose = reordered.filter((tab) => tab.id !== tabs[0].id);
for (const tab of afterClose) {
  const before = reordered.find((candidate) => candidate.id === tab.id);
  assert.strictEqual(tab.colorKey, before.colorKey, 'closing another tab preserves color');
}

const serialized = persistence.serializeWorkspaceState(
  [renamedWorkspace],
  renamedWorkspace.id,
);
assert.deepStrictEqual(
  serialized.workspaces[0].terminalTabs.map((tab) => tab.colorKey),
  ['emerald', 'blue', 'violet', 'amber'],
);
const restored = persistence.deserializeWorkspaceState(serialized);
assert.ok(restored);
assert.deepStrictEqual(
  restored.workspaces[0].terminalTabs.map((tab) => tab.colorKey),
  ['emerald', 'blue', 'violet', 'amber'],
);
assert.deepStrictEqual(
  restored.workspaces[0].terminalTabs.map(names.getTerminalTabDisplayName),
  ['Terminal', 'Services', 'API', 'Database'],
);

const legacyState = structuredClone(serialized);
for (const tab of legacyState.workspaces[0].terminalTabs) delete tab.colorKey;
const legacyRestored = persistence.deserializeWorkspaceState(legacyState);
assert.ok(legacyRestored);
assert.deepStrictEqual(
  legacyRestored.workspaces[0].terminalTabs.map((tab) => tab.colorKey),
  ['emerald', 'blue', 'violet', 'amber'],
  'legacy tabs receive deterministic valid colors during hydration',
);

const dynamicAllWorkspace = {
  panes: tabs.slice(0, 2).flatMap((tab) => tab.panes),
  terminalTabs: tabs.slice(0, 2),
  capture: { targetScope: { mode: 'all' }, blocks: [] },
};
assert.deepStrictEqual(targetScope.resolveCaptureTargetPaneIds(dynamicAllWorkspace), [
  'pane-a',
  'pane-b',
]);
dynamicAllWorkspace.panes.push(tabs[2].panes[0]);
dynamicAllWorkspace.terminalTabs.push(tabs[2]);
assert.deepStrictEqual(targetScope.resolveCaptureTargetPaneIds(dynamicAllWorkspace), [
  'pane-a',
  'pane-b',
  'pane-c',
]);

const appSource = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
const tabsSource = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.tsx'),
  'utf8',
);
const captureSource = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
  'utf8',
);
const tabsCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.css'),
  'utf8',
);
const chromeTabsCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/ChromeTabs.css'),
  'utf8',
);

assert.match(tabsSource, /getTerminalTabDisplayName\(tab\)/);
assert.match(tabsSource, /data-tab-color=\{tabColorKey\}/);
assert.doesNotMatch(tabsSource, /terminal-tab-identity-dot/);
assert.match(appSource, /terminalTabColorKey: getTerminalTabColorKey\(tab\)/);
assert.match(appSource, /label: getTerminalTabDisplayName\(tab\)/);
assert.doesNotMatch(appSource, /getTerminalTabDisplayName\(tab,\s*tabIndex\)/);
assert.match(captureSource, /className='capture-target-all-label'>\s*All\s*<\/span>/);
assert.doesNotMatch(captureSource, /All \{terminalTabCount/);
assert.match(captureSource, /data-tab-color=\{terminalTabColorKey\}/);
assert.match(captureSource, /pane\.terminalTabColorKey \?\? pane\.accentId/);
assert.doesNotMatch(appSource, /label:\s*`[^`]*pane\.stableOrdinal/);
assert.match(tabsCss, /background-color:\s*var\(--terminal-tab-identity-color\)/);
assert.match(
  chromeTabsCss,
  /\.chrome-tab--terminal\s*\{[\s\S]*?border-color:\s*var\([\s\S]*?--terminal-tab-identity-color/,
);

console.log('✓ TAB-VISUAL-IDENTITY-001 naming, color, persistence, and runtime invariants pass');
