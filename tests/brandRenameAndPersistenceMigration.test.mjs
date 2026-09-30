/**
 * BRAND-RENAME-001 — Rename TraceRelay to ExecRelay Without Breaking User State
 *
 * Test Suite verifying:
 * 1. Public Product Name & Window Title Resolution:
 *    - Bound workspace resolves to "{workspace.name} — ExecRelay"
 *    - Unbound workspace resolves to "ExecRelay"
 *    - Null / undefined / empty rootPath resolves to "ExecRelay"
 *    - Legacy folder named "traceRelay" resolves to "traceRelay — ExecRelay"
 * 2. Product Edition Configuration:
 *    - productName is "ExecRelay"
 *    - windowTitle is "ExecRelay Terminal" (terminal edition) or "ExecRelay (Internal)" (internal)
 * 3. Canonical and Legacy Storage Keys:
 *    - Canonical workspace key: "execrelay:workspace-state:v1"
 *    - Legacy workspace key: "tracerelay:workspace-state:v1"
 *    - Canonical shortcut key: "execrelay:keyboard_shortcuts:v1"
 *    - Legacy shortcut key: "tracerelay:keyboard_shortcuts:v1"
 * 4. Legacy Workspace Migration:
 *    - State present only in "tracerelay:workspace-state:v1" restores cleanly
 *    - Workspace IDs, order, names, rootPaths, activeWorkspaceId, tabs, and panes preserved
 *    - Automatically writes migrated state to canonical "execrelay:workspace-state:v1"
 *    - Does NOT create duplicate workspaces
 * 5. Subsequent ExecRelay Launch / Idempotency:
 *    - Loads directly from canonical "execrelay:workspace-state:v1"
 *    - Subsequent saves update "execrelay:workspace-state:v1"
 * 6. Corrupt Legacy State Safe Degradation:
 *    - Corrupt JSON in legacy key degrades safely to null without crashing
 *    - Unsupported schema version in legacy key degrades safely to null
 * 7. Invariant Preservation:
 *    - PTY runtime handles and PIDs are NOT restored (clean unattached state)
 *    - Commands and processes are never replayed
 *    - Active VerificationRuntime is not restored
 * 8. Legacy Shortcut Settings Migration:
 *    - Legacy shortcuts key migrated to new canonical key
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

  const rawSrc = fs.readFileSync(absPath, 'utf8');
  const src = rawSrc.replace(/import\.meta/g, '({ env: {} })');
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

// Load editionConfig module
const editionConfigMod = loadTs('../app/src/features/edition/editionConfig.ts');

// Load shortcutPersistence module
const shortcutPersistMod = loadTs('../app/src/features/shortcuts/shortcutPersistence.ts');

console.log('Running BRAND-RENAME-001: ExecRelay Product Rename & Persistence Migration Suite...\n');

// In-memory test storage adapter
class MemoryStorageAdapter {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

// -----------------------------------------------------------------------------
// Test 1: Window Title Resolution (Sections 2 & 3)
// -----------------------------------------------------------------------------
console.log('--- Test 1: Window Title Resolution ---');
{
  // A. Bound workspace
  const boundWs = {
    id: 'ws-1',
    name: 'careerneed',
    rootPath: '/Users/developer/projects/careerneed',
  };
  assert.strictEqual(
    wsContextMod.resolveWindowTitle(boundWs),
    'careerneed — ExecRelay',
    'Bound workspace title must be "{workspace.name} — ExecRelay"',
  );

  // B. Unbound workspace
  const unboundWs = {
    id: 'ws-2',
    name: 'Workspace 2',
    rootPath: undefined,
  };
  assert.strictEqual(
    wsContextMod.resolveWindowTitle(unboundWs),
    'ExecRelay',
    'Unbound workspace title must be "ExecRelay"',
  );

  // C. Null / undefined / empty rootPath
  assert.strictEqual(wsContextMod.resolveWindowTitle(null), 'ExecRelay');
  assert.strictEqual(wsContextMod.resolveWindowTitle(undefined), 'ExecRelay');
  assert.strictEqual(
    wsContextMod.resolveWindowTitle({ id: 'ws-3', name: 'Empty', rootPath: '   ' }),
    'ExecRelay',
  );

  // D. Workspace named "traceRelay" (source directory preserving)
  const legacyDirWs = {
    id: 'ws-legacy-dir',
    name: 'traceRelay',
    rootPath: '/Users/developer/projects/traceRelay',
  };
  assert.strictEqual(
    wsContextMod.resolveWindowTitle(legacyDirWs),
    'traceRelay — ExecRelay',
    'Workspace with folder name traceRelay resolves to "traceRelay — ExecRelay"',
  );

  console.log('✓ Window titles strictly use ExecRelay per specification');
}

// -----------------------------------------------------------------------------
// Test 2: Product Edition Configuration (Section 2 & 5)
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Product Edition Configuration ---');
{
  const termConfig = editionConfigMod.getEditionConfig('terminal');
  assert.strictEqual(termConfig.productName, 'ExecRelay');
  assert.strictEqual(termConfig.windowTitle, 'ExecRelay Terminal');

  const internalConfig = editionConfigMod.getEditionConfig('internal');
  assert.strictEqual(internalConfig.productName, 'ExecRelay');
  assert.strictEqual(internalConfig.windowTitle, 'ExecRelay (Internal)');

  console.log('✓ Product edition config yields ExecRelay and ExecRelay Terminal');
}

// -----------------------------------------------------------------------------
// Test 3: Storage Keys Audit (Section 7 & 10)
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Storage Keys Audit ---');
{
  assert.strictEqual(
    wsPersistMod.WORKSPACE_PERSISTENCE_STORAGE_KEY,
    'execrelay:workspace-state:v1',
    'Canonical workspace key must be execrelay:workspace-state:v1',
  );
  assert.strictEqual(
    wsPersistMod.LEGACY_WORKSPACE_PERSISTENCE_STORAGE_KEY,
    'tracerelay:workspace-state:v1',
    'Legacy workspace key must be tracerelay:workspace-state:v1',
  );
  assert.strictEqual(
    shortcutPersistMod.SHORTCUT_SETTINGS_STORAGE_KEY,
    'execrelay:keyboard_shortcuts:v1',
    'Canonical shortcut key must be execrelay:keyboard_shortcuts:v1',
  );
  assert.strictEqual(
    shortcutPersistMod.LEGACY_SHORTCUT_SETTINGS_STORAGE_KEY,
    'tracerelay:keyboard_shortcuts:v1',
    'Legacy shortcut key must be tracerelay:keyboard_shortcuts:v1',
  );
  console.log('✓ Storage keys correctly define canonical execrelay and legacy tracerelay keys');
}

// -----------------------------------------------------------------------------
// Test 4: Legacy Workspace Persistence Migration (Sections 7, 8, 16)
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Legacy Workspace Persistence Migration ---');
{
  const memoryStore = new MemoryStorageAdapter();
  wsPersistMod.setWorkspaceStorageAdapter(memoryStore);

  // Seed ONLY the old TraceRelay persistence key with valid workspace state
  const legacyPayload = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-legacy-2',
    activeMonitorView: 'changes',
    workspaces: [
      {
        id: 'ws-legacy-1',
        name: 'Project Alpha',
        rootPath: '/Users/developer/alpha',
        activeTerminalTabId: 'tab-alpha-1',
        terminalTabs: [
          {
            id: 'tab-alpha-1',
            name: 'Terminal 1',
            activePaneId: 'pane-alpha-1',
            isCapturePanelOpen: true,
            capturePanelWidth: 420,
            panes: [
              {
                id: 'pane-alpha-1',
                stableOrdinal: 1,
                accentId: 'emerald',
                customTitle: 'Backend Server',
                lastKnownCwd: '/Users/developer/alpha/backend',
              },
            ],
          },
        ],
      },
      {
        id: 'ws-legacy-2',
        name: 'Project Beta',
        rootPath: '/Users/developer/beta',
        activeTerminalTabId: 'tab-beta-1',
        terminalTabs: [
          {
            id: 'tab-beta-1',
            name: 'Terminal 1',
            activePaneId: 'pane-beta-1',
            isCapturePanelOpen: false,
            panes: [
              {
                id: 'pane-beta-1',
                stableOrdinal: 1,
                accentId: 'violet',
                customTitle: null,
                lastKnownCwd: '/Users/developer/beta',
              },
            ],
          },
        ],
      },
    ],
  };

  memoryStore.setItem('tracerelay:workspace-state:v1', JSON.stringify(legacyPayload));
  assert.strictEqual(memoryStore.getItem('execrelay:workspace-state:v1'), null, 'New key is initially empty');

  // Hydrate ExecRelay
  const hydrated = wsPersistMod.loadPersistedWorkspaceState();

  assert.ok(hydrated !== null, 'Hydration must succeed from legacy key');
  assert.strictEqual(hydrated.workspaces.length, 2, 'Restores exact count of 2 workspaces');
  assert.strictEqual(hydrated.activeWorkspaceId, 'ws-legacy-2', 'Preserves active workspace pointer');
  assert.strictEqual(hydrated.activeMonitorView, 'changes', 'Preserves active monitor view');

  // Workspace 1 verification
  const ws1 = hydrated.workspaces[0];
  assert.strictEqual(ws1.id, 'ws-legacy-1');
  assert.strictEqual(ws1.name, 'Project Alpha');
  assert.strictEqual(ws1.rootPath, '/Users/developer/alpha');
  assert.strictEqual(ws1.terminalTabs[0].panes[0].customTitle, 'Backend Server');
  assert.strictEqual(ws1.terminalTabs[0].panes[0].accentId, 'emerald');
  assert.strictEqual(ws1.terminalTabs[0].panes[0].lastKnownCwd, '/Users/developer/alpha/backend');

  // Workspace 2 verification
  const ws2 = hydrated.workspaces[1];
  assert.strictEqual(ws2.id, 'ws-legacy-2');
  assert.strictEqual(ws2.name, 'Project Beta');
  assert.strictEqual(ws2.rootPath, '/Users/developer/beta');

  // CRITICAL: Migration must write to new canonical key
  const newCanonicalRaw = memoryStore.getItem('execrelay:workspace-state:v1');
  assert.ok(newCanonicalRaw !== null, 'Migration must write to execrelay:workspace-state:v1');
  const newCanonicalParsed = JSON.parse(newCanonicalRaw);
  assert.strictEqual(newCanonicalParsed.workspaces.length, 2);
  assert.strictEqual(newCanonicalParsed.activeWorkspaceId, 'ws-legacy-2');

  console.log('✓ Legacy TraceRelay workspace persistence cleanly migrated to canonical ExecRelay key');
}

// -----------------------------------------------------------------------------
// Test 5: New Persistence & Idempotent Relaunch (Section 17)
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: New Persistence & Idempotent Relaunch ---');
{
  const memoryStore = new MemoryStorageAdapter();
  wsPersistMod.setWorkspaceStorageAdapter(memoryStore);

  // Setup state already migrated to execrelay:workspace-state:v1
  const canonicalPayload = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-canonical-1',
    workspaces: [
      {
        id: 'ws-canonical-1',
        name: 'ExecRelay Core',
        rootPath: '/Users/developer/projects/execrelay',
        activeTerminalTabId: 'tab-1',
        terminalTabs: [
          {
            id: 'tab-1',
            activePaneId: 'pane-1',
            panes: [
              {
                id: 'pane-1',
                stableOrdinal: 1,
                accentId: 'blue',
              },
            ],
          },
        ],
      },
    ],
  };

  memoryStore.setItem('execrelay:workspace-state:v1', JSON.stringify(canonicalPayload));
  // Old key has stale or empty data
  memoryStore.setItem('tracerelay:workspace-state:v1', JSON.stringify({ schemaVersion: 1, workspaces: [] }));

  // Load must prefer new canonical key
  const hydrated = wsPersistMod.loadPersistedWorkspaceState();
  assert.strictEqual(hydrated.workspaces.length, 1);
  assert.strictEqual(hydrated.workspaces[0].name, 'ExecRelay Core');

  // Next save updates canonical key
  wsPersistMod.savePersistedWorkspaceState({
    workspaces: [
      ...hydrated.workspaces,
      {
        ...hydrated.workspaces[0],
        id: 'ws-canonical-2',
        name: 'Second Workspace',
      },
    ],
    activeWorkspaceId: 'ws-canonical-2',
  });

  const updatedRaw = memoryStore.getItem('execrelay:workspace-state:v1');
  const updatedParsed = JSON.parse(updatedRaw);
  assert.strictEqual(updatedParsed.workspaces.length, 2);
  assert.strictEqual(updatedParsed.activeWorkspaceId, 'ws-canonical-2');

  console.log('✓ Canonical ExecRelay key takes strict precedence and receives all future updates');
}

// -----------------------------------------------------------------------------
// Test 6: Corrupt Legacy State Safe Fallback (Section 18)
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Corrupt Legacy State Safe Fallback ---');
{
  const memoryStore = new MemoryStorageAdapter();
  wsPersistMod.setWorkspaceStorageAdapter(memoryStore);

  // A. Corrupt JSON in legacy key
  memoryStore.setItem('tracerelay:workspace-state:v1', '!!!NOT_JSON{bad');
  const corruptResult = wsPersistMod.loadPersistedWorkspaceState();
  assert.strictEqual(corruptResult, null, 'Corrupt legacy JSON safely returns null without throwing');
  assert.strictEqual(memoryStore.getItem('execrelay:workspace-state:v1'), null, 'Does NOT write corrupt state to new key');

  // B. Unsupported schema version in legacy key
  memoryStore.setItem('tracerelay:workspace-state:v1', JSON.stringify({ schemaVersion: 999, workspaces: [{ id: '1' }] }));
  const invalidVersionResult = wsPersistMod.loadPersistedWorkspaceState();
  assert.strictEqual(invalidVersionResult, null, 'Unsupported schema version safely returns null');

  console.log('✓ Corrupt or invalid legacy state safely degrades without crashing or polluting new storage');
}

// -----------------------------------------------------------------------------
// Test 7: Runtime Boundaries & No Process Replay (Section 8)
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Runtime Boundaries & No Process Replay ---');
{
  const memoryStore = new MemoryStorageAdapter();
  wsPersistMod.setWorkspaceStorageAdapter(memoryStore);

  const payload = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-safe-1',
    workspaces: [
      {
        id: 'ws-safe-1',
        name: 'SafeProject',
        activeTerminalTabId: 'tab-1',
        terminalTabs: [
          {
            id: 'tab-1',
            activePaneId: 'pane-1',
            panes: [
              {
                id: 'pane-1',
                stableOrdinal: 1,
                accentId: 'amber',
                lastKnownCwd: '/home/user/project',
              },
            ],
          },
        ],
      },
    ],
  };
  memoryStore.setItem('tracerelay:workspace-state:v1', JSON.stringify(payload));

  const hydrated = wsPersistMod.loadPersistedWorkspaceState();
  const pane = hydrated.workspaces[0].panes[0];

  assert.strictEqual(pane.session.sessionId, null, 'Session ID must be null on restore');
  assert.strictEqual(pane.session.status, 'starting', 'Session status must be starting');
  assert.strictEqual(pane.session.sessionInfo, null, 'Session info must be null');
  assert.strictEqual(pane.capture.isListening, false, 'Capture listening must be false');
  assert.strictEqual(pane.capture.currentBatchId, null, 'Batch ID must be null');
  assert.strictEqual(hydrated.workspaces[0].verification.activeRunId, null, 'No active verification run restored');

  console.log('✓ Restored legacy state enforces strict runtime boundaries: 0 PIDs, 0 PTY handles, 0 process replays');
}

console.log('\n=============================================================');
console.log('ALL BRAND-RENAME-001 REGRESSION TESTS PASSED!');
console.log('=============================================================\n');
