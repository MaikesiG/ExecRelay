/**
 * CROSSPLAT-005C — four-state workspace root model over the unchanged persisted shape.
 *
 * Persisted: the root path string only (schema v1, unchanged). Derived on the current host:
 * foreign / unsupported (PathPolicy) and local-supported-but-unreachable / local-and-usable
 * (a runtime `is_dir` observation that is never persisted).
 *
 * A. local-and-usable          E. reconnect: usable → unreachable → usable, same root
 * B. foreign (both directions) F. pre-005C persisted shape restores without migration
 * C. unsupported (\\?\ forms)  G. pane lastKnownCwd
 * D. local-but-unreachable     H. repository safety: Git only for usable roots
 * I. App wiring: lifecycle boundaries only, no polling, notice for unusable roots
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');
const React = require('../app/node_modules/react');
const ReactDOMServer = require('../app/node_modules/react-dom/server');
const appSrc = path.resolve(__dirname, '../app/src');

const invokes = [];
const moduleCache = new Map();
function loadTs(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;
  const mod = { exports: {} };
  moduleCache.set(absPath, mod);
  const js = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  new Function('module', 'exports', 'require', 'React', js)(mod, mod.exports, (id) => {
    if (id === 'react') return React;
    if (id.endsWith('.css')) return {};
    if (id.includes('@tauri-apps')) {
      return {
        invoke: (cmd, args) => {
          invokes.push([cmd, args]);
          return Promise.resolve(true);
        },
        listen: () => Promise.resolve(() => {}),
      };
    }
    if (id.startsWith('@xterm/')) return {};
    if (id.startsWith('.')) {
      const resolved = path.resolve(path.dirname(absPath), id);
      for (const c of [`${resolved}.ts`, `${resolved}.tsx`, path.join(resolved, 'index.ts')]) {
        if (fs.existsSync(c)) return loadTs(c);
      }
    }
    return require(path.resolve(__dirname, '../app/node_modules', id));
  }, React);
  return mod.exports;
}

const rootState = loadTs(path.join(appSrc, 'features/workspace/workspaceRootState.ts'));
const persistence = loadTs(path.join(appSrc, 'features/workspace/workspacePersistence.ts'));
const context = loadTs(path.join(appSrc, 'features/workspace/workspaceContext.ts'));
const { deriveWorkspaceRootState, describeWorkspaceRootState, evaluateWorkspaceRoot } = rootState;

function persistedDoc(rootPath, lastKnownCwd = null) {
  return {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        name: 'Project',
        rootPath,
        activeTerminalTabId: 'tab-1',
        terminalTabs: [
          {
            id: 'tab-1',
            activePaneId: 'pane-1',
            panes: [{ id: 'pane-1', stableOrdinal: 1, accentId: 'blue', lastKnownCwd }],
          },
        ],
      },
    ],
  };
}
const restore = (doc, host) => persistence.deserializeWorkspaceStateWithDiagnostics(doc, host).state;
const persistedRoot = (ws) => persistence.serializeWorkspaceState([ws], ws.id).workspaces[0].rootPath;

/** Test double for the native stat and repository detection; records every call. */
function fakeFs(reachable) {
  const calls = { isDirectory: [], detectRepository: [] };
  const deps = {
    isDirectory: async (p) => {
      calls.isDirectory.push(p);
      return reachable.has(p);
    },
    detectRepository: async (p) => {
      calls.detectRepository.push(p);
      return { rootPath: p, branch: 'main' };
    },
  };
  return { deps, calls };
}

/** Applies an evaluation the way App.refreshWorkspaceRoot does. */
function apply(ws, { state, repository }) {
  if (state.kind !== 'local-and-usable' && state.kind !== 'local-supported-but-unreachable') return ws;
  return { ...ws, rootReachable: state.kind === 'local-and-usable', repository: ws.repository ?? repository };
}

function assertNoRuntime(ws) {
  for (const pane of ws.panes) {
    assert.equal(pane.session.sessionId, null);
    assert.equal(pane.session.status, 'starting');
    assert.equal(pane.session.sessionInfo, null);
    assert.equal(pane.capture.isListening, false);
  }
  assert.equal(ws.capture.isListening, false);
  assert.equal(ws.repository, undefined);
  assert.equal('rootReachable' in ws, false, 'reachability is never restored');
}

const UNC = '\\\\VM-WIN11\\ExecRelayUNC\\repo';

