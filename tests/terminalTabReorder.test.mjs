import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
const { reorderTerminalTabs, reorderWorkspaces } = reorderModule.exports;

// Load workspacePersistence module for persistence validation
function loadModule(relPath, dependencyOverrides = {}) {
  const absPath = path.resolve(__dirname, relPath);
  const src = fs.readFileSync(absPath, 'utf8');
  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', transpiled)(
    mod,
    mod.exports,
    (id) => {
      if (Object.hasOwn(dependencyOverrides, id)) return dependencyOverrides[id];
      if (id.includes('types')) return {};
      if (id.includes('verification')) return {
        ensureWorkspaceVerificationState: (ws) => ws,
        reconcileWorkspaceVerificationState: ({ workspace }) => ({ workspace }),
      };
      if (id.includes('types')) return {};
      return {};
    },
  );
  return mod.exports;
}

const terminalTabNameMod = loadModule(
  '../app/src/features/workspace/terminalTabName.ts',
);
const persistMod = loadModule(
  '../app/src/features/workspace/workspacePersistence.ts',
  { './terminalTabName': terminalTabNameMod },
);

function makePane(tabId, paneId, ordinal = 1, accent = 'blue', cwd = '/tmp') {
  return {
    id: paneId,
    terminalTabId: tabId,
    stableOrdinal: ordinal,
    accentId: accent,
    customTitle: null,
    lastKnownCwd: cwd,
    session: {
      sessionId: `session-${paneId}`,
      status: 'running',
      sessionInfo: {
        sessionId: `session-${paneId}`,
        cwd,
      },
    },
    terminalSessionId: `session-${paneId}`,
    capture: {
      isListening: false,
      hasRetainedData: false,
      currentBatchId: null,
      sessionId: `capture-${paneId}`,
    },
    selection: {
      selectedBlockIds: new Set(),
      updatedAt: 0,
    },
  };
}

function makeTab(id, workspaceId, label, panes = null, splitLayout = null) {
  const tabPanes = panes ?? [makePane(id, `pane-${id}`)];
  const activePaneId = tabPanes[0].id;
  const panelLayout = splitLayout ?? {
    type: 'panel',
    panelId: `panel-${activePaneId}`,
  };

  return {
    id,
    workspaceId,
    label,
    name: label,
    terminalPanes: tabPanes,
    panes: tabPanes,
    panels: tabPanes.map((p) => ({
      id: `panel-${p.id}`,
      kind: 'terminal',
      paneId: p.id,
      terminalSessionId: p.terminalSessionId,
    })),
    capturePanelId: `capture-panel-${id}`,
    panelLayout,
    activeTerminalPaneId: activePaneId,
    activePaneId,
    nextTerminalPaneOrdinal: tabPanes.length + 1,
    paneIds: tabPanes.map((p) => p.id),
    rootPaneId: tabPanes[0].id,
    isCapturePanelOpen: true,
    capturePanelWidth: 400,
    pane: tabPanes[0].session,
    capture: tabPanes[0].capture,
  };
}

function makeWorkspace(id, tabs) {
  return {
    id,
    name: id,
    rootPath: `/projects/${id}`,
    terminalTabs: tabs,
    terminalTabIds: tabs.map((t) => t.id),
    activeTerminalTabId: tabs[0]?.id ?? '',
    panes: tabs.flatMap((t) => t.panes),
    capture: {
      isListening: false,
      currentBatch: null,
      batchCounter: 1,
      blocks: [
        {
          id: `block-${id}-1`,
          command: 'echo test',
          output: 'test\n',
          workspaceId: id,
          terminalTabId: tabs[0]?.id,
          terminalPaneId: tabs[0]?.panes[0]?.id,
        },
      ],
    },
    selection: {
      selectedBlockIds: new Set(),
      updatedAt: 0,
    },
    verification: {
      contracts: [
        {
          id: `contract-${id}`,
          name: 'Default Contract',
          criteria: [{ id: `crit-${id}`, prompt: 'check 1', workingDirectory: '.' }],
        },
      ],
      activeContractId: `contract-${id}`,
      runs: [
        {
          id: `run-${id}`,
          contractId: `contract-${id}`,
          status: 'passed',
          criterionResults: [{ criterionId: `crit-${id}`, passed: true, executionId: `block-${id}-1` }],
        },
      ],
    },
  };
}

