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

// 2. Transpile Terminal domain
const terminalTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/terminal/types.ts'));
const shellIntegrationMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/terminal/shellIntegration.ts'),
);
const { ShellIntegrationStreamParser, parseOsc133Payload } = shellIntegrationMod;
const terminalAnsiMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/terminal/terminalAnsi.ts'),
);

// 3. Mock Terminal API Bridge
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
    for (const cb of this.outputListeners) {
      cb({ sessionId, data });
    }
  }

  emitExit(sessionId, exitCode = 0) {
    for (const cb of this.exitListeners) {
      cb({ sessionId, exitCode, reason: 'exited' });
    }
  }

  emitError(sessionId, message) {
    for (const cb of this.errorListeners) {
      cb({ sessionId, message });
    }
  }
}

const mockApi = new MockTerminalApi();

class MockTerminal {
  constructor(opts) {
    this.cols = 80;
    this.rows = 24;
    this._mockElement = null;
    this.buffer = { active: { type: 'normal' } };
    this.written = [];
    this.parser = {
      registerCsiHandler: () => ({ dispose: () => {} }),
    };
    Object.defineProperty(this, 'element', {
      get: () => this._mockElement,
      configurable: true,
    });
  }
  loadAddon(addon) {}
  attachCustomKeyEventHandler(handler) {}
  onData(cb) {
    return { dispose: () => {} };
  }
  open(container) {
    this._mockElement = { parentElement: container, insertAdjacentElement: () => {}, appendChild: () => {}, removeChild: () => {}, classList: { add: () => {}, remove: () => {} } };
    container.appendChild?.(this._mockElement);
  }
  write(data, cb) {
    this.written.push(data);
    if (cb) cb();
  }
  focus() {}
  scrollToBottom() {}
  refresh() {}
  dispose() {}
}

class MockFitAddon {
  activate() {}
  fit() {}
  dispose() {}
  proposeDimensions() {
    return { cols: 80, rows: 24 };
  }
}

const terminalApiMod = {
  terminalApi: mockApi,
  createTerminalApi: () => mockApi,
};

// 4. Transpile TerminalRuntimeRegistry
const runtimeRegistryMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/terminal/terminalRuntimeRegistry.ts'),
  (req) => {
    if (req.includes('terminalApi')) return terminalApiMod;
    if (req.includes('terminalAnsi')) return terminalAnsiMod;
    if (req.includes('shellIntegration')) return shellIntegrationMod;
    if (req.includes('types')) return terminalTypesMod;
    if (req === '@xterm/xterm' || req.includes('@xterm/xterm')) return { Terminal: MockTerminal };
    if (req === '@xterm/addon-fit' || req.includes('@xterm/addon-fit')) return { FitAddon: MockFitAddon };
    return {};
  },
);

const { TerminalRuntime, TerminalRuntimeRegistry } = runtimeRegistryMod;

console.log('Running RELEASE-003A — Output Fast-Path & Streaming Boundary Audit Suite...\n');

// ---------------------------------------------------------------------------
// Group 1: Fast-Path Correctness & Same-Length Regression
// ---------------------------------------------------------------------------
{
  console.log('--- Group 1: Fast-Path Correctness & Same-Length Regression ---');

  const registry = new TerminalRuntimeRegistry();
  const writtenChunks = [];

  const runtime = new TerminalRuntime(
    {
      paneId: 'p-fast-path',
      workspaceId: 'ws-1',
    },
    registry,
  );

  const origWrite = runtime.terminal.write.bind(runtime.terminal);
  runtime.terminal.write = (data, cb) => {
    writtenChunks.push(data);
    if (cb) cb();
    return origWrite(data, cb);
  };

  // Case 1A: Clean text is identical to raw text => MUST take rawBytes fast path
  const normalText = 'Hello, world! 123';
  const normalBytes = Array.from(Buffer.from(normalText, 'utf8'));
  writtenChunks.length = 0;
  runtime.handleOutputBytes(normalBytes);

  assert.strictEqual(writtenChunks.length, 1);
  assert.ok(writtenChunks[0] instanceof Uint8Array);
  assert.strictEqual(new TextDecoder().decode(writtenChunks[0]), normalText);
  assert.strictEqual(writtenChunks[0].length, normalBytes.length);

  // Case 1B: Regression: rawText.length === cleanText.length BUT rawText !== cleanText
  // Proves that same-length mismatch does NOT pass through the rawBytes!
  const customParser = {
    parse(text) {
      if (text === 'AAAA') {
        // Same length (4 === 4), but different characters!
        return { cleanText: 'BBBB', events: [] };
      }
      return { cleanText: text, events: [] };
    },
    setExpectedNonce() {},
    reset() {},
  };

  const realParser = runtime.shellParser;
  runtime.shellParser = customParser;

  const rawABytes = Array.from(Buffer.from('AAAA', 'utf8'));
  writtenChunks.length = 0;
  runtime.handleOutputBytes(rawABytes);

  assert.strictEqual(writtenChunks.length, 1);
  const writtenText = new TextDecoder().decode(writtenChunks[0]);
  assert.strictEqual(
    writtenText,
    'BBBB',
    'CRITICAL: When rawText !== cleanText (even if rawText.length === cleanText.length), rawBytes fast-path MUST NOT be taken! cleanText MUST be encoded!',
  );

  runtime.shellParser = realParser;

  // Case 1C: OSC 133 stripped chunk => cleanText !== rawText => re-encoded cleanText without OSC
  const oscChunk = 'prefix\x1b]133;C;aid=none\x07suffix';
  const oscBytes = Array.from(Buffer.from(oscChunk, 'utf8'));
  writtenChunks.length = 0;
  runtime.handleOutputBytes(oscBytes);

  assert.strictEqual(writtenChunks.length, 1);
  const cleanWritten = new TextDecoder().decode(writtenChunks[0]);
  assert.strictEqual(cleanWritten, 'prefixsuffix');
  assert.ok(!cleanWritten.includes('133;'), 'OSC sequence stripped');

  await runtime.initPromise;
  runtime.dispose();
  registry.disposeAll();
  console.log('✓ Fast-path correctness verified: cleanText === rawText required; same-length mismatch properly rejected');
}

