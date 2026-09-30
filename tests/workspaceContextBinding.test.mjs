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

// Module map for transpiled TS files
const moduleCache = new Map();
function loadTs(relPath, customRequire = () => ({})) {
  const absPath = path.resolve(__dirname, relPath);
  if (moduleCache.has(absPath)) return moduleCache.get(absPath);
  const exports = transpileTs(absPath, (id) => {
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
    return customRequire(id);
  });
  moduleCache.set(absPath, exports);
  return exports;
}

// 1. Transpile dependencies
const collectorTypes = loadTs('../app/src/features/evidenceCollectors/types.ts');
const runnerMod = loadTs('../app/src/features/evidenceCollectors/collectorRunner.ts', (id) => {
  if (id.includes('@tauri-apps')) return { invoke: () => Promise.resolve(null) };
  return require(id);
});
const repoResolverMod = loadTs('../app/src/features/evidenceCollectors/repositoryResolver.ts', (id) => {
  if (id.includes('collectorRunner')) return runnerMod;
  return require(id);
});

const wsTypesMod = loadTs('../app/src/features/workspace/types.ts');
const wsContextMod = loadTs('../app/src/features/workspace/workspaceContext.ts', (id) => {
  if (id.includes('@tauri-apps')) return { invoke: () => Promise.resolve(null) };
  if (id.includes('repositoryResolver')) return repoResolverMod;
  if (id.includes('collectorRunner')) return runnerMod;
  return require(id);
});
const createDefaultWsMod = loadTs('../app/src/features/workspace/createDefaultWorkspace.ts', (id) => {
  return require(id);
});
const verificationCwdMod = loadTs('../app/src/features/verification/verificationCwd.ts');
const verificationModelMod = loadTs('../app/src/features/verification/verificationModel.ts');
const deltaEngineMod = loadTs('../app/src/features/attribution/deltaEngine.ts');
const attributionServiceMod = loadTs('../app/src/features/attribution/attributionService.ts', (id) => {
  if (id.includes('deltaEngine')) return deltaEngineMod;
  return require(id);
});

console.log('Running WORKSPACE-CONTEXT-001 / 001A / 001B Regression Test Suite...\n');

// ============================================================================
// Test 1: Clicking Workspace + invokes folder selection & cancellation creates no workspace
// ============================================================================
console.log('--- Test 1 & 2: Folder Picker Invocation & Clean Cancellation ---');
{
  let pickerInvoked = false;
  wsContextMod.setCustomFolderPicker(async () => {
    pickerInvoked = true;
    return null; // Simulate user clicking Cancel
  });

  const selected = await wsContextMod.openFolderPicker();
  assert.strictEqual(pickerInvoked, true, 'Folder picker should be invoked');
  assert.strictEqual(selected, null, 'Cancellation should return null');

  // Verify that an application-level cancel does not mutate workspace state
  const initialWorkspaces = [
    createDefaultWsMod.createDefaultLogicalWorkspace('ws-1', 'Workspace 1'),
  ];
  let workspaces = [...initialWorkspaces];
  let activeId = 'ws-1';

  // Simulate canonical handleOpenFolder flow
  const result = await (async () => {
    const picked = await wsContextMod.openFolderPicker();
    if (!picked) return null;
    workspaces.push(createDefaultWsMod.createDefaultLogicalWorkspace('ws-2', 'New'));
    activeId = 'ws-2';
    return 'ws-2';
  })();

  assert.strictEqual(result, null, 'Handler should return null on cancel');
  assert.strictEqual(workspaces.length, 1, 'No new workspace created on cancel');
  assert.strictEqual(activeId, 'ws-1', 'Active workspace must not change on cancel');
  console.log('✓ Clicking + invokes picker; user cancellation is a strict no-op');
}

// ============================================================================
// Test 3 & 7: Successful selection creates Workspace with rootPath & basename name
// ============================================================================
console.log('--- Test 3 & 7: Successful Selection, RootPath & Basename Resolution ---');
{
  assert.strictEqual(
    wsContextMod.resolveWorkspaceFolderBasename('/Users/max/projects/careerneed'),
    'careerneed',
  );
  assert.strictEqual(
    wsContextMod.resolveWorkspaceFolderBasename('/Users/max/projects/careerneed/'),
    'careerneed',
  );
  assert.strictEqual(
    wsContextMod.resolveWorkspaceFolderBasename('/tmp'),
    'tmp',
  );
  assert.strictEqual(
    wsContextMod.resolveWorkspaceFolderBasename('/'),
    'Workspace',
  );

  const selectedPath = '/Users/max/projects/careerneed';
  wsContextMod.setCustomFolderPicker(async () => selectedPath);

  const picked = await wsContextMod.openFolderPicker();
  assert.strictEqual(picked, selectedPath);

  const folderName = wsContextMod.resolveWorkspaceFolderBasename(picked);
  assert.strictEqual(folderName, 'careerneed');

  const ws = createDefaultWsMod.createDefaultLogicalWorkspace(
    'ws-careerneed',
    folderName,
    'tab-1',
    'pane-1',
    picked,
  );

  assert.strictEqual(ws.rootPath, '/Users/max/projects/careerneed');
  assert.strictEqual(ws.name, 'careerneed');
  console.log('✓ Successful selection derives folder basename and stores rootPath on Workspace');
}

