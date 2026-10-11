import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

function loadTs(relativePath, requireOverrides = {}) {
  const absolutePath = path.resolve(__dirname, relativePath);
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
  shellLifecycleStateFromAvailability,
  transitionShellLifecycle,
} = loadTs('../app/src/features/terminal/commandBoundaryReconciler.ts');
const { ShellIntegrationStreamParser } = loadTs(
  '../app/src/features/terminal/shellIntegration.ts',
);
const { buildDeterministicPrompt } = loadTs(
  '../app/src/features/promptComposer/promptBuilder.ts',
);
const { sortResolvedEvidenceItems } = loadTs(
  '../app/src/features/evidenceSelection/evidenceClipboardFormatter.ts',
  {
    '../evidenceCollectors/repositoryEvidenceCopy': {
      fenceCode: (text) => text,
      getLanguageForPath: () => '',
    },
  },
);

const nonce = 'capture-command-reconciliation-nonce';
const commands = {
  multiline: [
    "printf '%s\\n' \\",
    '  "one" \\',
    '  "two" \\',
    '  "three"',
  ].join('\n'),
  pipeline: ["printf 'c\\na\\nb\\n' |", 'sort |', 'head -n 2'].join('\n'),
  substitution: ['VALUE=$(', '  printf hello', ')'].join('\n'),
  heredoc: ["cat <<'EOF'", 'hello', 'world', 'EOF'].join('\n'),
};

const encodeCommandStart = (command, markerNonce = nonce) =>
  `\x1b]133;C;aid=${markerNonce};cmd=${Buffer.from(command).toString('base64')}\x07`;
const encodePromptStart = (markerNonce = nonce) =>
  `\x1b]133;A;aid=${markerNonce}\x07`;
const encodeCommandEnd = (exitCode, markerNonce = nonce) =>
  `\x1b]133;D;${exitCode};aid=${markerNonce}\x07`;

function createHarness(paneId = 'pane', initialState = 'initializing') {
  const state = {
    shellLifecycleState: initialState,
    inputBuffer: '',
    pendingExecutionInput: null,
  };
  const parser = new ShellIntegrationStreamParser(nonce);
  const executions = [];
  let activeExecutionId = null;
  let nextSequence = 1;

  function createExecution(command, metadata = {}) {
    const id = metadata.executionId ?? `${paneId}-execution-${nextSequence}`;
    executions.push({
      id,
      sequence: nextSequence++,
      paneId,
      command,
      intent: metadata.intent ?? 'interactive',
      verificationRunId: metadata.verificationRunId,
      verificationCriterionId: metadata.verificationCriterionId,
      outcome: 'unknown',
      exitCode: null,
    });
    activeExecutionId = id;
  }

  function feedFallbackInput(data, metadata = {}) {
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        if (state.inputBuffer.trim()) {
          createExecution(state.inputBuffer.trim(), metadata);
        }
        state.inputBuffer = '';
      } else if (char === '\x7f' || char === '\b') {
        state.inputBuffer = state.inputBuffer.slice(0, -1);
      } else if (char === '\x03') {
        state.inputBuffer = '';
      } else if (char >= ' ' || char === '\t') {
        state.inputBuffer += char;
      }
    }
  }

  function transition(nextState) {
    const replay = transitionShellLifecycle(state, nextState);
    if (replay) {
      feedFallbackInput(replay.data, replay.pendingInput ?? {});
    }
  }

  function onData(data, metadata) {
    if (state.shellLifecycleState === 'fallback') {
      feedFallbackInput(data, metadata);
    } else {
      bufferPendingTerminalInput(state, data, metadata);
    }
  }

  function onPtyOutput(chunk) {
    const { orderedParts } = parser.parse(chunk);
    for (const part of orderedParts) {
      for (const event of part.events) {
        if (event.trust === 'trusted') transition('trusted');
        if (
          event.type === 'command-start' &&
          event.trust === 'trusted'
        ) {
          const reconciliation = consumeTrustedCommandStart(state);
          const logicalCommand = event.command ?? reconciliation.bufferedInput;
          if (logicalCommand) {
            createExecution(logicalCommand, reconciliation.pendingInput ?? {});
          }
        } else if (event.type === 'command-end' && event.trust === 'trusted') {
          const active = executions.find((execution) => execution.id === activeExecutionId);
          if (active) {
            active.exitCode = event.exitCode;
            active.outcome =
              event.exitCode === null
                ? 'unknown'
                : event.exitCode === 0
                  ? 'succeeded'
                  : 'failed';
          }
          activeExecutionId = null;
        }
      }
    }
  }

  function teardown() {
    resetCommandBoundaryRuntime(state);
    activeExecutionId = null;
  }

  return { executions, onData, onPtyOutput, state, teardown, transition };
}

