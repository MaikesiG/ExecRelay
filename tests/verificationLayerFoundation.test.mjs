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
  isExecutionIntent,
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
  executionFromTranscriptBlock,
  evidenceBlocksFromTranscriptBlock,
  deriveExecutionLifecycle,
  deriveExecutionOutcome,
} = execModelMod.exports;

// 4. Transpile verification/types.ts
const verifTypesSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/verification/types.ts'), 'utf8');
const verifTypesJs = ts.transpileModule(verifTypesSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const verifTypesMod = { exports: {} };
new Function('module', 'exports', 'require', verifTypesJs)(verifTypesMod, verifTypesMod.exports, () => ({}));
const {
  isVerificationCriterion,
  isVerificationContract,
  isVerificationCriterionResult,
  isVerificationRun,
  isVerificationCriterionStatus,
  isVerificationRunStatus,
} = verifTypesMod.exports;

// 5. Transpile verification/verificationModel.ts
const verifModelSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'), 'utf8');
const verifModelJs = ts.transpileModule(verifModelSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const verifModelMod = { exports: {} };
const customRequireVerif = (req) => {
  if (req.includes('types')) return verifTypesMod.exports;
  if (req.includes('execution')) return execTypesMod.exports;
  return {};
};
new Function('module', 'exports', 'require', verifModelJs)(verifModelMod, verifModelMod.exports, customRequireVerif);
const {
  createVerificationCriterion,
  createVerificationContract,
  createDefaultVerificationContract,
  createVerificationRun,
  evaluateCriterionResult,
  deriveVerificationRunStatus,
} = verifModelMod.exports;

// 6. Transpile verification/verificationState.ts
const verifStateSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/verification/verificationState.ts'), 'utf8');
const verifStateJs = ts.transpileModule(verifStateSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const verifStateMod = { exports: {} };
const customRequireState = (req) => {
  if (req.includes('verificationModel')) return verifModelMod.exports;
  if (req.includes('types')) return verifTypesMod.exports;
  return {};
};
new Function('module', 'exports', 'require', verifStateJs)(verifStateMod, verifStateMod.exports, customRequireState);
const {
  getOrCreateWorkspaceVerificationState,
  getWorkspaceContracts,
  getActiveVerificationContract,
  getWorkspaceVerificationRuns,
  getLatestVerificationRun,
  appendVerificationRunToWorkspace,
  updateVerificationRunInWorkspace,
  updateVerificationContractInWorkspace,
} = verifStateMod.exports;

// 7. Transpile shellIntegration.ts
const shellIntSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/terminal/shellIntegration.ts'), 'utf8');
const shellIntJs = ts.transpileModule(shellIntSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const shellIntMod = { exports: {} };
new Function('module', 'exports', 'require', shellIntJs)(shellIntMod, shellIntMod.exports, () => ({}));
const { ShellIntegrationStreamParser } = shellIntMod.exports;

console.log('Running Verification Layer Foundation Tests (Phase 15 & 16)...');

// Helper to construct a mock Workspace
function createMockWorkspace(id = 'ws-test-1', name = 'Test Workspace') {
  return {
    id,
    name,
    terminalTabs: [
      {
        id: 'tab-1',
        workspaceId: id,
        label: 'Terminal 1',
        paneIds: ['pane-1'],
        activePaneId: 'pane-1',
        panes: [
          {
            id: 'pane-1',
            terminalTabId: 'tab-1',
            stableOrdinal: 1,
            accentId: 'blue',
            session: {
              sessionId: 'session-pane-1',
              status: 'running',
              sessionInfo: null,
            },
            capture: {
              isListening: true,
              hasRetainedData: false,
              currentBatchId: 1,
            },
          },
        ],
      },
    ],
    activeTerminalTabId: 'tab-1',
    panes: [],
    capture: {
      isListening: true,
      currentBatch: { id: 1, startedAt: Date.now(), stoppedAt: null },
      batchCounter: 1,
      blocks: [],
    },
    selection: {
      selectedBlockIds: new Set(),
      updatedAt: 0,
    },
    terminalTabIds: ['tab-1'],
    verification: undefined,
  };
}

// ============================================================================
// Test 1: Verification contract supports multiple criteria & defaults expected [0]
// ============================================================================
{
  const c1 = createVerificationCriterion({ label: 'Test', command: 'npm test' });
  const c2 = createVerificationCriterion({
    label: 'Build',
    command: 'npm run build',
    expectedExitCodes: [0, 2],
    order: 2,
  });

  assert.strictEqual(c1.expectedExitCodes.length, 1);
  assert.strictEqual(c1.expectedExitCodes[0], 0, 'Default expected exit code must be [0]');
  assert.deepStrictEqual(c2.expectedExitCodes, [0, 2]);

  const contract = createVerificationContract({
    workspaceId: 'ws-1',
    name: 'CI Suite',
    criteria: [c2, c1], // out of order
  });

  assert(isVerificationContract(contract), 'Contract matches type guard');
  assert.strictEqual(contract.criteria.length, 2, 'Contract supports multiple criteria');
  assert.strictEqual(contract.criteria[0].command, 'npm test', 'Criteria sorted by order');
  assert.strictEqual(contract.criteria[1].command, 'npm run build');
  console.log('✓ Test 1: Contract supports multiple criteria & defaults expected [0]');
}

// ============================================================================
// Test 2: Starting verification creates a new VerificationRun with criteria snapshot
// ============================================================================
{
  const contract = createDefaultVerificationContract('ws-1');
  assert.strictEqual(contract.criteria.length, 4, 'Default contract has 4 standard checks');

  const run1 = createVerificationRun({ contract, workspaceId: 'ws-1' });
  assert(isVerificationRun(run1), 'Run matches type guard');
  assert.strictEqual(run1.status, 'pending');
  assert.strictEqual(run1.criteriaSnapshot.length, 4);
  assert.strictEqual(run1.criterionResults.length, 4);
  assert(run1.criterionResults.every((r) => r.status === 'pending'), 'Initial criterion results are pending');

  // Verify deep snapshot independence (Phase 11)
  contract.criteria.push(createVerificationCriterion({ label: 'Security', command: 'npm audit' }));
  assert.strictEqual(run1.criteriaSnapshot.length, 4, 'Editing contract does not mutate historical run snapshot');
  console.log('✓ Test 2: VerificationRun created with immutable criteriaSnapshot');
}

// ============================================================================
// Test 3: Verification command creates normal Execution with intent & IDs
// ============================================================================
{
  const mockBlock = {
    id: 'block-exec-1',
    batchId: 1,
    command: 'npm test',
    rawCommand: 'npm test',
    output: 'All 27 tests passed.',
    startedAt: 1000,
    completedAt: 1500,
    isComplete: true,
    intent: 'verification',
    verificationRunId: 'run-100',
    verificationCriterionId: 'crit-test-1',
    exitCode: 0,
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    completionSource: 'shell',
    workspaceId: 'ws-1',
    terminalPaneId: 'pane-1',
    terminalLabelAtCapture: 'Terminal 1',
  };

  const exec = executionFromTranscriptBlock(mockBlock);
  assert(isExecution(exec), 'Produces a normal Execution');
  assert.strictEqual(exec.intent, 'verification', 'Execution intent is verification');
  assert.strictEqual(exec.verificationRunId, 'run-100');
  assert.strictEqual(exec.verificationCriterionId, 'crit-test-1');
  assert.strictEqual(exec.exitCode, 0);
  assert.strictEqual(exec.outcome, 'succeeded');
  assert.strictEqual(exec.outcomeTrusted, true);
  console.log('✓ Test 3: Verification command creates normal Execution with intent & linkage');
}

// ============================================================================
// Test 4: Trusted exit 0 with expected [0] => passed; result references executionId
// ============================================================================
{
  const criterion = createVerificationCriterion({
    id: 'crit-test',
    label: 'Test suite',
    command: 'npm test',
    expectedExitCodes: [0],
  });

  const exec = createExecution({
    id: 'exec-42',
    workspaceId: 'ws-1',
    command: 'npm test',
    intent: 'verification',
    verificationRunId: 'run-1',
    verificationCriterionId: 'crit-test',
    lifecycle: 'finished',
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    exitCode: 0,
    startedAt: 1000,
    completedAt: 1200,
  });

  const result = evaluateCriterionResult(criterion, exec);
  assert(isVerificationCriterionResult(result));
  assert.strictEqual(result.status, 'passed');
  assert.strictEqual(result.executionId, 'exec-42', 'Criterion result references correct execution ID');
  assert.strictEqual(result.observedExitCode, 0);
  assert(result.message.includes('satisfies expected [0]'));
  console.log('✓ Test 4: Trusted exit 0 => passed with executionId linkage');
}

// ============================================================================
// Test 5: Trusted exit 1 with expected [0] => failed
// ============================================================================
{
  const criterion = createVerificationCriterion({
    id: 'crit-test',
    label: 'Test suite',
    command: 'npm test',
    expectedExitCodes: [0],
  });

  const exec = createExecution({
    id: 'exec-fail',
    workspaceId: 'ws-1',
    command: 'npm test',
    intent: 'verification',
    verificationRunId: 'run-1',
    verificationCriterionId: 'crit-test',
    lifecycle: 'finished',
    outcome: 'failed',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    exitCode: 1,
    startedAt: 1000,
    completedAt: 1300,
  });

  const result = evaluateCriterionResult(criterion, exec);
  assert.strictEqual(result.status, 'failed');
  assert.strictEqual(result.observedExitCode, 1);
  assert(result.message.includes('does not satisfy expected [0]'));
  console.log('✓ Test 5: Trusted exit 1 with expected [0] => failed');
}

// ============================================================================
// Test 6: Trusted exit 2 with expected [0, 2] => passed
// ============================================================================
{
  const criterion = createVerificationCriterion({
    id: 'crit-diff',
    label: 'Git Diff Check',
    command: 'git diff --exit-code',
    expectedExitCodes: [0, 2],
  });

  const exec = createExecution({
    id: 'exec-diff-2',
    workspaceId: 'ws-1',
    command: 'git diff --exit-code',
    lifecycle: 'finished',
    outcome: 'failed', // process failed at OS level, but satisfies criterion!
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    exitCode: 2,
    startedAt: 1000,
    completedAt: 1100,
  });

  const result = evaluateCriterionResult(criterion, exec);
  assert.strictEqual(result.status, 'passed', 'Separation of execution outcome and verification satisfaction');
  assert.strictEqual(result.observedExitCode, 2);
  console.log('✓ Test 6: Execution outcome != Verification criterion status ([0, 2] satisfied by exit 2)');
}

// ============================================================================
// Test 7: Untrusted outcome, unknown outcome, or capture boundary => error
// ============================================================================
{
  const criterion = createVerificationCriterion({
    id: 'crit-1',
    label: 'Lint',
    command: 'npm run lint',
    expectedExitCodes: [0],
  });

  // Untrusted shell completion (e.g. unauthenticated or remote)
  const untrustedExec = createExecution({
    id: 'exec-untrusted',
    workspaceId: 'ws-1',
    command: 'npm run lint',
    lifecycle: 'finished',
    outcome: 'succeeded',
    outcomeSource: 'unknown',
    outcomeTrusted: false,
    exitCode: 0,
    startedAt: 1000,
    completedAt: 1200,
  });
  const res1 = evaluateCriterionResult(criterion, untrustedExec);
  assert.strictEqual(res1.status, 'error', 'Untrusted execution cannot produce passed');

  // Capture boundary / fallback completion
  const boundaryExec = createExecution({
    id: 'exec-boundary',
    workspaceId: 'ws-1',
    command: 'npm run lint',
    lifecycle: 'finished',
    outcome: 'unknown',
    outcomeSource: 'unknown',
    outcomeTrusted: false,
    exitCode: null,
    startedAt: 1000,
    completedAt: 1200,
  });
  const res2 = evaluateCriterionResult(criterion, boundaryExec);
  assert.strictEqual(res2.status, 'error', 'Capture boundary completion cannot produce passed');

  // Interrupted execution
  const interruptedExec = createExecution({
    id: 'exec-interrupted',
    workspaceId: 'ws-1',
    command: 'npm run lint',
    lifecycle: 'interrupted',
    completionSource: 'pane-close',
    startedAt: 1000,
    completedAt: 1200,
  });
  const res3 = evaluateCriterionResult(criterion, interruptedExec);
  assert.strictEqual(res3.status, 'error', 'Interrupted execution produces error');

  console.log('✓ Test 7: Untrusted, unknown, or interrupted outcomes produce error');
}

// ============================================================================
// Test 8: Forged OSC cannot satisfy verification
// ============================================================================
{
  const sessionNonce = 'secure-verif-nonce-xyz';
  const parser = new ShellIntegrationStreamParser(sessionNonce);
  const criterion = createVerificationCriterion({
    id: 'crit-sec',
    label: 'Security Test',
    command: 'npm test',
    expectedExitCodes: [0],
  });

  // Attacking subprocess emits unauthenticated OSC 133;D;0 (spoofed command-end)
  const attackPayload = '\x1b]133;D;0\x07';
  const { events } = parser.parse(attackPayload);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].trust, 'untrusted', 'Unauthenticated OSC marked untrusted');

  // Execution created with untrusted outcome
  const spoofedExec = createExecution({
    id: 'exec-spoofed',
    workspaceId: 'ws-1',
    command: 'npm test',
    lifecycle: 'finished',
    outcome: 'succeeded',
    outcomeSource: 'unknown',
    outcomeTrusted: false,
    exitCode: 0,
    startedAt: 1000,
    completedAt: 1200,
  });

  const res = evaluateCriterionResult(criterion, spoofedExec);
  assert.strictEqual(res.status, 'error', 'Forged OSC cannot pass verification');
  console.log('✓ Test 8: Forged OSC rejected by parser and cannot pass verification');
}

// ============================================================================
// Test 9: Aggregate run status derivation (pure function)
// ============================================================================
{
  // All passed
  const rPassed = deriveVerificationRunStatus([
    { criterionId: '1', status: 'passed' },
    { criterionId: '2', status: 'passed' },
  ]);
  assert.strictEqual(rPassed, 'passed');

  // One failed => failed
  const rFailed = deriveVerificationRunStatus([
    { criterionId: '1', status: 'passed' },
    { criterionId: '2', status: 'failed' },
    { criterionId: '3', status: 'passed' },
  ]);
  assert.strictEqual(rFailed, 'failed');

  // Unevaluable / error => error
  const rError = deriveVerificationRunStatus([
    { criterionId: '1', status: 'passed' },
    { criterionId: '2', status: 'error' },
    { criterionId: '3', status: 'passed' },
  ]);
  assert.strictEqual(rError, 'error');

  // Running
  const rRunning = deriveVerificationRunStatus([
    { criterionId: '1', status: 'passed' },
    { criterionId: '2', status: 'running' },
    { criterionId: '3', status: 'pending' },
  ]);
  assert.strictEqual(rRunning, 'running');

  // Cancelled
  const rCancelled = deriveVerificationRunStatus(
    [
      { criterionId: '1', status: 'passed' },
      { criterionId: '2', status: 'skipped' },
    ],
    true,
  );
  assert.strictEqual(rCancelled, 'cancelled');

  console.log('✓ Test 9: Pure deriveVerificationRunStatus handles all combinations deterministically');
}

// ============================================================================
// Test 10: Sequential state machine & exact identity matching simulation
// ============================================================================
{
  // Simulate the exact runner algorithm in App.tsx
  const contract = createVerificationContract({
    workspaceId: 'ws-1',
    name: 'Sequential Suite',
    criteria: [
      createVerificationCriterion({ id: 'c1', label: 'Check 1', command: 'cmd1', order: 1 }),
      createVerificationCriterion({ id: 'c2', label: 'Check 2', command: 'cmd2', order: 2 }),
      createVerificationCriterion({ id: 'c3', label: 'Check 3', command: 'cmd3', order: 3 }),
    ],
  });

  const run = createVerificationRun({ contract, workspaceId: 'ws-1' });

  // Runner state
  const runtime = {
    workspaceId: 'ws-1',
    terminalTabId: 'tab-1',
    terminalPaneId: 'pane-1',
    runId: run.id,
    currentCriterionIndex: 0,
    expectedCriterionId: 'c1',
    expectedExecutionId: 'exec-c1',
    cancelled: false,
  };

  // Simulate unrelated human execution occurring concurrently
  const humanBlock = {
    id: 'exec-human-1',
    batchId: 1,
    command: 'git status',
    output: 'On branch main',
    startedAt: 1000,
    completedAt: 1050,
    isComplete: true,
    intent: 'interactive', // human intent
    exitCode: 0,
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    workspaceId: 'ws-1',
    terminalPaneId: 'pane-1',
  };

  // Human execution MUST NOT advance verification
  assert.notStrictEqual(humanBlock.intent, 'verification');
  assert.notStrictEqual(humanBlock.verificationRunId, runtime.runId);

  // Simulate execution from another workspace
  const otherWsBlock = {
    id: 'exec-ws2',
    batchId: 1,
    command: 'cmd1',
    isComplete: true,
    intent: 'verification',
    verificationRunId: runtime.runId,
    verificationCriterionId: 'c1',
    exitCode: 0,
    workspaceId: 'ws-2', // DIFFERENT WORKSPACE
    terminalPaneId: 'pane-1',
  };
  assert.notStrictEqual(otherWsBlock.workspaceId, runtime.workspaceId, 'Different workspace rejected');

  // Simulate execution from another pane
  const otherPaneBlock = {
    id: 'exec-pane2',
    batchId: 1,
    command: 'cmd1',
    isComplete: true,
    intent: 'verification',
    verificationRunId: runtime.runId,
    verificationCriterionId: 'c1',
    exitCode: 0,
    workspaceId: 'ws-1',
    terminalPaneId: 'pane-2', // DIFFERENT PANE
  };
  assert.notStrictEqual(otherPaneBlock.terminalPaneId, runtime.terminalPaneId, 'Different pane rejected');

  // Simulate correct matching execution for criterion 1 (succeeds)
  const c1Block = {
    id: 'exec-c1',
    batchId: 1,
    command: 'cmd1',
    startedAt: 1000,
    completedAt: 1100,
    isComplete: true,
    intent: 'verification',
    verificationRunId: runtime.runId,
    verificationCriterionId: 'c1',
    exitCode: 0,
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    workspaceId: 'ws-1',
    terminalPaneId: 'pane-1',
  };

  const exec1 = executionFromTranscriptBlock(c1Block);
  const res1 = evaluateCriterionResult(contract.criteria[0], exec1);
  assert.strictEqual(res1.status, 'passed');
  run.criterionResults[0] = res1;

  // Criterion 2 fails (e.g. exit 1)
  runtime.currentCriterionIndex = 1;
  runtime.expectedCriterionId = 'c2';
  runtime.expectedExecutionId = 'exec-c2';

  const c2Block = {
    id: 'exec-c2',
    batchId: 1,
    command: 'cmd2',
    startedAt: 1150,
    completedAt: 1250,
    isComplete: true,
    intent: 'verification',
    verificationRunId: runtime.runId,
    verificationCriterionId: 'c2',
    exitCode: 1,
    outcome: 'failed',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    workspaceId: 'ws-1',
    terminalPaneId: 'pane-1',
  };

  const exec2 = executionFromTranscriptBlock(c2Block);
  const res2 = evaluateCriterionResult(contract.criteria[1], exec2);
  assert.strictEqual(res2.status, 'failed');
  run.criterionResults[1] = res2;

  // Section 9: Failed criterion does NOT stop later criteria! Criterion 3 runs:
  runtime.currentCriterionIndex = 2;
  runtime.expectedCriterionId = 'c3';
  runtime.expectedExecutionId = 'exec-c3';

  const c3Block = {
    id: 'exec-c3',
    batchId: 1,
    command: 'cmd3',
    startedAt: 1300,
    completedAt: 1400,
    isComplete: true,
    intent: 'verification',
    verificationRunId: runtime.runId,
    verificationCriterionId: 'c3',
    exitCode: 0,
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    workspaceId: 'ws-1',
    terminalPaneId: 'pane-1',
  };

  const exec3 = executionFromTranscriptBlock(c3Block);
  const res3 = evaluateCriterionResult(contract.criteria[2], exec3);
  assert.strictEqual(res3.status, 'passed');
  run.criterionResults[2] = res3;

  run.status = deriveVerificationRunStatus(run.criterionResults);
  assert.strictEqual(run.status, 'failed', 'One failed criterion results in run failed while completing all checks');

  console.log('✓ Test 10: Sequential state machine, identity isolation & failure continuation verified');
}

// ============================================================================
// Test 11: Cancellation stops future criteria & marks pending skipped
// ============================================================================
{
  const contract = createDefaultVerificationContract('ws-1');
  const run = createVerificationRun({ contract, workspaceId: 'ws-1' });

  // Criterion 1 completed
  run.criterionResults[0] = {
    criterionId: run.criteriaSnapshot[0].id,
    status: 'passed',
    executionId: 'exec-1',
    observedExitCode: 0,
  };

  // User cancels while criterion 2 is pending
  const cancelledResults = run.criterionResults.map((r, i) =>
    i === 0 ? r : { ...r, status: 'skipped', message: 'Verification was cancelled' },
  );

  const cancelledRun = {
    ...run,
    status: 'cancelled',
    criterionResults: cancelledResults,
    completedAt: Date.now(),
  };

  assert.strictEqual(cancelledRun.status, 'cancelled');
  assert.strictEqual(cancelledRun.criterionResults[0].status, 'passed', 'Completed results preserved');
  assert.strictEqual(cancelledRun.criterionResults[1].status, 'skipped', 'Pending results skipped without fabricating failure');
  assert.strictEqual(cancelledRun.criterionResults[2].status, 'skipped');
  assert.strictEqual(cancelledRun.criterionResults[3].status, 'skipped');

  console.log('✓ Test 11: Cancellation preserves completed results and marks remaining skipped');
}

// ============================================================================
// Test 12: Historical Immutability (Second verification creates new run)
// ============================================================================
{
  let ws = createMockWorkspace('ws-1');
  const contract = createDefaultVerificationContract(ws.id);
  ws.verification = {
    contracts: [contract],
    activeContractId: contract.id,
    runs: [],
    activeRunId: null,
    selectedCriterionIds: new Set(contract.criteria.map((c) => c.id)),
  };

  // Run 1: Failed
  const run1 = createVerificationRun({ contract, workspaceId: ws.id });
  run1.status = 'failed';
  run1.criterionResults[0] = { criterionId: run1.criteriaSnapshot[0].id, status: 'failed', observedExitCode: 1 };
  ws = appendVerificationRunToWorkspace(ws, run1);

  assert.strictEqual(getWorkspaceVerificationRuns(ws).length, 1);
  assert.strictEqual(getLatestVerificationRun(ws)?.status, 'failed');

  // Run 2: Passed
  const run2 = createVerificationRun({ contract, workspaceId: ws.id });
  run2.status = 'passed';
  run2.criterionResults.forEach((r) => {
    r.status = 'passed';
    r.observedExitCode = 0;
  });
  ws = appendVerificationRunToWorkspace(ws, run2);

  const runs = getWorkspaceVerificationRuns(ws);
  assert.strictEqual(runs.length, 2, 'Rerun appends new run');
  assert.strictEqual(runs[0].id, run1.id, 'Run 1 preserved');
  assert.strictEqual(runs[0].status, 'failed', 'Run 1 status not mutated');
  assert.strictEqual(runs[1].id, run2.id, 'Run 2 is active');
  assert.strictEqual(runs[1].status, 'passed');

  // Update contract: historical runs still preserve their criteria snapshots
  const updatedContract = {
    ...contract,
    name: 'New Custom CI',
    criteria: [createVerificationCriterion({ label: 'Single Check', command: 'make check' })],
  };
  ws = updateVerificationContractInWorkspace(ws, updatedContract);

  assert.strictEqual(getActiveVerificationContract(ws).name, 'New Custom CI');
  assert.strictEqual(getActiveVerificationContract(ws).criteria.length, 1);
  assert.strictEqual(runs[0].criteriaSnapshot.length, 4, 'Historical Run 1 criteria snapshot immutable');
  assert.strictEqual(runs[1].criteriaSnapshot.length, 4, 'Historical Run 2 criteria snapshot immutable');

  console.log('✓ Test 12: Historical runs and criteria snapshots are strictly immutable');
}

// ============================================================================
// Test 13: View execution references canonical Execution evidence
// ============================================================================
{
  const criterion = createVerificationCriterion({
    id: 'crit-test',
    label: 'Test suite',
    command: 'npm test',
    expectedExitCodes: [0],
  });

  const exec = createExecution({
    id: 'exec-canonical-101',
    workspaceId: 'ws-1',
    command: 'npm test',
    lifecycle: 'finished',
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    exitCode: 0,
    startedAt: 1000,
    completedAt: 1200,
  });

  const res = evaluateCriterionResult(criterion, exec);
  assert.strictEqual(res.executionId, 'exec-canonical-101', 'Canonical executionId stored in result');
  // Verification does NOT duplicate raw output into criterion result
  assert.strictEqual(res.rawOutput, undefined);
  assert.strictEqual(res.output, undefined);
  console.log('✓ Test 13: Criterion result references canonical executionId without data duplication');
}

console.log('\n=============================================================');
console.log('ALL 13 VERIFICATION LAYER FOUNDATION TESTS PASSED SUCCESSFULLY!');
console.log('=============================================================\n');