// A. local-and-usable
for (const [root, host] of [['/Users/x/project', 'posix'], ['C:\\repo', 'windows'], [UNC, 'windows']]) {
  const ws = restore(persistedDoc(root), host).workspaces[0];
  assertNoRuntime(ws);
  assert.deepEqual(deriveWorkspaceRootState(ws, host), { kind: 'local-and-usable', path: root });
  const { deps, calls } = fakeFs(new Set([root]));
  const evaluation = await evaluateWorkspaceRoot(ws, host, deps);
  assert.deepEqual(evaluation.state, { kind: 'local-and-usable', path: root });
  assert.deepEqual(calls, { isDirectory: [root], detectRepository: [root] });
  const next = apply(ws, evaluation);
  assert.equal(next.rootPath, root);
  assert.equal(next.projectCwd, root, 'terminal start cwd is the root');
  assert.deepEqual(next.repository, { rootPath: root, branch: 'main' });
  assert.equal(describeWorkspaceRootState(deriveWorkspaceRootState(next, host)), null, 'no notice');
}
console.log('✓ A. Local usable roots restore, stat once, detect the repository from the root');

// B. foreign — both directions
for (const [root, host] of [
  ['C:\\repo', 'posix'],
  [UNC, 'posix'],
  ['/Users/name/repo', 'windows'],
  ['/home/name/repo', 'windows'],
]) {
  const ws = restore(persistedDoc(root), host).workspaces[0];
  assertNoRuntime(ws);
  assert.equal(ws.rootPath, undefined, 'never a local root');
  assert.equal(ws.projectCwd, undefined, 'never a cwd');
  assert.equal(ws.unavailableRootPath, root, 'kept verbatim');
  assert.deepEqual(deriveWorkspaceRootState(ws, host), { kind: 'foreign', path: root });
  const { deps, calls } = fakeFs(new Set([root]));
  const evaluation = await evaluateWorkspaceRoot(ws, host, deps);
  assert.equal(evaluation.state.kind, 'foreign');
  assert.deepEqual(calls, { isDirectory: [], detectRepository: [] }, 'no stat, no Git');
  assert.equal(apply(ws, evaluation), ws, 'nothing changes');
  assert.equal(persistedRoot(ws), root, 'written back unchanged');
  assert.deepEqual(describeWorkspaceRootState(deriveWorkspaceRootState(ws, host)), {
    message: 'Workspace path belongs to another platform.',
    path: root,
  });
}
console.log('✓ B. Foreign roots restore verbatim, never as root or cwd, with no stat or Git');

// C. unsupported
for (const root of ['\\\\?\\C:\\repo', '\\\\?\\UNC\\server\\share\\repo', '\\\\.\\pipe\\x', '\\repo', 'C:repo', 'repo', '~/repo', '\\\\server']) {
  const ws = restore(persistedDoc(root), 'windows').workspaces[0];
  assertNoRuntime(ws);
  assert.equal(ws.rootPath, undefined);
  assert.equal(ws.unavailableRootPath, root, 'not normalized');
  assert.deepEqual(deriveWorkspaceRootState(ws, 'windows'), { kind: 'unsupported', path: root });
  const { deps, calls } = fakeFs(new Set([root, 'C:\\repo', '\\\\server\\share\\repo']));
  assert.equal((await evaluateWorkspaceRoot(ws, 'windows', deps)).state.kind, 'unsupported');
  assert.deepEqual(calls, { isDirectory: [], detectRepository: [] });
  assert.equal(persistedRoot(ws), root);
  assert.equal(describeWorkspaceRootState(deriveWorkspaceRootState(ws, 'windows')).message, 'This path format is not supported by ExecRelay.');
}
// Extended paths are Windows syntax: foreign, not unsupported, on POSIX.
assert.equal(deriveWorkspaceRootState({ unavailableRootPath: '\\\\?\\C:\\repo' }, 'posix').kind, 'foreign');
console.log('✓ C. Unsupported Windows syntax is preserved, not converted, never statted or probed');