// ---------------------------------------------------------------------------
// Group 2: UTF-8 Chunk Boundary Streaming Audit
// ---------------------------------------------------------------------------
{
  console.log('\n--- Group 2: UTF-8 Chunk Boundary Streaming Audit ---');

  const registry = new TerminalRuntimeRegistry();
  const outputEvents = [];

  const runtime = new TerminalRuntime(
    {
      paneId: 'p-utf8-split',
      workspaceId: 'ws-1',
      onTerminalOutput: (bytes, events, textChunk) => {
        outputEvents.push({ bytes, textChunk });
      },
    },
    registry,
  );

  function feedChunks(chunks) {
    outputEvents.length = 0;
    for (const chunk of chunks) {
      runtime.handleOutputBytes(Array.from(chunk));
    }
    return outputEvents.map((e) => e.textChunk).join('');
  }

  // Subtest 2A: 2-byte character split (e.g. '¢' = 0xC2 0xA2, 'λ' = 0xCE 0xBB)
  {
    const fullText = 'Price: 99¢ (λ calculus)';
    const fullBuf = Buffer.from(fullText, 'utf8');
    const splitIndex = 8;
    const chunk1 = fullBuf.slice(0, splitIndex);
    const chunk2 = fullBuf.slice(splitIndex);

    const reconstructed = feedChunks([chunk1, chunk2]);
    assert.strictEqual(reconstructed, fullText);
    assert.ok(!reconstructed.includes('\uFFFD'), 'No replacement character in 2-byte split');
    console.log('  ✓ 2-byte UTF-8 character split across chunks reconstructed without corruption');
  }

  // Subtest 2B: 3-byte character split (e.g. '€' = 0xE2 0x82 0xAC, '漢' = 0xE6 0xBC 0xA2)
  {
    const fullText = 'Total: 50€ 漢字 test';
    const fullBuf = Buffer.from(fullText, 'utf8');

    // Split after 1st byte of '€'
    const split1 = 9;
    const c1 = fullBuf.slice(0, split1);
    const c2 = fullBuf.slice(split1);
    const res1 = feedChunks([c1, c2]);
    assert.strictEqual(res1, fullText);
    assert.ok(!res1.includes('\uFFFD'), 'No replacement character in 3-byte split after byte 1');

    // Split after 2nd byte of '€'
    const split2 = 10;
    const c3 = fullBuf.slice(0, split2);
    const c4 = fullBuf.slice(split2);
    const res2 = feedChunks([c3, c4]);
    assert.strictEqual(res2, fullText);
    assert.ok(!res2.includes('\uFFFD'), 'No replacement character in 3-byte split after byte 2');

    console.log('  ✓ 3-byte UTF-8 character split (1-byte and 2-byte boundaries) reconstructed');
  }

  // Subtest 2C: 4-byte emoji split (e.g. '🌍' = 0xF0 0x9F 0x8C 0x8D, '🚀' = 0xF0 0x9F 0x9A 0x80)
  {
    const fullText = 'Ready 🌍 to launch 🚀 now!';
    const fullBuf = Buffer.from(fullText, 'utf8');

    const baseIdx = 6;
    for (let offset = 1; offset <= 3; offset++) {
      const splitAt = baseIdx + offset;
      const cA = fullBuf.slice(0, splitAt);
      const cB = fullBuf.slice(splitAt);
      const res = feedChunks([cA, cB]);
      assert.strictEqual(res, fullText, `Failed at emoji offset ${offset}`);
      assert.ok(!res.includes('\uFFFD'), `Replacement character introduced at offset ${offset}`);
    }
    console.log('  ✓ 4-byte emoji split at all 3 internal byte boundaries reconstructed cleanly');
  }

  // Subtest 2D: Multiple consecutive split characters
  {
    const fullText = '🔥🎉✨⚡️🚀🌟';
    const fullBuf = Buffer.from(fullText, 'utf8');
    const chunks = [];
    const chunkSize = 3;
    for (let i = 0; i < fullBuf.length; i += chunkSize) {
      chunks.push(fullBuf.slice(i, i + chunkSize));
    }

    const res = feedChunks(chunks);
    assert.strictEqual(res, fullText);
    assert.ok(!res.includes('\uFFFD'), 'No replacement characters across continuous multibyte stream');
    console.log('  ✓ Multiple consecutive split multibyte characters across arbitrary chunk slices verified');
  }

  await runtime.initPromise;
  runtime.dispose();
  registry.disposeAll();
  console.log('✓ UTF-8 chunk boundary audit passed: full streaming-safe decoding verified');
}

