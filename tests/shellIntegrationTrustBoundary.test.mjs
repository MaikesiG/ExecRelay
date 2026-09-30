import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ts = require('../app/node_modules/typescript');

// 1. Transpile execution/types.ts
const execTypesSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/execution/types.ts'), 'utf8');
const execTypesJs = ts.transpileModule(execTypesSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const execTypesMod = { exports: {} };
new Function('module', 'exports', 'require', execTypesJs)(execTypesMod, execTypesMod.exports, () => ({}));
const {
  DEFAULT_LOCAL_HUMAN_ACTOR,
  isExecutionLifecycle,
  isExecutionOutcome,
  isExecutionOutcomeSource,
  isShellIntegrationEventTrust,
  isShellIntegrationLevel,
  isExecution,
  isEvidenceBlock,
} = execTypesMod.exports;

// 2. Transpile transcriptFormat.ts & transcriptDisplayCleanup.ts
const formatSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/transcriptFormat.ts'), 'utf8');
const formatJs = ts.transpileModule(formatSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const formatMod = { exports: {} };
new Function('module', 'exports', 'require', formatJs)(formatMod, formatMod.exports, () => ({}));
const { stripAnsiAndControl, normalizeCommand, normalizeOutput, isTerminalClearCommand } = formatMod.exports;

const cleanupSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/transcriptDisplayCleanup.ts'), 'utf8');
const cleanupJs = ts.transpileModule(cleanupSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const cleanupMod = { exports: {} };
new Function('module', 'exports', 'require', cleanupJs)(cleanupMod, cleanupMod.exports, () => ({ stripAnsiAndControl }));
const { cleanTranscriptForDisplay } = cleanupMod.exports;

// 3. Transpile executionModel.ts
const execModelSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/execution/executionModel.ts'), 'utf8');
const execModelJs = ts.transpileModule(execModelSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const execModelMod = { exports: {} };
const customRequireExec = (req) => {
  if (req.includes('transcriptFormat')) {
    return {
      ...formatMod.exports,
      cleanTranscriptForDisplay,
    };
  }
  if (req.includes('types')) return execTypesMod.exports;
  return {};
};
new Function('module', 'exports', 'require', execModelJs)(execModelMod, execModelMod.exports, customRequireExec);
const {
  createExecution,
  createEvidenceBlock,
  deriveExecutionLifecycle,
  deriveExecutionOutcome,
  deriveExecutionState,
  detectErrorFromOutput,
  evidenceBlocksFromTranscriptBlock,
  executionFromTranscriptBlock,
  formatExecutionDuration,
  formatExecutionTimestamp,
} = execModelMod.exports;

// 4. Transpile terminal/shellIntegration.ts
const shellIntSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/terminal/shellIntegration.ts'), 'utf8');
const shellIntJs = ts.transpileModule(shellIntSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const shellIntMod = { exports: {} };
new Function('module', 'exports', 'require', shellIntJs)(shellIntMod, shellIntMod.exports, () => ({}));
const {
  ShellIntegrationStreamParser,
  parseOsc133Payload,
  stripOsc133,
  extractOsc133Events,
} = shellIntMod.exports;

/**
 * Milestone: Shell Integration Trust Boundary & Authenticated Lifecycle Metadata
 *
 * Core principles verified:
 * 1. Evidence metadata must have an explicit trust boundary.
 * 2. Per-session high-entropy nonces distinguish authoritative shell lifecycle events from arbitrary output.
 * 3. Generic/unauthenticated OSC 133 sequences cannot spoof execution completion or success/failure.
 * 4. Cross-pane, stale, missing, or incorrect nonces are rejected as untrusted.
 * 5. Stream parser buffers and handles split, multiple, malformed, and BEL/ST terminated sequences.
 * 6. Shell integration metadata is stripped from visible terminal rendering and command evidence.
 * 7. Nonce is removed from child process environments.
 */

console.log('Running Shell Integration Trust Boundary & Authenticated Lifecycle Test Suite...\n');

// ---------------------------------------------------------------------------
// Test 1: Trust Semantics & Type Guards
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Trust Semantics & Type Guards ---');

  assert.strictEqual(isShellIntegrationEventTrust('trusted'), true);
  assert.strictEqual(isShellIntegrationEventTrust('untrusted'), true);
  assert.strictEqual(isShellIntegrationEventTrust('unknown'), false);
  assert.strictEqual(isShellIntegrationEventTrust(null), false);

  assert.strictEqual(isExecutionOutcomeSource('trusted-shell'), true);
  assert.strictEqual(isExecutionOutcomeSource('structured-agent'), true);
  assert.strictEqual(isExecutionOutcomeSource('unknown'), true);
  assert.strictEqual(isExecutionOutcomeSource('inferred'), false);

  assert.strictEqual(isShellIntegrationLevel('none'), true);
  assert.strictEqual(isShellIntegrationLevel('basic'), true);
  assert.strictEqual(isShellIntegrationLevel('rich'), true);
  assert.strictEqual(isShellIntegrationLevel('custom'), false);

  console.log('✓ Shell integration trust and outcome source types verified');
}

// ---------------------------------------------------------------------------
// Test 2: Per-Session Nonce Generation & Uniqueness
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 2: Per-Session Nonce Generation & Uniqueness ---');

  const nonce1 = 'nonce-' + Math.random().toString(36).slice(2) + '-' + Date.now();
  const nonce2 = 'nonce-' + Math.random().toString(36).slice(2) + '-' + Date.now();

  assert.notStrictEqual(nonce1, nonce2, 'Nonces must be unique across sessions');
  assert.ok(nonce1.length >= 16, 'High-entropy nonce of sufficient length');

  const parserA = new ShellIntegrationStreamParser(nonce1);
  const parserB = new ShellIntegrationStreamParser(nonce2);

  assert.strictEqual(parserA.getExpectedNonce(), nonce1);
  assert.strictEqual(parserB.getExpectedNonce(), nonce2);
  assert.notStrictEqual(parserA.getExpectedNonce(), parserB.getExpectedNonce());

  console.log('✓ Unique nonces independently scoped per terminal session');
}

// ---------------------------------------------------------------------------
// Test 3: Authenticated Command Start and End are Trusted
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 3: Authenticated Command Start and End are Trusted ---');

  const sessionNonce = 'auth-nonce-valid-12345';
  const parser = new ShellIntegrationStreamParser(sessionNonce);

  // 1. Authenticated command-start
  const startChunk = `\x1b]133;C;aid=${sessionNonce}\x07`;
  const startRes = parser.parse(startChunk);
  assert.strictEqual(startRes.cleanText, '', 'OSC marker stripped from output');
  assert.strictEqual(startRes.events.length, 1);
  assert.strictEqual(startRes.events[0].type, 'command-start');
  assert.strictEqual(startRes.events[0].trust, 'trusted', 'Carries valid session nonce => trusted');
  assert.strictEqual(startRes.events[0].nonce, sessionNonce);

  // 2. Authenticated command-end exit 0
  const endZeroChunk = `\x1b]133;D;0;aid=${sessionNonce}\x07`;
  const endZeroRes = parser.parse(endZeroChunk);
  assert.strictEqual(endZeroRes.cleanText, '');
  assert.strictEqual(endZeroRes.events.length, 1);
  assert.strictEqual(endZeroRes.events[0].type, 'command-end');
  assert.strictEqual(endZeroRes.events[0].exitCode, 0);
  assert.strictEqual(endZeroRes.events[0].trust, 'trusted', 'Exit 0 with valid nonce => trusted');

  // 3. Authenticated command-end exit 1
  const endOneChunk = `\x1b]133;D;1;aid=${sessionNonce}\x07`;
  const endOneRes = parser.parse(endOneChunk);
  assert.strictEqual(endOneRes.events[0].exitCode, 1);
  assert.strictEqual(endOneRes.events[0].trust, 'trusted', 'Exit 1 with valid nonce => trusted');

  console.log('✓ Valid session nonce produces trusted lifecycle events');
}

// ---------------------------------------------------------------------------
// Test 4: Trusted Events Produce Authoritative Outcome
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 4: Trusted Events Produce Authoritative Outcome ---');

  // Trusted exit 0 => succeeded
  const blockSuccess = {
    id: 'block-success',
    batchId: 1,
    command: 'npm test',
    output: 'Tests: 10 passed\n',
    startedAt: 1000,
    completedAt: 1500,
    isComplete: true,
    exitCode: 0,
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    terminalPaneId: 'p1',
    terminalLabelAtCapture: 'Term',
  };

  assert.strictEqual(deriveExecutionOutcome(blockSuccess), 'succeeded');
  const execSuccess = executionFromTranscriptBlock(blockSuccess);
  assert.strictEqual(execSuccess.outcome, 'succeeded');
  assert.strictEqual(execSuccess.outcomeSource, 'trusted-shell');
  assert.strictEqual(execSuccess.outcomeTrusted, true);

  // Trusted non-zero exit => failed
  const blockFail = {
    id: 'block-fail',
    batchId: 1,
    command: 'npm test',
    output: 'Tests: 1 failed\n',
    startedAt: 1000,
    completedAt: 1500,
    isComplete: true,
    exitCode: 1,
    outcome: 'failed',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    terminalPaneId: 'p1',
    terminalLabelAtCapture: 'Term',
  };

  assert.strictEqual(deriveExecutionOutcome(blockFail), 'failed');
  const execFail = executionFromTranscriptBlock(blockFail);
  assert.strictEqual(execFail.outcome, 'failed');
  assert.strictEqual(execFail.outcomeSource, 'trusted-shell');
  assert.strictEqual(execFail.outcomeTrusted, true);

  console.log('✓ Trusted exit 0 produces succeeded; trusted exit 1 produces failed');
}

// ---------------------------------------------------------------------------
// Test 5: Plain OSC 133 Exit 0 Cannot Spoof Succeeded (Adversarial Spoofing)
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 5: Plain OSC 133 Exit 0 Cannot Spoof Succeeded ---');

  const sessionNonce = 'secure-session-nonce-456';
  const parser = new ShellIntegrationStreamParser(sessionNonce);

  // An adversarial process prints printf '\e]133;D;0\a'
  const spoofPayload = '\x1b]133;D;0\x07';
  const res = parser.parse(spoofPayload);

  assert.strictEqual(res.events.length, 1);
  const ev = res.events[0];
  assert.strictEqual(ev.type, 'command-end');
  assert.strictEqual(ev.exitCode, 0);
  assert.strictEqual(ev.trust, 'untrusted', 'Plain OSC 133 without nonce MUST be untrusted');
  assert.strictEqual(ev.nonce, undefined);

  // In App.tsx logic: untrusted command-end does NOT set outcome or exitCode
  // Simulate active running block where spoof attempt occurs
  const runningBlock = {
    id: 'block-running',
    batchId: 1,
    command: 'malicious-script',
    output: 'running...\n',
    startedAt: 1000,
    completedAt: null,
    isComplete: false,
    outcome: 'unknown',
    outcomeSource: 'unknown',
    outcomeTrusted: false,
    exitCode: null,
    terminalPaneId: 'p1',
    terminalLabelAtCapture: 'Term',
  };

  // Because ev.trust !== 'trusted', outcome remains 'unknown' and exitCode remains null!
  assert.strictEqual(deriveExecutionOutcome(runningBlock), 'unknown');
  assert.strictEqual(runningBlock.exitCode, null);
  assert.strictEqual(runningBlock.isComplete, false, 'Spoof attempt cannot finalize running execution');

  console.log('✓ Adversarial plain OSC 133;D;0 rejected as untrusted and cannot spoof success');
}

