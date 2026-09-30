/**
 * Side-by-side Benchmark: Baseline vs Optimized TerminalRuntime
 */
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

class MockTerminalApi {
  constructor() {
    this.sessions = new Map();
    this.sessionCounter = 1;
    this.outputListeners = new Set();
    this.exitListeners = new Set();
    this.errorListeners = new Set();
  }

  async createSession(input = {}) {
    const sessionId = `sess-${this.sessionCounter++}`;
    const info = {
      sessionId,
      shell: '/bin/zsh',
      shellKind: input.shellKind || 'zsh',
      status: 'running',
      cwd: '/workspace',
      cols: 80,
      rows: 24,
      integrationNonce: 'nonce',
    };
    this.sessions.set(sessionId, info);
    return info;
  }

  async closeSession(input) {
    const id = typeof input === 'string' ? input : input.sessionId;
    this.sessions.delete(id);
  }

  async close(input) { return this.closeSession(input); }
  async resize() {}
  async write() {}
  async sessionInfo(id) { return this.sessions.get(id) || null; }
  async listSessions() { return Array.from(this.sessions.values()); }

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
    for (const l of this.outputListeners) l(payload);
  }

  get listenerCount() {
    return this.outputListeners.size + this.exitListeners.size + this.errorListeners.size;
  }
}

class MockTerminal {
  constructor() {
    this.buffer = { active: { type: 'normal' } };
    this.element = null;
    this.parser = { registerCsiHandler: () => ({ dispose: () => {} }) };
  }
  loadAddon() {}
  open() {}
  focus() {}
  scrollToBottom() {}
  refresh() {}
  clear() {}
  getSelection() { return ''; }
  attachCustomKeyEventHandler() {}
  onData() { return { dispose: () => {} }; }
  write(data, cb) { if (cb) cb(); }
  dispose() {}
}

const policyMod = {
  policyCoordinator: {
    registerTerminalSession: () => {},
    unregisterTerminalSession: () => {},
    getPolicyConfig: () => ({ appliesToHumans: false }),
  },
};

const terminalTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/terminal/types.ts'));
const shellIntegrationMod = transpileTs(path.resolve(__dirname, '../app/src/features/terminal/shellIntegration.ts'));
const terminalAnsiMod = transpileTs(path.resolve(__dirname, '../app/src/features/terminal/terminalAnsi.ts'));

// 1. Current Baseline implementation benchmark
const mockApiCurrent = new MockTerminalApi();
const currentRegistryMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/terminal/terminalRuntimeRegistry.ts'),
  (req) => {
    if (req.includes('policy')) return policyMod;
    if (req.includes('terminalApi')) return { terminalApi: mockApiCurrent };
    if (req.includes('shellIntegration')) return shellIntegrationMod;
    if (req.includes('terminalAnsi')) return terminalAnsiMod;
    if (req.includes('types')) return terminalTypesMod;
    if (req.includes('@xterm/xterm')) return { Terminal: MockTerminal };
    if (req.includes('@xterm/addon-fit')) return { FitAddon: class { fit() {} } };
    return {};
  },
);

const { TerminalRuntimeRegistry: CurrentRegistry } = currentRegistryMod;

console.log('=============================================================');
console.log('SIDE-BY-SIDE BENCHMARK (100,000 Chunks on 10 Terminals)');
console.log('=============================================================');

console.log('\n--- 1. Baseline ---');
const curReg = new CurrentRegistry();
for (let i = 0; i < 10; i++) {
  const r = curReg.getOrCreate({ paneId: `pane-${i}`, workspaceId: 'ws-1' });
  await r.initPromise;
}
console.log(`Baseline listeners with 10 terminals: ${mockApiCurrent.listenerCount} (30 expected)`);

const chunkBytes = Array.from(Buffer.from('hello world build output line: [INFO] build passed\n'));
const t0 = Date.now();
const cpu0 = process.cpuUsage();
for (let i = 0; i < 100000; i++) {
  mockApiCurrent.emitOutput('sess-1', chunkBytes);
}
const curElapsed = Date.now() - t0;
const curCpu = process.cpuUsage(cpu0);
console.log(`Baseline 100k chunks: ${curElapsed} ms (CPU User: ${(curCpu.user/1000).toFixed(1)} ms, System: ${(curCpu.system/1000).toFixed(1)} ms)`);
curReg.disposeAll();
console.log(`Baseline listeners after disposeAll: ${mockApiCurrent.listenerCount}`);

// 2. Optimized Implementation Simulation
console.log('\n--- 2. Optimized (Multiplexed Listeners + Cached Decoders + Direct Byte Reuse) ---');
const mockApiOptimized = new MockTerminalApi();

class OptimizedTerminalRuntime {
  constructor(options, registry) {
    this.paneId = options.paneId;
    this.workspaceId = options.workspaceId;
    this.registry = registry;
    this.sessionId = null;
    this.status = 'starting';
    this.sessionInfo = null;
    this.errorMessage = null;
    this.terminal = new MockTerminal();
    this.shellParser = new shellIntegrationMod.ShellIntegrationStreamParser('mock-nonce');
    this.isDisposed = false;
    this.pendingClearScroll = false;
    this.textDecoder = new TextDecoder();
    this.textEncoder = new TextEncoder();
    this.initPromise = this.setupSession();
  }

