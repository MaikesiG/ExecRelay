import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

function loadTs(relativePath) {
  const absolutePath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', output)(mod, mod.exports, require);
  return mod.exports;
}

const { ShellIntegrationStreamParser } = loadTs(
  '../app/src/features/terminal/shellIntegration.ts',
);
const { buildDeterministicPrompt } = loadTs(
  '../app/src/features/promptComposer/promptBuilder.ts',
);

const nonce = 'capture-command-boundary-test-nonce';
const osc = (code, command) => {
  const encoded = Buffer.from(command, 'utf8').toString('base64');
  return `\x1b]133;${code};aid=${nonce};cmd=${encoded}\x07`;
};

const commands = {
  backslash: ['aws command \\', '  --foo bar \\', '  --baz qux'].join('\n'),
  awsExact: [
    'aws iam get-role-policy \\',
    '  --role-name ecsTaskExecutionRole \\',
    '  --policy-name ExampleStagingSecretRead \\',
    "  --query 'PolicyDocument.Statement[0].Resource' \\",
    '  --output text',
  ].join('\n'),
  pipeline: ["printf 'a\\n' |", 'grep a |', 'sort'].join('\n'),
  substitution: ['VALUE=$(', '  printf hello', ')'].join('\n'),
  ifBlock: ['if true; then', '  echo yes', 'fi'].join('\n'),
  forLoop: ['for x in a b; do', '  echo "$x"', 'done'].join('\n'),
  subshell: ['(', '  echo one', '  echo two', ')'].join('\n'),
  heredoc: ["cat <<'EOF'", 'hello', 'world', 'EOF'].join('\n'),
  pythonHeredoc: ["python3 <<'PY'", 'print("hello")', 'PY'].join('\n'),
  multilineQuote: ["printf '%s\\n' \"hello", 'world"'].join('\n'),
  docker: [
    'docker run --rm \\',
    '  --platform linux/amd64 \\',
    '  --entrypoint python \\',
    '  example/image:tag \\',
    "  -c 'print(\"hello\")'",
  ].join('\n'),
  singleLine: 'pwd',
  failure: 'false',
};

console.log('Running CAPTURE-COMMAND-001 trusted boundary tests...');

for (const [name, command] of Object.entries(commands)) {
  const parser = new ShellIntegrationStreamParser(nonce);
  const result = parser.parse(osc('C', command));
  assert.strictEqual(result.events.length, 1, `${name}: one start boundary`);
  assert.strictEqual(result.events[0].type, 'command-start');
  assert.strictEqual(result.events[0].trust, 'trusted');
  assert.strictEqual(result.events[0].command, command, `${name}: exact logical command preserved`);
}

const longCommand = `cat <<'EOF'\n${'x'.repeat(10000)}\nEOF`;
const longMarker = osc('C', longCommand);
const longParser = new ShellIntegrationStreamParser(nonce);
const longFirst = longParser.parse(longMarker.slice(0, 5000));
assert.strictEqual(longFirst.events.length, 0);
const longSecond = longParser.parse(longMarker.slice(5000));
assert.strictEqual(longSecond.events[0].type, 'command-start');
assert.strictEqual(longSecond.events[0].command, longCommand);

const twoCommandsParser = new ShellIntegrationStreamParser(nonce);
const twoCommands = twoCommandsParser.parse(
  osc('C', 'VALUE=$(printf hello)') +
    `\x1b]133;D;0;aid=${nonce}\x07` +
    osc('C', `printf "$VALUE\\n"`) +
    `\x1b]133;D;0;aid=${nonce}\x07`,
);
assert.deepStrictEqual(
  twoCommands.events.filter((event) => event.type === 'command-start').map((event) => event.command),
  ['VALUE=$(printf hello)', `printf "$VALUE\\n"`],
  'one paste can contain two shell-defined logical executions',
);

const wrongSession = new ShellIntegrationStreamParser('different-session-nonce').parse(
  osc('C', commands.heredoc),
);
assert.strictEqual(wrongSession.events[0].trust, 'untrusted');

const ordered = new ShellIntegrationStreamParser(nonce).parse(
  `raw command echo\r\n${osc('C', commands.pipeline)}program output\r\n` +
    `\x1b]133;D;7;aid=${nonce}\x07`,
);
assert.deepStrictEqual(
  ordered.orderedParts.map((part) =>
    part.events[0]?.type ?? (part.cleanText ? 'text' : 'empty'),
  ),
  ['text', 'command-start', 'text', 'command-end'],
  'stream order preserves raw text around trusted lifecycle boundaries',
);
assert.strictEqual(ordered.cleanText, 'raw command echo\r\nprogram output\r\n');
assert.strictEqual(ordered.events[1].exitCode, 7);

const unknownCompletion = new ShellIntegrationStreamParser(nonce).parse(
  osc('C', commands.singleLine),
);
assert.strictEqual(unknownCompletion.events.length, 1);
assert.strictEqual(unknownCompletion.events[0].type, 'command-start');

const prompt = buildDeterministicPrompt({
  selectedItems: [
    {
      id: 'exec:aws-example',
      kind: 'execution',
      executionId: 'aws-example',
      command: commands.backslash,
      outcome: 'succeeded',
      exitCode: 0,
      selectedAt: 1,
    },
  ],
});
assert.strictEqual((prompt.match(/^Command:/gm) ?? []).length, 1);
assert.ok(prompt.includes(commands.backslash));
assert.ok(!prompt.includes('Command: --foo'));
assert.ok(!prompt.includes('Command: --baz'));

const appSource = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
assert.match(appSource, /ev\.trust === 'trusted'/);
assert.match(appSource, /ev\.command \?\? reconciliation\.bufferedInput/);
assert.match(appSource, /trustedBoundary:\s*true/);
assert.match(appSource, /verificationRunId:\s*physicalOptions\?\.verificationRunId/);
assert.match(appSource, /runtime\.pendingExecutionInput/);

const nativeShellSource = fs.readFileSync(
  path.resolve(__dirname, '../native/src/terminal/shell.rs'),
  'utf8',
);
assert.match(nativeShellSource, /local full_cmd="\$1"/);
assert.match(nativeShellSource, /full_cmd=\$\(fc -ln -1\)/);
assert.match(nativeShellSource, /133;C;aid=%s;cmd=%s/);

console.log('CAPTURE-COMMAND-001 trusted boundary tests passed.');