function physicalInputFor(command) {
  return command.split('\n').map((line) => `${line}\r`);
}

function runTrustedCommand(harness, command, exitCode = 0, metadata) {
  for (const chunk of physicalInputFor(command)) harness.onData(chunk, metadata);
  harness.onPtyOutput(encodeCommandStart(command));
  harness.onPtyOutput('synthetic output\r\n');
  harness.onPtyOutput(encodeCommandEnd(exitCode));
}

console.log('Running CAPTURE-COMMAND-001R reconciliation tests...');

assert.strictEqual(shellLifecycleStateFromAvailability(true), 'initializing');
assert.strictEqual(shellLifecycleStateFromAvailability(false), 'fallback');
assert.strictEqual(
  shellLifecycleStateFromAvailability(undefined),
  'initializing',
  'missing capability data must not become positive evidence for fallback',
);

const ready = createHarness('ready');
ready.onPtyOutput(encodePromptStart());
runTrustedCommand(ready, commands.multiline);
assert.deepStrictEqual(
  ready.executions.map(({ command, outcome, exitCode }) => ({ command, outcome, exitCode })),
  [{ command: commands.multiline, outcome: 'succeeded', exitCode: 0 }],
  'trusted-ready multiline input creates and completes one logical execution',
);

const startupRace = createHarness('startup-race');
for (const chunk of physicalInputFor(commands.multiline)) startupRace.onData(chunk);
assert.strictEqual(startupRace.executions.length, 0, 'initializing input is pending, not fallback');
startupRace.onPtyOutput(encodePromptStart());
startupRace.onPtyOutput(encodeCommandStart(commands.multiline));
startupRace.onPtyOutput('one\r\ntwo\r\nthree\r\n');
startupRace.onPtyOutput(encodeCommandEnd(0));
assert.strictEqual(startupRace.executions.length, 1);
assert.strictEqual(startupRace.executions[0].command, commands.multiline);
assert.strictEqual(startupRace.executions[0].outcome, 'succeeded');
assert.strictEqual(startupRace.executions[0].exitCode, 0);
assert.ok(startupRace.executions[0].command.indexOf('"one"') < startupRace.executions[0].command.indexOf('"two"'));

for (const command of [commands.pipeline, commands.substitution, commands.heredoc]) {
  const harness = createHarness();
  runTrustedCommand(harness, command);
  assert.strictEqual(harness.executions.length, 1);
  assert.strictEqual(harness.executions[0].command, command);
}

const twoCommands = createHarness();
twoCommands.onData('printf one\rprintf two\r');
twoCommands.onPtyOutput(
  encodeCommandStart('printf one') +
    encodeCommandEnd(0) +
    encodeCommandStart('printf two') +
    encodeCommandEnd(0),
);
assert.deepStrictEqual(
  twoCommands.executions.map((execution) => execution.command),
  ['printf one', 'printf two'],
);

const unsupported = createHarness('unsupported');
unsupported.onData('echo early\r');
assert.strictEqual(unsupported.executions.length, 0);
unsupported.transition('fallback');
unsupported.onData('echo later\r');
assert.deepStrictEqual(
  unsupported.executions.map((execution) => execution.command),
  ['echo early', 'echo later'],
  'unsupported integration replays early input and retains conservative physical fallback',
);

const spoofed = createHarness('spoofed');
spoofed.onData('echo guarded\r');
spoofed.onPtyOutput(encodeCommandStart('echo attacker', 'wrong-nonce'));
spoofed.onPtyOutput(encodeCommandEnd(0, 'wrong-nonce'));
assert.strictEqual(spoofed.state.shellLifecycleState, 'initializing');
assert.strictEqual(spoofed.executions.length, 0);
spoofed.onPtyOutput(encodeCommandStart('echo guarded'));
spoofed.onPtyOutput(encodeCommandEnd(0));
assert.deepStrictEqual(spoofed.executions.map((execution) => execution.command), ['echo guarded']);

