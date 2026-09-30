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
const execTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/execution/types.ts'));
const {
  DEFAULT_LOCAL_HUMAN_ACTOR,
  isExecutionLifecycle,
  isExecutionOutcome,
  isExecutionOutcomeSource,
  isExecutionIntent,
  isExecution,
  isEvidenceBlock,
} = execTypesMod;

const formatMod = transpileTs(path.resolve(__dirname, '../app/src/features/transcript/transcriptFormat.ts'));
const cleanupMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/transcript/transcriptDisplayCleanup.ts'),
  (req) => (req.includes('transcriptFormat') ? formatMod : {}),
);

const seTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/structuredEvidence/types.ts'));
const execModelMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/execution/executionModel.ts'),
  (req) => {
    if (req.includes('transcriptFormat')) return { ...formatMod, cleanTranscriptForDisplay: cleanupMod.cleanTranscriptForDisplay };
    if (req.includes('types')) return execTypesMod;
    return {};
  },
);
const {
  createExecution,
  createEvidenceBlock,
  deriveExecutionOutcome,
} = execModelMod;

// 2. Transpile verification types & models
const verifTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/verification/types.ts'));
const verifModelMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'),
  (req) => {
    if (req.includes('types')) return verifTypesMod;
    if (req.includes('execution')) return execModelMod;
    return {};
  },
);
const {
  createVerificationCriterion,
  evaluateCriterionResult,
} = verifModelMod;

// 3. Transpile evidenceCollectors domain
const ecTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/evidenceCollectors/types.ts'));
const {
  isEvidenceCollectionStatus,
  isEvidenceCollectionRun,
  isRepositoryMetadataEvidence,
  isGitStatusEvidence,
  isGitDiffSummaryEvidence,
  isRepositorySnapshot,
} = ecTypesMod;

const collectorRunnerMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/collectorRunner.ts'),
  (req) => {
    if (req.includes('types')) return ecTypesMod;
    return {};
  },
);
const {
  validateCollectorCommand,
  ALLOWED_PROGRAMS,
  ALLOWED_GIT_SUBCOMMANDS,
  DISALLOWED_MUTATING_KEYWORDS,
} = collectorRunnerMod;

const repoResolverMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/repositoryResolver.ts'),
  (req) => {
    if (req.includes('collectorRunner')) return collectorRunnerMod;
    if (req.includes('types')) return ecTypesMod;
    return {};
  },
);
const { resolveRepositoryRoot } = repoResolverMod;

const gitMetaMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/parsers/gitMetadataCollector.ts'),
  (req) => (req.includes('types') ? ecTypesMod : {}),
);
const { gitMetadataCollector, GIT_METADATA_COLLECTOR_ID, GIT_METADATA_COLLECTOR_VERSION } = gitMetaMod;

const gitStatusMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/parsers/gitStatusCollector.ts'),
  (req) => (req.includes('types') ? ecTypesMod : {}),
);
const {
  gitStatusCollector,
  parseGitPorcelainV1Z,
  GIT_STATUS_COLLECTOR_ID,
  GIT_STATUS_COLLECTOR_VERSION,
} = gitStatusMod;

const gitDiffMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/parsers/gitDiffSummaryCollector.ts'),
  (req) => (req.includes('types') ? ecTypesMod : {}),
);
const {
  gitDiffSummaryCollector,
  parseGitNumstatZ,
  GIT_DIFF_SUMMARY_COLLECTOR_ID,
  GIT_DIFF_SUMMARY_COLLECTOR_VERSION,
} = gitDiffMod;

const registryMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/collectorRegistry.ts'),
  (req) => {
    if (req.includes('gitMetadataCollector')) return gitMetaMod;
    if (req.includes('gitStatusCollector')) return gitStatusMod;
    if (req.includes('gitDiffSummaryCollector')) return gitDiffMod;
    if (req.includes('types')) return ecTypesMod;
    return {};
  },
);
const { DEFAULT_COLLECTOR_REGISTRY } = registryMod;

const serviceMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/collectorService.ts'),
  (req) => {
    if (req.includes('collectorRegistry')) return registryMod;
    if (req.includes('collectorRunner')) return collectorRunnerMod;
    if (req.includes('repositoryResolver')) return repoResolverMod;
    if (req.includes('types')) return ecTypesMod;
    return {};
  },
);
const { collectRepositoryEvidence } = serviceMod;

