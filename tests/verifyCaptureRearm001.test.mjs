/**
 * VERIFY-CAPTURE-REARM-001 — Verify must not permanently change the user's Capture state.
 *
 * Root cause (pre-existing): Verify forced its pane capture runtime to 'capturing' and never
 * restored it, so after Verify the next ordinary command was captured although Capture was
 * stopped/idle/paused. User Start/Stop/Pause during Verify also reset that runtime and stranded
 * the run as RUNNING.
 *
 * Contract: Verify holds a VerificationCaptureLease on its pane for the whole run. The lease
 * records the user's Capture status (prior status, replaced by any explicit user action during
 * the run) and applies it when the run ends on any path. These tests exercise the real lease
 * functions from features/workspace/runtime.ts and the App wiring.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

const src = fs.readFileSync(path.resolve(__dirname, '../app/src/features/workspace/runtime.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, (id) => {
  if (id.includes('transcriptSanitization')) return { StreamingTranscriptSanitizer: class {} };
  if (id.includes('commandBoundaryReconciler')) return { resetCommandBoundaryRuntime: () => {} };
  return {};
});
const {
  createPaneCaptureRuntime,
  acquireVerificationCaptureLease,
  deferUserCaptureStatus,
  getUserCaptureStatus,
  releaseVerificationCaptureLease,
} = mod.exports;

let batchSeq = 100;
const newBatch = () => ({ id: ++batchSeq, startedAt: 1, stoppedAt: null });
function paneRuntime(status, paneId = 'pane-1', workspaceId = 'ws-b') {
  const runtime = createPaneCaptureRuntime(workspaceId, 'tab-1', paneId);
  runtime.status = status;
  if (status !== 'idle') runtime.currentBatch = { id: 7, startedAt: 1, stoppedAt: null };
  return runtime;
}
// Mirrors App: the output handler only records while the runtime is capturing.
const recordsOrdinaryCommand = (runtime) => runtime.status === 'capturing';

console.log('Running VERIFY-CAPTURE-REARM-001 tests...');

// A-F. Every prior user state is restored exactly; observation is on during the run.
for (const prior of ['idle', 'capturing', 'paused']) {
  const runtime = paneRuntime(prior);
  const priorBatch = runtime.currentBatch;
  acquireVerificationCaptureLease(runtime, 'run-1', newBatch);
  assert.strictEqual(runtime.status, 'capturing', `${prior}: Verify observes its execution`);
  assert.strictEqual(getUserCaptureStatus(runtime), prior, `${prior}: user status is unchanged during Verify`);
  releaseVerificationCaptureLease(runtime, 'run-1');
  assert.strictEqual(runtime.status, prior, `${prior} -> Verify -> ${prior}`);
  assert.strictEqual(runtime.verificationLease, null);
  assert.strictEqual(runtime.currentBatch, priorBatch, `${prior}: batch restored`);
  assert.strictEqual(recordsOrdinaryCommand(runtime), prior === 'capturing', `${prior}: next ordinary command captured only when capturing`);
}

// G/H. Release is outcome-independent: passed, failed, cancelled and teardown all end the
// run through the same release, so a failed or cancelled run restores identically.
{
  const runtime = paneRuntime('idle');
  acquireVerificationCaptureLease(runtime, 'run-failed', newBatch);
  releaseVerificationCaptureLease(runtime, 'run-failed');
  assert.strictEqual(runtime.status, 'idle');
  assert.strictEqual(runtime.currentBatch, null, 'verification-only batch dropped');
}

// I. Multi-criterion: re-acquiring for later criteria keeps the original user status, and the
//    lease is only released by its own run.
{
  const runtime = paneRuntime('paused');
  acquireVerificationCaptureLease(runtime, 'run-multi', newBatch);
  acquireVerificationCaptureLease(runtime, 'run-multi', newBatch);
  acquireVerificationCaptureLease(runtime, 'run-multi', newBatch);
  assert.strictEqual(runtime.status, 'capturing');
  releaseVerificationCaptureLease(runtime, 'other-run');
  assert.strictEqual(runtime.status, 'capturing', 'another run cannot release this lease');
  releaseVerificationCaptureLease(runtime, 'run-multi');
  assert.strictEqual(runtime.status, 'paused');
}

// J/K. Identity: leases live on the target pane runtime (keyed by workspace/tab/pane), so other
//      panes and workspaces are never affected, whatever their order.
{
  const leased = paneRuntime('idle', 'pane-t1');
  const sibling = paneRuntime('capturing', 'pane-t2');
  const otherWorkspace = paneRuntime('paused', 'pane-x', 'ws-c');
  acquireVerificationCaptureLease(leased, 'run-1', newBatch);
  releaseVerificationCaptureLease(leased, 'run-1');
  assert.strictEqual(leased.status, 'idle');
  assert.strictEqual(sibling.status, 'capturing');
  assert.strictEqual(sibling.verificationLease, null);
  assert.strictEqual(otherWorkspace.status, 'paused');
}

// L. Newer user intent wins over the prior state.
for (const [prior, userStatus] of [
  ['idle', 'capturing'], // stopped -> Verify -> user Start
  ['capturing', 'idle'], // active -> Verify -> user Stop
  ['capturing', 'paused'], // active -> Verify -> user Pause
  ['paused', 'capturing'], // paused -> Verify -> user Resume
]) {
  const runtime = paneRuntime(prior);
  acquireVerificationCaptureLease(runtime, 'run-1', newBatch);
  assert.strictEqual(deferUserCaptureStatus(runtime, userStatus), true, 'user action deferred while leased');
  assert.strictEqual(runtime.status, 'capturing', 'Verify keeps observing its in-flight execution');
  assert.strictEqual(getUserCaptureStatus(runtime), userStatus, 'UI decisions see the newer user intent');
  releaseVerificationCaptureLease(runtime, 'run-1');
  assert.strictEqual(runtime.status, userStatus, `${prior} -> Verify -> user ${userStatus} -> ${userStatus}`);
}
{
  // A user Start during Verify installs its own batch, which release keeps.
  const runtime = paneRuntime('idle');
  acquireVerificationCaptureLease(runtime, 'run-1', newBatch);
  deferUserCaptureStatus(runtime, 'capturing');
  const userBatch = newBatch();
  runtime.currentBatch = userBatch;
  releaseVerificationCaptureLease(runtime, 'run-1');
  assert.strictEqual(runtime.currentBatch, userBatch);
}
// Without a lease, user actions are applied directly by the handlers.
assert.strictEqual(deferUserCaptureStatus(paneRuntime('idle'), 'capturing'), false);

// App wiring: Verify arms through the lease, every verification end path releases it, and user
// Capture controls defer to an active lease.
{
  const app = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  assert.match(app, /acquireVerificationCaptureLease\(paneRuntime, runId,/);
  assert.doesNotMatch(app, /paneRuntime\.status = 'capturing'/, 'Verify no longer forces Capture on directly');
  const directNulls = app.match(/verificationRuntimeRef\.current = null;/g) ?? [];
  assert.strictEqual(directNulls.length, 1, 'only endVerificationRuntime clears the runtime, so no end path bypasses release');
  assert.match(app, /const runtime = verificationRuntimeRef\.current;\s*verificationRuntimeRef\.current = null;\s*if \(!runtime\) return;[\s\S]{0,200}releaseVerificationCaptureLease\(paneRuntime, runtime\.runId\)/);
  const endCalls = app.match(/endVerificationRuntime\(verificationRuntimeRef, paneCaptureRuntimesRef\.current\)/g) ?? [];
  assert.ok(endCalls.length >= 13, `all verification end paths release (found ${endCalls.length})`);
  for (const status of ["'capturing'", "'paused'", "'idle'"]) {
    assert.match(app, new RegExp(`deferUserCaptureStatus\\((?:r|runtime), ${status}\\)`), `user ${status} action defers to the lease`);
  }
}

console.log('VERIFY-CAPTURE-REARM-001 tests passed.');
