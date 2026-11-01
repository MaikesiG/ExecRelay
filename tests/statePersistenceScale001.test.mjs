/**
 * STATE-PERSISTENCE-SCALE-001 Test Suite
 *
 * Every full-state write must have a durability reason; a React state change is not one.
 * Uses a counting in-memory storage adapter and a fake clock (no wall-clock assertions).
 *
 * Validates:
 * A. Coalescing: requests inside one window produce one write.
 * B. Latest state wins.
 * C. Explicit flush writes pending state immediately, once.
 * D. No write without a pending change, and none for reference-identical state.
 * E. Streaming updates are written at a bounded cadence, not once per update.
 * F. Structural changes (reorder, create, delete, tab switch) persist and restore.
 * G. An existing v1 persisted document restores without migration (11 workspaces, 21 tabs).
 * H. Storage failure never throws and is retried on the next change.
 * I. Scale: one command lifecycle on the 11-workspace / 21-tab state costs one write.
 * J. App routes every full-state write through the coordinator.
 * K. A graceful app quit writes pending state before native teardown.
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

// Tauri API stand-in: records event listeners.
const tauriStub = {
  listeners: new Map(),
  invoke() {
    return Promise.resolve(null);
  },
  listen(event, cb) {
    tauriStub.listeners.set(event, cb);
    return Promise.resolve(() => tauriStub.listeners.delete(event));
  },
};

const moduleCache = new Map();
function loadTs(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath);
  const mod = { exports: {} };
  moduleCache.set(absPath, mod.exports);
  const js = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  new Function('module', 'exports', 'require', 'React', js)(
    mod,
    mod.exports,
    (id) => {
      if (id === 'react') return React;
      if (id.includes('.css')) return {};
      if (id.includes('@tauri-apps')) return tauriStub;
      if (id === '@xterm/xterm') return { Terminal: class { open() {} loadAddon() {} } };
      if (id === '@xterm/addon-fit') return { FitAddon: class { fit() {} } };
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(absPath), id);
        for (const c of [resolved + '.ts', resolved + '.tsx', path.join(resolved, 'index.ts')]) {
          if (fs.existsSync(c)) return loadTs(c);
        }
      }
      return require(path.resolve(__dirname, '../app/node_modules', id));
    },
    React,
  );
  moduleCache.set(absPath, mod.exports);
  return mod.exports;
}

const persistence = loadTs(path.resolve(__dirname, '../app/src/features/workspace/workspacePersistence.ts'));
const { createWorkspacePersistenceCoordinator, setWorkspaceStorageAdapter, loadPersistedWorkspaceState, deserializeWorkspaceState, WORKSPACE_PERSISTENCE_STORAGE_KEY } = persistence;

// Synthetic persisted state shaped like a heavy real session (11 workspaces, 21 terminal tabs,
// 100 KB failed outputs in two workspaces). Generated text only — no real commands, paths or output.
const TABS_PER_WORKSPACE = [3, 1, 1, 1, 2, 3, 2, 1, 1, 3, 3];

function syntheticOutput(chars, seed) {
  let out = '';
  for (let i = 0; out.length < chars; i++) {
    out += `synthetic ${seed} line ${i}: error expected value ${i % 97} at module-${i % 13}\n`;
  }
  return out.slice(0, chars);
}

function block(wsId, tabId, paneId, n, outputChars, exitCode) {
  return {
    id: `block-${wsId}-${n}`,
    batchId: 1,
    command: `synthetic-command-${n}`,
    output: syntheticOutput(outputChars, `${wsId}-${n}`),
    startedAt: 1_700_000_000_000 + n * 1000,
    completedAt: 1_700_000_000_500 + n * 1000,
    isComplete: true,
    type: 'command',
    exitCode,
    workspaceId: wsId,
    terminalTabId: tabId,
    terminalPaneId: paneId,
    sourcePaneId: paneId,
    sourcePaneOrdinal: 1,
    terminalLabelAtCapture: 'Terminal',
  };
}

/** Persisted (v1) document; `largeWorkspaces` maps workspace index → output sizes of its blocks. */
function createSyntheticPersistedState({
  largeWorkspaces = { 8: [977, 25, 40, 14, 10, 30, 100_000], 9: [100_000, 100_000] },
  smallBlocksPerWorkspace = 2,
  activeIndex = 0,
} = {}) {
  const workspaces = TABS_PER_WORKSPACE.map((tabCount, i) => {
    const wsId = `ws-synthetic-${i}`;
    const terminalTabs = Array.from({ length: tabCount }, (_, t) => {
      const paneId = `pane-${i}-${t}`;
      return {
        id: `tab-${i}-${t}`,
        baseName: `Terminal ${t + 1}`,
        activePaneId: paneId,
        isCapturePanelOpen: true,
        capturePanelWidth: 400,
        panes: [{ id: paneId, stableOrdinal: 1, accentId: 'blue', customTitle: null, lastKnownCwd: null }],
      };
    });
    const tab0 = terminalTabs[0];
    const sizes = largeWorkspaces[i] ?? Array.from({ length: smallBlocksPerWorkspace }, () => 300);
    const blocks = sizes.map((chars, n) =>
      block(wsId, tab0.id, tab0.panes[0].id, n, chars, n === sizes.length - 1 ? 1 : 0),
    );
    return {
      id: wsId,
      name: `Workspace ${i + 1}`,
      rootPath: null,
      activeTerminalTabId: tab0.id,
      terminalTabs,
      capture: { blocks },
    };
  });
  return {
    schemaVersion: 1,
    activeWorkspaceId: workspaces[activeIndex].id,
    activeMonitorView: 'capture-evidence',
    workspaces,
  };
}