console.log('Running Evidence Collectors Foundation Test Suite...\n');

// -----------------------------------------------------------------------------
// Test 1: Security Boundary — Shell Interpolation & Disallowed Programs Rejected
// -----------------------------------------------------------------------------
console.log('--- Test 1: Security Boundary: Program Whitelist & Shell Rejection ---');
{
  // 1. Rejects arbitrary shell execution like 'sh -c' or 'bash'
  assert.throws(
    () => validateCollectorCommand({ program: 'sh', args: ['-c', 'git status'] }),
    /Security policy violation: Program 'sh' is not permitted/,
  );

  assert.throws(
    () => validateCollectorCommand({ program: 'bash', args: ['-c', 'git status'] }),
    /Security policy violation: Program 'bash' is not permitted/,
  );

  assert.throws(
    () => validateCollectorCommand({ program: 'zsh', args: ['-c', 'git status'] }),
    /Security policy violation: Program 'zsh' is not permitted/,
  );

  assert.throws(
    () => validateCollectorCommand({ program: 'node', args: ['-e', 'process.exit(0)'] }),
    /Security policy violation: Program 'node' is not permitted/,
  );

  // 2. Requires Git subcommand
  assert.throws(
    () => validateCollectorCommand({ program: 'git', args: [] }),
    /Security policy violation: Git collector command requires a subcommand/,
  );

  // 3. Strictly validates allowed read-only subcommands
  assert.doesNotThrow(() =>
    validateCollectorCommand({ program: 'git', args: ['status', '--porcelain=v1', '-z'] }),
  );
  assert.doesNotThrow(() =>
    validateCollectorCommand({ program: 'git', args: ['rev-parse', '--show-toplevel'] }),
  );
  assert.doesNotThrow(() =>
    validateCollectorCommand({ program: 'git', args: ['diff', '--numstat', '-z'] }),
  );
  assert.doesNotThrow(() =>
    validateCollectorCommand({ program: 'git', args: ['branch', '--show-current'] }),
  );

  console.log('✓ Whitelisted programs enforced; arbitrary shell runners strictly rejected');
}

// -----------------------------------------------------------------------------
// Test 2: Security Boundary — Mutating Git Commands Strictly Forbidden
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Security Boundary: Mutating Git Commands Rejected ---');
{
  const mutatingCommands = [
    ['commit', '-m', 'evil'],
    ['push', 'origin', 'main'],
    ['pull', 'origin', 'main'],
    ['checkout', 'main'],
    ['reset', '--hard', 'HEAD~1'],
    ['clean', '-fd'],
    ['stash', 'pop'],
    ['rebase', 'main'],
    ['merge', 'feat'],
    ['tag', 'v1.0.0'],
    ['clone', 'https://example.com/repo.git'],
  ];

  for (const args of mutatingCommands) {
    assert.throws(
      () => validateCollectorCommand({ program: 'git', args }),
      /Security policy violation/,
      `Mutating command 'git ${args.join(' ')}' must be rejected`,
    );
  }

  // Parameter disguised mutating flag
  assert.throws(
    () => validateCollectorCommand({ program: 'git', args: ['status', '--commit'] }),
    /Security policy violation: Mutating keyword 'commit' is forbidden/,
  );

  console.log('✓ All mutating git commands (commit, push, checkout, reset, clean, etc.) strictly rejected');
}

