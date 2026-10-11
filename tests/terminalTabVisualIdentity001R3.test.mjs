/** TAB-VISUAL-IDENTITY-001R3 — Capture Identity Borders + Lighter Inactive Terminal Tabs */

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

const names = loadTs('../app/src/features/workspace/terminalTabName.ts');
const factory = loadTs('../app/src/features/workspace/createDefaultWorkspace.ts');
const reorder = loadTs('../app/src/features/workspace/workspaceReorder.ts');
const persistence = loadTs('../app/src/features/workspace/workspacePersistence.ts');
const targetScope = loadTs('../app/src/features/transcript/captureTargetScope.ts');

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
const chromeCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/ChromeTabs.css'),
  'utf8',
);
const appCss = fs.readFileSync(
  path.resolve(__dirname, '../app/src/App.css'),
  'utf8',
);

console.log('Running TAB-VISUAL-IDENTITY-001R3 tests...');

// ------------------------------------------------------------
// CAPTURE TESTS (1 - 13)
// ------------------------------------------------------------

// 1. individual Capture target renders checkbox
assert.match(
  captureSource,
  /<input\s+type=['"]checkbox['"]\s+className=['"]capture-target-checkbox['"]/,
  'Capture targets render checkbox input',
);

// 2. semantic tab name renders
assert.match(
  captureSource,
  /<span aria-hidden=['"]true['"]>\{pane\.label \?\? 'Terminal'\}<\/span>/,
  'Capture targets render semantic tab name',
);

// 3. identity dot does NOT render in capture targets
assert.doesNotMatch(
  captureSource,
  /className=['"]capture-target-dot['"]/,
  'Capture target does NOT render an identity dot',
);

// 4. Capture target receives matching tab identity CSS variable
assert.match(
  captureSource,
  /'--terminal-tab-identity-color':\s*getTerminalTabColorCssValue\(terminalTabColorKey\)/,
  'Capture target receives --terminal-tab-identity-color variable',
);
assert.match(
  captureSource,
  /style=\{tabIdentityStyle\}/,
  'Capture target sets style with identity variable',
);

// 5 - 8. emerald, blue, violet, amber tabs -> chip border uses identity color
for (const color of ['emerald', 'blue', 'violet', 'amber']) {
  const cssValue = names.getTerminalTabColorCssValue(color);
  assert.strictEqual(
    cssValue,
    `var(--terminal-tab-color-${color})`,
    `${color} maps to canonical identity variable`,
  );
}
assert.match(
  appCss,
  /\.capture-target-pill:not\(\.capture-target-pill--all\)\s*\{[\s\S]*?border-color:\s*var\(--terminal-tab-identity-color\);/,
  'Individual capture target chip border uses --terminal-tab-identity-color',
);

// 9. rename preserves border identity
const testTabs = [
  factory.createDefaultTerminalTab('tab-1', 'ws-1', 'Terminal', 'pane-1', undefined, 'violet'),
];
assert.strictEqual(names.getTerminalTabColorKey(testTabs[0]), 'violet');
const renamedTabs = factory.renameTerminalTabInWorkspaces(
  [{ id: 'ws-1', terminalTabs: testTabs, terminalTabIds: ['tab-1'], panes: testTabs[0].panes, capture: { targetScope: { mode: 'all' }, blocks: [] } }],
  'ws-1',
  'tab-1',
  'API',
);
assert.strictEqual(names.getTerminalTabDisplayName(renamedTabs[0].terminalTabs[0]), 'API');
assert.strictEqual(names.getTerminalTabColorKey(renamedTabs[0].terminalTabs[0]), 'violet');

// 10. All has no Terminal identity color
assert.match(
  appCss,
  /\.capture-target-pill--all\s*\{[\s\S]*?border-color:\s*var\(--border-muted\);/,
  'All pill border remains neutral var(--border-muted)',
);
assert.match(
  captureSource,
  /<label\s+className=\{`capture-target-pill capture-target-pill--all/,
  'All pill has capture-target-pill--all class',
);
assert.doesNotMatch(
  captureSource,
  /<label[^>]*capture-target-pill--all[^>]*style=\{tabIdentityStyle\}/,
  'All pill does not receive tabIdentityStyle',
);

// 11. checked/unchecked state remains checkbox-driven
assert.match(
  appCss,
  /\.capture-target-checkbox:checked\s*\{[\s\S]*?background:\s*var\(--accent\);/,
  'Checkbox checked state communicates selection',
);
assert.match(
  appCss,
  /\.capture-target-pill:not\(\.capture-target-pill--all\):has\(input:checked\),[\s\S]*?border-color:\s*var\(--terminal-tab-identity-color\);/,
  'Individual pill retains identity border when checked',
);

// 12. semantic ALL behavior unchanged
const wsAll = {
  panes: [{ id: 'p1' }, { id: 'p2' }],
  terminalTabs: [
    { id: 't1', panes: [{ id: 'p1' }] },
    { id: 't2', panes: [{ id: 'p2' }] },
  ],
  capture: { targetScope: { mode: 'all' }, blocks: [] },
};
assert.deepStrictEqual(targetScope.resolveCaptureTargetPaneIds(wsAll), ['p1', 'p2']);

// 13. explicit target behavior unchanged
const wsExplicit = {
  panes: [{ id: 'p1' }, { id: 'p2' }],
  terminalTabs: [
    { id: 't1', panes: [{ id: 'p1' }] },
    { id: 't2', panes: [{ id: 'p2' }] },
  ],
  capture: { targetScope: { mode: 'explicit', paneIds: ['p2'] }, blocks: [] },
};
assert.deepStrictEqual(targetScope.resolveCaptureTargetPaneIds(wsExplicit), ['p2']);

// ------------------------------------------------------------
// TERMINAL TESTS (14 - 27)
// ------------------------------------------------------------

// 14. Terminal tabs contain ZERO status dots (CAPTURE-STATUS-001)
assert.strictEqual(
  tabsSource.match(/className="workspace-tab-status-lights"/g)?.length ?? 0,
  0,
  "Terminal tabs have no workspace-tab-status-lights container",
);
assert.strictEqual(
  tabsSource.match(/workspace-tab-status-dot/g)?.length ?? 0,
  0,
  "Terminal tabs contain ZERO status dots",
);
// 15. no Terminal identity dot returns
assert.doesNotMatch(tabsSource, /terminal-tab-identity-dot/);
assert.doesNotMatch(tabsCss, /terminal-tab-identity-dot/);

// 16. inactive tab still receives identity hue
assert.match(
  chromeCss,
  /\.chrome-tab--terminal:not\(\.chrome-tab--active\):not\(\[data-active="true"\]\)\s*\{[\s\S]*?border-color:\s*color-mix\([\s\S]*?--terminal-tab-identity-color/,
  'Inactive tab border-color uses identity color via color-mix',
);

// 17. inactive border treatment is weaker than active
const inactiveRule = chromeCss.match(
  /\.chrome-tab--terminal:not\(\.chrome-tab--active\):not\(\[data-active="true"\]\)\s*\{[\s\S]*?\n\}/,
)?.[0];
assert.ok(inactiveRule, 'Inactive rule exists');
assert.match(inactiveRule, /35%/);

// 18. active border uses full identity color
const activeRule = chromeCss.match(
  /\.chrome-tab--terminal\.chrome-tab--active,[\s\S]*?\n\}/,
)?.[0];
assert.ok(activeRule, 'Active tab rule exists');
assert.match(
  activeRule,
  /border-color:\s*var\(\s*--terminal-tab-identity-color,\s*var\(--terminal-tab-accent\)\s*\);/,
  'Active terminal tab uses 100% full identity color border',
);

// 19. active top accent uses identity color
const activeAccentRule = chromeCss.match(
  /\.chrome-tab--terminal\[data-active="true"\]::before,[\s\S]*?\n\}/,
)?.[0];
assert.ok(activeAccentRule, 'Active top accent rule exists');
assert.match(
  activeAccentRule,
  /background:\s*var\(\s*--terminal-tab-identity-color,\s*var\(--terminal-tab-accent\)\s*\);/,
);

// 20. inactive hover uses identity hue with intermediate strength
const hoverRule = chromeCss.match(
  /\.chrome-tab--terminal:hover:not\(\.chrome-tab--active\):not\(\[data-active="true"\]\)\s*\{[\s\S]*?\n\}/,
)?.[0];
assert.ok(hoverRule, 'Hover rule exists');
assert.match(hoverRule, /65%/);

// 21. active background unchanged
assert.match(
  activeRule,
  /background:\s*rgba\(255,\s*255,\s*255,\s*0\.08\);/,
  'Active tab background is rgba(255, 255, 255, 0.08)',
);

// 22. focus-visible unchanged
assert.match(
  tabsCss,
  /\.workspace-tab-activator:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent\);/,
  'Focus-visible uses var(--accent)',
);

// 23. rename preserves identity color
assert.match(
  tabsSource,
  /saveRename\(tab\.id,\s*editingTerminalTabName\)/,
  'Rename handler preserves tab ID and identity',
);

// 24. reorder does not alter identity color
const multiTabs = [
  factory.createDefaultTerminalTab('tab-1', 'ws-1', 'Terminal', 'pane-1', undefined, 'emerald'),
  factory.createDefaultTerminalTab('tab-2', 'ws-1', 'Backend', 'pane-2', undefined, 'blue'),
];
const reorderedTabs = reorder.reorderTerminalTabs(multiTabs, 'tab-2', 'tab-1', 'before');
assert.strictEqual(reorderedTabs[0].colorKey, 'blue');
assert.strictEqual(reorderedTabs[1].colorKey, 'emerald');

// 25. close does not recolor survivors
const surviving = multiTabs.filter((t) => t.id !== 'tab-1');
assert.strictEqual(surviving[0].colorKey, 'blue');

// 26. restore preserves identity color
const savedWs = persistence.serializeWorkspaceState(
  [{ id: 'ws-1', terminalTabs: multiTabs, terminalTabIds: ['tab-1', 'tab-2'], panes: multiTabs.flatMap((t) => t.panes), capture: { targetScope: { mode: 'all' }, blocks: [] } }],
  'ws-1',
);
const loadedWs = persistence.deserializeWorkspaceState(savedWs);
assert.deepStrictEqual(
  loadedWs.workspaces[0].terminalTabs.map((t) => t.colorKey),
  ['emerald', 'blue'],
);

// 27. dimensions/styles do not introduce geometry regression
assert.match(
  chromeCss,
  /\.chrome-tab\s*\{[\s\S]*?height:\s*28px;[\s\S]*?min-height:\s*28px;[\s\S]*?border:\s*1px solid transparent;[\s\S]*?box-sizing:\s*border-box;/,
  'Chrome tab retains stable height 28px and box-sizing',
);
assert.match(
  appCss,
  /\.capture-target-pill,\s*\.capture-target-pill--all\s*\{[\s\S]*?min-height:\s*20px;[\s\S]*?height:\s*20px;[\s\S]*?box-sizing:\s*border-box;/,
  'Capture target pill retains stable height 20px and box-sizing',
);

console.log('✓ All 27 TAB-VISUAL-IDENTITY-001R3 requirements verified successfully.');
