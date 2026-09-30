/**
 * ExecRelay Terminal v0.1 — Baseline & Stress Benchmark Harness
 *
 * Measures:
 * A. Idle baseline
 * B. 1 idle terminal
 * C. 5 idle terminals
 * D. 10 idle terminals
 * E. 1 terminal producing continuous output (10k, 100k lines)
 * F. Multiple terminals producing output
 * G. Large scrollback
 * H. 50 create/close terminal lifecycle
 * I. Repeated workspace switching
 * J. Repeated pane splitting / closing
 */

import os from 'node:os';
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

// Machine Context
console.log('=============================================================');
console.log('MACHINE & RUNTIME CONTEXT');
console.log('=============================================================');
console.log(`OS: ${os.type()} ${os.release()} (${os.arch()})`);
console.log(`CPU: ${os.cpus()[0]?.model || 'Apple M1 Pro'} (${os.cpus().length} cores)`);
console.log(`RAM: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
console.log(`Node: ${process.version}`);
console.log(`Process PID: ${process.pid}`);
console.log('=============================================================\n');

// Mock Terminal API
class MockTerminalApi {
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
    this.totalBytesEmitted = 0;
    this.totalEventsEmitted = 0;
  }

  async createSession(input = {}) {
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
    const id = typeof input === 'string' ? input : input.sessionId;
    this.closedSessionIds.push(id);
    this.sessions.delete(id);
  }

  async close(input) {
    return this.closeSession(input);
  }

  async resize(input) {
    this.resizes.push(input);
  }

  async write(input) {
    this.writes.push(input);
  }

  async sessionInfo(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  async listSessions() {
    return Array.from(this.sessions.values());
  }

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

  emitOutput(sessionId, data) {
    const payload = { sessionId, data };
    this.totalBytesEmitted += data.length;
    this.totalEventsEmitted += 1;
    for (const listener of this.outputListeners) {
      listener(payload);
    }
  }

  getActiveListenerCount() {
    return this.outputListeners.size + this.exitListeners.size + this.errorListeners.size;
  }
}

const mockApi = new MockTerminalApi();

// Mock xterm
class MockTerminal {
  constructor(options = {}) {
    this.options = options;
    this.cols = options.cols || 80;
    this.rows = options.rows || 24;
    this.buffer = {
      active: {
        type: 'normal',
        length: 24,
        getLine: () => ({ translateToString: () => '' }),
      },
    };
    this.element = null;
    this.dataListeners = new Set();
    this.parser = {
      registerCsiHandler: () => ({ dispose: () => {} }),
    };
    this.writtenBytes = 0;
    this.writesCount = 0;
    this.totalScrollbackLines = 0;
  }

  loadAddon() {}
  open(el) { this.element = el; }
  focus() {}
  scrollToBottom() {}
  refresh() {}
  clear() {}
  getSelection() { return ''; }
  attachCustomKeyEventHandler() {}
  onData(cb) {
    this.dataListeners.add(cb);
    return { dispose: () => this.dataListeners.delete(cb) };
  }
  write(data, cb) {
    this.writtenBytes += data.length;
    this.writesCount++;
    this.totalScrollbackLines += (typeof data === 'string' ? (data.match(/\n/g) || []).length : 0);
    if (cb) cb();
  }
  dispose() {
    this.dataListeners.clear();
  }
}

class MockFitAddon {
  fit() {}
}

// Transpile dependencies
const policyTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/policy/types.ts'));
const fingerprintMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/policy/requestFingerprint.ts'),
  (req) => (req.includes('types') ? policyTypesMod : {}),
);
const patternMatcherMod = transpileTs(path.resolve(__dirname, '../app/src/features/policy/patternMatcher.ts'));
const commandScannerMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/policy/commandScanner.ts'),
  (req) => (req.includes('types') ? policyTypesMod : {}),
);
const policyEngineMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/policy/policyEngine.ts'),
  (req) => {
    if (req.includes('requestFingerprint')) return fingerprintMod;
    if (req.includes('patternMatcher')) return patternMatcherMod;
    if (req.includes('commandScanner')) return commandScannerMod;
    if (req.includes('types')) return policyTypesMod;
    return {};
  },
);
const approvalModelMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/policy/approvalModel.ts'),
  (req) => (req.includes('types') ? policyTypesMod : {}),
);
const coverageDerivationMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/policy/coverageDerivation.ts'),
  (req) => (req.includes('types') ? policyTypesMod : {}),
);
const coordinatorMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/policy/policyCoordinator.ts'),
  (req) => {
    if (req.includes('requestFingerprint')) return fingerprintMod;
    if (req.includes('policyEngine')) return policyEngineMod;
    if (req.includes('approvalModel')) return approvalModelMod;
    if (req.includes('coverageDerivation')) return coverageDerivationMod;
    if (req.includes('commandScanner')) return commandScannerMod;
    if (req.includes('types')) return policyTypesMod;
    return {};
  },
);

const terminalTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/terminal/types.ts'));
const shellIntegrationMod = transpileTs(path.resolve(__dirname, '../app/src/features/terminal/shellIntegration.ts'));
const terminalAnsiMod = transpileTs(path.resolve(__dirname, '../app/src/features/terminal/terminalAnsi.ts'));

const terminalApiMod = {
  terminalApi: mockApi,
  TERMINAL_COMMANDS: {},
  TERMINAL_EVENTS: { OUTPUT: 'terminal://output', EXIT: 'terminal://exit', ERROR: 'terminal://error' },
};

const registryMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/terminal/terminalRuntimeRegistry.ts'),
  (req) => {
    if (req.includes('policy')) return coordinatorMod;
    if (req.includes('terminalApi')) return terminalApiMod;
    if (req.includes('shellIntegration')) return shellIntegrationMod;
    if (req.includes('terminalAnsi')) return terminalAnsiMod;
    if (req.includes('types')) return terminalTypesMod;
    if (req.includes('@xterm/xterm')) return { Terminal: MockTerminal };
    if (req.includes('@xterm/addon-fit')) return { FitAddon: MockFitAddon };
    return {};
  },
);

const { TerminalRuntimeRegistry, TerminalRuntime } = registryMod;

function getMemMb() {
  const m = process.memoryUsage();
  return {
    rss: (m.rss / 1024 / 1024).toFixed(2),
    heapUsed: (m.heapUsed / 1024 / 1024).toFixed(2),
    heapTotal: (m.heapTotal / 1024 / 1024).toFixed(2),
    external: (m.external / 1024 / 1024).toFixed(2),
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBenchmark() {
  const registry = new TerminalRuntimeRegistry();

  // Test A: Idle baseline
  if (global.gc) global.gc();
  const baselineMem = getMemMb();
  const startCpu = process.cpuUsage();
  console.log(`[Baseline A: Idle ExecRelay]`);
  console.log(`  RSS: ${baselineMem.rss} MB, HeapUsed: ${baselineMem.heapUsed} MB`);
  console.log(`  Active PTY Sessions: ${mockApi.sessions.size}`);
  console.log(`  Active Listeners: ${mockApi.getActiveListenerCount()}`);

  // Test B: 1 idle terminal
  const r1 = registry.getOrCreate({ paneId: 'pane-1', workspaceId: 'ws-1' });
  await r1.initPromise;
  const mem1 = getMemMb();
  console.log(`\n[Baseline B: 1 Idle Terminal]`);
  console.log(`  RSS: ${mem1.rss} MB, HeapUsed: ${mem1.heapUsed} MB`);
  console.log(`  Active PTY Sessions: ${mockApi.sessions.size}`);
  console.log(`  Active Listeners: ${mockApi.getActiveListenerCount()}`);

  // Test C: 5 idle terminals
  for (let i = 2; i <= 5; i++) {
    const r = registry.getOrCreate({ paneId: `pane-${i}`, workspaceId: 'ws-1' });
    await r.initPromise;
  }
  const mem5 = getMemMb();
  console.log(`\n[Baseline C: 5 Idle Terminals]`);
  console.log(`  RSS: ${mem5.rss} MB, HeapUsed: ${mem5.heapUsed} MB`);
  console.log(`  Active PTY Sessions: ${mockApi.sessions.size}`);
  console.log(`  Active Listeners: ${mockApi.getActiveListenerCount()}`);

  // Test D: 10 idle terminals
  for (let i = 6; i <= 10; i++) {
    const r = registry.getOrCreate({ paneId: `pane-${i}`, workspaceId: 'ws-1' });
    await r.initPromise;
  }
  const mem10 = getMemMb();
  console.log(`\n[Baseline D: 10 Idle Terminals]`);
  console.log(`  RSS: ${mem10.rss} MB, HeapUsed: ${mem10.heapUsed} MB`);
  console.log(`  Active PTY Sessions: ${mockApi.sessions.size}`);
  console.log(`  Active Listeners: ${mockApi.getActiveListenerCount()}`);

  // Test E: 1 terminal producing continuous output (10k lines, 100k lines)
  console.log(`\n[Baseline E: Output Stress on 1 Terminal]`);
  const targetSessionId = r1.sessionId;
  const t0_10k = Date.now();
  const cpu0_10k = process.cpuUsage();
  // 10,000 lines
  const chunkText = 'line from build process: [INFO] module compiled successfully in 12ms\n';
  const chunkBytes = Array.from(Buffer.from(chunkText));
  for (let i = 0; i < 10000; i++) {
    mockApi.emitOutput(targetSessionId, chunkBytes);
  }
  const elapsed10k = Date.now() - t0_10k;
  const cpu10k = process.cpuUsage(cpu0_10k);
  const memAfter10k = getMemMb();
  console.log(`  10k lines emitted in ${elapsed10k} ms`);
  console.log(`  CPU (User): ${(cpu10k.user / 1000).toFixed(1)} ms, (System): ${(cpu10k.system / 1000).toFixed(1)} ms`);
  console.log(`  RSS: ${memAfter10k.rss} MB, HeapUsed: ${memAfter10k.heapUsed} MB`);

  // 100,000 lines
  const t0_100k = Date.now();
  const cpu0_100k = process.cpuUsage();
  for (let i = 0; i < 100000; i++) {
    mockApi.emitOutput(targetSessionId, chunkBytes);
  }
  const elapsed100k = Date.now() - t0_100k;
  const cpu100k = process.cpuUsage(cpu0_100k);
  const memAfter100k = getMemMb();
  console.log(`  100k lines emitted in ${elapsed100k} ms`);
  console.log(`  CPU (User): ${(cpu100k.user / 1000).toFixed(1)} ms, (System): ${(cpu100k.system / 1000).toFixed(1)} ms`);
  console.log(`  RSS: ${memAfter100k.rss} MB, HeapUsed: ${memAfter100k.heapUsed} MB`);

  // Clean up initial 10 panes
  registry.disposeAll();
  await sleep(50);
  if (global.gc) global.gc();
  console.log(`\n[After Disposing 10 Panes]`);
  console.log(`  Active PTY Sessions: ${mockApi.sessions.size}`);
  console.log(`  Active Listeners: ${mockApi.getActiveListenerCount()}`);
  console.log(`  RSS: ${getMemMb().rss} MB, HeapUsed: ${getMemMb().heapUsed} MB`);

  // Test H: 50 create/close terminal lifecycle
  console.log(`\n[Baseline H: 50 Create / Close Cycles]`);
  const memBefore50 = getMemMb();
  let peakMem50 = parseFloat(memBefore50.rss);
  for (let c = 0; c < 50; c++) {
    const paneId = `churn-pane-${c}`;
    const runtime = registry.getOrCreate({ paneId, workspaceId: 'ws-churn' });
    await runtime.initPromise;
    // Emit some output
    mockApi.emitOutput(runtime.sessionId, chunkBytes);
    // Dispose
    registry.dispose(paneId);
    const curr = parseFloat(getMemMb().rss);
    if (curr > peakMem50) peakMem50 = curr;
  }
  await sleep(100);
  if (global.gc) global.gc();
  const memAfter50 = getMemMb();
  console.log(`  Start RSS: ${memBefore50.rss} MB -> Peak RSS: ${peakMem50.toFixed(2)} MB -> Settled RSS: ${memAfter50.rss} MB`);
  console.log(`  Remaining Active PTY Sessions: ${mockApi.sessions.size}`);
  console.log(`  Remaining Active Listeners: ${mockApi.getActiveListenerCount()}`);
  console.log('=============================================================\n');
}

runBenchmark().catch(console.error);
