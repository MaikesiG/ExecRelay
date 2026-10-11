/**
 * COPY-FEEDBACK-DUPLICATION-001 — One copy action, one success feedback
 *
 * Reproduces the observed "Copied 1 block" shown twice for one selected block.
 *
 * Extracts the real handler bodies from App.tsx (handleCopySelected,
 * handleCopyBlock) and TranscriptCapturePanel.tsx (triggerCopyFeedback,
 * handleCopySelectedClick, handleCardCopy, and the `feedback` prop relay
 * effect) and wires them exactly as the app does, against the real
 * MonitorFeedbackStore.
 *
 * Invariant per intentional copy action:
 *   copy handler = 1, formatter = 1, clipboard write = 1,
 *   feedback store push = 1, rendered success entries = 1
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

function transpile(src) {
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
}

function transpileTs(filePath, customRequire = () => ({})) {
  const js = transpile(fs.readFileSync(filePath, 'utf8'));
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

const monitorTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/monitor/types.ts'));
const { createMonitorFeedbackStore } = transpileTs(
  path.resolve(__dirname, '../app/src/features/monitor/monitorFeedback.ts'),
  (req) => (req.includes('types') ? monitorTypesMod : require(req)),
);

const appSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
const panelSrc = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
  'utf8',
);

/** Returns the source of the first argument of the hook call starting at `from`. */
function firstHookArg(src, from) {
  const open = src.indexOf('(', from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 1) return src.slice(open + 1, i).trim();
  }
  throw new Error('Unbalanced hook call');
}

function extractCallback(src, name) {
  const at = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(at !== -1, `${name} = useCallback( exists`);
  return firstHookArg(src, at + `const ${name} = `.length);
}

function extractRelayEffect(src) {
  const marker = src.indexOf('feedback.dedupeKey ??');
  assert.ok(marker !== -1, 'feedback prop relay effect exists');
  const at = src.lastIndexOf('useEffect(', marker);
  return firstHookArg(src, at);
}

/** Evaluates `expr` (TS source) with the given names in scope. */
function evalWith(scope, expr) {
  const names = Object.keys(scope);
  const js = transpile(`module.exports = (${expr});`);
  const mod = { exports: {} };
  new Function('module', ...names, js)(mod, ...names.map((n) => scope[n]));
  return mod.exports;
}

function formatTranscriptBlock(command, output) {
  return `$ ${command}\n${output}`;
}

/** Builds the real App + Panel copy wiring for one panel instance. */
function createHarness(blocks, selectedIds) {
  const counts = { formatter: 0, clipboard: 0, copySelected: 0, copyBlock: 0, push: 0 };
  const clipboardTexts = [];

  const store = createMonitorFeedbackStore();
  const realPush = store.push.bind(store);
  store.push = (input) => {
    counts.push++;
    return realPush(input);
  };

  const workspace = {
    id: 'ws-1',
    capture: { blocks },
    selection: { selectedBlockIds: new Set(selectedIds) },
  };

  // Panel: `feedback` prop relay effect (runs whenever App sets a new feedback object)
  const relayEffect = evalWith({ feedbackStore: store }, `(feedback) => (${extractRelayEffect(panelSrc)})()`);

  // App: showTranscriptFeedback → new `feedback` prop object → panel relay effect
  const showTranscriptFeedback = (message, type, dedupeKey) => {
    relayEffect({ message, type, dedupeKey });
  };

  const appScope = {
    workspacesRef: { current: [workspace] },
    showTranscriptFeedback,
    formatTranscriptBlock,
    formatBlocksForCopy: (bs) => {
      counts.formatter++;
      return bs.map((b) => formatTranscriptBlock(b.command, b.output)).join('\n\n');
    },
    copyToClipboard: async (text) => {
      counts.clipboard++;
      clipboardTexts.push(text);
      return true;
    },
  };
  const appHandleCopySelected = evalWith(appScope, extractCallback(appSrc, 'handleCopySelected'));
  const appHandleCopyBlock = evalWith(appScope, extractCallback(appSrc, 'handleCopyBlock'));

  let pending = Promise.resolve();
  const onCopySelected = () => {
    counts.copySelected++;
    pending = appHandleCopySelected('ws-1');
  };
  const onCopyBlock = (block) => {
    counts.copyBlock++;
    pending = appHandleCopyBlock(block);
  };

  const triggerCopyFeedback = evalWith(
    { feedbackStore: store },
    extractCallback(panelSrc, 'triggerCopyFeedback'),
  );
  const panelScope = {
    onCopySelected,
    onCopyBlock,
    selectedCount: selectedIds.length,
    triggerCopyFeedback,
  };
  const handleCopySelectedClick = evalWith(panelScope, extractCallback(panelSrc, 'handleCopySelectedClick'));
  const handleCardCopy = evalWith(panelScope, extractCallback(panelSrc, 'handleCardCopy'));

  return {
    counts,
    clipboardTexts,
    store,
    clickCopySelected: async () => {
      handleCopySelectedClick();
      await pending;
    },
    clickCardCopy: async (block) => {
      handleCardCopy(block);
      await pending;
    },
    renderedTitles: () => store.getItems().map((i) => i.title),
  };
}

const normalBlock = { id: 'b-ok', command: 'echo hi', output: 'hi', status: 'completed', exitCode: 0 };
const failedBlock = {
  id: 'b-err',
  command: 'false',
  output: 'command failed',
  status: 'failed',
  exitCode: 1,
};
const otherBlock = { id: 'b-other', command: 'ls', output: 'a b', status: 'completed', exitCode: 0 };

