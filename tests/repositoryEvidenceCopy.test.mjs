/**
 * HARDEN-008 — Repository Evidence Copy Semantics Regression Test Suite
 *
 * Verifies:
 * 1. Copy paths produces lightweight inventory without file contents.
 * 2. Modified file copy produces actual Git patch evidence with provenance.
 * 3. Added file copy produces staged Git diff evidence.
 * 4. Untracked file copy produces bounded current working-tree content, preserving canonical 'untracked' status.
 * 5. Deleted file copy produces Git deletion diff without filesystem read dependencies.
 * 6. Renamed file copy renders old.ts -> new.ts with diff evidence.
 * 7. Binary files omit binary bodies and render explicit binary disclosure.
 * 8. Oversized files and aggregate output enforce deterministic limits with explicit truncation markers.
 * 9. Aggregate Copy changes formats all files deterministically with header statistics.
 * 10. Empty change sets degrade safely without crashing.
 * 11. Component wiring connects Copy paths, Copy changes, and per-row Copy change evidence buttons.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

// 1. Transpile dependencies
const ecTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/evidenceCollectors/types.ts'));
const fileStatusPresMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/fileStatusPresentation.ts'),
  (req) => (req.includes('types') ? ecTypesMod : {}),
);
const untrackedStatsMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/untrackedFileLineStats.ts'),
  (req) => (req.includes('types') ? ecTypesMod : {}),
);

const copySemanticsMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/repositoryEvidenceCopy.ts'),
  (req) => {
    if (req.includes('fileStatusPresentation')) return fileStatusPresMod;
    if (req.includes('untrackedFileLineStats')) return untrackedStatsMod;
    if (req.includes('types')) return ecTypesMod;
    return require(req);
  },
);

const {
  formatRepositoryPathsForClipboard,
  formatRepositoryFileChangeEvidence,
  formatRepositoryChangesForClipboard,
  resolveRepositoryFileChangeEvidence,
  resolveAllRepositoryChangesEvidence,
  splitGitDiffByFile,
  extractHunkOrDiff,
  MAX_PER_FILE_COPY_BYTES,
  MAX_AGGREGATE_COPY_BYTES,
} = copySemanticsMod;

console.log('Running HARDEN-008 Repository Evidence Copy Semantics Test Suite...\n');

// ---------------------------------------------------------------------------
// Test Group 1: Copy paths (Lightweight Inventory)
// ---------------------------------------------------------------------------
{
  console.log('--- Test Group 1: Copy paths Lightweight Inventory ---');

  const files = [
    { path: 'app/src/App.tsx', status: 'modified' },
    { path: 'app/src/features/monitor/MonitorPane.tsx', status: 'untracked' },
    { path: 'app/src/NewService.ts', status: 'added' },
    { path: 'app/src/OldPanel.tsx', status: 'deleted' },
    {
      path: 'app/src/EvidenceView.tsx',
      previousPath: 'app/src/OldView.tsx',
      status: 'renamed',
    },
  ];

  const result = formatRepositoryPathsForClipboard({
    files,
    branch: 'main',
    headCommit: 'f263cbf987654321',
  });

  const expected = [
    '# Repository Changed Files',
    '',
    'Branch: main',
    'Baseline: f263cbf',
    '',
    'M app/src/App.tsx',
    '+ app/src/features/monitor/MonitorPane.tsx',
    'A app/src/NewService.ts',
    'D app/src/OldPanel.tsx',
    'R app/src/OldView.tsx -> app/src/EvidenceView.tsx',
  ].join('\n');

  assert.strictEqual(result, expected, 'Copy paths must match expected format exactly');
  assert.ok(!result.includes('```'), 'Copy paths must NOT contain code fences or file content');
  assert.ok(!result.includes('@@'), 'Copy paths must NOT contain diff hunks');

  // Empty set
  const emptyResult = formatRepositoryPathsForClipboard({ files: [] });
  assert.ok(emptyResult.includes('No repository changes observed.'));

  console.log('✓ Copy paths formats clean, deterministic inventory with branch/baseline metadata');
}

// ---------------------------------------------------------------------------
// Test Group 2: Single-File Formatter Semantics by Status
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 2: Single-File Formatter Semantics by Status ---');

  // A. Modified File: Git diff patch
  const modItem = {
    path: 'app/src/App.tsx',
    status: 'modified',
    insertions: 50,
    deletions: 12,
    evidenceSource: 'Git diff',
    patch: '@@ -10,3 +10,4 @@\n-old line\n+new line',
  };
  const modFormatted = formatRepositoryFileChangeEvidence(modItem);
  assert.ok(modFormatted.includes('## app/src/App.tsx'));
  assert.ok(modFormatted.includes('Status: modified'));
  assert.ok(modFormatted.includes('Observed line changes: +50 -12'));
  assert.ok(modFormatted.includes('Evidence source: Git diff'));
  assert.ok(modFormatted.includes('```diff\n@@ -10,3 +10,4 @@\n-old line\n+new line\n```'));

  // B. Added File: staged Git diff
  const addedItem = {
    path: 'app/src/NewService.ts',
    status: 'added',
    insertions: 96,
    deletions: 0,
    evidenceSource: 'staged Git diff',
    patch: '@@ -0,0 +1,3 @@\n+export class NewService {}\n+export default NewService;',
  };
  const addedFormatted = formatRepositoryFileChangeEvidence(addedItem);
  assert.ok(addedFormatted.includes('## app/src/NewService.ts'));
  assert.ok(addedFormatted.includes('Status: added'));
  assert.ok(addedFormatted.includes('Evidence source: staged Git diff'));
  assert.ok(addedFormatted.includes('```diff'));

  // C. Untracked File: working-tree file content & canonical 'untracked' preserved
  const untrackedItem = {
    path: 'app/src/features/monitor/MonitorPane.tsx',
    status: 'untracked',
    insertions: 182,
    deletions: 0,
    evidenceSource: 'current working-tree file',
    content: 'export function MonitorPane() {\n  return <div>Monitor</div>;\n}',
    language: 'tsx',
  };
  const untrackedFormatted = formatRepositoryFileChangeEvidence(untrackedItem);
  assert.ok(untrackedFormatted.includes('## app/src/features/monitor/MonitorPane.tsx'));
  assert.ok(untrackedFormatted.includes('Status: untracked'), 'Must preserve untracked status');
  assert.ok(!untrackedFormatted.includes('Status: added'), 'Must NEVER say added for untracked');
  assert.ok(untrackedFormatted.includes('Evidence source: current working-tree file'));
  assert.ok(untrackedFormatted.includes('```tsx\nexport function MonitorPane()'));

  // D. Deleted File: Git deletion diff
  const deletedItem = {
    path: 'app/src/OldPanel.tsx',
    status: 'deleted',
    insertions: 0,
    deletions: 90,
    evidenceSource: 'Git diff',
    patch: '@@ -1,5 +0,0 @@\n-export function OldPanel() {}\n-export default OldPanel;',
  };
  const deletedFormatted = formatRepositoryFileChangeEvidence(deletedItem);
  assert.ok(deletedFormatted.includes('## app/src/OldPanel.tsx'));
  assert.ok(deletedFormatted.includes('Status: deleted'));
  assert.ok(deletedFormatted.includes('Observed line changes: +0 -90'));
  assert.ok(deletedFormatted.includes('Evidence source: Git diff'));
  assert.ok(deletedFormatted.includes('```diff'));

  // E. Renamed File: old.ts -> new.ts header
  const renamedItem = {
    path: 'app/src/EvidenceView.tsx',
    previousPath: 'app/src/OldView.tsx',
    status: 'renamed',
    insertions: 8,
    deletions: 4,
    evidenceSource: 'Git diff',
    patch: '@@ -1,3 +1,3 @@\n-export function OldView() {}\n+export function EvidenceView() {}',
  };
  const renamedFormatted = formatRepositoryFileChangeEvidence(renamedItem);
  assert.ok(renamedFormatted.includes('## app/src/OldView.tsx -> app/src/EvidenceView.tsx'));
  assert.ok(renamedFormatted.includes('Status: renamed'));
  assert.ok(renamedFormatted.includes('Evidence source: Git diff'));

  // F. Binary File: Omitted body with explicit disclosure
  const binaryItem = {
    path: 'app/src/assets/logo.png',
    status: 'untracked',
    binary: true,
  };
  const binaryFormatted = formatRepositoryFileChangeEvidence(binaryItem);
  assert.ok(binaryFormatted.includes('## app/src/assets/logo.png'));
  assert.ok(binaryFormatted.includes('Status: untracked'));
  assert.ok(binaryFormatted.includes('Content: binary'));
  assert.ok(binaryFormatted.includes('Content body omitted.'));
  assert.ok(!binaryFormatted.includes('```'), 'Binary must not have code blocks');

  console.log('✓ All canonical file statuses format with correct provenance, diffs, and headers');
}

// ---------------------------------------------------------------------------
// Test Group 3: On-Demand Evidence Resolution with Real Git Repository
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 3: Real Git Evidence Resolution Integration ---');

  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-008-git-'));

  try {
    const runGit = (args) => {
      const res = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
      if (res.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
      }
      return res.stdout;
    };

    runGit(['init', '-b', 'main']);
    runGit(['config', 'user.name', 'TraceRelay Test']);
    runGit(['config', 'user.email', 'test@tracerelay.dev']);

    // 1. Initial commit
    fs.writeFileSync(path.join(repoDir, 'existing.ts'), 'line 1\nline 2\nline 3\n');
    fs.writeFileSync(path.join(repoDir, 'to-delete.ts'), 'del 1\ndel 2\n');
    fs.writeFileSync(path.join(repoDir, 'to-rename.ts'), 'rename initial\n');
    runGit(['add', '.']);
    runGit(['commit', '-m', 'Initial commit']);

    // 2. Modify existing.ts
    fs.writeFileSync(
      path.join(repoDir, 'existing.ts'),
      'line 1\nmodified line 2\nline 3\nadded line 4\n',
    );

    // 3. Delete to-delete.ts
    fs.unlinkSync(path.join(repoDir, 'to-delete.ts'));

    // 4. Staged new file staged-new.ts
    fs.writeFileSync(path.join(repoDir, 'staged-new.ts'), 'staged content A\nstaged content B\n');
    runGit(['add', 'staged-new.ts']);

    // 5. Untracked file untracked.ts
    fs.writeFileSync(path.join(repoDir, 'untracked.ts'), 'untracked alpha\nuntracked beta\n');

    // 6. Rename to-rename.ts -> renamed-new.ts
    runGit(['mv', 'to-rename.ts', 'renamed-new.ts']);

    // 7. Binary untracked file
    fs.writeFileSync(path.join(repoDir, 'sample.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]));

    // Native structured runner for tests
    const runner = async (input) => {
      const res = spawnSync(input.program, input.args, {
        cwd: input.cwd,
        encoding: 'utf8',
      });
      return {
        exitCode: res.status ?? 0,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
      };
    };

    // Test resolving single untracked file
    const resolvedUntracked = await resolveRepositoryFileChangeEvidence(
      { path: 'untracked.ts', status: 'untracked' },
      { repositoryRoot: repoDir, runCommand: runner, fsModule: fs },
    );
    assert.strictEqual(resolvedUntracked.status, 'untracked');
    assert.strictEqual(resolvedUntracked.evidenceSource, 'current working-tree file');
    assert.strictEqual(resolvedUntracked.content, 'untracked alpha\nuntracked beta\n');

    // Test resolving single modified file
    const resolvedModified = await resolveRepositoryFileChangeEvidence(
      { path: 'existing.ts', status: 'modified' },
      { repositoryRoot: repoDir, runCommand: runner, fsModule: fs },
    );
    assert.strictEqual(resolvedModified.status, 'modified');
    assert.strictEqual(resolvedModified.evidenceSource, 'Git diff');
    assert.ok(resolvedModified.patch.includes('-line 2'));
    assert.ok(resolvedModified.patch.includes('+modified line 2'));

    // Test resolving deleted file (never reads from disk!)
    const resolvedDeleted = await resolveRepositoryFileChangeEvidence(
      { path: 'to-delete.ts', status: 'deleted' },
      { repositoryRoot: repoDir, runCommand: runner, fsModule: fs },
    );
    assert.strictEqual(resolvedDeleted.status, 'deleted');
    assert.strictEqual(resolvedDeleted.evidenceSource, 'Git diff');
    assert.ok(resolvedDeleted.patch.includes('-del 1'));

    // Test resolving staged added file
    const resolvedAdded = await resolveRepositoryFileChangeEvidence(
      { path: 'staged-new.ts', status: 'added' },
      { repositoryRoot: repoDir, runCommand: runner, fsModule: fs },
    );
    assert.strictEqual(resolvedAdded.status, 'added');
    assert.strictEqual(resolvedAdded.evidenceSource, 'staged Git diff');
    assert.ok(resolvedAdded.patch.includes('+staged content A'));

    // Test resolving binary untracked file
    const resolvedBinary = await resolveRepositoryFileChangeEvidence(
      { path: 'sample.bin', status: 'untracked', binary: true },
      { repositoryRoot: repoDir, runCommand: runner, fsModule: fs },
    );
    assert.strictEqual(resolvedBinary.binary, true);
    assert.strictEqual(resolvedBinary.content, undefined);

    // Test resolveAllRepositoryChangesEvidence batch resolution
    const allFiles = [
      { path: 'existing.ts', status: 'modified' },
      { path: 'to-delete.ts', status: 'deleted' },
      { path: 'staged-new.ts', status: 'added' },
      { path: 'renamed-new.ts', previousPath: 'to-rename.ts', status: 'renamed' },
      { path: 'untracked.ts', status: 'untracked' },
      { path: 'sample.bin', status: 'untracked', binary: true },
    ];

    const allResolved = await resolveAllRepositoryChangesEvidence(allFiles, {
      repositoryRoot: repoDir,
      runCommand: runner,
      fsModule: fs,
    });

    assert.strictEqual(allResolved.length, 6);
    const modR = allResolved.find((f) => f.path === 'existing.ts');
    assert.ok(modR.patch.includes('+modified line 2'));

    const untrackedR = allResolved.find((f) => f.path === 'untracked.ts');
    assert.ok(untrackedR.content.includes('untracked alpha'));

    const binR = allResolved.find((f) => f.path === 'sample.bin');
    assert.strictEqual(binR.binary, true);

    // Test aggregate formatting
    const aggregateFormatted = formatRepositoryChangesForClipboard({
      files: allResolved,
      branch: 'main',
      headCommit: 'abcdef123456',
      totalInsertions: 10,
      totalDeletions: 3,
    });

    assert.ok(aggregateFormatted.includes('# Repository Changes'));
    assert.ok(aggregateFormatted.includes('Branch: main'));
    assert.ok(aggregateFormatted.includes('Baseline: abcdef1'));
    assert.ok(aggregateFormatted.includes('Files changed: 6'));
    assert.ok(aggregateFormatted.includes('Observed line changes: +10 -3'));
    assert.ok(aggregateFormatted.includes('## existing.ts'));
    assert.ok(aggregateFormatted.includes('## untracked.ts'));
    assert.ok(aggregateFormatted.includes('## to-rename.ts -> renamed-new.ts'));

    console.log('✓ Real Git repository evidence resolution accurately retrieves patches, working-tree content, and renames');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Test Group 4: Bounded Reads & Explicit Truncation
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 4: Bounded Reads & Explicit Truncation ---');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-008-trunc-'));

  try {
    const bigFile = path.join(tmpDir, 'big.txt');
    const line = '0123456789abcdef\n';
    fs.writeFileSync(bigFile, line.repeat(200)); // ~3400 bytes

    // Resolve with a tiny 100-byte per-file limit
    const resolved = await resolveRepositoryFileChangeEvidence(
      { path: 'big.txt', status: 'untracked' },
      { repositoryRoot: tmpDir, fsModule: fs, maxPerFileBytes: 100 },
    );

    assert.strictEqual(resolved.truncated, true);
    assert.ok(resolved.content.length <= 100);

    const formatted = formatRepositoryFileChangeEvidence(resolved);
    assert.ok(formatted.includes('[TRUNCATED: repository evidence for big.txt exceeded copy limit]'));

    // Test aggregate limit truncation
    const fileItems = [
      { path: 'file1.txt', status: 'untracked', content: 'content of file 1\n' },
      { path: 'file2.txt', status: 'untracked', content: 'content of file 2\n' },
      { path: 'file3.txt', status: 'untracked', content: 'content of file 3\n' },
      { path: 'file4.txt', status: 'untracked', content: 'content of file 4\n' },
    ];

    const aggregateTruncated = formatRepositoryChangesForClipboard({
      files: fileItems,
      maxAggregateBytes: 150, // Small limit
    });

    assert.ok(
      aggregateTruncated.includes('[TRUNCATED: repository evidence exceeded aggregate copy limit of 150 bytes'),
    );

    console.log('✓ Per-file and aggregate boundaries strictly enforce truncation markers without silent cuts');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Test Group 5: Paths with Spaces, Unicode, Brackets, and Leading Dashes
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 5: Weird Filename Safety ---');

  const weirdFiles = [
    { path: 'src/new file with spaces.ts', status: 'modified' },
    { path: 'src/[route]/page.tsx', status: 'untracked' },
    { path: 'src/测试.ts', status: 'added' },
    { path: 'src/-special-leading-dash.ts', status: 'deleted' },
  ];

  const pathsFormatted = formatRepositoryPathsForClipboard({
    files: weirdFiles,
  });

  assert.ok(pathsFormatted.includes('M src/new file with spaces.ts'));
  assert.ok(pathsFormatted.includes('+ src/[route]/page.tsx'));
  assert.ok(pathsFormatted.includes('A src/测试.ts'));
  assert.ok(pathsFormatted.includes('D src/-special-leading-dash.ts'));

  const fileBlock = formatRepositoryFileChangeEvidence({
    path: 'src/[route]/page.tsx',
    status: 'untracked',
    content: 'export default function Page() {}',
  });
  assert.ok(fileBlock.includes('## src/[route]/page.tsx'));

  console.log('✓ Spaces, brackets, Unicode, and leading dashes are preserved faithfully without shell escaping');
}

// ---------------------------------------------------------------------------
// Test Group 6: Component Wiring & Button Accessibility
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 6: Component Wiring & UI Semantics ---');

  const viewTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/evidenceCollectors/RepositoryEvidenceView.tsx'),
    'utf8',
  );

  // Check required buttons
  assert.ok(viewTsx.includes('Copy paths'), 'Must have Copy paths button');
  assert.ok(viewTsx.includes('Copy changes'), 'Must have Copy changes button');
  assert.ok(!viewTsx.includes('title="Copy all"'), 'Must NOT have ambiguous Copy all');
  assert.ok(!viewTsx.includes('>Copy all<'), 'Must NOT have ambiguous Copy all label');

  // Check row button accessibility
  assert.ok(
    viewTsx.includes('title="Copy change evidence"'),
    'Per-row button must have title="Copy change evidence"',
  );
  assert.ok(
    viewTsx.includes('aria-label={`Copy change evidence for ${file.path}`}'),
    'Per-row button must have accessible aria-label',
  );

  // Check helper integration
  assert.ok(
    viewTsx.includes('formatRepositoryPathsForClipboard'),
    'Uses formatRepositoryPathsForClipboard',
  );
  assert.ok(
    viewTsx.includes('formatRepositoryChangesForClipboard'),
    'Uses formatRepositoryChangesForClipboard',
  );
  assert.ok(
    viewTsx.includes('formatRepositoryFileChangeEvidence'),
    'Uses formatRepositoryFileChangeEvidence',
  );
  assert.ok(
    viewTsx.includes('resolveRepositoryFileChangeEvidence'),
    'Uses resolveRepositoryFileChangeEvidence',
  );
  assert.ok(
    viewTsx.includes('resolveAllRepositoryChangesEvidence'),
    'Uses resolveAllRepositoryChangesEvidence',
  );

  // Check CSS classes
  const css = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/evidenceCollectors/RepositoryEvidenceView.css'),
    'utf8',
  );
  assert.ok(css.includes('.repository-header-copy-actions'), 'CSS defines .repository-header-copy-actions');
  assert.ok(css.includes('.repository-copy-paths-btn'), 'CSS defines .repository-copy-paths-btn');
  assert.ok(css.includes('.repository-copy-changes-btn'), 'CSS defines .repository-copy-changes-btn');

  console.log('✓ RepositoryEvidenceView cleanly wires copy actions with explicit labels and accessible tooltips');
}

console.log('\n=============================================================');
console.log('ALL HARDEN-008 REPOSITORY EVIDENCE COPY SEMANTICS TESTS PASSED!');
console.log('=============================================================\n');
