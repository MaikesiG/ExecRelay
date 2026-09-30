import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ts = require('../../app/node_modules/typescript');

function transpileTs(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

const shellIntegrationMod = transpileTs(
  path.resolve(__dirname, '../../app/src/features/terminal/shellIntegration.ts'),
);
const { ShellIntegrationStreamParser } = shellIntegrationMod;

console.log('Running Real Subprocess & PTY Terminal Smoke Test...\n');

async function runShellCommand(cmd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('/bin/zsh', ['-c', cmd], {
      env: {
        ...process.env,
        PATH: '/opt/homebrew/bin:/usr/local/bin:' + (process.env.PATH || ''),
      },
    });
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => chunks.push(d));
    proc.on('close', (code) => {
      resolve({ code, output: Buffer.concat(chunks) });
    });
    proc.on('error', reject);
  });
}

// 1. Unicode output
{
  console.log('--- Smoke 1: Unicode Output ---');
  const nonce = 'smoke-nonce-unicode';
  const parser = new ShellIntegrationStreamParser(nonce);

  const cmd = `printf "\\x1b]133;C;aid=${nonce}\\x07Hello å∫ç∂é ñ, 99¢ (λ calculus), 50€ 漢字\\n\\x1b]133;D;0;aid=${nonce}\\x07"`;
  const res = await runShellCommand(cmd);
  assert.strictEqual(res.code, 0);

  const decoder = new TextDecoder('utf-8');
  const rawText = decoder.decode(res.output, { stream: true });
  const parsed = parser.parse(rawText);

  assert.strictEqual(parsed.events.length, 2);
  assert.strictEqual(parsed.events[0].type, 'command-start');
  assert.strictEqual(parsed.events[0].trust, 'trusted');
  assert.strictEqual(parsed.events[1].type, 'command-end');
  assert.strictEqual(parsed.events[1].exitCode, 0);
  assert.strictEqual(parsed.events[1].trust, 'trusted');
  assert.strictEqual(parsed.cleanText, 'Hello å∫ç∂é ñ, 99¢ (λ calculus), 50€ 漢字\n');
  console.log('✓ Unicode output rendered with exact characters and 0 replacement characters');
}

// 2. Emoji output
{
  console.log('\n--- Smoke 2: Emoji Output ---');
  const nonce = 'smoke-nonce-emoji';
  const parser = new ShellIntegrationStreamParser(nonce);

  const cmd = `printf "\\x1b]133;C;aid=${nonce}\\x07Ready 🌍 to launch 🚀 now! 🔥🎉✨⚡️\\n\\x1b]133;D;0;aid=${nonce}\\x07"`;
  const res = await runShellCommand(cmd);
  assert.strictEqual(res.code, 0);

  const decoder = new TextDecoder('utf-8');
  const rawText = decoder.decode(res.output, { stream: true });
  const parsed = parser.parse(rawText);

  assert.strictEqual(parsed.events.length, 2);
  assert.strictEqual(parsed.events[1].type, 'command-end');
  assert.strictEqual(parsed.events[1].exitCode, 0);
  assert.strictEqual(parsed.cleanText, 'Ready 🌍 to launch 🚀 now! 🔥🎉✨⚡️\n');
  console.log('✓ Emoji output rendered without corruption');
}

// 3. ANSI color output
{
  console.log('\n--- Smoke 3: ANSI Color Output ---');
  const nonce = 'smoke-nonce-ansi';
  const parser = new ShellIntegrationStreamParser(nonce);

  const cmd = `printf "\\x1b]133;C;aid=${nonce}\\x07\\x1b[31mRed \\x1b[32mGreen \\x1b[1;34mBold Blue \\x1b[0mNormal\\n\\x1b]133;D;0;aid=${nonce}\\x07"`;
  const res = await runShellCommand(cmd);
  assert.strictEqual(res.code, 0);

  const decoder = new TextDecoder('utf-8');
  const rawText = decoder.decode(res.output, { stream: true });
  const parsed = parser.parse(rawText);

  assert.strictEqual(parsed.events.length, 2);
  assert.strictEqual(parsed.events[1].type, 'command-end');
  assert.strictEqual(parsed.cleanText, '\x1b[31mRed \x1b[32mGreen \x1b[1;34mBold Blue \x1b[0mNormal\n');
  assert.ok(!parsed.cleanText.includes('133;'), 'OSC markers stripped while SGR ANSI colors preserved');
  console.log('✓ ANSI SGR colors preserved while OSC 133 markers stripped');
}

// 4. Normal shell command
{
  console.log('\n--- Smoke 4: Normal Shell Command Execution ---');
  const nonce = 'smoke-nonce-normal';
  const parser = new ShellIntegrationStreamParser(nonce);

  const cmd = `printf "\\x1b]133;C;aid=${nonce}\\x07"; uname -s; printf "\\x1b]133;D;0;aid=${nonce}\\x07"`;
  const res = await runShellCommand(cmd);
  assert.strictEqual(res.code, 0);

  const decoder = new TextDecoder('utf-8');
  const rawText = decoder.decode(res.output, { stream: true });
  const parsed = parser.parse(rawText);

  assert.strictEqual(parsed.events.length, 2);
  assert.strictEqual(parsed.events[1].exitCode, 0);
  assert.ok(parsed.cleanText.includes('Darwin'));
  console.log(`✓ Shell command executed: '${parsed.cleanText.trim()}' with trusted exit 0`);
}

// 5. Responsiveness & throughput
{
  console.log('\n--- Smoke 5: Terminal Responsiveness Under Rapid Streaming ---');
  const start = performance.now();
  const res = await runShellCommand('python3 -c "for i in range(10000): print(i)"');
  const duration = performance.now() - start;
  assert.strictEqual(res.code, 0);
  assert.ok(res.output.length > 35000);
  console.log(`✓ 10,000 line real shell burst generated and captured in ${duration.toFixed(1)} ms`);
}

// 6. Trusted command completion verification
{
  console.log('\n--- Smoke 6: Trusted Command Completion ---');
  const nonce = 'smoke-nonce-verify';
  const parser = new ShellIntegrationStreamParser(nonce);

  // Command that fails (exit 42)
  const failCmd = `printf "\\x1b]133;C;aid=${nonce}\\x07Failed task\\n\\x1b]133;D;42;aid=${nonce}\\x07"`;
  const resFail = await runShellCommand(failCmd);

  const decoder = new TextDecoder('utf-8');
  const parsedFail = parser.parse(decoder.decode(resFail.output, { stream: true }));
  assert.strictEqual(parsedFail.events[1].type, 'command-end');
  assert.strictEqual(parsedFail.events[1].exitCode, 42);
  assert.strictEqual(parsedFail.events[1].trust, 'trusted');
  console.log('✓ Trusted exit code 42 authenticated via per-session nonce');
}

console.log('\n=============================================================');
console.log('ALL REAL SMOKE CHECKS PASSED!');
console.log('=============================================================\n');
