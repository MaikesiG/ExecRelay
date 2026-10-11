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

// 1. Mock Terminal API Bridge with Controllable Failure Faults
class ConfigurableMockTerminalApi {
  constructor() {
    this.sessions = new Map();
    this.sessionCounter = 1;
    this.outputListeners = new Set();
    this.exitListeners = new Set();
    this.errorListeners = new Set();
    this.closedSessionIds = [];
    this.createdSessionIds = [];
    this.resizes = [];
    this.writes = [];

    // Fault injection hooks
    this.failCreate = false;
    this.failCreateError = new Error('PTY spawn failed');
    this.failWrite = false;
    this.failWriteError = new Error('Write pipe broken');
    this.failResize = false;
    this.failResizeError = new Error('TIOCSWINSZ failed');
    this.failClose = false;
    this.failCloseError = new Error('close failed: EIO');

    this.failOnOutput = false;
    this.failOnOutputError = new Error('Output listener registration rejected');
    this.failOnExit = false;
    this.failOnExitError = new Error('Exit listener registration rejected');
    this.failOnError = false;
    this.failOnErrorError = new Error('Error listener registration rejected');
  }

  async createSession(input = {}) {
    if (this.failCreate) {
      throw this.failCreateError;
    }
    const sessionId = `mock-sess-${this.sessionCounter++}`;
    const info = {
      sessionId,
      shell: '/bin/zsh',
      shellKind: input.shellKind || 'zsh',
      status: 'running',
      cwd: input.cwd || '/workspace',
      cols: input.cols || 80,
      rows: input.rows || 24,
      integrationNonce: input.integrationNonce || 'mock-nonce',
    };
    this.sessions.set(sessionId, info);
    this.createdSessionIds.push(sessionId);
    return info;
  }

  async closeSession(input) {
    if (this.failClose) {
      throw this.failCloseError;
    }
    const id = typeof input === 'string' ? input : input.sessionId;
    this.closedSessionIds.push(id);
    this.sessions.delete(id);
  }

  async close(input) {
    return this.closeSession(input);
  }

  async resize(input) {
    if (this.failResize) {
      throw this.failResizeError;
    }
    this.resizes.push(input);
  }

  async write(input) {
    if (this.failWrite) {
      throw this.failWriteError;
    }
    this.writes.push(input);
  }

  async sessionInfo(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  async listSessions() {
    return Array.from(this.sessions.values());
  }

  async onOutput(cb) {
    if (this.failOnOutput) {
      throw this.failOnOutputError;
    }
    this.outputListeners.add(cb);
    return () => this.outputListeners.delete(cb);
  }

  async onExit(cb) {
    if (this.failOnExit) {
      throw this.failOnExitError;
    }
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  async onError(cb) {
    if (this.failOnError) {
      throw this.failOnErrorError;
    }
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  emitOutput(sessionId, data) {
    for (const cb of Array.from(this.outputListeners)) {
      cb({ sessionId, data });
    }
  }

  emitExit(sessionId, exitCode = 0, reason = 'exited') {
    for (const cb of Array.from(this.exitListeners)) {
      cb({ sessionId, exitCode, reason });
    }
  }

  emitError(sessionId, code, message, operation = 'read') {
    for (const cb of Array.from(this.errorListeners)) {
      cb({ sessionId, code, message, operation });
    }
  }
}

const mockApi = new ConfigurableMockTerminalApi();

// Mock xterm
const xtermPkg = require('../app/node_modules/@xterm/xterm/lib/xterm.js');
const { Terminal } = xtermPkg;

class MockTerminal extends Terminal {
  constructor(opts) {
    super({ rows: 10, cols: 60 });
    this._cols = 60;
    this._rows = 10;
    this._mockElement = null;
    this.disposedCount = 0;
    this._onDataListeners = new Set();
    this.writtenData = [];
    Object.defineProperty(this, 'element', {
      get: () => this._mockElement,
      configurable: true,
    });
  }
  get cols() {
    return this._cols ?? 60;
  }
  get rows() {
    return this._rows ?? 10;
  }
  resize(cols, rows) {
    this._cols = cols;
    this._rows = rows;
  }
  open(container) {
    this._mockElement = {
      parentElement: container,
      insertAdjacentElement: () => {},
      appendChild: () => {},
      removeChild: () => {},
      classList: { add: () => {}, remove: () => {} },
    };
    container.appendChild?.(this._mockElement);
  }
  write(data, cb) {
    this.writtenData.push(data);
    cb?.();
  }
  dispose() {
    this.disposedCount++;
    super.dispose();
  }
  onData(cb) {
    this._onDataListeners.add(cb);
    const disp = super.onData(cb);
    return {
      dispose: () => {
        this._onDataListeners.delete(cb);
        disp.dispose();
      },
    };
  }
  simulateInput(data) {
    for (const cb of Array.from(this._onDataListeners)) {
      cb(data);
    }
  }
}

// Mock ResizeObserver
class MockResizeObserver {
  static instances = new Set();
  constructor(callback) {
    this.callback = callback;
    this.observedElements = new Set();
    MockResizeObserver.instances.add(this);
  }
  observe(target) {
    this.observedElements.add(target);
  }
  unobserve(target) {
    this.observedElements.delete(target);
  }
  disconnect() {
    this.observedElements.clear();
    MockResizeObserver.instances.delete(this);
  }
}
globalThis.ResizeObserver = MockResizeObserver;

// Transpile Terminal Runtime Registry
const terminalTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/terminal/types.ts'));
const shellIntegrationMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/terminal/shellIntegration.ts'),
);
const terminalAnsiMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/terminal/terminalAnsi.ts'),
);

const registryMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/terminal/terminalRuntimeRegistry.ts'),
  (req) => {
    if (req.includes('terminalApi')) return { terminalApi: mockApi };
    if (req.includes('types')) return terminalTypesMod;
    if (req.includes('shellIntegration')) return shellIntegrationMod;
    if (req.includes('terminalAnsi')) return terminalAnsiMod;
    if (req === '@xterm/xterm') return { Terminal: MockTerminal };
    if (req === '@xterm/addon-fit') {
      return {
        FitAddon: class MockFitAddon {
          activate() {}
          fit() {}
          dispose() {}
        },
      };
    }
    return {};
  },
);

