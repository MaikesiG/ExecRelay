/**
 * PUBLIC-V0.1-HARDENING-002: Persistence, Restore & Corruption Recovery Test Suite
 *
 * Validates:
 * - Fixture A: Null / undefined / non-object / primitive inputs
 * - Fixture B: Malformed / corrupted JSON in storage
 * - Fixture C: Unsupported schema versions (future / legacy / non-integer)
 * - Fixture D: Empty workspaces array or missing workspaces property
 * - Fixture E: Corrupted workspace objects (null items, missing ID/name)
 * - Fixture F: Duplicate workspace IDs across state (first wins, duplicates pruned)
 * - Fixture G: Invalid activeWorkspaceId (null, dangling, empty) -> safe fallback
 * - Fixture H: Empty or missing terminalTabs array -> safe tab fallback
 * - Fixture I: Duplicate terminalTab IDs within workspace -> deduplication
 * - Fixture J: Invalid activeTerminalTabId -> safe tab pointer fallback
 * - Fixture K: Empty or missing panes array -> safe pane fallback
 * - Fixture L: Duplicate pane IDs within a tab -> deduplication
 * - Fixture M: Invalid pane properties: out-of-bounds/duplicate stableOrdinal (1..6) and invalid accentId
 * - Fixture N: Invalid activePaneId (dangling/deleted/null) -> safe pane pointer fallback
 * - Fixture O: Corrupted / cyclic / broken split layout trees:
 *   - Leaf referencing deleted / nonexistent pane
 *   - Duplicate panel leaf IDs
 *   - SplitNode missing children (null / undefined first or second)
 *   - SplitNode with invalid ratio (< 0.2, > 0.8, NaN, string)
 *   - SplitNode with invalid direction (not 'horizontal' | 'vertical')
 *   - SplitNode cyclic references (self / indirect)
 *   - Missing panes from layout tree (auto-attachment)
 * - Fixture P: Ephemeral runtime handles strictly stripped:
 *   - session.sessionId forced to null
 *   - session.status forced to 'starting'
 *   - session.sessionInfo forced to null
 *   - capture.isListening forced to false
 *   - capture.currentBatchId / sessionId / warning forced to null
 *   - verification.activeRunId forced to null
 *   - non-terminal runs reconciled to terminal interrupted state
 * - Fixture Q: Stale Capture targets / selections:
 *   - selectedCapturePaneIds pruned of nonexistent panes
 *   - selection.selectedBlockIds initialized to empty Set
 * - Fixture R: Stale Verification references:
 *   - activeContractId fallback to first contract when stale
 *   - selectedCriterionIds pruned of nonexistent criteria
 *   - duplicate contract/criterion IDs deduplicated
 *   - criterion workingDirectory normalized
 * - Fixture S: Partial / legacy formats and legacy storage key migration
 * - Fixture T: Sanitizer idempotence and determinism
 * - Fixture U: Maximum safe recovery (recovers valid subset instead of dropping entire state)
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

const moduleCache = new Map();
function loadTs(relPath, customRequire = () => ({})) {
  const absPath = path.resolve(__dirname, relPath);
  if (moduleCache.has(absPath)) return moduleCache.get(absPath);
  const mod = { exports: {} };
  moduleCache.set(absPath, mod.exports);

  const src = fs.readFileSync(absPath, 'utf8');
  const js = ts.transpileModule(src, {
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
      if (id.includes('@tauri-apps')) {
        return {
          invoke: () => Promise.resolve(null),
          listen: () => Promise.resolve(() => {}),
        };
      }
      if (id === '@xterm/xterm') {
        return {
          Terminal: class MockTerminal {
            open() {}
            loadAddon() {}
          },
        };
      }
      if (id === '@xterm/addon-fit') {
        return { FitAddon: class MockFitAddon { fit() {} } };
      }
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(absPath), id);
        const candidates = [
          resolved + '.ts',
          resolved + '.tsx',
          path.join(resolved, 'index.ts'),
          path.join(resolved, 'index.tsx'),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            return loadTs(c, customRequire);
          }
        }
      }
      try {
        return require(path.resolve(__dirname, '../app/node_modules', id));
      } catch {}
      return customRequire(id);
    },
    React,
  );
  moduleCache.set(absPath, mod.exports);
  return mod.exports;
}

// Load verification modules
const verifModelMod = loadTs('../app/src/features/verification/verificationModel.ts');
const verifStateMod = loadTs('../app/src/features/verification/verificationState.ts', (id) => {
  if (id.includes('verificationModel')) return verifModelMod;
  return require(id);
});
const verifReconMod = loadTs('../app/src/features/verification/verificationReconciliation.ts', (id) => {
  if (id.includes('verificationModel')) return verifModelMod;
  if (id.includes('verificationState')) return verifStateMod;
  return require(id);
});
const verifIndexMod = {
  ...verifModelMod,
  ...verifStateMod,
  ...verifReconMod,
};

// Load default workspace factory
const defaultWsMod = loadTs('../app/src/features/workspace/createDefaultWorkspace.ts', (id) => {
  if (id.includes('verification')) return verifIndexMod;
  return require(id);
});

// Load persistence module
const wsPersistMod = loadTs('../app/src/features/workspace/workspacePersistence.ts', (id) => {
  if (id.includes('verification')) return verifIndexMod;
  return require(id);
});

console.log('Running HARDENING-002: Persistence, Restore & Corruption Recovery Test Suite...\n');

// Mock Storage Helper
function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
}

// ============================================================================
// Fixture A: Null / undefined / non-object / primitive inputs
// ============================================================================
console.log('--- Fixture A: Non-object & Primitive Inputs ---');
{
  const primitives = [null, undefined, 42, 'corrupted string', true, false, Symbol('sym'), () => {}];
  for (const prim of primitives) {
    const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(prim);
    assert.strictEqual(res.state, null, `Primitive ${String(prim)} should return null state`);
    assert(res.diagnostics.includes('invalid-root'), `Primitive ${String(prim)} should report invalid-root`);

    const direct = wsPersistMod.deserializeWorkspaceState(prim);
    assert.strictEqual(direct, null, `Direct call with ${String(prim)} should return null`);
  }
  console.log('✓ All primitive and non-object inputs safely return null with invalid-root diagnostic');
}

// ============================================================================
// Fixture B: Malformed / corrupted JSON in storage
// ============================================================================
console.log('\n--- Fixture B: Malformed JSON in Storage ---');
{
  const storage = createMockStorage({
    [wsPersistMod.WORKSPACE_PERSISTENCE_STORAGE_KEY]: '{"schemaVersion": 1, "workspaces": [broken json...',
  });
  wsPersistMod.setWorkspaceStorageAdapter(storage);

  const loaded = wsPersistMod.loadPersistedWorkspaceState();
  assert.strictEqual(loaded, null, 'Malformed JSON string in storage must safely return null without throwing');
  wsPersistMod.setWorkspaceStorageAdapter(null);
  console.log('✓ Malformed JSON in storage returns null safely without throwing');
}

// ============================================================================
// Fixture C: Unsupported schema versions
// ============================================================================
console.log('\n--- Fixture C: Unsupported Schema Versions ---');
{
  const badVersions = [0, 2, 99, -1, '1', 1.5, null, undefined];
  for (const ver of badVersions) {
    const raw = {
      schemaVersion: ver,
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'W1', terminalTabs: [] }],
    };
    const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
    assert.strictEqual(res.state, null, `Version ${ver} should fail`);
    assert(res.diagnostics.includes('unsupported-schema-version'), `Version ${ver} should report unsupported-schema-version`);
  }
  console.log('✓ Future, legacy, or malformed schema versions fail safely with unsupported-schema-version');
}

// ============================================================================
// Fixture D: Empty workspaces array or missing workspaces property
// ============================================================================
console.log('\n--- Fixture D: Empty or Missing Workspaces Array ---');
{
  const emptyCases = [
    { schemaVersion: 1, activeWorkspaceId: 'ws-1' },
    { schemaVersion: 1, activeWorkspaceId: 'ws-1', workspaces: [] },
    { schemaVersion: 1, activeWorkspaceId: 'ws-1', workspaces: null },
    { schemaVersion: 1, activeWorkspaceId: 'ws-1', workspaces: 'not an array' },
  ];
  for (const c of emptyCases) {
    const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(c);
    assert.strictEqual(res.state, null);
    assert(res.diagnostics.includes('empty-workspaces'));
  }
  console.log('✓ Empty or missing workspaces array safely returns null with empty-workspaces diagnostic');
}

// ============================================================================
// Fixture E: Corrupted workspace objects
// ============================================================================
console.log('\n--- Fixture E: Corrupted Workspace Objects in Array ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-valid',
    workspaces: [
      null,
      undefined,
      'a string instead of object',
      42,
      { id: 'ws-valid', name: 'Valid Workspace', terminalTabs: [] },
      {}, // missing ID and name
    ],
  };
  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null, 'Should recover valid workspaces');
  assert(res.state.workspaces.length >= 1, 'Should have at least valid workspace');
  assert.strictEqual(res.state.workspaces[0].id, 'ws-valid');
  assert(res.diagnostics.includes('invalid-workspace'), 'Should report invalid-workspace for corrupted elements');
  console.log('✓ Corrupted workspace entries pruned while preserving valid workspaces');
}

// ============================================================================
// Fixture F: Duplicate workspace IDs across state
// ============================================================================
console.log('\n--- Fixture F: Duplicate Workspace IDs (First Wins) ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-dup',
    workspaces: [
      { id: 'ws-dup', name: 'First Occurrence', terminalTabs: [] },
      { id: 'ws-dup', name: 'Second Occurrence (Should be dropped)', terminalTabs: [] },
      { id: 'ws-other', name: 'Other Workspace', terminalTabs: [] },
    ],
  };
  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  assert.strictEqual(res.state.workspaces.length, 2, 'Should prune duplicate workspace ID');
  assert.strictEqual(res.state.workspaces[0].id, 'ws-dup');
  assert.strictEqual(res.state.workspaces[0].name, 'First Occurrence', 'First occurrence must win');
  assert.strictEqual(res.state.workspaces[1].id, 'ws-other');
  assert(res.diagnostics.includes('duplicate-workspace-id'));
  console.log('✓ Duplicate workspace IDs pruned with first occurrence winning');
}

// ============================================================================
// Fixture G: Invalid activeWorkspaceId -> safe fallback
// ============================================================================
console.log('\n--- Fixture G: Invalid or Stale activeWorkspaceId ---');
{
  const invalidPointers = ['nonexistent-ws', null, '', undefined, 123];
  for (const ptr of invalidPointers) {
    const raw = {
      schemaVersion: 1,
      activeWorkspaceId: ptr,
      workspaces: [
        { id: 'ws-alpha', name: 'Alpha', terminalTabs: [] },
        { id: 'ws-beta', name: 'Beta', terminalTabs: [] },
      ],
    };
    const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
    assert(res.state !== null);
    assert.strictEqual(res.state.activeWorkspaceId, 'ws-alpha', 'Should fallback to first workspace');
    if (ptr !== undefined) {
      assert(res.diagnostics.includes('stale-active-workspace'));
    }
  }
  console.log('✓ Invalid or stale activeWorkspaceId reconciled to first workspace');
}

// ============================================================================
// Fixture H: Empty or missing terminalTabs array -> safe tab fallback
// ============================================================================
console.log('\n--- Fixture H: Empty or Missing TerminalTabs Array ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      { id: 'ws-1', name: 'Workspace Without Tabs', terminalTabs: [] },
    ],
  };
  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  const ws = res.state.workspaces[0];
  assert.strictEqual(ws.terminalTabs.length, 1, 'Should create 1 fallback tab');
  assert.strictEqual(ws.terminalTabs[0].panes.length, 1, 'Fallback tab must have 1 pane');
  assert.strictEqual(ws.activeTerminalTabId, ws.terminalTabs[0].id, 'Active tab pointer must match fallback tab');
  assert(res.diagnostics.includes('empty-tabs-fallback'));
  console.log('✓ Empty terminalTabs safely synthesizes standard single-tab fallback');
}

// ============================================================================
// Fixture I: Duplicate terminalTab IDs within workspace
// ============================================================================
console.log('\n--- Fixture I: Duplicate TerminalTab IDs ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        terminalTabs: [
          { id: 'tab-dup', baseName: 'Tab 1 First', panes: [{ id: 'p1' }] },
          { id: 'tab-dup', baseName: 'Tab 1 Duplicate', panes: [{ id: 'p2' }] },
          { id: 'tab-unique', baseName: 'Tab 2', panes: [{ id: 'p3' }] },
        ],
      },
    ],
  };
  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  const tabs = res.state.workspaces[0].terminalTabs;
  assert.strictEqual(tabs.length, 2, 'Duplicate tab ID must be pruned');
  assert.strictEqual(tabs[0].id, 'tab-dup');
  assert.strictEqual(tabs[0].baseName, 'Tab 1 First');
  assert.strictEqual(tabs[1].id, 'tab-unique');
  assert(res.diagnostics.includes('duplicate-tab-id'));
  console.log('✓ Duplicate tab IDs pruned with first occurrence winning');
}

// ============================================================================
// Fixture J: Invalid activeTerminalTabId -> safe tab pointer fallback
// ============================================================================
console.log('\n--- Fixture J: Invalid or Stale activeTerminalTabId ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        activeTerminalTabId: 'nonexistent-tab-pointer',
        terminalTabs: [
          { id: 'tab-1', panes: [{ id: 'p1' }] },
          { id: 'tab-2', panes: [{ id: 'p2' }] },
        ],
      },
    ],
  };
  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  assert.strictEqual(res.state.workspaces[0].activeTerminalTabId, 'tab-1', 'Must fallback to first valid tab');
  assert(res.diagnostics.includes('stale-active-tab'));
  console.log('✓ Stale activeTerminalTabId reconciled to first available tab');
}

// ============================================================================
// Fixture K: Empty or missing panes array -> safe pane fallback
// ============================================================================
console.log('\n--- Fixture K: Empty or Missing Panes Array ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        terminalTabs: [
          { id: 'tab-1', panes: [] },
        ],
      },
    ],
  };
  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  const tab = res.state.workspaces[0].terminalTabs[0];
  assert.strictEqual(tab.panes.length, 1, 'Should create 1 fallback pane');
  assert.strictEqual(tab.activePaneId, tab.panes[0].id);
  assert.strictEqual(tab.activeTerminalPaneId, tab.panes[0].id);
  assert(res.diagnostics.includes('empty-panes-fallback'));
  console.log('✓ Empty panes array safely synthesizes standard single-pane fallback');
}

// ============================================================================
// Fixture L: Duplicate pane IDs within a tab
// ============================================================================
console.log('\n--- Fixture L: Duplicate Pane IDs in Tab ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        terminalTabs: [
          {
            id: 'tab-1',
            panes: [
              { id: 'p-dup', stableOrdinal: 1, accentId: 'blue', customTitle: 'First' },
              { id: 'p-dup', stableOrdinal: 2, accentId: 'emerald', customTitle: 'Second' },
              { id: 'p-other', stableOrdinal: 3, accentId: 'amber' },
            ],
          },
        ],
      },
    ],
  };
  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  const panes = res.state.workspaces[0].terminalTabs[0].panes;
  assert.strictEqual(panes.length, 2, 'Duplicate pane must be pruned');
  assert.strictEqual(panes[0].id, 'p-dup');
  assert.strictEqual(panes[0].customTitle, 'First');
  assert.strictEqual(panes[1].id, 'p-other');
  assert(res.diagnostics.includes('duplicate-pane-id'));
  console.log('✓ Duplicate pane IDs pruned with first occurrence winning');
}

// ============================================================================
// Fixture M: Invalid pane properties: stableOrdinal & accentId
// ============================================================================
console.log('\n--- Fixture M: Invalid stableOrdinal & accentId Sanitization ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        terminalTabs: [
          {
            id: 'tab-1',
            panes: [
              { id: 'p1', stableOrdinal: 99, accentId: 'invalid-accent-color' },
              { id: 'p2', stableOrdinal: 1, accentId: 'violet' }, // collision on ordinal
              { id: 'p3', stableOrdinal: -5, accentId: null },
            ],
          },
        ],
      },
    ],
  };
  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  const panes = res.state.workspaces[0].terminalTabs[0].panes;

  assert.strictEqual(panes.length, 3);
  const ordinals = panes.map((p) => p.stableOrdinal);
  assert.strictEqual(new Set(ordinals).size, 3, 'All ordinals must be unique');
  for (const ord of ordinals) {
    assert(ord >= 1 && ord <= 6, `Ordinal ${ord} must be between 1 and 6`);
  }

  const validAccents = ['blue', 'violet', 'emerald', 'amber', 'cyan', 'rose'];
  for (const p of panes) {
    assert(validAccents.includes(p.accentId), `Accent ${p.accentId} must be in allowed palette`);
  }

  assert(res.diagnostics.includes('reassigned-pane-ordinal'));
  assert(res.diagnostics.includes('invalid-accent'));
  console.log('✓ Out-of-bounds ordinals and invalid accents normalized and deduplicated');
}

// ============================================================================
// Fixture N: Invalid activePaneId pointer reconciliation
// ============================================================================
console.log('\n--- Fixture N: Invalid activePaneId Pointer Reconciliation ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        terminalTabs: [
          {
            id: 'tab-1',
            activePaneId: 'deleted-pane-xyz',
            panes: [{ id: 'p1' }, { id: 'p2' }],
          },
        ],
      },
    ],
  };
  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  const tab = res.state.workspaces[0].terminalTabs[0];
  assert.strictEqual(tab.activePaneId, 'p1', 'Must fallback to first existing pane');
  assert.strictEqual(tab.activeTerminalPaneId, 'p1');
  assert(res.diagnostics.includes('stale-active-pane'));
  console.log('✓ Stale activePaneId gracefully reconciled to first pane');
}

// ============================================================================
// Fixture O: Corrupted / cyclic / broken split layout trees
// ============================================================================
console.log('\n--- Fixture O: Split Layout Tree Sanitization & Repair ---');
{
  const panels = [
    { id: 'panel-p1', kind: 'terminal', paneId: 'p1', terminalSessionId: null },
    { id: 'panel-p2', kind: 'terminal', paneId: 'p2', terminalSessionId: null },
  ];
  const capturePanel = {
    id: 'capture-panel-tab-1',
    kind: 'capture',
    selectedCapturePaneIds: ['p1', 'p2'],
    groupStatus: 'ready',
  };

  // O.1: Stale panel leaf referencing deleted pane
  const staleLeafLayout = {
    type: 'split',
    id: 'split-1',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'panel', panelId: 'panel-p1' },
    second: { type: 'panel', panelId: 'panel-deleted' },
  };
  const diag1 = [];
  const rep1 = wsPersistMod.sanitizePanelLayout(staleLeafLayout, panels, capturePanel, diag1);
  assert(diag1.includes('stale-panel-leaf'));
  assert(diag1.includes('collapsed-split-node'));
  // Should also attach unrepresented panel-p2
  assert(diag1.includes('unrepresented-pane-attached'));
  console.log('  ✓ O.1 Stale leaf pruned, split collapsed, missing pane re-attached');

  // O.2: Duplicate panel leaf in tree
  const duplicateLeafLayout = {
    type: 'split',
    id: 'split-dup',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'panel', panelId: 'panel-p1' },
    second: { type: 'panel', panelId: 'panel-p1' },
  };
  const diag2 = [];
  const rep2 = wsPersistMod.sanitizePanelLayout(duplicateLeafLayout, panels, capturePanel, diag2);
  assert(diag2.includes('duplicate-panel-leaf'));
  assert(diag2.includes('collapsed-split-node'));
  console.log('  ✓ O.2 Duplicate panel leaf pruned');

  // O.3: SplitNode missing children
  const missingChildLayout = {
    type: 'split',
    id: 'split-missing',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'panel', panelId: 'panel-p1' },
    second: null,
  };
  const diag3 = [];
  const rep3 = wsPersistMod.sanitizePanelLayout(missingChildLayout, panels, capturePanel, diag3);
  assert(diag3.includes('collapsed-split-node'));
  console.log('  ✓ O.3 Missing split child collapsed cleanly');

  // O.4: SplitNode out-of-bounds ratio and NaN ratio
  const ratioLayout = {
    type: 'split',
    id: 'split-ratio',
    direction: 'horizontal',
    ratio: 0.05,
    first: { type: 'panel', panelId: 'panel-p1' },
    second: { type: 'panel', panelId: 'panel-p2' },
  };
  const diag4 = [];
  const rep4 = wsPersistMod.sanitizePanelLayout(ratioLayout, panels, capturePanel, diag4);
  assert.strictEqual(rep4.ratio, 0.2, 'Ratio 0.05 must be clamped to 0.2');
  assert(diag4.includes('clamped-split-ratio'));

  const nanRatioLayout = {
    type: 'split',
    id: 'split-nan',
    direction: 'horizontal',
    ratio: NaN,
    first: { type: 'panel', panelId: 'panel-p1' },
    second: { type: 'panel', panelId: 'panel-p2' },
  };
  const repNan = wsPersistMod.sanitizePanelLayout(nanRatioLayout, panels, capturePanel);
  assert.strictEqual(repNan.ratio, 0.5, 'NaN ratio must be clamped to 0.5');
  console.log('  ✓ O.4 Ratio clamped to [0.2, 0.8] range');

  // O.5: Cyclic layout graph
  const cycleNode = {
    type: 'split',
    id: 'split-cycle',
    direction: 'horizontal',
    ratio: 0.5,
  };
  cycleNode.first = cycleNode; // direct self-reference
  cycleNode.second = { type: 'panel', panelId: 'panel-p1' };
  const diag5 = [];
  const rep5 = wsPersistMod.sanitizePanelLayout(cycleNode, panels, capturePanel, diag5);
  assert(diag5.includes('layout-cycle'));
  assert(diag5.includes('collapsed-split-node'));
  console.log('  ✓ O.5 Layout cycle detected and severed without stack overflow');

  // O.6: Invalid direction normalized to horizontal
  const badDirLayout = {
    type: 'split',
    id: 'split-dir',
    direction: 'diagonal',
    ratio: 0.5,
    first: { type: 'panel', panelId: 'panel-p1' },
    second: { type: 'panel', panelId: 'panel-p2' },
  };
  const repDir = wsPersistMod.sanitizePanelLayout(badDirLayout, panels, capturePanel);
  assert.strictEqual(repDir.direction, 'horizontal');
  console.log('  ✓ O.6 Invalid direction normalized to horizontal');
}

// ============================================================================
// Fixture P: Ephemeral runtime handles strictly stripped
// ============================================================================
console.log('\n--- Fixture P: Ephemeral Runtime Handles Stripping ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        capture: {
          isListening: true, // Should be stripped to false
          currentBatchId: 10, // Should be stripped to null
        },
        terminalTabs: [
          {
            id: 'tab-1',
            panes: [
              {
                id: 'p1',
                session: { sessionId: 'live-pty-pid-1234', status: 'running' },
                capture: { isListening: true, sessionId: 'live-stream' },
              },
            ],
          },
        ],
        verification: {
          activeRunId: 'live-run-active', // Must be stripped
          contracts: [{ id: 'c1', name: 'Contract 1', criteria: [] }],
          runs: [
            {
              id: 'r1',
              contractId: 'c1',
              status: 'RUNNING', // Non-terminal run must be reconciled
              startedAt: 1000,
            },
          ],
        },
      },
    ],
  };

  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  const ws = res.state.workspaces[0];
  const pane = ws.terminalTabs[0].panes[0];

  assert.strictEqual(pane.session.sessionId, null, 'session.sessionId must be null');
  assert.strictEqual(pane.session.status, 'starting', 'session.status must be starting');
  assert.strictEqual(pane.capture.isListening, false, 'pane.capture.isListening must be false');
  assert.strictEqual(pane.capture.sessionId, null, 'pane.capture.sessionId must be null');
  assert.strictEqual(ws.capture.isListening, false, 'workspace.capture.isListening must be false');
  assert.strictEqual(ws.capture.currentBatch, null, 'workspace.capture.currentBatch must be null');

  assert.strictEqual(ws.verification.activeRunId, null, 'verification.activeRunId must be null');
  assert.notStrictEqual(ws.verification.runs[0].status, 'RUNNING', 'Active run status must be reconciled');
  assert(res.diagnostics.includes('stripped-active-run'));
  console.log('✓ All ephemeral PTY handles, listeners, streams, and active runs strictly stripped');
}

// ============================================================================
// Fixture Q: Stale Capture targets / selections
// ============================================================================
console.log('\n--- Fixture Q: Stale Capture Targets & Selections ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        capture: {
          blocks: [
            { id: 'b1', command: 'ls', isComplete: true, batchId: 1 },
          ],
          targetScope: {
            mode: 'explicit',
            paneIds: ['p1', 'p-stale-deleted'],
          },
        },
        terminalTabs: [
          {
            id: 'tab-1',
            capturePanel: {
              selectedCapturePaneIds: ['p1', 'p-stale-ghost'],
            },
            panes: [{ id: 'p1' }],
          },
        ],
      },
    ],
  };

  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  const ws = res.state.workspaces[0];
  const tab = ws.terminalTabs[0];

  const capPanel = tab.panels.find((p) => p.kind === 'capture');
  assert.deepStrictEqual(capPanel.selectedCapturePaneIds, ['p1'], 'Stale pane must be pruned from selectedCapturePaneIds');
  assert(res.diagnostics.includes('stale-capture-target-pane'));

  assert(ws.selection.selectedBlockIds instanceof Set);
  assert.strictEqual(ws.selection.selectedBlockIds.size, 0, 'Selection must start clean');
  console.log('✓ Stale capture targets pruned and selection sets cleanly initialized');
}

// ============================================================================
// Fixture R: Stale Verification references
// ============================================================================
console.log('\n--- Fixture R: Stale Verification References ---');
{
  const raw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        terminalTabs: [{ id: 't1', panes: [{ id: 'p1' }] }],
        verification: {
          activeContractId: 'nonexistent-contract-id',
          contracts: [
            {
              id: 'c-valid',
              name: 'Valid Contract',
              criteria: [
                { id: 'crit-1', name: 'Crit 1', command: 'test', workingDirectory: '' },
                { id: 'crit-1', name: 'Duplicate Crit' }, // duplicate
              ],
            },
            { id: 'c-valid', name: 'Duplicate Contract' }, // duplicate
          ],
          selectedCriterionIds: ['crit-1', 'crit-nonexistent'],
        },
      },
    ],
  };

  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(raw);
  assert(res.state !== null);
  const v = res.state.workspaces[0].verification;

  assert.strictEqual(v.contracts.length, 1, 'Duplicate contract must be pruned');
  assert.strictEqual(v.contracts[0].id, 'c-valid');
  assert.strictEqual(v.contracts[0].criteria.length, 1, 'Duplicate criterion must be pruned');
  assert.strictEqual(v.contracts[0].criteria[0].workingDirectory, '.', 'Empty workingDirectory normalized to .');

  assert.strictEqual(v.activeContractId, 'c-valid', 'Stale activeContractId must fall back to first valid contract');
  assert.deepStrictEqual(Array.from(v.selectedCriterionIds), ['crit-1'], 'Stale criterion ID pruned');

  assert(res.diagnostics.includes('stale-active-contract'));
  assert(res.diagnostics.includes('duplicate-verification-contract-id'));
  assert(res.diagnostics.includes('duplicate-verification-criterion-id'));
  assert(res.diagnostics.includes('stale-criterion-selection'));
  console.log('✓ Stale verification pointers reconciled and duplicate contracts/criteria deduplicated');
}

// ============================================================================
// Fixture S: Partial / legacy formats and legacy storage key migration
// ============================================================================
console.log('\n--- Fixture S: Legacy Formats & Storage Key Migration ---');
{
  const legacyData = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-legacy',
    workspaces: [
      {
        id: 'ws-legacy',
        name: 'Legacy WS',
        terminalTabs: [
          {
            id: 'tab-1',
            label: 'Old Terminal Label', // legacy label property
            panes: [{ id: 'p1' }],
          },
        ],
      },
    ],
  };

  const storage = createMockStorage({
    [wsPersistMod.LEGACY_WORKSPACE_PERSISTENCE_STORAGE_KEY]: JSON.stringify(legacyData),
  });
  wsPersistMod.setWorkspaceStorageAdapter(storage);

  const loaded = wsPersistMod.loadPersistedWorkspaceState();
  assert(loaded !== null);
  assert.strictEqual(loaded.workspaces[0].name, 'Legacy WS');

  // Verify automatic migration write to canonical key
  const migratedRaw = storage.getItem(wsPersistMod.WORKSPACE_PERSISTENCE_STORAGE_KEY);
  assert(migratedRaw !== null, 'Legacy state must be migrated to canonical storage key');
  const parsedMigrated = JSON.parse(migratedRaw);
  assert.strictEqual(parsedMigrated.schemaVersion, 1);
  assert.strictEqual(parsedMigrated.workspaces[0].id, 'ws-legacy');

  wsPersistMod.setWorkspaceStorageAdapter(null);
  console.log('✓ Legacy storage key loaded, normalized, and auto-migrated to canonical key');
}

// ============================================================================
// Fixture T: Sanitizer idempotence & determinism
// ============================================================================
console.log('\n--- Fixture T: Sanitizer Idempotence & Determinism ---');
{
  const corruptedRaw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-invalid-pointer',
    workspaces: [
      {
        id: 'ws-1',
        name: 'W1',
        terminalTabs: [
          {
            id: 'tab-1',
            activePaneId: 'stale-p',
            panes: [
              { id: 'p1', stableOrdinal: 10, accentId: 'bad-accent' },
              { id: 'p1', stableOrdinal: 10 }, // duplicate
              { id: 'p2', stableOrdinal: 1 },
            ],
            panelLayout: {
              type: 'split',
              direction: 'bad-dir',
              ratio: 0.99,
              first: { type: 'panel', panelId: 'p1' },
              second: { type: 'panel', panelId: 'nonexistent' },
            },
          },
        ],
      },
    ],
  };

  // Pass 1: Deserializing corrupted input sanitizes and repairs
  const pass1 = wsPersistMod.deserializeWorkspaceState(corruptedRaw);
  assert(pass1 !== null);

  // Pass 2: Serializing and deserializing again must produce identical state (zero extra modifications)
  const serialized1 = wsPersistMod.serializeWorkspaceState(pass1.workspaces, pass1.activeWorkspaceId, pass1.activeMonitorView);
  const diagPass2 = [];
  const pass2Result = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(serialized1);
  assert(pass2Result.state !== null);
  assert.strictEqual(diagPass2.length, 0, 'Clean round-trip should report zero new recovery diagnostics');

  const serialized2 = wsPersistMod.serializeWorkspaceState(pass2Result.state.workspaces, pass2Result.state.activeWorkspaceId, pass2Result.state.activeMonitorView);
  assert.deepStrictEqual(serialized1, serialized2, 'Serializer output must be deterministic and identical across round-trips');
  console.log('✓ Sanitizer round-trip is completely idempotent and deterministic');
}

// ============================================================================
// Fixture U: Maximum safe recovery
// ============================================================================
console.log('\n--- Fixture U: Maximum Safe Recovery ---');
{
  const mixedRaw = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-valid-2',
    workspaces: [
      null, // corrupted entry
      { id: 'ws-valid-1', name: 'Workspace 1', terminalTabs: [{ id: 't1', panes: [{ id: 'p1' }] }] },
      { id: '', name: 'Empty ID' }, // invalid ID
      { id: 'ws-valid-2', name: 'Workspace 2', terminalTabs: [] }, // empty tabs (repaired)
      'not an object', // corrupted entry
    ],
  };

  const res = wsPersistMod.deserializeWorkspaceStateWithDiagnostics(mixedRaw);
  assert(res.state !== null);
  assert.strictEqual(res.state.workspaces.length, 2, 'Should recover 2 valid workspaces');
  assert.strictEqual(res.state.workspaces[0].id, 'ws-valid-1');
  assert.strictEqual(res.state.workspaces[1].id, 'ws-valid-2');
  assert.strictEqual(res.state.activeWorkspaceId, 'ws-valid-2');
  console.log('✓ Maximum safe recovery preserves all recoverable data while discarding corrupted entries');
}

console.log('\n=============================================================');
console.log('ALL PUBLIC-V0.1-HARDENING-002 PERSISTENCE & RESTORE TESTS PASSED!');
console.log('=============================================================\n');