console.log('Running STATE-PERSISTENCE-SCALE-001 tests...');

// --- Fake clock: the coordinator schedules with the global setTimeout. ---
let now = 0;
let timers = [];
let nextTimerId = 1;
globalThis.setTimeout = (fn, ms) => {
  const id = nextTimerId++;
  timers.push({ id, at: now + ms, fn });
  return id;
};
globalThis.clearTimeout = (id) => {
  timers = timers.filter((t) => t.id !== id);
};
function advance(ms) {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers[0];
    if (!next || next.at > end) break;
    timers.shift();
    now = next.at;
    next.fn();
  }
  now = end;
}

// --- Counting storage adapter. ---
class CountingStorage {
  constructor() {
    this.map = new Map();
    this.writes = 0;
    this.fail = false;
  }
  getItem(key) {
    return this.map.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.fail) throw new Error('QuotaExceededError (simulated)');
    this.writes++;
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  stored() {
    return JSON.parse(this.map.get(WORKSPACE_PERSISTENCE_STORAGE_KEY));
  }
}

function freshState(options) {
  return deserializeWorkspaceState(createSyntheticPersistedState(options));
}
function snapshotOf(state) {
  return { workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId, activeMonitorView: state.activeMonitorView };
}
function setup() {
  now = 0;
  timers = [];
  const storage = new CountingStorage();
  setWorkspaceStorageAdapter(storage);
  return { storage, coordinator: createWorkspacePersistenceCoordinator(400) };
}
const renamed = (state, name) => ({
  ...state,
  workspaces: state.workspaces.map((w, i) => (i === 0 ? { ...w, name } : w)),
});

const base = freshState();

// A. Coalescing
{
  const { storage, coordinator } = setup();
  coordinator.request(snapshotOf(renamed(base, 'a1')));
  coordinator.request(snapshotOf(renamed(base, 'a2')));
  coordinator.request(snapshotOf(renamed(base, 'a3')));
  assert.strictEqual(storage.writes, 0, 'requests do not write synchronously');
  advance(399);
  assert.strictEqual(storage.writes, 0);
  advance(1);
  assert.strictEqual(storage.writes, 1, 'three requests in one window produce one write');
  advance(5000);
  assert.strictEqual(storage.writes, 1, 'no further writes without new requests');
  console.log('✓ A. Three requests in one window → one write');
}