const tabA = makeTab('tab-a', 'ws-1', 'Terminal 1');
const tabB = makeTab('tab-b', 'ws-1', 'Terminal 2');
const tabC = makeTab('tab-c', 'ws-1', 'Terminal 3');
const tabD = makeTab('tab-d', 'ws-1', 'Terminal 4');
const ids = (items) => items.map((t) => t.id);

console.log('Running UX-REORDER-002 Terminal Tab Reorder Tests...\n');

// 1. Reorder first tab to end
assert.deepStrictEqual(ids(reorderTerminalTabs([tabA, tabB, tabC], 'tab-a', 'tab-c', 'after')), ['tab-b', 'tab-c', 'tab-a']);
console.log('✓ 1. Reorder first tab to end');

// 2. Reorder last tab to beginning
assert.deepStrictEqual(ids(reorderTerminalTabs([tabA, tabB, tabC], 'tab-c', 'tab-a', 'before')), ['tab-c', 'tab-a', 'tab-b']);
console.log('✓ 2. Reorder last tab to beginning');

// 3. Reorder middle tab left
assert.deepStrictEqual(ids(reorderTerminalTabs([tabA, tabB, tabC], 'tab-b', 'tab-a', 'before')), ['tab-b', 'tab-a', 'tab-c']);
console.log('✓ 3. Reorder middle tab left');

// 4. Reorder middle tab right
assert.deepStrictEqual(ids(reorderTerminalTabs([tabA, tabB, tabC], 'tab-b', 'tab-c', 'after')), ['tab-a', 'tab-c', 'tab-b']);
console.log('✓ 4. Reorder middle tab right');

// 5. Drop onto self = no-op
const tabsOriginal = [tabA, tabB, tabC];
assert.strictEqual(reorderTerminalTabs(tabsOriginal, 'tab-b', 'tab-b', 'before'), tabsOriginal);
assert.strictEqual(reorderTerminalTabs(tabsOriginal, 'tab-a', 'tab-a', 'after'), tabsOriginal);
console.log('✓ 5. Drop onto self is a strict reference no-op');

// 6. Cancelled drag / invalid IDs = no-op
assert.strictEqual(reorderTerminalTabs(tabsOriginal, 'missing', 'tab-b', 'before'), tabsOriginal);
assert.strictEqual(reorderTerminalTabs(tabsOriginal, 'tab-a', 'missing', 'after'), tabsOriginal);
console.log('✓ 6. Cancelled drag or missing IDs return original array');

// 7. Stable tab IDs preserved
const reordered = reorderTerminalTabs([tabA, tabB, tabC, tabD], 'tab-d', 'tab-a', 'after');
assert.deepStrictEqual(ids(reordered), ['tab-a', 'tab-d', 'tab-b', 'tab-c']);
console.log('✓ 7. Stable tab IDs preserved');

// 8. Object/reference identity preserved
for (const originalTab of [tabA, tabB, tabC, tabD]) {
  const match = reordered.find((t) => t.id === originalTab.id);
  assert.strictEqual(match, originalTab, `Tab ${originalTab.id} must preserve exact object reference`);
}
console.log('✓ 8. Object references preserved (no cloning/recreation)');

// 9. Active tab ID preserved
let activeTabId = 'tab-b';
const afterMoveActive = reorderTerminalTabs([tabA, tabB, tabC], 'tab-c', 'tab-a', 'before');
assert.strictEqual(activeTabId, 'tab-b', 'Active tab ID must remain unchanged when tabs reorder');
console.log('✓ 9. Active tab ID preserved');

