/* eslint-disable no-control-regex */

/**
 * Strips ANSI CSI and OSC escape sequences and terminal control characters
 * while converting CRLF/CR to LF and preserving newlines (\n) and tabs (\t).
 */
export function stripAnsiAndControl(text: string): string {
  // 1. Convert CRLF and CR to LF
  const lf = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 2. Strip OSC escape sequences: ESC ] ... (BEL or ESC \)
  let clean = lf.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  // 3. Strip CSI escape sequences: ESC [ ... [command byte]
  clean = clean.replace(/\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g, '');
  // 4. Strip 2-character escape sequences: ESC followed by standard byte (0x40-0x5F)
  clean = clean.replace(/\x1b[@-Z\\-_]/g, '');
  // 5. Strip any lingering ESC characters
  clean = clean.replace(/\x1b/g, '');
  // 6. Strip control characters except newline (\n = 0x0A) and tab (\t = 0x09)
  clean = clean.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return clean;
}

/**
 * Normalizes command text by stripping control sequences and trimming leading/trailing whitespace.
 */
export function normalizeCommand(command: string): string {
  return stripAnsiAndControl(command).trim();
}

/**
 * Normalizes output text according to specification:
 * - strips ANSI sequences and control bytes
 * - removes leading and trailing blank lines
 * - removes trailing spaces and tabs from every line
 * - collapses runs of 3 or more consecutive blank lines to exactly 2 blank lines
 * - preserves single blank lines and two consecutive blank lines
 * - preserves interior spaces, indentation, tabs, and line breaks in non-blank content
 * - if normalized output is empty, returns "(no output captured)"
 */
export function normalizeOutput(output: string): string {
  const clean = stripAnsiAndControl(output);
  const rawLines = clean.split('\n');

  // Remove trailing spaces and tabs from every line
  const trimmedLines = rawLines.map((line) => line.replace(/[ \t]+$/, ''));

  // Remove leading and trailing blank lines
  let start = 0;
  while (start < trimmedLines.length && trimmedLines[start] === '') {
    start++;
  }

  let end = trimmedLines.length - 1;
  while (end >= start && trimmedLines[end] === '') {
    end--;
  }

  if (start > end) {
    return '(no output captured)';
  }

  const contentLines = trimmedLines.slice(start, end + 1);

  // Collapse every run of 3 or more consecutive blank lines to exactly 2 blank lines
  const resultLines: string[] = [];
  let consecutiveBlankCount = 0;

  for (const line of contentLines) {
    if (line === '') {
      consecutiveBlankCount++;
      if (consecutiveBlankCount <= 2) {
        resultLines.push('');
      }
    } else {
      consecutiveBlankCount = 0;
      resultLines.push(line);
    }
  }

  const result = resultLines.join('\n');
  return result.length === 0 ? '(no output captured)' : result;
}

/**
 * Formats a single transcript block for copy/export with the exact structure:
 * $ {normalized command}
 * {normalized output}
 */
export function formatTranscriptBlock(command: string, output: string): string {
  const normCmd = normalizeCommand(command);
  const normOut = normalizeOutput(output);
  return `$ ${normCmd}\n${normOut}`;
}

/**
 * Writes text to clipboard using navigator.clipboard with document.execCommand fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to fallback
    }
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
}

/**
 * Formats block index label with compact terminal format: {sourceOrdinal}-{itemIndex}
 * e.g. 1-01, 2-03
 */
export function formatBlockLabel(sourceOrdinal: number, itemIndex: number): string {
  const displayIndex = String(itemIndex).padStart(2, '0');
  return `${sourceOrdinal}-${displayIndex}`;
}

/**
 * Detects whether a command string is a terminal viewport clear command
 * (e.g. 'clear', 'clear -x', '/usr/bin/clear', 'cls').
 * Clear commands are terminal display actions that reset the viewport,
 * NOT transcript deletion operations.
 */
export function isTerminalClearCommand(command: string): boolean {
  const norm = normalizeCommand(command).trim().toLowerCase();
  return (
    norm === 'clear' ||
    norm === '\\clear' ||
    norm === 'clear -x' ||
    norm === '/usr/bin/clear' ||
    norm === 'cls'
  );
}

export {
  cleanTranscriptForDisplay,
  isPromptLine,
  type CleanedTranscriptResult,
  type CleanTranscriptOptions,
} from './transcriptDisplayCleanup';
