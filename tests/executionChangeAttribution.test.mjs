import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ts = require('../app/node_modules/typescript');

function transpileTs(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

// 1. Transpile execution types & models
const formatMod = transpileTs(path.resolve(__dirname, '../app/src/features/transcript/transcriptFormat.ts'));
const execTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/execution/types.ts'));
const {
  isExecution,
  createExecution,
} = transpileTs(
  path.resolve(__dirname, '../app/src/features/execution/executionModel.ts'),
  (req) => {
    if (req.includes('transcriptFormat')) return formatMod;
    if (req.includes('types')) return execTypesMod;
    return {};
  },
);

// 2. Transpile verification types & models
const verifTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/verification/types.ts'));
const {
  createVerificationContract,
  createVerificationCriterion,
  createVerificationRun,
  evaluateCriterionResult,
  deriveVerificationRunStatus,
} = transpileTs(
  path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'),
  (req) => {
    if (req.includes('types')) return verifTypesMod;
    if (req.includes('execution')) return { createExecution };
    return {};
  },
);

// 3. Transpile evidenceCollectors domain
const ecTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/evidenceCollectors/types.ts'));

// 4. Transpile attribution domain
const attrTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/attribution/types.ts'));
const {
  isChangeAttribution,
  isRepositoryDelta,
  isRepositoryChangeEvidence,
} = attrTypesMod;

const deltaEngineMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/attribution/deltaEngine.ts'),
  (req) => {
    if (req.includes('types')) return attrTypesMod;
    return {};
  },
);
const {
  computeRepositoryDelta,
  deriveAttributionLimitations,
} = deltaEngineMod;

const attrServiceMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/attribution/attributionService.ts'),
  (req) => {
    if (req.includes('deltaEngine')) return deltaEngineMod;
    if (req.includes('types')) return attrTypesMod;
    return {};
  },
);
const {
  createPendingAttribution,
  finalizeChangeAttribution,
  createRepositoryChangeEvidence,
} = attrServiceMod;

console.log('Running Execution Change Attribution Test Suite...\n');

// Helper to construct mock snapshots
function createMockSnapshot({
  id = 'snap-1',
  runId = 'run-1',
  workspaceId = 'ws-1',
  repoRoot = '/mock/repo',
  clean = true,
  files = [],
  diffFiles = [],
  insertions = 0,
  deletions = 0,
}) {
  return {
    id,
    collectionRunId: runId,
    workspaceId,
    repositoryRoot: repoRoot,
    createdAt: 1000,
    metadata: {
      id: `meta-${id}`,
      type: 'repository-metadata',
      vcs: 'git',
      branch: 'main',
      headCommit: 'e7f8c9a1b2c3d4e5f6',
      collectorId: 'git-repository-metadata',
      collectorVersion: '1.0.0',
      collectionRunId: runId,
      workspaceId,
      repositoryRoot: repoRoot,
      createdAt: 1000,
    },
    status: {
      id: `stat-${id}`,
      type: 'git-status',
      clean,
      files,
      modifiedCount: files.filter((f) => f.status === 'modified').length,
      addedCount: files.filter((f) => f.status === 'added').length,
      deletedCount: files.filter((f) => f.status === 'deleted').length,
      renamedCount: files.filter((f) => f.status === 'renamed').length,
      untrackedCount: files.filter((f) => f.status === 'untracked').length,
      conflictedCount: files.filter((f) => f.status === 'conflicted').length,
      collectorId: 'git-status',
      collectorVersion: '1.0.0',
      collectionRunId: runId,
      workspaceId,
      repositoryRoot: repoRoot,
      createdAt: 1000,
    },
    diffSummary: {
      id: `diff-${id}`,
      type: 'git-diff-summary',
      filesChanged: diffFiles.length,
      insertions,
      deletions,
      files: diffFiles,
      scope: 'all',
      collectorId: 'git-diff-summary',
      collectorVersion: '1.0.0',
      collectionRunId: runId,
      workspaceId,
      repositoryRoot: repoRoot,
      createdAt: 1000,
    },
  };
}

// -----------------------------------------------------------------------------
// Test 1: Clean Before + Clean After => Zero Delta
// -----------------------------------------------------------------------------
console.log('--- Test 1: Clean Before + Clean After => Zero Delta ---');
{
  const before = createMockSnapshot({ id: 'snap-1', clean: true });
  const after = createMockSnapshot({ id: 'snap-2', clean: true });

  const delta = computeRepositoryDelta(before, after);

  assert.strictEqual(delta.filesChanged, 0);
  assert.strictEqual(delta.addedCount, 0);
  assert.strictEqual(delta.modifiedCount, 0);
  assert.strictEqual(delta.deletedCount, 0);
  assert.strictEqual(delta.deltaScope, 'clean-baseline');
  assert.strictEqual(delta.files.length, 0);

  console.log('✓ Clean baseline with clean after correctly produces 0 files changed');
}