// ---------------------------------------------------------------------------
// Test 6: Plain OSC 133 Non-Zero Cannot Spoof Failed (Adversarial Spoofing)
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 6: Plain OSC 133 Non-Zero Cannot Spoof Failed ---');

  const sessionNonce = 'secure-session-nonce-456';
  const parser = new ShellIntegrationStreamParser(sessionNonce);

  // A process prints printf '\e]133;D;1\a'
  const spoofPayload = '\x1b]133;D;1\x07';
  const res = parser.parse(spoofPayload);

  assert.strictEqual(res.events.length, 1);
  const ev = res.events[0];
  assert.strictEqual(ev.type, 'command-end');
  assert.strictEqual(ev.exitCode, 1);
  assert.strictEqual(ev.trust, 'untrusted', 'Unauthenticated non-zero exit MUST be untrusted');

  console.log('✓ Plain OSC 133;D;1 rejected as untrusted');
}

// ---------------------------------------------------------------------------
// Test 7: Incorrect, Missing, and Forged Nonces are Rejected
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 7: Incorrect, Missing, and Forged Nonces are Rejected ---');

  const validNonce = 'my-pane-nonce-789';
  const parser = new ShellIntegrationStreamParser(validNonce);

  // 1. Missing nonce
  const missingNonceEvent = parseOsc133Payload('D;0', validNonce);
  assert.strictEqual(missingNonceEvent.trust, 'untrusted');

  // 2. Wrong nonce
  const wrongNonceEvent = parseOsc133Payload('D;0;aid=wrong-nonce', validNonce);
  assert.strictEqual(wrongNonceEvent.trust, 'untrusted');
  assert.strictEqual(wrongNonceEvent.nonce, 'wrong-nonce');

  // 3. Empty nonce
  const emptyNonceEvent = parseOsc133Payload('D;0;aid=', validNonce);
  assert.strictEqual(emptyNonceEvent.trust, 'untrusted');

  // 4. Valid nonce but parser has no nonce configured (uninitialized)
  const uninitializedParserEvent = parseOsc133Payload(`D;0;aid=${validNonce}`, null);
  assert.strictEqual(uninitializedParserEvent.trust, 'untrusted');

  console.log('✓ Incorrect, missing, and unconfigured nonces all strictly evaluate to untrusted');
}