const { TerminalRuntimeRegistry, TerminalRuntime } = registryMod;

console.log('Running ExecRelay HARDENING-003B Failure-Isolation Proof Suite...\\n');

let totalAssertions = 0;
function passAssert(cond, msg) {
  assert.ok(cond, msg);
  totalAssertions++;
}

// Helper to settle async microtasks
const settle = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

// =============================================================================
// Test 1: Terminal Create Reject
// =============================================================================
console.log('--- Test 1: Terminal Create Reject ---');
{
  const registry = new TerminalRuntimeRegistry();
  mockApi.failCreate = true;
  mockApi.failCreateError = new Error('PTY spawn failed');

  const runtime = registry.getOrCreate({
    paneId: 'p-create-fail',
    workspaceId: 'ws-1',
  });
  const info = await runtime.initPromise;

  passAssert(info === null, 'Session info must be null on create rejection');
  passAssert(runtime.status === 'error', 'Status must transition to error');
  passAssert(runtime.sessionId === null, 'sessionId must remain null');
  passAssert(runtime.errorMessage?.includes('PTY spawn failed'), 'Error message must reflect spawn failure');
  passAssert(registry.boundSessionCount === 0, 'No bound session in registry');
  passAssert(registry.pendingSessionCount === 0, 'No orphan pending session in registry');
  passAssert(registry.has('p-create-fail'), 'Pane exists in registry map');

  mockApi.failCreate = false;
  registry.disposeAll();
  console.log('✓ Create rejection transitions to error, sessionId remains null, no orphan pending ownership');
}

// =============================================================================
// Test 2: Terminal Write Reject Does Not Kill Session
// =============================================================================
console.log('\\n--- Test 2: Terminal Write Reject Does Not Kill Session ---');
{
  const registry = new TerminalRuntimeRegistry();
  let sessionEndedCount = 0;
  let statusChangeCount = 0;

  const runtime = registry.getOrCreate({
    paneId: 'p-write-fail',
    workspaceId: 'ws-1',
    onSessionEnded: () => {
      sessionEndedCount++;
    },
    onStatusChange: (status) => {
      statusChangeCount++;
    },
  });
  await runtime.initPromise;
  passAssert(runtime.status === 'running', 'Runtime must be running initially');

  mockApi.failWrite = true;
  mockApi.failWriteError = new Error('EPIPE write failed');

  // Trigger write via terminal onData
  runtime.terminal.simulateInput('ls\n');
  await settle();

  passAssert(runtime.status === 'running', 'Runtime must remain running after write rejection');
  passAssert(sessionEndedCount === 0, 'onSessionEnded must NOT be called on write failure');
  passAssert(runtime.errorMessage?.includes('Write failed: EPIPE write failed'), 'errorMessage reflects write rejection');

  // Recovery: subsequent write can succeed
  mockApi.failWrite = false;
  runtime.terminal.simulateInput('pwd\n');
  await settle();
  passAssert(runtime.status === 'running', 'Runtime continues running after subsequent write');

  registry.disposeAll();
  console.log('✓ Write rejection reports bounded error, does not kill session, operations can continue');
}

