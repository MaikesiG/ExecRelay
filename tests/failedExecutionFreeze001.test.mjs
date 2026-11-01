/**
 * FAILED-EXECUTION-FREEZE-001 Test Suite
 *
 * Every terminal tab of every workspace keeps a mounted Capture side panel. Measured in
 * WKWebView, WebKit layout of a mounted output costs ~0.8 ms per 1K characters, so the
 * active workspace's blocks rendered in all 21 panels of an 11-workspace session turned a
 * 100–200 KB failed output into 1.6–3.4 s main-thread stalls.
 *
 * Validates (DOM scale):
 * 1. Only the active tab's Capture panel renders the active workspace's blocks.
 * 2. Rendered output characters stay at 1x the active workspace output, independent of the
 *    number of workspaces and tabs.
 * 3. Switching the active tab moves the blocks to that tab's panel, which still shows the
 *    workspace-wide Capture history (blocks captured in other tabs).
 * 4. Switching the active workspace renders the new workspace's blocks exactly once.
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

console.log('Running FAILED-EXECUTION-FREEZE-001 tests...');

function transpileTs(relPath, customRequire = () => ({})) {
  const src = fs.readFileSync(path.resolve(__dirname, relPath), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'React', js)(mod, mod.exports, customRequire, React);
  return mod.exports;
}

const workspaceTypes = transpileTs('../app/src/features/workspace/types.ts');
const panelLayoutTree = transpileTs('../app/src/features/workspace/panelLayoutTree.ts', (req) =>
  req === './types' ? workspaceTypes : {},
);

// Stand-in Capture panel: one <pre> per block, as TranscriptCard renders its output.
function CapturePanelStub({ blocks }) {
  return React.createElement(
    'div',
    { className: 'capture-panel-stub' },
    blocks.map((b) => React.createElement('pre', { key: b.id }, b.output)),
  );
}

const { TerminalPaneLayout } = transpileTs('../app/src/features/workspace/TerminalPaneLayout.tsx', (req) => {
  if (req === 'react') return React;
  if (req === './panelLayoutTree') return panelLayoutTree;
  if (req === './PanelLayoutNodeView') return { PanelLayoutNodeView: () => null };
  if (req === '../transcript/TranscriptCapturePanel') return { TranscriptCapturePanel: CapturePanelStub };
  return {};
});

function makeTab(workspaceId, n) {
  const paneId = `pane-${workspaceId}-${n}`;
  return {
    id: `tab-${workspaceId}-${n}`,
    workspaceId,
    panes: [{ id: paneId, stableOrdinal: 1, accentId: 'blue' }],
    activePaneId: paneId,
    isCapturePanelOpen: true,
  };
}

// The measured session shape: 11 workspaces, 21 terminal tabs.
const tabsPerWorkspace = [3, 1, 1, 1, 2, 3, 2, 1, 1, 3, 3];
const workspaces = tabsPerWorkspace.map((count, i) => ({
  id: `ws-${i}`,
  tabs: Array.from({ length: count }, (_, n) => makeTab(`ws-${i}`, n)),
}));
const activeOutputChars = 200_000;
const blocksByWorkspace = {
  // ws9: two 100 KB failed outputs, both captured in its first tab.
  'ws-9': [
    { id: 'block-a', workspaceId: 'ws-9', terminalTabId: 'tab-ws-9-0', output: 'x'.repeat(100_000) },
    { id: 'block-b', workspaceId: 'ws-9', terminalTabId: 'tab-ws-9-0', output: 'y'.repeat(100_000) },
  ],
  // ws8: seven blocks, one of them 100 KB.
  'ws-8': Array.from({ length: 7 }, (_, n) => ({
    id: `block-8-${n}`,
    workspaceId: 'ws-8',
    terminalTabId: 'tab-ws-8-0',
    output: n === 6 ? 'z'.repeat(100_000) : 'z'.repeat(30),
  })),
};

// Mirrors App: a tab is active when its workspace is active and it is that workspace's
// active terminal tab; transcriptProps.blocks is the active workspace's Capture history.
function renderSession(activeWsId, activeTabId) {
  const activeWs = workspaces.find((w) => w.id === activeWsId);
  const transcriptProps = { blocks: blocksByWorkspace[activeWsId] };
  const tree = React.createElement(
    'div',
    null,
    workspaces.flatMap((ws) =>
      ws.tabs.map((tab) =>
        React.createElement(TerminalPaneLayout, {
          key: tab.id,
          workspaceId: ws.id,
          tab,
          isTabActive: ws.id === activeWs.id && tab.id === activeTabId,
          terminalRefs: { current: new Map() },
          onSetActivePane: () => {},
          onResizePaneLayout: () => {},
          onStatusChange: () => {},
          onTerminalInput: () => {},
          onTerminalOutput: () => {},
          onSessionEnded: () => {},
          transcriptProps,
        }),
      ),
    ),
  );
  const html = ReactDOMServer.renderToStaticMarkup(tree);
  const pres = [...html.matchAll(/<pre>([^<]*)<\/pre>/g)].map((m) => m[1]);
  const panels = html.split('class="capture-panel-stub"').slice(1).map((s) => (s.match(/<pre>/g) ?? []).length);
  return {
    panelCount: panels.length,
    panelsWithBlocks: panels.filter((n) => n > 0).length,
    preCount: pres.length,
    renderedChars: pres.reduce((n, p) => n + p.length, 0),
    activeTabPres: (html.split(`id="capture-side-panel-${activeTabId}"`)[1]?.split('</aside>')[0].match(/<pre>/g) ?? []).length,
  };
}

// 1. Only the active tab's panel renders blocks; every tab keeps its (empty) panel mounted.
const activeWs = workspaces[9];
const activeBlocks = blocksByWorkspace['ws-9'];
const first = renderSession('ws-9', activeWs.tabs[0].id);
assert.strictEqual(first.panelCount, 21, 'every terminal tab keeps its Capture side panel');
assert.strictEqual(
  first.panelsWithBlocks,
  1,
  `only one Capture panel may render blocks; ${first.panelsWithBlocks} panels rendered the active payload`,
);
assert.strictEqual(first.activeTabPres, activeBlocks.length, 'the active tab renders every active-workspace block');
console.log('✓ 1. Only the active tab\'s Capture panel renders blocks (1 of 21 panels)');

// 2. DOM scale: rendered output is 1x the active workspace output, not 1x per tab.
assert.strictEqual(first.preCount, activeBlocks.length, `rendered <pre> count must equal block count, got ${first.preCount}`);
assert.ok(
  first.renderedChars <= activeOutputChars,
  `rendered output chars must not exceed the active output (${activeOutputChars}), got ${first.renderedChars}`,
);
console.log(`✓ 2. Rendered output stays at 1x (${first.preCount} <pre>, ${first.renderedChars} chars across 21 tabs)`);

// 3. Switching the active tab moves the blocks to the newly visible panel.
const second = renderSession('ws-9', activeWs.tabs[2].id);
assert.strictEqual(second.panelsWithBlocks, 1);
assert.strictEqual(second.activeTabPres, activeBlocks.length, 'the visible tab shows blocks captured in other tabs');
assert.strictEqual(second.renderedChars, first.renderedChars);
console.log('✓ 3. Switching tabs moves the workspace Capture history to the visible panel');

// 4. Workspace switch: the new workspace's blocks render once, in its active tab only.
const ws8 = workspaces[8];
const third = renderSession('ws-8', ws8.tabs[0].id);
const ws8Chars = blocksByWorkspace['ws-8'].reduce((n, b) => n + b.output.length, 0);
assert.strictEqual(third.panelsWithBlocks, 1);
assert.strictEqual(third.activeTabPres, 7);
assert.strictEqual(third.renderedChars, ws8Chars);
console.log(`✓ 4. Switching workspaces renders the new workspace once (${third.preCount} <pre>, ${third.renderedChars} chars)`);

console.log('FAILED-EXECUTION-FREEZE-001 tests passed.');