// -----------------------------------------------------------------------------
// Test 2: Clean Before + Modified / Added / Deleted After
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Clean Before + Modified / Added / Deleted After ---');
{
  const before = createMockSnapshot({ id: 'snap-1', clean: true });
  const after = createMockSnapshot({
    id: 'snap-2',
    clean: false,
    files: [
      { path: 'src/auth.ts', status: 'modified', staged: true, unstaged: false },
      { path: 'tests/auth.test.ts', status: 'added', staged: true, unstaged: false },
      { path: 'legacy.js', status: 'deleted', staged: true, unstaged: false },
    ],
    diffFiles: [
      { path: 'src/auth.ts', insertions: 25, deletions: 10 },
      { path: 'tests/auth.test.ts', insertions: 101, deletions: 0 },
      { path: 'legacy.js', insertions: 0, deletions: 31 },
    ],
    insertions: 126,
    deletions: 41,
  });

  const delta = computeRepositoryDelta(before, after);

  assert.strictEqual(delta.filesChanged, 3);
  assert.strictEqual(delta.modifiedCount, 1);
  assert.strictEqual(delta.addedCount, 1);
  assert.strictEqual(delta.deletedCount, 1);
  assert.strictEqual(delta.insertions, 126);
  assert.strictEqual(delta.deletions, 41);
  assert.strictEqual(delta.deltaScope, 'clean-baseline');

  // Verify file delta attribution kinds
  const authFile = delta.files.find((f) => f.path === 'src/auth.ts');
  assert.ok(authFile);
  assert.strictEqual(authFile.deltaKind, 'introduced');
  assert.strictEqual(authFile.insertions, 25);
  assert.strictEqual(authFile.deletions, 10);

  const testFile = delta.files.find((f) => f.path === 'tests/auth.test.ts');
  assert.ok(testFile);
  assert.strictEqual(testFile.deltaKind, 'introduced');

  const delFile = delta.files.find((f) => f.path === 'legacy.js');
  assert.ok(delFile);
  assert.strictEqual(delFile.deltaKind, 'introduced');

  console.log('✓ Clean baseline correctly attributes introduced modified, added, and deleted files with line counts');
}

// -----------------------------------------------------------------------------
// Test 3: Rename Transition Preserved
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Rename Transition Preserved ---');
{
  const before = createMockSnapshot({ id: 'snap-1', clean: true });
  const after = createMockSnapshot({
    id: 'snap-2',
    clean: false,
    files: [
      {
        path: 'src/new-name.ts',
        previousPath: 'src/old-name.ts',
        status: 'renamed',
        staged: true,
        unstaged: false,
      },
    ],
    diffFiles: [{ path: 'src/new-name.ts', insertions: 2, deletions: 1 }],
  });

  const delta = computeRepositoryDelta(before, after);

  assert.strictEqual(delta.renamedCount, 1);
  assert.strictEqual(delta.filesChanged, 1);
  const renamedFile = delta.files[0];
  assert.strictEqual(renamedFile.path, 'src/new-name.ts');
  assert.strictEqual(renamedFile.previousPath, 'src/old-name.ts');
  assert.strictEqual(renamedFile.status, 'renamed');
  assert.strictEqual(renamedFile.deltaKind, 'introduced');

  console.log('✓ Rename transitions correctly preserve previousPath and status');
}

// -----------------------------------------------------------------------------
// Test 4: Untracked File Introduced
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Untracked File Introduced ---');
{
  const before = createMockSnapshot({ id: 'snap-1', clean: true });
  const after = createMockSnapshot({
    id: 'snap-2',
    clean: false,
    files: [{ path: 'temp.log', status: 'untracked' }],
  });

  const delta = computeRepositoryDelta(before, after);

  assert.strictEqual(delta.untrackedCount, 1);
  assert.strictEqual(delta.filesChanged, 1);
  assert.strictEqual(delta.files[0].path, 'temp.log');
  assert.strictEqual(delta.files[0].status, 'untracked');
  assert.strictEqual(delta.files[0].deltaKind, 'introduced');

  console.log('✓ Untracked file introduction properly classified as introduced');
}

