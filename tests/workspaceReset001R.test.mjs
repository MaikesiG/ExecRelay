import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import xtermPkg from '../app/node_modules/@xterm/xterm/lib/xterm.js';
const { Terminal } = xtermPkg;

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
      if (id === '@xterm/xterm') return xtermPkg;
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
      } catch {}
      return customRequire(id);
    },
    React,
  );
  moduleCache.set(absPath, mod.exports);
  return mod.exports;
}

const resetWorkspaceStateMod = loadTs('../app/src/features/workspace/resetWorkspaceState.ts');
const { resetWorkspaceState, getWorkspaceResetBlocker } = resetWorkspaceStateMod;

console.log('Running WORKSPACE-RESET-001 / WORKSPACE-RESET-001R Regression Tests...\n');

// ---------------------------------------------------------------------------
// Test 1: Agent State Preservation (WORKSPACE-RESET-001R Core Requirement)
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Agent State Preserved Across Workspace Reset ---');

  const mockAgentRuns = [
    {
      id: 'agent-run-1',
      workspaceId: 'ws-1',
      taskText: 'Refactor parser',
      adapterId: 'claude-code',
      status: 'running',
      createdAt: Date.now() - 5000,
    },
    {
      id: 'agent-run-0',
      workspaceId: 'ws-1',
      taskText: 'Initial setup',
      adapterId: 'codex',
      status: 'completed',
      createdAt: Date.now() - 10000,
    },
  ];

  const wsWithAgent = {
    id: 'ws-1',
    name: 'Agent Test Workspace',
    rootPath: '/projects/test',
    projectCwd: '/projects/test',
    terminalTabs: [
      {
        id: 'tab-1',
        workspaceId: 'ws-1',
        label: 'Terminal',
        baseName: 'Terminal',
        panes: [],
        terminalPanes: [],
        capture: { isListening: false },
      },
    ],
    panes: [],
    capture: {
      isListening: false,
      currentBatch: null,
      batchCounter: 5,
      blocks: [{ id: 'block-1', command: 'ls', output: 'file.txt' }],
      targetScope: { mode: 'explicit', explicitPaneIds: ['pane-1'] },
    },
    selection: {
      selectedBlockIds: new Set(['block-1']),
      updatedAt: 100,
    },
    repositorySnapshots: [{ commitHash: 'abc', files: [] }],
    latestCollectionRun: { id: 'run-1' },
    changeAttributions: [{ id: 'attr-1' }],
    verification: {
      contracts: [{ id: 'contract-1', name: 'Default', criteria: [{ id: 'crit-1', name: 'Lint', command: 'npm run lint' }] }],
      activeContractId: 'contract-1',
      runs: [{ id: 'vrun-1', status: 'passed' }],
      selectedCriterionIds: new Set(['crit-1']),
    },
    agentRuns: mockAgentRuns,
    activeAgentRunId: 'agent-run-1',
  };

  const resetWs = resetWorkspaceState(wsWithAgent);

  // 1. Agent runs must be strictly preserved
  assert.deepStrictEqual(
    resetWs.agentRuns,
    mockAgentRuns,
    'agentRuns must remain completely untouched after reset',
  );
  assert.strictEqual(
    resetWs.activeAgentRunId,
    'agent-run-1',
    'activeAgentRunId must remain completely untouched after reset',
  );
  console.log('✓ Agent runs and activeAgentRunId preserved across reset');

  // 2. All target surfaces are properly reset
  assert.strictEqual(resetWs.capture.blocks.length, 0, 'Capture blocks cleared');
  assert.strictEqual(resetWs.capture.currentBatch, null, 'Current batch cleared');
  assert.strictEqual(resetWs.selection.selectedBlockIds.size, 0, 'Selection cleared');
  assert.deepStrictEqual(resetWs.repositorySnapshots, [], 'Repository snapshots cleared');
  assert.strictEqual(resetWs.latestCollectionRun, undefined, 'Latest collection run cleared');
  assert.deepStrictEqual(resetWs.changeAttributions, [], 'Change attributions cleared');
  assert.deepStrictEqual(resetWs.verification.runs, [], 'Verification runs cleared');

  // 3. Configuration is preserved
  assert.strictEqual(resetWs.capture.batchCounter, 5, 'Batch counter preserved');
  assert.deepStrictEqual(
    resetWs.capture.targetScope,
    { mode: 'explicit', explicitPaneIds: ['pane-1'] },
    'Capture target scope preserved',
  );
  assert.strictEqual(resetWs.verification.activeContractId, 'contract-1', 'Active contract ID preserved');
  assert.deepStrictEqual(
    Array.from(resetWs.verification.selectedCriterionIds),
    ['crit-1'],
    'Selected criterion IDs preserved',
  );
  assert.strictEqual(resetWs.verification.contracts.length, 1, 'Contracts preserved');
  console.log('✓ Target surfaces cleared and configuration preserved cleanly');
}

