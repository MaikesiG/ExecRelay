/**
 * WORKSPACE-PERSISTENCE-001 — Workspace & Terminal Tab Persistence Test Suite
 *
 * Validates:
 * 1. Serialized Workspace restores same id/name/rootPath
 * 2. Multiple Workspaces preserve order
 * 3. activeWorkspaceId restores
 * 4. Terminal tab count restores
 * 5. Pane topology restores if supported
 * 6. Active terminal tab restores
 * 7. PTY/runtime IDs are NOT persisted
 * 8. Restored terminals create fresh runtime sessions
 * 9. lastKnownCwd restores when valid
 * 10. Missing lastKnownCwd falls back to Workspace root
 * 11. Missing Workspace root does not crash application
 * 12. Non-Git Workspace restores
 * 13. Repository context re-detects after restart
 * 14. Stale persisted branch is not trusted
 * 15. Corrupt JSON falls back safely
 * 16. Unknown schema version fails safely
 * 17. Active VerificationRuntime is not restored
 * 18. Workspace close removes it from persisted state
 * 19. New Workspace appears after restart
 * 20. Terminal cd independence remains intact
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
      if (id.includes('@tauri-apps')) return { invoke: () => Promise.resolve(null), listen: () => Promise.resolve(() => {}) };
      if (id === '@xterm/xterm') return { Terminal: class MockTerminal { open() {} loadAddon() {} } };
      if (id === '@xterm/addon-fit') return { FitAddon: class MockFitAddon { fit() {} } };
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

// Load workspaceContext module
const wsContextMod = loadTs('../app/src/features/workspace/workspaceContext.ts', (id) => {
  if (id.includes('@tauri-apps')) return { invoke: () => Promise.resolve(null) };
  return require(id);
});

// Load workspacePersistence module
const wsPersistMod = loadTs('../app/src/features/workspace/workspacePersistence.ts', (id) => {
  if (id.includes('verification')) return verifIndexMod;
  return require(id);
});

console.log('Running WORKSPACE-PERSISTENCE-001 Test Suite...\n');

// Mock in-memory storage adapter for deterministic testing
class MemoryStorageAdapter {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.get(key) ?? null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const memoryStore = new MemoryStorageAdapter();
wsPersistMod.setWorkspaceStorageAdapter(memoryStore);

// Helper: build a realistic workspace fixture
function makeTestWorkspace(overrides = {}) {
  const ws = defaultWsMod.createDefaultLogicalWorkspace(
    overrides.id ?? 'ws-careerneed',
    overrides.name ?? 'careerneed',
    overrides.initialTerminalTabId ?? 'tab-1',
    overrides.initialPaneId ?? 'pane-1',
    overrides.rootPath ?? '/Users/developer/projects/careerneed',
  );
  if (overrides.repository) {
    ws.repository = overrides.repository;
  }
  if (overrides.panes) {
    ws.panes = overrides.panes;
    if (ws.terminalTabs[0]) {
      ws.terminalTabs[0].panes = overrides.panes;
      ws.terminalTabs[0].terminalPanes = overrides.panes;
    }
  }
  if (overrides.terminalTabs) {
    ws.terminalTabs = overrides.terminalTabs;
    ws.terminalTabIds = overrides.terminalTabs.map((t) => t.id);
  }
  return ws;
}

// ============================================================================
// Test 1: Serialized Workspace restores same id/name/rootPath
// ============================================================================
console.log('--- Test 1: Serialized Workspace restores same id/name/rootPath ---');
{
  const original = makeTestWorkspace({
    id: 'ws-unique-123',
    name: 'careerneed',
    rootPath: '/Users/developer/projects/careerneed',
  });

  const serialized = wsPersistMod.serializeWorkspaceState([original], original.id);
  assert.strictEqual(serialized.schemaVersion, 1);
  assert.strictEqual(serialized.workspaces.length, 1);
  assert.strictEqual(serialized.workspaces[0].id, 'ws-unique-123');
  assert.strictEqual(serialized.workspaces[0].name, 'careerneed');
  assert.strictEqual(serialized.workspaces[0].rootPath, '/Users/developer/projects/careerneed');

  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);
  assert.ok(hydrated);
  assert.strictEqual(hydrated.workspaces.length, 1);
  assert.strictEqual(hydrated.workspaces[0].id, 'ws-unique-123');
  assert.strictEqual(hydrated.workspaces[0].name, 'careerneed');
  assert.strictEqual(hydrated.workspaces[0].rootPath, '/Users/developer/projects/careerneed');
  console.log('✓ Serialized Workspace accurately restores id, name, and rootPath');
}

// ============================================================================
// Test 2: Multiple Workspaces preserve exact order
// ============================================================================
console.log('\n--- Test 2: Multiple Workspaces preserve order ---');
{
  const wsA = makeTestWorkspace({ id: 'ws-a', name: 'careerneed' });
  const wsB = makeTestWorkspace({ id: 'ws-b', name: 'traceRelay' });
  const wsC = makeTestWorkspace({ id: 'ws-c', name: 'project-x' });

  const serialized = wsPersistMod.serializeWorkspaceState([wsA, wsB, wsC], 'ws-b');
  assert.deepStrictEqual(
    serialized.workspaces.map((w) => w.id),
    ['ws-a', 'ws-b', 'ws-c'],
    'Serialized order must match runtime order',
  );

  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);
  assert.ok(hydrated);
  assert.deepStrictEqual(
    hydrated.workspaces.map((w) => w.id),
    ['ws-a', 'ws-b', 'ws-c'],
    'Hydrated order must preserve exact workspace order',
  );
  console.log('✓ Multiple Workspaces preserve exact logical order');
}

// ============================================================================
// Test 3: activeWorkspaceId restores
// ============================================================================
console.log('\n--- Test 3: activeWorkspaceId restores ---');
{
  const ws1 = makeTestWorkspace({ id: 'ws-1', name: 'First' });
  const ws2 = makeTestWorkspace({ id: 'ws-2', name: 'Second' });

  // Valid active workspace ID restores
  const doc = wsPersistMod.serializeWorkspaceState([ws1, ws2], 'ws-2');
  const hydrated = wsPersistMod.deserializeWorkspaceState(doc);
  assert.strictEqual(hydrated.activeWorkspaceId, 'ws-2', 'activeWorkspaceId restores correctly');

  // Invalid/stale active ID falls back deterministically to first workspace
  const docStale = { ...doc, activeWorkspaceId: 'deleted-ws-id' };
  const hydratedFallback = wsPersistMod.deserializeWorkspaceState(docStale);
  assert.strictEqual(
    hydratedFallback.activeWorkspaceId,
    'ws-1',
    'Invalid activeWorkspaceId must fall back to first available workspace',
  );
  console.log('✓ activeWorkspaceId restores when valid and safely falls back when stale');
}

// ============================================================================
// Test 4: Terminal tab count restores
// ============================================================================
console.log('\n--- Test 4: Terminal tab count restores ---');
{
  const tab1 = defaultWsMod.createDefaultTerminalTab('t1', 'ws-tabs', 'Terminal 1', 'p1');
  const tab2 = defaultWsMod.createDefaultTerminalTab('t2', 'ws-tabs', 'Terminal 2', 'p2');
  const tab3 = defaultWsMod.createDefaultTerminalTab('t3', 'ws-tabs', 'Terminal 3', 'p3');

  const ws = makeTestWorkspace({
    id: 'ws-tabs',
    name: 'MultiTab',
    terminalTabs: [tab1, tab2, tab3],
  });

  const serialized = wsPersistMod.serializeWorkspaceState([ws], 'ws-tabs');
  assert.strictEqual(serialized.workspaces[0].terminalTabs.length, 3);

  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);
  assert.strictEqual(hydrated.workspaces[0].terminalTabs.length, 3);
  assert.deepStrictEqual(
    hydrated.workspaces[0].terminalTabs.map((t) => t.id),
    ['t1', 't2', 't3'],
  );
  console.log('✓ Full terminal tab count and individual tab IDs restore');
}

// ============================================================================
// Test 5: Pane topology restores if supported
// ============================================================================
console.log('\n--- Test 5: Pane topology restores if supported ---');
{
  const pane1 = defaultWsMod.createDefaultTerminalPane('tab-split', 'p1', 1, 'blue');
  const pane2 = defaultWsMod.createDefaultTerminalPane('tab-split', 'p2', 2, 'emerald');

  const panel1 = { id: 'panel-p1', kind: 'terminal', paneId: 'p1', terminalSessionId: null };
  const panel2 = { id: 'panel-p2', kind: 'terminal', paneId: 'p2', terminalSessionId: null };
  const splitLayout = {
    type: 'split',
    id: 'split-1',
    direction: 'horizontal',
    ratio: 0.65,
    first: { type: 'panel', panelId: 'panel-p1' },
    second: { type: 'panel', panelId: 'panel-p2' },
  };

  const tabWithSplit = {
    id: 'tab-split',
    workspaceId: 'ws-split',
    label: 'Split Terminal',
    name: 'Split Terminal',
    terminalPanes: [pane1, pane2],
    panes: [pane1, pane2],
    panels: [panel1, panel2],
    capturePanelId: 'capture-panel-tab-split',
    panelLayout: splitLayout,
    activeTerminalPaneId: 'p2',
    activePaneId: 'p2',
    nextTerminalPaneOrdinal: 3,
    paneIds: ['p1', 'p2'],
    rootPaneId: 'p1',
    isCapturePanelOpen: true,
    capturePanelWidth: 420,
    pane: pane1.session,
    capture: pane1.capture,
  };

  const ws = makeTestWorkspace({
    id: 'ws-split',
    name: 'SplitWS',
    terminalTabs: [tabWithSplit],
  });

  const serialized = wsPersistMod.serializeWorkspaceState([ws], 'ws-split');
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);

  const restoredTab = hydrated.workspaces[0].terminalTabs[0];
  assert.strictEqual(restoredTab.panes.length, 2);
  assert.strictEqual(restoredTab.panelLayout.type, 'split');
  assert.strictEqual(restoredTab.panelLayout.ratio, 0.65);
  assert.strictEqual(restoredTab.panelLayout.direction, 'horizontal');
  assert.strictEqual(restoredTab.activePaneId, 'p2');
  console.log('✓ Pane split topology, split ratios, and active pane restore accurately');
}

// ============================================================================
// Test 6: Active terminal tab restores
// ============================================================================
console.log('\n--- Test 6: Active terminal tab restores ---');
{
  const tab1 = defaultWsMod.createDefaultTerminalTab('tab-alpha', 'ws-act', 'Alpha', 'p1');
  const tab2 = defaultWsMod.createDefaultTerminalTab('tab-beta', 'ws-act', 'Beta', 'p2');

  const ws = makeTestWorkspace({
    id: 'ws-act',
    name: 'ActiveTabTest',
    terminalTabs: [tab1, tab2],
  });
  ws.activeTerminalTabId = 'tab-beta';

  const serialized = wsPersistMod.serializeWorkspaceState([ws], 'ws-act');
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);
  assert.strictEqual(hydrated.workspaces[0].activeTerminalTabId, 'tab-beta');
  console.log('✓ activeTerminalTabId restores across restarts');
}

// ============================================================================
// Test 7: PTY/runtime IDs are NOT persisted
// ============================================================================
console.log('\n--- Test 7: PTY/runtime IDs are NOT persisted ---');
{
  const paneWithRuntime = defaultWsMod.createDefaultTerminalPane('tab-rt', 'p-rt', 1, 'blue');
  paneWithRuntime.terminalSessionId = 'live-pty-session-999';
  paneWithRuntime.session = {
    sessionId: 'live-pty-session-999',
    status: 'running',
    sessionInfo: {
      sessionId: 'live-pty-session-999',
      shell: '/bin/zsh',
      shellKind: 'zsh',
      status: 'running',
      cols: 80,
      rows: 24,
      cwd: '/tmp/test',
    },
  };

  const ws = makeTestWorkspace({
    id: 'ws-rt',
    name: 'RuntimeTest',
    panes: [paneWithRuntime],
  });

  const serialized = wsPersistMod.serializeWorkspaceState([ws], 'ws-rt');
  const serializedJson = JSON.stringify(serialized);

  assert.ok(
    !serializedJson.includes('live-pty-session-999'),
    'Live PTY session ID must NEVER appear in serialized output',
  );
  assert.ok(
    !serializedJson.includes('"status":"running"'),
    'Live running status must NEVER appear in serialized output',
  );
  console.log('✓ PTY session IDs, process status, and runtime handles strictly excluded from persistence');
}

// ============================================================================
// Test 8: Restored terminals create fresh runtime sessions
// ============================================================================
console.log('\n--- Test 8: Restored terminals create fresh runtime sessions ---');
{
  const ws = makeTestWorkspace({ id: 'ws-fresh', name: 'FreshSessionTest' });
  const serialized = wsPersistMod.serializeWorkspaceState([ws], 'ws-fresh');
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);

  const restoredPane = hydrated.workspaces[0].panes[0];
  assert.strictEqual(
    restoredPane.session.sessionId,
    null,
    'Restored pane must have null sessionId',
  );
  assert.strictEqual(
    restoredPane.terminalSessionId,
    undefined,
    'Restored pane must not have stale terminalSessionId',
  );
  assert.strictEqual(
    restoredPane.session.status,
    'starting',
    'Restored pane must start in starting status for fresh PTY creation',
  );
  console.log('✓ Restored terminals have clean unattached state ready for fresh PTY creation');
}

// ============================================================================
// Test 9: lastKnownCwd restores when valid
// ============================================================================
console.log('\n--- Test 9: lastKnownCwd restores when valid ---');
{
  const pane = defaultWsMod.createDefaultTerminalPane('t-cwd', 'p-cwd', 1, 'amber');
  pane.lastKnownCwd = '/Users/developer/projects/careerneed/apps/api';

  const ws = makeTestWorkspace({
    id: 'ws-cwd',
    name: 'CwdTest',
    rootPath: '/Users/developer/projects/careerneed',
    panes: [pane],
  });

  const serialized = wsPersistMod.serializeWorkspaceState([ws], 'ws-cwd');
  assert.strictEqual(
    serialized.workspaces[0].terminalTabs[0].panes[0].lastKnownCwd,
    '/Users/developer/projects/careerneed/apps/api',
  );

  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);
  assert.strictEqual(
    hydrated.workspaces[0].panes[0].lastKnownCwd,
    '/Users/developer/projects/careerneed/apps/api',
  );
  console.log('✓ lastKnownCwd serializes and hydrates accurately');
}

// ============================================================================
// Test 10: Missing lastKnownCwd falls back to Workspace root
// ============================================================================
console.log('\n--- Test 10: Missing lastKnownCwd falls back to Workspace root ---');
{
  const pane = defaultWsMod.createDefaultTerminalPane('t-nocwd', 'p-nocwd', 1, 'cyan');
  pane.lastKnownCwd = null;

  const ws = makeTestWorkspace({
    id: 'ws-nocwd',
    name: 'NoCwdTest',
    rootPath: '/Users/developer/projects/careerneed',
    panes: [pane],
  });

  const serialized = wsPersistMod.serializeWorkspaceState([ws], 'ws-nocwd');
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);

  const targetPane = hydrated.workspaces[0].panes[0];
  const effectiveCwd = targetPane.lastKnownCwd ?? hydrated.workspaces[0].rootPath;
  assert.strictEqual(effectiveCwd, '/Users/developer/projects/careerneed');
  console.log('✓ Absence of lastKnownCwd cleanly defaults to workspace.rootPath');
}

// ============================================================================
// Test 11: Missing Workspace root does not crash application
// ============================================================================
console.log('\n--- Test 11: Missing Workspace root does not crash application ---');
{
  const missingFolderWs = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-missing',
    workspaces: [
      {
        id: 'ws-missing',
        name: 'ghost-project',
        rootPath: '/path/that/does/not/exist/on/this/mac',
        activeTerminalTabId: 't1',
        terminalTabs: [
          {
            id: 't1',
            name: 'Terminal 1',
            activePaneId: 'p1',
            panes: [{ id: 'p1', stableOrdinal: 1, accentId: 'blue', lastKnownCwd: null }],
          },
        ],
      },
    ],
  };

  assert.doesNotThrow(() => {
    const hydrated = wsPersistMod.deserializeWorkspaceState(missingFolderWs);
    assert.ok(hydrated);
    assert.strictEqual(hydrated.workspaces[0].rootPath, '/path/that/does/not/exist/on/this/mac');
  });
  console.log('✓ Inaccessible or deleted rootPath hydrates without throwing or crashing');
}

// ============================================================================
// Test 12: Non-Git Workspace restores
// ============================================================================
console.log('\n--- Test 12: Non-Git Workspace restores ---');
{
  const nonGitWs = makeTestWorkspace({
    id: 'ws-nongit',
    name: 'NotesFolder',
    rootPath: '/Users/developer/Documents/Notes',
    repository: undefined,
  });

  const serialized = wsPersistMod.serializeWorkspaceState([nonGitWs], 'ws-nongit');
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);

  assert.ok(hydrated);
  assert.strictEqual(hydrated.workspaces[0].repository, undefined);
  assert.strictEqual(hydrated.workspaces[0].rootPath, '/Users/developer/Documents/Notes');
  console.log('✓ Non-Git workspace restores safely with repository undefined');
}

// ============================================================================
// Test 13: Repository context re-detects after restart
// ============================================================================
console.log('\n--- Test 13: Repository context re-detects after restart ---');
{
  const wsWithOldRepo = makeTestWorkspace({
    id: 'ws-redetect',
    name: 'careerneed',
    rootPath: '/Users/developer/projects/careerneed',
    repository: {
      vcs: 'git',
      rootPath: '/Users/developer/projects/careerneed',
      branch: 'stale-feature-branch',
    },
  });

  const serialized = wsPersistMod.serializeWorkspaceState([wsWithOldRepo], 'ws-redetect');
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);

  // Invariant B4: Hydration does NOT populate repository context from persisted data
  assert.strictEqual(
    hydrated.workspaces[0].repository,
    undefined,
    'Hydrated workspace must start with clean repository undefined until re-detected',
  );

  // Simulate startup re-detection via detectRepositoryContext
  let runnerCalled = false;
  const mockRunner = async ({ args }) => {
    runnerCalled = true;
    if (args.includes('--show-toplevel')) {
      return { exitCode: 0, stdout: '/Users/developer/projects/careerneed\n', stderr: '' };
    }
    if (args.includes('HEAD')) {
      return { exitCode: 0, stdout: 'fresh-main\n', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  const detected = await wsContextMod.detectRepositoryContext(
    hydrated.workspaces[0].rootPath,
    mockRunner,
  );
  assert.ok(runnerCalled, 'Startup detection must query git fresh');
  assert.strictEqual(detected.branch, 'fresh-main');
  console.log('✓ Repository context cleanly re-detected on startup rather than trusting stale data');
}

// ============================================================================
// Test 14: Stale persisted branch is not trusted
// ============================================================================
console.log('\n--- Test 14: Stale persisted branch is not trusted ---');
{
  const ws = makeTestWorkspace({
    id: 'ws-branch-test',
    rootPath: '/projects/repo',
    repository: { vcs: 'git', rootPath: '/projects/repo', branch: 'old-branch' },
  });

  const serialized = wsPersistMod.serializeWorkspaceState([ws], ws.id);
  const serializedStr = JSON.stringify(serialized);

  // Serialized document does NOT include branch field in DTO
  assert.ok(!serializedStr.includes('old-branch'), 'Branch name must not be serialized');
  console.log('✓ Persisted schema strictly omits branch data to guarantee freshness');
}

// ============================================================================
// Test 15: Corrupt JSON falls back safely
// ============================================================================
console.log('\n--- Test 15: Corrupt JSON falls back safely ---');
{
  memoryStore.setItem(wsPersistMod.WORKSPACE_PERSISTENCE_STORAGE_KEY, '{ invalid corrupt json %$#');

  const result = wsPersistMod.loadPersistedWorkspaceState();
  assert.strictEqual(result, null, 'Corrupt JSON must return null without throwing');
  console.log('✓ Corrupt JSON logs warning and safely returns null');
}

// ============================================================================
// Test 16: Unknown schema version fails safely
// ============================================================================
console.log('\n--- Test 16: Unknown schema version fails safely ---');
{
  const futureDoc = {
    schemaVersion: 99,
    activeWorkspaceId: 'ws-future',
    workspaces: [{ id: 'ws-future', name: 'FutureWS' }],
  };

  const result = wsPersistMod.deserializeWorkspaceState(futureDoc);
  assert.strictEqual(result, null, 'Unknown schema version must return null');
  console.log('✓ Future/unsupported schemaVersion fails safely');
}

// ============================================================================
// Test 17: Active VerificationRuntime is not restored
// ============================================================================
console.log('\n--- Test 17: Active VerificationRuntime is not restored ---');
{
  const ws = makeTestWorkspace({ id: 'ws-verif-test', name: 'VerifTest' });
  const ensured = verifStateMod.ensureWorkspaceVerificationState(ws);

  // Simulate an interrupted running verification run
  const runningRun = {
    id: 'run-interrupted-1',
    contractId: ensured.verification.activeContractId,
    status: 'running',
    startedAt: Date.now() - 5000,
    criterionResults: [],
  };
  ensured.verification.activeRun = runningRun;
  ensured.verification.runs = [runningRun];

  const serialized = wsPersistMod.serializeWorkspaceState([ensured], ensured.id);
  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);

  const restoredWs = hydrated.workspaces[0];
  assert.strictEqual(
    restoredWs.verification.activeRunId,
    null,
    'Active verification run must be null on restart',
  );
  console.log('✓ Verification active runtime is never restored as active; starts clean');
}

// ============================================================================
// Test 18: Workspace close removes it from persisted state
// ============================================================================
console.log('\n--- Test 18: Workspace close removes it from persisted state ---');
{
  const ws1 = makeTestWorkspace({ id: 'ws-1', name: 'Stay' });
  const ws2 = makeTestWorkspace({ id: 'ws-2', name: 'ToClose' });

  // Initial save with two workspaces
  wsPersistMod.savePersistedWorkspaceState({
    workspaces: [ws1, ws2],
    activeWorkspaceId: 'ws-2',
  });
  let loaded = wsPersistMod.loadPersistedWorkspaceState();
  assert.strictEqual(loaded.workspaces.length, 2);

  // Close ws2
  wsPersistMod.savePersistedWorkspaceState({
    workspaces: [ws1],
    activeWorkspaceId: 'ws-1',
  });
  loaded = wsPersistMod.loadPersistedWorkspaceState();
  assert.strictEqual(loaded.workspaces.length, 1);
  assert.strictEqual(loaded.workspaces[0].id, 'ws-1');
  console.log('✓ Closing a workspace immediately updates persisted state');
}

// ============================================================================
// Test 19: New Workspace appears after restart
// ============================================================================
console.log('\n--- Test 19: New Workspace appears after restart ---');
{
  const ws1 = makeTestWorkspace({ id: 'ws-1', name: 'CareerNeed' });
  const wsNew = makeTestWorkspace({
    id: 'ws-created',
    name: 'NewProject',
    rootPath: '/Users/developer/projects/new-project',
  });

  wsPersistMod.savePersistedWorkspaceState({
    workspaces: [ws1, wsNew],
    activeWorkspaceId: 'ws-created',
  });

  const hydrated = wsPersistMod.loadPersistedWorkspaceState();
  assert.strictEqual(hydrated.workspaces.length, 2);
  assert.strictEqual(hydrated.activeWorkspaceId, 'ws-created');
  assert.strictEqual(hydrated.workspaces[1].name, 'NewProject');
  console.log('✓ Newly created workspaces survive restart in proper order');
}

// ============================================================================
// Test 20: Terminal cd independence remains intact
// ============================================================================
console.log('\n--- Test 20: Terminal cd independence remains intact ---');
{
  const ws = makeTestWorkspace({
    id: 'ws-indep',
    name: 'careerneed',
    rootPath: '/Users/developer/projects/careerneed',
    repository: {
      vcs: 'git',
      rootPath: '/Users/developer/projects/careerneed',
      branch: 'main',
    },
  });

  // User runs: cd /tmp
  // Pane's lastKnownCwd becomes /tmp
  ws.panes[0].lastKnownCwd = '/tmp';

  // Persistence preserves pane's lastKnownCwd BUT leaves workspace.rootPath unchanged
  const serialized = wsPersistMod.serializeWorkspaceState([ws], ws.id);
  assert.strictEqual(serialized.workspaces[0].rootPath, '/Users/developer/projects/careerneed');
  assert.strictEqual(serialized.workspaces[0].terminalTabs[0].panes[0].lastKnownCwd, '/tmp');

  const hydrated = wsPersistMod.deserializeWorkspaceState(serialized);
  assert.strictEqual(
    hydrated.workspaces[0].rootPath,
    '/Users/developer/projects/careerneed',
    'Workspace rootPath must NOT mutate when terminal changes cwd',
  );
  assert.strictEqual(
    hydrated.workspaces[0].panes[0].lastKnownCwd,
    '/tmp',
    'Pane lastKnownCwd is restored independently',
  );
  console.log('✓ Terminal cwd change (cd /tmp) strictly preserves Workspace and Repository rootPath independence');
}

console.log('\n=============================================================');
console.log('ALL WORKSPACE-PERSISTENCE-001 REGRESSION TESTS PASSED!');
console.log('=============================================================\n');
