/**
 * TERMINAL-CLIPBOARD-002 Test Suite
 *
 * Real failure (Windows ARM64): Ctrl+V in the terminal sent a literal ^V (0x16) to the shell
 * (cmd.exe then reported "'' is not recognized ..."). ExecRelay had no paste handling: xterm
 * translated the key and kept the WebView's own paste from running; only PowerShell's
 * PSReadLine, which binds ^V to its own paste, hid it.
 *
 * Validates, through the real xterm and the runtime's key handler:
 * 1. The paste decision: Windows Ctrl+V only.
 * 2. Windows Ctrl+V leaves the key to the WebView: not translated by xterm, not prevented.
 * 3. The WebView's paste reaches the PTY exactly once, as the clipboard text; no 0x16.
 * 4. Copy and interrupt keys are unchanged on Windows (selection copy, ETX without one).
 * 5. macOS and Linux Ctrl+V keep their existing behaviour (reach xterm).
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

console.log('Running TERMINAL-CLIPBOARD-002 tests...');

const terminalDir = path.resolve(__dirname, '../app/src/features/terminal');
const copyMod = transpileTs(path.join(terminalDir, 'terminalCopyShortcut.ts'));
const { isTerminalPasteShortcut } = copyMod;

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
    const keydown = { type: 'keydown', key: event.code === 'KeyV' ? 'v' : 'c', ...event, preventDefault: () => { prevented = true; } };
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
const decoder = new TextDecoder();
const writtenText = () => api.writes.map((d) => decoder.decode(Uint8Array.from(d))).join('');
const synWrites = () => api.writes.filter((d) => d.includes(0x16)).length;
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36 Edg/130.0';
const ctrlV = { code: 'KeyV', ctrlKey: true };

// The browser's default action for a Ctrl+V keydown that nobody consumed or prevented: a
// native paste into xterm's input element. The test terminal is not opened (no textarea),
// so the paste's effect is applied as xterm's paste applies it: line breaks become CR and
// the text is emitted once as user input.
function pressAndPaste(event, clipboardText) {
  const result = term.press(event, '\x16');
  if (!result.passed && !result.prevented) term.input(clipboardText.replace(/\r?\n/g, '\r'), true);
  return result;
}

// 1. Decision
const k = (mods) => ({ code: 'KeyV', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
assert.strictEqual(isTerminalPasteShortcut(k({ ctrlKey: true }), 'windows'), true);
assert.strictEqual(isTerminalPasteShortcut(k({ ctrlKey: true, shiftKey: true }), 'windows'), false);
assert.strictEqual(isTerminalPasteShortcut(k({ ctrlKey: true, altKey: true }), 'windows'), false);
assert.strictEqual(isTerminalPasteShortcut({ ...k({ ctrlKey: true }), code: 'KeyC' }, 'windows'), false);
assert.strictEqual(isTerminalPasteShortcut(k({ ctrlKey: true }), 'macos'), false);
assert.strictEqual(isTerminalPasteShortcut(k({ ctrlKey: true }), 'linux'), false);
console.log('✓ 1. Paste decision: Windows Ctrl+V only');

// 2 & 3. Windows Ctrl+V pastes once, with no ^V
setUserAgent(WINDOWS);
const clip = 'Write-Output "pasted"\n你好 & (x)';
api.writes.length = 0;
let result = pressAndPaste(ctrlV, clip);
await settle();
assert.deepStrictEqual(result, { passed: false, prevented: false }, 'left to the WebView paste');
assert.strictEqual(synWrites(), 0, 'no ^V reaches the PTY');
assert.strictEqual(writtenText(), 'Write-Output "pasted"\r你好 & (x)', 'clipboard text written once');
assert.strictEqual(api.writes.length, 1, 'one write for one paste');
console.log('✓ 2. Windows Ctrl+V is not translated to ^V and not prevented');
console.log('✓ 3. The paste reaches the PTY exactly once as the clipboard text');

// 4. Windows copy / interrupt unchanged
const selected = 'copy me';
term.selectionText = selected;
result = term.press({ code: 'KeyC', ctrlKey: true }, '\x03');
await settle();
assert.deepStrictEqual(result, { passed: false, prevented: true });
assert.deepStrictEqual(clipboardWrites, [selected]);
assert.strictEqual(etxWrites(), 0);
result = term.press({ code: 'KeyC', ctrlKey: true }, '\x03');
await settle();
assert.strictEqual(result.passed, true);
assert.strictEqual(etxWrites(), 1, 'Ctrl+C without a selection interrupts');
term.selectionText = selected;
result = term.press({ code: 'KeyC', ctrlKey: true, shiftKey: true });
await settle();
assert.deepStrictEqual(result, { passed: false, prevented: true });
assert.deepStrictEqual(clipboardWrites, [selected, selected], 'Ctrl+Shift+C copies');
term.clearSelection();
console.log('✓ 4. Windows Ctrl+C / Ctrl+Shift+C copy and interrupt are unchanged');

// 5. macOS and Linux Ctrl+V unchanged: xterm handles the key as before
for (const ua of [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15',
]) {
  setUserAgent(ua);
  result = term.press(ctrlV, '\x16');
  await settle();
  assert.strictEqual(result.passed, true, ua);
}
console.log('✓ 5. macOS and Linux Ctrl+V keep their existing behaviour');

console.log('TERMINAL-CLIPBOARD-002 tests passed.');