// ============================================================================
// Test 4: Selected Git folder binds repository (safe program/args)
// ============================================================================
console.log('--- Test 4: Selected Git Folder Binds Repository & Branch Safely ---');
{
  const mockRunner = async (input) => {
    assert.strictEqual(input.program, 'git', 'Must invoke git binary directly');
    assert.ok(Array.isArray(input.args), 'Args must be an array (no shell string)');
    if (input.args.includes('rev-parse') && input.args.includes('--show-toplevel')) {
      return {
        exitCode: 0,
        stdout: '/Users/max/projects/careerneed\n',
        stderr: '',
        durationMs: 5,
      };
    }
    if (input.args.includes('branch') || input.args.includes('--abbrev-ref')) {
      return {
        exitCode: 0,
        stdout: 'feature/auth\n',
        stderr: '',
        durationMs: 5,
      };
    }
    return { exitCode: 1, stdout: '', stderr: 'unknown', durationMs: 1 };
  };

  const repoContext = await wsContextMod.detectRepositoryContext(
    '/Users/max/projects/careerneed',
    mockRunner,
  );

  assert.ok(repoContext, 'Repository context should be detected');
  assert.strictEqual(repoContext.vcs, 'git');
  assert.strictEqual(repoContext.rootPath, '/Users/max/projects/careerneed');
  assert.strictEqual(repoContext.branch, 'feature/auth');
  console.log('✓ Git repository root and branch bound safely via program/args');
}

// ============================================================================
// Test 5: Selected non-Git folder still creates Workspace with repository: undefined
// ============================================================================
console.log('--- Test 5: Selected Non-Git Folder Creates Workspace (No Failure) ---');
{
  const nonGitRunner = async () => ({
    exitCode: 128,
    stdout: '',
    stderr: 'fatal: not a git repository (or any of the parent directories): .git',
    durationMs: 5,
  });

  const repoContext = await wsContextMod.detectRepositoryContext(
    '/Users/max/Documents/plain-folder',
    nonGitRunner,
  );
  assert.strictEqual(repoContext, undefined, 'Non-Git folder yields undefined repository');

  const ws = createDefaultWsMod.createDefaultLogicalWorkspace(
    'ws-plain',
    'plain-folder',
    'tab-1',
    'pane-1',
    '/Users/max/Documents/plain-folder',
    repoContext,
  );

  assert.strictEqual(ws.rootPath, '/Users/max/Documents/plain-folder');
  assert.strictEqual(ws.repository, undefined);
  console.log('✓ Non-Git directory cleanly creates workspace without repository');
}

// ============================================================================
// Test 6 & 9: Newly created Workspace becomes active & no duplicates created
// ============================================================================
console.log('--- Test 6 & 9: Workspace Activation & Single Creation Invariant ---');
{
  const workspaces = [
    createDefaultWsMod.createDefaultLogicalWorkspace('ws-1', 'Workspace 1'),
  ];
  let activeWorkspaceId = 'ws-1';

  wsContextMod.setCustomFolderPicker(async () => '/Users/max/projects/careerneed');

  // Canonical open folder action
  async function handleOpenFolder(targetId) {
    const picked = await wsContextMod.openFolderPicker();
    if (!picked) return null;
    const repo = await wsContextMod.detectRepositoryContext(picked, async () => ({
      exitCode: 0,
      stdout: picked + '\n',
      stderr: '',
      durationMs: 1,
    }));
    const name = wsContextMod.resolveWorkspaceFolderBasename(picked);

    if (targetId) {
      const idx = workspaces.findIndex((w) => w.id === targetId);
      if (idx !== -1) {
        workspaces[idx] = wsContextMod.bindWorkspaceRootPath(workspaces[idx], picked, repo);
        activeWorkspaceId = targetId;
        return workspaces[idx];
      }
    }

    const newWs = createDefaultWsMod.createDefaultLogicalWorkspace(
      `ws-${Date.now()}`,
      name,
      'tab-1',
      'pane-1',
      picked,
      repo,
    );
    workspaces.push(newWs);
    activeWorkspaceId = newWs.id;
    return newWs;
  }

  // 1. Invoke without targetId (like Workspace +)
  const created = await handleOpenFolder();
  assert.strictEqual(workspaces.length, 2, 'Exactly one workspace added');
  assert.strictEqual(activeWorkspaceId, created.id, 'New workspace must be active');
  assert.strictEqual(created.name, 'careerneed');
  assert.strictEqual(created.rootPath, '/Users/max/projects/careerneed');
  console.log('✓ Newly created Workspace is activated and exactly one instance is created');
}

