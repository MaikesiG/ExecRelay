/**
 * TERMINAL-CLIPBOARD-001 Test Suite
 *
 * Real failure: on Windows, Ctrl+C with selected terminal text sent ETX to the shell instead of
 * copying, because only Ctrl+Shift+C copied. The interrupt path must stay intact: Ctrl+C with
 * no copy condition still reaches the PTY as ETX.
 *
 * Validates:
 * 1. The copy decision for macOS, Windows and Linux key combinations.
 * 2. Copying writes the exact selected text (newlines, Unicode, no ANSI) to the clipboard and
 *    keeps the key from xterm and the WebView.
 * 3. Windows Ctrl+C with a selection copies, clears the selection, and sends no ETX; the next
 *    Ctrl+C interrupts.
 * 4. Ctrl+C without a selection, and macOS Ctrl+C with one, reach the PTY as ETX.
 * 5. A clipboard failure is reported, not swallowed, and the terminal keeps running.
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

console.log('Running TERMINAL-CLIPBOARD-001 tests...');

const terminalDir = path.resolve(__dirname, '../app/src/features/terminal');
const copyMod = transpileTs(path.join(terminalDir, 'terminalCopyShortcut.ts'));
const { resolveTerminalCopyShortcut } = copyMod;

// 1. Decision table
const key = (mods = {}) => ({ code: 'KeyC', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
const cases = [
  ['macos', key({ metaKey: true }), true, 'copy'],
  ['macos', key({ metaKey: true, shiftKey: true }), true, 'copy'],
  ['macos', key({ metaKey: true }), false, 'pass'],
  ['macos', key({ ctrlKey: true }), true, 'pass'],
  ['macos', key({ ctrlKey: true }), false, 'pass'],
  ['windows', key({ ctrlKey: true }), true, 'copy-and-clear'],
  ['windows', key({ ctrlKey: true }), false, 'pass'],
  ['windows', key({ ctrlKey: true, shiftKey: true }), true, 'copy'],
  ['windows', key({ ctrlKey: true, shiftKey: true }), false, 'pass'],
  ['windows', key({ ctrlKey: true, altKey: true }), true, 'pass'],
  ['windows', { ...key({ ctrlKey: true }), code: 'KeyV' }, true, 'pass'],
  ['linux', key({ ctrlKey: true, shiftKey: true }), true, 'copy'],
  ['linux', key({ ctrlKey: true }), true, 'pass'],
  ['linux', key({ ctrlKey: true }), false, 'pass'],
];
for (const [platform, event, hasSelection, expected] of cases) {
  assert.strictEqual(
    resolveTerminalCopyShortcut(event, platform, hasSelection),
    expected,
    `${platform} ${JSON.stringify(event)} selection=${hasSelection}`,
  );
}
console.log('✓ 1. Copy decision matches the macOS / Windows / Linux shortcut matrix');

// Runtime harness: real xterm (not opened, so selection is a controllable stand-in).
class MockTerminalApi {
  constructor() {
    this.writes = [];
  }
  async createSession(input = {}) {
    return { sessionId: 'sess-1', shell: 'powershell.exe', shellKind: 'powershell', status: 'running', cwd: 'C:\\Users\\maike', cols: input.cols || 80, rows: input.rows || 24, integrationNonce: input.integrationNonce };
  }
  async closeSession() {}
  async write(input) {
    this.writes.push(Array.from(input.data));
  }
  async resize() {}
  async onOutput() { return () => {}; }
  async onExit() { return () => {}; }
  async onError() { return () => {}; }
}
const api = new MockTerminalApi();

const { Terminal } = require('../app/node_modules/@xterm/xterm/lib/xterm.js');
class MockTerminal extends Terminal {
  constructor() {
    super({ rows: 10, cols: 60 });
    this.selectionText = '';
  }
  write(data, cb) { cb?.(); }
  attachCustomKeyEventHandler(handler) { this.keyHandler = handler; }
  hasSelection() { return this.selectionText.length > 0; }
  getSelection() { return this.selectionText; }
  clearSelection() { this.selectionText = ''; }
  // A keydown as the browser delivers it: the custom handler first, then xterm's own
  // translation (Ctrl+C → ETX) only if the handler let the key through.
  press(event, xtermData) {
    let prevented = false;
    const keydown = { type: 'keydown', key: 'c', ...event, preventDefault: () => { prevented = true; } };
    const passed = this.keyHandler(keydown);
    if (passed && xtermData) this.input(xtermData, true);
    return { passed, prevented };
  }
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const clipboardWrites = [];
let clipboardFails = false;
Object.defineProperty(globalThis.navigator, 'clipboard', {
  configurable: true,
  value: {
    writeText: async (text) => {
      if (clipboardFails) throw new Error('denied');
      clipboardWrites.push(text);
    },
  },
});
const setUserAgent = (ua) =>
  Object.defineProperty(globalThis.navigator, 'userAgent', { configurable: true, value: ua });

const registryMod = transpileTs(path.join(terminalDir, 'terminalRuntimeRegistry.ts'), (req) => {
  if (req.includes('terminalApi')) return { terminalApi: api };
  if (req.includes('terminalCopyShortcut')) return copyMod;
  if (req.includes('shortcutNormalization')) {
    return transpileTs(path.resolve(__dirname, '../app/src/features/shortcuts/shortcutNormalization.ts'));
  }
  if (req.includes('types')) return transpileTs(path.join(terminalDir, 'types.ts'));
  if (req.includes('shellIntegration')) return transpileTs(path.join(terminalDir, 'shellIntegration.ts'));
  if (req.includes('terminalAnsi')) return transpileTs(path.join(terminalDir, 'terminalAnsi.ts'));
  if (req === '@xterm/xterm') return { Terminal: MockTerminal };
  if (req === '@xterm/addon-fit') return { FitAddon: class { activate() {} fit() {} dispose() {} } };
  return {};
});

const registry = new registryMod.TerminalRuntimeRegistry();
const runtime = registry.getOrCreate({ paneId: 'pane-1', workspaceId: 'ws-1', terminalTabId: 'tab-1' });
await runtime.initPromise;
const term = runtime.terminal;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const etxWrites = () => api.writes.filter((d) => d.length === 1 && d[0] === 0x03).length;
const selected = 'hello\n你好 ExecRelay\nline three';

// 2 & 3. Windows: Ctrl+C with a selection copies exactly, clears it, and sends no ETX
setUserAgent('Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36 Edg/130.0');
term.selectionText = selected;
let result = term.press({ code: 'KeyC', ctrlKey: true }, '\x03');
await settle();
assert.deepStrictEqual(result, { passed: false, prevented: true }, 'the key is kept from xterm and the WebView');
assert.deepStrictEqual(clipboardWrites, [selected], 'exact selected text, newlines and Unicode kept');
assert.strictEqual(term.hasSelection(), false, 'Ctrl+C copy clears the selection');
assert.strictEqual(etxWrites(), 0, 'no ETX for a copy');
console.log('✓ 2. Windows Ctrl+C with a selection copies the exact text without ETX');

result = term.press({ code: 'KeyC', ctrlKey: true }, '\x03');
await settle();
assert.strictEqual(result.passed, true);
assert.strictEqual(etxWrites(), 1, 'the next Ctrl+C interrupts');
console.log('✓ 3. After a copy, the next Windows Ctrl+C reaches the PTY as ETX');

term.selectionText = selected;
result = term.press({ code: 'KeyC', ctrlKey: true, shiftKey: true });
await settle();
assert.deepStrictEqual(result, { passed: false, prevented: true });
assert.deepStrictEqual(clipboardWrites, [selected, selected]);
assert.strictEqual(term.hasSelection(), true, 'Ctrl+Shift+C keeps the selection');
term.clearSelection();
console.log('✓ 4a. Windows Ctrl+Shift+C with a selection copies');

// 4. macOS: Cmd+C copies; Ctrl+C interrupts even with a selection
setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15');
term.selectionText = selected;
result = term.press({ code: 'KeyC', metaKey: true });
await settle();
assert.deepStrictEqual(result, { passed: false, prevented: true });
assert.deepStrictEqual(clipboardWrites, [selected, selected, selected]);
assert.strictEqual(term.hasSelection(), true, 'Cmd+C keeps the selection');
result = term.press({ code: 'KeyC', ctrlKey: true }, '\x03');
await settle();
assert.strictEqual(result.passed, true);
assert.strictEqual(etxWrites(), 2, 'macOS Ctrl+C is the interrupt, never copy');
assert.strictEqual(clipboardWrites.length, 3);
term.clearSelection();
result = term.press({ code: 'KeyC', metaKey: true });
assert.deepStrictEqual(result, { passed: true, prevented: false }, 'Cmd+C without a selection is left to the WebView');
assert.strictEqual(etxWrites(), 2, 'Cmd+C never sends ETX');
console.log('✓ 4b. macOS Cmd+C copies; Ctrl+C reaches the PTY as ETX');

// Linux: Ctrl+C with a selection is still the interrupt
setUserAgent('Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15');
term.selectionText = selected;
result = term.press({ code: 'KeyC', ctrlKey: true }, '\x03');
await settle();
assert.strictEqual(result.passed, true);
assert.strictEqual(etxWrites(), 3, 'Linux Ctrl+C stays the interrupt');
term.clearSelection();
console.log('✓ 4c. Linux Ctrl+C with a selection reaches the PTY as ETX');

// 5. Clipboard failure is reported and the terminal keeps running
setUserAgent('Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36 Edg/130.0');
clipboardFails = true;
term.selectionText = selected;
term.press({ code: 'KeyC', ctrlKey: true }, '\x03');
await settle();
await settle();
assert.match(runtime.errorMessage ?? '', /Copy shortcut failed: denied/);
assert.strictEqual(runtime.status, 'running');
assert.strictEqual(etxWrites(), 3, 'a failed copy does not turn into ETX');
console.log('✓ 5. A clipboard failure is reported and the shell keeps running');

console.log('TERMINAL-CLIPBOARD-001 tests passed.');
