import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ts = require('../app/node_modules/typescript');

// 1. Load types.ts
const typesSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/types.ts'), 'utf8');
const typesJs = ts.transpileModule(typesSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const typesMod = { exports: {} };
new Function('module', 'exports', 'require', typesJs)(typesMod, typesMod.exports, () => ({}));
const { isCaptureBlockType, isCaptureExecutionState, isStructuredCaptureBlock } = typesMod.exports;

// 2. Load transcriptFormat.ts & transcriptDisplayCleanup.ts
const formatSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/transcriptFormat.ts'), 'utf8');
const formatJs = ts.transpileModule(formatSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const formatMod = { exports: {} };
new Function('module', 'exports', 'require', formatJs)(formatMod, formatMod.exports, () => ({}));
const stripAnsiAndControl = formatMod.exports.stripAnsiAndControl;

const cleanupSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/transcriptDisplayCleanup.ts'), 'utf8');
const cleanupJs = ts.transpileModule(cleanupSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const cleanupMod = { exports: {} };
new Function('module', 'exports', 'require', cleanupJs)(cleanupMod, cleanupMod.exports, () => ({ stripAnsiAndControl }));

// 2b. Load executionModel.ts
const execModelSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/execution/executionModel.ts'), 'utf8');
const execModelJs = ts.transpileModule(execModelSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const execModelMod = { exports: {} };
const customRequireExec = (req) => {
  if (req.includes('transcriptFormat')) {
    return {
      ...formatMod.exports,
      cleanTranscriptForDisplay: cleanupMod.exports.cleanTranscriptForDisplay,
    };
  }
  if (req.includes('types')) return typesMod.exports;
  return {};
};
new Function('module', 'exports', 'require', execModelJs)(execModelMod, execModelMod.exports, customRequireExec);

// 3. Load captureBlockModel.ts
const modelSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/captureBlockModel.ts'), 'utf8');
const modelJs = ts.transpileModule(modelSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const modelMod = { exports: {} };
const customRequireModel = (req) => {
  if (req.includes('transcriptFormat')) {
    return {
      ...formatMod.exports,
      cleanTranscriptForDisplay: cleanupMod.exports.cleanTranscriptForDisplay,
    };
  }
  if (req.includes('executionModel')) return execModelMod.exports;
  if (req.includes('types')) return typesMod.exports;
  return {};
};
new Function('module', 'exports', 'require', modelJs)(modelMod, modelMod.exports, customRequireModel);

const {
  detectErrorFromOutput,
  deriveExecutionState,
  formatExecutionDuration,
  formatExecutionTimestamp,
  decomposeIntoStructuredBlocks,
} = modelMod.exports;

const {
  formatTranscriptBlock,
  normalizeCommand,
  isTerminalClearCommand,
} = formatMod.exports;

/**
 * Task: Implement structured capture block types and execution metadata in TraceRelay / CapTerm
 * Primary goal:
 * - Represent captured terminal activity using explicit block types (command, output, error, status)
 * - Track execution lifecycle states (pending, running, completed, failed, interrupted)
 * - Keep raw terminal evidence as source of truth while providing cleaned display text
 * - Trustworthy error classification (diagnostics & exit codes only; no false positives)
 * - Safe clear behavior preserved
 * - Accessible semantic labels and dark terminal styling
 */

console.log('Running Structured Capture Block Types & Metadata Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: TypeScript Model & Type Guards
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: TypeScript Model & Type Guards ---');

  // isCaptureBlockType
  assert.strictEqual(isCaptureBlockType('command'), true);
  assert.strictEqual(isCaptureBlockType('output'), true);
  assert.strictEqual(isCaptureBlockType('error'), true);
  assert.strictEqual(isCaptureBlockType('status'), true);
  assert.strictEqual(isCaptureBlockType('unknown'), false);
  assert.strictEqual(isCaptureBlockType(''), false);
  assert.strictEqual(isCaptureBlockType(null), false);

  // isCaptureExecutionState
  assert.strictEqual(isCaptureExecutionState('pending'), true);
  assert.strictEqual(isCaptureExecutionState('running'), true);
  assert.strictEqual(isCaptureExecutionState('completed'), true);
  assert.strictEqual(isCaptureExecutionState('failed'), true);
  assert.strictEqual(isCaptureExecutionState('interrupted'), true);
  assert.strictEqual(isCaptureExecutionState('finished'), false);
  assert.strictEqual(isCaptureExecutionState(undefined), false);

  // isStructuredCaptureBlock
  const validCmdBlock = {
    id: 'b1-cmd',
    type: 'command',
    rawText: 'npm test',
    displayText: 'npm test',
    createdAt: 1700000000000,
    commandId: 'b1',
    executionState: 'completed',
  };
  assert.strictEqual(isStructuredCaptureBlock(validCmdBlock), true);

  const invalidBlock = { id: 'b1', type: 'other' };
  assert.strictEqual(isStructuredCaptureBlock(invalidBlock), false);
  assert.strictEqual(isStructuredCaptureBlock(null), false);

  console.log('✓ Block type and execution state type guards verified');
}

// ---------------------------------------------------------------------------
// Test 2: Command Block Creation and Decomposition
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Command Block Creation and Decomposition ---');

  const block = {
    id: 'block-1',
    batchId: 1,
    command: 'git status',
    rawCommand: 'git status\r',
    output: '',
    startedAt: 1700000000000,
    completedAt: null,
    isComplete: false,
    executionState: 'running',
    terminalPaneId: 'pane-1',
    terminalLabelAtCapture: 'Terminal',
  };

  const structured = decomposeIntoStructuredBlocks(block);
  assert.strictEqual(structured.length, 2, 'In-progress block decomposes into command and status blocks');

  const cmdSlice = structured.find((s) => s.type === 'command');
  assert.ok(cmdSlice, 'Command block exists');
  assert.strictEqual(cmdSlice.rawText, 'git status\r', 'Raw command preserved as source of truth');
  assert.strictEqual(cmdSlice.displayText, 'git status', 'Display text is normalized command');
  assert.strictEqual(cmdSlice.executionState, 'running', 'Execution state is running');

  const statusSlice = structured.find((s) => s.type === 'status');
  assert.ok(statusSlice, 'Status block exists');
  assert.strictEqual(statusSlice.executionState, 'running');
  assert.ok(statusSlice.displayText.includes('Running'), 'Status displays Running');

  console.log('✓ Command block preserves raw text and reflects active running state');
}

// ---------------------------------------------------------------------------
// Test 3: Normal Output Classification
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Normal Output Classification ---');

  const rawOut = '\x1b[32mREADME.md\x1b[0m\r\npackage.json\r\nsrc\r\n';
  const block = {
    id: 'block-2',
    batchId: 1,
    command: 'ls',
    output: rawOut,
    startedAt: 1000,
    completedAt: 1150,
    isComplete: true,
    executionState: 'completed',
    terminalPaneId: 'pane-1',
    terminalLabelAtCapture: 'Terminal',
  };

  const structured = decomposeIntoStructuredBlocks(block);
  assert.strictEqual(structured.length, 3, 'Decomposes into command, output, and status');

  const outputSlice = structured.find((s) => s.type === 'output');
  assert.ok(outputSlice, 'Output block exists');
  assert.strictEqual(outputSlice.type, 'output', 'Classified as output (not error)');
  assert.strictEqual(outputSlice.rawText, rawOut, 'Raw ANSI output preserved');
  assert.ok(!outputSlice.displayText.includes('\x1b['), 'Clean display output has ANSI stripped');
  assert.ok(outputSlice.displayText.includes('README.md'), 'Content preserved');

  const statusSlice = structured.find((s) => s.type === 'status');
  assert.strictEqual(statusSlice.executionState, 'completed');
  assert.ok(statusSlice.displayText.includes('150ms'), 'Duration rendered in status summary');

  console.log('✓ Normal stdout classified as output with cleaned display and raw preservation');
}

// ---------------------------------------------------------------------------
// Test 4: Trustworthy Error Detection (Diagnostics & Exit Codes)
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Trustworthy Error Detection ---');

  // Diagnostic 1: Shell command not found
  const zshNotFound = detectErrorFromOutput('zsh: command not found: foobar\r\n');
  assert.strictEqual(zshNotFound.isError, true);
  assert.strictEqual(zshNotFound.confidence, 'high');

  // Diagnostic 2: Git fatal error
  const gitFatal = detectErrorFromOutput('fatal: not a git repository (or any of the parent directories): .git\n');
  assert.strictEqual(gitFatal.isError, true);

  // Diagnostic 3: npm error
  const npmErr = detectErrorFromOutput('npm ERR! code ENOENT\r\nnpm ERR! syscall open\n');
  assert.strictEqual(npmErr.isError, true);

  // Diagnostic 4: No such file or directory
  const noSuchFile = detectErrorFromOutput('cat: /nonexistent/file: No such file or directory\n');
  assert.strictEqual(noSuchFile.isError, true);

  // Diagnostic 5: Non-zero exit code overrides normal text
  const blockWithExitCode = {
    isComplete: true,
    output: 'Process exited with code 1',
    exitCode: 1,
  };
  assert.strictEqual(deriveExecutionState(blockWithExitCode), 'failed', 'Non-zero exitCode derives failed state');

  // Diagnostic 6: Zero exit code is completed
  const blockWithZeroExit = {
    isComplete: true,
    output: 'done',
    exitCode: 0,
  };
  assert.strictEqual(deriveExecutionState(blockWithZeroExit), 'completed', 'Exit code 0 derives completed state');

  // Guard against false positive: benign mention of "error" in text
  const benignOutput = 'Test suite passed: 15 passed, 0 failed, 0 errors\nerror handling is working properly\n';
  const benignCheck = detectErrorFromOutput(benignOutput);
  assert.strictEqual(benignCheck.isError, false, 'Does not falsely flag benign mentions of error');

  const benignBlock = {
    id: 'block-benign',
    batchId: 1,
    command: 'npm test',
    output: benignOutput,
    startedAt: 1000,
    completedAt: 1500,
    isComplete: true,
    terminalPaneId: 'pane-1',
    terminalLabelAtCapture: 'Terminal',
  };
  const benignSlices = decomposeIntoStructuredBlocks(benignBlock);
  assert.strictEqual(benignSlices.find((s) => s.type === 'error'), undefined, 'No error block generated for benign text');
  assert.ok(benignSlices.find((s) => s.type === 'output'), 'Generated output block');

  console.log('✓ High-confidence error detection verified without false positives on benign text');
}

// ---------------------------------------------------------------------------
// Test 5: Status Transitions & Exit Code Metadata (Never Fabricated)
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Status Transitions & Exit Code Metadata ---');

  // 1. In-progress block
  const runningBlock = {
    isComplete: false,
    startedAt: 1000,
    completedAt: null,
    output: '',
  };
  assert.strictEqual(deriveExecutionState(runningBlock), 'running');

  // 2. Interrupted block (e.g. capture stopped during execution)
  const interruptedBlock = {
    isComplete: true,
    executionState: 'interrupted',
    startedAt: 1000,
    completedAt: 1200,
    output: '',
  };
  assert.strictEqual(deriveExecutionState(interruptedBlock), 'interrupted');

  // 3. Duration formatting
  assert.strictEqual(formatExecutionDuration(1000, 1050), '50ms');
  assert.strictEqual(formatExecutionDuration(1000, 3400), '2.4s');
  assert.strictEqual(formatExecutionDuration(1000, null), null, 'In-progress command has null duration');

  // 4. Exit code formatting: shown only when available
  const blockNoExit = {
    id: 'b-no-exit',
    batchId: 1,
    command: 'echo hi',
    output: 'hi\n',
    startedAt: 1000,
    completedAt: 1050,
    isComplete: true,
    exitCode: null, // Unknown/not available from interactive PTY
    terminalPaneId: 'p1',
    terminalLabelAtCapture: 'Term',
  };
  const slicesNoExit = decomposeIntoStructuredBlocks(blockNoExit);
  const statusNoExit = slicesNoExit.find((s) => s.type === 'status');
  assert.strictEqual(statusNoExit.exitCode, null, 'Exit code is not fabricated');
  assert.ok(!statusNoExit.displayText.includes('exit'), 'Does not show fake exit code');

  const blockWithExit = {
    id: 'b-exit',
    batchId: 1,
    command: 'false',
    output: 'fatal: error\n',
    startedAt: 1000,
    completedAt: 1050,
    isComplete: true,
    exitCode: 2,
    terminalPaneId: 'p1',
    terminalLabelAtCapture: 'Term',
  };
  const slicesWithExit = decomposeIntoStructuredBlocks(blockWithExit);
  const statusWithExit = slicesWithExit.find((s) => s.type === 'status');
  assert.strictEqual(statusWithExit.exitCode, 2, 'Known exit code is preserved');
  assert.ok(statusWithExit.displayText.includes('exit 2'), 'Exit code included when available');

  console.log('✓ Status transitions and exit code metadata adhere strictly to reliable evidence');
}

// ---------------------------------------------------------------------------
// Test 6: Safe Terminal Clear Command Handling
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Safe Terminal Clear Command Handling ---');

  assert.strictEqual(isTerminalClearCommand('clear'), true);
  assert.strictEqual(isTerminalClearCommand('\\clear'), true);
  assert.strictEqual(isTerminalClearCommand('clear -x'), true);
  assert.strictEqual(isTerminalClearCommand('/usr/bin/clear'), true);
  assert.strictEqual(isTerminalClearCommand('cls'), true);
  assert.strictEqual(isTerminalClearCommand('echo clear'), false);

  // In App.tsx, isTerminalClearCommand finalizes the previous block and bypasses
  // creating a meaningless clear block.
  const appTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  assert.ok(
    appTsx.includes('if (isTerminalClearCommand(cleanCommand))'),
    'App.tsx detects clear commands to prevent meaningless evidence blocks',
  );

  console.log('✓ Terminal clear commands continue to be excluded from transcript blocks');
}