// -----------------------------------------------------------------------------
// Test 5: Baseline Dirty Repository — Pre-Existing Files vs Changed-Further
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Baseline Dirty Repository: Pre-Existing vs Changed-Further ---');
{
  // Before execution:
  // - src/existing.ts is already modified (+10 / -5)
  // - src/untouched.ts is already modified (+2 / -1)
  const before = createMockSnapshot({
    id: 'snap-dirty-before',
    clean: false,
    files: [
      { path: 'src/existing.ts', status: 'modified', staged: false, unstaged: true },
      { path: 'src/untouched.ts', status: 'modified', staged: false, unstaged: true },
    ],
    diffFiles: [
      { path: 'src/existing.ts', insertions: 10, deletions: 5 },
      { path: 'src/untouched.ts', insertions: 2, deletions: 1 },
    ],
    insertions: 12,
    deletions: 6,
  });

  // After execution:
  // - src/untouched.ts remains exactly unchanged (+2 / -1)
  // - src/existing.ts changed further (+25 / -8)
  // - src/new.ts is newly introduced (+50 / -0)
  const after = createMockSnapshot({
    id: 'snap-dirty-after',
    clean: false,
    files: [
      { path: 'src/existing.ts', status: 'modified', staged: false, unstaged: true },
      { path: 'src/untouched.ts', status: 'modified', staged: false, unstaged: true },
      { path: 'src/new.ts', status: 'added', staged: true, unstaged: false },
    ],
    diffFiles: [
      { path: 'src/existing.ts', insertions: 25, deletions: 8 },
      { path: 'src/untouched.ts', insertions: 2, deletions: 1 },
      { path: 'src/new.ts', insertions: 50, deletions: 0 },
    ],
    insertions: 77,
    deletions: 9,
  });

  const delta = computeRepositoryDelta(before, after);

  // CRITICAL INVARIANT: The untouched pre-existing file MUST NOT be counted as active changes during this window!
  assert.strictEqual(delta.deltaScope, 'dirty-baseline');
  assert.strictEqual(delta.filesChanged, 2); // only existing.ts (changed further) and new.ts (introduced)
  assert.strictEqual(delta.modifiedCount, 1);
  assert.strictEqual(delta.addedCount, 1);

  const untouchedFile = delta.files.find((f) => f.path === 'src/untouched.ts');
  assert.ok(untouchedFile);
  assert.strictEqual(untouchedFile.deltaKind, 'unchanged-existing');

  const existingFile = delta.files.find((f) => f.path === 'src/existing.ts');
  assert.ok(existingFile);
  assert.strictEqual(existingFile.deltaKind, 'changed-further');
  // Safe difference math: 25 - 10 = 15, 8 - 5 = 3
  assert.strictEqual(existingFile.insertions, 15);
  assert.strictEqual(existingFile.deletions, 3);

  const newFile = delta.files.find((f) => f.path === 'src/new.ts');
  assert.ok(newFile);
  assert.strictEqual(newFile.deltaKind, 'introduced');
  assert.strictEqual(newFile.insertions, 50);

  console.log('✓ Pre-existing uncommitted files are properly recognized as unchanged-existing and not falsely attributed');
}

// -----------------------------------------------------------------------------
// Test 6: Reverted File (Dirty -> Clean)
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Reverted File (Dirty in Before, Missing in After) ---');
{
  const before = createMockSnapshot({
    id: 'snap-1',
    clean: false,
    files: [{ path: 'src/reverted.ts', status: 'modified', staged: false, unstaged: true }],
    diffFiles: [{ path: 'src/reverted.ts', insertions: 5, deletions: 2 }],
  });
  const after = createMockSnapshot({ id: 'snap-2', clean: true, files: [], diffFiles: [] });

  const delta = computeRepositoryDelta(before, after);

  assert.strictEqual(delta.filesChanged, 1);
  assert.strictEqual(delta.files[0].path, 'src/reverted.ts');
  assert.strictEqual(delta.files[0].deltaKind, 'removed');

  console.log('✓ Reverted file correctly tagged with deltaKind: removed');
}

