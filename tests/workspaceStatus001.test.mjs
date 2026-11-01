/**
 * WORKSPACE-STATUS-001 Test Suite
 *
 * Reported: a workspace's dot turned red with a failed Capture block and stayed red after the
 * block was deleted. Finding: the dot is the workspace's Capture indicator (CAPTURE-STATUS-
 * WORKSPACE-001R: idle green, capturing red, paused amber), derived from the current capture
 * state on every render. It carries no error state, so nothing can latch; it stays red
 * while Capture is still active.
 *
 * Pins that derivation:
 * 1. Failed blocks and ExecRelay-error blocks never change the dot.
 * 2. Deleting blocks never changes it; only the capture state does.
 * 3. Stopping Capture clears red even while a failed block remains.
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

const src = fs.readFileSync(path.resolve(__dirname, '../app/src/features/workspace/types.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const { getWorkspaceCaptureStatus } = mod.exports;

const failed = { id: 'b1', outcome: 'failed', exitCode: 7, isComplete: true };
const hookError = { id: 'b2', outcome: 'unknown', exitCode: null, isComplete: true, evidenceIssues: ['shell-integration-failed'] };
const workspace = (capture) => ({ capture: { blocks: [], currentBatch: null, isListening: false, ...capture } });
const capturing = { isListening: true, currentBatch: { id: 1, stoppedAt: null } };
const stopped = { isListening: false, currentBatch: { id: 1, stoppedAt: 2000 } };

// 1. Blocks never change the dot
for (const blocks of [[], [failed], [hookError], [failed, hookError]]) {
  assert.strictEqual(getWorkspaceCaptureStatus(workspace({ ...capturing, blocks })), 'capturing');
  assert.strictEqual(getWorkspaceCaptureStatus(workspace({ ...stopped, blocks })), 'ready');
}
console.log('✓ 1. Failed and ExecRelay-error blocks never change the workspace dot');

// 2. Deleting blocks never changes it
let ws = workspace({ ...capturing, blocks: [failed, hookError] });
ws = { capture: { ...ws.capture, blocks: [hookError] } };
assert.strictEqual(getWorkspaceCaptureStatus(ws), 'capturing');
ws = { capture: { ...ws.capture, blocks: [] } };
assert.strictEqual(getWorkspaceCaptureStatus(ws), 'capturing');
console.log('✓ 2. Deleting blocks never changes the dot; only the capture state does');

// 3. Stopping Capture clears red while a failed block remains
assert.strictEqual(getWorkspaceCaptureStatus(workspace({ ...stopped, blocks: [failed] })), 'ready');
console.log('✓ 3. Stopping Capture clears red even with a failed block present');

console.log('WORKSPACE-STATUS-001 tests passed.');
