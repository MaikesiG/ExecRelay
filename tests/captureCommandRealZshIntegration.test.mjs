import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const typescriptPath = path.resolve(repoRoot, 'app/node_modules/typescript');
const ts = require(typescriptPath);

function loadTs(absolutePath, requireOverrides = {}) {
  const source = fs.readFileSync(absolutePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (specifier) => requireOverrides[specifier] ?? require(specifier);
  new Function('module', 'exports', 'require', output)(mod, mod.exports, localRequire);
  return mod.exports;
}

const {
  bufferPendingTerminalInput,
  consumeTrustedCommandStart,
  resetCommandBoundaryRuntime,
  transitionShellLifecycle,
} = loadTs(path.resolve(repoRoot, 'app/src/features/terminal/commandBoundaryReconciler.ts'));

const { ShellIntegrationStreamParser } = loadTs(
  path.resolve(repoRoot, 'app/src/features/terminal/shellIntegration.ts'),
);

const formatSrc = fs.readFileSync(
  path.resolve(repoRoot, 'app/src/features/transcript/transcriptFormat.ts'),
  'utf8',
);
const formatJs = ts.transpileModule(formatSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const formatMod = { exports: {} };
new Function('module', 'exports', 'require', formatJs)(formatMod, formatMod.exports, () => ({}));
const normalizeCommand = formatMod.exports.normalizeCommand;

console.log('Running CAPTURE-COMMAND-001R3 Real Zsh Integration Tests...');

// Verify that zsh is installed on the host
const zshCheck = spawnSync('which', ['zsh']);
assert.strictEqual(zshCheck.status, 0, 'zsh binary must be installed on macOS host');

const nonce = `test-r3-nonce-${Date.now()}`;
const tempDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'tracerelay-test-zsh-'));