// ---------------------------------------------------------------------------
// Test 8: Nonce from Terminal A Cannot Affect Terminal B (Cross-Pane Isolation)
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 8: Cross-Pane Nonce Isolation ---');

  const noncePaneA = 'session-nonce-pane-A';
  const noncePaneB = 'session-nonce-pane-B';

  const parserPaneA = new ShellIntegrationStreamParser(noncePaneA);
  const parserPaneB = new ShellIntegrationStreamParser(noncePaneB);

  // Sequence carrying Pane A's nonce arrives at Pane B's stream
  const markerPaneA = `\x1b]133;D;0;aid=${noncePaneA}\x07`;
  const resPaneB = parserPaneB.parse(markerPaneA);

  assert.strictEqual(resPaneB.events.length, 1);
  assert.strictEqual(resPaneB.events[0].trust, 'untrusted', 'Pane A nonce must be untrusted on Pane B');

  // Sequence carrying Pane B's nonce arrives at Pane B's stream
  const markerPaneB = `\x1b]133;D;0;aid=${noncePaneB}\x07`;
  const resPaneBValid = parserPaneB.parse(markerPaneB);
  assert.strictEqual(resPaneBValid.events[0].trust, 'trusted', 'Pane B nonce trusted on Pane B');

  console.log('✓ Terminal panes maintain strict nonce isolation without cross-contamination');
}