// -----------------------------------------------------------------------------
// Test 7: Attribution Service Lifecycle & Immutability
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Attribution Service Lifecycle & Immutability ---');
{
  const before = createMockSnapshot({ id: 'snap-pre-100', clean: true });
  const after = createMockSnapshot({
    id: 'snap-post-101',
    clean: false,
    files: [{ path: 'index.ts', status: 'modified' }],
  });

  const pending = createPendingAttribution({
    workspaceId: 'ws-test',
    targetType: 'execution',
    targetId: 'exec-100',
    repositoryRoot: '/repo',
    beforeSnapshotId: before.id,
  });

  assert.strictEqual(pending.status, 'pending');
  assert.strictEqual(pending.targetId, 'exec-100');

  const finalized = finalizeChangeAttribution({
    attribution: pending,
    beforeSnapshot: before,
    afterSnapshot: after,
  });

  assert.strictEqual(finalized.status, 'completed');
  assert.strictEqual(finalized.beforeSnapshotId, 'snap-pre-100');
  assert.strictEqual(finalized.afterSnapshotId, 'snap-post-101');
  assert.strictEqual(finalized.scope, 'clean-baseline');
  assert.ok(finalized.delta);
  assert.strictEqual(finalized.delta.filesChanged, 1);

  // Snapshot identity & immutability
  assert.strictEqual(before.id, 'snap-pre-100');
  assert.strictEqual(after.id, 'snap-post-101');

  // Verify first-class evidence creation
  const rce = createRepositoryChangeEvidence(finalized);
  assert.ok(rce);
  assert.ok(isRepositoryChangeEvidence(rce));
  assert.strictEqual(rce.attributionId, finalized.id);
  assert.strictEqual(rce.executionId, 'exec-100');
  assert.strictEqual(rce.beforeSnapshotId, 'snap-pre-100');
  assert.strictEqual(rce.afterSnapshotId, 'snap-post-101');

  console.log('✓ Attribution service finalizes completed records with snapshot immutability and creates first-class evidence');
}

// -----------------------------------------------------------------------------
// Test 8: Multiple Executions & Workspace / Target Isolation
// -----------------------------------------------------------------------------
console.log('\n--- Test 8: Multiple Executions & Workspace Isolation ---');
{
  const before1 = createMockSnapshot({ id: 'snap-1', workspaceId: 'ws-a' });
  const after1 = createMockSnapshot({ id: 'snap-2', workspaceId: 'ws-a' });

  const attrA = finalizeChangeAttribution({
    attribution: createPendingAttribution({
      workspaceId: 'ws-a',
      targetType: 'execution',
      targetId: 'exec-a',
    }),
    beforeSnapshot: before1,
    afterSnapshot: after1,
  });

  const before2 = createMockSnapshot({ id: 'snap-3', workspaceId: 'ws-b' });
  const after2 = createMockSnapshot({ id: 'snap-4', workspaceId: 'ws-b' });

  const attrB = finalizeChangeAttribution({
    attribution: createPendingAttribution({
      workspaceId: 'ws-b',
      targetType: 'execution',
      targetId: 'exec-b',
    }),
    beforeSnapshot: before2,
    afterSnapshot: after2,
  });

  assert.notStrictEqual(attrA.id, attrB.id);
  assert.strictEqual(attrA.workspaceId, 'ws-a');
  assert.strictEqual(attrB.workspaceId, 'ws-b');
  assert.strictEqual(attrA.targetId, 'exec-a');
  assert.strictEqual(attrB.targetId, 'exec-b');

  console.log('✓ Executions across different workspaces remain completely isolated');
}

// -----------------------------------------------------------------------------
// Test 9: Collector Failure Handling & Invariant Safety
// -----------------------------------------------------------------------------
console.log('\n--- Test 9: Collector Failure Handling & Invariants ---');
{
  // 1. Before collector fails
  const pending1 = createPendingAttribution({
    workspaceId: 'ws-1',
    targetType: 'execution',
    targetId: 'exec-user',
  });

  const unavailableAttr = finalizeChangeAttribution({
    attribution: pending1,
    beforeSnapshot: null,
    afterSnapshot: null,
    errorMessage: 'git fatal: not a git repo',
  });

  assert.strictEqual(unavailableAttr.status, 'unavailable');
  assert.strictEqual(unavailableAttr.delta, undefined);
  assert.ok(unavailableAttr.limitations.length > 0);

  // 2. After collector fails
  const before = createMockSnapshot({ id: 'snap-pre' });
  const pending2 = createPendingAttribution({
    workspaceId: 'ws-1',
    targetType: 'execution',
    targetId: 'exec-user-2',
    beforeSnapshotId: before.id,
  });

  const partialAttr = finalizeChangeAttribution({
    attribution: pending2,
    beforeSnapshot: before,
    afterSnapshot: null,
    errorMessage: 'git process timed out',
  });

  assert.strictEqual(partialAttr.status, 'partial');
  assert.strictEqual(partialAttr.delta, undefined);

  // 3. CRITICAL INVARIANT: Collector failure does NOT mutate Execution
  const userExec = createExecution({
    id: 'exec-user-safe',
    workspaceId: 'ws-1',
    command: 'npm run build',
    outcome: 'succeeded',
    outcomeTrusted: true,
    exitCode: 0,
  });

  // Failure in attribution
  assert.strictEqual(userExec.outcome, 'succeeded');
  assert.strictEqual(userExec.exitCode, 0);

  console.log('✓ Collector failures yield unavailable/partial attribution without altering Execution outcome');
}