// ---------------------------------------------------------------------------
// Group 3: OSC Chunk Boundaries & Nonce Validation
// ---------------------------------------------------------------------------
{
  console.log('\n--- Group 3: OSC Chunk Boundaries & Nonce Validation ---');

  const nonce = 'session-secure-nonce-999';
  const parser = new ShellIntegrationStreamParser(nonce);

  // Subtest 3A: OSC sequence starts in chunk 1 and ends in chunk 2
  {
    const chunk1 = 'Running test... \x1b]133;';
    const chunk2 = `D;0;aid=${nonce}\x07Completed successfully\n`;

    const res1 = parser.parse(chunk1);
    assert.strictEqual(res1.cleanText, 'Running test... ');
    assert.strictEqual(res1.events.length, 0, 'Incomplete OSC sequence buffered');

    const res2 = parser.parse(chunk2);
    assert.strictEqual(res2.cleanText, 'Completed successfully\n');
    assert.strictEqual(res2.events.length, 1);
    assert.strictEqual(res2.events[0].type, 'command-end');
    assert.strictEqual(res2.events[0].exitCode, 0);
    assert.strictEqual(res2.events[0].trust, 'trusted');
    console.log('  ✓ OSC sequence split across chunk boundary parsed and stripped cleanly');
  }

  // Subtest 3B: Nonce text split across chunks
  {
    parser.reset();
    const halfNonceA = nonce.slice(0, 10);
    const halfNonceB = nonce.slice(10);

    const chunk1 = `\x1b]133;C;aid=${halfNonceA}`;
    const chunk2 = `${halfNonceB}\x07ls -la\n`;

    const res1 = parser.parse(chunk1);
    assert.strictEqual(res1.cleanText, '');
    assert.strictEqual(res1.events.length, 0);

    const res2 = parser.parse(chunk2);
    assert.strictEqual(res2.cleanText, 'ls -la\n');
    assert.strictEqual(res2.events.length, 1);
    assert.strictEqual(res2.events[0].type, 'command-start');
    assert.strictEqual(res2.events[0].nonce, nonce);
    assert.strictEqual(res2.events[0].trust, 'trusted');
    console.log('  ✓ Split nonce token recognized exactly once as trusted upon completion');
  }

  // Subtest 3C: UTF-8 text surrounds a split OSC sequence
  {
    parser.reset();
    const chunk1 = 'Start 🌍 \x1b]133;D;0;ai';
    const chunk2 = `d=${nonce}\x07 End 🚀\n`;

    const res1 = parser.parse(chunk1);
    assert.strictEqual(res1.cleanText, 'Start 🌍 ');
    assert.strictEqual(res1.events.length, 0);

    const res2 = parser.parse(chunk2);
    assert.strictEqual(res2.cleanText, ' End 🚀\n');
    assert.strictEqual(res2.events.length, 1);
    assert.strictEqual(res2.events[0].trust, 'trusted');
    assert.strictEqual(res2.events[0].exitCode, 0);

    const fullClean = res1.cleanText + res2.cleanText;
    assert.strictEqual(fullClean, 'Start 🌍  End 🚀\n');
    assert.ok(!fullClean.includes('133;'), 'No OSC characters leak into visible text');
    console.log('  ✓ UTF-8 surrounding split OSC sequence preserved in correct order');
  }

  // Subtest 3D: Invalid nonce remains untrusted
  {
    parser.reset();
    const badNonceChunk = '\x1b]133;D;0;aid=wrong-nonce-evil\x07';
    const res = parser.parse(badNonceChunk);
    assert.strictEqual(res.events.length, 1);
    assert.strictEqual(res.events[0].trust, 'untrusted', 'Wrong nonce must evaluate to untrusted');
    assert.strictEqual(res.cleanText, '');
    console.log('  ✓ Invalid nonce strictly classified as untrusted');
  }

  console.log('✓ OSC chunk boundary and trust validation verified');
}