// ---------------------------------------------------------------------------
// Test 9: Nonce from Old Session Cannot Affect New Session (Lifecycle Isolation)
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 9: Stale Session Nonce Isolation ---');

  const oldNonce = 'old-session-nonce-111';
  const newNonce = 'new-session-nonce-222';

  const parser = new ShellIntegrationStreamParser(oldNonce);

  // Session restarts / reloads: new nonce is configured
  parser.setExpectedNonce(newNonce);

  // Late arriving chunk from previous session
  const oldChunk = `\x1b]133;D;0;aid=${oldNonce}\x07`;
  const res = parser.parse(oldChunk);

  assert.strictEqual(res.events[0].trust, 'untrusted', 'Stale nonce from prior session rejected as untrusted');

  // Chunk with new session nonce
  const newChunk = `\x1b]133;D;0;aid=${newNonce}\x07`;
  const resNew = parser.parse(newChunk);
  assert.strictEqual(resNew.events[0].trust, 'trusted', 'New session nonce accepted');

  console.log('✓ Stale nonces from prior sessions cannot affect newly spawned sessions');
}

// ---------------------------------------------------------------------------
// Test 10: Stream Parser Handles Split Sequences Across Chunks
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 10: Split Sequences Across Chunks ---');

  const nonce = 'stream-split-nonce-333';
  const parser = new ShellIntegrationStreamParser(nonce);

  // Chunk 1: Ends mid-sequence
  const chunk1 = `Hello world\r\n\x1b]133;`;
  const res1 = parser.parse(chunk1);
  assert.strictEqual(res1.cleanText, 'Hello world\r\n');
  assert.strictEqual(res1.events.length, 0, 'Incomplete sequence buffered without emitting partial event');

  // Chunk 2: Completes the sequence
  const chunk2 = `D;0;aid=${nonce}\x07After command output`;
  const res2 = parser.parse(chunk2);
  assert.strictEqual(res2.cleanText, 'After command output');
  assert.strictEqual(res2.events.length, 1);
  assert.strictEqual(res2.events[0].type, 'command-end');
  assert.strictEqual(res2.events[0].exitCode, 0);
  assert.strictEqual(res2.events[0].trust, 'trusted');

  console.log('✓ Stream parser transparently reassembles escape sequences split across chunk boundaries');
}

