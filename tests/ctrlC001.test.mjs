/**
 * CTRL-C-001 Test Suite
 *
 * Real failure: a command made the interactive shell itself exit (exit code 1, PTY EOF, no
 * command-end marker). ExecRelay showed nothing, so the pane looked frozen and every later key
 * — Ctrl+C included — was silently dropped. Ctrl+C itself was delivered correctly.
 *
 * Validates:
 * 1. While the shell runs, Ctrl+C reaches the PTY as ETX (0x03).
 * 2. When the shell exits, the terminal says so, with the exit code.
 * 3. After exit, input is not written anywhere and Capture does not receive it.
 * 4. Enter starts a new shell in the same pane (once, even if pressed twice).
 * 5. The new shell receives input, including Ctrl+C; the old session is released.
 */

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

function transpileTs(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

console.log('Running CTRL-C-001 tests...');

class MockTerminalApi {
  constructor() {
    this.sessionCounter = 1;
    this.live = new Set();
    this.outputListeners = new Set();
    this.exitListeners = new Set();
    this.errorListeners = new Set();
    this.created = [];
    this.closed = [];
    this.writes = [];
  }
  async createSession(input = {}) {
    const sessionId = `sess-${this.sessionCounter++}`;
    this.live.add(sessionId);
    this.created.push(sessionId);
    return { sessionId, shell: '/bin/zsh', shellKind: 'zsh', status: 'running', cwd: '/workspace', cols: input.cols || 80, rows: input.rows || 24, integrationNonce: input.integrationNonce };
  }
  async closeSession(input) {
    this.closed.push(input.sessionId);
    this.live.delete(input.sessionId);
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
  emitExit(sessionId, exitCode) {
    this.live.delete(sessionId);
    for (const cb of this.exitListeners) cb({ sessionId, exitCode, reason: 'exited' });
  }
}
const api = new MockTerminalApi();

const { Terminal } = require('../app/node_modules/@xterm/xterm/lib/xterm.js');
class MockTerminal extends Terminal {
  constructor() {
    super({ rows: 10, cols: 60 });
    this.written = '';
  }
  write(data, cb) {
    this.written += data;
    cb?.();
  }
  // Keystrokes go through xterm's own input → onData path (as the keyboard handler does).
  type(data) {
    this.input(data, true);
  }
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const registryMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/terminal/terminalRuntimeRegistry.ts'),
  (req) => {
    if (req.includes('terminalApi')) return { terminalApi: api };
    if (req.includes('types')) return transpileTs(path.resolve(__dirname, '../app/src/features/terminal/types.ts'));
    if (req.includes('shellIntegration')) return transpileTs(path.resolve(__dirname, '../app/src/features/terminal/shellIntegration.ts'));
    if (req.includes('terminalAnsi')) return transpileTs(path.resolve(__dirname, '../app/src/features/terminal/terminalAnsi.ts'));
    if (req === '@xterm/xterm') return { Terminal: MockTerminal };
    if (req === '@xterm/addon-fit') return { FitAddon: class { activate() {} fit() {} dispose() {} } };
    return {};
  },
);

const registry = new registryMod.TerminalRuntimeRegistry();
const captured = [];
const runtime = registry.getOrCreate({
  paneId: 'pane-1',
  workspaceId: 'ws-1',
  terminalTabId: 'tab-1',
  shellKind: 'zsh',
  onTerminalInput: (data) => captured.push(data),
});
await runtime.initPromise;
const first = runtime.sessionId;
const writesTo = (sessionId) => api.writes.filter((w) => w.sessionId === sessionId).map((w) => w.data);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// 1. Ctrl+C while the shell runs
runtime.terminal.type('\x03');
await settle();
assert.deepStrictEqual(writesTo(first), [[0x03]], 'Ctrl+C is written to the PTY as ETX');
console.log('✓ 1. Ctrl+C reaches the PTY as ETX while the shell runs');

// 2. The shell exits on its own (e.g. `set -e` + failing command)
api.emitExit(first, 1);
assert.strictEqual(runtime.status, 'exited');
assert.match(runtime.terminal.written, /\[Shell exited with code 1 — press Enter to start a new shell\]/, 'exit is visible with its code');
console.log('✓ 2. Shell exit is shown in the terminal with its exit code');

// 3. After exit, keys go nowhere (not the PTY, not Capture)
const capturedBefore = captured.length;
runtime.terminal.type('\x03');
runtime.terminal.type('x');
await settle();
assert.deepStrictEqual(writesTo(first), [[0x03]], 'no writes to the exited session');
assert.strictEqual(captured.length, capturedBefore, 'Capture does not receive input for a dead shell');
assert.strictEqual(api.created.length, 1, 'only Enter starts a new shell');
console.log('✓ 3. Input to an exited shell is not written and not captured');

// 4. Enter starts exactly one new shell in the same pane
runtime.terminal.type('\r');
runtime.terminal.type('\r');
await runtime.initPromise;
const second = runtime.sessionId;
assert.strictEqual(api.created.length, 2, 'one new session, even for two Enters');
assert.notStrictEqual(second, first);
assert.strictEqual(runtime.status, 'running');
assert.ok(api.closed.includes(first), 'the exited session is released');
assert.strictEqual(registry.get('pane-1'), runtime, 'same pane, same runtime');
assert.strictEqual(registry.getBySessionId(second), runtime);
assert.strictEqual(registry.getBySessionId(first), undefined);
console.log('✓ 4. Enter starts one new shell in the same pane; the old session is released');

// 5. The new shell is usable and interruptible; a late exit of the old session is ignored
runtime.terminal.type('sleep 30\r');
runtime.terminal.type('\x03');
await settle();
assert.deepStrictEqual(
  writesTo(second).map((d) => String.fromCharCode(...d)),
  ['sleep 30\r', '\x03'],
  'the new shell receives the command and Ctrl+C',
);
api.emitExit(first, 0);
assert.strictEqual(runtime.status, 'running', 'the old session exit does not affect the new shell');
console.log('✓ 5. New shell receives input and Ctrl+C; stale exit events are ignored');

console.log('CTRL-C-001 tests passed.');