// =============================================================================
// Test 3: Terminal Resize Reject Does Not Kill Session
// =============================================================================
console.log('\\n--- Test 3: Terminal Resize Reject Does Not Kill Session ---');
{
  const registry = new TerminalRuntimeRegistry();
  let sessionEndedCount = 0;

  const runtime = registry.getOrCreate({
    paneId: 'p-resize-fail',
    workspaceId: 'ws-1',
    onSessionEnded: () => {
      sessionEndedCount++;
    },
  });
  await runtime.initPromise;
  passAssert(runtime.status === 'running', 'Runtime must be running');

  mockApi.failResize = true;
  mockApi.failResizeError = new Error('TIOCSWINSZ failed');

  // Mutate dimensions to trigger refit dispatch
  runtime.terminal.resize(120, 40);
  runtime.refit();
  await settle();

  passAssert(runtime.status === 'running', 'Runtime must remain running after resize rejection');
  passAssert(sessionEndedCount === 0, 'onSessionEnded must NOT be called on resize failure');
  passAssert(runtime.errorMessage?.includes('Resize failed: TIOCSWINSZ failed'), 'errorMessage reports resize rejection');

  mockApi.failResize = false;
  registry.disposeAll();
  console.log('✓ Resize rejection reports bounded failure without killing session');
}

// =============================================================================
// Test 4: Terminal Close Reject Does Not Resurrect Owner
// =============================================================================
console.log('\\n--- Test 4: Terminal Close Reject Does Not Resurrect Owner ---');
{
  const registry = new TerminalRuntimeRegistry();
  const runtime = registry.getOrCreate({
    paneId: 'p-close-fail',
    workspaceId: 'ws-1',
  });
  await runtime.initPromise;
  const sessId = runtime.sessionId;
  passAssert(sessId !== null, 'Session ID allocated');

  mockApi.failClose = true;
  mockApi.failCloseError = new Error('Close failed: permission denied');

  // Logical dispose
  registry.dispose('p-close-fail');
  await settle();

  passAssert(runtime.isDisposed === true, 'Runtime isDisposed must be true');
  passAssert(registry.has('p-close-fail') === false, 'Registry no longer has pane');
  passAssert(registry.getBySessionId(sessId) === undefined, 'Registry no longer maps sessionId');
  passAssert(registry.boundSessionCount === 0, 'No bound sessions remain');

  // Subsequent output/exit to closed session is ignored and does NOT resurrect runtime
  const writtenBefore = runtime.terminal.writtenData.length;
  mockApi.emitOutput(sessId, [1, 2, 3]);
  mockApi.emitExit(sessId, 0);

  passAssert(runtime.terminal.writtenData.length === writtenBefore, 'Output after dispose not written to terminal');
  passAssert(registry.has('p-close-fail') === false, 'Runtime does not reappear in registry');
  passAssert(registry.getBySessionId(sessId) === undefined, 'Session does not resurrect in registry');
  passAssert(runtime.isDisposed === true, 'Runtime remains disposed');

  mockApi.failClose = false;
  registry.disposeAll();
  console.log('✓ Close rejection cleanly keeps runtime disposed without resurrection');
}

// =============================================================================
// Test 5: Duplicate Exit is Idempotent
// =============================================================================
console.log('\\n--- Test 5: Duplicate Exit is Idempotent ---');
{
  const registry = new TerminalRuntimeRegistry();
  let endCount = 0;
  let lastStatus = null;

  const runtime = registry.getOrCreate({
    paneId: 'p-dup-exit',
    workspaceId: 'ws-1',
    onSessionEnded: (status) => {
      endCount++;
      lastStatus = status;
    },
  });
  await runtime.initPromise;
  const sessId = runtime.sessionId;

  // First exit
  mockApi.emitExit(sessId, 0);
  passAssert(runtime.status === 'exited', 'Status transitions to exited');
  passAssert(endCount === 1, 'onSessionEnded dispatched exactly once');
  passAssert(lastStatus === 'exited', 'End status is exited');

  // Duplicate exit
  mockApi.emitExit(sessId, 0);
  passAssert(runtime.status === 'exited', 'Status remains exited');
  passAssert(endCount === 1, 'Duplicate exit is idempotent (onSessionEnded not re-triggered)');

  registry.disposeAll();
  console.log('✓ Duplicate exit is idempotent and does not emit duplicate termination events');
}

