/**
 * CAPTURE-NOOUTPUT-STATUS-001 Test Suite
 *
 * Real failure (Windows ARM64): `cmd.exe /c "exit 7"` prints nothing, but ConPTY still emits
 * cursor/paint sequences. The Capture card rendered that as an error output body reading
 * "(no output captured)", which buried the command's authoritative `failed` / `exit 7`.
 *
 * Output presence is not execution outcome. Renders the real TranscriptCard and checks:
 * 1. Trusted exit 7 with control-only output: failed + exit 7 + healthy + "No output".
 * 2. Trusted exit 7 with empty output: the same.
 * 3. Exit 0 with no output: succeeded + exit 0 + "No output".
 * 4. Trusted end without a numeric status, no output: no exit code, no outcome invented.
 * 5. Interrupted, no output: interrupted, no exit code.
 * 6. Real output is still rendered as an output body.
 * 7. The raw bytes of control-only output stay one click away.
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
const ReactDOMServer = require('../app/node_modules/react-dom/server');
const jsxRuntime = require('../app/node_modules/react/jsx-runtime');

function load(relPath, customRequire = () => ({})) {
  const src = fs.readFileSync(path.resolve(__dirname, '../app/src', relPath), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

const execTypes = load('features/execution/types.ts');
const format = load('features/transcript/transcriptFormat.ts');
const cleanup = load('features/transcript/transcriptDisplayCleanup.ts', () => format);
const formatWithCleanup = { ...format, cleanTranscriptForDisplay: cleanup.cleanTranscriptForDisplay };
const execModel = load('features/execution/executionModel.ts', (req) => {
  if (req.includes('transcriptFormat')) return formatWithCleanup;
  if (req.includes('types')) return execTypes;
  return {};
});
const transcriptTypes = load('features/transcript/types.ts', (req) =>
  req.includes('execution') ? execTypes : {},
);

// Child views unrelated to the card's status/body logic render nothing.
const stubModule = new Proxy({}, { get: () => () => null });
const panel = load('features/transcript/TranscriptCapturePanel.tsx', (req) => {
  if (req === 'react') return React;
  if (req === 'react/jsx-runtime') return jsxRuntime;
  if (req === './types') return transcriptTypes;
  if (req === './transcriptFormat') return formatWithCleanup;
  if (req === './captureBlockModel') {
    return { ...execModel, deriveBlockStructuredEvidence: () => [] };
  }
  return stubModule;
});
const { TranscriptCard } = panel;
assert.ok(TranscriptCard, 'TranscriptCard is exported');

const noop = () => {};
function render(blockOverrides) {
  const block = {
    id: 'block-1',
    batchId: 1,
    command: 'cmd.exe /c "exit 7"',
    output: '',
    startedAt: 1000,
    completedAt: 1150,
    isComplete: true,
    lifecycle: 'finished',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    completionSource: 'shell',
    shellIntegrationLevel: 'rich',
    sourcePaneOrdinal: 1,
    ...blockOverrides,
  };
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(TranscriptCard, {
      block,
      index: 0,
      isSelected: false,
      isCollapsed: false,
      onToggleSelect: noop,
      onToggleCollapsed: noop,
      onCopyBlock: noop,
      onDeleteBlock: noop,
    }),
  );
}
const statusPill = (html) =>
  html.match(/capture-status-state-pill--(\w+)[^>]*>([^<]*)</)?.slice(1);
const exitText = (html) => html.match(/class="capture-exit-code[^"]*"[^>]*>([^<]*)</)?.[1];

// ConPTY output for a command that prints nothing: cursor hide/move/show only.
const conptyControlOnly = '\x1b[?25l\x1b[2;1H\x1b[?25h\r\n\x1b[?25l\x1b[?25h';

// 1. Trusted exit 7, control-only output
{
  const html = render({ exitCode: 7, outcome: 'failed', output: conptyControlOnly, rawOutput: conptyControlOnly });
  assert.deepStrictEqual(statusPill(html), ['failed', 'failed']);
  assert.strictEqual(exitText(html), 'exit 7');
  assert.ok(html.includes('No output'), 'body says No output');
  assert.ok(!html.includes('(no output captured)'), 'no output-capture placeholder');
  assert.ok(!html.includes('capture-output-container'), 'no error/output body');
  assert.ok(!html.includes('capture-evidence-health'), 'healthy evidence: no health pill');
  console.log('✓ 1. Exit 7 with control-only output: failed + exit 7 + healthy + No output');
}

// 2. Trusted exit 7, empty output
{
  const html = render({ exitCode: 7, outcome: 'failed', output: '' });
  assert.deepStrictEqual(statusPill(html), ['failed', 'failed']);
  assert.strictEqual(exitText(html), 'exit 7');
  assert.ok(html.includes('No output') && !html.includes('capture-output-container'));
  console.log('✓ 2. Exit 7 with empty output: failed + exit 7 + No output');
}

// 3. Exit 0, no output
{
  const html = render({ command: 'cmd.exe /c "exit 0"', exitCode: 0, outcome: 'succeeded', output: conptyControlOnly });
  assert.deepStrictEqual(statusPill(html), ['succeeded', 'succeeded']);
  assert.strictEqual(exitText(html), 'exit 0');
  assert.ok(html.includes('No output') && !html.includes('capture-output-container'));
  console.log('✓ 3. Exit 0 with no output: succeeded + exit 0 + No output');
}

// 4. Trusted end without a numeric status (PowerShell D;aid=…), no output
{
  const html = render({ exitCode: null, outcome: 'unknown', output: conptyControlOnly });
  assert.strictEqual(exitText(html), undefined, 'no exit code invented');
  const [type, text] = statusPill(html);
  assert.ok(type !== 'failed' && type !== 'succeeded', `outcome not invented: ${type}`);
  assert.strictEqual(text, 'outcome unknown');
  assert.ok(html.includes('evidence degraded'), 'missing exit status degrades evidence');
  assert.ok(html.includes('No output'));
  console.log('✓ 4. Unknown status with no output: no exit code, no outcome invented');
}

// 5. Interrupted, no output
{
  const html = render({
    command: 'Start-Sleep -Seconds 30',
    exitCode: null,
    outcome: 'unknown',
    lifecycle: 'interrupted',
    completionSource: 'capture-stop',
    outcomeSource: undefined,
    outcomeTrusted: undefined,
    output: '',
  });
  assert.deepStrictEqual(statusPill(html), ['interrupted', 'interrupted']);
  assert.strictEqual(exitText(html), undefined);
  assert.ok(html.includes('No output'));
  console.log('✓ 5. Interrupted with no output: interrupted, no exit code');
}

// 6. Real output still renders as an output body
{
  const html = render({ command: 'Write-Output ok', exitCode: 0, outcome: 'succeeded', output: '\x1b[?25lok\r\n\x1b[?25h' });
  assert.ok(html.includes('capture-output-container'));
  assert.match(html, />ok</);
  assert.ok(!html.includes('No output'));
  console.log('✓ 6. Real output is still rendered as an output body');
}

// 7. Raw evidence of control-only output stays available
{
  const html = render({ exitCode: 7, outcome: 'failed', output: conptyControlOnly, rawOutput: conptyControlOnly });
  assert.ok(html.includes('aria-label="Show raw evidence"'), 'Raw toggle beside No output');
  const empty = render({ exitCode: 7, outcome: 'failed', output: '' });
  assert.ok(!empty.includes('Show raw evidence'), 'no Raw toggle when there are no bytes');
  console.log('✓ 7. Control-only raw bytes stay one click away');
}

console.log('CAPTURE-NOOUTPUT-STATUS-001 tests passed.');
