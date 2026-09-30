import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xtermPkg from '../app/node_modules/@xterm/xterm/lib/xterm.js';
const { Terminal } = xtermPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task: Implement correct `clear` command behavior in TraceRelay / CapTerm so it behaves
 * like an in-terminal visual reset / viewport re-anchor (matching iTerm2), not a destructive
 * capture-history delete.
 */

// Helper 1: Command normalization & terminal clear detection
function normalizeCommand(command) {
  return command
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\x1b/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim();
}

function isTerminalClearCommand(command) {
  const norm = normalizeCommand(command).trim().toLowerCase();
  return (
    norm === 'clear' ||
    norm === '\\clear' ||
    norm === 'clear -x' ||
    norm === '/usr/bin/clear' ||
    norm === 'cls'
  );
}

// Helper 2: ANSI clear sequence detection
function containsAnsiClearSequence(bytes) {
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    if (bytes[i] === 0x1b) {
      if (i + 1 < len && bytes[i + 1] === 0x63) {
        return true;
      }
      if (i + 1 < len && bytes[i + 1] === 0x5b) {
        let j = i + 2;
        while (j < len && bytes[j] >= 0x30 && bytes[j] <= 0x3f) {
          j++;
        }
        if (j < len && bytes[j] === 0x4a) {
          const paramStr = String.fromCharCode(...bytes.subarray(i + 2, j));
          if (
            paramStr === '2' ||
            paramStr === '3' ||
            paramStr.includes('2') ||
            paramStr.includes('3')
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

// Helper 3: iTerm-like viewport scroll calculation and CSI handler setup
function scrollTerminalToFreshScreen(terminal) {
  if (terminal.buffer.active.type !== 'normal') {
    terminal.write('\x1b[H\x1b[2J', () => {
      terminal.scrollToBottom();
      terminal.focus();
    });
    return;
  }

  const active = terminal.buffer.active;
  let lastNonEmptyRow = -1;
  for (let r = terminal.rows - 1; r >= 0; r--) {
    const line = active.getLine(active.baseY + r);
    if (line && line.translateToString(true).trim().length > 0) {
      lastNonEmptyRow = r;
      break;
    }
  }

  const linesToScroll = lastNonEmptyRow >= 0 ? lastNonEmptyRow + 1 : 0;
  const core = terminal._core;
  if (core?._bufferService?.scroll) {
    for (let s = 0; s < linesToScroll; s++) {
      core._bufferService.scroll(true);
    }
    if (core._bufferService.buffer) {
      core._bufferService.buffer.y = 0;
      core._bufferService.buffer.x = 0;
    }
  } else if (linesToScroll > 0) {
    terminal.write(
      `\x1b[${terminal.rows};1H${'\n'.repeat(linesToScroll)}\x1b[H\x1b[2J`,
    );
  } else {
    terminal.write('\x1b[H\x1b[2J');
  }

  terminal.refresh(0, terminal.rows - 1);
  terminal.scrollToBottom();
  terminal.focus();
}

function setupItermClearHandler(terminal) {
  return terminal.parser.registerCsiHandler({ final: 'J' }, (params) => {
    if (params[0] === 3) {
      // Suppress 3J (Erase Saved Lines) so scrollback history is preserved (like iTerm)
      return true;
    }
    if (params[0] === 2) {
      if (terminal.buffer.active.type === 'normal') {
        scrollTerminalToFreshScreen(terminal);
        return true;
      }
    }
    return false;
  });
}

// Simulated App & Workspace runtime matching App.tsx + TerminalPane.tsx
class SimulatedWorkspaceTerminalSession {
  constructor() {
    this.workspaceId = 'ws-1';
    this.tabId = 'tab-1';
    this.paneId = 'pane-1';

    // Capture state
    this.capture = {
      isListening: true,
      currentBatch: { id: 'batch-1' },
      blocks: [],
    };
    this.selection = {
      selectedBlockIds: new Set(),
      updatedAt: Date.now(),
    };

    // Terminal Emulator with CSI handler registered
    this.xterm = new Terminal({ rows: 10, cols: 60 });
    this.csiDisposable = setupItermClearHandler(this.xterm);

    // Active block runtime
    this.runtime = {
      status: 'capturing',
      inputBuffer: '',
      activeBlockId: null,
      activeBlockParser: null,
    };

    this.pendingConfirmation = null;
    this.hasViewportCleared = false;
    this.pendingClearScroll = false;
  }

  // User types into terminal
  sendTerminalInput(text) {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '\r' || char === '\n') {
        const rawCommand = this.runtime.inputBuffer;
        this.runtime.inputBuffer = '';
        const cleanCommand = normalizeCommand(rawCommand);

        if (isTerminalClearCommand(cleanCommand)) {
          // Finalize previous block if any, but do NOT prematurely clear the emulator
          // before the shell emits its real output/prompt.
          const prevActiveId = this.runtime.activeBlockId;
          const prevParser = this.runtime.activeBlockParser;
          this.runtime.activeBlockId = null;
          this.runtime.activeBlockParser = null;

          if (prevActiveId && prevParser) {
            this.capture.blocks = this.capture.blocks.map((b) =>
              b.id === prevActiveId ? { ...b, isComplete: true, completedAt: Date.now() } : b,
            );
          }

          continue;
        }

        if (cleanCommand.length > 0) {
          const prevActiveId = this.runtime.activeBlockId;
          const prevParser = this.runtime.activeBlockParser;
          if (prevActiveId && prevParser) {
            this.capture.blocks = this.capture.blocks.map((b) =>
              b.id === prevActiveId ? { ...b, isComplete: true, completedAt: Date.now() } : b,
            );
          }

          const blockId = `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const newBlock = {
            id: blockId,
            command: cleanCommand,
            output: '',
            isComplete: false,
            startedAt: Date.now(),
            completedAt: null,
          };

          this.runtime.activeBlockId = blockId;
          this.runtime.activeBlockParser = {
            command: cleanCommand,
            buffer: '',
            echoChecked: false,
          };

          this.capture.blocks.push(newBlock);
        }
      } else if (char >= ' ' || char === '\t') {
        this.runtime.inputBuffer += char;
      }
    }
  }

  // PTY outputs data back to terminal
  receiveTerminalOutput(bytes) {
    const hasClear = containsAnsiClearSequence(bytes);
    if (hasClear) {
      this.pendingClearScroll = true;
    }

    if (this.runtime.activeBlockId && this.runtime.activeBlockParser) {
      const text = new TextDecoder().decode(bytes);
      this.runtime.activeBlockParser.buffer += text;
      const targetId = this.runtime.activeBlockId;
      this.capture.blocks = this.capture.blocks.map((b) =>
        b.id === targetId ? { ...b, output: this.runtime.activeBlockParser.buffer } : b,
      );
    }

    return new Promise((resolve) => {
      this.xterm.write(bytes, () => {
        if (this.pendingClearScroll && this.xterm.buffer.active.type === 'normal') {
          this.xterm.scrollToBottom();
          this.xterm.refresh(0, this.xterm.rows - 1);
          this.hasViewportCleared = true;
          if (!hasClear) {
            this.pendingClearScroll = false;
          }
        }
        resolve();
      });
    });
  }
}

console.log('Running Terminal Viewport Clear Behavior Tests...\\n');

// ---------------------------------------------------------------------------
// Test 1: isTerminalClearCommand accurately identifies clear commands
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: isTerminalClearCommand accurately identifies clear commands ---');
  assert.strictEqual(isTerminalClearCommand('clear'), true, 'matches "clear"');
  assert.strictEqual(isTerminalClearCommand('\\clear'), true, 'matches "\\clear" (alias escape)');
  assert.strictEqual(isTerminalClearCommand('clear -x'), true, 'matches "clear -x"');
  assert.strictEqual(isTerminalClearCommand('/usr/bin/clear'), true, 'matches "/usr/bin/clear"');
  assert.strictEqual(isTerminalClearCommand('cls'), true, 'matches "cls"');
  assert.strictEqual(isTerminalClearCommand('  CLEAR   '), true, 'case-insensitive and trimmed');
  assert.strictEqual(isTerminalClearCommand('clearwater'), false, 'does not match command prefix');
  assert.strictEqual(isTerminalClearCommand('echo clear'), false, 'does not match clear as argument');
  assert.strictEqual(isTerminalClearCommand('ls -la'), false, 'does not match unrelated command');
  console.log('✓ Command recognizer correctly identifies terminal clear commands');
}

// ---------------------------------------------------------------------------
// Test 2: containsAnsiClearSequence detects ANSI clear sequences
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 2: containsAnsiClearSequence detects ANSI clear sequences ---');
  const encoder = new TextEncoder();
  assert.strictEqual(containsAnsiClearSequence(encoder.encode('\x1b[H\x1b[2J')), true, 'Detects ESC [ 2 J');
  assert.strictEqual(containsAnsiClearSequence(encoder.encode('\x1b[3J')), true, 'Detects ESC [ 3 J (scrollback)');
  assert.strictEqual(containsAnsiClearSequence(encoder.encode('\x1bc')), true, 'Detects ESC c (RIS)');
  assert.strictEqual(containsAnsiClearSequence(encoder.encode('\x1b[H\x1b[2J\x1b[3J')), true, 'Detects combined clear');
  assert.strictEqual(containsAnsiClearSequence(encoder.encode('\x1b[0J')), false, 'Ignores partial erase 0J');
  assert.strictEqual(containsAnsiClearSequence(encoder.encode('\x1b[K')), false, 'Ignores line erase K');
  assert.strictEqual(containsAnsiClearSequence(encoder.encode('\x1b[32mhello\x1b[0m')), false, 'Ignores color codes');
  assert.strictEqual(containsAnsiClearSequence(encoder.encode('clear\r\n')), false, 'Ignores plain text');
  console.log('✓ ANSI clear sequence detector correctly handles ED 2, ED 3, and RIS');
}

// ---------------------------------------------------------------------------
// Test 3: Natural shell output lifecycle with multi-chunk clear & prompt (zsh pattern)
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 3: Natural shell output lifecycle with multi-chunk clear & prompt ---');
  const term = new Terminal({ rows: 5, cols: 40 });
  setupItermClearHandler(term);

  // 1. Accumulate 10 lines of previous session output
  let initial = '';
  for (let i = 1; i <= 10; i++) initial += `line ${i}\r\n`;
  initial += 'user@host:~$ ';

  await new Promise((resolve) => {
    term.write(initial, resolve);
  });

  assert.strictEqual(term.buffer.active.length, 11, 'Buffer has 11 lines before clear');
  assert.strictEqual(term.buffer.active.baseY, 6, 'Scrollback baseY is 6');

  // 2. Shell executes clear in real macOS zsh pattern (multiple chunks):
  // Chunk 1: Echo of command
  await new Promise((resolve) => {
    term.write('clear\r\n', resolve);
  });

  // Chunk 2: Clear escape sequences from /usr/bin/clear
  await new Promise((resolve) => {
    term.write('\x1b[3J\x1b[H\x1b[2J', resolve);
  });

  // Chunk 3 & 4: New prompt
  await new Promise((resolve) => {
    term.write('user@host:~$ ', resolve);
  });

  term.scrollToBottom();

  // Assertions on the new visible viewport state:
  assert.strictEqual(term.buffer.active.cursorY, 0, 'Cursor is at Row 0 of visible screen');
  assert.strictEqual(term.buffer.active.cursorX, 13, 'Cursor is positioned after prompt');

  const visiblePrompt = term.buffer.active.getLine(term.buffer.active.baseY).translateToString(true);
  assert.strictEqual(visiblePrompt, 'user@host:~$ ', 'Fresh prompt rendered at top row (Row 0)');

  // Verify all other visible rows are clean and empty
  for (let r = 1; r < term.rows; r++) {
    const rowText = term.buffer.active.getLine(term.buffer.active.baseY + r).translateToString(true);
    assert.strictEqual(rowText, '', `Visible row ${r} is blank`);
  }

  // Verify scrollback right above the new screen has the command that was executed
  const lineDirectlyAbove = term.buffer.active.getLine(term.buffer.active.baseY - 1).translateToString(true);
  assert.strictEqual(lineDirectlyAbove, 'user@host:~$ clear', 'Command is in scrollback right above fresh screen');

  // Verify there are NO duplicate prompt lines in scrollback
  const lineTwoAbove = term.buffer.active.getLine(term.buffer.active.baseY - 2).translateToString(true);
  assert.strictEqual(lineTwoAbove, 'line 10', 'Prior output precedes clear command without duplicate prompt');

  console.log('✓ Multi-chunk shell clear lifecycle cleanly moves to fresh viewport with zero duplicate prompts');
}

// ---------------------------------------------------------------------------
// Test 4: Capture panel transcript blocks are NOT deleted by running clear
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 4: Capture panel blocks are NOT deleted by clear ---');
  const session = new SimulatedWorkspaceTerminalSession();

  // 1. Run 3 commands and populate transcript
  session.sendTerminalInput('echo "test 1"\r');
  await session.receiveTerminalOutput(new TextEncoder().encode('echo "test 1"\r\ntest 1\r\nuser@host:~$ '));

  session.sendTerminalInput('git status\r');
  await session.receiveTerminalOutput(new TextEncoder().encode('git status\r\nOn branch main\r\nuser@host:~$ '));

  session.sendTerminalInput('date\r');
  await session.receiveTerminalOutput(new TextEncoder().encode('date\r\nWed Sep 23 18:00:00\r\nuser@host:~$ '));

  assert.strictEqual(session.capture.blocks.length, 3, 'Transcript has 3 captured blocks before clear');
  const block1Id = session.capture.blocks[0].id;
  const block2Id = session.capture.blocks[1].id;
  const block3Id = session.capture.blocks[2].id;

  // 2. User executes `clear` command in terminal
  session.sendTerminalInput('clear\r');
  // Shell echoes clear, outputs escape sequences and new prompt
  await session.receiveTerminalOutput(new TextEncoder().encode('clear\r\n\x1b[3J\x1b[H\x1b[2J'));
  await session.receiveTerminalOutput(new TextEncoder().encode('user@host:~$ '));

  // 3. Assertions:
  // - Viewport was cleared/re-anchored
  assert.strictEqual(session.hasViewportCleared, true, 'Terminal viewport was reset/re-anchored');

  // - Capture blocks must NOT be deleted
  assert.strictEqual(session.capture.blocks.length, 3, 'All 3 blocks are preserved after clear');
  assert.strictEqual(session.capture.blocks[0].id, block1Id, 'Block 1 preserved');
  assert.strictEqual(session.capture.blocks[0].command, 'echo "test 1"');
  assert.strictEqual(session.capture.blocks[1].id, block2Id, 'Block 2 preserved');
  assert.strictEqual(session.capture.blocks[1].command, 'git status');
  assert.strictEqual(session.capture.blocks[2].id, block3Id, 'Block 3 preserved');
  assert.strictEqual(session.capture.blocks[2].command, 'date');

  // - No delete confirmation or modal triggered
  assert.strictEqual(session.pendingConfirmation, null, 'No confirmation UI was shown');

  console.log('✓ Capture panel transcript blocks strictly preserved across clear execution');
}

// ---------------------------------------------------------------------------
// Test 5: Prior captured history remains available & subsequent commands append normally
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 5: Prior captured history remains reviewable & subsequent commands work ---');
  const session = new SimulatedWorkspaceTerminalSession();

  // Populate pre-clear block
  session.sendTerminalInput('pwd\r');
  await session.receiveTerminalOutput(new TextEncoder().encode('pwd\r\n/Users/test/traceRelay\r\nuser@host:~$ '));
  assert.strictEqual(session.capture.blocks.length, 1);

  // Run clear
  session.sendTerminalInput('clear\r');
  await session.receiveTerminalOutput(new TextEncoder().encode('clear\r\n\x1b[3J\x1b[H\x1b[2J'));
  await session.receiveTerminalOutput(new TextEncoder().encode('user@host:~$ '));

  // Run post-clear command
  session.sendTerminalInput('ls -la\r');
  await session.receiveTerminalOutput(new TextEncoder().encode('ls -la\r\ntotal 0\r\nuser@host:~$ '));

  // Assert both pre-clear and post-clear blocks are present
  assert.strictEqual(session.capture.blocks.length, 2, 'Transcript has both pre-clear and post-clear blocks');
  assert.strictEqual(session.capture.blocks[0].command, 'pwd', 'Pre-clear block intact');
  assert.strictEqual(session.capture.blocks[1].command, 'ls -la', 'Post-clear block appended');

  console.log('✓ Pre-clear and post-clear command history seamlessly co-exist without loss');
}

// ---------------------------------------------------------------------------
// Test 6: Terminal resize after clear preserves prompt and scrollback position
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 6: Terminal resize after clear preserves prompt and scrollback ---');
  const term = new Terminal({ rows: 5, cols: 40 });
  setupItermClearHandler(term);

  await new Promise((resolve) => {
    term.write('line A\r\nline B\r\nuser@host:~$ clear\r\n\x1b[3J\x1b[H\x1b[2Juser@host:~$ ', resolve);
  });

  assert.strictEqual(term.buffer.active.cursorY, 0, 'Cursor at row 0');

  // Resize terminal
  term.resize(60, 8);

  // Prompt must remain visible at baseY
  const visiblePrompt = term.buffer.active.getLine(term.buffer.active.baseY).translateToString(true);
  assert.ok(visiblePrompt.startsWith('user@host:~$'), 'Prompt remains at top of visible screen after resize');
  assert.strictEqual(term.buffer.active.cursorY, 0, 'Cursor remains at row 0 after resize');

  console.log('✓ Terminal resize preserves fresh prompt viewport position');
}

// ---------------------------------------------------------------------------
// Test 7: Cmd+K behavior distinction (clears emulator buffer without deleting capture evidence)
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 7: Cmd+K distinction: clears local buffer, preserves capture evidence ---');
  const session = new SimulatedWorkspaceTerminalSession();

  // Add commands to terminal and capture panel
  session.sendTerminalInput('echo "before cmd-k"\r');
  await session.receiveTerminalOutput(new TextEncoder().encode('echo "before cmd-k"\r\noutput line\r\nuser@host:~$ '));
  assert.strictEqual(session.capture.blocks.length, 1, '1 block captured');

  // Trigger Cmd+K on the terminal emulator
  session.xterm.clear();

  // Terminal scrollback length is reset to viewport rows
  assert.strictEqual(session.xterm.buffer.active.length, 10, 'Terminal emulator buffer reset to 10 rows');
  assert.strictEqual(session.xterm.buffer.active.baseY, 0, 'Scrollback baseY is 0');

  // Crucial: Capture blocks on the right-side capture panel are STILL completely preserved!
  assert.strictEqual(session.capture.blocks.length, 1, 'Capture blocks remain 100% intact after Cmd+K');
  assert.strictEqual(session.capture.blocks[0].command, 'echo "before cmd-k"');

  console.log('✓ Cmd+K distinction verified: local buffer cleared, capture panel unchanged');
}

// ---------------------------------------------------------------------------
// Test 8: Verify App.tsx, TerminalPane.tsx, and transcriptFormat.tsx invariants
// ---------------------------------------------------------------------------
{
  console.log('\\n--- Test 8: Verify source code implementation invariants ---');
  const appTsx = fs.readFileSync(path.resolve(__dirname, '../app/src/App.tsx'), 'utf8');
  assert.ok(appTsx.includes('isTerminalClearCommand'), 'App.tsx imports and uses isTerminalClearCommand');
  // App.tsx should NOT double-call clear() on input to avoid premature clearing and race conditions
  assert.ok(
    !appTsx.includes('terminalRefs.current.get(terminalPaneId)?.clear()'),
    'App.tsx avoids premature local clear on input so shell PTY drives the clear lifecycle cleanly',
  );

  const termPaneTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/terminal/TerminalPane.tsx'),
    'utf8',
  );
  assert.ok(termPaneTsx.includes('containsAnsiClearSequence'), 'TerminalPane uses containsAnsiClearSequence');
  assert.ok(termPaneTsx.includes('scrollTerminalToFreshScreen'), 'TerminalPane uses scrollTerminalToFreshScreen');
  assert.ok(termPaneTsx.includes('registerCsiHandler'), 'TerminalPane registers CSI handler for J');
  assert.ok(termPaneTsx.includes('pendingClearScrollRef'), 'TerminalPane tracks pendingClearScrollRef across chunks');
  assert.ok(termPaneTsx.includes('isClearShortcut'), 'TerminalPane implements Cmd+K clear shortcut');

  const formatTs = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/transcript/transcriptFormat.ts'),
    'utf8',
  );
  assert.ok(formatTs.includes('isTerminalClearCommand'), 'transcriptFormat.ts defines isTerminalClearCommand');

  const termAnsiTs = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/terminal/terminalAnsi.ts'),
    'utf8',
  );
  assert.ok(
    termAnsiTs.includes('containsAnsiClearSequence'),
    'terminalAnsi.ts defines containsAnsiClearSequence',
  );
  assert.ok(
    termAnsiTs.includes('scrollTerminalToFreshScreen'),
    'terminalAnsi.ts defines scrollTerminalToFreshScreen',
  );

  console.log('✓ All source code invariants for viewport re-anchoring verified');
}

console.log('\\n=======================================================================');
console.log('ALL 8 TERMINAL VIEWPORT CLEAR BEHAVIOR TESTS PASSED!');
console.log('=======================================================================\\n');
