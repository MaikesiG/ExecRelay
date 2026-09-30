import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

/**
 * Task ID: LT-TRANSCRIPT-RENDERING-CLEANUP-PASS-001
 * Title: Transcript Rendering Cleanup Pass for TraceRelay Capture Panel
 */

// Load actual production TypeScript implementations using typescript.transpileModule
const ts = require('../app/node_modules/typescript');

const formatSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/transcriptFormat.ts'), 'utf8');
const formatJs = ts.transpileModule(formatSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const formatMod = { exports: {} };
const customRequireFormat = () => ({});
new Function('module', 'exports', 'require', formatJs)(formatMod, formatMod.exports, customRequireFormat);
const stripAnsiAndControl = formatMod.exports.stripAnsiAndControl;

const cleanupSrc = fs.readFileSync(path.resolve(__dirname, '../app/src/features/transcript/transcriptDisplayCleanup.ts'), 'utf8');
const cleanupJs = ts.transpileModule(cleanupSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const cleanupMod = { exports: {} };
const customRequireCleanup = () => ({ stripAnsiAndControl });
new Function('module', 'exports', 'require', cleanupJs)(cleanupMod, cleanupMod.exports, customRequireCleanup);

const { cleanTranscriptForDisplay, isPromptLine } = cleanupMod.exports;

console.log('Running Transcript Display Cleanup Tests (LT-TRANSCRIPT-RENDERING-CLEANUP-PASS-001)...\\n');

// ---------------------------------------------------------------------------
// Test 1: Prompt Line Detection Heuristics
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: Prompt Line Detection Heuristics ---');

  // Positive prompt cases (MUST detect as prompt)
  const truePrompts = [
    'xingchiguo@MacBookPro ~ %',
    'xingchiguo@MacBookPro ~ % ',
    'user@host path $',
    'user@host:~$',
    'user@host:~$ ',
    'root@host:/path#',
    'root@host:~#',
    '[user@host path]$',
    '(base) xingchiguo@MacBookPro ~ %',
    '(venv) user@host:/var/www$',
    '$',
    '$ ',
    '%',
    '% ',
    '❯',
    '❯ ',
    '›',
    '➜  ~ %',
    '➜  traceRelay git:(main) $',
    'host:path user$',
    'MacBookPro:traceRelay user%',
    '~/development/projects %',
    '/usr/local/bin $',
    '╰─$',
    '╰─❯',
  ];

  for (const prompt of truePrompts) {
    assert.strictEqual(
      isPromptLine(prompt),
      true,
      `Expected prompt line to be detected: "${prompt}"`,
    );
  }

  // Negative prompt cases (MUST NOT detect as prompt)
  const falsePrompts = [
    '$ ls',
    '$ ls -la',
    '% echo hello',
    'echo $PATH',
    'cat file.txt',
    'price is $10.00',
    'Total: 100%',
    'Downloading: 50.5%',
    '50%',
    '100%',
    '[ 85%]',
    '# Configuration section',
    '#',
    '## Section Header',
    'commit 83f5865a (HEAD -> main)',
    'drwxr-xr-x 2 user staff 64 Sep 23 12:00 Desktop',
    '-rw-r--r-- 1 root root 1024 Sep 23 12:00 file.txt',
    'user@example.com',
    'https://github.com/repo#readme',
    'color: #fff;',
    'root:x:0:0:root:/root:/bin/bash',
    'awk \'{print $1}\' data.txt',
    'export PATH="/usr/bin:$PATH"',
    'exit status 1',
    'fatal: not a git repository',
    'error: connection timed out',
    '$$',
  ];

  for (const nonPrompt of falsePrompts) {
    assert.strictEqual(
      isPromptLine(nonPrompt),
      false,
      `Expected non-prompt line to NOT be detected as prompt: "${nonPrompt}"`,
    );
  }

  console.log('✓ Prompt detection correctly detects shell prompts and preserves non-prompt output');
}

// ---------------------------------------------------------------------------
// Test 2: Trailing prompt lines are hidden in rendered output
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: Trailing prompt lines are hidden in rendered output ---');

  const raw = [
    '.zshrc',
    'anaconda3',
    'Applications',
    'Desktop',
    'xingchiguo@MacBookPro ~ %',
  ].join('\n');

  const res = cleanTranscriptForDisplay(raw);

  assert.strictEqual(res.hasHiddenPrompts, true, 'hasHiddenPrompts flag is true');
  assert.strictEqual(res.hiddenPromptCount, 1, 'Exactly 1 prompt hidden');
  assert.strictEqual(
    res.cleanedText,
    ['.zshrc', 'anaconda3', 'Applications', 'Desktop'].join('\n'),
    'Trailing prompt line removed from output',
  );
  assert.strictEqual(res.lineCount, 4, 'Line count is 4');
  assert.strictEqual(res.hasSubstantiveOutput, true, 'Substantive output captured');

  // Multiple trailing prompts with trailing whitespace
  const rawMultiple = [
    'Documents',
    'Downloads',
    'xingchiguo@MacBookPro ~ %  ',
    'xingchiguo@MacBookPro ~ %',
  ].join('\n');

  const resMultiple = cleanTranscriptForDisplay(rawMultiple);
  assert.strictEqual(resMultiple.hiddenPromptCount, 2, 'Both trailing prompts hidden');
  assert.strictEqual(resMultiple.cleanedText, 'Documents\nDownloads');

  // Trailing prompts with blank line between them
  const rawWithBlank = [
    'file1.txt',
    'file2.txt',
    'user@host ~ %',
    '',
    'user@host ~ %',
    '',
  ].join('\n');

  const resWithBlank = cleanTranscriptForDisplay(rawWithBlank);
  assert.strictEqual(resWithBlank.hiddenPromptCount, 2, 'Both trailing prompts hidden');
  assert.strictEqual(resWithBlank.cleanedText, 'file1.txt\nfile2.txt');

  console.log('✓ Trailing prompt lines (single, multiple, with blank lines) are hidden cleanly');
}

