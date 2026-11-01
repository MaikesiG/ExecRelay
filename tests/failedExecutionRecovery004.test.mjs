/**
 * HARDENING-004 — failed-execution workspace freeze.
 *
 * Root cause: the Capture card derived structured evidence (full-output cleanup plus every
 * parser) on each new block object. A running block gets a new object on every 60ms output
 * flush, and finished blocks whose parse found nothing (`structuredEvidence: undefined`,
 * the normal case for build/dev-server failures) were re-derived on every panel mount.
 * Large failed outputs therefore blocked the main thread for seconds, freezing the workspace.
 *
 * These tests exercise the real derivation path (real execution model and parser engine)
 * and count how often the expensive derivation runs.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const src = (p) => path.resolve(__dirname, '../app/src/features', p);

function transpileTs(filePath, customRequire = () => ({})) {
  const js = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

const execTypesMod = transpileTs(src('execution/types.ts'));
const formatMod = transpileTs(src('transcript/transcriptFormat.ts'));
const cleanupMod = transpileTs(src('transcript/transcriptDisplayCleanup.ts'), (req) =>
  req.includes('transcriptFormat') ? formatMod : {},
);
const seTypesMod = transpileTs(src('structuredEvidence/types.ts'), (req) =>
  req.includes('execution') ? execTypesMod : {},
);
const parserRequire = (req) => (req.includes('transcriptFormat') ? formatMod : req.includes('types') ? seTypesMod : {});
const parsers = Object.fromEntries(
  ['jestParser', 'vitestParser', 'pytestParser', 'cargoTestParser', 'tscParser'].map((name) => [
    name,
    transpileTs(src(`structuredEvidence/parsers/${name}.ts`), parserRequire),
  ]),
);
const parserEngineMod = transpileTs(src('structuredEvidence/parserEngine.ts'), (req) => {
  const parser = Object.keys(parsers).find((name) => req.endsWith(name));
  if (parser) return parsers[parser];
  return req.includes('types') ? seTypesMod : {};
});
const execModelMod = transpileTs(src('execution/executionModel.ts'), (req) => {
  if (req.includes('transcriptFormat')) return { ...formatMod, cleanTranscriptForDisplay: cleanupMod.cleanTranscriptForDisplay };
  if (req.includes('structuredEvidence/types')) return seTypesMod;
  if (req.includes('types')) return execTypesMod;
  return {};
});

// Loads a fresh captureBlockModel (fresh derivation cache) with counting derivation hooks.
function loadCaptureBlockModel({ throwOnDerive = false } = {}) {
  const counts = { executionFromTranscriptBlock: 0, parseEngineeringEvidence: 0 };
  const mod = transpileTs(src('transcript/captureBlockModel.ts'), (req) => {
    if (req.includes('execution/executionModel')) {
      return {
        ...execModelMod,
        executionFromTranscriptBlock: (...args) => {
          counts.executionFromTranscriptBlock++;
          if (throwOnDerive) throw new RangeError('pathological output');
          return execModelMod.executionFromTranscriptBlock(...args);
        },
      };
    }
    if (req.includes('structuredEvidence/parserEngine')) {
      return {
        ...parserEngineMod,
        parseEngineeringEvidence: (...args) => {
          counts.parseEngineeringEvidence++;
          return parserEngineMod.parseEngineeringEvidence(...args);
        },
      };
    }
    return {};
  });
  return { derive: mod.deriveBlockStructuredEvidence, counts };
}

const nextBuildFailure = [
  '   ▲ Next.js 15.5.4',
  '   Creating an optimized production build ...',
  'Failed to compile.',
  '',
  ...Array.from({ length: 400 }, (_, i) => [
    `./app/components/Chart${i}.tsx`,
    `Module not found: Can't resolve 'recharts-not-installed-${i}'`,
    'https://nextjs.org/docs/messages/module-not-found',
    'Import trace for requested module:',
    './app/components/Dashboard.tsx',
    './app/page.tsx',
    '',
  ].join('\n')),
  '> Build failed because of webpack errors',
].join('\n');

function block(overrides) {
  return {
    id: 'block-1',
    batchId: 1,
    command: 'npx next build',
    rawCommand: 'npx next build',
    output: nextBuildFailure,
    startedAt: 1,
    isComplete: true,
    lifecycle: 'finished',
    outcome: 'failed',
    exitCode: 1,
    executionState: 'failed',
    ...overrides,
  };
}

console.log('Running HARDENING-004 failed-execution recovery tests...');

// A/H. A running failed execution is never parsed, however many flushes stream into it.
{
  const { derive, counts } = loadCaptureBlockModel();
  let output = '';
  for (let flush = 0; flush < 300; flush++) {
    output += `Error ${flush}: Module not found: Can't resolve './missing-${flush}'\n`;
    const running = block({ output, isComplete: false, lifecycle: 'running', outcome: 'unknown', exitCode: null, executionState: 'running' });
    assert.deepStrictEqual(derive(running), [], 'running block has no derived evidence');
  }
  assert.strictEqual(counts.executionFromTranscriptBlock, 0, 'running output is never re-derived per flush');
  assert.strictEqual(counts.parseEngineeringEvidence, 0, 'parsers never run on unfinalized evidence');
}

// B/C. A finalized failed execution with no parser match is derived once, not on every re-mount.
{
  const { derive, counts } = loadCaptureBlockModel();
  const failed = block({});
  const first = derive(failed);
  for (let mount = 0; mount < 50; mount++) {
    assert.strictEqual(derive(failed), first, 're-mount reuses the derived evidence');
  }
  assert.deepStrictEqual(first, [], 'Next.js webpack failure has no structured parser match');
  assert.strictEqual(counts.executionFromTranscriptBlock, 1, 'derived once per finalized block');
  assert.strictEqual(counts.parseEngineeringEvidence, 1, 'parsed once per finalized block');
  assert.strictEqual(failed.output, nextBuildFailure, 'raw evidence is untouched');
}

// D. Evidence already stored at finalization is used without re-deriving.
{
  const { derive, counts } = loadCaptureBlockModel();
  const stored = [{ id: 'stored', type: 'diagnostic' }];
  assert.strictEqual(derive(block({ structuredEvidence: stored })), stored);
  assert.strictEqual(counts.executionFromTranscriptBlock + counts.parseEngineeringEvidence, 0);
}

// E. A derivation failure yields no derived evidence instead of breaking the Capture card,
//    and is not retried on every render.
{
  const { derive, counts } = loadCaptureBlockModel({ throwOnDerive: true });
  const failed = block({ id: 'block-throws' });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepStrictEqual(derive(failed), []);
    assert.deepStrictEqual(derive(failed), []);
  } finally {
    console.warn = originalWarn;
  }
  assert.strictEqual(counts.executionFromTranscriptBlock, 1, 'failed derivation is isolated and not retried');
  assert.strictEqual(failed.output, nextBuildFailure, 'raw evidence remains available');
}

// F. Successful executions with parseable output keep their structured evidence.
{
  const { derive } = loadCaptureBlockModel();
  const tsc = block({
    id: 'block-tsc',
    command: 'npx tsc --noEmit',
    rawCommand: 'npx tsc --noEmit',
    output: "src/auth.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error.",
    outcome: 'failed',
  });
  const evidence = derive(tsc);
  assert.ok(evidence.some((e) => e.type === 'typecheck-summary'), 'tsc summary still derived');
  assert.ok(evidence.some((e) => e.type === 'diagnostic' && e.code === 'TS2322'), 'tsc diagnostic still derived');
}

// G. Blocks are isolated: a new block object (e.g. after finalization) is derived on its own,
//    and another terminal's block is unaffected by this block's cache entry.
{
  const { derive, counts } = loadCaptureBlockModel();
  const finished = block({ id: 'pane-a-block' });
  const otherPane = block({ id: 'pane-b-block', output: 'ok\n', outcome: 'succeeded', exitCode: 0 });
  derive(finished);
  derive(otherPane);
  derive({ ...finished, completedAt: 2 });
  assert.strictEqual(counts.parseEngineeringEvidence, 3, 'each distinct block object is derived exactly once');
}

console.log('HARDENING-004 failed-execution recovery tests passed.');
