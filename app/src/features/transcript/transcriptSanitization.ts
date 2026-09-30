/* eslint-disable no-control-regex */

/**
 * Pure transcript sanitization helper.
 * Normalizes line endings to LF, strips ANSI CSI/OSC escape sequences,
 * and removes non-printing terminal control characters while preserving
 * newlines (\n) and tabs (\t).
 *
 * This function must ONLY be used on copies of terminal output meant for
 * transcript parsing, and MUST NEVER mutate raw chunks passed to xterm.write.
 */
export function sanitizeTranscriptChunk(rawChunk: string): string {
  if (!rawChunk) {
    return '';
  }
  // 1. Normalize CRLF and CR to LF
  const lf = rawChunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 2. Strip OSC sequences: ESC ] ... (BEL \x07 or ESC \)
  let clean = lf.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  // 3. Strip CSI sequences: ESC [ ... [command byte]
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
 * Conservative prompt detector.
 * Checks whether a single-line tail string matches a shell prompt.
 *
 * Strict requirements:
 * - Must be single-line, bounded length (<= 300 chars).
 * - Must end in a shell prompt character (%, $, #, ❯, ›) optionally followed by whitespace.
 * - Guards against percentage values (e.g. "100% complete", "50%").
 * - Guards against error/log/stack trace lines.
 * - Requires prompt-like context (preceding space, bracket/paren delimiter, or user@host/path indicators).
 */
export function isCandidatePrompt(line: string): boolean {
  if (!line || line.includes('\n') || line.length > 300) {
    return false;
  }

  const trimmed = line.trimEnd();
  if (trimmed.length === 0) {
    return false;
  }

  // Pure standalone prompt character
  if (
    trimmed === '%' ||
    trimmed === '$' ||
    trimmed === '#' ||
    trimmed === '❯' ||
    trimmed === '›'
  ) {
    return true;
  }

  const lastChar = trimmed[trimmed.length - 1];
  if (
    lastChar !== '%' &&
    lastChar !== '$' &&
    lastChar !== '#' &&
    lastChar !== '❯' &&
    lastChar !== '›'
  ) {
    return false;
  }

  // Guard: Avoid pure percentages (e.g., "100%", "50.5%")
  if (/^\d+(\.\d+)?%$/.test(trimmed)) {
    return false;
  }

  // Guard: Avoid error, fatal, traceback, log, or filesystem permission lines
  if (
    /^(?:error|fatal|warn|info|debug|traceback|exception|\s*at\s|\{|\[error\]|drwx|[-rwx]{9,})/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  // In a real prompt, the symbol is typically preceded by:
  // - whitespace: "api %", "host $"
  // - bracket/paren/tilde/colon: "(venv) ... %", "[dir]$", "~#"
  const charBefore = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : '';
  const hasPromptDelimiter = /\s|[)\]>~:]/.test(charBefore);

  if (
    !hasPromptDelimiter &&
    !trimmed.includes('@') &&
    !trimmed.includes('~') &&
    !trimmed.includes(':') &&
    !trimmed.includes('/')
  ) {
    return false;
  }

  return true;
}

/**
 * Splits output into substantive output and a candidate prompt tail.
 * If the line after the last newline matches `isCandidatePrompt`, it is identified
 * as a prompt tail and excluded from substantive output.
 */
export function splitPromptTail(text: string): {
  substantiveOutput: string;
  promptTail: string | null;
} {
  if (!text) {
    return { substantiveOutput: '', promptTail: null };
  }

  const lastNewline = text.lastIndexOf('\n');
  const tail = lastNewline === -1 ? text : text.slice(lastNewline + 1);

  if (isCandidatePrompt(tail)) {
    const substantiveRaw =
      lastNewline === -1 ? '' : text.slice(0, lastNewline + 1);
    // Remove leading newlines originating from Enter key echo
    const substantiveOutput =
      substantiveRaw.trim().length === 0
        ? ''
        : substantiveRaw.replace(/^\n+/, '');
    return { substantiveOutput, promptTail: tail };
  }

  return { substantiveOutput: text, promptTail: null };
}

/**
 * Strips at most one initial command echo from the beginning of the block output.
 * Preserves all matching text appearing later in substantive output.
 */
export function processInitialEcho(
  buffer: string,
  command: string,
  echoChecked: boolean,
): { buffer: string; echoChecked: boolean } {
  if (echoChecked) {
    return { buffer, echoChecked: true };
  }

  const trimmedCmd = command.trim();
  if (!trimmedCmd) {
    return { buffer, echoChecked: true };
  }

  let clean = buffer.replace(/^\n+/, '');

  // Exact command echo followed by newline
  if (clean.startsWith(trimmedCmd + '\n')) {
    clean = clean.slice(trimmedCmd.length + 1);
    return { buffer: clean, echoChecked: true };
  }

  // Exact command echo matching entire buffer
  if (clean === trimmedCmd) {
    return { buffer: '', echoChecked: true };
  }

  // Buffer might still be accumulating the echo chunk
  if (trimmedCmd.startsWith(clean) && !clean.includes('\n')) {
    return { buffer, echoChecked: false };
  }

  // Output does not match the command echo
  return { buffer, echoChecked: true };
}
