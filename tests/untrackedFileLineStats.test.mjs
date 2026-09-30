/**
 * HARDEN-007 — Repository Evidence Line Stats for New / Untracked Files Test Suite
 *
 * Verifies:
 * 1. Deterministic newline counting semantics across LF/CRLF and empty states.
 * 2. Binary detection and prevention of fake line counts for binary untracked files.
 * 3. Bounded reads and safe handling of oversized untracked files without fake line counts.
 * 4. Safe path handling with spaces, brackets, quotes, and unicode.
 * 5. Full repository evidence collection across untracked, staged-new, modified, and deleted files.
 * 6. Non-mutation of canonical status ('untracked' is never mutated to 'added').
 * 7. Evidence Selection and Prompt Composer integration with line stats and binary indicators.
 * 8. Repository summary aggregation matching visible file evidence with clear internal provenance.
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

// 1. Transpile types and helper modules
const ecTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/evidenceCollectors/types.ts'));
const untrackedStatsMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/untrackedFileLineStats.ts'),
  (req) => (req.includes('types') ? ecTypesMod : require(req)),
);
const {
  countTextLines,
  isBinaryBuffer,
  inspectUntrackedFileLineStats,
  MAX_UNTRACKED_FILE_INSPECTION_BYTES,
} = untrackedStatsMod;

const customReq = (req) => {
  if (req.includes('@tauri-apps/api')) return { invoke: async () => ({}) };
  if (req.includes('types')) return ecTypesMod;
  return require(req);
};

const collectorRunnerMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/collectorRunner.ts'),
  customReq,
);
const { runCollectorProcess } = collectorRunnerMod;

const repoResolverMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/repositoryResolver.ts'),
  (req) => {
    if (req.includes('collectorRunner')) return collectorRunnerMod;
    if (req.includes('types')) return ecTypesMod;
    return customReq(req);
  },
);

const gitStatusMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/parsers/gitStatusCollector.ts'),
  (req) => {
    if (req.includes('untrackedFileLineStats')) return untrackedStatsMod;
    if (req.includes('types')) return ecTypesMod;
    return customReq(req);
  },
);
const { gitStatusCollector } = gitStatusMod;

const gitDiffMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/parsers/gitDiffSummaryCollector.ts'),
  (req) => (req.includes('types') ? ecTypesMod : customReq(req)),
);
const { gitDiffSummaryCollector } = gitDiffMod;

const gitMetaMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/parsers/gitMetadataCollector.ts'),
  (req) => (req.includes('types') ? ecTypesMod : customReq(req)),
);
const { gitMetadataCollector } = gitMetaMod;

const collectorRegistryMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/collectorRegistry.ts'),
  (req) => {
    if (req.includes('gitStatusCollector')) return gitStatusMod;
    if (req.includes('gitDiffSummaryCollector')) return gitDiffMod;
    if (req.includes('gitMetadataCollector')) return gitMetaMod;
    if (req.includes('types')) return ecTypesMod;
    return customReq(req);
  },
);

const collectorServiceMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/collectorService.ts'),
  (req) => {
    if (req.includes('collectorRegistry')) return collectorRegistryMod;
    if (req.includes('collectorRunner')) return collectorRunnerMod;
    if (req.includes('repositoryResolver')) return repoResolverMod;
    if (req.includes('types')) return ecTypesMod;
    return customReq(req);
  },
);
const { collectRepositoryEvidence } = collectorServiceMod;

const selectionMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceSelection/selectionModel.ts'),
);
const {
  formatRepositoryFileText,
  createRepositoryFileSelectionItem,
} = selectionMod;

console.log('Running HARDEN-007 Repository Evidence Line Stats Test Suite...\n');

// ---------------------------------------------------------------------------
// Test Group 1: Deterministic Newline Counting Semantics
// ---------------------------------------------------------------------------
{
  console.log('--- Test Group 1: Deterministic Newline Counting Semantics ---');

  // Exact requirements from Section 9:
  assert.strictEqual(countTextLines(''), 0, '"" -> 0 lines');
  assert.strictEqual(countTextLines('a'), 1, '"a" -> 1 line');
  assert.strictEqual(countTextLines('a\n'), 1, '"a\\n" -> 1 line');
  assert.strictEqual(countTextLines('a\nb'), 2, '"a\\nb" -> 2 lines');
  assert.strictEqual(countTextLines('a\nb\n'), 2, '"a\\nb\\n" -> 2 lines');

  // Windows CRLF
  assert.strictEqual(countTextLines('a\r\nb'), 2, '"a\\r\\nb" -> 2 lines (CRLF)');
  assert.strictEqual(countTextLines('a\r\nb\r\n'), 2, '"a\\r\\nb\\r\\n" -> 2 lines (CRLF)');

  // Standalone newlines
  assert.strictEqual(countTextLines('\n'), 1, '"\\n" -> 1 line');
  assert.strictEqual(countTextLines('\n\n'), 2, '"\\n\\n" -> 2 lines');
  assert.strictEqual(countTextLines('first\n\nthird\n'), 3, 'empty line in middle counted');

  console.log('✓ Text newline counting strictly satisfies standard textual expectations');
}

// ---------------------------------------------------------------------------
// Test Group 2: Binary Detection & Prevention of Fake Counts
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 2: Binary Detection & Safety ---');

  // Text buffer
  const textBuf = Buffer.from('const x = 1;\nconsole.log(x);\n', 'utf8');
  assert.strictEqual(isBinaryBuffer(textBuf), false, 'UTF-8 text is not binary');

  // Binary buffer with NUL byte
  const binaryBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
  assert.strictEqual(isBinaryBuffer(binaryBuf), true, 'Buffer with NUL byte is detected as binary');

  console.log('✓ NUL byte detection accurately classifies binary content');
}

// ---------------------------------------------------------------------------
// Test Group 3: Bounded Reads & Oversized File Handling
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 3: Bounded Reads & Oversized Files ---');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-007-oversized-'));
  try {
    const hugeFilePath = path.join(tmpDir, 'huge.txt');
    // Create a 200-byte file
    const chunk = 'Line of text for testing oversized threshold.\n';
    fs.writeFileSync(hugeFilePath, chunk.repeat(10));

    // Inspect with a small 50-byte threshold
    const result = await inspectUntrackedFileLineStats(tmpDir, 'huge.txt', {
      maxSizeBytes: 50,
      fsModule: fs,
    });

    assert.strictEqual(result.status, 'unavailable');
    assert.strictEqual(result.oversized, true);
    assert.strictEqual(result.source, 'unavailable');
    assert.strictEqual(result.additions, undefined, 'Must not report fake truncated line count');
    assert.strictEqual(result.deletions, undefined);

    console.log('✓ Files exceeding safety threshold safely return unavailable without fake counts');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Test Group 4: Safe Path Handling (Spaces, Brackets, Unicode)
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 4: Safe Path Handling ---');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-007-paths-'));
  try {
    const weirdName = 'new file [test] 日本語.ts';
    const weirdPath = path.join(tmpDir, weirdName);
    fs.writeFileSync(weirdPath, 'const a = 1;\nconst b = 2;\n', 'utf8');

    const result = await inspectUntrackedFileLineStats(tmpDir, weirdName, {
      fsModule: fs,
    });

    assert.strictEqual(result.status, 'computed');
    assert.strictEqual(result.additions, 2);
    assert.strictEqual(result.deletions, 0);
    assert.strictEqual(result.source, 'working-tree-line-count');

    // Test directory traversal prevention
    const escapedResult = await inspectUntrackedFileLineStats(tmpDir, '../../etc/passwd', {
      fsModule: fs,
    });
    assert.strictEqual(escapedResult.status, 'unavailable');

    console.log('✓ Structured path APIs safely handle spaces, brackets, Unicode, and escape attempts');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Test Group 5: Full Repository Evidence Collection (Untracked, Staged, Modified, Deleted)
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 5: Full Repository Evidence Collection Integration ---');

  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-007-repo-'));

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

    // 1. Initial commit with tracked files
    fs.writeFileSync(path.join(repoDir, 'existing.ts'), 'line 1\nline 2\nline 3\n');
    fs.writeFileSync(path.join(repoDir, 'to-delete.ts'), 'delete line 1\ndelete line 2\n');
    runGit(['add', '.']);
    runGit(['commit', '-m', 'Initial commit']);

    // 2. Modify existing.ts (+2 lines)
    fs.writeFileSync(
      path.join(repoDir, 'existing.ts'),
      'line 1\nline 2\nline 3\nadded line 4\nadded line 5\n',
    );

    // 3. Delete to-delete.ts (-2 lines)
    fs.unlinkSync(path.join(repoDir, 'to-delete.ts'));

    // 4. Staged new file staged-new.ts (+3 lines)
    fs.writeFileSync(path.join(repoDir, 'staged-new.ts'), 'staged 1\nstaged 2\nstaged 3\n');
    runGit(['add', 'staged-new.ts']);

    // 5. Untracked new file untracked-new.ts (+4 lines, no trailing newline)
    fs.writeFileSync(path.join(repoDir, 'untracked-new.ts'), 'u1\nu2\nu3\nu4');

    // 6. Untracked empty file empty.ts
    fs.writeFileSync(path.join(repoDir, 'empty.ts'), '');

    // 7. Untracked binary file image.png
    fs.writeFileSync(path.join(repoDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));

    // Collect repository evidence
    const { run, snapshot } = await collectRepositoryEvidence({
      workspaceId: 'ws-harden-007',
      cwd: repoDir,
      runner: runCollectorProcess,
    });

    assert.strictEqual(run.status, 'completed');
    assert.ok(snapshot, 'Snapshot must be created');
    assert.ok(snapshot.status, 'Git status evidence must be present');
    assert.ok(snapshot.diffSummary, 'Git diff summary evidence must be present');

    const statusFiles = snapshot.status.files;

    // Check Untracked Text File:
    const untrackedFile = statusFiles.find((f) => f.path === 'untracked-new.ts');
    assert.ok(untrackedFile, 'untracked-new.ts must be in status.files');
    assert.strictEqual(untrackedFile.status, 'untracked', 'Canonical status MUST remain untracked');
    assert.strictEqual(untrackedFile.insertions, 4, 'Must derive 4 additions from working-tree line count');
    assert.strictEqual(untrackedFile.deletions, 0, 'Must have 0 deletions');
    assert.strictEqual(untrackedFile.lineStatsSource, 'working-tree-line-count', 'Provenance must be working-tree-line-count');

    // Check Untracked Empty File:
    const emptyFile = statusFiles.find((f) => f.path === 'empty.ts');
    assert.ok(emptyFile, 'empty.ts must be in status.files');
    assert.strictEqual(emptyFile.status, 'untracked');
    assert.strictEqual(emptyFile.insertions, 0, 'Empty file has 0 additions');
    assert.strictEqual(emptyFile.deletions, 0, 'Empty file has 0 deletions');

    // Check Untracked Binary File:
    const binaryFile = statusFiles.find((f) => f.path === 'image.png');
    assert.ok(binaryFile, 'image.png must be in status.files');
    assert.strictEqual(binaryFile.status, 'untracked');
    assert.strictEqual(binaryFile.binary, true, 'Binary must be flagged');
    assert.strictEqual(binaryFile.insertions, undefined, 'Binary must not have line additions');

    // Check Staged Added File:
    const stagedFile = statusFiles.find((f) => f.path === 'staged-new.ts');
    assert.ok(stagedFile, 'staged-new.ts must be in status.files');
    assert.strictEqual(stagedFile.status, 'added', 'Canonical status is added');
    const stagedDiff = snapshot.diffSummary.files.find((f) => f.path === 'staged-new.ts');
    assert.ok(stagedDiff, 'staged-new.ts must be in diffSummary');
    assert.strictEqual(stagedDiff.insertions, 3, 'Git numstat reports 3 insertions');
    assert.strictEqual(stagedDiff.deletions, 0, 'Git numstat reports 0 deletions');
    assert.strictEqual(stagedDiff.source, 'git-numstat', 'Provenance is git-numstat');

    // Check Modified File:
    const modifiedDiff = snapshot.diffSummary.files.find((f) => f.path === 'existing.ts');
    assert.ok(modifiedDiff, 'existing.ts must be in diffSummary');
    assert.strictEqual(modifiedDiff.insertions, 2, 'Git numstat reports 2 insertions');
    assert.strictEqual(modifiedDiff.deletions, 0);

    // Check Deleted File:
    const deletedDiff = snapshot.diffSummary.files.find((f) => f.path === 'to-delete.ts');
    assert.ok(deletedDiff, 'to-delete.ts must be in diffSummary');
    assert.strictEqual(deletedDiff.insertions, 0);
    assert.strictEqual(deletedDiff.deletions, 2, 'Git numstat reports 2 deletions');

    // Check Summary Totals:
    // Git diff metrics: staged (+3) + modified (+2) = 5 additions, 2 deletions
    assert.strictEqual(snapshot.diffSummary.insertions, 5, 'Git diff insertions is 5');
    assert.strictEqual(snapshot.diffSummary.deletions, 2, 'Git diff deletions is 2');
    // Untracked additions: untracked-new.ts (+4) = 4
    assert.strictEqual(snapshot.diffSummary.untrackedInsertions, 4, 'Untracked additions is 4');
    // Total observed additions: 5 + 4 = 9
    assert.strictEqual(snapshot.diffSummary.totalObservedInsertions, 9, 'Total observed additions is 9');

    console.log('✓ Full repository evidence collection correctly balances Git numstat and untracked additions');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Test Group 6: Selection & Prompt Composer Output Format
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 6: Selection & Prompt Composer Output ---');

  // Format untracked file with additions
  const untrackedItem = {
    path: 'app/src/features/monitor/MonitorPane.tsx',
    status: 'untracked',
    insertions: 182,
    deletions: 0,
    lineStatsSource: 'working-tree-line-count',
  };
  const untrackedText = formatRepositoryFileText(untrackedItem);
  assert.strictEqual(untrackedText, '?? app/src/features/monitor/MonitorPane.tsx +182 -0');

  // Format staged added file
  const addedItem = {
    path: 'app/src/features/services/NewService.ts',
    status: 'added',
    insertions: 96,
    deletions: 0,
  };
  const addedText = formatRepositoryFileText(addedItem);
  assert.strictEqual(addedText, 'A app/src/features/services/NewService.ts +96 -0');

  // Format deleted file
  const deletedItem = {
    path: 'app/src/features/old/OldFile.ts',
    status: 'deleted',
    insertions: 0,
    deletions: 121,
  };
  const deletedText = formatRepositoryFileText(deletedItem);
  assert.strictEqual(deletedText, 'D app/src/features/old/OldFile.ts +0 -121');

  // Format binary file
  const binaryItem = {
    path: 'app/src/assets/logo.png',
    status: 'untracked',
    binary: true,
  };
  const binaryText = formatRepositoryFileText(binaryItem);
  assert.strictEqual(binaryText, '?? app/src/assets/logo.png (binary)');

  // Verify selection item construction preserves metadata
  const sel = createRepositoryFileSelectionItem(untrackedItem);
  assert.strictEqual(sel.status, 'untracked');
  assert.strictEqual(sel.insertions, 182);
  assert.strictEqual(sel.deletions, 0);

  console.log('✓ Selection and copy formatting preserves canonical status, line counts, and binary flags');
}

console.log('\n=============================================================');
console.log('ALL HARDEN-007 REPOSITORY EVIDENCE LINE STATS TESTS PASSED!');
console.log('=============================================================\n');