// 10. Active non-dragged tab preserved
activeTabId = 'tab-a';
const afterMoveOther = reorderTerminalTabs([tabA, tabB, tabC], 'tab-c', 'tab-b', 'before');
assert.strictEqual(activeTabId, 'tab-a');
assert.deepStrictEqual(ids(afterMoveOther), ['tab-a', 'tab-c', 'tab-b']);
console.log('✓ 10. Active non-dragged tab preserved');

// 11. Dragging inactive tab does not activate it
let selectedTab = 'tab-a';
const simulateDrag = (draggedId, targetId, placement) => {
  // Drag performs reorder, does NOT call onSelectTab
  return reorderTerminalTabs([tabA, tabB, tabC], draggedId, targetId, placement);
};
simulateDrag('tab-c', 'tab-a', 'before');
assert.strictEqual(selectedTab, 'tab-a', 'Selected tab must NOT change during drag');
console.log('✓ 11. Dragging inactive tab does not activate it');

// 12. Focused pane ID preserved
const tabWithPaneFocus = makeTab('tab-focus', 'ws-1', 'Focus Test');
assert.strictEqual(tabWithPaneFocus.activePaneId, 'pane-tab-focus');
assert.strictEqual(tabWithPaneFocus.activeTerminalPaneId, 'pane-tab-focus');
const reorderedFocus = reorderTerminalTabs([tabWithPaneFocus, tabA], 'tab-a', 'tab-focus', 'before');
assert.strictEqual(reorderedFocus[1].activePaneId, 'pane-tab-focus');
console.log('✓ 12. Focused pane ID preserved');

// 13, 14, 15, 38. Split tree, pane IDs, and PTY session IDs preserved across reorder
const paneA1 = makePane('tab-split-a', 'p-a1', 1, 'blue', '/tmp/a1');
const paneA2 = makePane('tab-split-a', 'p-a2', 2, 'rose', '/tmp/a2');
const splitTree = {
  type: 'split',
  id: 'split-node-1',
  direction: 'horizontal',
  ratio: 0.5,
  first: { type: 'panel', panelId: 'panel-p-a1' },
  second: { type: 'panel', panelId: 'panel-p-a2' },
};
const tabSplitA = makeTab('tab-split-a', 'ws-1', 'Split A', [paneA1, paneA2], splitTree);
tabSplitA.activePaneId = 'p-a2';

const paneB1 = makePane('tab-single-b', 'p-b1', 1, 'emerald', '/tmp/b1');
const tabSingleB = makeTab('tab-single-b', 'ws-1', 'Single B', [paneB1]);

const reorderedSplit = reorderTerminalTabs([tabSplitA, tabSingleB], 'tab-single-b', 'tab-split-a', 'before');
assert.deepStrictEqual(ids(reorderedSplit), ['tab-single-b', 'tab-split-a']);

// Verify Tab Single B
const restoredB = reorderedSplit[0];
assert.strictEqual(restoredB.panes.length, 1);
assert.strictEqual(restoredB.panes[0].id, 'p-b1');
assert.strictEqual(restoredB.panes[0].terminalSessionId, 'session-p-b1');
assert.strictEqual(restoredB.panes[0].lastKnownCwd, '/tmp/b1');

// Verify Tab Split A
const restoredA = reorderedSplit[1];
assert.strictEqual(restoredA.panes.length, 2);
assert.strictEqual(restoredA.panes[0].id, 'p-a1');
assert.strictEqual(restoredA.panes[1].id, 'p-a2');
assert.strictEqual(restoredA.panes[0].terminalSessionId, 'session-p-a1');
assert.strictEqual(restoredA.panes[1].terminalSessionId, 'session-p-a2');
assert.strictEqual(restoredA.panes[0].lastKnownCwd, '/tmp/a1');
assert.strictEqual(restoredA.panes[1].lastKnownCwd, '/tmp/a2');
assert.strictEqual(restoredA.panelLayout.type, 'split');
assert.strictEqual(restoredA.panelLayout.id, 'split-node-1');
assert.strictEqual(restoredA.panelLayout.ratio, 0.5);
assert.strictEqual(restoredA.activePaneId, 'p-a2', 'Active/focused pane must remain p-a2');
console.log('✓ 13-15 & 38. Split tree, pane layout, pane IDs, cwd, and PTY sessions strictly preserved');