// Read zshrc template directly from native/src/terminal/shell.rs to guarantee identical integration
const nativeShellRs = fs.readFileSync(
  path.resolve(repoRoot, 'native/src/terminal/shell.rs'),
  'utf8',
);
const zshrcMatch = nativeShellRs.match(/let zshrc = r#"(.*?)"#;/s);
assert.ok(zshrcMatch, 'Failed to extract zshrc template from native/src/terminal/shell.rs');
const zshrcContent = zshrcMatch[1];

fs.writeFileSync(path.join(tempDir, '.zshrc'), zshrcContent, 'utf8');
fs.writeFileSync(path.join(tempDir, '.zshenv'), '', 'utf8');
fs.writeFileSync(path.join(tempDir, '.zprofile'), '', 'utf8');

// Python runner script to execute real commands in an interactive PTY session with event-driven synchronization
const pythonRunner = `
import pty, os, time, select, json, sys

master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    import fcntl, termios
    try: fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    except: pass
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(slave)
    os.chdir("${repoRoot.replace(/\\/g, '\\\\')}")
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["TRACERELAY_SHELL_NONCE"] = "${nonce}"
    env["TRACERELAY_SHELL_INTEGRATION"] = "1"
    env["TRACERELAY_ORIG_ZDOTDIR"] = ""
    env["ZDOTDIR"] = "${tempDir.replace(/\\/g, '\\\\')}"
    os.execve("/bin/zsh", ["/bin/zsh", "-l"], env)
else:
    os.close(slave)
    nonce_b = "${nonce}".encode("utf-8")

    def read_until(pattern, timeout=8.0):
        chunks = []
        end_time = time.time() + timeout
        while time.time() < end_time:
            r, _, _ = select.select([master], [], [], 0.03)
            if r:
                try:
                    data = os.read(master, 4096)
                    if not data: break
                    chunks.append(data)
                    combined = b"".join(chunks)
                    if pattern in combined:
                        # Allow slight drain window for trailing escape bytes or prompt echoes
                        time.sleep(0.04)
                        while True:
                            r2, _, _ = select.select([master], [], [], 0.03)
                            if not r2: break
                            more = os.read(master, 4096)
                            if not more: break
                            chunks.append(more)
                        return b"".join(chunks)
                except OSError: break
        return b"".join(chunks)

    # 1. Event-driven wait for initial prompt marker: OSC 133 A with session nonce
    init_pattern = b"\\x1b]133;A;aid=" + nonce_b + b"\\x07"
    init_bytes = read_until(init_pattern, timeout=8.0)

    # 2. Multiline printf test
    os.write(master, b"printf '%s\\\\n' \\\\\\r")
    time.sleep(0.05)
    os.write(master, b"  \\"one\\" \\\\\\r")
    time.sleep(0.05)
    os.write(master, b"  \\"two\\" \\\\\\r")
    time.sleep(0.05)
    os.write(master, b"  \\"three\\"\\r")
    # Event-driven wait for completion marker: OSC 133 D;0 with session nonce
    printf_done_pattern = b"\\x1b]133;D;0;aid=" + nonce_b + b"\\x07"
    printf_bytes = read_until(printf_done_pattern, timeout=8.0)

    # 3. Multiline pipeline test
    os.write(master, b"printf 'c\\\\na\\\\nb\\\\n' |\\r")
    time.sleep(0.05)
    os.write(master, b"sort |\\r")
    time.sleep(0.05)
    os.write(master, b"head -n 2\\r")
    # Event-driven wait for pipeline completion marker
    pipeline_bytes = read_until(printf_done_pattern, timeout=8.0)

    os.close(master)
    os.kill(pid, 9)

    result = {
        "init": list(init_bytes),
        "printf": list(printf_bytes),
        "pipeline": list(pipeline_bytes),
    }
    sys.stdout.write(json.dumps(result))
`;

const pyProc = spawnSync('python3', ['-c', pythonRunner], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
assert.strictEqual(pyProc.status, 0, `Python PTY harness failed: ${pyProc.stderr}`);

const rawResults = JSON.parse(pyProc.stdout);
const initChunk = Buffer.from(rawResults.init).toString('utf8');
const printfChunk = Buffer.from(rawResults.printf).toString('utf8');
const pipelineChunk = Buffer.from(rawResults.pipeline).toString('utf8');

// Cleanup temporary directory
fs.rmSync(tempDir, { recursive: true, force: true });

// --- Test 1: Real Zsh Startup Emits Trusted Initialization Marker ---
const parser = new ShellIntegrationStreamParser(nonce);
const initResult = parser.parse(initChunk);
const hasTrustedPrompt = initResult.events.some(
  (ev) => ev.trust === 'trusted' && (ev.type === 'prompt-start' || ev.type === 'command-end'),
);
assert.ok(hasTrustedPrompt, 'Real zsh startup must emit trusted lifecycle marker with matching nonce');
console.log('  [Real Zsh - Startup]: PASSED (trusted marker with nonce verified)');

// --- Test 2: Real Multiline Printf Emits Exactly One Trusted C With Full Payload ---
const printfResult = parser.parse(printfChunk);
const printfStarts = printfResult.events.filter((ev) => ev.type === 'command-start');
assert.strictEqual(printfStarts.length, 1, `Expected exactly 1 command-start, got ${printfStarts.length}`);
assert.strictEqual(printfStarts[0].trust, 'trusted', 'Marker must be authenticated with session nonce');

const expectedPrintfCommand = ["printf '%s\\n' \\", '  "one" \\', '  "two" \\', '  "three"'].join('\n');
assert.strictEqual(
  printfStarts[0].command,
  expectedPrintfCommand,
  'Command payload in OSC C must contain entire multiline logical command',
);

const printfEnds = printfResult.events.filter((ev) => ev.type === 'command-end');
assert.strictEqual(printfEnds.length, 1, `Expected exactly 1 command-end, got ${printfEnds.length}`);
assert.strictEqual(printfEnds[0].trust, 'trusted');
assert.strictEqual(printfEnds[0].exitCode, 0, 'Printf command must exit with 0');
console.log('  [Real Zsh - Multiline Printf Payload]: PASSED');

// --- Test 3: Real Pipeline Emits Exactly One Trusted C With Full Payload ---
const pipelineResult = parser.parse(pipelineChunk);
const pipelineStarts = pipelineResult.events.filter((ev) => ev.type === 'command-start');
assert.strictEqual(pipelineStarts.length, 1, `Expected exactly 1 command-start for pipeline, got ${pipelineStarts.length}`);
assert.strictEqual(pipelineStarts[0].trust, 'trusted');

const expectedPipelineCommand = ["printf 'c\\na\\nb\\n' |", 'sort |', 'head -n 2'].join('\n');
assert.strictEqual(
  pipelineStarts[0].command,
  expectedPipelineCommand,
  'Command payload in OSC C must contain entire multiline pipeline command',
);

const pipelineEnds = pipelineResult.events.filter((ev) => ev.type === 'command-end');
assert.strictEqual(pipelineEnds.length, 1, `Expected exactly 1 command-end for pipeline, got ${pipelineEnds.length}`);
assert.strictEqual(pipelineEnds[0].trust, 'trusted');
assert.strictEqual(pipelineEnds[0].exitCode, 0, 'Pipeline command must exit with 0');
console.log('  [Real Zsh - Multiline Pipeline Payload]: PASSED');

// --- Test 4: End-to-End Execution Reconciliation Harness Matching App.tsx Exactly ---
function createSimulatedCaptureHarness(initialState = 'initializing') {
  const runtime = {
    shellLifecycleState: initialState,
    inputBuffer: '',
    pendingExecutionInput: null,
    activeBlockId: null,
    activeBlockParser: null,
    blocks: [],
  };
  const streamParser = new ShellIntegrationStreamParser(nonce);

  function commitCommand(rawCommand, cleanCommand) {
    if (cleanCommand.length > 0) {
      const blockId = `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      runtime.blocks.push({
        id: blockId,
        command: cleanCommand,
        rawCommand,
        output: '',
        isComplete: false,
        exitCode: null,
        outcome: 'unknown',
      });
      runtime.activeBlockId = blockId;
      runtime.activeBlockParser = { command: cleanCommand, buffer: '' };
    }
  }

  function handleTerminalInput(data, options) {
    if (
      runtime.shellLifecycleState !== 'fallback' &&
      !options?.trustedBoundary
    ) {
      bufferPendingTerminalInput(runtime, data, options);
      return;
    }

    if (options?.trustedBoundary) {
      const rawCommand = data.endsWith('\r') ? data.slice(0, -1) : data;
      const cleanCommand = normalizeCommand(rawCommand);
      commitCommand(rawCommand, cleanCommand);
      return;
    }

    // Physical fallback loop:
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      if (char === '\r' || char === '\n') {
        const raw = runtime.inputBuffer;
        runtime.inputBuffer = '';
        const clean = normalizeCommand(raw);
        commitCommand(raw, clean);
      } else if (char >= ' ' || char === '\t') {
        runtime.inputBuffer += char;
      }
    }
  }

  function handleTerminalOutput(rawChunk) {
    const { cleanText, events, orderedParts } = streamParser.parse(rawChunk);
    for (const part of orderedParts) {
      for (const ev of part.events) {
        if (ev.trust === 'trusted') {
          transitionShellLifecycle(runtime, 'trusted');
        }
        if (ev.type === 'command-start' && ev.trust === 'trusted') {
          const reconciliation = consumeTrustedCommandStart(runtime);
          const logicalCommand = ev.command ?? reconciliation.bufferedInput;
          if (logicalCommand) {
            handleTerminalInput(logicalCommand, {
              ...reconciliation.pendingInput,
              trustedBoundary: true,
            });
          }
        } else if (ev.type === 'command-end' && ev.trust === 'trusted') {
          const active = runtime.blocks.find((b) => b.id === runtime.activeBlockId);
          if (active) {
            active.output = runtime.activeBlockParser?.buffer ?? '';
            active.exitCode = ev.exitCode;
            active.outcome = ev.exitCode === 0 ? 'succeeded' : 'failed';
            active.isComplete = true;
          }
          runtime.activeBlockId = null;
          runtime.activeBlockParser = null;
        }
      }
      if (part.cleanText && runtime.activeBlockParser) {
        runtime.activeBlockParser.buffer += part.cleanText;
      }
    }
  }

  return { runtime, handleTerminalInput, handleTerminalOutput };
}

// Exercise Multiline Printf through End-to-End Reconciliation
const printfHarness = createSimulatedCaptureHarness('initializing');
printfHarness.handleTerminalOutput(initChunk);
assert.strictEqual(printfHarness.runtime.shellLifecycleState, 'trusted', 'Must be trusted after shell startup');

// Simulate user typing continuation lines in PTY
for (const line of ["printf '%s\\n' \\\r", '  "one" \\\r', '  "two" \\\r', '  "three"\r']) {
  printfHarness.handleTerminalInput(line);
}
assert.strictEqual(printfHarness.runtime.blocks.length, 0, 'No blocks must be created from physical continuation lines');

// Receive real PTY output from zsh
printfHarness.handleTerminalOutput(printfChunk);
assert.strictEqual(printfHarness.runtime.blocks.length, 1, 'Exactly ONE Execution block must be created for multiline command');
assert.strictEqual(printfHarness.runtime.blocks[0].command, expectedPrintfCommand);
assert.strictEqual(printfHarness.runtime.blocks[0].exitCode, 0);
assert.strictEqual(printfHarness.runtime.blocks[0].outcome, 'succeeded');
assert.ok(printfHarness.runtime.blocks[0].output.includes('one\r\ntwo\r\nthree'));
console.log('  [Reconciliation - Real Multiline Printf]: PASSED (1 Execution, 0 continuation blocks, exitCode 0)');

// Exercise Pipeline through End-to-End Reconciliation
const pipelineHarness = createSimulatedCaptureHarness('trusted');
for (const line of ["printf 'c\\na\\nb\\n' |\r", 'sort |\r', 'head -n 2\r']) {
  pipelineHarness.handleTerminalInput(line);
}
assert.strictEqual(pipelineHarness.runtime.blocks.length, 0, 'No blocks from pipeline continuation lines');

pipelineHarness.handleTerminalOutput(pipelineChunk);
assert.strictEqual(pipelineHarness.runtime.blocks.length, 1, 'Exactly ONE Execution block must be created for pipeline');
assert.strictEqual(pipelineHarness.runtime.blocks[0].command, expectedPipelineCommand);
assert.strictEqual(pipelineHarness.runtime.blocks[0].exitCode, 0);
assert.strictEqual(pipelineHarness.runtime.blocks[0].outcome, 'succeeded');
console.log('  [Reconciliation - Real Pipeline]: PASSED (1 Execution, 0 continuation blocks, exitCode 0)');

// --- Test 5: Unsupported Shell Fallback Preserves Physical-Line Segmentation ---
const fallbackHarness = createSimulatedCaptureHarness('fallback');
fallbackHarness.handleTerminalInput('echo first\r');
fallbackHarness.handleTerminalInput('echo second\r');
assert.strictEqual(fallbackHarness.runtime.blocks.length, 2, 'Fallback shell must segment by physical line');
assert.strictEqual(fallbackHarness.runtime.blocks[0].command, 'echo first');
assert.strictEqual(fallbackHarness.runtime.blocks[1].command, 'echo second');
console.log('  [Reconciliation - Unsupported Shell Fallback]: PASSED');

// --- Test 6: App.tsx Source Invariants Audit ---
const appSource = fs.readFileSync(path.resolve(repoRoot, 'app/src/App.tsx'), 'utf8');
assert.match(appSource, /options\?\.trustedBoundary/);
assert.match(appSource, /const commitCommand =/);
assert.match(appSource, /handleTerminalInput\(\s*workspaceId,\s*terminalTabId,\s*terminalPaneId,\s*logicalCommand,/);

console.log('\n=============================================================');
console.log('ALL CAPTURE-COMMAND-001R3 REAL ZSH INTEGRATION TESTS PASSED!');
console.log('=============================================================');
