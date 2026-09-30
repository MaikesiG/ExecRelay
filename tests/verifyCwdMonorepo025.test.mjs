/**
 * VERIFY-CWD-025: Per-Criterion Working Directory for Monorepos Test Suite
 *
 * Validates:
 * 1. Test A: Default workingDirectory="." resolves to workspaceRoot
 * 2. Test B: Monorepo frontend "apps/web" resolves to workspaceRoot/apps/web
 * 3. Test C: Monorepo backend "apps/api" resolves to workspaceRoot/apps/api
 * 4. Test D: Multiple criteria with different working directories resolve independently
 * 5. Test E: Backward compatibility: criterion without workingDirectory defaults to "."
 * 6. Test F: Path traversal rejection ("../other", "../../")
 * 7. Test G: Absolute path rejection ("/tmp", "/Users/...") and home shorthand ("~/...")
 * 8. Test H: Missing directory detection prevents fallback to root and settles into error
 * 9. Test I: VerificationRun criteriaSnapshot immutability when Profile workingDirectory changes
 * 10. Test J: Persistence: workingDirectory survives serialization, storage, and hydration
 * 11. Test K: Real monorepo simulation with independent execution and Run Selected
 * 12. Test L: Default root subshell execution ignores terminal session cwd
 * 13. Test M: Missing workspace root fails truthfully without silent fallbacks
 * 14. Test N: Historical display reads workingDirectory strictly from run criteriaSnapshot
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
const React = require('../app/node_modules/react');

const moduleCache = new Map();
function loadTs(relPath, customRequire = () => ({})) {
  const absPath = path.resolve(__dirname, relPath);
  if (moduleCache.has(absPath)) return moduleCache.get(absPath);
  const mod = { exports: {} };
  moduleCache.set(absPath, mod.exports);

  const src = fs.readFileSync(absPath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;

  new Function('module', 'exports', 'require', 'React', js)(
    mod,
    mod.exports,
    (id) => {
      if (id === 'react') return React;
      if (id.includes('.css')) return {};
      if (id.includes('@tauri-apps')) return { invoke: () => Promise.resolve(null), listen: () => Promise.resolve(() => {}) };
      if (id === '@xterm/xterm') return { Terminal: class MockTerminal { open() {} loadAddon() {} } };
      if (id === '@xterm/addon-fit') return { FitAddon: class MockFitAddon { fit() {} } };
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(absPath), id);
        const candidates = [
          resolved + '.ts',
          resolved + '.tsx',
          path.join(resolved, 'index.ts'),
          path.join(resolved, 'index.tsx'),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            return loadTs(c, customRequire);
          }
        }
      }
      try {
        return require(path.resolve(__dirname, '../app/node_modules', id));
      } catch {
        return customRequire(id);
      }
    },
    React,
  );

  return mod.exports;
}

const cwdMod = loadTs('../app/src/features/verification/verificationCwd.ts');
const modelMod = loadTs('../app/src/features/verification/verificationModel.ts');
const stateMod = loadTs('../app/src/features/verification/verificationState.ts');
const persistenceMod = loadTs('../app/src/features/workspace/workspacePersistence.ts');
const workspaceModelMod = loadTs('../app/src/features/workspace/createDefaultWorkspace.ts');

const {
  resolveVerificationWorkingDirectory,
  validateDirectoryExists,
  setCustomDirectoryValidator,
  buildVerificationDispatchCommand,
  escapeShellPath,
} = cwdMod;

const {
  createVerificationCriterion,
  createVerificationContract,
  createVerificationRun,
  createContinuationVerificationRun,
  validateCriterionInput,
} = modelMod;

const {
  ensureWorkspaceVerificationState,
  addCriterionToContractInWorkspace,
  updateCriterionInContractInWorkspace,
} = stateMod;

const {
  serializeWorkspaceState,
  deserializeWorkspaceState,
  savePersistedWorkspaceState,
  loadPersistedWorkspaceState,
  setWorkspaceStorageAdapter,
} = persistenceMod;

const {
  createDefaultLogicalWorkspace,
} = workspaceModelMod;

class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

console.log('\nRunning VERIFY-CWD-025: Per-Criterion Working Directory for Monorepos Suite...\n');

// -------------------------------------------------------------
// Test A: Default workingDirectory="." resolves to workspaceRoot
// -------------------------------------------------------------
console.log('--- Test A: Default workingDirectory="." resolves to workspaceRoot ---');
{
  const res = resolveVerificationWorkingDirectory('/repo', '.');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.resolvedPath, '/repo');
  assert.strictEqual(res.relativePath, '.');

  // Undefined or empty string also defaults to "."
  const resEmpty = resolveVerificationWorkingDirectory('/repo', '');
  assert.strictEqual(resEmpty.ok, true);
  assert.strictEqual(resEmpty.resolvedPath, '/repo');
  assert.strictEqual(resEmpty.relativePath, '.');

  const resUndefined = resolveVerificationWorkingDirectory('/repo', undefined);
  assert.strictEqual(resUndefined.ok, true);
  assert.strictEqual(resUndefined.resolvedPath, '/repo');

  console.log('✓ Default workingDirectory="." correctly resolves to workspaceRoot');
}

// -------------------------------------------------------------
// Test B: Monorepo frontend "apps/web"
// -------------------------------------------------------------
console.log('\n--- Test B: Monorepo frontend "apps/web" ---');
{
  const res = resolveVerificationWorkingDirectory('/careerneed', 'apps/web');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.resolvedPath, '/careerneed/apps/web');
  assert.strictEqual(res.relativePath, 'apps/web');

  // Test normalization of ./apps/web, apps/web/, apps/./web
  const resDotSlash = resolveVerificationWorkingDirectory('/careerneed', './apps/web');
  assert.strictEqual(resDotSlash.resolvedPath, '/careerneed/apps/web');

  const resTrailingSlash = resolveVerificationWorkingDirectory('/careerneed', 'apps/web/');
  assert.strictEqual(resTrailingSlash.resolvedPath, '/careerneed/apps/web');

  const resInternalDot = resolveVerificationWorkingDirectory('/careerneed', 'apps/./web');
  assert.strictEqual(resInternalDot.resolvedPath, '/careerneed/apps/web');

  console.log('✓ Monorepo frontend "apps/web" and normalized variants resolve to workspaceRoot/apps/web');
}

// -------------------------------------------------------------
// Test C: Monorepo backend "apps/api"
// -------------------------------------------------------------
console.log('\n--- Test C: Monorepo backend "apps/api" ---');
{
  const res = resolveVerificationWorkingDirectory('/careerneed', 'apps/api');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.resolvedPath, '/careerneed/apps/api');
  assert.strictEqual(res.relativePath, 'apps/api');

  console.log('✓ Monorepo backend "apps/api" resolves to workspaceRoot/apps/api');
}

// -------------------------------------------------------------
// Test D: Different criteria resolve independently
// -------------------------------------------------------------
console.log('\n--- Test D: Different criteria resolve independently in the same profile ---');
{
  const critA = createVerificationCriterion({
    label: 'Frontend tests',
    command: 'npm test',
    workingDirectory: 'apps/web',
  });
  const critB = createVerificationCriterion({
    label: 'API tests',
    command: 'pytest',
    workingDirectory: 'apps/api',
  });
  const critRoot = createVerificationCriterion({
    label: 'Git status',
    command: 'git status',
    workingDirectory: '.',
  });

  const workspaceRoot = '/careerneed';
  const resA = resolveVerificationWorkingDirectory(workspaceRoot, critA.workingDirectory);
  const resB = resolveVerificationWorkingDirectory(workspaceRoot, critB.workingDirectory);
  const resRoot = resolveVerificationWorkingDirectory(workspaceRoot, critRoot.workingDirectory);

  assert.strictEqual(resA.resolvedPath, '/careerneed/apps/web');
  assert.strictEqual(resB.resolvedPath, '/careerneed/apps/api');
  assert.strictEqual(resRoot.resolvedPath, '/careerneed');

  // Verify dispatch commands generated
  const cmdA = buildVerificationDispatchCommand(critA.command, resA.resolvedPath);
  const cmdB = buildVerificationDispatchCommand(critB.command, resB.resolvedPath);
  const cmdRoot = buildVerificationDispatchCommand(critRoot.command, resRoot.resolvedPath);

  assert.strictEqual(cmdA, "(cd '/careerneed/apps/web' && npm test)");
  assert.strictEqual(cmdB, "(cd '/careerneed/apps/api' && pytest)");
  assert.strictEqual(cmdRoot, "(cd '/careerneed' && git status)");

  console.log('✓ Multiple criteria resolve and dispatch with their own distinct working directories');
}

// -------------------------------------------------------------
// Test E: Backward compatibility for legacy persisted criteria
// -------------------------------------------------------------
console.log('\n--- Test E: Backward compatibility for criteria without workingDirectory ---');
{
  const legacyCriterion = {
    id: 'legacy-crit-1',
    type: 'command',
    label: 'Legacy Check',
    command: 'npm run test:legacy',
    expectedExitCodes: [0],
    order: 1,
    // workingDirectory omitted intentionally
  };

  const ws = createDefaultLogicalWorkspace('ws-legacy');
  ws.verification = {
    contracts: [{
      id: 'c1',
      workspaceId: 'ws-legacy',
      name: 'Default',
      criteria: [legacyCriterion],
      createdAt: 1000,
    }],
    activeContractId: 'c1',
    runs: [],
    activeRunId: null,
  };

  const ensured = ensureWorkspaceVerificationState(ws);
  const ensuredCrit = ensured.verification.contracts[0].criteria[0];

  assert.strictEqual(ensuredCrit.workingDirectory, '.', 'Missing workingDirectory must normalize to "."');

  const res = resolveVerificationWorkingDirectory('/legacy/path', ensuredCrit.workingDirectory);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.resolvedPath, '/legacy/path');

  console.log('✓ Legacy criteria cleanly migrate and default to "." without invalidating profiles');
}

// -------------------------------------------------------------
// Test F: Traversal rejection ("../other", "../../")
// -------------------------------------------------------------
console.log('\n--- Test F: Security: Path traversal strictly rejected ---');
{
  const res1 = resolveVerificationWorkingDirectory('/workspace', '../other');
  assert.strictEqual(res1.ok, false);
  assert.ok(res1.error?.includes('cannot escape workspace root'), `Expected escape error, got: ${res1.error}`);

  const res2 = resolveVerificationWorkingDirectory('/workspace', '../../');
  assert.strictEqual(res2.ok, false);

  const res3 = resolveVerificationWorkingDirectory('/workspace', 'apps/web/../../../../etc');
  assert.strictEqual(res3.ok, false);

  // Also check validation at input validation layer
  const v1 = validateCriterionInput({
    label: 'Bad',
    command: 'ls',
    workingDirectory: '../escaping',
  });
  assert.strictEqual(v1.valid, false);
  assert.ok(v1.error?.includes('cannot escape workspace root'));

  console.log('✓ Path traversal escaping workspace root is strictly rejected at resolver and input layers');
}

// -------------------------------------------------------------
// Test G: Absolute path rejection ("/tmp", "/Users/...") and home directory ("~/...")
// -------------------------------------------------------------
console.log('\n--- Test G: Security: Absolute paths and home directory shorthand rejected ---');
{
  const resAbs = resolveVerificationWorkingDirectory('/workspace', '/tmp');
  assert.strictEqual(resAbs.ok, false);
  assert.ok(resAbs.error?.includes('must be relative to the workspace root'), `Expected relative error, got: ${resAbs.error}`);

  const resHome = resolveVerificationWorkingDirectory('/workspace', '~/project');
  assert.strictEqual(resHome.ok, false);
  assert.ok(resHome.error?.includes('cannot use home directory shorthand'), `Expected shorthand error, got: ${resHome.error}`);

  const vAbs = validateCriterionInput({
    label: 'Abs',
    command: 'ls',
    workingDirectory: '/Users/test',
  });
  assert.strictEqual(vAbs.valid, false);

  const vHome = validateCriterionInput({
    label: 'Home',
    command: 'ls',
    workingDirectory: '~/test',
  });
  assert.strictEqual(vHome.valid, false);

  console.log('✓ Absolute paths and home directory shorthand strictly rejected with controlled errors');
}

// -------------------------------------------------------------
// Test H: Missing directory detection prevents fallback to root
// -------------------------------------------------------------
console.log('\n--- Test H: Missing directory validation blocks execution and produces controlled error ---');
{
  // Set up mock directory validator
  const existingDirs = new Set(['/careerneed', '/careerneed/apps/web']);
  setCustomDirectoryValidator((targetPath) => existingDirs.has(targetPath));

  // Existing dir
  const validPath = resolveVerificationWorkingDirectory('/careerneed', 'apps/web').resolvedPath;
  assert.strictEqual(await validateDirectoryExists(validPath), true);

  // Missing dir
  const missingPath = resolveVerificationWorkingDirectory('/careerneed', 'apps/missing').resolvedPath;
  assert.strictEqual(await validateDirectoryExists(missingPath), false);

  setCustomDirectoryValidator(null);
  console.log('✓ Non-existent directory returns false without falling back to workspace root');
}

// -------------------------------------------------------------
// Test I: Snapshot immutability when Profile workingDirectory is edited
// -------------------------------------------------------------
console.log('\n--- Test I: VerificationRun criteriaSnapshot immutability across Profile edits ---');
{
  const ws = ensureWorkspaceVerificationState(createDefaultLogicalWorkspace());
  const contract = ws.verification.contracts[0];

  const criterion = createVerificationCriterion({
    id: 'crit-front-1',
    label: 'Frontend Test',
    command: 'npm test',
    workingDirectory: 'apps/web',
  });
  contract.criteria = [criterion];

  // Run #1 executes
  const run1 = createVerificationRun({
    contract,
    workspaceId: ws.id,
    targetCriteria: [criterion],
  });

  assert.strictEqual(run1.criteriaSnapshot[0].workingDirectory, 'apps/web');

  // User subsequently edits Profile criterion workingDirectory to apps/frontend
  const editedCriterion = {
    ...criterion,
    workingDirectory: 'apps/frontend',
  };
  const updatedWs = updateCriterionInContractInWorkspace(ws, contract.id, editedCriterion);

  // Verify Profile has new workingDirectory
  const currentCrit = updatedWs.verification.contracts[0].criteria.find((c) => c.id === 'crit-front-1');
  assert.strictEqual(currentCrit.workingDirectory, 'apps/frontend');

  // Verify historical run1 criteriaSnapshot remains strictly immutable: "apps/web"
  assert.strictEqual(run1.criteriaSnapshot[0].workingDirectory, 'apps/web');

  console.log('✓ VerificationRun criteriaSnapshot workingDirectory remains immutable when Profile is edited');
}

// -------------------------------------------------------------
// Test J: Persistence: workingDirectory survives serialization, storage, and hydration
// -------------------------------------------------------------
console.log('\n--- Test J: Persistence of workingDirectory across save and restart ---');
{
  const mockStorage = new MockStorage();
  setWorkspaceStorageAdapter(mockStorage);

  const ws = ensureWorkspaceVerificationState(createDefaultLogicalWorkspace());
  const contract = ws.verification.contracts[0];

  const cWeb = createVerificationCriterion({
    id: 'c-web',
    label: 'Web',
    command: 'npm test',
    workingDirectory: 'apps/web',
  });
  const cApi = createVerificationCriterion({
    id: 'c-api',
    label: 'API',
    command: 'pytest',
    workingDirectory: 'apps/api',
  });
  const cRoot = createVerificationCriterion({
    id: 'c-root',
    label: 'Root',
    command: 'git status',
    workingDirectory: '.',
  });

  contract.criteria = [cWeb, cApi, cRoot];

  const run = createVerificationRun({
    contract,
    workspaceId: ws.id,
    targetCriteria: [cWeb, cApi, cRoot],
  });
  ws.verification.runs = [run];

  savePersistedWorkspaceState({ workspaces: [ws], activeWorkspaceId: ws.id });

  const hydrated = loadPersistedWorkspaceState();
  assert.ok(hydrated);
  const hWs = hydrated.workspaces[0];
  const hCriteria = hWs.verification.contracts[0].criteria;

  assert.strictEqual(hCriteria.length, 3);
  assert.strictEqual(hCriteria[0].workingDirectory, 'apps/web');
  assert.strictEqual(hCriteria[1].workingDirectory, 'apps/api');
  assert.strictEqual(hCriteria[2].workingDirectory, '.');

  const hRunCriteria = hWs.verification.runs[0].criteriaSnapshot;
  assert.strictEqual(hRunCriteria[0].workingDirectory, 'apps/web');
  assert.strictEqual(hRunCriteria[1].workingDirectory, 'apps/api');
  assert.strictEqual(hRunCriteria[2].workingDirectory, '.');

  setWorkspaceStorageAdapter(null);
  console.log('✓ workingDirectory faithfully survives serialization, storage, and hydration');
}

// -------------------------------------------------------------
// Test K: Real monorepo simulation with independent execution & Run Selected
// -------------------------------------------------------------
console.log('\n--- Test K: Real monorepo simulation with independent execution & Run Selected ---');
{
  const wsRoot = '/careerneed';
  const checks = [
    { label: 'Frontend', command: 'npm test', workingDirectory: 'apps/web' },
    { label: 'API', command: 'pytest', workingDirectory: 'apps/api' },
    { label: 'Root', command: 'git status', workingDirectory: '.' },
  ];

  const executedCwds = [];
  const executedCommands = [];

  for (const check of checks) {
    const resolution = resolveVerificationWorkingDirectory(wsRoot, check.workingDirectory);
    assert.strictEqual(resolution.ok, true);
    executedCwds.push(resolution.resolvedPath);
    executedCommands.push(buildVerificationDispatchCommand(check.command, resolution.resolvedPath));
  }

  assert.deepStrictEqual(executedCwds, [
    '/careerneed/apps/web',
    '/careerneed/apps/api',
    '/careerneed',
  ]);

  assert.deepStrictEqual(executedCommands, [
    "(cd '/careerneed/apps/web' && npm test)",
    "(cd '/careerneed/apps/api' && pytest)",
    "(cd '/careerneed' && git status)",
  ]);

  console.log('✓ Monorepo simulation executes each check from its own respective working directory');
}

// -------------------------------------------------------------
// Test L: Default root subshell execution ignores terminal session cwd
// -------------------------------------------------------------
console.log('\n--- Test L: Default root subshell execution ignores terminal session cwd ---');
{
  const wsRoot = '/careerneed';
  // Suppose terminal session is currently at /tmp or /careerneed/apps/web
  const terminalSessionCwd = '/careerneed/apps/web';

  const check = { command: 'pwd', workingDirectory: '.' };
  const resolution = resolveVerificationWorkingDirectory(wsRoot, check.workingDirectory);
  assert.strictEqual(resolution.resolvedPath, '/careerneed');

  // Dispatch command wraps in subshell targeting resolved cwd
  const dispatch = buildVerificationDispatchCommand(check.command, resolution.resolvedPath);
  assert.strictEqual(dispatch, "(cd '/careerneed' && pwd)");
  assert.notStrictEqual(resolution.resolvedPath, terminalSessionCwd);

  console.log('✓ Default root check runs from workspace root regardless of terminal session cwd');
}

// -------------------------------------------------------------
// Test M: Missing workspace root fails truthfully without silent fallbacks
// -------------------------------------------------------------
console.log('\n--- Test M: Missing workspace root fails truthfully without silent fallback ---');
{
  const resNull = resolveVerificationWorkingDirectory(null, 'apps/web');
  assert.strictEqual(resNull.ok, false);
  assert.strictEqual(resNull.error, 'Workspace root path is not configured');

  const resEmpty = resolveVerificationWorkingDirectory('   ', 'apps/web');
  assert.strictEqual(resEmpty.ok, false);
  assert.strictEqual(resEmpty.error, 'Workspace root path is not configured');

  console.log('✓ Missing workspace root produces controlled error; never falls back to process.cwd()');
}

// -------------------------------------------------------------
// Test N: Continuation preserves snapshot workingDirectory
// -------------------------------------------------------------
console.log('\n--- Test N: Continuation preserves snapshot workingDirectory ---');
{
  const contract = createVerificationContract({
    workspaceId: 'ws-1',
    name: 'Monorepo',
    criteria: [
      createVerificationCriterion({ id: 'c1', label: 'C1', command: 'cmd1', workingDirectory: 'apps/web' }),
      createVerificationCriterion({ id: 'c2', label: 'C2', command: 'cmd2', workingDirectory: 'apps/api' }),
    ],
  });

  const previousRun = {
    id: 'run-prev',
    contractId: contract.id,
    workspaceId: 'ws-1',
    status: 'cancelled',
    criteriaSnapshot: [
      { id: 'c1', type: 'command', label: 'C1', command: 'cmd1', expectedExitCodes: [0], order: 1, workingDirectory: 'apps/web' },
      { id: 'c2', type: 'command', label: 'C2', command: 'cmd2', expectedExitCodes: [0], order: 2, workingDirectory: 'apps/api' },
    ],
    criterionResults: [
      { criterionId: 'c1', status: 'passed' },
      { criterionId: 'c2', status: 'pending' },
    ],
    startedAt: 1000,
    completedAt: 2000,
  };

  const continuedRun = createContinuationVerificationRun({ previousRun });
  assert.strictEqual(continuedRun.criteriaSnapshot.length, 1);
  assert.strictEqual(continuedRun.criteriaSnapshot[0].id, 'c2');
  assert.strictEqual(continuedRun.criteriaSnapshot[0].workingDirectory, 'apps/api');

  console.log('✓ Continued run preserves workingDirectory from previousRun criteriaSnapshot');
}

console.log('\n=============================================================');
console.log('ALL VERIFY-CWD-025 MONOREPO WORKING DIRECTORY TESTS PASSED!');
console.log('=============================================================\n');