// ---------------------------------------------------------------------------
// Test 3: Repeated prompt lines collapse correctly
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Repeated prompt lines collapse correctly ---');

  // Consecutive prompts in middle of output
  const rawMiddle = [
    'Starting job',
    'user@host ~ %',
    'user@host ~ %',
    'Job finished',
  ].join('\n');

  const resMiddle = cleanTranscriptForDisplay(rawMiddle);
  assert.strictEqual(resMiddle.hasHiddenPrompts, true);
  assert.strictEqual(resMiddle.hiddenPromptCount, 1, 'Collapsed 1 duplicate prompt');
  assert.strictEqual(
    resMiddle.cleanedText,
    ['Starting job', 'user@host ~ %', 'Job finished'].join('\n'),
    'Collapsed consecutive prompts to at most one visible prompt',
  );

  // Consecutive prompts separated by blank lines in middle of output
  const rawSeparated = [
    'Step 1',
    'user@host path $',
    '',
    'user@host path $',
    'Step 2',
  ].join('\n');

  const resSeparated = cleanTranscriptForDisplay(rawSeparated);
  assert.strictEqual(resSeparated.hiddenPromptCount, 1, 'Collapsed 1 duplicate prompt');
  assert.strictEqual(
    resSeparated.cleanedText,
    ['Step 1', 'user@host path $', 'Step 2'].join('\n'),
    'Collapsed prompts separated by blanks into 1 visible prompt without leaked blanks',
  );

  console.log('✓ Repeated consecutive prompt lines in output collapse to at most one visible prompt');
}

// ---------------------------------------------------------------------------
// Test 4: Multiple blank lines collapse to a single blank line
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Multiple blank lines collapse to a single blank line ---');

  const raw = [
    '',
    '',
    'Section 1',
    '',
    '',
    '',
    'Section 2',
    '',
    '',
  ].join('\n');

  const res = cleanTranscriptForDisplay(raw);

  assert.strictEqual(res.hasCollapsedBlankLines, true, 'hasCollapsedBlankLines is true');
  // Leading blanks removed, trailing blanks trimmed, middle 3 blanks collapsed to 1 blank
  assert.strictEqual(
    res.cleanedText,
    ['Section 1', '', 'Section 2'].join('\n'),
    'Leading/trailing blanks trimmed and interior 3 blanks collapsed to exactly 1 blank',
  );

  // Single blank line between content lines is preserved
  const rawPreserveSingle = ['Line A', '', 'Line B'].join('\n');
  const resPreserveSingle = cleanTranscriptForDisplay(rawPreserveSingle);
  assert.strictEqual(resPreserveSingle.cleanedText, 'Line A\n\nLine B');

  console.log('✓ Blank lines collapsed to at most one; leading/trailing blank lines removed');
}

// ---------------------------------------------------------------------------
// Test 5: Meaningful command lines like `$ ls` are preserved
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Meaningful command lines like `$ ls` are preserved ---');

  const raw = [
    '$ ls',
    'app',
    'tests',
    'package.json',
    'xingchiguo@MacBookPro ~ %',
  ].join('\n');

  const res = cleanTranscriptForDisplay(raw);

  assert.strictEqual(
    res.cleanedText,
    ['$ ls', 'app', 'tests', 'package.json'].join('\n'),
    'Meaningful command line "$ ls" is preserved while trailing prompt is hidden',
  );

  const rawPercentCmd = [
    '% ./configure',
    'checking gcc... yes',
  ].join('\n');

  const resPercentCmd = cleanTranscriptForDisplay(rawPercentCmd);
  assert.strictEqual(
    resPercentCmd.cleanedText,
    ['% ./configure', 'checking gcc... yes'].join('\n'),
    'Command line starting with % is preserved',
  );

  console.log('✓ Meaningful command lines like "$ ls" are fully preserved');
}