// =============================================================================
// Test 6: Late Exit After Disposal Ignored
// =============================================================================
console.log('\\n--- Test 6: Late Exit After Disposal Ignored ---');
{
  const registry = new TerminalRuntimeRegistry();
  const runtime = registry.getOrCreate({
    paneId: 'p-late-exit',
    workspaceId: 'ws-1',
  });
  await runtime.initPromise;
  const sessId = runtime.sessionId;

  // Unbind / dispose pane
  registry.dispose('p-late-exit');
  passAssert(registry.hasEarlyExit(sessId) === false, 'No early exit before late event');

  // Emit late exit for disposed session
  mockApi.emitExit(sessId, 1);

  passAssert(registry.hasEarlyExit(sessId) === false, 'Late exit must NOT be buffered in earlyExitEvents');
  passAssert(registry.earlyExitCount === 0, 'earlyExitEvents size must remain 0');
  passAssert(registry.boundSessionCount === 0, 'No bound sessions created');

  registry.disposeAll();
  console.log('✓ Late exit after unbind is ignored and not retained in memory');
}

// =============================================================================
// Test 7: Late Output After Disposal Ignored
// =============================================================================
console.log('\\n--- Test 7: Late Output After Disposal Ignored ---');
{
  const registry = new TerminalRuntimeRegistry();
  const runtime = registry.getOrCreate({
    paneId: 'p-late-output',
    workspaceId: 'ws-1',
  });
  await runtime.initPromise;
  const sessId = runtime.sessionId;

  // Unbind / dispose pane
  registry.dispose('p-late-output');
  passAssert(registry.hasEarlyOutput(sessId) === false, 'No early output before late event');

  // Emit late output for disposed session
  mockApi.emitOutput(sessId, [65, 66, 67, 10]);

  passAssert(registry.hasEarlyOutput(sessId) === false, 'Late output must NOT be buffered in earlyOutputBuffer');
  passAssert(registry.earlyOutputSessionCount === 0, 'earlyOutputBuffer size must remain 0');
  passAssert(registry.boundSessionCount === 0, 'No bound sessions created');

  registry.disposeAll();
  console.log('✓ Late output after unbind is safely discarded without memory accumulation');
}

// =============================================================================
// Test 8: Arbitrary Unknown Output Not Buffered / Routed
// =============================================================================
console.log('\\n--- Test 8: Arbitrary Unknown Output Not Buffered / Routed ---');
{
  const registry = new TerminalRuntimeRegistry();
  await registry.ensureGlobalListeners();
  passAssert(registry.areGlobalListenersInitialized(), 'Global listeners initialized');

  const unknownSessionId = 'totally-unknown-session-xyz-999';
  mockApi.emitOutput(unknownSessionId, [0xde, 0xad, 0xbe, 0xef]);

  passAssert(registry.hasEarlyOutput(unknownSessionId) === false, 'Unknown output must NOT be buffered');
  passAssert(registry.earlyOutputSessionCount === 0, 'earlyOutputBuffer count must be 0');
  passAssert(registry.boundSessionCount === 0, 'No bound session created');

  registry.disposeAll();
  console.log('✓ Arbitrary unknown session output is safely discarded and unbuffered');
}

// =============================================================================
// Test 9: Arbitrary Unknown Exit Not Buffered / Routed
// =============================================================================
console.log('\\n--- Test 9: Arbitrary Unknown Exit Not Buffered / Routed ---');
{
  const registry = new TerminalRuntimeRegistry();
  await registry.ensureGlobalListeners();

  const unknownSessionId = 'totally-unknown-exit-session-888';
  mockApi.emitExit(unknownSessionId, 137);

  passAssert(registry.hasEarlyExit(unknownSessionId) === false, 'Unknown exit must NOT be buffered');
  passAssert(registry.earlyExitCount === 0, 'earlyExitEvents count must be 0');

  registry.disposeAll();
  console.log('✓ Arbitrary unknown session exit is safely discarded and unbuffered');
}