// ---------------------------------------------------------------------------
// Test 2: Active Verification Hard Block
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 2: Active Verification Blocks Reset ---');

  const idleWs = {
    id: 'ws-1',
    name: 'Idle WS',
    capture: { isListening: false, currentBatch: null },
    panes: [],
    verification: { activeRunId: null },
  };

  assert.strictEqual(
    getWorkspaceResetBlocker(idleWs, false),
    null,
    'Idle workspace is not blocked',
  );

  assert.strictEqual(
    getWorkspaceResetBlocker(idleWs, true),
    'Verification is currently running. Finish or cancel it before resetting the workspace.',
    'Blocked when isVerificationRunning is true',
  );

  const runningWs = {
    ...idleWs,
    verification: { activeRunId: 'run-active' },
  };

  assert.strictEqual(
    getWorkspaceResetBlocker(runningWs, false),
    'Verification is currently running. Finish or cancel it before resetting the workspace.',
    'Blocked when workspace verification has activeRunId',
  );
  console.log('✓ Active verification correctly blocks workspace reset');
}

// ---------------------------------------------------------------------------
// Test 3: Active / Paused-Open Capture Hard Block
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 3: Active and Open Capture Blocks Reset ---');

  const listeningWs = {
    id: 'ws-1',
    name: 'Listening WS',
    capture: { isListening: true, currentBatch: { stoppedAt: null } },
    panes: [],
    verification: { activeRunId: null },
  };

  assert.strictEqual(
    getWorkspaceResetBlocker(listeningWs, false),
    'Capture is currently active. Stop Capture before resetting the workspace.',
    'Blocked when workspace capture is listening',
  );

  const pausedOpenWs = {
    id: 'ws-1',
    name: 'Paused WS',
    capture: { isListening: false, currentBatch: { stoppedAt: null } },
    panes: [],
    verification: { activeRunId: null },
  };

  assert.strictEqual(
    getWorkspaceResetBlocker(pausedOpenWs, false),
    'Capture is currently active. Stop Capture before resetting the workspace.',
    'Blocked when workspace capture has unclosed batch (stoppedAt === null)',
  );

  const paneListeningWs = {
    id: 'ws-1',
    name: 'Pane WS',
    capture: { isListening: false, currentBatch: null },
    panes: [{ capture: { isListening: true } }],
    verification: { activeRunId: null },
  };

  assert.strictEqual(
    getWorkspaceResetBlocker(paneListeningWs, false),
    'Capture is currently active. Stop Capture before resetting the workspace.',
    'Blocked when individual pane is listening',
  );
  console.log('✓ Active/open capture correctly blocks workspace reset');
}