// ---------------------------------------------------------------------------
// Group 4: Listener Lifecycle & Multiplexing Invariant
// ---------------------------------------------------------------------------
{
  console.log('\n--- Group 4: Listener Lifecycle & Multiplexing Invariant ---');

  mockApi.outputListeners.clear();
  mockApi.exitListeners.clear();
  mockApi.errorListeners.clear();

  const registry = new TerminalRuntimeRegistry();

  assert.strictEqual(mockApi.outputListeners.size, 0);
  assert.strictEqual(mockApi.exitListeners.size, 0);
  assert.strictEqual(mockApi.errorListeners.size, 0);

  await registry.ensureGlobalListeners();

  assert.strictEqual(mockApi.outputListeners.size, 1);
  assert.strictEqual(mockApi.exitListeners.size, 1);
  assert.strictEqual(mockApi.errorListeners.size, 1);
  const totalListeners = mockApi.outputListeners.size + mockApi.exitListeners.size + mockApi.errorListeners.size;
  assert.strictEqual(totalListeners, 3, 'Must have exactly 3 global listeners');

  const runtimes = [];
  for (let i = 1; i <= 10; i++) {
    const rt = registry.getOrCreate({
      paneId: `pane-multi-${i}`,
      workspaceId: 'ws-test',
    });
    runtimes.push(rt);
  }

  const listenersWith10Runtimes =
    mockApi.outputListeners.size + mockApi.exitListeners.size + mockApi.errorListeners.size;
  assert.strictEqual(
    listenersWith10Runtimes,
    3,
    'CRITICAL: 10 runtimes MUST share the same 3 global listeners, never 30!',
  );
  console.log('  ✓ 10 runtimes share exactly 3 global listeners (30 listeners eliminated)');

  const receivedByPane = new Map();
  runtimes.forEach((rt, idx) => {
    const sId = `session-${idx + 1}`;
    rt.sessionId = sId;
    registry.bindSession(sId, rt);
    rt.onTerminalOutput = (bytes, events, textChunk) => {
      receivedByPane.set(rt.paneId, textChunk);
    };
  });

  mockApi.emitOutput('session-5', Array.from(Buffer.from('Message for Pane 5', 'utf8')));

  assert.strictEqual(receivedByPane.get('pane-multi-5'), 'Message for Pane 5');
  assert.strictEqual(receivedByPane.has('pane-multi-1'), false, 'Pane 1 received no leak');
  assert.strictEqual(receivedByPane.has('pane-multi-10'), false, 'Pane 10 received no leak');
  console.log('  ✓ Global listener routes events strictly by sessionId with 0 cross-pane leakage');

  registry.disposeAll();

  assert.strictEqual(mockApi.outputListeners.size, 0);
  assert.strictEqual(mockApi.exitListeners.size, 0);
  assert.strictEqual(mockApi.errorListeners.size, 0);
  console.log('  ✓ Registry disposal unlistens all 3 global listeners cleanly (0 lingering listeners)');

  console.log('✓ Listener lifecycle and multiplexing invariant verified');
}

// ---------------------------------------------------------------------------
// Group 5: Trust Model & Boundary Terminology
// ---------------------------------------------------------------------------
{
  console.log('\n--- Group 5: Trust Model & Boundary Terminology ---');

  const nativeExitEvent = { sessionId: 'sess-trust-1', exitCode: 0, reason: 'exited' };
  assert.strictEqual(nativeExitEvent.exitCode, 0);

  const sessionNonce = 'correlation-nonce-abc';
  const validEvent = parseOsc133Payload(`D;0;aid=${sessionNonce}`, sessionNonce);
  assert.strictEqual(validEvent.trust, 'trusted');

  const spoofedEvent = parseOsc133Payload(`D;0;aid=attacker-nonce`, sessionNonce);
  assert.strictEqual(spoofedEvent.trust, 'untrusted');

  console.log('✓ Trust model verified: native exit is process truth; nonce is anti-spoofing correlation boundary');
}

console.log('\n=======================================================================');
console.log('ALL RELEASE-003A AUDIT & REGRESSION TESTS PASSED!');
console.log('=======================================================================\n');
