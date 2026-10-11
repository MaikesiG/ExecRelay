/* eslint-disable no-control-regex */

/**
 * Regex matching Zsh's PROMPT_EOL_MARK / PROMPT_SP terminal sequence.
 * In interactive Zsh, before precmd and the prompt, Zsh emits a standout '%' (or '#')
 * followed by screen-width spaces and carriage returns to ensure the prompt starts
 * on a fresh line if the process output lacked a trailing newline.
 *
 * This sequence is a shell terminal-presentation artifact and MUST NOT be captured
 * as program output in derived Execution text.
 */
const ZSH_PROMPT_EOL_REGEX =
  /(?:\x1b\[[0-9;]*m)*\x1b\[[0-9;]*(?:7m|7;[0-9;]*m)[%#](?:\x1b\[[0-9;]*27m|\x1b\[[0-9;]*0m)(?:\x1b\[[0-9;]*m)*[ ]*(?:\r[ ]*\r|\r\n|\r|\n)*/g;

/**
 * Regex matching unstyled padding from EOL marks (standout stripped or missing),
 * characterized by a prompt character followed by at least 10 padding spaces and CR/LF.
 */
const UNSTYLED_EOL_REGEX =
  /(?:^|\n)[%#][ ]{10,}(?:\r[ ]*\r|\r\n|\r|\n)*$/g;

/**
 * Stateful streaming sanitizer for derived transcript output.
 *
 * INVARIANTS:
 * 1. Bounded ephemeral parser state: buffers incomplete ANSI/CSI/OSC sequences across chunks (max 512 bytes).
 * 2. Streaming equivalence: sanitize(chunk1) + sanitize(chunk2) === sanitize(chunk1 + chunk2).
 * 3. Never mutates raw evidence; only produces clean derived text.
 * 4. Strips ANSI SGR colors, general CSI, OSC markers, and Zsh PROMPT_EOL_MARK artifacts.
 * 5. Strictly preserves literal program outputs containing '%' (e.g. '100%', '%') and '[27m'.
 * 6. Isolated per terminal pane/stream runtime and explicitly cleared upon teardown or command completion.
 */
export class StreamingTranscriptSanitizer {
  private partialBuffer: string = '';
  private readonly maxBufferSize: number = 512;

  constructor(maxBufferSize: number = 512) {
    this.maxBufferSize = maxBufferSize;
  }

  /**
   * Resets the ephemeral partial sequence buffer.
   */
  public reset(): void {
    this.partialBuffer = '';
  }

  /**
   * Returns current buffered partial escape sequence (for inspection/testing).
   */
  public getPartialBuffer(): string {
    return this.partialBuffer;
  }

  /**
   * Flushes any remaining buffered text when a stream closes or command finishes.
   */
  public flush(): string {
    const leftover = this.partialBuffer;
    this.partialBuffer = '';
    if (!leftover) return '';
    // If leftover begins with an incomplete ESC, drop the ESC character and sanitize the rest
    if (leftover.startsWith('\x1b')) {
      return this.sanitizeString(leftover.slice(1));
    }
    return this.sanitizeString(leftover);
  }

  /**
   * Ingests an incoming PTY chunk and returns cleaned, derived human/AI-readable text.
   */
  public sanitize(chunk: string): string {
    if (!chunk && !this.partialBuffer) return '';
    let input = this.partialBuffer + chunk;
    this.partialBuffer = '';

    // 1. Strip Zsh PROMPT_EOL_MARK sequence if present
    input = input.replace(ZSH_PROMPT_EOL_REGEX, '');
    input = input.replace(UNSTYLED_EOL_REGEX, '');

    // 2. Check if input ends with the beginning of a PROMPT_EOL_MARK
    const partialEolMatch = input.match(
      /(?:\x1b\[[0-9;]*m)*\x1b\[[0-9;]*(?:7m|7;[0-9;]*m)[%#][\x1b[0-9;m]*$/,
    );
    if (partialEolMatch && partialEolMatch.index !== undefined) {
      this.partialBuffer = input.slice(partialEolMatch.index);
      input = input.slice(0, partialEolMatch.index);
    }

    return this.sanitizeString(input);
  }

  private sanitizeString(input: string): string {
    let clean = '';
    let i = 0;
    const len = input.length;

    while (i < len) {
      const char = input[i];

      // Normalize CRLF and CR to LF
      if (char === '\r') {
        if (i + 1 < len && input[i + 1] === '\n') {
          clean += '\n';
          i += 2;
          continue;
        } else if (i === len - 1) {
          // Trailing \r at chunk boundary: buffer in case next chunk starts with \n
          this.partialBuffer = '\r' + this.partialBuffer;
          break;
        } else {
          // Standalone \r in middle of chunk -> normalize to \n
          clean += '\n';
          i++;
          continue;
        }
      }

      if (char === '\x1b') {
        // Trailing ESC at very end of chunk: buffer for next chunk
        if (i === len - 1) {
          this.partialBuffer = '\x1b' + this.partialBuffer;
          break;
        }

        const next = input[i + 1];

        // CSI sequence: ESC [ ... [command byte]
        if (next === '[') {
          let j = i + 2;
          // Parameter bytes: 0x30-0x3F (0-9:;<=>?)
          while (
            j < len &&
            input.charCodeAt(j) >= 0x30 &&
            input.charCodeAt(j) <= 0x3F
          ) {
            j++;
          }
          // Intermediate bytes: 0x20-0x2F (space ! " # $ % & ' ( ) * + , - . /)
          while (
            j < len &&
            input.charCodeAt(j) >= 0x20 &&
            input.charCodeAt(j) <= 0x2F
          ) {
            j++;
          }
          if (j < len) {
            const finalCode = input.charCodeAt(j);
            if (finalCode >= 0x40 && finalCode <= 0x7E) {
              // Complete CSI sequence found -> strip it
              i = j + 1;
              continue;
            } else {
              // Invalid CSI character -> drop ESC and continue
              i++;
              continue;
            }
          } else {
            // Incomplete CSI sequence at end of chunk: buffer for next chunk
            const candidate = input.slice(i);
            if (candidate.length <= this.maxBufferSize) {
              this.partialBuffer = candidate + this.partialBuffer;
              break;
            } else {
              // Runaway sequence guard: discard ESC to prevent unbounded memory growth
              i++;
              continue;
            }
          }
        }

        // OSC sequence: ESC ] ... (BEL \x07 or ST \x1b\)
        if (next === ']') {
          let termIdx = -1;
          let termLen = 0;
          for (let j = i + 2; j < len; j++) {
            if (input[j] === '\x07') {
              termIdx = j;
              termLen = 1;
              break;
            }
            if (
              input[j] === '\x1b' &&
              j + 1 < len &&
              input[j + 1] === '\\'
            ) {
              termIdx = j;
              termLen = 2;
              break;
            }
          }
          if (termIdx !== -1) {
            // Complete OSC sequence found -> strip it
            i = termIdx + termLen;
            continue;
          } else {
            // Incomplete OSC sequence at end of chunk: buffer for next chunk
            const candidate = input.slice(i);
            if (candidate.length <= this.maxBufferSize) {
              this.partialBuffer = candidate + this.partialBuffer;
              break;
            } else {
              // Runaway OSC guard
              i += 2;
              continue;
            }
          }
        }

        // 2-character escape sequences: ESC followed by standard byte in 0x40-0x5F (@-Z\_)
        const nextCode = input.charCodeAt(i + 1);
        if (nextCode >= 0x40 && nextCode <= 0x5F) {
          i += 2;
          continue;
        }

        // Charset designation: ESC followed by (, ), *, + and character
        if (
          next === '(' ||
          next === ')' ||
          next === '*' ||
          next === '+'
        ) {
          if (i + 2 < len) {
            i += 3;
            continue;
          } else {
            this.partialBuffer = input.slice(i) + this.partialBuffer;
            break;
          }
        }

        // Unrecognized ESC sequence -> drop ESC
        i++;
        continue;
      }

      // ASCII control characters except \n (0x0A) and \t (0x09)
      const code = input.charCodeAt(i);
      if (code < 0x20 && code !== 0x0A && code !== 0x09) {
        i++;
        continue;
      }
      if (code === 0x7F) {
        i++;
        continue;
      }

      // Regular character
      clean += char;
      i++;
    }

    return clean;
  }
}

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
  const sanitizer = new StreamingTranscriptSanitizer();
  const cleaned = sanitizer.sanitize(rawChunk);
  const flushed = sanitizer.flush();
  return cleaned + flushed;
}

/**
 * Options for prompt detection and exclusion.
 */
export interface PromptTailOptions {
  /**
   * When true, trusted shell integration (OSC 133 C / D) established the
   * command boundary. Standalone characters like '%', '$', '#', '❯' are
   * trusted as legitimate process output and MUST NOT be heuristic-stripped.
   */
  trustedBoundary?: boolean;
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
export function isCandidatePrompt(
  line: string,
  options?: PromptTailOptions,
): boolean {
  if (!line || line.includes('\n') || line.length > 300) {
    return false;
  }

  const trimmed = line.trimEnd();
  if (trimmed.length === 0) {
    return false;
  }

  // Guard: In trusted boundary mode, standalone prompt characters without shell context
  // are legitimate process outputs (e.g. printf '%\n' or printf '$\n') and must survive!
  if (options?.trustedBoundary) {
    if (
      trimmed === '%' ||
      trimmed === '$' ||
      trimmed === '#' ||
      trimmed === '❯' ||
      trimmed === '›' ||
      trimmed === '➜'
    ) {
      return false;
    }
  }

  // Pure standalone prompt character (fallback mode only)
  if (
    !options?.trustedBoundary &&
    (trimmed === '%' ||
      trimmed === '$' ||
      trimmed === '#' ||
      trimmed === '❯' ||
      trimmed === '›')
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
export function splitPromptTail(
  text: string,
  options?: PromptTailOptions,
): {
  substantiveOutput: string;
  promptTail: string | null;
} {
  if (!text) {
    return { substantiveOutput: '', promptTail: null };
  }

  // When output is purely whitespace/newlines (e.g. from Enter key echo or false), return empty
  if (text.trim().length === 0) {
    return { substantiveOutput: '', promptTail: null };
  }

  const lastNewline = text.lastIndexOf('\n');
  const tail = lastNewline === -1 ? text : text.slice(lastNewline + 1);

  if (isCandidatePrompt(tail, options)) {
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