// B. Latest state wins
{
  const { storage, coordinator } = setup();
  for (const name of ['state A', 'state B', 'state C']) coordinator.request(snapshotOf(renamed(base, name)));
  advance(400);
  assert.strictEqual(storage.writes, 1);
  assert.strictEqual(storage.stored().workspaces[0].name, 'state C');
  console.log('✓ B. Latest snapshot (C) is the one persisted');
}

// C. Explicit flush
{
  const { storage, coordinator } = setup();
  coordinator.request(snapshotOf(renamed(base, 'finalized')));
  coordinator.flush();
  assert.strictEqual(storage.writes, 1, 'flush writes the pending state immediately');
  assert.strictEqual(storage.stored().workspaces[0].name, 'finalized');
  advance(1000);
  assert.strictEqual(storage.writes, 1, 'the cancelled timer does not write again');
  console.log('✓ C. Explicit flush writes pending state once, immediately');
}

// D. No unnecessary write
{
  const { storage, coordinator } = setup();
  coordinator.flush();
  assert.strictEqual(storage.writes, 0, 'flush with nothing pending does not write');
  const snap = snapshotOf(base);
  coordinator.request(snap);
  coordinator.flush();
  assert.strictEqual(storage.writes, 1);
  // A re-render that only rebuilds the array ([...prev]) keeps every workspace reference.
  coordinator.request({ ...snap, workspaces: [...snap.workspaces] });
  coordinator.flush();
  coordinator.request({ ...snap, workspaces: [...snap.workspaces] });
  advance(400);
  assert.strictEqual(storage.writes, 1, 'reference-identical state is not serialized or written again');
  coordinator.request({ ...snap, activeWorkspaceId: base.workspaces[3].id });
  coordinator.flush();
  assert.strictEqual(storage.writes, 2, 'a real change (active workspace) is written');
  console.log('✓ D. No write without a change; identical re-renders are skipped');
}

// E. Streaming output: one request per 60 ms Capture flush for 6 s
{
  const { storage, coordinator } = setup();
  let state = base;
  const ws0 = state.workspaces[0];
  const running = { ...ws0.capture.blocks[0], id: 'block-streaming', output: '', isComplete: false, completedAt: null, exitCode: null };
  const updates = 100;
  for (let i = 0; i < updates; i++) {
    running.output += `chunk ${i} `.repeat(20);
    const block = { ...running };
    state = {
      ...state,
      workspaces: state.workspaces.map((w, idx) =>
        idx === 0 ? { ...w, capture: { ...w.capture, blocks: [...ws0.capture.blocks, block] } } : w,
      ),
    };
    coordinator.request(snapshotOf(state));
    advance(60);
  }
  coordinator.flush();
  const expectedMax = Math.ceil((updates * 60) / 400) + 1;
  assert.ok(storage.writes <= expectedMax, `${updates} updates must not write ${updates} times (got ${storage.writes}, bound ${expectedMax})`);
  assert.ok(storage.writes >= 2, 'a long stream is still persisted periodically');
  const persistedBlock = storage.stored().workspaces[0].capture.blocks.find((b) => b.id === 'block-streaming');
  assert.strictEqual(persistedBlock.output, running.output, 'the final flush persists the complete output');
  console.log(`✓ E. ${updates} streaming updates → ${storage.writes} writes (bounded cadence), full output persisted`);
}