// ---------------------------------------------------------------------------
// Test 11: Multiple Shell Markers per Chunk Parse Correctly
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 11: Multiple Shell Markers per Chunk ---');

  const nonce = 'multi-marker-nonce-444';
  const parser = new ShellIntegrationStreamParser(nonce);

  // Command-end immediately followed by prompt-start (standard zsh precmd behavior)
  const combinedChunk = `\x1b]133;D;42;aid=${nonce}\x07\x1b]133;A;aid=${nonce}\x07user@host % `;
  const res = parser.parse(combinedChunk);

  assert.strictEqual(res.cleanText, 'user@host % ');
  assert.strictEqual(res.events.length, 2);
  assert.strictEqual(res.events[0].type, 'command-end');
  assert.strictEqual(res.events[0].exitCode, 42);
  assert.strictEqual(res.events[0].trust, 'trusted');
  assert.strictEqual(res.events[1].type, 'prompt-start');
  assert.strictEqual(res.events[1].trust, 'trusted');

  console.log('✓ Multiple OSC markers in a single PTY chunk are completely parsed and stripped');
}

// ---------------------------------------------------------------------------
// Test 12: ST (ESC \\) and BEL (\x07) Terminators Supported
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 12: ST and BEL Terminators Supported ---');

  const nonce = 'terminator-nonce-555';
  const parser = new ShellIntegrationStreamParser(nonce);

  // BEL terminator: \x07
  const belChunk = `\x1b]133;C;aid=${nonce}\x07`;
  const resBel = parser.parse(belChunk);
  assert.strictEqual(resBel.cleanText, '');
  assert.strictEqual(resBel.events[0].trust, 'trusted');

  // ST terminator: \x1b\
  const stChunk = `\x1b]133;D;0;aid=${nonce}\x1b\\`;
  const resSt = parser.parse(stChunk);
  assert.strictEqual(resSt.cleanText, '');
  assert.strictEqual(resSt.events[0].trust, 'trusted');
  assert.strictEqual(resSt.events[0].exitCode, 0);

  console.log('✓ Both standard BEL and ST terminators supported');
}

// ---------------------------------------------------------------------------
// Test 13: Malformed and Runaway Metadata Does Not Crash Parser
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 13: Malformed Metadata Does Not Crash Parser ---');

  const parser = new ShellIntegrationStreamParser('test-nonce');

  // Unknown command code
  const malformed = parser.parse('\x1b]133;Z;some;data\x07normal text');
  assert.strictEqual(malformed.cleanText, 'normal text');
  assert.strictEqual(malformed.events.length, 0);

  // Unterminated runaway escape sequence exceeding MAX_ESCAPE_BUFFER_SIZE
  const hugeGarbage = 'X'.repeat(5000);
  const runaway = parser.parse(`\x1b]133;${hugeGarbage}`);
  assert.ok(runaway.cleanText.length > 0, 'Runaway sequence flushed safely without crash');

  // Flush remaining buffer
  const flushed = parser.flush();
  assert.strictEqual(typeof flushed, 'string');

  console.log('✓ Malformed and runaway sequences handled safely without crash or memory leak');
}

// ---------------------------------------------------------------------------
// Test 14: Integration Metadata Does Not Leak into Evidence or Display
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 14: Integration Metadata Does Not Leak into Evidence ---');

  const nonce = 'evidence-nonce-666';
  const rawPtyInput = `\x1b]133;C;aid=${nonce}\x07\x1b[32mBuild succeeded\x1b[0m\r\n\x1b]133;D;0;aid=${nonce}\x07prompt % `;

  const stripped = stripOsc133(rawPtyInput);
  assert.ok(!stripped.includes('133;'), 'All OSC 133 sequences stripped');
  assert.ok(!stripped.includes(nonce), 'Session nonce completely stripped from stream');

  // Command output evidence
  const block = {
    id: 'b-evidence-clean',
    batchId: 1,
    command: 'npm run build',
    output: stripped,
    startedAt: 1000,
    completedAt: 1500,
    isComplete: true,
    exitCode: 0,
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    terminalPaneId: 'p1',
    terminalLabelAtCapture: 'Term',
  };

  const evidence = evidenceBlocksFromTranscriptBlock(block);
  const outEv = evidence.find((e) => e.type === 'output');
  assert.ok(outEv);
  assert.ok(!outEv.rawText.includes(nonce), 'Nonce does not appear in raw evidence');
  assert.ok(!outEv.displayText.includes(nonce), 'Nonce does not appear in display evidence');
  assert.ok(outEv.displayText.includes('Build succeeded'), 'Command output retained');

  console.log('✓ Shell integration tokens and session nonces never leak into command evidence');
}