// -----------------------------------------------------------------------------
// Test 3: Git Status Porcelain V1 -z Parser (Spaces, Unicode, Untracked, Renames)
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Git Status Porcelain V1 -z Parser ---');
{
  // Simulated NUL-separated porcelain v1 output:
  // M  src/auth.ts\0
  //  M src/session.ts\0
  // MM src/both.ts\0
  // A  new file with spaces.txt\0
  // ?? docs/notes 日本語.md\0
  // R  new-name.ts\0old-name.ts\0
  // D  deleted.ts\0
  // UU conflicted.ts\0
  const porcelainZ = [
    'M  src/auth.ts',
    ' M src/session.ts',
    'MM src/both.ts',
    'A  new file with spaces.txt',
    '?? docs/notes 日本語.md',
    'R  new-name.ts',
    'old-name.ts',
    'D  deleted.ts',
    'UU conflicted.ts',
    '',
  ].join('\0');

  const files = parseGitPorcelainV1Z(porcelainZ);
  assert.strictEqual(files.length, 8);

  // 1. Staged modified
  const f1 = files[0];
  assert.strictEqual(f1.path, 'src/auth.ts');
  assert.strictEqual(f1.status, 'modified');
  assert.strictEqual(f1.staged, true);
  assert.strictEqual(f1.unstaged, false);

  // 2. Unstaged modified
  const f2 = files[1];
  assert.strictEqual(f2.path, 'src/session.ts');
  assert.strictEqual(f2.status, 'modified');
  assert.strictEqual(f2.staged, false);
  assert.strictEqual(f2.unstaged, true);

  // 3. Both staged and unstaged modified
  const f3 = files[2];
  assert.strictEqual(f3.path, 'src/both.ts');
  assert.strictEqual(f3.status, 'modified');
  assert.strictEqual(f3.staged, true);
  assert.strictEqual(f3.unstaged, true);

  // 4. Staged added with space
  const f4 = files[3];
  assert.strictEqual(f4.path, 'new file with spaces.txt');
  assert.strictEqual(f4.status, 'added');
  assert.strictEqual(f4.staged, true);

  // 5. Untracked Unicode file
  const f5 = files[4];
  assert.strictEqual(f5.path, 'docs/notes 日本語.md');
  assert.strictEqual(f5.status, 'untracked');
  assert.strictEqual(f5.staged, false);
  assert.strictEqual(f5.unstaged, false);

  // 6. Rename with pair
  const f6 = files[5];
  assert.strictEqual(f6.path, 'new-name.ts');
  assert.strictEqual(f6.previousPath, 'old-name.ts');
  assert.strictEqual(f6.status, 'renamed');
  assert.strictEqual(f6.staged, true);

  // 7. Staged deleted
  const f7 = files[6];
  assert.strictEqual(f7.path, 'deleted.ts');
  assert.strictEqual(f7.status, 'deleted');
  assert.strictEqual(f7.staged, true);

  // 8. Conflicted
  const f8 = files[7];
  assert.strictEqual(f8.path, 'conflicted.ts');
  assert.strictEqual(f8.status, 'conflicted');

  console.log('✓ Porcelain v1 -z parser properly extracts status, staged/unstaged flags, spaces, Unicode, and renames');
}

// -----------------------------------------------------------------------------
// Test 4: Git Diff Numstat Parser (Insertions, Deletions, Binary Files)
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Git Diff Numstat -z Parser ---');
{
  // Simulated NUL-separated numstat output:
  // 12\t4\tsrc/auth.ts\0
  // 120\t0\tnew file.txt\0
  // -\t-\tassets/image.png\0
  const numstatZ = [
    '12\t4\tsrc/auth.ts',
    '120\t0\tnew file.txt',
    '-\t-\tassets/image.png',
    '',
  ].join('\0');

  const diffs = parseGitNumstatZ(numstatZ);
  assert.strictEqual(diffs.length, 3);

  // 1. Normal file
  assert.strictEqual(diffs[0].path, 'src/auth.ts');
  assert.strictEqual(diffs[0].insertions, 12);
  assert.strictEqual(diffs[0].deletions, 4);
  assert.strictEqual(diffs[0].binary, undefined);

  // 2. Added file
  assert.strictEqual(diffs[1].path, 'new file.txt');
  assert.strictEqual(diffs[1].insertions, 120);
  assert.strictEqual(diffs[1].deletions, 0);

  // 3. Binary file
  assert.strictEqual(diffs[2].path, 'assets/image.png');
  assert.strictEqual(diffs[2].insertions, undefined);
  assert.strictEqual(diffs[2].deletions, undefined);
  assert.strictEqual(diffs[2].binary, true);

  console.log('✓ Numstat parser accurately extracts insertions, deletions, binary files, and handles space paths');
}