// F. Structural changes persist and restore
{
  const { storage, coordinator } = setup();
  const reordered = { ...base, workspaces: [base.workspaces[1], base.workspaces[0], ...base.workspaces.slice(2)] };
  coordinator.request(snapshotOf(reordered));
  coordinator.flush();
  let restored = loadPersistedWorkspaceState();
  assert.deepStrictEqual(restored.workspaces.map((w) => w.id), reordered.workspaces.map((w) => w.id), 'reorder');

  const created = { ...base.workspaces[10], id: 'ws-created', name: 'Created' };
  const withCreated = { ...reordered, workspaces: [...reordered.workspaces, created], activeWorkspaceId: 'ws-created' };
  coordinator.request(snapshotOf(withCreated));
  advance(400);
  restored = loadPersistedWorkspaceState();
  assert.strictEqual(restored.workspaces.length, 12, 'create');
  assert.strictEqual(restored.activeWorkspaceId, 'ws-created', 'active workspace');

  const deleted = { ...withCreated, workspaces: withCreated.workspaces.filter((w) => w.id !== 'ws-created'), activeWorkspaceId: base.workspaces[0].id };
  coordinator.request(snapshotOf(deleted));
  advance(400);
  restored = loadPersistedWorkspaceState();
  assert.strictEqual(restored.workspaces.length, 11, 'delete');

  const ws5 = deleted.workspaces.find((w) => w.id === base.workspaces[5].id);
  const tabSwitched = {
    ...deleted,
    workspaces: deleted.workspaces.map((w) => (w === ws5 ? { ...w, activeTerminalTabId: ws5.terminalTabs[2].id } : w)),
  };
  coordinator.request(snapshotOf(tabSwitched));
  advance(400);
  restored = loadPersistedWorkspaceState();
  assert.strictEqual(restored.workspaces.find((w) => w.id === ws5.id).activeTerminalTabId, ws5.terminalTabs[2].id, 'tab switch');
  assert.strictEqual(storage.writes, 4, 'one write per structural change');
  console.log('✓ F. Reorder, create, delete and tab switch persist and restore (one write each)');
}

// G. Existing v1 document restores without migration
{
  const { storage } = setup();
  const doc = createSyntheticPersistedState({ activeIndex: 9 });
  storage.map.set(WORKSPACE_PERSISTENCE_STORAGE_KEY, JSON.stringify(doc));
  const restored = loadPersistedWorkspaceState();
  assert.strictEqual(restored.workspaces.length, 11);
  assert.strictEqual(restored.workspaces.reduce((n, w) => n + w.terminalTabs.length, 0), 21);
  assert.deepStrictEqual(restored.workspaces.map((w) => w.terminalTabs.length), TABS_PER_WORKSPACE);
  assert.strictEqual(restored.activeWorkspaceId, doc.workspaces[9].id);
  const docBlocks = doc.workspaces.flatMap((w) => w.capture.blocks);
  const restoredBlocks = restored.workspaces.flatMap((w) => w.capture.blocks);
  assert.strictEqual(restoredBlocks.length, docBlocks.length, 'Capture history restored');
  assert.deepStrictEqual(restoredBlocks.map((b) => b.output.length), docBlocks.map((b) => b.output.length), 'outputs restored intact');
  assert.strictEqual(storage.writes, 0, 'loading a current v1 document does not rewrite it');
  console.log('✓ G. v1 document (11 workspaces, 21 tabs, 100 KB outputs) restores unchanged, no migration');
}

// H. Storage failure
{
  const { storage, coordinator } = setup();
  const warn = console.warn;
  console.warn = () => {};
  storage.fail = true;
  const state = renamed(base, 'quota');
  assert.doesNotThrow(() => {
    coordinator.request(snapshotOf(state));
    coordinator.flush();
  });
  assert.strictEqual(state.workspaces[0].capture.blocks.length, base.workspaces[0].capture.blocks.length, 'in-memory state untouched');
  storage.fail = false;
  coordinator.request(snapshotOf(state));
  coordinator.flush();
  console.warn = warn;
  assert.strictEqual(storage.writes, 1, 'the same state is written once storage recovers');
  assert.strictEqual(storage.stored().workspaces[0].name, 'quota');
  console.log('✓ H. Storage failure is contained and retried on the next change');
}