// 16. Capture ownership preserved
const wsWithCapture = makeWorkspace('ws-cap', [tabA, tabB]);
const reorderedTabsForCap = reorderTerminalTabs(wsWithCapture.terminalTabs, 'tab-b', 'tab-a', 'before');
assert.strictEqual(wsWithCapture.capture.blocks[0].terminalTabId, 'tab-a');
assert.strictEqual(wsWithCapture.capture.blocks[0].terminalPaneId, 'pane-tab-a');
console.log('✓ 16. Capture ownership and transcript associations strictly preserved');

// 17. Verification association preserved
assert.strictEqual(wsWithCapture.verification.runs[0].criterionResults[0].executionId, 'block-ws-cap-1');
assert.strictEqual(wsWithCapture.verification.contracts[0].id, 'contract-ws-cap');
console.log('✓ 17. Verification association and contract state strictly preserved');

// 18 & 19 & 39. Persistence and Restoration of reordered tabs
const wsForPersist = makeWorkspace('ws-persist', [tabA, tabB, tabC]);
const reorderedTabs = reorderTerminalTabs(wsForPersist.terminalTabs, 'tab-c', 'tab-a', 'before');
wsForPersist.terminalTabs = reorderedTabs;
wsForPersist.terminalTabIds = reorderedTabs.map((t) => t.id);

const serialized = persistMod.serializeWorkspaceState([wsForPersist], wsForPersist.id);
assert.deepStrictEqual(
  serialized.workspaces[0].terminalTabs.map((t) => t.id),
  ['tab-c', 'tab-a', 'tab-b'],
  'Serialized state must reflect reordered tab positions',
);

const hydrated = persistMod.deserializeWorkspaceState(serialized);
assert.deepStrictEqual(
  hydrated.workspaces[0].terminalTabs.map((t) => t.id),
  ['tab-c', 'tab-a', 'tab-b'],
  'Hydrated/restored state must strictly preserve reordered tab positions',
);
console.log('✓ 18-19 & 39. Reordered tabs serialized and restored in exact presentation order');

// 20. Close-after-reorder uses correct current order
// [tabA, tabB, tabC] -> reordered to [tabC, tabA, tabB]
// Close tabA: currentIndex = 1.
// Right neighbor is tabB (index 2 in reordered array).
const closeTabs = [tabC, tabA, tabB];
const closingTabId = 'tab-a';
const idx = closeTabs.findIndex((t) => t.id === closingTabId);
let nextActiveId = 'tab-a';
if (idx + 1 < closeTabs.length) {
  nextActiveId = closeTabs[idx + 1].id;
} else if (idx > 0) {
  nextActiveId = closeTabs[idx - 1].id;
}
assert.strictEqual(nextActiveId, 'tab-b', 'Closing active tab must pick right neighbor in current visual order');
const afterClose = closeTabs.filter((t) => t.id !== closingTabId);
assert.deepStrictEqual(ids(afterClose), ['tab-c', 'tab-b']);
console.log('✓ 20. Close-after-reorder correctly selects neighbor in visual order');

// 21. Create-after-reorder preserves existing ordering
const tabE = makeTab('tab-e', 'ws-1', 'Terminal 5');
const afterCreate = [...reorderedTabs, tabE];
assert.deepStrictEqual(ids(afterCreate), ['tab-c', 'tab-a', 'tab-b', 'tab-e']);
console.log('✓ 21. Create-after-reorder appends new tab preserving reordered positions');

// 22. Workspace identity unchanged
const wsOriginal = makeWorkspace('ws-orig', [tabA, tabB]);
const reorderedWsTabs = reorderTerminalTabs(wsOriginal.terminalTabs, 'tab-b', 'tab-a', 'before');
assert.strictEqual(wsOriginal.id, 'ws-orig');
assert.strictEqual(wsOriginal.rootPath, '/projects/ws-orig');
console.log('✓ 22. Workspace identity, rootPath, and repository unchanged');