// D. local-supported-but-unreachable
{
  const ws = restore(persistedDoc(UNC), 'windows').workspaces[0];
  const fsState = new Set();
  const { deps, calls } = fakeFs(fsState);
  const down = apply(ws, await evaluateWorkspaceRoot(ws, 'windows', deps));
  assert.deepEqual(deriveWorkspaceRootState(down, 'windows'), { kind: 'local-supported-but-unreachable', path: UNC });
  assert.equal(down.rootPath, UNC, 'still bound to the same root');
  assert.equal(down.unavailableRootPath, undefined, 'not moved to the foreign/unsupported bucket');
  assert.equal(down.projectCwd, UNC, 'terminal start keeps the root: native start fails, no fallback');
  assert.equal(down.repository, undefined);
  assert.deepEqual(calls.detectRepository, [], 'no Git while unreachable');
  assert.ok(down.panes.every((p) => p.session.sessionId === null && p.session.status === 'starting'), 'no fake terminal');
  assert.equal(describeWorkspaceRootState(deriveWorkspaceRootState(down, 'windows')).message, 'Workspace path is currently unavailable.');
  assert.equal(persistedRoot(down), UNC);
  assert.ok(!JSON.stringify(persistence.serializeWorkspaceState([{ ...down, rootReachable: false }], down.id)).includes('rootReachable'), 'reachability is not persisted');

  fsState.add(UNC);
  const up = apply({ ...down, rootReachable: false }, await evaluateWorkspaceRoot({ ...down, rootReachable: false }, 'windows', deps));
  assert.deepEqual(deriveWorkspaceRootState(up, 'windows'), { kind: 'local-and-usable', path: UNC });
  assert.equal(up.rootPath, UNC, 'same rootPath, no rebind');
  assert.deepEqual(calls.detectRepository, [UNC], 'repository detected once usable');
}
console.log('✓ D. Unreachable local roots stay bound, are not foreign, skip Git, and become usable in place');

// E. reconnect
{
  const fsState = new Set([UNC]);
  const { deps, calls } = fakeFs(fsState);
  let ws = restore(persistedDoc(UNC), 'windows').workspaces[0];
  const kinds = [];
  for (const reachable of [true, false, true]) {
    if (reachable) fsState.add(UNC);
    else fsState.delete(UNC);
    ws = apply(ws, await evaluateWorkspaceRoot(ws, 'windows', deps));
    kinds.push(deriveWorkspaceRootState(ws, 'windows').kind);
    assert.equal(ws.rootPath, UNC);
    assert.equal(persistedRoot(ws), UNC);
  }
  assert.deepEqual(kinds, ['local-and-usable', 'local-supported-but-unreachable', 'local-and-usable']);
  assert.equal(calls.isDirectory.length, 3, 'one stat per lifecycle check');
  assert.deepEqual(calls.detectRepository, [UNC], 'repository context survives the outage');
  const failing = { isDirectory: async () => { throw new Error('stat failed'); }, detectRepository: deps.detectRepository };
  assert.equal((await evaluateWorkspaceRoot(ws, 'windows', failing)).state.kind, 'local-supported-but-unreachable', 'a failing check is unreachable, not usable');
}
console.log('✓ E. usable → unreachable → usable keeps the exact root identity');

// F. pre-005C persisted shape (schema v1, as written by 005A/005B builds)
{
  const legacy = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-b',
    activeMonitorView: 'changes',
    workspaces: [
      { id: 'ws-a', name: 'Mac', rootPath: '/Users/x/project', activeTerminalTabId: 't', terminalTabs: [{ id: 't', activePaneId: 'p', panes: [{ id: 'p', stableOrdinal: 1, accentId: 'blue', lastKnownCwd: '/Users/x/project/apps/web' }] }] },
      { id: 'ws-b', name: 'Share', rootPath: UNC, activeTerminalTabId: 't2', terminalTabs: [{ id: 't2', activePaneId: 'p2', panes: [{ id: 'p2', stableOrdinal: 1, accentId: 'green', lastKnownCwd: `${UNC}\\apps\\web` }] }] },
      { id: 'ws-c', name: 'Extended', rootPath: '\\\\?\\C:\\repo', activeTerminalTabId: 't3', terminalTabs: [{ id: 't3', activePaneId: 'p3', panes: [{ id: 'p3', stableOrdinal: 1, accentId: 'red' }] }] },
      { id: 'ws-d', name: 'Unbound', rootPath: null, activeTerminalTabId: 't4', terminalTabs: [{ id: 't4', activePaneId: 'p4', panes: [{ id: 'p4', stableOrdinal: 1, accentId: 'blue' }] }] },
    ],
  };
  const before = JSON.stringify(legacy);
  for (const host of ['posix', 'windows']) {
    const { state, diagnostics } = persistence.deserializeWorkspaceStateWithDiagnostics(legacy, host);
    assert.ok(!diagnostics.includes('unsupported-schema-version'));
    assert.deepEqual(state.workspaces.map((w) => w.id), ['ws-a', 'ws-b', 'ws-c', 'ws-d']);
    assert.equal(state.activeWorkspaceId, 'ws-b');
    state.workspaces.forEach(assertNoRuntime);
    const kinds = state.workspaces.map((w) => deriveWorkspaceRootState(w, host).kind);
    assert.deepEqual(
      kinds,
      host === 'posix'
        ? ['local-and-usable', 'foreign', 'foreign', 'unbound']
        : ['foreign', 'local-and-usable', 'unsupported', 'unbound'],
      host,
    );
    const again = persistence.serializeWorkspaceState(state.workspaces, state.activeWorkspaceId);
    assert.equal(again.schemaVersion, 1, 'no schema change');
    assert.deepEqual(again.workspaces.map((w) => w.rootPath), ['/Users/x/project', UNC, '\\\\?\\C:\\repo', null], 'no root lost');
  }
  assert.equal(JSON.stringify(legacy), before, 'input not mutated');
  assert.equal(persistence.WORKSPACE_PERSISTENCE_SCHEMA_VERSION, 1);
}
console.log('✓ F. Pre-005C state restores on both hosts with no migration, data loss or runtime');