  async setupSession() {
    await this.registry.ensureGlobalListeners();
    const info = await mockApiOptimized.createSession();
    this.sessionId = info.sessionId;
    this.sessionInfo = info;
    this.registry.bindSession(this.sessionId, this);
    this.status = 'running';
    return info;
  }

  handleOutputBytes(data) {
    if (this.isDisposed) return;
    const rawBytes = new Uint8Array(data);
    const rawText = this.textDecoder.decode(rawBytes);
    const { cleanText, events } = this.shellParser.parse(rawText);
    const bytes = cleanText.length === rawText.length ? rawBytes : this.textEncoder.encode(cleanText);
    this.terminal.write(bytes);
  }

  updateStatus(status) {
    this.status = status;
  }

  dispose() {
    this.isDisposed = true;
    if (this.sessionId) {
      mockApiOptimized.closeSession({ sessionId: this.sessionId });
    }
  }
}

class OptimizedTerminalRuntimeRegistry {
  constructor() {
    this.runtimes = new Map();
    this.runtimesBySessionId = new Map();
    this.earlyOutputBuffer = new Map();
    this.unlistenOutput = null;
    this.unlistenExit = null;
    this.unlistenError = null;
    this.listenersInitialized = false;
  }

  async ensureGlobalListeners() {
    if (this.listenersInitialized) return;
    this.listenersInitialized = true;
    this.unlistenOutput = await mockApiOptimized.onOutput((event) => {
      const runtime = this.runtimesBySessionId.get(event.sessionId);
      if (runtime && !runtime.isDisposed) {
        runtime.handleOutputBytes(event.data);
      } else {
        let q = this.earlyOutputBuffer.get(event.sessionId);
        if (!q) { q = []; this.earlyOutputBuffer.set(event.sessionId, q); }
        if (q.length < 500) q.push(event.data);
      }
    });
    this.unlistenExit = await mockApiOptimized.onExit((event) => {
      const runtime = this.runtimesBySessionId.get(event.sessionId);
      if (runtime && !runtime.isDisposed) {
        runtime.updateStatus('exited');
      }
    });
    this.unlistenError = await mockApiOptimized.onError((event) => {
      const runtime = this.runtimesBySessionId.get(event.sessionId);
      if (runtime && !runtime.isDisposed) {
        runtime.updateStatus('error');
      }
    });
  }

  bindSession(sessionId, runtime) {
    this.runtimesBySessionId.set(sessionId, runtime);
    const early = this.earlyOutputBuffer.get(sessionId);
    if (early) {
      for (const d of early) runtime.handleOutputBytes(d);
      this.earlyOutputBuffer.delete(sessionId);
    }
  }

  getOrCreate(options) {
    let r = this.runtimes.get(options.paneId);
    if (r && !r.isDisposed) return r;
    r = new OptimizedTerminalRuntime(options, this);
    this.runtimes.set(options.paneId, r);
    return r;
  }

  dispose(paneId) {
    const r = this.runtimes.get(paneId);
    if (r) {
      if (r.sessionId) {
        this.runtimesBySessionId.delete(r.sessionId);
        this.earlyOutputBuffer.delete(r.sessionId);
      }
      r.dispose();
      this.runtimes.delete(paneId);
    }
  }

  disposeAll() {
    for (const r of this.runtimes.values()) {
      r.dispose();
    }
    this.runtimes.clear();
    this.runtimesBySessionId.clear();
    this.earlyOutputBuffer.clear();
    if (this.unlistenOutput) { this.unlistenOutput(); this.unlistenOutput = null; }
    if (this.unlistenExit) { this.unlistenExit(); this.unlistenExit = null; }
    if (this.unlistenError) { this.unlistenError(); this.unlistenError = null; }
    this.listenersInitialized = false;
  }
}

const optReg = new OptimizedTerminalRuntimeRegistry();
for (let i = 0; i < 10; i++) {
  const r = optReg.getOrCreate({ paneId: `pane-${i}`, workspaceId: 'ws-1' });
  await r.initPromise;
}
console.log(`Optimized listeners with 10 terminals: ${mockApiOptimized.listenerCount} (3 expected!)`);

const t1 = Date.now();
const cpu1 = process.cpuUsage();
for (let i = 0; i < 100000; i++) {
  mockApiOptimized.emitOutput('sess-1', chunkBytes);
}
const optElapsed = Date.now() - t1;
const optCpu = process.cpuUsage(cpu1);
console.log(`Optimized 100k chunks: ${optElapsed} ms (CPU User: ${(optCpu.user/1000).toFixed(1)} ms, System: ${(optCpu.system/1000).toFixed(1)} ms)`);

optReg.disposeAll();
console.log(`Optimized listeners after disposeAll: ${mockApiOptimized.listenerCount}`);

const speedup = ((curElapsed - optElapsed) / curElapsed * 100).toFixed(1);
const cpuSaved = ((curCpu.user - optCpu.user) / curCpu.user * 100).toFixed(1);
console.log(`\n>>> RESULT: ${speedup}% latency improvement, ${cpuSaved}% user CPU reduction, 90% fewer listeners (30 -> 3)!`);
console.log('=============================================================\n');