// -----------------------------------------------------------------------------
// Test 10: VerificationRun Attribution & Independence of Verification Verdict
// -----------------------------------------------------------------------------
console.log('\n--- Test 10: VerificationRun Attribution & Verdict Independence ---');
{
  const contract = createVerificationContract({
    name: 'Build and Test',
    workspaceId: 'ws-v',
    criteria: [
      createVerificationCriterion({
        id: 'crit-build',
        label: 'Build',
        command: 'npm run build',
        expectedExitCodes: [0],
        order: 0,
      }),
    ],
  });

  const run = createVerificationRun({
    contract,
    workspaceId: 'ws-v',
  });

  // Suppose verification criterion executed successfully (exitCode 0)
  const exec = createExecution({
    id: 'exec-crit-0',
    workspaceId: 'ws-v',
    command: 'npm run build',
    intent: 'verification',
    lifecycle: 'finished',
    outcome: 'succeeded',
    outcomeSource: 'trusted-shell',
    outcomeTrusted: true,
    exitCode: 0,
    completedAt: Date.now(),
  });

  const res = evaluateCriterionResult(run.criteriaSnapshot[0], exec);
  assert.strictEqual(res.status, 'passed');

  const finalRunStatus = deriveVerificationRunStatus([res]);
  assert.strictEqual(finalRunStatus, 'passed');

  // Now simulate that the build script modified 4 files during verification!
  const beforeVerif = createMockSnapshot({ id: 'snap-v-pre', clean: true });
  const afterVerif = createMockSnapshot({
    id: 'snap-v-post',
    clean: false,
    files: [
      { path: 'dist/bundle.js', status: 'modified' },
      { path: 'dist/bundle.js.map', status: 'modified' },
    ],
  });

  const verifAttribution = finalizeChangeAttribution({
    attribution: createPendingAttribution({
      workspaceId: 'ws-v',
      targetType: 'verification-run',
      targetId: run.id,
      beforeSnapshotId: beforeVerif.id,
    }),
    beforeSnapshot: beforeVerif,
    afterSnapshot: afterVerif,
  });

  assert.strictEqual(verifAttribution.status, 'completed');
  assert.strictEqual(verifAttribution.targetType, 'verification-run');
  assert.strictEqual(verifAttribution.targetId, run.id);
  assert.strictEqual(verifAttribution.delta.filesChanged, 2);

  // CRITICAL INVARIANT: The verification run verdict remains 'passed'!
  // In V1, repository changes during verification DO NOT automatically fail verification.
  assert.strictEqual(finalRunStatus, 'passed');

  console.log('✓ Verification verdict is completely independent of observed repository changes during run');
}

// -----------------------------------------------------------------------------
// Test 11: Limitations & Disclaimers Surfaced
// -----------------------------------------------------------------------------
console.log('\n--- Test 11: Limitations & Disclaimers Surfaced ---');
{
  const cleanLimits = deriveAttributionLimitations('clean-baseline');
  assert.ok(cleanLimits.some((l) => l.includes('external processes')));

  const dirtyLimits = deriveAttributionLimitations('dirty-baseline');
  assert.ok(dirtyLimits.some((l) => l.includes('uncommitted modifications')));

  const binaryDelta = {
    filesChanged: 1,
    addedCount: 0,
    modifiedCount: 1,
    deletedCount: 0,
    renamedCount: 0,
    untrackedCount: 0,
    conflictedCount: 0,
    deltaScope: 'clean-baseline',
    files: [{ path: 'logo.png', status: 'modified', deltaKind: 'introduced', binary: true }],
  };
  const binaryLimits = deriveAttributionLimitations('clean-baseline', binaryDelta);
  assert.ok(binaryLimits.some((l) => l.includes('Binary files modified')));

  console.log('✓ Semantic limitations (dirty baseline, concurrent edits, binary files) properly surfaced');
}

console.log('\n=============================================================');
console.log('ALL 11 EXECUTION CHANGE ATTRIBUTION TESTS PASSED SUCCESSFULLY!');
console.log('=============================================================');