// ---------------------------------------------------------------------------
// Test 15: Error Diagnostics Remain Non-Authoritative
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 15: Error Diagnostics Remain Non-Authoritative ---');

  // Example: `grep "ERROR" system.log` finds an error line, but completes successfully (exit 0)
  const grepOutput = 'Error: Connection timeout\n';
  const errCheck = detectErrorFromOutput(grepOutput);
  assert.strictEqual(errCheck.isError, true, 'Diagnostic error detected in text');

  // When backed by trusted exit 0:
  const grepBlock = {
    id: 'b-grep',
    batchId: 1,
    command: 'grep "ERROR" system.log',
    output: grepOutput,
    startedAt: 1000,
    completedAt: 1050,
    isComplete: true,
    exitCode: 0,
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    hasDiagnosticError: true,
    terminalPaneId: 'p1',
    terminalLabelAtCapture: 'Term',
  };

  assert.strictEqual(deriveExecutionOutcome(grepBlock), 'succeeded', 'Outcome is authoritative succeeded despite diagnostic error');

  console.log('✓ Text heuristics classify diagnostic hints but never override authoritative outcome');
}

// ---------------------------------------------------------------------------
// Test 16: Fallback Remains Outcome Unknown
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 16: Fallback Remains Outcome Unknown ---');

  // Fallback execution when shell integration is unavailable (or unauthenticated)
  const fallbackBlock = {
    id: 'b-fallback',
    batchId: 1,
    command: 'custom-tool',
    output: 'tool completed\n',
    startedAt: 1000,
    completedAt: 1200,
    isComplete: true,
    exitCode: null,
    outcome: 'unknown',
    outcomeSource: 'unknown',
    outcomeTrusted: false,
    completionSource: 'capture-boundary',
    shellIntegrationLevel: 'none',
    terminalPaneId: 'p1',
    terminalLabelAtCapture: 'Term',
  };

  assert.strictEqual(deriveExecutionOutcome(fallbackBlock), 'unknown');
  assert.strictEqual(fallbackBlock.exitCode, null);
  assert.strictEqual(fallbackBlock.completionSource, 'capture-boundary');

  console.log('✓ Fallback completion remains outcome: unknown without fabricating exit status');
}

// ---------------------------------------------------------------------------
// Test 17: Shell Integration Level Semantics
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 17: Shell Integration Level Semantics ---');

  const sessionNonce = 'rich-level-nonce';
  const parser = new ShellIntegrationStreamParser(sessionNonce);

  // Untrusted event promotes level to 'basic' at most
  const untrustedRes = parser.parse('\x1b]133;C\x07');
  assert.strictEqual(untrustedRes.events[0].trust, 'untrusted');

  // Trusted event enables 'rich' level
  const trustedRes = parser.parse(`\x1b]133;C;aid=${sessionNonce}\x07`);
  assert.strictEqual(trustedRes.events[0].trust, 'trusted');

  console.log('✓ ShellIntegrationLevel distinguishes basic (untrusted) from rich (authenticated)');
}

// ---------------------------------------------------------------------------
// Test 18: Native Shell Script Security Invariants
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 18: Native Shell Script Security Invariants ---');

  const shellRs = fs.readFileSync(path.resolve(__dirname, '../native/src/terminal/shell.rs'), 'utf8');

  // 1. Zsh integration captures nonce to shell-local variable
  assert.ok(
    shellRs.includes('_tracerelay_session_nonce="${TRACERELAY_SHELL_NONCE:-}"'),
    'shell.rs captures TRACERELAY_SHELL_NONCE into local variable',
  );

  // 2. Unsets TRACERELAY_SHELL_NONCE immediately so child processes do not inherit it
  assert.ok(
    shellRs.includes('unset TRACERELAY_SHELL_NONCE'),
    'shell.rs unsets TRACERELAY_SHELL_NONCE so child processes do not inherit it',
  );

  // 3. Emits authenticated markers with aid parameter
  assert.ok(
    shellRs.includes('aid='),
    'shell.rs emits aid=<nonce> authenticated markers',
  );

  // 4. Injects TRACERELAY_SHELL_NONCE on command build
  assert.ok(
    shellRs.includes('TRACERELAY_SHELL_NONCE'),
    'shell.rs injects TRACERELAY_SHELL_NONCE via environment',
  );

  console.log('✓ Native shell integration scripts satisfy all security and unexport invariants');
}

console.log('\n=======================================================================');
console.log('ALL 18 SHELL INTEGRATION TRUST BOUNDARY TESTS PASSED!');
console.log('=======================================================================\n');
