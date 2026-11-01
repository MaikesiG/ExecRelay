/**
 * EXECRELAY-V020-RC-BLOCKER-001 — Do not resurrect runtime processes from restored terminal metadata.
 *
 * Regression suite covering:
 * A. Restored persisted terminal tab does not spawn shell on app startup
 * B. Multiple restored tabs (and split panes across workspaces) spawn zero shells until explicit user action
 * C. Unavailable restored workspace spawns zero shells and preserves unavailable working-directory error when explicitly started
 * D. Explicit terminal creation/start after restore (Enter in restored pane, or new tab/split/workspace) spawns fresh shell(s)
 * E. Relaunch does not resurrect a previously running or exited shell
 * F. Upgrade fixture from v0.1.2 (tracerelay:workspace-state:v1 / execrelay:workspace-state:v1) preserves metadata without runtime resurrection
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const React = require('../app/node_modules/react');
const ReactDOMServer = require('../app/node_modules/react-dom/server');
const appSrc = path.resolve(__dirname, '../app/src');

if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

class MockTerminalApi {
  constructor() {
    this.sessionCounter = 1;
    this.created = [];
    this.closed = [];
    this.writes = [];
    this.outputListeners = new Set();
    this.exitListeners = new Set();
    this.errorListeners = new Set();
    this.failCwdSet = new Set();
  }
  reset() {
    this.created.length = 0;
    this.closed.length = 0;
    this.writes.length = 0;
    this.failCwdSet.clear();
  }
  async createSession(input = {}) {
    if (input.cwd && this.failCwdSet.has(input.cwd)) {
      throw { kind: 'invalidDirectory', message: input.cwd };
    }
    const sessionId = `sess-live-${this.sessionCounter++}`;
    const info = {
      sessionId,
      shell: '/bin/zsh',
      shellKind: input.shellKind || 'zsh',
      status: 'running',
      cwd: input.cwd || '/Users/test',
      cols: input.cols || 80,
      rows: input.rows || 24,
      integrationNonce: input.integrationNonce || 'nonce',
    };
    this.created.push({ input, info });
    return info;
  }
  async closeSession(input) {
    const id = typeof input === 'string' ? input : input.sessionId;
    this.closed.push(id);
  }
  async close(input) {
    return this.closeSession(input);
  }
  async write(input) {
    this.writes.push({ sessionId: input.sessionId, data: Array.from(input.data) });
  }
  async resize() {}
  async onOutput(cb) {
    this.outputListeners.add(cb);
    return () => this.outputListeners.delete(cb);
  }
  async onExit(cb) {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }
  async onError(cb) {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }
  emitExit(sessionId, exitCode = 0) {
    for (const cb of this.exitListeners) {
      cb({ sessionId, exitCode, reason: 'exited' });
    }
  }
}

const api = new MockTerminalApi();
const { Terminal } = require('../app/node_modules/@xterm/xterm/lib/xterm.js');

class MockTerminal extends Terminal {
  constructor() {
    super({ rows: 24, cols: 80 });
    this.written = '';
  }
  open() {}
  write(data, cb) {
    this.written += typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    cb?.();
  }
  type(data) {
    this.input(data, true);
  }
}

const moduleCache = new Map();
function loadTs(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;
  const mod = { exports: {} };
  moduleCache.set(absPath, mod);
  const raw = fs.readFileSync(absPath, 'utf8').replace(/import\.meta/g, '({ env: {} })');
  const js = ts.transpileModule(raw, {
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
      if (id.endsWith('.css')) return {};
      if (id.includes('terminalApi')) return { terminalApi: api };
      if (id === '@xterm/xterm') return { Terminal: MockTerminal };
      if (id === '@xterm/addon-fit') {
        return {
          FitAddon: class {
            activate() {}
            fit() {}
            dispose() {}
          },
        };
      }
      if (id.includes('@tauri-apps')) {
        return {
          invoke: () => Promise.resolve(null),
          listen: () => Promise.resolve(() => {}),
        };
      }
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(absPath), id);
        for (const c of [
          `${resolved}.ts`,
          `${resolved}.tsx`,
          path.join(resolved, 'index.ts'),
          path.join(resolved, 'index.tsx'),
        ]) {
          if (fs.existsSync(c)) return loadTs(c);
        }
      }
      return require(path.resolve(__dirname, '../app/node_modules', id));
    },
    React,
  );
  return mod.exports;
}

const persistence = loadTs(path.join(appSrc, 'features/workspace/workspacePersistence.ts'));
const factory = loadTs(path.join(appSrc, 'features/workspace/createDefaultWorkspace.ts'));
const registryMod = loadTs(path.join(appSrc, 'features/terminal/terminalRuntimeRegistry.ts'));
const rootStateMod = loadTs(path.join(appSrc, 'features/workspace/workspaceRootState.ts'));

const { TerminalRuntimeRegistry } = registryMod;

console.log('Running EXECRELAY-V020-RC-BLOCKER-001 Regression Suite...\n');

// Helper that mounts a hydrated pane into a TerminalRuntimeRegistry using the exact
// PanelLayoutNodeView -> TerminalPane -> TerminalRuntimeRegistry prop contract:
// autoStartSession = !pane.restoredFromPersistence
// cwd = pane.lastKnownCwd ?? pane.session?.sessionInfo?.cwd ?? workspace.rootPath
function mountPaneInRegistry(registry, ws, tab, pane, onStatusChange) {
  return registry.getOrCreate({
    paneId: pane.id,
    workspaceId: ws.id,
    terminalTabId: tab.id,
    cwd: pane.lastKnownCwd ?? pane.session?.sessionInfo?.cwd ?? ws.rootPath,
    autoStartSession: !pane.restoredFromPersistence,
    onStatusChange,
  });
}

// ============================================================================
// Test A: Restored persisted terminal tab does not spawn shell on app startup
// ============================================================================
console.log('--- Test A: Restored persisted terminal tab does not spawn shell on startup ---');
{
  api.reset();
  const registry = new TerminalRuntimeRegistry();

  const savedDoc = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-a',
    workspaces: [
      {
        id: 'ws-a',
        name: 'Workspace A',
        rootPath: '/Users/developer/execrelay-rc-test/upgrade-a',
        activeTerminalTabId: 'tab-a1',
        terminalTabs: [
          {
            id: 'tab-a1',
            name: 'Terminal',
            activePaneId: 'pane-a1',
            panes: [
              {
                id: 'pane-a1',
                stableOrdinal: 1,
                accentId: 'blue',
                lastKnownCwd: '/Users/developer/execrelay-rc-test/upgrade-a',
              },
            ],
          },
        ],
      },
    ],
  };

  const hydrated = persistence.deserializeWorkspaceState(savedDoc, 'posix');
  assert.ok(hydrated);
  const ws = hydrated.workspaces[0];
  const tab = ws.terminalTabs[0];
  const pane = tab.panes[0];

  assert.equal(pane.restoredFromPersistence, true, 'Hydrated pane must be marked restoredFromPersistence: true');
  assert.equal(pane.session.sessionId, null);

  const runtime = mountPaneInRegistry(registry, ws, tab, pane);
  const initResult = await runtime.initPromise;

  assert.equal(initResult, null, 'Inert restored runtime must resolve initPromise to null without creating a session');
  assert.equal(api.created.length, 0, 'ZERO native shell sessions may be spawned on startup for a restored tab');
  assert.equal(runtime.sessionId, null, 'Restored runtime must have null sessionId');
  assert.equal(runtime.isAwaitingExplicitStart, true, 'Restored runtime awaits explicit user start');
  assert.match(
    runtime.terminal.written,
    /\[Restored terminal tab — press Enter to start a new shell\]/,
    'Restored terminal displays clear inert prompt',
  );

  // Non-Enter keys do not spawn a session or leak to Capture
  let capturedInput = 0;
  runtime.onTerminalInput = () => {
    capturedInput += 1;
  };
  runtime.terminal.type('ls');
  runtime.terminal.type('\x03');
  assert.equal(api.created.length, 0, 'Non-Enter keys must not spawn a shell');
  assert.equal(capturedInput, 0, 'Inert restored pane must not emit terminal input to Capture');

  registry.disposeAll();
  console.log('✓ A. Restored persisted terminal tab spawns 0 shells on startup and remains inert');
}

// ============================================================================
// Test B: Multiple restored tabs & split panes spawn zero shells until explicit user action
// ============================================================================
console.log('\n--- Test B: Multiple restored tabs and split panes spawn zero shells ---');
{
  api.reset();
  const registry = new TerminalRuntimeRegistry();

  const multiDoc = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-multi',
    workspaces: [
      {
        id: 'ws-multi',
        name: 'Multi Tab Workspace',
        rootPath: '/Users/developer/execrelay-rc-test/upgrade-a',
        activeTerminalTabId: 'tab-1',
        terminalTabs: [
          {
            id: 'tab-1',
            name: 'Main',
            activePaneId: 'pane-1a',
            panes: [
              { id: 'pane-1a', stableOrdinal: 1, accentId: 'blue', lastKnownCwd: '/Users/developer/execrelay-rc-test/upgrade-a' },
              { id: 'pane-1b', stableOrdinal: 2, accentId: 'emerald', lastKnownCwd: '/Users/developer/execrelay-rc-test/upgrade-a/sub' },
            ],
          },
          {
            id: 'tab-2',
            name: 'Server',
            activePaneId: 'pane-2a',
            panes: [
              { id: 'pane-2a', stableOrdinal: 1, accentId: 'violet', lastKnownCwd: '/Users/developer/execrelay-rc-test/upgrade-a' },
            ],
          },
        ],
      },
    ],
  };

  const hydrated = persistence.deserializeWorkspaceState(multiDoc, 'posix');
  const ws = hydrated.workspaces[0];
  const mountedRuntimes = [];

  for (const tab of ws.terminalTabs) {
    for (const pane of tab.panes) {
      assert.equal(pane.restoredFromPersistence, true);
      mountedRuntimes.push(mountPaneInRegistry(registry, ws, tab, pane));
    }
  }
  await Promise.all(mountedRuntimes.map((r) => r.initPromise));

  assert.equal(mountedRuntimes.length, 3, '3 restored panes mounted across 2 tabs');
  assert.equal(api.created.length, 0, 'ZERO shells spawned across all restored tabs and split panes');

  registry.disposeAll();
  console.log('✓ B. Multiple restored tabs and split panes spawn 0 shells on startup');
}

// ============================================================================
// Test C: Unavailable restored workspace spawns zero shells and fails safely on explicit start
// ============================================================================
console.log('\n--- Test C: Unavailable restored workspace spawns zero shells and preserves unavailable state ---');
{
  api.reset();
  const unavailablePath = '/Users/developer/execrelay-rc-test/upgrade-b';
  api.failCwdSet.add(unavailablePath);
  const registry = new TerminalRuntimeRegistry();

  const unavailableDoc = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-b',
    workspaces: [
      {
        id: 'ws-b',
        name: 'upgrade-b',
        rootPath: unavailablePath,
        activeTerminalTabId: 'tab-b1',
        terminalTabs: [
          {
            id: 'tab-b1',
            name: 'Terminal',
            activePaneId: 'pane-b1',
            panes: [
              { id: 'pane-b1', stableOrdinal: 1, accentId: 'blue', lastKnownCwd: unavailablePath },
            ],
          },
        ],
      },
    ],
  };

  const hydrated = persistence.deserializeWorkspaceState(unavailableDoc, 'posix');
  const wsB = hydrated.workspaces[0];

  // Simulate startup root evaluation when upgrade-b has been moved/renamed away
  const evalResult = await rootStateMod.evaluateWorkspaceRoot(wsB, 'posix', {
    isDirectory: async () => false,
    detectRepository: async () => ({ vcs: 'git', rootPath: unavailablePath }),
  });
  assert.deepEqual(evalResult.state, {
    kind: 'local-supported-but-unreachable',
    path: unavailablePath,
  });
  const notice = rootStateMod.describeWorkspaceRootState(evalResult.state);
  assert.deepEqual(notice, {
    message: 'Workspace path is currently unavailable.',
    path: unavailablePath,
  });

  // Mount restored pane of unavailable workspace
  const runtimeB = mountPaneInRegistry(registry, wsB, wsB.terminalTabs[0], wsB.panes[0]);
  await runtimeB.initPromise;

  assert.equal(api.created.length, 0, 'Unavailable restored workspace spawns 0 shells on startup');
  assert.equal(runtimeB.sessionId, null);

  // If operator explicitly presses Enter in the unavailable workspace's restored pane,
  // it attempts to start at unavailablePath, fails with invalid working directory, and never falls back to ~
  runtimeB.terminal.type('\r');
  const explicitStartResult = await runtimeB.initPromise;
  assert.equal(explicitStartResult, null);
  assert.equal(api.created.length, 0, 'No fallback shell spawned when directory is unavailable');
  assert.equal(runtimeB.status, 'error');
  assert.equal(
    runtimeB.errorMessage,
    `Failed to initialize session: invalid working directory: ${unavailablePath}`,
  );

  registry.disposeAll();
  console.log('✓ C. Unavailable restored workspace spawns 0 shells on startup and never falls back to home cwd');
}

// ============================================================================
// Test D: Explicit terminal start/creation after restore spawns exactly one fresh shell
// ============================================================================
console.log('\n--- Test D: Explicit terminal start or new tab creation spawns fresh shell ---');
{
  api.reset();
  const registry = new TerminalRuntimeRegistry();

  const savedDoc = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-a',
    workspaces: [
      {
        id: 'ws-a',
        name: 'upgrade-a',
        rootPath: '/Users/developer/execrelay-rc-test/upgrade-a',
        activeTerminalTabId: 'tab-a1',
        terminalTabs: [
          {
            id: 'tab-a1',
            name: 'Terminal 1',
            activePaneId: 'pane-a1',
            panes: [
              { id: 'pane-a1', stableOrdinal: 1, accentId: 'blue', lastKnownCwd: '/Users/developer/execrelay-rc-test/upgrade-a' },
            ],
          },
          {
            id: 'tab-a2',
            name: 'Terminal 2',
            activePaneId: 'pane-a2',
            panes: [
              { id: 'pane-a2', stableOrdinal: 1, accentId: 'emerald', lastKnownCwd: '/Users/developer/execrelay-rc-test/upgrade-a' },
            ],
          },
        ],
      },
    ],
  };

  const hydrated = persistence.deserializeWorkspaceState(savedDoc, 'posix');
  const ws = hydrated.workspaces[0];
  const r1 = mountPaneInRegistry(registry, ws, ws.terminalTabs[0], ws.terminalTabs[0].panes[0]);
  const r2 = mountPaneInRegistry(registry, ws, ws.terminalTabs[1], ws.terminalTabs[1].panes[0]);
  await Promise.all([r1.initPromise, r2.initPromise]);
  assert.equal(api.created.length, 0, '0 shells before explicit action');

  // Case D1: User explicitly presses Enter in restored pane 1 (even if pressed twice rapidly)
  r1.terminal.type('\r');
  r1.terminal.type('\r');
  const info1 = await r1.initPromise;
  assert.ok(info1?.sessionId);
  assert.equal(api.created.length, 1, 'Explicit Enter in restored pane 1 spawns exactly 1 fresh shell');
  assert.equal(api.created[0].input.cwd, '/Users/developer/execrelay-rc-test/upgrade-a');
  assert.equal(r1.status, 'running');
  assert.equal(r1.isAwaitingExplicitStart, false);
  assert.equal(r2.sessionId, null, 'Other restored tab remains inert');

  // Case D2: User clicks "+" to create a brand-new terminal tab in the current session
  const newPane = factory.createDefaultTerminalPane('tab-new', 'pane-new', 1, 'violet');
  assert.equal(newPane.restoredFromPersistence, undefined, 'Newly created pane is not marked restoredFromPersistence');
  const newTab = factory.createDefaultTerminalTab('tab-new', ws.id, 'Terminal', 'pane-new', newPane);
  const rNew = mountPaneInRegistry(registry, ws, newTab, newPane);
  const infoNew = await rNew.initPromise;
  assert.ok(infoNew?.sessionId);
  assert.equal(api.created.length, 2, 'Explicitly creating a new tab spawns 1 fresh shell for that tab');
  assert.equal(rNew.status, 'running');

  registry.disposeAll();
  console.log('✓ D. Explicit user action (Enter in restored pane or new tab "+") spawns exactly one fresh shell');
}

// ============================================================================
// Test E: Relaunch does not resurrect a previously running or exited shell
// ============================================================================
console.log('\n--- Test E: Relaunch does not resurrect a previously running or exited shell ---');
{
  api.reset();
  const registry1 = new TerminalRuntimeRegistry();

  // First session: fresh default workspace starts 1 live shell, then user exits shell and quits app
  const ws1 = factory.createDefaultLogicalWorkspace(
    'ws-live',
    'Live Project',
    'tab-live',
    'pane-live',
    '/Users/developer/execrelay-rc-test/runtime-ws',
  );
  const rt1 = mountPaneInRegistry(registry1, ws1, ws1.terminalTabs[0], ws1.panes[0]);
  const info1 = await rt1.initPromise;
  assert.equal(api.created.length, 1, 'Fresh default workspace starts 1 shell');
  ws1.panes[0].session = {
    sessionId: info1.sessionId,
    status: 'running',
    sessionInfo: info1,
  };

  // Shell exits before quit
  api.emitExit(info1.sessionId, 0);
  assert.equal(rt1.status, 'exited');
  ws1.panes[0].session.status = 'exited';

  // App serializes state on quit
  const serializedOnQuit = persistence.serializeWorkspaceState([ws1], ws1.id);
  registry1.disposeAll();

  // Relaunch: hydrate serialized state and mount in a new registry
  api.reset();
  const registry2 = new TerminalRuntimeRegistry();
  const relaunched = persistence.deserializeWorkspaceState(serializedOnQuit, 'posix');
  const wsRelaunched = relaunched.workspaces[0];
  const rtRelaunched = mountPaneInRegistry(
    registry2,
    wsRelaunched,
    wsRelaunched.terminalTabs[0],
    wsRelaunched.panes[0],
  );
  await rtRelaunched.initPromise;

  assert.equal(api.created.length, 0, 'Relaunch spawns 0 shells');
  assert.equal(rtRelaunched.sessionId, null, 'No sessionId resurrected on relaunch');
  assert.equal(rtRelaunched.isAwaitingExplicitStart, true);

  registry2.disposeAll();
  console.log('✓ E. Relaunch after live/exited session spawns 0 shells');
}

// ============================================================================
// Test F: Upgrade fixture from v0.1.2 (Workspace A with split + Capture/Verify, Workspace B unavailable)
// ============================================================================
console.log('\n--- Test F: v0.1.2 -> v0.2.0 upgrade fixture preserves metadata with 0 process resurrection ---');
{
  api.reset();
  const registry = new TerminalRuntimeRegistry();

  const upgradeARoot = '/Users/developer/execrelay-rc-test/upgrade-a';
  const upgradeBRoot = '/Users/developer/execrelay-rc-test/upgrade-b';
  api.failCwdSet.add(upgradeBRoot);

  // Representative v0.1.2 persisted state (3 total panes across 2 workspaces — the exact scenario
  // that previously spawned 3 /bin/zsh -l child processes on v0.2.0 launch)
  const v012Fixture = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-upgrade-a',
    activeMonitorView: 'capture-evidence',
    workspaces: [
      {
        id: 'ws-upgrade-a',
        name: 'upgrade-a',
        rootPath: upgradeARoot,
        activeTerminalTabId: 'tab-a-1',
        terminalTabs: [
          {
            id: 'tab-a-1',
            baseName: 'Terminal',
            colorKey: 'emerald',
            activePaneId: 'pane-a-1',
            panes: [
              { id: 'pane-a-1', stableOrdinal: 1, accentId: 'blue', lastKnownCwd: upgradeARoot },
              { id: 'pane-a-2', stableOrdinal: 2, accentId: 'violet', lastKnownCwd: upgradeARoot },
            ],
          },
          {
            id: 'tab-a-2',
            baseName: 'Logs',
            colorKey: 'amber',
            activePaneId: 'pane-a-3',
            panes: [
              { id: 'pane-a-3', stableOrdinal: 1, accentId: 'emerald', lastKnownCwd: upgradeARoot },
            ],
          },
        ],
        capture: {
          blocks: [
            {
              id: 'blk-v012-1',
              batchId: 1,
              command: 'pwd',
              output: `${upgradeARoot}\n`,
              startedAt: 1700000000000,
              completedAt: 1700000000100,
              isComplete: true,
              workspaceId: 'ws-upgrade-a',
              terminalTabId: 'tab-a-1',
              terminalPaneId: 'pane-a-1',
              exitCode: 0,
              lifecycle: 'finished',
              outcome: 'succeeded',
            },
          ],
        },
        verification: {
          activeContractId: 'contract-v012-1',
          contracts: [
            {
              id: 'contract-v012-1',
              workspaceId: 'ws-upgrade-a',
              name: 'Smoke Checks',
              criteria: [
                {
                  id: 'crit-v012-1',
                  label: 'Check pwd',
                  command: 'pwd',
                  workingDirectory: '.',
                  expectedExitCodes: [0],
                },
              ],
            },
          ],
          runs: [
            {
              id: 'run-v012-active',
              contractId: 'contract-v012-1',
              workspaceId: 'ws-upgrade-a',
              status: 'running',
              startedAt: 1700000000200,
              criteriaSnapshot: [],
              criterionResults: [],
            },
          ],
          activeRunId: 'run-v012-active',
        },
      },
      {
        id: 'ws-upgrade-b',
        name: 'upgrade-b',
        rootPath: upgradeBRoot,
        activeTerminalTabId: 'tab-b-1',
        terminalTabs: [
          {
            id: 'tab-b-1',
            baseName: 'Terminal',
            colorKey: 'blue',
            activePaneId: 'pane-b-1',
            panes: [
              { id: 'pane-b-1', stableOrdinal: 1, accentId: 'blue', lastKnownCwd: upgradeBRoot },
            ],
          },
        ],
      },
    ],
  };

  const hydrated = persistence.deserializeWorkspaceState(v012Fixture, 'posix');
  assert.ok(hydrated);
  assert.equal(hydrated.workspaces.length, 2);

  const [wsA, wsB] = hydrated.workspaces;
  assert.equal(wsA.rootPath, upgradeARoot);
  assert.equal(wsA.terminalTabs.length, 2);
  assert.equal(wsA.panes.length, 3);
  assert.equal(wsA.capture.blocks.length, 1);
  assert.equal(wsA.capture.isListening, false, 'No fabricated active Capture listening state');
  assert.equal(wsA.verification.activeRunId, null, 'No fabricated active Verify run');
  assert.notEqual(wsA.verification.runs[0].status, 'running', 'Interrupted Verify run reconciled');
  assert.equal(wsB.rootPath, upgradeBRoot);

  // Mount all 4 panes across Workspace A and Workspace B as App.tsx does on startup
  const allRuntimes = [];
  for (const ws of hydrated.workspaces) {
    for (const tab of ws.terminalTabs) {
      for (const pane of tab.panes) {
        allRuntimes.push(mountPaneInRegistry(registry, ws, tab, pane));
      }
    }
  }
  await Promise.all(allRuntimes.map((r) => r.initPromise));

  // Mandatory E1 Runtime Truth Invariants:
  assert.equal(api.created.length, 0, 'INV_NO_FAB_PROC / INV_NO_FAB_PTY: 0 PTYs or processes spawned on post-upgrade launch');
  assert.ok(allRuntimes.every((r) => r.sessionId === null), 'INV_NO_FAB_SHELL: 0 live shell sessions');
  assert.ok(allRuntimes.every((r) => r.status === 'starting' && r.errorMessage === null), 'No startup error banner on unavailable workspace before user action');

  // Verify PanelLayoutNodeView passes autoStartSession={!pane.restoredFromPersistence}
  const panelLayoutViewSrc = fs.readFileSync(
    path.join(appSrc, 'features/workspace/PanelLayoutNodeView.tsx'),
    'utf8',
  );
  assert.ok(
    panelLayoutViewSrc.includes('autoStartSession={!pane.restoredFromPersistence}'),
    'PanelLayoutNodeView passes autoStartSession={!pane.restoredFromPersistence} to TerminalPaneView',
  );

  // Verify App.tsx scopes workspaceRootPath per workspace so background workspaces never inherit activeWorkspace.rootPath
  const appSrcText = fs.readFileSync(path.join(appSrc, 'App.tsx'), 'utf8');
  assert.ok(
    appSrcText.includes('workspaceRootPath: ws.rootPath,'),
    'App.tsx passes per-workspace ws.rootPath to non-active workspaces',
  );

  registry.disposeAll();
  console.log('✓ F. v0.1.2 upgrade fixture restores all metadata while spawning 0 shells and fabricating 0 runtime state');
}

console.log('\n=============================================================');
console.log('ALL EXECRELAY-V020-RC-BLOCKER-001 TESTS PASSED!');
console.log('=============================================================\n');