// I. Scale: one command lifecycle on the heavy state
{
  const { storage, coordinator } = setup();
  let state = base;
  const ws = state.workspaces[9];
  const updateWs9 = (fn) => {
    state = { ...state, workspaces: state.workspaces.map((w) => (w.id === ws.id ? fn(w) : w)) };
    coordinator.request(snapshotOf(state));
  };
  const block = { ...ws.capture.blocks[0], id: 'block-cmd', output: '', isComplete: false, completedAt: null, exitCode: null };
  updateWs9((w) => ({ ...w, capture: { ...w.capture, blocks: [...w.capture.blocks, block] } })); // command start
  for (let i = 0; i < 4; i++) {
    advance(60);
    updateWs9((w) => ({ ...w, capture: { ...w.capture, blocks: w.capture.blocks.map((b) => (b.id === 'block-cmd' ? { ...b, output: b.output + 'output\n' } : b)) } }));
  }
  updateWs9((w) => ({ ...w, capture: { ...w.capture, blocks: w.capture.blocks.map((b) => (b.id === 'block-cmd' ? { ...b, isComplete: true, completedAt: 1, exitCode: 1 } : b)) } }));
  coordinator.flush(); // finalization boundary
  advance(1000);
  assert.strictEqual(storage.writes, 1, `start + 4 outputs + finalize must cost one full write, got ${storage.writes}`);
  const persisted = storage.stored().workspaces[9].capture.blocks.find((b) => b.id === 'block-cmd');
  assert.strictEqual(persisted.exitCode, 1);
  assert.strictEqual(persisted.output, 'output\n'.repeat(4));
  console.log(`✓ I. 11 workspaces / 21 tabs: 6 state changes for one failed command → 1 full write (was 3)`);
}

// J. App wiring
{
  const app = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  assert.strictEqual(app.includes('savePersistedWorkspaceState('), false, 'App must not write full state directly');
  assert.ok(app.includes('createWorkspacePersistenceCoordinator('));
  assert.match(app, /window\.addEventListener\('pagehide', flush\)/, 'pending state is flushed on unload');
  console.log('✓ J. App writes full state only through the coordinator');
}

// K. Graceful quit: only native Exit fires (no page lifecycle event), so Exit asks for a flush.
{
  const { storage, coordinator } = setup();
  const app = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  assert.match(app, /onAppExitRequested\(flush\)/, 'App hands the coordinator flush to the quit request');
  const main = fs.readFileSync(path.resolve(__dirname, '../native/src/main.rs'), 'utf8');
  assert.match(
    main,
    /RunEvent::Exit[\s\S]*emit\(EVENT_FLUSH_BEFORE_EXIT[\s\S]*sleep\(FLUSH_BEFORE_EXIT_GRACE\)[\s\S]*close_all_sessions/,
    'native Exit asks for a flush and waits a bounded moment before teardown',
  );

  globalThis.window = globalThis.window ?? globalThis;
  globalThis.window.__TAURI_INTERNALS__ = {};
  const context = loadTs(path.resolve(__dirname, '../app/src/features/workspace/workspaceContext.ts'));
  assert.strictEqual(context.APP_FLUSH_BEFORE_EXIT_EVENT, 'app://flush-before-exit');
  assert.match(main, /EVENT_FLUSH_BEFORE_EXIT: &str = "app:\/\/flush-before-exit"/, 'native and frontend agree on the event');
  const stop = context.onAppExitRequested(() => coordinator.flush());
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const onQuit = tauriStub.listeners.get('app://flush-before-exit');
  assert.ok(onQuit, 'the frontend listens for the quit flush request');

  coordinator.request(snapshotOf(renamed(base, 'changed right before quit')));
  assert.strictEqual(storage.writes, 0, 'change is still pending inside the coalescing window');
  onQuit({});
  assert.strictEqual(storage.writes, 1, 'the quit request writes synchronously');
  assert.strictEqual(storage.stored().workspaces[0].name, 'changed right before quit', 'the pending change is persisted');

  stop();
  assert.strictEqual(tauriStub.listeners.has('app://flush-before-exit'), false, 'unsubscribe stops listening');
  delete globalThis.window.__TAURI_INTERNALS__;
  console.log('✓ K. Quit request writes pending state synchronously before native teardown');
}

setWorkspaceStorageAdapter(null);
console.log('STATE-PERSISTENCE-SCALE-001 tests passed.');
