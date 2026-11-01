/**
 * EXECUTION-ERROR-MODEL-001 Test Suite
 *
 * Real failures:
 * - Pasted shell comments ran `#` in zsh: `zsh: command not found: #` (exit 127). That is a
 *   command failure ExecRelay observed correctly, not an ExecRelay error.
 * - `_tracerelay_preexec:3: command not found: base64` came from ExecRelay's own trusted hook:
 *   an integration failure, which must not masquerade as a user command failure.
 *
 * Validates that execution outcome and ExecRelay/evidence health stay independent:
 * 1. Non-zero exit: failed + healthy.
 * 2. Exit 127 (command not found): failed, not an ExecRelay error.
 * 3. Trusted hook failure: health error, outcome not fabricated, raw evidence retained;
 *    only the authenticated hook can report it.
 * 4. Interrupt without a numeric exit: interrupted/unknown + degraded, never error.
 * 5. Success stays succeeded + healthy.
 * 6. Derived evidence failure keeps raw evidence and outcome, and degrades health.
 * 7. A sequence with one failed command and passing gates is not an ExecRelay error.
 * 8. Verify keeps "condition false" (failed) apart from "unevaluable" (error).
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

function load(relPath, customRequire = () => ({})) {
  const src = fs.readFileSync(path.resolve(__dirname, '../app/src', relPath), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

const execTypes = load('features/execution/types.ts');
const format = load('features/transcript/transcriptFormat.ts');
const cleanup = load('features/transcript/transcriptDisplayCleanup.ts', () => format);
const execModel = load('features/execution/executionModel.ts', (req) => {
  if (req.includes('transcriptFormat')) {
    return { ...format, cleanTranscriptForDisplay: cleanup.cleanTranscriptForDisplay };
  }
  if (req.includes('types')) return execTypes;
  return {};
});
const shellIntegration = load('features/terminal/shellIntegration.ts');
const verification = load('features/verification/verificationModel.ts');

const {
  deriveEvidenceHealth,
  deriveExecutionOutcome,
  deriveExecutionLifecycle,
  describeEvidenceHealth,
  executionFromTranscriptBlock,
  summarizeExecutionResults,
} = execModel;

function trustedBlock(overrides = {}) {
  return {
    id: overrides.id ?? 'block-1',
    batchId: 1,
    command: 'pnpm test',
    output: '',
    startedAt: 1000,
    completedAt: 2000,
    isComplete: true,
    lifecycle: 'finished',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    completionSource: 'shell',
    shellIntegrationLevel: 'rich',
    terminalPaneId: 'pane-1',
    terminalLabelAtCapture: 'zsh',
    ...overrides,
  };
}

console.log('Running EXECUTION-ERROR-MODEL-001 Test Suite...\n');

// 1. User command exits non-zero: failed + healthy.
{
  const exec = executionFromTranscriptBlock(
    trustedBlock({ exitCode: 1, output: '1 test failed\n' }),
  );
  assert.strictEqual(exec.outcome, 'failed');
  assert.strictEqual(exec.exitCode, 1);
  assert.strictEqual(exec.evidenceHealth, 'healthy');
  assert.deepStrictEqual(exec.evidenceIssues, []);
  assert.strictEqual(describeEvidenceHealth(deriveEvidenceHealth(trustedBlock({ exitCode: 1 }))), null);
  console.log('PASS 1: non-zero exit is failed + healthy');
}

// 2. Command not found / exit 127 is a command failure, not an ExecRelay error.
{
  const block = trustedBlock({
    command: '# 1. build packages',
    exitCode: 127,
    output: 'zsh: command not found: #\n',
  });
  const exec = executionFromTranscriptBlock(block);
  assert.strictEqual(exec.outcome, 'failed');
  assert.strictEqual(exec.exitCode, 127);
  assert.strictEqual(exec.evidenceHealth, 'healthy');
  // The diagnostic hint may flag the output, but it never affects evidence health.
  assert.strictEqual(exec.hasDiagnosticError, true);
  assert.strictEqual(deriveEvidenceHealth(block).health, 'healthy');
  console.log('PASS 2: exit 127 is a command failure with healthy evidence');
}

// 3. Trusted integration failure: error health, outcome not fabricated, raw evidence kept.
{
  const parsed = shellIntegration.parseOsc133Payload('C;aid=nonce-1;err=command-encode', 'nonce-1');
  assert.strictEqual(parsed.type, 'command-start');
  assert.strictEqual(parsed.trust, 'trusted');
  assert.strictEqual(parsed.hookError, 'command-encode');
  assert.strictEqual(parsed.command, undefined);

  // A spoofed marker with the wrong nonce stays untrusted, so App ignores its hookError.
  const spoofed = shellIntegration.parseOsc133Payload('C;aid=wrong;err=command-encode', 'nonce-1');
  assert.strictEqual(spoofed.trust, 'untrusted');
  const appSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes("const hookFailed = isTrusted && Boolean(ev.hookError);"));

  // Hook failed before a reliable end marker: unknown + error.
  const running = trustedBlock({
    isComplete: false,
    lifecycle: 'interrupted',
    completedAt: 2000,
    completionSource: 'capture-stop',
    outcomeSource: undefined,
    outcomeTrusted: undefined,
    exitCode: null,
    output: 'partial output',
    rawOutput: '\x1b[1mpartial output\x1b[0m',
    evidenceIssues: ['shell-integration-failed'],
  });
  const exec = executionFromTranscriptBlock(running);
  assert.strictEqual(exec.outcome, 'unknown');
  assert.strictEqual(exec.exitCode, null);
  assert.strictEqual(exec.evidenceHealth, 'error');
  assert.ok(exec.evidenceIssues.includes('shell-integration-failed'));
  const outputEvidence = exec.evidenceBlocks.find((b) => b.type === 'output' || b.type === 'error');
  assert.strictEqual(outputEvidence.rawText, '\x1b[1mpartial output\x1b[0m');
  const status = describeEvidenceHealth(deriveEvidenceHealth(running));
  assert.strictEqual(status.health, 'error');
  assert.strictEqual(status.label, 'ExecRelay error');
  assert.match(status.detail, /Shell integration failure/);

  // Hook failed, but the trusted end marker still carried the command's exit status: the
  // outcome is the command's, and the integration error is reported beside it.
  const ended = executionFromTranscriptBlock(
    trustedBlock({ exitCode: 0, evidenceIssues: ['shell-integration-failed'] }),
  );
  assert.strictEqual(ended.outcome, 'succeeded');
  assert.strictEqual(ended.evidenceHealth, 'error');
  console.log('PASS 3: trusted hook failure is an ExecRelay error without fabricated outcome');
}

// 4. Interrupt with unknown numeric status: interrupted/unknown + degraded, not error.
{
  const block = trustedBlock({
    lifecycle: 'interrupted',
    executionState: 'interrupted',
    completionSource: 'capture-stop',
    outcome: 'unknown',
    outcomeSource: undefined,
    outcomeTrusted: undefined,
    exitCode: null,
    output: '^C',
  });
  assert.strictEqual(deriveExecutionLifecycle(block), 'interrupted');
  assert.strictEqual(deriveExecutionOutcome(block), 'unknown');
  const health = deriveEvidenceHealth(block);
  assert.strictEqual(health.health, 'degraded');
  assert.deepStrictEqual(health.issues, ['exit-status-unavailable']);
  assert.strictEqual(describeEvidenceHealth(health).label, 'evidence degraded');

  // Trusted Ctrl+C with a numeric exit (130) is an ordinary failed command.
  const trustedInterrupt = deriveEvidenceHealth(trustedBlock({ exitCode: 130 }));
  assert.strictEqual(trustedInterrupt.health, 'healthy');

  // Without trusted integration the outcome stays unknown and health degraded, never error.
  const fallback = trustedBlock({
    outcomeSource: undefined,
    outcomeTrusted: undefined,
    completionSource: 'capture-boundary',
    shellIntegrationLevel: 'none',
    exitCode: null,
  });
  assert.strictEqual(deriveExecutionOutcome(fallback), 'unknown');
  assert.deepStrictEqual(deriveEvidenceHealth(fallback), {
    health: 'degraded',
    issues: ['trusted-integration-unavailable'],
  });

  // A running execution has no evidence verdict yet.
  assert.strictEqual(
    deriveEvidenceHealth(trustedBlock({ isComplete: false, lifecycle: 'running', exitCode: null })).health,
    'healthy',
  );
  console.log('PASS 4: interrupt without numeric exit is unknown + degraded');
}

// 5. Successful execution remains succeeded + healthy.
{
  const exec = executionFromTranscriptBlock(trustedBlock({ exitCode: 0, output: 'ok\n' }));
  assert.strictEqual(exec.outcome, 'succeeded');
  assert.strictEqual(exec.evidenceHealth, 'healthy');
  console.log('PASS 5: success is succeeded + healthy');
}

// 6. Derived evidence failure keeps raw evidence and outcome, and degrades health.
{
  const captureBlockModel = load('features/transcript/captureBlockModel.ts', (req) => {
    if (req.includes('executionModel')) return execModel;
    if (req.includes('parserEngine')) {
      return {
        buildParseContext: () => ({}),
        parseEngineeringEvidence: () => {
          throw new Error('parser crashed');
        },
      };
    }
    return {};
  });
  const block = trustedBlock({ exitCode: 2, output: 'diff error\n', rawOutput: 'diff error\r\n' });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    captureBlockModel.attachDerivedEvidence(block);
  } finally {
    console.warn = originalWarn;
  }
  assert.strictEqual(block.rawOutput, 'diff error\r\n');
  assert.strictEqual(block.output, 'diff error\n');
  assert.strictEqual(block.exitCode, 2);
  assert.strictEqual(deriveExecutionOutcome(block), 'failed');
  assert.deepStrictEqual(block.evidenceIssues, ['derived-evidence-failed']);
  assert.strictEqual(deriveEvidenceHealth(block).health, 'degraded');

  // App finalizes every execution through the guarded helper.
  const appSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  assert.strictEqual((appSrc.match(/attachDerivedEvidence\(/g) ?? []).length, 4);
  assert.ok(!appSrc.includes('parseEngineeringEvidence('));
  console.log('PASS 6: derived evidence failure retains raw evidence and degrades health');
}

// 7. A sequence with one failed command and passing gates is not an ExecRelay error.
{
  const commands = [
    ['# 1. build packages', 127],
    ['pnpm build:packages', 0],
    ['pnpm demo-audit', 0],
    ['pnpm --filter admin-web test', 0],
    ['pnpm typecheck', 0],
    ['pnpm --filter admin-client test', 0],
    ['pnpm --filter demo build', 0],
  ];
  const executions = commands.map(([command, exitCode], i) =>
    executionFromTranscriptBlock(trustedBlock({ id: `b${i}`, command, exitCode })),
  );
  const summary = summarizeExecutionResults(executions);
  assert.strictEqual(summary.succeeded.length, 6);
  assert.strictEqual(summary.failed.length, 1);
  assert.strictEqual(summary.failed[0].command, '# 1. build packages');
  assert.strictEqual(summary.failed[0].exitCode, 127);
  assert.strictEqual(summary.evidenceHealth, 'healthy');

  const withDegraded = summarizeExecutionResults([
    ...executions,
    executionFromTranscriptBlock(
      trustedBlock({ id: 'b-int', lifecycle: 'interrupted', exitCode: null, outcomeSource: undefined }),
    ),
  ]);
  assert.strictEqual(withDegraded.unknown.length, 1);
  assert.strictEqual(withDegraded.evidenceHealth, 'degraded');
  console.log('PASS 7: one failed command does not turn the sequence into an ExecRelay error');
}

// 8. Verify: non-zero exit is a failed condition; missing trusted evidence is unevaluable.
{
  const criterion = { id: 'c1', type: 'command', label: 'test', command: 'pnpm test', expectedExitCodes: [0], order: 0 };
  const failed = verification.evaluateCriterionResult(
    criterion,
    executionFromTranscriptBlock(trustedBlock({ exitCode: 127 })),
  );
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.observedExitCode, 127);

  const unevaluable = verification.evaluateCriterionResult(
    criterion,
    executionFromTranscriptBlock(
      trustedBlock({ outcomeSource: undefined, outcomeTrusted: undefined, completionSource: 'capture-boundary', exitCode: null }),
    ),
  );
  assert.strictEqual(unevaluable.status, 'error');
  console.log('PASS 8: Verify keeps failed condition apart from unevaluable evidence');
}

console.log('\nAll EXECUTION-ERROR-MODEL-001 tests passed.');