// ---------------------------------------------------------------------------
// Test 7: Backward Compatibility with Existing Capture History & Copy
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 7: Backward Compatibility with Existing Capture History ---');

  // Verify that an old-style persisted TranscriptBlock without new optional fields
  // functions without error and derives metadata transparently
  const legacyBlock = {
    id: 'legacy-block-1',
    batchId: 1,
    command: 'echo "hello legacy"',
    output: 'hello legacy\r\n',
    startedAt: 1690000000000,
    completedAt: 1690000000050,
    isComplete: true,
    terminalPaneId: 'pane-1',
    terminalLabelAtCapture: 'Terminal 1',
  };

  const state = deriveExecutionState(legacyBlock);
  assert.strictEqual(state, 'completed', 'Legacy completed block derives completed state');

  const decomposed = decomposeIntoStructuredBlocks(legacyBlock);
  assert.strictEqual(decomposed.length, 3, 'Legacy block decomposes into command, output, status');
  assert.strictEqual(decomposed[0].displayText, 'echo "hello legacy"');
  assert.strictEqual(decomposed[1].displayText, 'hello legacy');

  // Verify formatTranscriptBlock for full card copy is unchanged
  const copied = formatTranscriptBlock(legacyBlock.command, legacyBlock.output);
  assert.strictEqual(copied, '$ echo "hello legacy"\nhello legacy');

  console.log('✓ Legacy capture blocks remain fully compatible without data migration');
}