// G. pane lastKnownCwd
{
  const cases = [
    ['windows', UNC, `${UNC}\\apps\\web`, `${UNC}\\apps\\web`], // valid local (also: under a root that may be unreachable)
    ['windows', UNC, '/Users/x/project', null], // foreign
    ['windows', UNC, '\\\\?\\C:\\repo', null], // unsupported
    ['posix', '/Users/x/project', '/Users/x/project/apps/web', '/Users/x/project/apps/web'],
    ['posix', '/Users/x/project', 'C:\\repo', null],
  ];
  for (const [host, root, cwd, expected] of cases) {
    const ws = restore(persistedDoc(root, cwd), host).workspaces[0];
    assert.equal(ws.panes[0].lastKnownCwd, expected, `${cwd} on ${host}`);
    assert.equal(ws.panes[0].session.sessionId, null);
    // Terminal start cwd (PanelLayoutNodeView): lastKnownCwd ?? sessionInfo.cwd ?? workspaceRootPath.
    const startCwd = ws.panes[0].lastKnownCwd ?? ws.panes[0].session.sessionInfo?.cwd ?? ws.rootPath;
    assert.equal(startCwd, expected ?? root, 'a dropped cwd falls back to the root, never process cwd');
    assert.notEqual(startCwd, process.cwd());
  }
  // Under an unreachable root the cwd is kept; the native start fails (InvalidDirectory) instead of moving.
  const unreachable = { ...restore(persistedDoc(UNC, `${UNC}\\apps\\web`), 'windows').workspaces[0], rootReachable: false };
  assert.equal(deriveWorkspaceRootState(unreachable, 'windows').kind, 'local-supported-but-unreachable');
  assert.equal(unreachable.panes[0].lastKnownCwd, `${UNC}\\apps\\web`);
}
console.log('✓ G. lastKnownCwd: local kept, foreign/unsupported dropped, no process-cwd fallback');