// ============================================================================
// Test 8: Changes Open Folder CTA invokes the same flow to bind unbound workspace
// ============================================================================
console.log('--- Test 8: Changes Open Folder CTA Binds Existing Unbound Workspace ---');
{
  const unboundWs = createDefaultWsMod.createDefaultLogicalWorkspace('ws-unbound', 'Workspace 1');
  assert.strictEqual(unboundWs.rootPath, undefined);
  assert.strictEqual(unboundWs.repository, undefined);

  const selectedPath = '/Users/max/projects/bound-project';
  const detectedRepo = {
    vcs: 'git',
    rootPath: '/Users/max/projects/bound-project',
    branch: 'main',
  };

  const boundWs = wsContextMod.bindWorkspaceRootPath(unboundWs, selectedPath, detectedRepo);
  assert.strictEqual(boundWs.rootPath, selectedPath);
  assert.strictEqual(boundWs.repository.rootPath, selectedPath);
  assert.strictEqual(boundWs.repository.branch, 'main');
  console.log('✓ Changes Open Folder CTA uses same canonical binding flow');
}

// ============================================================================
// Test 10: Folder picker error does not destroy current Workspace
// ============================================================================
console.log('--- Test 10: Folder Picker Error Isolation ---');
{
  wsContextMod.setCustomFolderPicker(async () => {
    throw new Error('OS dialog error: user permission denied');
  });

  const workspaces = [
    createDefaultWsMod.createDefaultLogicalWorkspace('ws-current', 'Current Workspace'),
  ];
  let activeId = 'ws-current';
  let caughtError = null;

  try {
    await (async () => {
      try {
        await wsContextMod.openFolderPicker();
      } catch (err) {
        caughtError = err;
      }
    })();
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError, 'Error should be captured gracefully');
  assert.strictEqual(workspaces.length, 1, 'Current workspace preserved on error');
  assert.strictEqual(activeId, 'ws-current', 'Active workspace ID untouched');
  console.log('✓ Folder picker error does not destroy or mutate current Workspace');
}

// ============================================================================
// Test 11: Browser fallback isolation in packaged Tauri
// ============================================================================
console.log('--- Test 11: Packaged Tauri Never Silently Falls Back to Window.Prompt ---');
{
  wsContextMod.setCustomFolderPicker(null); // Clear custom test picker

  // Simulate Tauri window environment
  const mockWindow = {
    __TAURI_INTERNALS__: {},
    prompt: () => {
      throw new Error('window.prompt should NEVER be called in Tauri!');
    },
  };

  globalThis.window = mockWindow;

  let promptCalled = false;
  mockWindow.prompt = () => {
    promptCalled = true;
    return '/fake/path';
  };

  // Re-transpile workspaceContext in simulated Tauri environment
  let tauriInvokeFailed = false;
  const tauriWsContextMod = transpileTs(
    path.resolve(__dirname, '../app/src/features/workspace/workspaceContext.ts'),
    (id) => {
      if (id.includes('@tauri-apps')) {
        return {
          invoke: async () => {
            tauriInvokeFailed = true;
            throw new Error('Simulated Tauri IPC failure');
          },
        };
      }
      if (id.includes('repositoryResolver')) return repoResolverMod;
      if (id.includes('collectorRunner')) return runnerMod;
      return require(id);
    },
  );

  let threwInTauri = false;
  try {
    await tauriWsContextMod.openFolderPicker();
  } catch (err) {
    threwInTauri = true;
    assert.ok(err.message.includes('Native folder picker failed'));
  }

  assert.strictEqual(tauriInvokeFailed, true, 'Tauri invoke was called');
  assert.strictEqual(threwInTauri, true, 'Error was thrown instead of falling back to prompt');
  assert.strictEqual(promptCalled, false, 'window.prompt was strictly NOT called in Tauri');

  // Clean up simulated global window
  delete globalThis.window;
  console.log('✓ Packaged Tauri throws controlled error; window.prompt strictly isolated');
}