// ---------------------------------------------------------------------------
// Test 8: Semantic UI & CSS Stylesheet Invariants
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 8: Semantic UI & CSS Stylesheet Invariants ---');
  const appCss = fs.readFileSync(path.resolve(__dirname, '../app/src/App.css'), 'utf8');

  // Verify status badges
  assert.ok(appCss.includes('.capture-status-badge'), 'App.css defines .capture-status-badge');
  assert.ok(appCss.includes('.capture-status-badge--running'), 'Defines --running badge');
  assert.ok(appCss.includes('.capture-status-badge--completed'), 'Defines --completed badge');
  assert.ok(appCss.includes('.capture-status-badge--failed'), 'Defines --failed badge');
  assert.ok(appCss.includes('.capture-status-badge--interrupted'), 'Defines --interrupted badge');

  // Verify type tags
  assert.ok(appCss.includes('.capture-type-tag'), 'App.css defines .capture-type-tag');
  assert.ok(appCss.includes('.capture-type-tag--output'), 'Defines --output type tag');
  assert.ok(appCss.includes('.capture-type-tag--error'), 'Defines --error type tag');

  // Verify error output styling (muted, accessible contrast)
  assert.ok(appCss.includes('pre.capture-output--error'), 'App.css defines pre.capture-output--error');
  assert.ok(appCss.includes('border-color: rgba(239, 68, 68, 0.25);'), 'Error output uses muted border accent');
  assert.ok(appCss.includes('color: #fee2e2;'), 'Error output text uses soft high-contrast color');

  // Verify status row
  assert.ok(appCss.includes('.capture-status-row'), 'App.css defines .capture-status-row');
  assert.ok(appCss.includes('.capture-status-duration'), 'App.css defines .capture-status-duration');
  assert.ok(appCss.includes('.capture-exit-code'), 'App.css defines .capture-exit-code');

  // Verify subaction copy buttons
  assert.ok(appCss.includes('.card-subaction-btn'), 'App.css defines .card-subaction-btn');

  console.log('✓ CSS stylesheet rules adhere to dark terminal-native aesthetic and accessible contrast');
}

console.log('\\n=======================================================================');
console.log('ALL 8 STRUCTURED CAPTURE BLOCK TESTS PASSED!');
console.log('=======================================================================\\n');