// H. repository safety
{
  invokes.length = 0;
  const reachable = new Set(['/Users/x/project', UNC]);
  const roots = [
    ['/Users/x/project', 'posix', true],
    ['C:\\repo', 'posix', false],
    ['\\\\?\\C:\\repo', 'windows', false],
    ['\\\\server\\gone\\repo', 'windows', false],
    [UNC, 'windows', true],
  ];
  for (const [root, host, expectGit] of roots) {
    const ws = restore(persistedDoc(root), host).workspaces[0];
    const { deps, calls } = fakeFs(reachable);
    await evaluateWorkspaceRoot(ws, host, deps);
    assert.deepEqual(calls.detectRepository, expectGit ? [root] : [], `${root} on ${host}`);
    // A workspace already known unreachable is gated in App's refresh path too.
    const known = { ...ws, rootReachable: false, repository: { rootPath: root } };
    assert.notEqual(deriveWorkspaceRootState(known, host).kind, 'local-and-usable');
  }
  // The real detector with a counting runner: never invoked for a foreign root.
  let gitCalls = 0;
  const foreign = restore(persistedDoc('C:\\repo'), 'posix').workspaces[0];
  await evaluateWorkspaceRoot(foreign, 'posix', {
    isDirectory: rootState.isDirectory,
    detectRepository: (p) => context.detectRepositoryContext(p, async () => { gitCalls += 1; return { exitCode: 0, stdout: '', stderr: '' }; }),
  });
  assert.equal(gitCalls, 0);
  assert.deepEqual(invokes, [], 'no native stat for a foreign root');
  // The native wrapper is a single stat command.
  await rootState.isDirectory(UNC);
  assert.deepEqual(invokes, [['path_is_directory', { path: UNC }]]);

  const app = fs.readFileSync(path.join(appSrc, 'App.tsx'), 'utf8');
  const refresh = app.slice(app.indexOf('const handleRefreshRepositoryEvidence = useCallback('));
  assert.match(refresh.slice(0, 800), /if \(deriveWorkspaceRootState\(ws, hostPathPlatform\(\)\)\.kind !== 'local-and-usable'\) return;/);
  assert.ok(refresh.indexOf("kind !== 'local-and-usable'") < refresh.indexOf('collectRepositoryEvidence('), 'gate before Git');

  // CROSSPLAT-005 closure: a terminal started without a cwd (unbound / foreign / unsupported root)
  // has a null session cwd; the Verify after-run snapshot must not then run Git in the process cwd.
  const afterRun = app.slice(app.indexOf('// Asynchronously collect after-snapshot'));
  const guard = afterRun.indexOf('if (!cwd) return;');
  assert.ok(guard > 0 && guard < afterRun.indexOf('collectRepositoryEvidence({'), 'after-run snapshot needs a session cwd');
  const hazard = [];
  const collectors = loadTs(path.join(appSrc, 'features/evidenceCollectors/collectorService.ts'));
  await collectors.collectRepositoryEvidence({ workspaceId: 'ws', cwd: undefined, runner: async (input) => { hazard.push(input); return { exitCode: 128, stdout: '', stderr: '' }; } });
  assert.equal(hazard[0].cwd, undefined, 'without the guard, Git would get no cwd (process cwd)');
}
console.log('✓ H. Git only for usable local roots; manual refresh and the after-run snapshot are gated');

// I. App wiring and the Changes notice
{
  const app = fs.readFileSync(path.join(appSrc, 'App.tsx'), 'utf8');
  assert.equal((app.match(/refreshWorkspaceRoot\(/g) ?? []).length, 2, 'restore and terminal start only');
  assert.match(app, /if \(status === 'running' \|\| status === 'error'\) refreshWorkspaceRoot\(workspaceId\);/);
  assert.ok(!/setInterval/.test(app.slice(app.indexOf('const refreshWorkspaceRoot'), app.indexOf('const refreshWorkspaceRoot') + 1500)), 'no polling');
  assert.ok(app.includes('w.rootPath === ws.rootPath &&'), 'a result for an old root is discarded');
  assert.ok(!/rootPath:\s*state\.path|unavailableRootPath:/.test(app), 'evaluation never rewrites the root');

  const main = fs.readFileSync(path.resolve(__dirname, '../native/src/main.rs'), 'utf8');
  assert.match(main, /#\[tauri::command\(async\)\]\nfn path_is_directory\(path: String\) -> bool \{\n    std::path::Path::new\(&path\)\.is_dir\(\)\n\}/);
  assert.ok(main.includes('            path_is_directory,\n'));

  const viewMod = loadTs(path.join(appSrc, 'features/evidenceCollectors/RepositoryEvidenceView.tsx'));
  const render = (props) => ReactDOMServer.renderToStaticMarkup(React.createElement(viewMod.RepositoryEvidenceView, { snapshot: null, ...props }));
  const unreachableHtml = render({ workspaceRootPath: UNC, workspaceRootNotice: { message: 'Workspace path is currently unavailable.', path: UNC } });
  assert.ok(unreachableHtml.includes('Workspace path is currently unavailable.'));
  assert.ok(unreachableHtml.includes(`Workspace folder: ${UNC}`));
  assert.ok(!unreachableHtml.includes('No Git repository detected.'), 'not misreported as non-Git');
  const foreignHtml = render({ workspaceRootNotice: { message: 'Workspace path belongs to another platform.', path: 'C:\\repo' } });
  assert.ok(foreignHtml.includes('Workspace path belongs to another platform.') && foreignHtml.includes('C:\\repo'));
  assert.ok(foreignHtml.includes('data-testid="repository-unbound"'), 'Open Folder still offered');
  assert.ok(!render({ workspaceRootPath: '/Users/x/project' }).includes('repository-root-unavailable'));
  for (const html of [unreachableHtml, foreignHtml]) assert.ok(!/local-supported|local-and-usable|foreign"|unsupported"/.test(html), 'no enum names');
}
console.log('✓ I. Checked at restore and terminal start only; Changes shows the notice and original path');

console.log('\nCROSSPLAT-005C tests passed.');