const trustedBoundaryWithoutPayload = createHarness('legacy-trusted');
trustedBoundaryWithoutPayload.onData(physicalInputFor(commands.multiline).join(''));
trustedBoundaryWithoutPayload.onPtyOutput(`\x1b]133;C;aid=${nonce}\x07`);
trustedBoundaryWithoutPayload.onPtyOutput(encodeCommandEnd(0));
assert.deepStrictEqual(
  trustedBoundaryWithoutPayload.executions.map((execution) => execution.command),
  [commands.multiline],
  'trusted command boundary reconciles pending startup input even without a command payload',
);

const paneA = createHarness('pane-a');
const paneB = createHarness('pane-b');
paneA.onData(physicalInputFor(commands.multiline).join(''));
paneB.onData('pwd\r');
paneB.onPtyOutput(encodeCommandStart('pwd'));
paneA.onPtyOutput(encodeCommandStart(commands.multiline));
paneB.onPtyOutput(encodeCommandEnd(0));
paneA.onPtyOutput(encodeCommandEnd(0));
assert.deepStrictEqual(paneA.executions.map((execution) => execution.command), [commands.multiline]);
assert.deepStrictEqual(paneB.executions.map((execution) => execution.command), ['pwd']);

const tornDown = createHarness('teardown');
tornDown.onData('stale command\r');
tornDown.teardown();
assert.strictEqual(tornDown.state.inputBuffer, '');
assert.strictEqual(tornDown.state.pendingExecutionInput, null);
assert.strictEqual(tornDown.state.shellLifecycleState, 'initializing');
tornDown.onPtyOutput(encodeCommandStart('fresh command'));
tornDown.onPtyOutput(encodeCommandEnd(0));
assert.deepStrictEqual(tornDown.executions.map((execution) => execution.command), ['fresh command']);

const failed = createHarness('failed');
runTrustedCommand(failed, 'false', 1);
assert.strictEqual(failed.executions[0].outcome, 'failed');
assert.strictEqual(failed.executions[0].exitCode, 1);

const unknown = createHarness('unknown');
unknown.onData('sleep 1\r');
unknown.onPtyOutput(encodeCommandStart('sleep 1'));
assert.strictEqual(unknown.executions[0].outcome, 'unknown');
assert.strictEqual(unknown.executions[0].exitCode, null);

const verification = createHarness('verification');
runTrustedCommand(verification, 'npm test', 0, {
  executionId: 'verification-execution',
  intent: 'verification',
  verificationRunId: 'verification-run',
  verificationCriterionId: 'criterion',
});
assert.deepStrictEqual(
  {
    id: verification.executions[0].id,
    intent: verification.executions[0].intent,
    run: verification.executions[0].verificationRunId,
    criterion: verification.executions[0].verificationCriterionId,
  },
  {
    id: 'verification-execution',
    intent: 'verification',
    run: 'verification-run',
    criterion: 'criterion',
  },
);

const sameTimestampItems = [
  { id: 'exec:z-random', kind: 'execution', selectedAt: 100, command: 'one' },
  { id: 'exec:a-random', kind: 'execution', selectedAt: 100, command: 'two' },
];
assert.deepStrictEqual(
  sortResolvedEvidenceItems(sameTimestampItems).map((item) => item.command),
  ['one', 'two'],
  'same-millisecond selections preserve canonical insertion order rather than random IDs',
);
const prompt = buildDeterministicPrompt({ selectedItems: sameTimestampItems });
assert.ok(prompt.indexOf('Command: one') < prompt.indexOf('Command: two'));

const appSource = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
assert.match(appSource, /runtime\.shellLifecycleState !== 'fallback'/);
assert.match(appSource, /consumeTrustedCommandStart\(runtime\)/);
assert.doesNotMatch(appSource, /hasTrustedShellLifecycle/);

console.log('CAPTURE-COMMAND-001R reconciliation tests passed.');
