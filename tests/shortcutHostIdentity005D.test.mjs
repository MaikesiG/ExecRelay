/**
 * CROSSPLAT-005D — Shortcut host identity.
 *
 * A. detectPlatform: macOS, Windows, Linux explicit; anything else stays `unknown`; an injected
 *    environment never reads the real machine
 * B. primaryModifier: Meta on macOS, Control on Windows and Linux, none on unknown
 * C. Labels for the same binding on each host; unknown shows no macOS symbols
 * D. Event handling through the registry (global, workspace navigation, terminal pane) plus
 *    terminal copy/paste: right modifier fires, wrong one does not, unknown fires nothing
 * E. UI tooltips come from the registry that dispatches, not from a hard-coded platform guess
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const appSrc = path.resolve(__dirname, '../app/src');

const moduleCache = new Map();
function loadTs(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;
  const mod = { exports: {} };
  moduleCache.set(absPath, mod);
  const js = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (id) => {
    const resolved = path.resolve(path.dirname(absPath), id);
    for (const c of [`${resolved}.ts`, path.join(resolved, 'index.ts')]) {
      if (fs.existsSync(c)) return loadTs(c);
    }
    throw new Error(`unexpected import ${id}`);
  });
  return mod.exports;
}

const norm = loadTs(path.join(appSrc, 'features/shortcuts/shortcutNormalization.ts'));
const registryMod = loadTs(path.join(appSrc, 'features/shortcuts/shortcutRegistry.ts'));
const defaults = loadTs(path.join(appSrc, 'features/shortcuts/defaultShortcuts.ts'));
const copy = loadTs(path.join(appSrc, 'features/terminal/terminalCopyShortcut.ts'));
const { detectPlatform, primaryModifier, formatShortcutDisplay, formatShortcutAriaLabel } = norm;
const { ShortcutRegistry, formatCommandShortcutHint } = registryMod;
const HOSTS = ['macos', 'windows', 'linux', 'unknown'];

// A. Host detection
{
  const cases = [
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' }, 'macos'],
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0' }, 'windows'],
    [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15' }, 'linux'],
    [{ platform: 'darwin' }, 'macos'],
    [{ platform: 'win32' }, 'windows'],
    [{ platform: 'linux' }, 'linux'],
    [{}, 'unknown'],
    [{ userAgent: '' }, 'unknown'],
    [{ userAgent: 'Mozilla/5.0 (FreeBSD amd64)' }, 'unknown'],
    [{ userAgent: 'SomeFutureOS/1.0', platform: 'freebsd' }, 'unknown'],
    [{ platform: 'aix' }, 'unknown'],
  ];
  for (const [env, expected] of cases) {
    assert.equal(detectPlatform(env), expected, JSON.stringify(env));
  }
  // An injected environment never falls back to this machine's navigator/process.
  assert.equal(detectPlatform({ userAgent: 'Plan9' }), 'unknown');
  const src = fs.readFileSync(path.join(appSrc, 'features/shortcuts/shortcutNormalization.ts'), 'utf8');
  assert.ok(!/return 'macos';\s*\/\/ Default/.test(src), 'no macOS default');
  // One detector: every platform-dependent module imports it, none reads navigator itself.
  for (const rel of ['features/workspace/pathPolicy.ts', 'features/terminal/terminalRuntimeRegistry.ts', 'features/shortcuts/shortcutRegistry.ts']) {
    const file = fs.readFileSync(path.join(appSrc, rel), 'utf8');
    assert.ok(file.includes('detectPlatform'), rel);
    assert.ok(!/navigator\.(userAgent|platform)|process\.platform/.test(file), `${rel} has no second detector`);
  }
}
console.log('✓ A. macOS, Windows and Linux detected explicitly; everything else stays unknown');

// B. Primary modifier policy
{
  assert.equal(primaryModifier('macos'), 'meta');
  assert.equal(primaryModifier('windows'), 'ctrl');
  assert.equal(primaryModifier('linux'), 'ctrl');
  assert.equal(primaryModifier('unknown'), null);
  // The defaults follow the policy: the primary-modifier navigation commands use it, and only it.
  for (const host of HOSTS) {
    const binding = defaults.getDefaultShortcuts(host)['focus-changes'];
    const primary = primaryModifier(host);
    if (!primary) {
      assert.equal(binding, undefined, 'unknown has no default');
      continue;
    }
    assert.equal(Boolean(binding.meta), primary === 'meta', host);
    assert.equal(Boolean(binding.ctrl), primary === 'ctrl', host);
  }
  assert.deepEqual(defaults.getDefaultShortcuts('unknown'), {});
  assert.notDeepEqual(defaults.getDefaultShortcuts('linux'), defaults.getDefaultShortcuts('macos'));
}
console.log('✓ B. Meta primary on macOS, Control on Windows/Linux, none on unknown');

// C. Labels
{
  const chord = { key: 'p', meta: true, shift: true };
  const ctrlChord = { key: 'p', ctrl: true, shift: true };
  assert.equal(formatShortcutDisplay({ key: 'k', meta: true }, 'macos'), '⌘K');
  assert.equal(formatShortcutDisplay(chord, 'macos'), '⇧⌘P');
  assert.equal(formatShortcutDisplay({ key: 'k', ctrl: true }, 'windows'), 'Ctrl+K');
  assert.equal(formatShortcutDisplay(ctrlChord, 'windows'), 'Ctrl+Shift+P');
  assert.equal(formatShortcutDisplay(ctrlChord, 'linux'), 'Ctrl+Shift+P');
  assert.equal(formatShortcutDisplay(chord, 'windows'), 'Shift+Win+P');
  assert.equal(formatShortcutDisplay(chord, 'linux'), 'Shift+Super+P');
  assert.equal(formatShortcutDisplay(ctrlChord, 'unknown'), 'Ctrl+Shift+P');
  assert.equal(formatShortcutDisplay(chord, 'unknown'), 'Shift+Meta+P');
  assert.equal(formatShortcutAriaLabel(chord, 'macos'), 'Shift Command P');
  assert.equal(formatShortcutAriaLabel(chord, 'windows'), 'Shift Windows P');
  assert.equal(formatShortcutAriaLabel(chord, 'linux'), 'Shift Super P');
  assert.equal(formatShortcutAriaLabel(chord, 'unknown'), 'Shift Meta P');
  for (const b of [chord, ctrlChord, { key: '1', alt: true, ctrl: true }]) {
    assert.ok(!/[⌘⌃⌥⇧]|Command|Option/.test(formatShortcutDisplay(b, 'unknown') + formatShortcutAriaLabel(b, 'unknown')));
  }
}
console.log('✓ C. Labels per host; unknown never renders macOS symbols');

// D. Event handling
const ev = (key, code, mods = {}) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});
{
  const reg = Object.fromEntries(HOSTS.map((h) => [h, new ShortcutRegistry(h, {})]));
  const metaThree = ev('3', 'Digit3', { metaKey: true });
  const ctrlThree = ev('3', 'Digit3', { ctrlKey: true });
  // Global (monitor focus)
  assert.equal(reg.macos.findCommandForEvent(metaThree), 'focus-changes');
  assert.equal(reg.macos.findCommandForEvent(ctrlThree), null, 'Ctrl does not trigger on macOS');
  for (const h of ['windows', 'linux']) {
    assert.equal(reg[h].findCommandForEvent(ctrlThree), 'focus-changes', h);
    assert.equal(reg[h].findCommandForEvent(metaThree), null, `Meta does not trigger on ${h}`);
  }
  // Workspace navigation
  assert.equal(reg.macos.findCommandForEvent(ev(']', 'BracketRight', { metaKey: true, shiftKey: true })), 'workspace.nextTab');
  assert.equal(reg.windows.findCommandForEvent(ev(']', 'BracketRight', { ctrlKey: true, shiftKey: true })), 'workspace.nextTab');
  assert.equal(reg.linux.findCommandForEvent(ev(']', 'BracketRight', { ctrlKey: true, shiftKey: true })), 'workspace.nextTab');
  assert.equal(reg.windows.findCommandForEvent(ev(']', 'BracketRight', { metaKey: true, shiftKey: true })), null);
  // Terminal pane
  assert.equal(reg.macos.findCommandForEvent(ev('d', 'KeyD', { metaKey: true }), 'terminal'), 'terminal.split-right');
  assert.equal(reg.linux.findCommandForEvent(ev('\\', 'Backslash', { ctrlKey: true, shiftKey: true }), 'terminal'), 'terminal.split-right');
  assert.equal(reg.linux.findCommandForEvent(ev('d', 'KeyD', { metaKey: true }), 'terminal'), null);

  // Unknown: no macOS (or any) application shortcut fires; nothing crashes
  const everyChord = [];
  for (const [key, code] of [['1', 'Digit1'], ['3', 'Digit3'], ['d', 'KeyD'], [']', 'BracketRight'], ['\\', 'Backslash'], ['w', 'KeyW'], ['ArrowLeft', 'ArrowLeft']]) {
    for (const mods of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true, shiftKey: true }, { ctrlKey: true, shiftKey: true }]) {
      everyChord.push(ev(key, code, mods));
    }
  }
  for (const e of everyChord) {
    assert.equal(reg.unknown.findCommandForEvent(e), null, JSON.stringify(e));
    assert.equal(reg.unknown.findCommandForEvent(e, 'terminal'), null);
  }
  assert.deepEqual(reg.unknown.getEffectiveBindings(), {});
  assert.equal(reg.unknown.resolveBinding('focus-terminal'), null);
  assert.equal(reg.unknown.getIsMac(), false);
  assert.deepEqual(reg.unknown.applyOverrides({}), { success: true }, 'saving an empty set works');

  // Terminal copy/paste: platform rules unchanged; unknown intercepts nothing
  const c = (mods) => ev('c', 'KeyC', mods);
  assert.equal(copy.resolveTerminalCopyShortcut(c({ metaKey: true }), 'macos', true), 'copy');
  assert.equal(copy.resolveTerminalCopyShortcut(c({ ctrlKey: true }), 'macos', true), 'pass', 'Ctrl+C interrupts on macOS');
  assert.equal(copy.resolveTerminalCopyShortcut(c({ ctrlKey: true }), 'windows', true), 'copy-and-clear');
  assert.equal(copy.resolveTerminalCopyShortcut(c({ ctrlKey: true }), 'windows', false), 'pass', 'no selection: Ctrl+C interrupts');
  assert.equal(copy.resolveTerminalCopyShortcut(c({ ctrlKey: true }), 'linux', true), 'pass');
  assert.equal(copy.resolveTerminalCopyShortcut(c({ ctrlKey: true, shiftKey: true }), 'linux', true), 'copy');
  for (const mods of [{ metaKey: true }, { ctrlKey: true }, { ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true }]) {
    assert.equal(copy.resolveTerminalCopyShortcut(c(mods), 'unknown', true), 'pass', JSON.stringify(mods));
  }
  const ctrlV = ev('v', 'KeyV', { ctrlKey: true });
  assert.equal(copy.isTerminalPasteShortcut(ctrlV, 'windows'), true);
  for (const h of ['macos', 'linux', 'unknown']) assert.equal(copy.isTerminalPasteShortcut(ctrlV, h), false, h);
}
console.log('✓ D. Registry and terminal copy/paste follow the host; wrong modifier and unknown host fire nothing');

// E. Tooltips from the registry
{
  const hint = (h) => formatCommandShortcutHint('focus-changes', new ShortcutRegistry(h, {}));
  assert.equal(hint('macos'), ' (⌘3)');
  assert.equal(hint('windows'), ' (Ctrl+3)');
  assert.equal(hint('linux'), ' (Ctrl+3)');
  assert.equal(hint('unknown'), '', 'unbound: no hint');
  const overridden = new ShortcutRegistry('macos', { 'focus-changes': { key: '3', meta: true, alt: true } });
  assert.equal(formatCommandShortcutHint('focus-changes', overridden), ' (⌥⌘3)', 'labels follow user overrides');

  const panel = fs.readFileSync(path.join(appSrc, 'features/transcript/TranscriptCapturePanel.tsx'), 'utf8');
  assert.ok(!/⌘|isMacPlatform|'Ctrl\+/.test(panel), 'no hard-coded shortcut labels');
  for (const cmd of ['focus-capture-evidence', 'focus-changes', 'focus-verification']) {
    assert.ok(panel.includes(`formatCommandShortcutHint('${cmd}')`), cmd);
  }
}
console.log('✓ E. Monitor tooltips come from the dispatching registry; unknown shows none');

console.log('\nCROSSPLAT-005D tests passed.');
