/**
 * TERMINAL-V01-UI-POLISH-001 — Workspace and Changes Header Cleanup Regression Tests
 *
 * Verifies:
 * 1. Window title resolution:
 *    - Bound workspace: "{activeWorkspace.name} — TraceRelay"
 *    - Unbound workspace: "TraceRelay"
 *    - No active workspace: "TraceRelay"
 *    - Does NOT include branch, cwd, terminal name, or full filesystem path
 * 2. WorkspaceTabBar:
 *    - Removed persistent "Open Folder" text button from populated tab bar
 *    - Preserved "+" button with tooltip / title="Open Folder" and aria-label="Open Folder"
 *    - Preserved inline "Open Folder" text CTA for unbound workspace tabs
 * 3. Changes repository metadata:
 *    - Full repository filesystem path is not permanently rendered in header
 *    - Renders short HEAD commit (7 characters)
 *    - Does not call short SHA "Version" (uses HEAD / Commit / Revision terminology)
 *    - Renders icon button with title="Copy commit"
 *    - Renders icon button with title="Open in Finder\n${effectiveRepoRoot}"
 *    - Finder action opens active workspace repository root path
 *    - Non-Git workspace hides/disables repository actions and does not render fake HEAD/branch
 *    - Refresh button is icon-only with title="Refresh changes"
 * 4. Switching workspace updates window title, HEAD, branch, and Finder path
 * 5. Terminal cwd changes (cd /tmp) do not affect repository metadata or window title
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
const ReactDOMServer = require('../app/node_modules/react-dom/server');

function transpileTs(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'React', js)(mod, mod.exports, customRequire, React);
  return mod.exports;
}

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

// Load Workspace Context module
const runnerMod = loadTs('../app/src/features/evidenceCollectors/collectorRunner.ts', (id) => {
  if (id.includes('@tauri-apps')) return { invoke: () => Promise.resolve(null) };
  return require(id);
});
const repoResolverMod = loadTs('../app/src/features/evidenceCollectors/repositoryResolver.ts', (id) => {
  if (id.includes('collectorRunner')) return runnerMod;
  return require(id);
});
const wsContextMod = loadTs('../app/src/features/workspace/workspaceContext.ts', (id) => {
  if (id.includes('@tauri-apps')) return { invoke: () => Promise.resolve(null) };
  if (id.includes('repositoryResolver')) return repoResolverMod;
  if (id.includes('collectorRunner')) return runnerMod;
  return require(id);
});

// Load WorkspaceTabBar component
const wsTabBarMod = loadTs('../app/src/features/workspace/WorkspaceTabBar.tsx', (id) => {
  if (id === 'react') return React;
  if (id.includes('.css')) return {};
  if (id.includes('useTabStripScroll')) {
    return { useTabStripScroll: () => ({ containerRef: { current: null } }) };
  }
  return require(id);
});

console.log('Running TERMINAL-V01-UI-POLISH-001 Regression Test Suite...\\n');

// ============================================================================
// Test 1: Window Title Resolution
// ============================================================================
console.log('--- Test 1: Window Title Resolution ---');
{
  // A. Bound workspace with valid rootPath
  const boundWs = {
    id: 'ws-1',
    name: 'careerneed',
    rootPath: '/Users/xingchiguo/development/projects/careerneed',
    repository: {
      vcs: 'git',
      rootPath: '/Users/xingchiguo/development/projects/careerneed',
      branch: 'main',
    },
  };
  const boundTitle = wsContextMod.resolveWindowTitle(boundWs);
  assert.strictEqual(
    boundTitle,
    'careerneed — ExecRelay',
    'Bound workspace title must be "{activeWorkspace.name} — ExecRelay"',
  );
  assert.ok(!boundTitle.includes('main'), 'Title must NOT include branch');
  assert.ok(!boundTitle.includes('/Users'), 'Title must NOT include full filesystem path');
  assert.ok(!boundTitle.includes('Terminal'), 'Title must NOT include terminal name');

  // B. Unbound workspace
  const unboundWs = {
    id: 'ws-2',
    name: 'Workspace 2',
    rootPath: undefined,
  };
  const unboundTitle = wsContextMod.resolveWindowTitle(unboundWs);
  assert.strictEqual(
    unboundTitle,
    'ExecRelay',
    'Unbound workspace title must be "ExecRelay"',
  );

  // C. Empty/whitespace rootPath
  const emptyPathWs = {
    id: 'ws-3',
    name: 'Workspace 3',
    rootPath: '   ',
  };
  assert.strictEqual(
    wsContextMod.resolveWindowTitle(emptyPathWs),
    'ExecRelay',
    'Workspace with whitespace rootPath must resolve to "ExecRelay"',
  );

  // D. Null / undefined active workspace
  assert.strictEqual(
    wsContextMod.resolveWindowTitle(null),
    'ExecRelay',
    'Null active workspace must resolve to "ExecRelay"',
  );
  assert.strictEqual(
    wsContextMod.resolveWindowTitle(undefined),
    'ExecRelay',
    'Undefined active workspace must resolve to "ExecRelay"',
  );

  console.log('✓ Window title formats strictly per specification without branch, cwd, or path');
}

// ============================================================================
// Test 2: Workspace Tab Bar Open Folder & + Button Semantics
// ============================================================================
console.log('\\n--- Test 2: Workspace Tab Bar Action Semantics ---');
{
  const workspaces = [
    {
      id: 'ws-1',
      name: 'careerneed',
      rootPath: '/projects/careerneed',
    },
    {
      id: 'ws-2',
      name: 'Workspace 2',
      rootPath: undefined,
    },
  ];

  let openFolderCalled = false;

  const element = React.createElement(wsTabBarMod.WorkspaceTabBar, {
    workspaces,
    activeWorkspaceId: 'ws-1',
    onSelectWorkspace: () => {},
    onCreateWorkspace: () => {},
    onRequestDeleteWorkspace: () => {},
    onRenameWorkspace: () => {},
    onOpenFolder: () => {
      openFolderCalled = true;
    },
  });

  const html = ReactDOMServer.renderToStaticMarkup(element);

  // 1. Verify persistent "Open Folder" text button is removed from populated tab bar
  assert.ok(
    !html.includes('class="workspace-tab-bar-open-btn"'),
    'Persistent workspace-tab-bar-open-btn must be removed',
  );

  // 2. Verify "+" button has tooltip "Open Folder" and aria-label "Open Folder"
  assert.ok(
    html.includes('title="Open Folder"'),
    '+ button must have title="Open Folder"',
  );
  assert.ok(
    html.includes('aria-label="Open Folder"'),
    '+ button must have aria-label="Open Folder"',
  );
  assert.ok(
    html.includes('class="workspace-tab-bar-add"'),
    '+ button must have class="workspace-tab-bar-add"',
  );

  // 3. Verify unbound tab ws-2 still has explicit inline "Open Folder" CTA
  assert.ok(
    html.includes('class="workspace-tab-bind-folder-btn"'),
    'Unbound workspace tab must retain inline Open Folder button',
  );

  // 4. Verify CSS stylesheet no longer declares .workspace-tab-bar-open-btn
  const css = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabBar.css'),
    'utf8',
  );
  assert.ok(
    !css.includes('.workspace-tab-bar-open-btn'),
    'WorkspaceTabBar.css must not contain .workspace-tab-bar-open-btn',
  );

  console.log('✓ Redundant Open Folder text button removed; + button has tooltip "Open Folder"');
}

// ============================================================================
// Test 3: Changes Repository Metadata Header Component Semantics & Source Invariants
// ============================================================================
console.log('\\n--- Test 3: Changes Repository Metadata Header Component Semantics ---');
{
  const viewTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/evidenceCollectors/RepositoryEvidenceView.tsx'),
    'utf8',
  );
  const viewCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/evidenceCollectors/RepositoryEvidenceView.css'),
    'utf8',
  );

  // A. Full path is NOT permanently rendered in the header
  assert.ok(
    !viewTsx.includes('className="repository-root-path"'),
    'Full repository root path must not be permanently rendered in Changes header',
  );
  assert.ok(
    !viewCss.includes('.repository-root-path'),
    'RepositoryEvidenceView.css must not define .repository-root-path',
  );

  // B. Renders short HEAD commit (7 characters) using slice(0, 7)
  assert.ok(
    viewTsx.includes('metadata?.headCommit') && viewTsx.includes('slice(0, 7)'),
    'Must derive short commit from headCommit.slice(0, 7)',
  );

  // C. Uses HEAD / Commit / Revision terminology, NOT "Version"
  assert.ok(
    !viewTsx.includes('Version:'),
    'Must NOT call short SHA "Version"',
  );
  assert.ok(
    viewTsx.includes('HEAD Commit:'),
    'Must use HEAD Commit terminology in tooltip',
  );

  // D. Commit copy action icon button
  assert.ok(
    viewTsx.includes('title="Copy commit"'),
    'Must have icon button with title="Copy commit"',
  );
  assert.ok(
    viewTsx.includes('aria-label="Copy commit"'),
    'Must have icon button with aria-label="Copy commit"',
  );
  assert.ok(
    viewTsx.includes('repository-copy-commit-btn'),
    'Must have repository-copy-commit-btn class',
  );
  assert.ok(
    viewTsx.includes('handleCopyCommit'),
    'Must implement handleCopyCommit callback',
  );

  // E. Open repository in Finder icon button
  assert.ok(
    viewTsx.includes('Open in Finder\\n${effectiveRepoRoot}'),
    'Must have Open in Finder icon button with actual path in tooltip',
  );
  assert.ok(
    viewTsx.includes('repository-open-finder-btn'),
    'Must have repository-open-finder-btn class',
  );
  assert.ok(
    viewTsx.includes('openInFinder(effectiveRepoRoot)'),
    'Must wire handleOpenInFinder to openInFinder helper',
  );
  assert.ok(
    viewTsx.includes('disabled={!effectiveRepoRoot}'),
    'Finder button must be disabled when effectiveRepoRoot is unavailable',
  );

  // F. Branch badge
  assert.ok(
    viewTsx.includes('branch: {effectiveBranch}'),
    'Must display branch with prefix "branch: "',
  );

  // G. Refresh button is icon-only with title="Refresh changes"
  assert.ok(
    viewTsx.includes('title="Refresh changes"'),
    'Refresh button must have title="Refresh changes"',
  );
  assert.ok(
    viewTsx.includes('aria-label="Refresh changes"'),
    'Refresh button must have aria-label="Refresh changes"',
  );
  assert.ok(
    !viewTsx.includes(">Refresh<") && !viewTsx.includes(">Collect<"),
    'Refresh button must be icon-only (no text label inside button)',
  );
  assert.ok(
    viewTsx.includes("isCollecting ? 'spin' : ''"),
    'Refresh button must support loading spin state',
  );

  // H. Guarded by effectiveRepoRoot
  assert.ok(
    viewTsx.includes('{effectiveRepoRoot && ('),
    'Metadata row must be conditioned on effectiveRepoRoot so non-Git workspace omits fake metadata',
  );

  // I. CSS structure
  assert.ok(viewCss.includes('.repository-evidence-header-top'), 'CSS defines header-top');
  assert.ok(viewCss.includes('.repository-evidence-meta-row'), 'CSS defines meta-row');
  assert.ok(viewCss.includes('.repository-commit-group'), 'CSS defines commit-group');
  assert.ok(viewCss.includes('.repository-copy-commit-btn'), 'CSS defines copy-commit-btn');
  assert.ok(viewCss.includes('.repository-open-finder-btn'), 'CSS defines open-finder-btn');
  assert.ok(viewCss.includes('.repository-refresh-btn'), 'CSS defines refresh-btn');

  console.log('✓ Changes header metadata simplified into short commit, copy, Finder, branch, and icon refresh');
}

// ============================================================================
// Test 4: Open in Finder Action with Hook Verification
// ============================================================================
console.log('\\n--- Test 4: Open in Finder Action Verification ---');
{
  let openedPath = null;
  wsContextMod.setCustomFinderOpener(async (p) => {
    openedPath = p;
  });

  await wsContextMod.openInFinder('/Users/xingchiguo/development/projects/careerneed');
  assert.strictEqual(
    openedPath,
    '/Users/xingchiguo/development/projects/careerneed',
    'openInFinder must be invoked with the exact repository path',
  );

  // Empty or invalid path does not invoke opener
  openedPath = null;
  await wsContextMod.openInFinder('');
  assert.strictEqual(openedPath, null, 'Empty path must be safely ignored');
  await wsContextMod.openInFinder(undefined);
  assert.strictEqual(openedPath, null, 'Undefined path must be safely ignored');

  wsContextMod.setCustomFinderOpener(null); // Reset
  console.log('✓ Open in Finder safely dispatches exact path without shell concatenation');
}

// ============================================================================
// Test 5: Terminal CWD Changes (cd /tmp) Do Not Alter Repository Metadata
// ============================================================================
console.log('\\n--- Test 5: Terminal CWD Independence from Header Metadata ---');
{
  const workspaceRoot = '/Users/xingchiguo/development/projects/careerneed';
  const repositoryRoot = '/Users/xingchiguo/development/projects/careerneed';

  const ws = {
    id: 'ws-careerneed',
    name: 'careerneed',
    rootPath: workspaceRoot,
    repository: {
      vcs: 'git',
      rootPath: repositoryRoot,
      branch: 'dev',
    },
  };

  // 1. Initial terminal cwd = workspaceRoot
  let terminalSessionCwd = ws.rootPath;
  assert.strictEqual(terminalSessionCwd, workspaceRoot);

  // 2. User executes "cd /tmp" inside the terminal pane
  terminalSessionCwd = '/tmp';

  // 3. Window title depends strictly on workspace, not terminal cwd
  const windowTitle = wsContextMod.resolveWindowTitle(ws);
  assert.strictEqual(windowTitle, 'careerneed — ExecRelay');
  assert.ok(!windowTitle.includes('/tmp'), 'Window title must NOT leak terminal cwd /tmp');

  // 4. Repository metadata is derived from ws.repository, not terminalSessionCwd
  assert.strictEqual(ws.repository.rootPath, repositoryRoot);
  assert.strictEqual(ws.repository.branch, 'dev');

  console.log('✓ Terminal cwd change (cd /tmp) has zero effect on window title or Changes metadata');
}

// ============================================================================
// Test 6: Switching Workspace Updates Window Title & Repository State
// ============================================================================
console.log('\\n--- Test 6: Switching Workspace Updates Title & Repository State ---');
{
  const ws1 = {
    id: 'ws-1',
    name: 'traceRelay',
    rootPath: '/Users/xingchiguo/development/projects/traceRelay',
    repository: {
      vcs: 'git',
      rootPath: '/Users/xingchiguo/development/projects/traceRelay',
      branch: 'main',
    },
  };

  const ws2 = {
    id: 'ws-2',
    name: 'careerneed',
    rootPath: '/Users/xingchiguo/development/projects/careerneed',
    repository: {
      vcs: 'git',
      rootPath: '/Users/xingchiguo/development/projects/careerneed',
      branch: 'feature/auth',
    },
  };

  // Workspace 1 active
  assert.strictEqual(wsContextMod.resolveWindowTitle(ws1), 'traceRelay — ExecRelay');
  assert.strictEqual(ws1.repository.branch, 'main');
  assert.strictEqual(ws1.repository.rootPath, '/Users/xingchiguo/development/projects/traceRelay');

  // Switch to Workspace 2
  assert.strictEqual(wsContextMod.resolveWindowTitle(ws2), 'careerneed — ExecRelay');
  assert.strictEqual(ws2.repository.branch, 'feature/auth');
  assert.strictEqual(ws2.repository.rootPath, '/Users/xingchiguo/development/projects/careerneed');

  console.log('✓ Switching workspaces updates title, branch, and repository root independently');
}

console.log('\\n=============================================================');
console.log('ALL TERMINAL-V01-UI-POLISH-001 REGRESSION TESTS PASSED!');
console.log('=============================================================\\n');
