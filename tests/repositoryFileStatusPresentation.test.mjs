/**
 * HARDEN-006 — Repository Evidence File Status Badges Regression Test Suite
 *
 * Verifies centralized file status presentation mapping, geometry consistency,
 * safe degradation, and preservation of canonical status semantics.
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

function transpileTs(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

const statusPresentationMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/evidenceCollectors/fileStatusPresentation.ts'),
);
const { getRepositoryFileStatusPresentation } = statusPresentationMod;

console.log('Running HARDEN-006 Repository Evidence File Status Badges Tests...\n');

// ---------------------------------------------------------------------------
// Test Group 1: Canonical Semantic Status Mappings
// ---------------------------------------------------------------------------
{
  console.log('--- Test Group 1: Canonical Semantic Status Mappings ---');

  // Modified -> M
  const modified = getRepositoryFileStatusPresentation('modified');
  assert.strictEqual(modified.label, 'M');
  assert.strictEqual(modified.title, 'Modified');
  assert.strictEqual(modified.className, 'file-status-tag--modified');

  // Added -> A
  const added = getRepositoryFileStatusPresentation('added');
  assert.strictEqual(added.label, 'A');
  assert.strictEqual(added.title, 'Added');
  assert.strictEqual(added.className, 'file-status-tag--added');

  // Untracked -> +
  const untracked = getRepositoryFileStatusPresentation('untracked');
  assert.strictEqual(untracked.label, '+');
  assert.strictEqual(untracked.title, 'Untracked / New');
  assert.strictEqual(untracked.className, 'file-status-tag--untracked');

  // Deleted -> D
  const deleted = getRepositoryFileStatusPresentation('deleted');
  assert.strictEqual(deleted.label, 'D');
  assert.strictEqual(deleted.title, 'Deleted');
  assert.strictEqual(deleted.className, 'file-status-tag--deleted');

  // Renamed -> R
  const renamed = getRepositoryFileStatusPresentation('renamed');
  assert.strictEqual(renamed.label, 'R');
  assert.strictEqual(renamed.title, 'Renamed');
  assert.strictEqual(renamed.className, 'file-status-tag--renamed');

  // Conflicted -> !
  const conflicted = getRepositoryFileStatusPresentation('conflicted');
  assert.strictEqual(conflicted.label, '!');
  assert.strictEqual(conflicted.title, 'Conflicted');
  assert.strictEqual(conflicted.className, 'file-status-tag--conflicted');

  // Copied -> C
  const copied = getRepositoryFileStatusPresentation('copied');
  assert.strictEqual(copied.label, 'C');
  assert.strictEqual(copied.title, 'Copied');
  assert.strictEqual(copied.className, 'file-status-tag--copied');

  console.log('✓ Canonical semantic status strings map to single-character badges and titles');
}

// ---------------------------------------------------------------------------
// Test Group 2: Git Porcelain Short Codes & Alternative Formats
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 2: Git Porcelain Short Codes & Alternative Formats ---');

  // 'M'
  const m = getRepositoryFileStatusPresentation('M');
  assert.strictEqual(m.label, 'M');
  assert.strictEqual(m.title, 'Modified');

  // 'A'
  const a = getRepositoryFileStatusPresentation('A');
  assert.strictEqual(a.label, 'A');
  assert.strictEqual(a.title, 'Added');

  // '??' -> '+'
  const qmark = getRepositoryFileStatusPresentation('??');
  assert.strictEqual(qmark.label, '+');
  assert.strictEqual(qmark.title, 'Untracked / New');
  assert.strictEqual(qmark.className, 'file-status-tag--untracked');

  // '?' -> '+'
  const singleQ = getRepositoryFileStatusPresentation('?');
  assert.strictEqual(singleQ.label, '+');
  assert.strictEqual(singleQ.title, 'Untracked / New');

  // '+' -> '+'
  const plus = getRepositoryFileStatusPresentation('+');
  assert.strictEqual(plus.label, '+');
  assert.strictEqual(plus.title, 'Untracked / New');

  // 'new' -> '+'
  const newStatus = getRepositoryFileStatusPresentation('new');
  assert.strictEqual(newStatus.label, '+');
  assert.strictEqual(newStatus.title, 'Untracked / New');

  // 'D'
  const d = getRepositoryFileStatusPresentation('D');
  assert.strictEqual(d.label, 'D');
  assert.strictEqual(d.title, 'Deleted');

  // 'R'
  const r = getRepositoryFileStatusPresentation('R');
  assert.strictEqual(r.label, 'R');
  assert.strictEqual(r.title, 'Renamed');

  // '!'
  const bang = getRepositoryFileStatusPresentation('!');
  assert.strictEqual(bang.label, '!');
  assert.strictEqual(bang.title, 'Conflicted');

  // 'U'
  const u = getRepositoryFileStatusPresentation('U');
  assert.strictEqual(u.label, '!');
  assert.strictEqual(u.title, 'Conflicted');

  // Case-insensitivity ('MODIFIED', 'd', etc.)
  assert.strictEqual(getRepositoryFileStatusPresentation('MODIFIED').label, 'M');
  assert.strictEqual(getRepositoryFileStatusPresentation('d').label, 'D');
  assert.strictEqual(getRepositoryFileStatusPresentation('  UNTRACKED  ').label, '+');

  console.log('✓ Git porcelain short codes (including ?? -> +) and case variations map accurately');
}

// ---------------------------------------------------------------------------
// Test Group 3: Safe Degradation & Non-Crashing Fallbacks
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 3: Safe Degradation & Non-Crashing Fallbacks ---');

  // Undefined
  const undef = getRepositoryFileStatusPresentation(undefined);
  assert.strictEqual(undef.label, '?');
  assert.strictEqual(undef.title, 'Unknown');
  assert.strictEqual(undef.className, 'file-status-tag--unknown');

  // Null
  const nullVal = getRepositoryFileStatusPresentation(null);
  assert.strictEqual(nullVal.label, '?');
  assert.strictEqual(nullVal.title, 'Unknown');

  // Empty string
  const empty = getRepositoryFileStatusPresentation('');
  assert.strictEqual(empty.label, '?');
  assert.strictEqual(empty.title, 'Unknown');

  // Whitespace only
  const ws = getRepositoryFileStatusPresentation('   ');
  assert.strictEqual(ws.label, '?');
  assert.strictEqual(ws.title, 'Unknown');

  // Custom/unrecognized status string
  const custom = getRepositoryFileStatusPresentation('staged');
  assert.strictEqual(custom.label, 'S');
  assert.strictEqual(custom.title, 'Status: staged');
  assert.strictEqual(custom.className, 'file-status-tag--unknown');

  const customLong = getRepositoryFileStatusPresentation('ignored');
  assert.strictEqual(customLong.label, 'I');
  assert.strictEqual(customLong.title, 'Status: ignored');

  console.log('✓ Undefined, null, empty, and arbitrary unknown status strings degrade safely');
}

// ---------------------------------------------------------------------------
// Test Group 4: Canonical Semantics Invariance (No Mutation of Source Data)
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 4: Canonical Semantics Invariance ---');

  const originalFile = Object.freeze({
    path: 'src/features/monitor/MonitorPane.tsx',
    status: 'untracked',
  });

  const presentation = getRepositoryFileStatusPresentation(originalFile.status);

  // Status badge renders '+'
  assert.strictEqual(presentation.label, '+');
  // Canonical status on the source object remains strictly 'untracked'
  assert.strictEqual(originalFile.status, 'untracked');
  assert.notStrictEqual(originalFile.status, 'added', 'Canonical status must NOT be mutated to added');

  console.log('✓ Canonical untracked status remains unmutated; UI presentation is purely derived');
}

// ---------------------------------------------------------------------------
// Test Group 5: Deleted Files & Renames Handling
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 5: Deleted Files & Renames Handling ---');

  const deletedFile = {
    path: 'src/old/deleted-component.ts',
    status: 'deleted',
  };

  const deletedPres = getRepositoryFileStatusPresentation(deletedFile.status);
  assert.strictEqual(deletedPres.label, 'D');
  assert.strictEqual(deletedPres.title, 'Deleted');
  assert.strictEqual(deletedPres.className, 'file-status-tag--deleted');

  // Test selectionModel.formatRepositoryFileText with deleted and untracked files
  const selectionMod = transpileTs(
    path.resolve(__dirname, '../app/src/features/evidenceSelection/selectionModel.ts'),
  );
  const { formatRepositoryFileText } = selectionMod;

  const deletedText = formatRepositoryFileText(deletedFile);
  assert.ok(deletedText.startsWith('D src/old/deleted-component.ts'), 'formatRepositoryFileText formats deleted file');

  const untrackedFile = {
    path: 'src/new-untracked.ts',
    status: 'untracked',
  };
  const untrackedText = formatRepositoryFileText(untrackedFile);
  assert.ok(untrackedText.includes('src/new-untracked.ts'));

  const renamedFile = {
    path: 'src/new-name.ts',
    previousPath: 'src/old-name.ts',
    status: 'renamed',
  };
  const renamedPres = getRepositoryFileStatusPresentation(renamedFile.status);
  assert.strictEqual(renamedPres.label, 'R');
  assert.strictEqual(renamedPres.title, 'Renamed');

  const renamedText = formatRepositoryFileText(renamedFile);
  assert.ok(renamedText.includes('(from src/old-name.ts)'));

  console.log('✓ Deleted and renamed files format safely and retain expected presentation metadata');
}

// ---------------------------------------------------------------------------
// Test Group 6: Centralized Component Wiring & CSS Inspection
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test Group 6: Centralized Component Wiring & CSS Inspection ---');

  const viewTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/evidenceCollectors/RepositoryEvidenceView.tsx'),
    'utf8',
  );

  // Check centralized helper import and call
  assert.ok(
    viewTsx.includes('getRepositoryFileStatusPresentation'),
    'RepositoryEvidenceView imports and calls getRepositoryFileStatusPresentation',
  );
  assert.strictEqual(
    viewTsx.includes("file.status === 'modified' ? 'M' : file.status === 'added'"),
    false,
    'RepositoryEvidenceView no longer has inline chained status ternaries',
  );

  // Check badge JSX properties
  assert.ok(
    viewTsx.includes('statusPresentation.className'),
    'RepositoryEvidenceView applies statusPresentation.className',
  );
  assert.ok(
    viewTsx.includes('statusPresentation.title'),
    'RepositoryEvidenceView sets title/aria-label from statusPresentation.title',
  );
  assert.ok(
    viewTsx.includes('statusPresentation.label'),
    'RepositoryEvidenceView renders statusPresentation.label in badge',
  );

  // Check CSS classes
  const css = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/evidenceCollectors/RepositoryEvidenceView.css'),
    'utf8',
  );

  assert.ok(css.includes('.file-status-tag {'), 'CSS defines .file-status-tag');
  assert.ok(css.includes('width: 18px;'), 'CSS specifies consistent 18px width for badges');
  assert.ok(css.includes('.file-status-tag--modified'), 'CSS defines .file-status-tag--modified');
  assert.ok(css.includes('.file-status-tag--added'), 'CSS defines .file-status-tag--added');
  assert.ok(css.includes('.file-status-tag--untracked'), 'CSS defines .file-status-tag--untracked');
  assert.ok(css.includes('.file-status-tag--deleted'), 'CSS defines .file-status-tag--deleted');
  assert.ok(css.includes('.file-status-tag--renamed'), 'CSS defines .file-status-tag--renamed');
  assert.ok(css.includes('.file-status-tag--conflicted'), 'CSS defines .file-status-tag--conflicted');

  console.log('✓ RepositoryEvidenceView cleanly integrates centralized helper without inline ternaries');
}

console.log('\n=============================================================');
console.log('ALL REPOSITORY FILE STATUS PRESENTATION TESTS PASSED!');
console.log('=============================================================\n');