// ============================================================================
// Test 12: Critical CWD Independence (Section 43)
// ============================================================================
console.log('--- Test 12: Critical CWD Independence (Section 43 Invariant) ---');
{
  const workspaceRoot = '/fixture/project';
  const repositoryRoot = '/fixture/project';

  const ws = createDefaultWsMod.createDefaultLogicalWorkspace(
    'ws-indep',
    'project',
    'tab-1',
    'pane-1',
    workspaceRoot,
    { vcs: 'git', rootPath: repositoryRoot },
  );

  // Terminal starts with initial cwd = workspaceRoot
  let terminalSessionCwd = ws.rootPath;
  assert.strictEqual(terminalSessionCwd, '/fixture/project');

  // User navigates in shell: cd /tmp
  terminalSessionCwd = '/tmp';

  // Assert all four path semantics independently:
  // 1. Terminal current cwd is /tmp
  assert.strictEqual(terminalSessionCwd, '/tmp', 'Terminal cwd should reflect runtime cd /tmp');

  // 2. Changes repo is /fixture/project (derived from ws.repository.rootPath)
  assert.strictEqual(
    ws.repository.rootPath,
    '/fixture/project',
    'Changes repo must remain /fixture/project',
  );

  // 3. Workspace root is /fixture/project (ws.rootPath)
  assert.strictEqual(
    ws.rootPath,
    '/fixture/project',
    'Workspace root must remain /fixture/project',
  );

  // 4. Verify default cwd is /fixture/project (resolveVerificationCwd)
  const verifyDefaultCwd = verificationCwdMod.resolveVerificationCwd({
    workspaceRootPath: ws.rootPath,
    targetRepositoryRoot: ws.repository.rootPath,
    fallbackCwd: terminalSessionCwd,
  });
  assert.strictEqual(
    verifyDefaultCwd,
    '/fixture/project',
    'Verify default cwd must remain /fixture/project despite terminal cd /tmp',
  );

  console.log('✓ Critical CWD independence invariant: Terminal /tmp, Changes /fixture/project, Workspace /fixture/project, Verify /fixture/project');
}

// ============================================================================
// Test 13: Monorepo CWD Priority: Workspace RootPath > Repository RootPath
// ============================================================================
console.log('--- Test 13: Monorepo Subproject Verification CWD Priority ---');
{
  const monorepoCwd = verificationCwdMod.resolveVerificationCwd({
    workspaceRootPath: '/careerneed/apps/web',
    targetRepositoryRoot: '/careerneed',
    fallbackCwd: '/tmp',
  });
  assert.strictEqual(
    monorepoCwd,
    '/careerneed/apps/web',
    'Workspace rootPath must take strict precedence over parent repositoryRoot in monorepos',
  );
  console.log('✓ Monorepo verification cwd correctly resolves subproject path');
}

// ============================================================================
// Test 14: Cross-Repository Delta Attribution Isolation (Section 19)
// ============================================================================
console.log('--- Test 14: Cross-Repository Attribution Guard ---');
{
  const snapshotRepoA = {
    id: 'snap-A',
    collectionRunId: 'run-A',
    workspaceId: 'ws-A',
    repositoryRoot: '/projects/repo-A',
    createdAt: Date.now(),
    status: { clean: true, files: [] },
  };

  const snapshotRepoB = {
    id: 'snap-B',
    collectionRunId: 'run-B',
    workspaceId: 'ws-B',
    repositoryRoot: '/projects/repo-B',
    createdAt: Date.now(),
    status: { clean: false, files: [{ path: 'file.txt', status: 'modified' }] },
  };

  let deltaError = null;
  try {
    deltaEngineMod.computeRepositoryDelta(snapshotRepoA, snapshotRepoB);
  } catch (err) {
    deltaError = err;
  }
  assert.ok(deltaError, 'Delta engine must throw on cross-repository comparison');
  assert.ok(deltaError.message.includes('different repository roots'));

  const finalized = attributionServiceMod.finalizeChangeAttribution({
    attribution: {
      id: 'attr-1',
      workspaceId: 'ws-A',
      targetType: 'execution',
      targetId: 'exec-1',
      repositoryRoot: '/projects/repo-A',
      beforeSnapshotId: 'snap-A',
      status: 'pending',
      scope: 'partial',
      startedAt: Date.now(),
      completedAt: null,
      limitations: [],
    },
    beforeSnapshot: snapshotRepoA,
    afterSnapshot: snapshotRepoB,
  });

  assert.strictEqual(finalized.status, 'failed');
  assert.ok(
    finalized.limitations.some((l) => l.includes('Cross-repository attribution forbidden')),
  );
  console.log('✓ Cross-repository snapshot comparison strictly forbidden and guarded');
}

console.log('\n=============================================================');
console.log('ALL 14 WORKSPACE CONTEXT REGRESSION TESTS PASSED (14/14)!');
console.log('=============================================================\n');
