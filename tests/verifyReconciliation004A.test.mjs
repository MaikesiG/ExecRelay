/**
 * HARDENING-004A — Verify run stuck RUNNING after its command completed.
 *
 * Root cause (pre-existing): a fast verification command's trusted command-end can be
 * handled before React applies the queued registration of its execution block. The
 * finalizer then could not find the block in workspacesRef and built a generic fallback
 * block with `intent: 'interactive'` and no run/criterion identity, so the verification
 * completion handler rejected it and the run stayed RUNNING forever.
 *
 * Fix: fallback finalization derives execution identity from the verification runtime that
 * owns the execution (resolveFallbackExecutionIdentity). Real-app A/B with a deterministic
 * race: clean HEAD stuck on the first run, the fix passed every run.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

const cache = new Map();
function loadTs(absPath) {
  if (cache.has(absPath)) return cache.get(absPath);
  const mod = { exports: {} };
  cache.set(absPath, mod.exports);
  const js = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (id) => {
    if (!id.startsWith('.')) return {};
    const resolved = path.resolve(path.dirname(absPath), id);
    for (const candidate of [`${resolved}.ts`, path.join(resolved, 'index.ts')]) {
      if (fs.existsSync(candidate)) return loadTs(candidate);
    }
    return {};
  });
  cache.set(absPath, mod.exports);
  return mod.exports;
}

const { resolveFallbackExecutionIdentity } = loadTs(
  path.resolve(__dirname, '../app/src/features/verification/verificationReconciliation.ts'),
);

// Mirrors the identity filter in App.tsx handleVerificationExecutionCompleted: only a block
// carrying the run's verification identity can complete the active criterion.
function acceptedByVerificationHandler(runtime, block) {
  const activeExecId = runtime.currentExecutionId ?? runtime.expectedExecutionId;
  const activeCriterionId = runtime.currentCriterionId ?? runtime.expectedCriterionId;
  return !(
    block.intent !== 'verification' ||
    block.workspaceId !== runtime.workspaceId ||
    block.verificationRunId !== runtime.runId ||
    (activeCriterionId && block.verificationCriterionId !== activeCriterionId) ||
    (activeExecId && block.id !== activeExecId && block.executionId !== activeExecId)
  );
}

function fallbackBlock(runtime, workspaceId, executionId) {
  return {
    id: executionId,
    executionId,
    ...resolveFallbackExecutionIdentity(runtime, workspaceId, executionId),
    workspaceId,
    isComplete: true,
    exitCode: 0,
  };
}

console.log('Running HARDENING-004A Verify reconciliation tests...');

const runtime = {
  workspaceId: 'ws-a',
  runId: 'run-1',
  currentCriterionId: 'crit-1',
  expectedCriterionId: 'crit-1',
  currentExecutionId: 'exec-1',
  expectedExecutionId: 'exec-1',
};

// The execution owned by the active run keeps its verification identity and completes it.
{
  const block = fallbackBlock(runtime, 'ws-a', 'exec-1');
  assert.deepStrictEqual(
    resolveFallbackExecutionIdentity(runtime, 'ws-a', 'exec-1'),
    { intent: 'verification', verificationRunId: 'run-1', verificationCriterionId: 'crit-1' },
  );
  assert.ok(acceptedByVerificationHandler(runtime, block), 'fallback-finalized execution completes the run');
}

// Before the fix the fallback was a plain interactive block, which the handler rejects.
{
  const legacyFallback = { id: 'exec-1', executionId: 'exec-1', intent: 'interactive', workspaceId: 'ws-a' };
  assert.ok(!acceptedByVerificationHandler(runtime, legacyFallback), 'documents the original stuck-RUNNING cause');
}

// Expected-only ownership (current already cleared) still keeps identity.
assert.strictEqual(
  resolveFallbackExecutionIdentity({ ...runtime, currentExecutionId: undefined }, 'ws-a', 'exec-1').intent,
  'verification',
);

// Ownership is by stable identity: another workspace, execution, or no runtime never
// borrows the run's identity, so it cannot satisfy that run.
for (const [rt, ws, exec, label] of [
  [runtime, 'ws-b', 'exec-1', 'execution in another workspace'],
  [runtime, 'ws-a', 'exec-2', 'interactive command in the same pane'],
  [null, 'ws-a', 'exec-1', 'no active verification'],
]) {
  assert.deepStrictEqual(resolveFallbackExecutionIdentity(rt, ws, exec), { intent: 'interactive' }, label);
  assert.ok(!acceptedByVerificationHandler(runtime, fallbackBlock(rt, ws, exec)), `${label} cannot complete the run`);
}

// Every finalizer fallback in App.tsx uses the runtime-derived identity.
{
  const app = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  const fallbacks = [...app.matchAll(/\.\.\.\(existingBlock \?\? \{([\s\S]*?)\}\),/g)].map((m) => m[1]);
  assert.strictEqual(fallbacks.length, 4, 'four finalizer fallbacks');
  for (const body of fallbacks) {
    assert.match(body, /\.\.\.resolveFallbackExecutionIdentity\(\s*verificationRuntimeRef\.current,\s*workspaceId,/);
    assert.doesNotMatch(body, /intent: 'interactive'/);
  }
}

console.log('HARDENING-004A Verify reconciliation tests passed.');