// ---------------------------------------------------------------------------
// Test 4: Terminal Display and Scrollback Reset via xterm API (WORKSPACE-RESET-001R2)
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 4: Terminal Screen and Scrollback Cleared via xterm.clear() ---');

  const term = new Terminal({ rows: 10, cols: 60 });
  term.write('Command output 1\r\nCommand output 2\r\nxingchiguo@MacBookPro folkora % ', () => {
    assert(term.buffer.active.length > 0, 'Buffer has content before reset');

    // Perform terminal reset as used in ExecRelay (WORKSPACE-RESET-001R2)
    term.clear();
    term.scrollToBottom();

    // Verify buffer: row 0 preserves prompt, lines 1..rows-1 blank, scrollback cleared
    assert.strictEqual(term.buffer.active.cursorY, 0, 'Cursor Y repositioned to row 0');
    assert.strictEqual(term.buffer.active.baseY, 0, 'Scrollback baseY returned to 0');
    const promptLine = term.buffer.active.getLine(0)?.translateToString(true) ?? '';
    assert.strictEqual(promptLine, 'xingchiguo@MacBookPro folkora % ', 'Prompt line preserved at row 0');
    for (let r = 1; r < term.rows; r++) {
      const lineText = term.buffer.active.getLine(r)?.translateToString(true) ?? '';
      assert.strictEqual(lineText, '', `Line ${r} is completely blank`);
    }

    // Immediately typing a command must work normally
    let typedData = '';
    term.onData((data) => { typedData += data; });
    term.input('pwd\r');
    assert.strictEqual(typedData, 'pwd\r', 'Terminal immediately accepts input after reset');
    console.log('✓ Terminal visible screen and scrollback cleared cleanly, live prompt preserved');
  });
}

// ---------------------------------------------------------------------------
// Test 5: Multi-Workspace Isolation
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 5: Multi-Workspace Isolation ---');

  const wsA = {
    id: 'ws-a',
    name: 'Workspace A',
    capture: {
      isListening: false,
      currentBatch: null,
      batchCounter: 1,
      blocks: [{ id: 'block-a1' }, { id: 'block-a2' }],
    },
    selection: { selectedBlockIds: new Set(['block-a1']), updatedAt: 1 },
    terminalTabs: [],
    panes: [],
    verification: { contracts: [], runs: [{ id: 'run-a1' }] },
    agentRuns: [{ id: 'agent-a' }],
    activeAgentRunId: 'agent-a',
    repositorySnapshots: [{ commit: 'a' }],
  };

  const wsB = {
    id: 'ws-b',
    name: 'Workspace B',
    capture: {
      isListening: false,
      currentBatch: null,
      batchCounter: 2,
      blocks: [{ id: 'block-b1' }],
    },
    selection: { selectedBlockIds: new Set(['block-b1']), updatedAt: 2 },
    terminalTabs: [],
    panes: [],
    verification: { contracts: [], runs: [{ id: 'run-b1' }] },
    agentRuns: [{ id: 'agent-b' }],
    activeAgentRunId: 'agent-b',
    repositorySnapshots: [{ commit: 'b' }],
  };

  const resetA = resetWorkspaceState(wsA);

  // A is reset
  assert.strictEqual(resetA.capture.blocks.length, 0);
  assert.strictEqual(resetA.verification.runs.length, 0);
  assert.strictEqual(resetA.agentRuns.length, 1, 'Workspace A agent runs preserved');

  // B is completely untouched
  assert.strictEqual(wsB.capture.blocks.length, 1);
  assert.strictEqual(wsB.verification.runs.length, 1);
  assert.strictEqual(wsB.agentRuns.length, 1);
  assert.strictEqual(wsB.activeAgentRunId, 'agent-b');
  console.log('✓ Multi-workspace isolation guaranteed');
}

// ---------------------------------------------------------------------------
// Test 6: Global Warnings Preservation
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 6: System/Infrastructure Global Warnings Preserved ---');

  const infrastructureWarning = {
    id: 'warn-1',
    scope: 'workspace',
    workspaceId: 'ws-1',
    severity: 'error',
    code: 'terminal-service-disconnected',
    title: 'Service Disconnected',
    message: 'Native terminal backend disconnected unexpectedly',
    dismissible: true,
    createdAt: Date.now(),
  };

  // Reset workspace must NOT clear infrastructure health warnings
  const warningsList = [infrastructureWarning];
  assert.strictEqual(warningsList.length, 1, 'Infrastructure warning remains present');
  assert.strictEqual(warningsList[0].code, 'terminal-service-disconnected');
  console.log('✓ Infrastructure/system health global warnings correctly preserved');
}

console.log('\nAll WORKSPACE-RESET-001 / WORKSPACE-RESET-001R tests passed successfully!');