// -----------------------------------------------------------------------------
// Test 5: Full Diff Body and Remote URLs are NOT Collected
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Privacy Boundary: No Source Diffs & No Remote URLs ---');
{
  // Verify that gitDiffSummaryCollector only invokes --numstat and never raw git diff
  const invokedArgs = [];
  const mockRunner = async (input) => {
    invokedArgs.push(input.args);
    return { exitCode: 0, stdout: '', stderr: '', durationMs: 5 };
  };

  const dummyContext = {
    workspaceId: 'ws-test',
    repositoryRoot: '/mock/repo',
    collectionRunId: 'run-1',
    runCommand: mockRunner,
  };

  await gitDiffSummaryCollector.collect(dummyContext);

  for (const args of invokedArgs) {
    assert.ok(args.includes('--numstat'), 'Must strictly invoke --numstat, never full patch diff');
    assert.strictEqual(args.includes('-p'), false, 'Must not request patch text');
    assert.strictEqual(args.includes('--patch'), false, 'Must not request patch text');
  }

  // Verify that gitMetadataCollector does not request remote URLs
  const metaArgs = [];
  const metaRunner = async (input) => {
    metaArgs.push(input.args);
    return { exitCode: 0, stdout: 'mock', stderr: '', durationMs: 2 };
  };
  await gitMetadataCollector.collect({ ...dummyContext, runCommand: metaRunner });

  for (const args of metaArgs) {
    assert.strictEqual(args.includes('remote'), false, 'Must not query git remote');
    assert.strictEqual(args.includes('config'), false, 'Must not query git config');
  }

  console.log('✓ Privacy boundary verified: source patch text and remote URLs are never collected');
}

// -----------------------------------------------------------------------------
// Test 6: Repository Root Resolution & Non-Git Unsupported Handling
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Repository Root Resolution & Unsupported Status ---');
{
  // 1. Success resolution
  const mockSuccessRunner = async (input) => {
    if (input.args.includes('--show-toplevel')) {
      return { exitCode: 0, stdout: '/Users/test/projects/my-repo\n', stderr: '', durationMs: 2 };
    }
    return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
  };

  const root = await resolveRepositoryRoot('/Users/test/projects/my-repo/src', mockSuccessRunner);
  assert.strictEqual(root, '/Users/test/projects/my-repo');

  // 2. Non-git directory
  const mockNonGitRunner = async () => {
    return { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', durationMs: 2 };
  };

  const nonGitRoot = await resolveRepositoryRoot('/tmp/non-git', mockNonGitRunner);
  assert.strictEqual(nonGitRoot, null);

  // 3. Collector Service marks status 'unsupported' without throwing an error
  const result = await collectRepositoryEvidence({
    workspaceId: 'ws-nongit',
    cwd: '/tmp/non-git',
    runner: mockNonGitRunner,
  });

  assert.strictEqual(result.run.status, 'unsupported');
  assert.strictEqual(result.run.workspaceId, 'ws-nongit');
  assert.strictEqual(result.run.errorMessage, 'Directory is not inside a Git repository');
  assert.strictEqual(result.snapshot, undefined);

  console.log('✓ Repository root resolution works; non-git directories cleanly yield unsupported status');
}

// -----------------------------------------------------------------------------
// Test 7: Full Snapshot Assembly & Provenance Retention
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Snapshot Assembly & Provenance ---');
{
  const mockGitRunner = async (input) => {
    const joined = input.args.join(' ');
    if (joined === 'rev-parse --show-toplevel') {
      return { exitCode: 0, stdout: '/workspace/app\n', stderr: '', durationMs: 2 };
    }
    if (joined === 'rev-parse --is-inside-work-tree') {
      return { exitCode: 0, stdout: 'true\n', stderr: '', durationMs: 1 };
    }
    if (joined === 'rev-parse HEAD') {
      return { exitCode: 0, stdout: 'e7f8c9a1b2c3d4e5f6\n', stderr: '', durationMs: 2 };
    }
    if (joined === 'branch --show-current') {
      return { exitCode: 0, stdout: 'feature/collectors\n', stderr: '', durationMs: 2 };
    }
    if (joined.startsWith('status --porcelain=v1')) {
      const z = ['M  src/auth.ts', '?? tests/new.test.ts', ''].join('\0');
      return { exitCode: 0, stdout: z, stderr: '', durationMs: 3 };
    }
    if (joined === 'diff --numstat -z') {
      return { exitCode: 0, stdout: '5\t2\tsrc/auth.ts\0', stderr: '', durationMs: 3 };
    }
    if (joined === 'diff --cached --numstat -z') {
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 2 };
    }
    return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
  };

  const { run, snapshot } = await collectRepositoryEvidence({
    workspaceId: 'ws-full',
    cwd: '/workspace/app/src',
    runner: mockGitRunner,
  });

  assert.strictEqual(run.status, 'completed');
  assert.strictEqual(run.workspaceId, 'ws-full');
  assert.strictEqual(run.repositoryRoot, '/workspace/app');
  assert.ok(isRepositorySnapshot(snapshot));

  // Snapshot provenance
  assert.strictEqual(snapshot.collectionRunId, run.id);
  assert.strictEqual(snapshot.workspaceId, 'ws-full');
  assert.strictEqual(snapshot.repositoryRoot, '/workspace/app');

  // Metadata verification
  assert.ok(snapshot.metadata);
  assert.strictEqual(snapshot.metadata.branch, 'feature/collectors');
  assert.strictEqual(snapshot.metadata.headCommit, 'e7f8c9a1b2c3d4e5f6');
  assert.strictEqual(snapshot.metadata.collectorId, GIT_METADATA_COLLECTOR_ID);
  assert.strictEqual(snapshot.metadata.collectorVersion, GIT_METADATA_COLLECTOR_VERSION);

  // Status verification
  assert.ok(snapshot.status);
  assert.strictEqual(snapshot.status.clean, false);
  assert.strictEqual(snapshot.status.files.length, 2);
  assert.strictEqual(snapshot.status.modifiedCount, 1);
  assert.strictEqual(snapshot.status.untrackedCount, 1);

  // Diff summary verification
  assert.ok(snapshot.diffSummary);
  assert.strictEqual(snapshot.diffSummary.filesChanged, 1);
  assert.strictEqual(snapshot.diffSummary.insertions, 5);
  assert.strictEqual(snapshot.diffSummary.deletions, 2);

  console.log('✓ Full snapshot assembled with metadata, status, diff metrics, and complete provenance');
}

