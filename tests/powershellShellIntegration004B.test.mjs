import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

const src = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/terminal/shellIntegration.ts'),
  'utf8',
);
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const { ShellIntegrationStreamParser } = mod.exports;

// Marker shapes emitted by the CROSSPLAT-004B PowerShell bootstrap (native/src/terminal/shell.rs).
const NONCE = '3f2c9a4e-1b7d-4c55-9e0a-6d2f8b1c7e42';
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const handshake = (nonce = NONCE) => `\x1b]133;P;aid=${nonce};k=version;v=5.1.22621.4391\x07`;
const start = (cmd, cwd, nonce = NONCE) =>
  `\x1b]133;C;aid=${nonce};cmd=${b64(cmd)}${cwd === undefined ? '' : `;cwd=${b64(cwd)}`}\x07`;
const end = (status, nonce = NONCE) =>
  `\x1b]133;D${status === undefined ? '' : `;${status}`};aid=${nonce}\x07`;
const prompt = (nonce = NONCE) => `\x1b]133;A;aid=${nonce}\x07`;

function parseAll(chunks, nonce = NONCE) {
  const parser = new ShellIntegrationStreamParser(nonce);
  let text = '';
  const events = [];
  for (const chunk of chunks) {
    const result = parser.parse(chunk);
    text += result.cleanText;
    events.push(...result.events);
  }
  return { text, events, leftover: parser.flush() };
}

const trusted = (events) => events.filter((e) => e.trust === 'trusted');

// One PowerShell session transcript: handshake, prompt, a command with CRLF + ANSI output,
// its end, the next prompt (PowerShell's own prompt text follows the marker).
const cwd = 'C:\\Users\\maike\\Documents';
const transcript =
  handshake() +
  prompt() +
  'PS C:\\Users\\maike> Write-Output "trusted-basic"\r\n' +
  start('Write-Output "trusted-basic"', cwd) +
  '\x1b[32mtrusted-basic\x1b[0m\r\n' +
  end(0) +
  prompt() +
  'PS C:\\Users\\maike\\Documents> ';

// 1. Whole transcript in one chunk: multiple markers per chunk, output preserved around them.
{
  const { text, events, leftover } = parseAll([transcript]);
  assert.strictEqual(leftover, '');
  assert.deepStrictEqual(
    trusted(events).map((e) => e.type),
    ['property', 'prompt-start', 'command-start', 'command-end', 'prompt-start'],
  );
  const [property, , cmdStart, cmdEnd] = events;
  assert.deepStrictEqual([property.key, property.value], ['version', '5.1.22621.4391']);
  assert.strictEqual(cmdStart.command, 'Write-Output "trusted-basic"');
  assert.strictEqual(cmdStart.cwd, cwd);
  assert.strictEqual(cmdEnd.exitCode, 0);
  assert.ok(!text.includes('\x1b]133;'), 'markers never reach rendered output');
  assert.ok(text.includes('\x1b[32mtrusted-basic\x1b[0m\r\n'), 'ANSI + CRLF output kept');
  assert.ok(text.endsWith('PS C:\\Users\\maike\\Documents> '), 'user prompt text kept');
}

// 2. Every possible chunk split (including inside markers) yields identical results.
{
  const whole = parseAll([transcript]);
  for (let i = 1; i < transcript.length; i++) {
    const split = parseAll([transcript.slice(0, i), transcript.slice(i)]);
    assert.strictEqual(split.text, whole.text, `text differs at split ${i}`);
    assert.deepStrictEqual(split.events, whole.events, `events differ at split ${i}`);
  }
  // Byte-at-a-time delivery, the worst case for partial PTY reads.
  const tiny = parseAll([...transcript]);
  assert.strictEqual(tiny.text, whole.text);
  assert.deepStrictEqual(tiny.events, whole.events);
}

// 3. End statuses: native code, normalized PowerShell failure, and unknown (no status).
{
  const { events } = parseAll([end(7) + end(1) + end(undefined) + end(-1073741510)]);
  assert.deepStrictEqual(
    events.map((e) => [e.trust, e.exitCode]),
    [
      ['trusted', 7],
      ['trusted', 1],
      ['trusted', null],
      ['trusted', -1073741510],
    ],
  );
}

// 4. Wrong nonce, missing nonce and near-match spoofs are untrusted (and still stripped).
{
  const spoofs = [
    end(0, 'forged'),
    `\x1b]133;D;0\x07`,
    end(0, NONCE.slice(0, -1)),
    end(0, `${NONCE}x`),
    end(0, NONCE.toUpperCase()),
    `\x1b]133;D;0;aid= ${NONCE}x\x07`,
    start('rm -r C:\\', cwd, `${NONCE}0`),
  ];
  const { text, events } = parseAll(['before ' + spoofs.join('') + ' after']);
  assert.strictEqual(events.length, spoofs.length);
  assert.deepStrictEqual(trusted(events), [], 'no spoof is trusted');
  assert.strictEqual(text, 'before  after');
  // The session nonce of another session never authenticates here.
  const other = parseAll([start('Write-Output b', cwd, 'other-session')]);
  assert.strictEqual(trusted(other.events).length, 0);
}

// 5. Unicode output, command and cwd around and inside markers.
{
  const unicodeCwd = 'C:\\Users\\maike\\文档 ✓';
  const chunks = [
    '你好 before',
    start('Write-Output "你好 PowerShell"', unicodeCwd),
    '你好 PowerShell\r\n',
    end(0),
    '👋 after',
  ];
  const joined = chunks.join('');
  for (let i = 1; i < joined.length; i++) {
    const { text, events } = parseAll([joined.slice(0, i), joined.slice(i)]);
    assert.strictEqual(text, '你好 before你好 PowerShell\r\n👋 after', `split ${i}`);
    assert.strictEqual(events[0].command, 'Write-Output "你好 PowerShell"');
    assert.strictEqual(events[0].cwd, unicodeCwd);
    assert.strictEqual(events[1].exitCode, 0);
  }
}

// 6. User output adjacent to markers (no separating newline) is not swallowed.
{
  const { text, events } = parseAll([`abc${end(0)}def${prompt()}PS C:\\> `]);
  assert.strictEqual(text, 'abcdefPS C:\\> ');
  assert.deepStrictEqual(trusted(events).map((e) => e.type), ['command-end', 'prompt-start']);
}

// 7. Multiline command (PSReadLine submission) arrives as one start with embedded newlines.
{
  const multiline = 'if ($true) {\n  Write-Output "multi"\n}';
  const { events } = parseAll([start(multiline, cwd), 'multi\r\n', end(0)]);
  assert.strictEqual(trusted(events).filter((e) => e.type === 'command-start').length, 1);
  assert.strictEqual(events[0].command, multiline);
}

// 8. A malformed, never-terminated marker does not freeze output: past the guard its bytes are
// released as raw text and later output still flows.
{
  const parser = new ShellIntegrationStreamParser(NONCE);
  const runaway = `\x1b]133;D;0;aid=${NONCE}` + 'x'.repeat(5000);
  const first = parser.parse(runaway);
  const second = parser.parse(' visible');
  assert.deepStrictEqual([...first.events, ...second.events], []);
  assert.ok((first.cleanText + second.cleanText).includes('x'.repeat(5000) + ' visible'));
}

console.log('powershellShellIntegration004B: all tests passed');