// =============================================================================
// Test 10: Legitimate Early Output Still Buffered and Delivered
// =============================================================================
console.log('\\n--- Test 10: Legitimate Early Output Still Buffered and Delivered ---');
{
  const registry = new TerminalRuntimeRegistry();
  await registry.ensureGlobalListeners();

  const legitimatePendingId = 'legit-pending-session-10';

  // Mark session as pending creation/bind
  registry.markPendingSession(legitimatePendingId);
  passAssert(registry.isPendingSession(legitimatePendingId) === true, 'Session marked pending');
  passAssert(registry.pendingSessionCount === 1, 'Pending session count is 1');

  // Native PTY emits output before bindSession completes
  const rawBytes = [0x48, 0x65, 0x6c, 0x6c, 0x6f]; // "Hello"
  mockApi.emitOutput(legitimatePendingId, rawBytes);

  passAssert(registry.hasEarlyOutput(legitimatePendingId) === true, 'Early output buffered for pending session');
  passAssert(registry.earlyOutputSessionCount === 1, 'earlyOutputSessionCount is 1');

  // Now create and bind runtime
  const runtime = new TerminalRuntime({ paneId: 'p-early-output', workspaceId: 'ws-1' }, registry);
  runtime.sessionId = legitimatePendingId;
  runtime.status = 'starting';

  registry.bindSession(legitimatePendingId, runtime);

  passAssert(registry.isPendingSession(legitimatePendingId) === false, 'Pending marker cleared on bind');
  passAssert(registry.hasEarlyOutput(legitimatePendingId) === false, 'Early output buffer drained');
  passAssert(registry.earlyOutputSessionCount === 0, 'earlyOutputSessionCount returns to 0');
  passAssert(runtime.terminal.writtenData.length > 0, 'Buffered output written to terminal instance');

  registry.disposeAll();
  console.log('✓ Legitimate early output buffered during pending creation and delivered on bind');
}

// =============================================================================
// Test 11: Legitimate Early Exit Still Reconciled
// =============================================================================
console.log('\\n--- Test 11: Legitimate Early Exit Still Reconciled ---');
{
  const registry = new TerminalRuntimeRegistry();
  await registry.ensureGlobalListeners();

  const legitimateExitId = 'legit-early-exit-11';
  registry.markPendingSession(legitimateExitId);

  // Early exit before bind
  mockApi.emitExit(legitimateExitId, 0);

  passAssert(registry.hasEarlyExit(legitimateExitId) === true, 'Early exit buffered for pending session');
  passAssert(registry.earlyExitCount === 1, 'earlyExitCount is 1');

  // Bind runtime
  const runtime = new TerminalRuntime({ paneId: 'p-early-exit', workspaceId: 'ws-1' }, registry);
  runtime.sessionId = legitimateExitId;
  runtime.status = 'starting';

  registry.bindSession(legitimateExitId, runtime);

  passAssert(runtime.status === 'exited', 'Status transitioned to exited on bind');
  passAssert(registry.hasEarlyExit(legitimateExitId) === false, 'Early exit cleared');
  passAssert(registry.earlyExitCount === 0, 'earlyExitCount returns to 0');

  registry.disposeAll();
  console.log('✓ Legitimate early exit buffered during pending creation and reconciled on bind');
}

// =============================================================================
// Test 12: Partial Listener Registration Rolls Back
// =============================================================================
console.log('\\n--- Test 12: Partial Listener Registration Rolls Back ---');
{
  const registry = new TerminalRuntimeRegistry();

  // Attempt 1: onOutput succeeds, onExit succeeds, onError rejects
  mockApi.failOnOutput = false;
  mockApi.failOnExit = false;
  mockApi.failOnError = true;
  mockApi.failOnErrorError = new Error('Error listener registration crashed');

  await registry.ensureGlobalListeners();

  passAssert(registry.areGlobalListenersInitialized() === false, 'Listeners must NOT be marked initialized');
  passAssert(mockApi.outputListeners.size === 0, 'Output listener rolled back (count 0)');
  passAssert(mockApi.exitListeners.size === 0, 'Exit listener rolled back (count 0)');
  passAssert(mockApi.errorListeners.size === 0, 'Error listener count 0');

  const counts = registry.getListenerCounts();
  passAssert(counts.output === 0, 'Registry output listener handle is null');
  passAssert(counts.exit === 0, 'Registry exit listener handle is null');
  passAssert(counts.error === 0, 'Registry error listener handle is null');

  mockApi.failOnError = false;
  registry.disposeAll();
  console.log('✓ Partial listener failure cleanly rolls back attempt-local handles; 0 listeners survive');
}