function assertOneActionOneFeedback(h, expectedTitle, expectedClipboard) {
  assert.strictEqual(h.counts.clipboard, 1, 'clipboard written exactly once');
  assert.deepStrictEqual(h.clipboardTexts, [expectedClipboard], 'clipboard text unchanged');
  assert.strictEqual(h.counts.push, 1, 'feedback emitted exactly once');
  assert.strictEqual(h.store.getItems().length, 1, 'feedback store holds one entry');
  assert.deepStrictEqual(
    h.renderedTitles().filter((t) => t === expectedTitle),
    [expectedTitle],
    `"${expectedTitle}" rendered exactly once`,
  );
  h.store.destroy();
}

console.log('Running COPY-FEEDBACK-DUPLICATION-001 test suite...\n');

// A. one normal block selected → Copy once
{
  const h = createHarness([normalBlock, otherBlock], ['b-ok']);
  await h.clickCopySelected();
  assert.strictEqual(h.counts.copySelected, 1, 'copy-selected dispatched once');
  assert.strictEqual(h.counts.formatter, 1, 'formatter ran once');
  assertOneActionOneFeedback(h, 'Copied 1 block', '$ echo hi\nhi');
  console.log('  ✓ A: one normal selected block → one clipboard write, one "Copied 1 block"');
}

// B. one failed/error block selected → Copy once
{
  const h = createHarness([normalBlock, failedBlock], ['b-err']);
  await h.clickCopySelected();
  assert.strictEqual(h.counts.copySelected, 1, 'copy-selected dispatched once');
  assert.strictEqual(h.counts.formatter, 1, 'formatter ran once');
  assertOneActionOneFeedback(h, 'Copied 1 block', '$ false\ncommand failed');
  console.log('  ✓ B: one failed selected block → one clipboard write, one "Copied 1 block"');
}

// C. two normal blocks selected → Copy once
{
  const h = createHarness([normalBlock, otherBlock], ['b-ok', 'b-other']);
  await h.clickCopySelected();
  assertOneActionOneFeedback(h, 'Copied 2 blocks', '$ echo hi\nhi\n\n$ ls\na b');
  console.log('  ✓ C: two normal selected blocks → one "Copied 2 blocks"');
}

// D. normal + failed block selected → Copy once
{
  const h = createHarness([normalBlock, failedBlock], ['b-ok', 'b-err']);
  await h.clickCopySelected();
  assertOneActionOneFeedback(h, 'Copied 2 blocks', '$ echo hi\nhi\n\n$ false\ncommand failed');
  console.log('  ✓ D: normal + failed selected → one "Copied 2 blocks"');
}

// E. per-block card copy → Copy once
{
  const h = createHarness([normalBlock, failedBlock], []);
  await h.clickCardCopy(failedBlock);
  assert.strictEqual(h.counts.copyBlock, 1, 'copy-block dispatched once');
  assertOneActionOneFeedback(h, 'Copied 1 block', '$ false\ncommand failed');
  console.log('  ✓ E: per-block card copy → one "Copied 1 block"');
}

// Failure is reported once and never preceded by an optimistic success
{
  const h = createHarness([normalBlock], ['b-ok']);
  // Re-run with a failing clipboard: rebuild App handler with failing writer
  const store = h.store;
  const titles = [];
  const showTranscriptFeedback = (message, type, dedupeKey) => {
    titles.push({ message, type, dedupeKey });
  };
  const failingHandle = evalWith(
    {
      workspacesRef: { current: [{ id: 'ws-1', capture: { blocks: [normalBlock] }, selection: { selectedBlockIds: new Set(['b-ok']) } }] },
      showTranscriptFeedback,
      formatBlocksForCopy: () => 'x',
      copyToClipboard: async () => false,
    },
    extractCallback(appSrc, 'handleCopySelected'),
  );
  const panelPushes = [];
  const handleCopySelectedClick = evalWith(
    {
      onCopySelected: () => failingHandle('ws-1'),
      selectedCount: 1,
      triggerCopyFeedback: (m) => panelPushes.push(m),
    },
    extractCallback(panelSrc, 'handleCopySelectedClick'),
  );
  handleCopySelectedClick();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepStrictEqual(panelPushes, [], 'panel emits no optimistic success feedback');
  assert.deepStrictEqual(
    titles.map((t) => t.type),
    ['error'],
    'clipboard failure reports a single error and no success',
  );
  store.destroy();
  console.log('  ✓ clipboard failure → one error, no optimistic "Copied" success');
}

// H. rapid double click = two intentional actions → two clipboard writes, still one visible entry
{
  const h = createHarness([normalBlock], ['b-ok']);
  await h.clickCopySelected();
  await h.clickCopySelected();
  assert.strictEqual(h.counts.clipboard, 2, 'two intentional actions → two clipboard writes');
  assert.strictEqual(h.counts.push, 2, 'two intentional actions → two feedback emissions');
  assert.deepStrictEqual(h.renderedTitles(), ['Copied 1 block'], 'same-key emissions collapse to one entry');
  h.store.destroy();
  console.log('  ✓ H: double click recorded as two actions; one visible entry');
}

console.log('\nCOPY-FEEDBACK-DUPLICATION-001 tests passed.');
