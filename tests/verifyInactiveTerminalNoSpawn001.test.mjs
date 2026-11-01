/**
 * VERIFY-INACTIVE-TERMINAL-001 — Verify with an inactive target terminal must fail once, quietly.
 *
 * Reproduced on Windows 11 ARM64 (UNC workspace, Git for Windows): Run Selected with an inactive
 * target terminal failed with "Target terminal session is not active", while every click first
 * ran a repository before-snapshot with no cwd (Git in ExecRelay's own process cwd) and every
 * Git call opened a visible console window.
 *
 * A. The inactive-session failure happens before cwd validation, Git or dispatch, creates no session
 * B. No Git call for a run without an active target session or session cwd, however often it is clicked;
 *    an active run makes one bounded collection, in the session cwd
 * C. Background collector processes are created with CREATE_NO_WINDOW on Windows
 * D. Active Verify: relative cwd `apps/web` still resolves and dispatches
 * E. UNC: `\\server\share\repo` + `apps/web` stays UNC and inside the root
 * F. No React effect starts repository collection (a re-render cannot become a spawn loop)
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
    if (id.includes('@tauri-apps')) {
      return {
        invoke: () => {
          throw new Error('native invoke must not be reached in this test');
        },
      };
    }
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

const collectors = loadTs(path.join(appSrc, 'features/evidenceCollectors/collectorService.ts'));
const verifyCwd = loadTs(path.join(appSrc, 'features/verification/verificationCwd.ts'));
const policy = loadTs(path.join(appSrc, 'features/workspace/pathPolicy.ts'));
const appSource = fs.readFileSync(path.join(appSrc, 'App.tsx'), 'utf8');

function countingRunner(repoRoot) {
  const calls = [];
  const runner = async (input) => {
    calls.push(input);
    if (input.args[0] === 'rev-parse' && input.args.includes('--show-toplevel')) {
      return { exitCode: repoRoot ? 0 : 128, stdout: repoRoot ? `${repoRoot}\n` : '', stderr: '', durationMs: 0 };
    }
    return { exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
  };
  return { runner, calls };
}

function functionBody(name) {
  const start = appSource.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = appSource.indexOf('\n  const ', start + 1);
  return appSource.slice(start, end);
}

// A. Inactive-session failure ordering
{
  const body = functionBody('executeVerificationCriterion');
  const failure = body.indexOf("message: 'Target terminal session is not active'");
  const guard = body.lastIndexOf('if (!targetSessionId) {', failure);
  assert.ok(guard >= 0 && failure > guard, 'inactive session fails in its own guard');
  const afterGuard = body.slice(guard, body.indexOf('return;', failure));
  assert.ok(!/resolveVerificationWorkingDirectory|validateDirectoryExists|collectRepositoryEvidence|createSession|writeToSession/.test(afterGuard));
  for (const later of ['resolveVerificationWorkingDirectory(', 'validateDirectoryExists(', 'buildVerificationDispatchCommand(']) {
    assert.ok(body.indexOf(later) > failure, `${later} runs only after the session check`);
  }
  assert.ok(!body.includes('createSession'), 'Verify never creates a terminal session');
}
console.log('✓ A. Inactive target session fails before cwd validation, Git and dispatch; no session is created');

// B. Git call boundary
{
  const { runner, calls } = countingRunner('//VM-WIN11/ExecRelayUNC/repo');
  for (let i = 0; i < 100; i++) {
    for (const targetSessionId of [undefined, null, '']) {
      for (const cwd of [undefined, '\\\\VM-WIN11\\ExecRelayUNC\\repo']) {
        assert.equal(await collectors.collectPreVerificationSnapshot({ workspaceId: 'ws', targetSessionId, cwd, runner }), null);
      }
    }
    assert.equal(await collectors.collectPreVerificationSnapshot({ workspaceId: 'ws', targetSessionId: 's1', cwd: undefined, runner }), null);
  }
  assert.equal(calls.length, 0, 'no Git process for 600 inactive or cwd-less attempts');

  // The hazard the guard prevents: without a cwd, collection runs Git in the process cwd.
  const hazard = countingRunner(null);
  await collectors.collectRepositoryEvidence({ workspaceId: 'ws', cwd: undefined, runner: hazard.runner });
  assert.equal(hazard.calls.length, 1);
  assert.equal(hazard.calls[0].cwd, undefined);

  const unc = '\\\\VM-WIN11\\ExecRelayUNC\\repo';
  const first = countingRunner('//VM-WIN11/ExecRelayUNC/repo');
  const res = await collectors.collectPreVerificationSnapshot({ workspaceId: 'ws', targetSessionId: 's1', cwd: unc, runner: first.runner });
  assert.equal(res.run.status, 'completed');
  assert.equal(first.calls[0].cwd, unc, 'root resolution runs in the session cwd');
  assert.ok(first.calls.every((c) => c.cwd === unc || c.cwd === '//VM-WIN11/ExecRelayUNC/repo'), 'no other cwd');
  const second = countingRunner('//VM-WIN11/ExecRelayUNC/repo');
  await collectors.collectPreVerificationSnapshot({ workspaceId: 'ws', targetSessionId: 's1', cwd: unc, runner: second.runner });
  assert.ok(first.calls.length > 0 && first.calls.length <= 10, `bounded: ${first.calls.length}`);
  assert.equal(second.calls.length, first.calls.length, 'one collection per run, deterministic');

  const runStarts = appSource.match(/collectPreVerificationSnapshot\(\{\s*workspaceId: wsId,\s*targetSessionId,\s*cwd,\s*\}\)/g) ?? [];
  assert.equal(runStarts.length, 2, 'Run Selected and Continue both use the guarded snapshot');
  assert.equal((appSource.match(/collectRepositoryEvidence\(\{/g) ?? []).length, 2, 'only the after-snapshot and manual refresh collect directly');
}
console.log('✓ B. No Git call without an active session and cwd; an active run makes one bounded collection');

// C. Windows no-console subprocesses
{
  const collectorRs = fs.readFileSync(path.resolve(__dirname, '../native/src/collector.rs'), 'utf8');
  assert.match(collectorRs, /#\[cfg\(windows\)\]\nconst CREATE_NO_WINDOW: u32 = 0x0800_0000;/);
  const builder = collectorRs.slice(collectorRs.indexOf('fn collector_command('), collectorRs.indexOf('pub fn collector_run_command('));
  assert.match(builder, /#\[cfg\(windows\)\]\s*\{\s*use std::os::windows::process::CommandExt;\s*cmd\.creation_flags\(CREATE_NO_WINDOW\);/);
  assert.ok(collectorRs.includes('let output = collector_command(&input).output()'), 'the command uses the builder');
  const production = collectorRs.slice(0, collectorRs.indexOf('#[cfg(test)]'));
  assert.equal((production.match(/Command::new/g) ?? []).length, 1, 'one collector process constructor');
}
console.log('✓ C. Collector subprocesses use CREATE_NO_WINDOW on Windows');

// D. Active Verify
{
  const res = verifyCwd.resolveVerificationWorkingDirectory('/repo', 'apps/web', 'posix');
  assert.equal(res.ok, true);
  assert.equal(res.resolvedPath, '/repo/apps/web');
  assert.equal(verifyCwd.buildVerificationDispatchCommand('ls', res.resolvedPath), "(cd '/repo/apps/web' && ls)");
  const drive = verifyCwd.resolveVerificationWorkingDirectory('C:\\repo', 'apps/web', 'windows');
  assert.equal(drive.resolvedPath, 'C:\\repo\\apps\\web');
}
console.log('✓ D. Active Verify resolves apps/web and dispatches as before');

// E. UNC
{
  const root = '\\\\VM-WIN11\\ExecRelayUNC\\repo';
  assert.equal(policy.classifyPath(root, 'windows').compatibility, 'local');
  const res = verifyCwd.resolveVerificationWorkingDirectory(root, 'apps/web', 'windows');
  assert.equal(res.resolvedPath, '\\\\VM-WIN11\\ExecRelayUNC\\repo\\apps\\web');
  assert.ok(policy.isPathInside(root, res.resolvedPath, 'windows'));
  assert.ok(!/^[A-Za-z]:/.test(res.resolvedPath), 'no drive-letter conversion');
}
console.log('✓ E. UNC root resolves apps/web to a UNC path inside the root');

// F. No effect-driven collection
{
  const sf = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') {
      effects.push({ body: node.arguments[0]?.getText(sf) ?? '', deps: node.arguments[1]?.getText(sf) ?? '' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.ok(effects.length > 10, 'effects found');
  for (const { body, deps } of effects) {
    assert.ok(
      !/collectRepositoryEvidence|collectPreVerificationSnapshot|handleRefreshRepositoryEvidence|runCollectorProcess|validateDirectoryExists|executeVerificationCriterion\(|handleRunVerification/.test(body),
      `effect must not start collection or Verify:\n${body.slice(0, 200)}`,
    );
    if (body.includes('detectRepositoryContext')) assert.equal(deps, '[]', 'startup repository detection runs once');
  }
}
console.log('✓ F. No effect starts repository collection or Verify; startup detection runs once');

console.log('\nVERIFY-INACTIVE-TERMINAL-001 tests passed.');
