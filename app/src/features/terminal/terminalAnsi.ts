/**
 * Utilities for terminal ANSI sequence detection and viewport display handling.
 */

import type { Terminal } from '@xterm/xterm';

/**
 * Checks whether raw terminal output bytes contain ANSI clear-screen sequences
 * such as ED 2 (clear entire screen: ESC [ 2 J), ED 3 (clear scrollback: ESC [ 3 J),\n * or RIS (hard reset: ESC c).
 */
export function containsAnsiClearSequence(bytes: Uint8Array): boolean {
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    if (bytes[i] === 0x1b) {
      // RIS: ESC c (0x1b 0x63)
      if (i + 1 < len && bytes[i + 1] === 0x63) {
        return true;
      }
      // CSI: ESC [ (0x1b 0x5b)
      if (i + 1 < len && bytes[i + 1] === 0x5b) {
        let j = i + 2;
        // Skip parameter characters (0-9, ;, ?, etc., bytes in 0x30..0x3F)
        while (j < len && bytes[j] >= 0x30 && bytes[j] <= 0x3f) {
          j++;
        }
        // Check for 'J' (0x4a) - Erase in Display
        if (j < len && bytes[j] === 0x4a) {
          const paramSlice = bytes.subarray(i + 2, j);
          const paramStr = String.fromCharCode(...paramSlice);
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

/**
 * Re-anchors the terminal viewport to a fresh clean screen position,
 * pushing visible lines into the scrollback buffer (matching iTerm's clear behavior).
 */
export function scrollTerminalToFreshScreen(terminal: Terminal): void {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const core = (terminal as any)._core;
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
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      terminal.scrollToBottom();
      terminal.focus();
    });
  }
}