// =============================================================================
// Test 13: Listener Retry Results in Exactly One of Each Listener
// =============================================================================
console.log('\\n--- Test 13: Listener Retry Results in Exactly One of Each Listener ---');
{
  const registry = new TerminalRuntimeRegistry();

  // Attempt 1: Failure
  mockApi.failOnError = true;
  await registry.ensureGlobalListeners();
  passAssert(registry.areGlobalListenersInitialized() === false);
  passAssert(mockApi.outputListeners.size === 0);
  passAssert(mockApi.exitListeners.size === 0);

  // Attempt 2: All succeed
  mockApi.failOnError = false;
  await registry.ensureGlobalListeners();

  passAssert(registry.areGlobalListenersInitialized() === true, 'Listeners initialized on retry');
  passAssert(mockApi.outputListeners.size === 1, 'Exactly 1 output listener after retry');
  passAssert(mockApi.exitListeners.size === 1, 'Exactly 1 exit listener after retry');
  passAssert(mockApi.errorListeners.size === 1, 'Exactly 1 error listener after retry');

  const counts = registry.getListenerCounts();
  passAssert(counts.output === 1, 'Registry output count 1');
  passAssert(counts.exit === 1, 'Registry exit count 1');
  passAssert(counts.error === 1, 'Registry error count 1');

  // Attempt 3: Idempotent no-op
  await registry.ensureGlobalListeners();
  passAssert(mockApi.outputListeners.size === 1, 'No duplicate listeners on subsequent call');
  passAssert(mockApi.exitListeners.size === 1, 'No duplicate exit listeners on subsequent call');
  passAssert(mockApi.errorListeners.size === 1, 'No duplicate error listeners on subsequent call');

  registry.disposeAll();
  passAssert(mockApi.outputListeners.size === 0, 'Output listeners cleaned on disposeAll');
  passAssert(mockApi.exitListeners.size === 0, 'Exit listeners cleaned on disposeAll');
  passAssert(mockApi.errorListeners.size === 0, 'Error listeners cleaned on disposeAll');
  console.log('✓ Listener retry installs exactly 1 of each listener without leaks or duplicates');
}

// =============================================================================
// Test 14: Parser Throw Still Writes Raw Output
// =============================================================================
console.log('\\n--- Test 14: Parser Throw Still Writes Raw Output ---');
{
  const registry = new TerminalRuntimeRegistry();
  const runtime = registry.getOrCreate({
    paneId: 'p-parser-fail',
    workspaceId: 'ws-1',
  });
  await runtime.initPromise;

  // Corrupt shellParser.parse to throw
  runtime.shellParser.parse = () => {
    throw new Error('Malformed ANSI syntax in parser');
  };

  const rawBytes = [0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x48, 0x69]; // "\x1b[31mHi"
  assert.doesNotThrow(() => {
    runtime.handleOutputBytes(rawBytes);
  }, 'handleOutputBytes must not throw when shellParser fails');

  passAssert(runtime.terminal.writtenData.length > 0, 'Raw output bytes written to terminal despite parser error');

  registry.disposeAll();
  console.log('✓ Shell integration parser failure gracefully falls back to raw terminal output');
}

// =============================================================================
// Test 15: onTerminalInput Throw Still Delivers PTY Write
// =============================================================================
console.log('\\n--- Test 15: onTerminalInput Throw Still Delivers PTY Write ---');
{
  const registry = new TerminalRuntimeRegistry();
  mockApi.writes = [];

  const runtime = registry.getOrCreate({
    paneId: 'p-input-fail',
    workspaceId: 'ws-1',
    onTerminalInput: () => {
      throw new Error('Crashing onTerminalInput observer');
    },
  });
  await runtime.initPromise;

  // Simulate terminal input
  runtime.terminal.simulateInput('echo pty-survives\\n');
  await settle();

  passAssert(mockApi.writes.length > 0, 'PTY write must still be delivered when onTerminalInput throws');
  const lastWrite = mockApi.writes[mockApi.writes.length - 1];
  passAssert(lastWrite.sessionId === runtime.sessionId, 'Write targeted correct sessionId');

  const decoded = new TextDecoder().decode(new Uint8Array(lastWrite.data));
  passAssert(decoded === 'echo pty-survives\\n', 'Delivered bytes match input');

  registry.disposeAll();
  console.log('✓ Observer exception in onTerminalInput does not swallow PTY input write');
}

console.log('\\n=============================================================');
console.log(`ALL 15 HARDENING-003B TESTS PASSED (${totalAssertions} assertions verified)!`);
console.log('=============================================================\\n');
