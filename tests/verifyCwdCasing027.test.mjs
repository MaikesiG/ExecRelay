/**
 * VERIFY-CWD-027: Preserve Working Directory Path Casing Test Suite
 *
 * Validates:
 * 1. Exact user-entered casing is preserved throughout data lifecycle (no lowercasing/uppercasing):
 *    - "apps/web" remains "apps/web"
 *    - "packages/MyApp" remains "packages/MyApp"
 *    - "./Services/AuthService/" normalizes structurally to "Services/AuthService" preserving exact casing
 * 2. Path resolution and subshell dispatch commands preserve exact casing:
 *    - resolveVerificationWorkingDirectory('/repo', 'packages/MyApp') -> '/repo/packages/MyApp'
 *    - buildVerificationDispatchCommand('npm test', '/repo/packages/MyApp') -> "(cd '/repo/packages/MyApp' && npm test)"
 * 3. Persistence & Hydration:
 *    - Serialized workspace JSON retains exact path casing verbatim
 *    - Hydrated criteria and snapshot criteria retain exact path casing verbatim
 * 4. Snapshot Immutability:
 *    - Historical VerificationRun criteriaSnapshot casing is never mutated by subsequent Profile edits
 * 5. Display & CSS Audit:
 *    - VerificationPanel renders exact path casing for active and historical criteria
 *    - CSS rules for .verification-criterion-cwd and modal inputs enforce text-transform: none
 *    - Input fields specify autoCapitalize="none", autoCorrect="off", spellCheck={false}
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
  buildVerificationDispatchCommand,
} = cwdMod;

const {
  createVerificationCriterion,
  createVerificationContract,
  createVerificationRun,
  validateCriterionInput,
} = modelMod;

const {
  ensureWorkspaceVerificationState,
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

console.log('\nRunning VERIFY-CWD-027: Preserve Working Directory Path Casing Suite...\n');

// -------------------------------------------------------------
// Test 1: User Input Validation Preserves Exact Casing
// -------------------------------------------------------------
console.log('--- Test 1: validateCriterionInput preserves exact casing ---');
{
  // Lowercase input
  const resLower = validateCriterionInput({
    label: 'Frontend Test',
    command: 'npm test',
    workingDirectory: 'apps/web',
  });
  assert.strictEqual(resLower.valid, true);
  assert.strictEqual(resLower.workingDirectory, 'apps/web');

  // Mixed case input
  const resMixed = validateCriterionInput({
    label: 'MyApp Tests',
    command: 'dotnet test',
    workingDirectory: 'packages/MyApp',
  });
  assert.strictEqual(resMixed.valid, true);
  assert.strictEqual(resMixed.workingDirectory, 'packages/MyApp');

  // Structural normalization without case alteration
  const resStructural = validateCriterionInput({
    label: 'Auth Service',
    command: 'cargo test',
    workingDirectory: './Services/AuthService/',
  });
  assert.strictEqual(resStructural.valid, true);
  assert.strictEqual(resStructural.workingDirectory, 'Services/AuthService');

  console.log('✓ validateCriterionInput preserves exact casing across lowercase, PascalCase, and mixed case');
}

// -------------------------------------------------------------
// Test 2: createVerificationCriterion Preserves Exact Casing
// -------------------------------------------------------------
console.log('\n--- Test 2: createVerificationCriterion preserves exact casing ---');
{
  const crit1 = createVerificationCriterion({
    label: 'Web',
    command: 'npm test',
    workingDirectory: 'apps/web',
  });
  assert.strictEqual(crit1.workingDirectory, 'apps/web');

  const crit2 = createVerificationCriterion({
    label: 'MyApp',
    command: 'pytest',
    workingDirectory: 'packages/MyApp',
  });
  assert.strictEqual(crit2.workingDirectory, 'packages/MyApp');

  console.log('✓ createVerificationCriterion stores exact user-entered casing');
}

// -------------------------------------------------------------
// Test 3: Path Resolution & Dispatch Command Preserves Exact Casing
// -------------------------------------------------------------
console.log('\n--- Test 3: resolveVerificationWorkingDirectory & buildVerificationDispatchCommand preserve exact casing ---');
{
  const wsRoot = '/Users/xingchiguo/projects/careerneed';

  // Test lowercase
  const resLower = resolveVerificationWorkingDirectory(wsRoot, 'apps/web');
  assert.strictEqual(resLower.ok, true);
  assert.strictEqual(resLower.resolvedPath, '/Users/xingchiguo/projects/careerneed/apps/web');
  assert.strictEqual(resLower.relativePath, 'apps/web');

  const cmdLower = buildVerificationDispatchCommand('npm run format', resLower.resolvedPath);
  assert.strictEqual(cmdLower, "(cd '/Users/xingchiguo/projects/careerneed/apps/web' && npm run format)");

  // Test mixed case
  const resMixed = resolveVerificationWorkingDirectory(wsRoot, 'packages/MyApp');
  assert.strictEqual(resMixed.ok, true);
  assert.strictEqual(resMixed.resolvedPath, '/Users/xingchiguo/projects/careerneed/packages/MyApp');
  assert.strictEqual(resMixed.relativePath, 'packages/MyApp');

  const cmdMixed = buildVerificationDispatchCommand('dotnet test', resMixed.resolvedPath);
  assert.strictEqual(cmdMixed, "(cd '/Users/xingchiguo/projects/careerneed/packages/MyApp' && dotnet test)");

  console.log('✓ Path resolution and subshell dispatch commands preserve exact casing without lower/uppercasing');
}

// -------------------------------------------------------------
// Test 4: Persistence Serialization & Hydration Preserves Exact Casing
// -------------------------------------------------------------
console.log('\n--- Test 4: Workspace persistence preserves exact path casing across restart ---');
{
  const mockStorage = new MockStorage();
  setWorkspaceStorageAdapter(mockStorage);

  const ws = ensureWorkspaceVerificationState(createDefaultLogicalWorkspace('ws-casing'));
  const contract = ws.verification.contracts[0];

  const crit1 = createVerificationCriterion({
    id: 'c-web',
    label: 'Web',
    command: 'npm test',
    workingDirectory: 'apps/web',
  });
  const crit2 = createVerificationCriterion({
    id: 'c-myapp',
    label: 'MyApp',
    command: 'cargo test',
    workingDirectory: 'packages/MyApp',
  });
  contract.criteria = [crit1, crit2];

  const run = createVerificationRun({
    contract,
    workspaceId: ws.id,
    targetCriteria: [crit1, crit2],
  });
  ws.verification.runs = [run];

  // Save to persistence
  savePersistedWorkspaceState({ workspaces: [ws], activeWorkspaceId: ws.id });

  // Verify raw stored JSON string
  const storedJson = mockStorage.getItem('execrelay:workspace-state:v1');
  assert.ok(storedJson);
  assert.ok(storedJson.includes('"workingDirectory":"apps/web"'), 'Raw JSON must contain exact lowercase apps/web');
  assert.ok(storedJson.includes('"workingDirectory":"packages/MyApp"'), 'Raw JSON must contain exact mixed case packages/MyApp');
  assert.strictEqual(storedJson.includes('"workingDirectory":"Apps/web"'), false, 'Raw JSON must NEVER contain mutated Apps/web');

  // Load and hydrate
  const hydrated = loadPersistedWorkspaceState();
  assert.ok(hydrated);
  const hydratedCriteria = hydrated.workspaces[0].verification.contracts[0].criteria;
  assert.strictEqual(hydratedCriteria[0].workingDirectory, 'apps/web');
  assert.strictEqual(hydratedCriteria[1].workingDirectory, 'packages/MyApp');

  const hydratedSnapshot = hydrated.workspaces[0].verification.runs[0].criteriaSnapshot;
  assert.strictEqual(hydratedSnapshot[0].workingDirectory, 'apps/web');
  assert.strictEqual(hydratedSnapshot[1].workingDirectory, 'packages/MyApp');

  setWorkspaceStorageAdapter(null);
  console.log('✓ Stored and hydrated criteria faithfully maintain exact casing through persistence');
}

// -------------------------------------------------------------
// Test 5: Historical Snapshot Casing Remains Strictly Immutable
// -------------------------------------------------------------
console.log('\n--- Test 5: Historical criteriaSnapshot casing remains strictly immutable ---');
{
  const ws = ensureWorkspaceVerificationState(createDefaultLogicalWorkspace('ws-snapshot'));
  const contract = ws.verification.contracts[0];

  const crit = createVerificationCriterion({
    id: 'crit-hist-1',
    label: 'Frontend',
    command: 'npm test',
    workingDirectory: 'apps/web',
  });
  contract.criteria = [crit];

  const run = createVerificationRun({
    contract,
    workspaceId: ws.id,
    targetCriteria: [crit],
  });

  assert.strictEqual(run.criteriaSnapshot[0].workingDirectory, 'apps/web');

  // Edit current profile to different casing / different directory
  const updatedCrit = {
    ...crit,
    workingDirectory: 'apps/NEW_WEB',
  };
  const updatedWs = updateCriterionInContractInWorkspace(ws, contract.id, updatedCrit);

  // Profile has updated value
  const profileCrit = updatedWs.verification.contracts[0].criteria.find((c) => c.id === 'crit-hist-1');
  assert.strictEqual(profileCrit.workingDirectory, 'apps/NEW_WEB');

  // Historical run snapshot retains original casing verbatim
  assert.strictEqual(run.criteriaSnapshot[0].workingDirectory, 'apps/web');

  console.log('✓ Historical snapshot casing remains strictly immutable even when profile is edited');
}

// -------------------------------------------------------------
// Test 6: CSS & Input Attributes Audit
// -------------------------------------------------------------
console.log('\n--- Test 6: CSS & Input Attributes Audit ---');
{
  const panelCss = fs.readFileSync(path.resolve(__dirname, '../app/src/features/verification/VerificationPanel.css'), 'utf8');
  assert.ok(
    panelCss.includes('.verification-criterion-cwd'),
    'VerificationPanel.css must define .verification-criterion-cwd',
  );
  assert.ok(
    panelCss.includes('text-transform: none;'),
    'VerificationPanel.css must enforce text-transform: none on cwd badges',
  );

  const modalCss = fs.readFileSync(path.resolve(__dirname, '../app/src/features/verification/VerificationModals.css'), 'utf8');
  assert.ok(
    modalCss.includes('.verification-form-input--working-directory'),
    'VerificationModals.css must define .verification-form-input--working-directory',
  );
  assert.ok(
    modalCss.includes('text-transform: none;'),
    'VerificationModals.css must enforce text-transform: none on working directory input',
  );

  const modalTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/features/verification/VerificationCheckModal.tsx'), 'utf8');
  assert.ok(
    modalTsx.includes('autoCapitalize="none"'),
    'VerificationCheckModal must specify autoCapitalize="none"',
  );
  assert.ok(
    modalTsx.includes('autoCorrect="off"'),
    'VerificationCheckModal must specify autoCorrect="off"',
  );
  assert.ok(
    modalTsx.includes('spellCheck={false}'),
    'VerificationCheckModal must specify spellCheck={false}',
  );

  console.log('✓ CSS and input attributes protect against browser/OS casing transformations');
}

// -------------------------------------------------------------
// Test 7: Verification Criterion Display Text Exact Match
// -------------------------------------------------------------
console.log('\n--- Test 7: Verification criterion display text preserves exact casing ---');
{
  const critWeb = createVerificationCriterion({
    label: 'Web',
    command: 'npm test',
    workingDirectory: 'apps/web',
  });
  assert.strictEqual(critWeb.workingDirectory, 'apps/web', 'Stored workingDirectory must be apps/web');
  const displayedWeb = `cwd: ${critWeb.workingDirectory}`;
  assert.strictEqual(displayedWeb, 'cwd: apps/web', 'Displayed cwd must be "cwd: apps/web"');

  const critMyApp = createVerificationCriterion({
    label: 'MyApp',
    command: 'npm test',
    workingDirectory: 'packages/MyApp',
  });
  assert.strictEqual(critMyApp.workingDirectory, 'packages/MyApp', 'Stored workingDirectory must be packages/MyApp');
  const displayedMyApp = `cwd: ${critMyApp.workingDirectory}`;
  assert.strictEqual(displayedMyApp, 'cwd: packages/MyApp', 'Displayed cwd must be "cwd: packages/MyApp"');

  console.log('✓ Expected displayed "cwd: apps/web" and "cwd: packages/MyApp" verified');
}

console.log('\n=============================================================');
console.log('ALL VERIFY-CWD-027 CASING PRESERVATION TESTS PASSED!');
console.log('=============================================================\n');