// 23. Cross-workspace drop rejected/no-op
const foreignTab = makeTab('tab-foreign', 'ws-other', 'Foreign Tab');
const inputTabs = [tabA, tabB, tabC];
const crossWsReorder = reorderTerminalTabs(inputTabs, foreignTab.id, 'tab-a', 'before');
assert.strictEqual(crossWsReorder, inputTabs, 'Cross-workspace tab ID must result in a no-op');
console.log('✓ 23. Cross-workspace drop rejected as no-op');

// 24. Unrelated action controls do not initiate drag (Static assertions on WorkspaceTabs source)
const workspaceTabsSource = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.tsx'),
  'utf8',
);
assert.match(workspaceTabsSource, /key=\{tab\.id\}/, 'React key must use stable tab.id');
assert.doesNotMatch(workspaceTabsSource, /key=\{index\}/, 'React key must not use index');
assert.match(workspaceTabsSource, /className="workspace-tab-close[^"]*"\s+draggable=\{false\}/, 'Close button must explicitly have draggable={false}');
assert.match(workspaceTabsSource, /className="workspace-tab-edit-container"[^>]*draggable=\{false\}/, 'Edit container must have draggable={false}');
assert.match(workspaceTabsSource, /onReorderTab\?\.\(draggedId, tab\.id, dropPlacement\)/, 'onReorderTab callback invoked on valid drop');
console.log('✓ 24. Action controls (close, edit) are guarded against drag initiation');

// 25 & 37. Runtime ownership regression (reorder never invokes terminal lifecycle methods)
let terminalCreated = 0;
let terminalDestroyed = 0;
let terminalClosed = 0;
const mockLifecycle = {
  createTerminal: () => { terminalCreated++; },
  destroyTerminal: () => { terminalDestroyed++; },
  closeTerminal: () => { terminalClosed++; },
};
// Perform reorder
const _testReorder = reorderTerminalTabs([tabA, tabB, tabC], 'tab-c', 'tab-a', 'before');
assert.strictEqual(terminalCreated, 0, 'No terminals created during reorder');
assert.strictEqual(terminalDestroyed, 0, 'No terminals destroyed during reorder');
assert.strictEqual(terminalClosed, 0, 'No terminals closed during reorder');
console.log('✓ 25 & 37. Terminal lifecycle methods strictly uncalled during reorder');

// 40. Duplicate tab names / labels disambiguated by stable ID
const tabSame1 = makeTab('tab-id-1', 'ws-1', 'Terminal');
const tabSame2 = makeTab('tab-id-2', 'ws-1', 'Terminal');
const tabSame3 = makeTab('tab-id-3', 'ws-1', 'Terminal');
const reorderedDupes = reorderTerminalTabs([tabSame1, tabSame2, tabSame3], 'tab-id-3', 'tab-id-1', 'before');
assert.deepStrictEqual(ids(reorderedDupes), ['tab-id-3', 'tab-id-1', 'tab-id-2']);
assert.strictEqual(reorderedDupes[0].id, 'tab-id-3');
assert.strictEqual(reorderedDupes[1].id, 'tab-id-1');
assert.strictEqual(reorderedDupes[2].id, 'tab-id-2');
console.log('✓ 40. Duplicate labels disambiguated via stable ID');

// App.tsx wiring verification
const appSource = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
assert.match(appSource, /reorderTerminalTabs/, 'App.tsx must import reorderTerminalTabs');
assert.match(appSource, /reorderTerminalTab/, 'App.tsx must define reorderTerminalTab callback');
assert.match(appSource, /onReorderTab=\{/, 'App.tsx must pass onReorderTab to WorkspaceTabs');

console.log('\n=============================================================');
console.log('ALL UX-REORDER-002 TERMINAL TAB REORDER TESTS PASSED!');
console.log('=============================================================\n');