// ---------------------------------------------------------------------------
// Test 6: Ordinary output lines with special characters are not incorrectly removed
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Ordinary output lines with special characters are not incorrectly removed ---');

  const rawSpecial = [
    'Compiling assets: 45%',
    'Complete: 100%',
    'Price calculation: $45.00 total',
    'Contact user@host.com for support',
    'awk \'{print $1, $2}\'',
    '# Configuration block',
    'exit status 0',
  ].join('\n');

  const resSpecial = cleanTranscriptForDisplay(rawSpecial);

  assert.strictEqual(
    resSpecial.cleanedText,
    rawSpecial,
    'All lines containing %, $, @, # are preserved verbatim without false positive prompt stripping',
  );
  assert.strictEqual(resSpecial.hasHiddenPrompts, false, 'No prompts incorrectly detected');
  assert.strictEqual(resSpecial.hiddenPromptCount, 0, 'Hidden prompt count is 0');

  console.log('✓ Ordinary output lines with special characters (@, %, $, #) are preserved');
}

// ---------------------------------------------------------------------------
// Test 7: Raw transcript data remains completely unchanged
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 7: Raw transcript data remains completely unchanged ---');

  const rawInput = 'Desktop\nDocuments\nxingchiguo@MacBookPro ~ %\n';
  const rawCopy = String(rawInput);

  const res = cleanTranscriptForDisplay(rawInput);

  assert.strictEqual(rawInput, rawCopy, 'Input string variable was not mutated');
  assert.strictEqual(res.rawText, rawInput, 'res.rawText preserves the exact original raw input');
  assert.notStrictEqual(res.cleanedText, rawInput, 'res.cleanedText is a separate cleaned display string');

  // Test on mock block object
  const mockBlock = {
    id: 'block-123',
    command: 'ls',
    output: 'app\ntests\nxingchiguo@MacBookPro ~ %',
  };

  const blockOutputBefore = mockBlock.output;
  const resBlock = cleanTranscriptForDisplay(mockBlock.output);

  assert.strictEqual(mockBlock.output, blockOutputBefore, 'mockBlock.output property was not mutated');
  assert.strictEqual(resBlock.cleanedText, 'app\ntests', 'Cleaned text is properly stripped');

  console.log('✓ Raw transcript data remains strictly immutable');
}

// ---------------------------------------------------------------------------
// Test 8: Entirely prompt/empty output yields fallback text
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 8: Entirely prompt/empty output yields fallback text ---');

  const promptOnly = 'xingchiguo@MacBookPro ~ %\n';
  const resPrompt = cleanTranscriptForDisplay(promptOnly);
  assert.strictEqual(resPrompt.cleanedText, '(no output captured)', 'Fallback text used for prompt-only output');
  assert.strictEqual(resPrompt.hasSubstantiveOutput, false, 'hasSubstantiveOutput is false');
  assert.strictEqual(resPrompt.hasHiddenPrompts, true, 'hasHiddenPrompts is true');
  assert.strictEqual(resPrompt.hiddenPromptCount, 1, '1 prompt was hidden');

  const emptyRes = cleanTranscriptForDisplay('');
  assert.strictEqual(emptyRes.cleanedText, '(no output captured)', 'Fallback text used for empty output');
  assert.strictEqual(emptyRes.hasSubstantiveOutput, false);

  const customFallback = cleanTranscriptForDisplay('user@host:~$', { fallbackText: '' });
  assert.strictEqual(customFallback.cleanedText, '', 'Custom fallbackText honored');

  console.log('✓ Pure prompt or empty outputs gracefully return fallback text');
}

// ---------------------------------------------------------------------------
// Test 9: ANSI escapes stripped before prompt detection
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 9: ANSI escapes stripped before prompt detection ---');

  const ansiRaw = [
    '\x1b[32mDesktop\x1b[0m',
    '\x1b[34mDocuments\x1b[0m',
    '\x1b[1;36mxingchiguo@MacBookPro\x1b[0m \x1b[33m~\x1b[0m %',
  ].join('\n');

  const resAnsi = cleanTranscriptForDisplay(ansiRaw);

  assert.strictEqual(resAnsi.hasHiddenPrompts, true, 'Colored prompt detected and hidden');
  assert.strictEqual(resAnsi.cleanedText, 'Desktop\nDocuments', 'ANSI color codes removed and prompt stripped');

  console.log('✓ ANSI-colored prompt lines are properly recognized and hidden');
}

// ---------------------------------------------------------------------------
// Test 10: UI integration in TranscriptCapturePanel component
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 10: UI integration in TranscriptCapturePanel component ---');

  const panelTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/TranscriptCapturePanel.tsx'),
    'utf8',
  );

  assert.ok(
    panelTsx.includes('cleanTranscriptForDisplay'),
    'TranscriptCapturePanel imports or uses cleanTranscriptForDisplay',
  );
  assert.ok(
    panelTsx.includes('displayResult') || panelTsx.includes('displayOutput'),
    'TranscriptCapturePanel renders displayOutput / displayResult',
  );
  assert.ok(
    panelTsx.includes('data-has-hidden-prompts'),
    'TranscriptCapturePanel exposes data-has-hidden-prompts attribute for extensible DOM inspection',
  );

  console.log('✓ TranscriptCapturePanel correctly wires cleanTranscriptForDisplay into block rendering');
}

console.log('\\n=======================================================================');
console.log('ALL 10 TRANSCRIPT DISPLAY CLEANUP TESTS PASSED!');
console.log('=======================================================================\\n');