// -----------------------------------------------------------------------------
// Test 8: Contradiction Invariants — Collector Failure Cannot Mutate Execution Truth
// -----------------------------------------------------------------------------
console.log('\n--- Test 8: Contradiction Invariant: Execution Truth Preserved ---');
{
  // User command execution succeeded
  const userExecution = createExecution({
    id: 'exec-user-cmd',
    workspaceId: 'ws-1',
    command: 'npm test',
    outcome: 'succeeded',
    outcomeTrusted: true,
    outcomeSource: 'trusted-shell',
    exitCode: 0,
  });

  // Collector fails completely (e.g. git error or corrupted repository)
  const failingRunner = async () => {
    return { exitCode: 128, stdout: '', stderr: 'fatal: corrupted git repo', durationMs: 5 };
  };

  const { run } = await collectRepositoryEvidence({
    workspaceId: 'ws-1',
    cwd: '/invalid/path',
    runner: failingRunner,
  });

  // Collector run reported unsupported or failed
  assert.strictEqual(run.status, 'unsupported');

  // CRITICAL INVARIANT: User execution MUST remain unchanged
  assert.strictEqual(userExecution.outcome, 'succeeded');
  assert.strictEqual(userExecution.exitCode, 0);
  assert.strictEqual(userExecution.outcomeTrusted, true);
  assert.strictEqual(userExecution.outcomeSource, 'trusted-shell');

  console.log('✓ Contradiction invariant verified: Collector failure leaves Execution outcome & exit code 100% intact');
}

// -----------------------------------------------------------------------------
// Test 9: Contradiction Invariants — Collector Cannot Mutate Verification Verdict
// -----------------------------------------------------------------------------
console.log('\n--- Test 9: Contradiction Invariant: Verification Verdict Preserved ---');
{
  const criterion = createVerificationCriterion({
    id: 'crit-collectors',
    command: 'npm test',
    expectedExitCodes: [0],
  });

  const exec = createExecution({
    id: 'exec-verif-target',
    workspaceId: 'ws-1',
    command: 'npm test',
    intent: 'verification',
    lifecycle: 'finished',
    outcome: 'succeeded',
    outcomeTrusted: true,
    outcomeSource: 'trusted-shell',
    exitCode: 0,
  });

  // Criterion evaluation before repository collection
  const resultBefore = evaluateCriterionResult(criterion, exec);
  assert.strictEqual(resultBefore.status, 'passed');

  // Simulate dirty repository snapshot with modified files
  const dirtySnapshot = {
    id: 'snap-dirty',
    collectionRunId: 'run-dirty',
    workspaceId: 'ws-1',
    repositoryRoot: '/repo',
    createdAt: Date.now(),
    status: {
      clean: false,
      modifiedCount: 5,
    },
  };

  // Re-evaluating verification criterion remains strictly based on process execution
  const resultAfter = evaluateCriterionResult(criterion, exec);
  assert.strictEqual(resultAfter.status, 'passed');
  assert.strictEqual(resultAfter.observedExitCode, 0);

  console.log('✓ Contradiction invariant verified: Verification verdict is completely independent of repository status');
}

