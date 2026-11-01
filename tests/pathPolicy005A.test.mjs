/**
 * CROSSPLAT-005A — PathPolicy & foreign-path restore.
 *
 * 1. Classification matrix on a POSIX host (macOS/Linux)
 * 2. Classification matrix on a Windows host
 * 3. Classification preserves and never mutates the input
 * 4. Same-platform restore is unchanged
 * 5. Foreign, relative, home and unsupported roots restore as unavailable, verbatim, never as cwd/root
 * 6. The unavailable root is written back unchanged and cleared by an explicit rebind
 * 7. Non-local lastKnownCwd never overrides a local workspace root
 * 8. Restore fabricates no runtime and never throws
 * 9. Repository detection and terminal cwd boundaries take only the gated rootPath
 * 10. No process.cwd() fallback
 *
 * CROSSPLAT-005B refined this contract: UNC is local on Windows, and `\\?\` paths, `\x` and
 * `C:x` have their own syntaxes (compatibility unchanged); tests/pathPolicy005B.test.mjs covers them.
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
const appSrc = path.resolve(__dirname, '../app/src');

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
    if (id.includes('@tauri-apps')) return { invoke: () => Promise.resolve(null), listen: () => Promise.resolve(() => {}) };
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

const policy = loadTs(path.join(appSrc, 'features/workspace/pathPolicy.ts'));
const persistence = loadTs(path.join(appSrc, 'features/workspace/workspacePersistence.ts'));
const context = loadTs(path.join(appSrc, 'features/workspace/workspaceContext.ts'));

const { classifyPath } = policy;
const expectClass = (input, host, syntax, platform, compatibility) =>
  assert.deepEqual(
    classifyPath(input, host),
    { syntax, platform, compatibility },
    `${JSON.stringify(input)} on ${host}`,
  );

// 1. POSIX host
for (const p of ['/Users/x/project', '/home/x/project', '/tmp/project', '/Volumes/work/project']) {
  expectClass(p, 'posix', 'posix-absolute', 'posix', 'local');
}
for (const p of ['C:\\Users\\x\\project', 'C:/Users/x/project', 'D:\\repo', 'd:/repo']) {
  expectClass(p, 'posix', 'windows-drive', 'windows', 'foreign');
}
for (const p of ['\\\\server\\share\\repo', '//server/share/repo']) {
  expectClass(p, 'posix', 'windows-unc', 'windows', 'foreign');
}
expectClass('\\\\?\\C:\\repo', 'posix', 'windows-extended-drive', 'windows', 'foreign');
expectClass('\\repo', 'posix', 'windows-rooted', 'windows', 'ambiguous');
expectClass('C:repo', 'posix', 'windows-drive-relative', 'windows', 'ambiguous');
for (const p of ['project', './project', '../project', 'foo/bar', 'foo\\bar', ' /Users/x']) {
  expectClass(p, 'posix', 'relative', null, 'ambiguous');
}
for (const p of ['~', '~/project', '~\\project']) {
  expectClass(p, 'posix', 'home-shorthand', null, 'ambiguous');
}
for (const p of ['', '   ', null, undefined, 42, '/Users/x\0y']) {
  expectClass(p, 'posix', 'empty', null, 'invalid');
}
console.log('✓ 1. POSIX host: POSIX absolute is local, Windows drive/UNC foreign, relative ambiguous, empty invalid');

// 2. Windows host
for (const p of ['C:\\Users\\x\\project', 'C:/Users/x/project', 'D:\\repo', 'd:/repo']) {
  expectClass(p, 'windows', 'windows-drive', 'windows', 'local');
}
for (const p of ['/Users/x/project', '/home/x/project']) {
  expectClass(p, 'windows', 'posix-absolute', 'posix', 'foreign');
}
for (const p of ['\\\\server\\share\\repo', '//server/share/repo']) {
  expectClass(p, 'windows', 'windows-unc', 'windows', 'local');
}
expectClass('\\repo', 'windows', 'windows-rooted', 'windows', 'ambiguous');
expectClass('C:repo', 'windows', 'windows-drive-relative', 'windows', 'ambiguous');
for (const p of ['project', './project', '..\\project', 'foo\\bar']) {
  expectClass(p, 'windows', 'relative', null, 'ambiguous');
}
expectClass('~\\project', 'windows', 'home-shorthand', null, 'ambiguous');
expectClass('', 'windows', 'empty', null, 'invalid');
console.log('✓ 2. Windows host: drive and UNC paths local, POSIX foreign, relative ambiguous');

// 3. Preservation
const windowsUnicode = 'C:\\Users\\Maike\\My Project\\données 你好';
const posixUnicode = '/Users/Maike/My Project/données 你好';
for (const [p, host] of [[windowsUnicode, 'windows'], [posixUnicode, 'posix'], ['d:/Repo', 'windows']]) {
  const before = String(p);
  assert.equal(classifyPath(p, host).compatibility, 'local');
  assert.equal(p, before, 'input is not mutated');
}
assert.equal(policy.isLocalPath(windowsUnicode, 'posix'), false);
console.log('✓ 3. Casing, Unicode, spaces and separators are classified as given');

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
const restore = (doc, host) => persistence.deserializeWorkspaceStateWithDiagnostics(doc, host);

// 4. Same-platform restore
for (const [root, host] of [[posixUnicode, 'posix'], [windowsUnicode, 'windows'], ['C:/Users/x', 'windows']]) {
  const { state, diagnostics } = restore(persistedDoc(root), host);
  const ws = state.workspaces[0];
  assert.equal(ws.rootPath, root);
  assert.equal(ws.projectCwd, root);
  assert.equal('unavailableRootPath' in ws, false);
  assert.equal(diagnostics.includes('unavailable-root-path'), false);
}
console.log('✓ 4. Same-platform roots restore exactly as before');

// 5. Unavailable roots
const unavailable = [
  [windowsUnicode, 'posix'],
  ['C:/Users/x/project', 'posix'],
  ['\\\\server\\share\\repo', 'posix'],
  ['//server/share/repo', 'posix'],
  [posixUnicode, 'windows'],
  ['\\\\?\\C:\\repo', 'windows'],
  ['project', 'posix'],
  ['./project', 'windows'],
  ['~/project', 'posix'],
];
for (const [root, host] of unavailable) {
  const { state, diagnostics } = restore(persistedDoc(root), host);
  const ws = state.workspaces[0];
  assert.equal(ws.rootPath, undefined, `${root} on ${host} is not a root`);
  assert.equal(ws.projectCwd, undefined, `${root} on ${host} is not a cwd`);
  assert.equal(ws.repository, undefined);
  assert.equal(ws.unavailableRootPath, root, 'original kept verbatim');
  assert.equal(ws.name, 'Project', 'workspace stays visible');
  assert.ok(diagnostics.includes('unavailable-root-path'));
}
for (const root of ['', '   ', null, 7]) {
  const ws = restore(persistedDoc(root), 'posix').state.workspaces[0];
  assert.equal(ws.rootPath, undefined);
  assert.equal(ws.unavailableRootPath, undefined, 'nothing to preserve');
}
console.log('✓ 5. Foreign, relative, home and unsupported roots restore unbound with the original string kept aside');

// 6. Write-back and rebind
{
  const ws = restore(persistedDoc(windowsUnicode), 'posix').state.workspaces[0];
  const saved = persistence.serializeWorkspaceState([ws], ws.id);
  assert.equal(saved.workspaces[0].rootPath, windowsUnicode, 'written back unchanged');
  const back = restore(saved, 'windows').state.workspaces[0];
  assert.equal(back.rootPath, windowsUnicode, 'usable again on its own platform');

  const rebound = context.bindWorkspaceRootPath(ws, '/Users/x/new');
  assert.equal(rebound.rootPath, '/Users/x/new');
  assert.equal(rebound.unavailableRootPath, undefined);
  assert.equal(persistence.serializeWorkspaceState([rebound], ws.id).workspaces[0].rootPath, '/Users/x/new');
}
console.log('✓ 6. Unavailable root round-trips verbatim; an explicit rebind replaces it');

// 7. lastKnownCwd
{
  const local = restore(persistedDoc('/Users/x/project', '/Users/x/project/api'), 'posix').state;
  assert.equal(local.workspaces[0].panes[0].lastKnownCwd, '/Users/x/project/api');

  const foreignCwd = restore(persistedDoc('/Users/x/project', 'C:\\Users\\x\\project'), 'posix').state;
  assert.equal(foreignCwd.workspaces[0].panes[0].lastKnownCwd, null);
  assert.equal(foreignCwd.workspaces[0].rootPath, '/Users/x/project');

  const relativeCwd = restore(persistedDoc('D:\\repo', 'src'), 'windows').state;
  assert.equal(relativeCwd.workspaces[0].panes[0].lastKnownCwd, null);

  const bothForeign = restore(persistedDoc('C:\\repo', 'C:\\repo\\src'), 'posix').state.workspaces[0];
  assert.equal(bothForeign.panes[0].lastKnownCwd, null);
  assert.equal(bothForeign.rootPath, undefined);
}
console.log('✓ 7. A non-local lastKnownCwd is dropped and never overrides a local root');

// 8. No fabricated runtime
for (const [root, host] of [...unavailable, ['/Users/x', 'posix']]) {
  const ws = restore(persistedDoc(root, root), host).state.workspaces[0];
  for (const pane of ws.panes) {
    assert.equal(pane.session.sessionId, null);
    assert.equal(pane.session.sessionInfo, null);
    assert.equal(pane.capture.isListening, false);
  }
  assert.equal(ws.capture.isListening, false);
}
console.log('✓ 8. Restore creates no session, process or capture ownership');

// 9. Repository detection and terminal cwd boundaries
{
  const ws = restore(persistedDoc('C:\\Users\\x\\project'), 'posix').state.workspaces[0];
  let calls = 0;
  const repo = await context.detectRepositoryContext(ws.rootPath, async () => {
    calls += 1;
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  assert.equal(repo, undefined);
  assert.equal(calls, 0, 'repository detection never runs for a foreign root');

  const app = fs.readFileSync(path.join(appSrc, 'App.tsx'), 'utf8');
  // CROSSPLAT-005C: startup detection goes through evaluateWorkspaceRoot, which detects only from
  // a usable local root (covered in pathPolicy005C.test.mjs).
  assert.match(app, /workspaces\.forEach\(\(ws\) => refreshWorkspaceRoot\(ws\.id\)\);/);
  assert.match(app, /evaluateWorkspaceRoot\(ws, hostPathPlatform\(\), \{\s*isDirectory,\s*detectRepository: detectRepositoryContext,\s*\}\)/);
  assert.equal((app.match(/detectRepositoryContext\(/g) ?? []).length, 1, 'only the folder-open path calls it directly');
  assert.match(app, /workspaceRootPath: activeWorkspace\?\.rootPath,/);
  assert.ok(!/unavailableRootPath/.test(app), 'App never reads the unavailable root');
  const layout = fs.readFileSync(path.join(appSrc, 'features/workspace/PanelLayoutNodeView.tsx'), 'utf8');
  assert.match(layout, /pane\.lastKnownCwd \?\?\s*pane\.session\?\.sessionInfo\?\.cwd \?\?\s*transcriptProps\.workspaceRootPath/);
  // Both unusable: cwd is undefined and the native side applies its existing default (home).
  const cwd = ws.panes[0].lastKnownCwd ?? ws.panes[0].session?.sessionInfo?.cwd ?? ws.rootPath;
  assert.equal(cwd, undefined);
}
console.log('✓ 9. Startup repository detection and terminal cwd only see the gated rootPath');

// 10. No hidden absolute fallback
for (const file of ['features/workspace/pathPolicy.ts', 'features/workspace/workspacePersistence.ts']) {
  assert.ok(!fs.readFileSync(path.join(appSrc, file), 'utf8').includes('process.cwd'), file);
}
console.log('✓ 10. No process.cwd() fallback');

console.log('\nCROSSPLAT-005A PathPolicy tests passed.');
