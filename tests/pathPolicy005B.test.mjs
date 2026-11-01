/**
 * CROSSPLAT-005B — Windows path edge cases.
 *
 * 1. UNC classification, including incomplete UNC
 * 2. Extended-length and device paths are recognised distinctly and never local
 * 3. Classification and comparison preserve and never mutate input
 * 4. Lexical equality: Windows folds drive/server/share case and separators only; POSIX exact
 * 5. Containment: drive, share and prefix traps; traversal components never compare
 * 6. Verify cwd: Windows drive and UNC roots, bare roots, casing, absolute/traversal rejection
 * 7. Restore: UNC local on Windows, foreign elsewhere; extended and incomplete UNC stay unbound
 * 8. Symlink/junction aliases are not canonicalized
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
const verifyCwd = loadTs(path.join(appSrc, 'features/verification/verificationCwd.ts'));
const verifyModel = loadTs(path.join(appSrc, 'features/verification/verificationModel.ts'));
const persistence = loadTs(path.join(appSrc, 'features/workspace/workspacePersistence.ts'));

const { classifyPath, arePathsEquivalent, isPathInside } = policy;
const expectClass = (input, host, syntax, compatibility) =>
  assert.deepEqual(
    classifyPath(input, host),
    { syntax, platform: 'windows', compatibility },
    `${JSON.stringify(input)} on ${host}`,
  );

// 1. UNC
for (const p of ['\\\\server\\share', '\\\\server\\share\\repo', '\\\\SERVER\\Share\\Repo', '//server/share/repo', '\\\\server\\share\\']) {
  expectClass(p, 'windows', 'windows-unc', 'local');
  expectClass(p, 'posix', 'windows-unc', 'foreign');
}
for (const p of ['\\\\', '\\\\server', '\\\\server\\', '//server', '//']) {
  expectClass(p, 'windows', 'windows-unc', 'invalid');
  expectClass(p, 'posix', 'windows-unc', 'invalid');
}
console.log('✓ 1. UNC with server and share is local on Windows, foreign elsewhere; \\\\server alone is invalid');

// 2. Extended-length and device paths
for (const [p, syntax] of [
  ['\\\\?\\C:\\repo', 'windows-extended-drive'],
  ['//?/C:/repo', 'windows-extended-drive'],
  ['\\\\?\\UNC\\server\\share\\repo', 'windows-extended-unc'],
  ['\\\\?\\unc\\server\\share', 'windows-extended-unc'],
  ['\\\\.\\pipe\\x', 'windows-device'],
  ['\\\\?\\Volume{0000}\\repo', 'windows-device'],
]) {
  expectClass(p, 'windows', syntax, 'unsupported');
  expectClass(p, 'posix', syntax, 'foreign');
  assert.equal(policy.isLocalPath(p, 'windows'), false);
}
console.log('✓ 2. \\\\?\\ drive, \\\\?\\UNC and device paths are distinct and unsupported on Windows');

// 3. Preservation
const driveUnicode = 'C:\\Users\\Maike\\My Project\\données 你好';
const uncUnicode = '\\\\SERVER\\Share\\My Project\\données 你好';
for (const p of [driveUnicode, uncUnicode]) {
  const before = String(p);
  assert.equal(classifyPath(p, 'windows').compatibility, 'local');
  assert.equal(arePathsEquivalent(p, p, 'windows'), true);
  assert.equal(isPathInside(p, `${p}\\x`, 'windows'), true);
  assert.equal(p, before, 'input is not mutated');
}
console.log('✓ 3. Unicode, spaces, casing and separators are preserved');

// 4. Equality
const eq = (a, b, host = 'windows') => arePathsEquivalent(a, b, host);
assert.ok(eq('C:\\Repo', 'c:\\Repo'), 'drive letter case');
assert.ok(eq('C:\\Repo', 'C:/Repo'), 'separators');
assert.ok(eq('C:\\Repo', 'C:\\Repo\\'), 'trailing separator');
assert.ok(eq('C:\\Repo\\apps', 'C:\\Repo\\\\apps'), 'repeated separator');
assert.ok(eq('C:\\', 'c:/'), 'drive root');
assert.ok(eq('\\\\SERVER\\Share\\Repo', '//server/share/Repo'), 'UNC server/share case and separators');
assert.ok(!eq('C:\\Repo', 'c:\\repo'), 'component case is kept: directories can be case-sensitive');
assert.ok(!eq('\\\\server\\share\\Repo', '\\\\server\\share\\repo'));
assert.ok(!eq('C:\\Repo', 'D:\\Repo'));
assert.ok(!eq('\\\\?\\C:\\Repo', 'C:\\Repo'), 'extended path is not folded into a drive path');
assert.ok(!eq('Z:\\Repo', '\\\\server\\share\\Repo'), 'a mapped drive is not its UNC target');
assert.ok(!eq('C:\\Repo\\..\\Repo', 'C:\\Repo'), '.. needs resolution, not comparison');
assert.ok(!eq('C:\\Repo', 'C:\\Repo', 'posix'), 'foreign paths never compare equal');
assert.ok(eq('/Repo', '/Repo/', 'posix'));
assert.ok(eq('/Repo/apps', '/Repo//apps', 'posix'));
assert.ok(!eq('/Repo', '/repo', 'posix'), 'POSIX is case-sensitive');
assert.ok(!eq('/Repo', '/Repo', 'windows'), 'POSIX is foreign on Windows');
console.log('✓ 4. Equality is lexical: drive/server/share case and separators fold on Windows, components never');

// 5. Containment
const inside = (root, child, host = 'windows') => isPathInside(root, child, host);
assert.ok(inside('C:\\Repo', 'C:\\Repo\\apps\\web'));
assert.ok(inside('C:\\Repo', 'c:/Repo/apps'));
assert.ok(inside('C:\\Repo', 'C:\\Repo'));
assert.ok(inside('C:\\', 'C:\\Repo'));
assert.ok(!inside('C:\\Repo', 'D:\\Repo\\apps\\web'), 'different drive');
assert.ok(!inside('C:\\Repo', 'C:\\Repository'), 'prefix trap');
assert.ok(!inside('C:\\Repo', 'C:\\repo\\apps'), 'component case is kept');
assert.ok(inside('\\\\server\\share\\Repo', '\\\\server\\share\\Repo\\apps\\web'));
assert.ok(!inside('\\\\server\\share\\Repo', '\\\\server\\other\\Repo'), 'different share');
assert.ok(!inside('\\\\server\\share\\Repo', '\\\\other\\share\\Repo'), 'different server');
assert.ok(!inside('\\\\server\\share', '\\\\server\\shared'), 'share prefix trap');
assert.ok(!inside('C:\\Repo', 'C:\\Repo\\..\\Other'), 'traversal');
assert.ok(!inside('C:\\Repo', 'C:\\Repo\\apps\\..\\..\\Other'), 'traversal');
assert.ok(!inside('\\\\?\\C:\\Repo', '\\\\?\\C:\\Repo\\apps'), 'unsupported paths never contain');
assert.ok(inside('/repo', '/repo/apps', 'posix'));
assert.ok(inside('/', '/repo', 'posix'));
assert.ok(!inside('/repo', '/repository/apps', 'posix'), 'POSIX prefix trap');
assert.ok(!inside('/Repo', '/repo/apps', 'posix'), 'POSIX case-sensitive');
assert.ok(!inside('/repo', '/repo/../etc', 'posix'), 'POSIX traversal');
const lineStats = fs.readFileSync(path.join(appSrc, 'features/evidenceCollectors/untrackedFileLineStats.ts'), 'utf8');
assert.ok(lineStats.includes('!isPathInside(resolvedRoot, fullPath, hostPathPlatform())'), 'line stats uses containment');
assert.ok(!lineStats.includes('fullPath.startsWith(resolvedRoot)'), 'no string-prefix containment');
console.log('✓ 5. Containment respects drive, server, share and component boundaries');

// 6. Verify cwd
const resolve = (root, wd, host) => verifyCwd.resolveVerificationWorkingDirectory(root, wd, host);
const expectResolved = (root, wd, host, resolvedPath, relativePath) => {
  const res = resolve(root, wd, host);
  assert.equal(res.ok, true, `${root} + ${wd}: ${res.error}`);
  assert.equal(res.resolvedPath, resolvedPath);
  if (relativePath) assert.equal(res.relativePath, relativePath);
};
expectResolved('C:\\Repo', 'apps\\web', 'windows', 'C:\\Repo\\apps\\web', 'apps/web');
expectResolved('C:\\Repo', 'apps/web', 'windows', 'C:\\Repo\\apps\\web', 'apps/web');
expectResolved('C:\\Repo\\', './Apps\\MyWeb/', 'windows', 'C:\\Repo\\Apps\\MyWeb', 'Apps/MyWeb');
expectResolved('C:\\Repo', '.', 'windows', 'C:\\Repo', '.');
expectResolved('C:\\', '.', 'windows', 'C:\\', '.');
expectResolved('C:\\', 'Repo', 'windows', 'C:\\Repo');
expectResolved('C:/Repo', 'apps\\web', 'windows', 'C:/Repo/apps/web');
expectResolved('\\\\server\\share\\Repo', 'apps\\web', 'windows', '\\\\server\\share\\Repo\\apps\\web');
expectResolved('\\\\server\\share', '.', 'windows', '\\\\server\\share');
expectResolved('/repo', 'packages/MyApp', 'posix', '/repo/packages/MyApp');
expectResolved('/', '.', 'posix', '/');
expectResolved('/', 'repo', 'posix', '/repo');
expectResolved(driveUnicode, 'apps', 'windows', `${driveUnicode}\\apps`);

for (const wd of ['C:\\x', 'c:/x', '\\\\server\\share\\x', '//server/share', '\\\\?\\C:\\x', '\\\\?\\UNC\\s\\x', '/tmp', '\\x', 'C:x']) {
  for (const host of ['windows', 'posix']) {
    const root = host === 'windows' ? 'C:\\Repo' : '/repo';
    const res = resolve(root, wd, host);
    assert.equal(res.ok, false, `${wd} on ${host}`);
    assert.ok(res.error.includes('must be relative to the workspace root'), res.error);
  }
  const v = verifyModel.validateCriterionInput({ label: 'x', command: 'ls', workingDirectory: wd });
  assert.equal(v.valid, false, `validateCriterionInput ${wd}`);
  assert.ok(v.error.includes('must be relative to the workspace root'), v.error);
}
for (const wd of ['..', '../..', '..\\..', 'apps\\..\\..', 'apps/../../x']) {
  for (const [root, host] of [['C:\\Repo', 'windows'], ['\\\\server\\share\\Repo', 'windows'], ['/repo', 'posix']]) {
    const res = resolve(root, wd, host);
    assert.equal(res.ok, false, `${wd} under ${root}`);
    assert.ok(res.error.includes('cannot escape workspace root'), res.error);
  }
}
for (const [root, host] of [['C:\\Repo', 'posix'], ['/repo', 'windows'], ['\\\\?\\C:\\Repo', 'windows'], ['\\\\server', 'windows'], ['repo', 'posix']]) {
  const res = resolve(root, 'apps', host);
  assert.equal(res.ok, false, `${root} on ${host}`);
  assert.ok(res.error.includes('not a local path on this host'), res.error);
}
const cwdSource = fs
  .readFileSync(path.join(appSrc, 'features/verification/verificationCwd.ts'), 'utf8')
  .split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
  .join('\n');
assert.ok(!cwdSource.includes('process.cwd'), 'no process.cwd() in Verify cwd code');
console.log('✓ 6. Verify cwd resolves under drive and UNC roots with exact casing; absolute and traversal rejected');

// 7. Restore
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
{
  for (const root of [uncUnicode, 'C:\\Repo', '//server/share/Repo']) {
    const ws = restore(persistedDoc(root, `${root}\\apps`), 'windows').state.workspaces[0];
    assert.equal(ws.rootPath, root);
    assert.equal(ws.projectCwd, root);
    assert.equal(ws.panes[0].lastKnownCwd, `${root}\\apps`);
    assert.equal('unavailableRootPath' in ws, false);
  }
  for (const [root, host] of [
    [uncUnicode, 'posix'],
    ['\\\\?\\C:\\Repo', 'windows'],
    ['\\\\?\\UNC\\server\\share\\Repo', 'windows'],
    ['\\\\server', 'windows'],
  ]) {
    const ws = restore(persistedDoc(root, root), host).state.workspaces[0];
    assert.equal(ws.rootPath, undefined, `${root} on ${host}`);
    assert.equal(ws.projectCwd, undefined);
    assert.equal(ws.panes[0].lastKnownCwd, null);
    assert.equal(ws.unavailableRootPath, root, 'original kept verbatim');
    assert.equal(persistence.serializeWorkspaceState([ws], ws.id).workspaces[0].rootPath, root);
    assert.equal(ws.panes[0].session.sessionId, null);
    assert.equal(ws.panes[0].session.sessionInfo, null);
    assert.equal(ws.capture.isListening, false);
  }
}
console.log('✓ 7. UNC restores locally on Windows only; extended and incomplete UNC roots stay unbound and verbatim');

// 8. No canonicalization
{
  const policySource = fs.readFileSync(path.join(appSrc, 'features/workspace/pathPolicy.ts'), 'utf8');
  const imports = policySource.match(/^import .*$/gm) ?? [];
  assert.deepEqual(imports, ["import { detectPlatform } from '../shortcuts/shortcutNormalization';"]);
  for (const file of ['features/workspace/pathPolicy.ts', 'features/workspace/workspacePersistence.ts', 'features/verification/verificationCwd.ts']) {
    const src = fs.readFileSync(path.join(appSrc, file), 'utf8');
    assert.ok(!/realpath|canonicalize/i.test(src), `${file} does not canonicalize`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathpolicy005b-'));
  try {
    const target = path.join(dir, 'target');
    const link = path.join(dir, 'link');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link);
    assert.equal(fs.realpathSync(link), fs.realpathSync(target), 'fixture: link resolves to target');
    assert.equal(arePathsEquivalent(link, target, 'posix'), false, 'alias is not identity');
    assert.equal(isPathInside(target, path.join(link, 'x'), 'posix'), false);
    assert.equal(resolve(link, 'x', 'posix').resolvedPath, `${link}/x`, 'Verify keeps the selected root');
    const ws = restore(persistedDoc(link), 'posix').state.workspaces[0];
    assert.equal(ws.rootPath, link, 'restore keeps the selected path, not its target');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log('✓ 8. Symlink aliases are neither resolved nor treated as the same path');

console.log('\nCROSSPLAT-005B PathPolicy tests passed.');