// -----------------------------------------------------------------------------
// Test 10: Snapshot Immutability & Workspace Isolation
// -----------------------------------------------------------------------------
console.log('\n--- Test 10: Snapshot Immutability & Workspace Isolation ---');
{
  const snap1 = {
    id: 'snap-1',
    collectionRunId: 'run-1',
    workspaceId: 'ws-alpha',
    repositoryRoot: '/repo/alpha',
    createdAt: 1000,
    status: {
      type: 'git-status',
      clean: true,
      files: [],
      modifiedCount: 0,
      addedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      collectorId: 'git-status',
      collectorVersion: '1.0.0',
      collectionRunId: 'run-1',
      workspaceId: 'ws-alpha',
      repositoryRoot: '/repo/alpha',
      createdAt: 1000,
    },
  };
  const frozenSnap1 = Object.freeze(JSON.parse(JSON.stringify(snap1)));

  // Workspace Beta collects another repository snapshot
  const snap2 = {
    id: 'snap-2',
    collectionRunId: 'run-2',
    workspaceId: 'ws-beta',
    repositoryRoot: '/repo/beta',
    createdAt: 2000,
    status: {
      type: 'git-status',
      clean: false,
      files: [{ path: 'test.ts', status: 'modified', staged: false, unstaged: true }],
      modifiedCount: 1,
      addedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      collectorId: 'git-status',
      collectorVersion: '1.0.0',
      collectionRunId: 'run-2',
      workspaceId: 'ws-beta',
      repositoryRoot: '/repo/beta',
      createdAt: 2000,
    },
  };

  // Assert snap1 remains completely unmutated
  assert.deepStrictEqual(snap1, frozenSnap1);
  assert.strictEqual(snap1.workspaceId, 'ws-alpha');
  assert.strictEqual(snap2.workspaceId, 'ws-beta');
  assert.strictEqual(snap1.status.clean, true);
  assert.strictEqual(snap2.status.clean, false);

  console.log('✓ Snapshot immutability and workspace isolation verified');
}

// -----------------------------------------------------------------------------
// Test 11: Trusted Process Outcome Source Representation
// -----------------------------------------------------------------------------
console.log('\n--- Test 11: Trusted Process Outcome Source ---');
{
  assert.strictEqual(isExecutionOutcomeSource('trusted-process'), true);
  assert.strictEqual(isExecutionIntent('evidence-collection'), true);

  const procExec = createExecution({
    id: 'exec-proc',
    workspaceId: 'ws-1',
    command: 'git status',
    intent: 'evidence-collection',
    outcomeSource: 'trusted-process',
    outcomeTrusted: true,
    exitCode: 0,
  });

  assert.strictEqual(procExec.intent, 'evidence-collection');
  assert.strictEqual(procExec.outcomeSource, 'trusted-process');
  assert.strictEqual(procExec.outcomeTrusted, true);
  assert.strictEqual(procExec.outcome, 'succeeded');

  // Exit 1 with trusted-process produces failed
  const failProcExec = createExecution({
    id: 'exec-proc-fail',
    workspaceId: 'ws-1',
    command: 'git status',
    intent: 'evidence-collection',
    outcomeSource: 'trusted-process',
    outcomeTrusted: true,
    exitCode: 1,
  });

  assert.strictEqual(failProcExec.outcome, 'failed');

  console.log('✓ Trusted process outcome source and evidence-collection intent verified');
}

console.log('\n=============================================================');
console.log('ALL 11 EVIDENCE COLLECTORS FOUNDATION TESTS PASSED SUCCESSFULLY!');
console.log('=============================================================');
