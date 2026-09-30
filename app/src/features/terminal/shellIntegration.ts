/**
 * TraceRelay / CapTerm Shell Integration Protocol Parser
 *
 * Implements standard FinalTerm / OSC 133 shell integration stream parsing
 * with explicit trust boundaries and per-session cryptographic nonce authentication.
 *
 * OSC 133 protocol markers:
 * - OSC 133 ; A [; aid=<nonce>] ST/BEL: Prompt start
 * - OSC 133 ; B [; aid=<nonce>] ST/BEL: Prompt end / Command line ready
 * - OSC 133 ; C [; aid=<nonce>] ST/BEL: Command execution start
 * - OSC 133 ; D [; <exitCode>] [; aid=<nonce>] ST/BEL: Command execution finished with exit code
 * - OSC 133 ; P ; <k>=<v> ST/BEL: Property (e.g. Cwd, Prompt)
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. PTY output stream is intercepted BEFORE rendering and capture storage.
 * 2. Shell integration markers carrying a valid session nonce are classified as 'trusted'.
 * 3. Generic or unauthenticated OSC 133 markers (missing or wrong nonce) are classified
 *    as 'untrusted' and MUST NOT establish authoritative execution outcome.
 * 4. OSC 133 markers are stripped from the visible terminal data so they NEVER
 *    pollute xterm rendering, raw command output evidence, or clean display evidence.
 */

export type ShellIntegrationEventTrust = 'trusted' | 'untrusted';

export type ShellIntegrationEvent =
  | {
      type: 'prompt-start';
      options?: string;
      nonce?: string;
      trust: ShellIntegrationEventTrust;
    }
  | {
      type: 'prompt-end';
      options?: string;
      nonce?: string;
      trust: ShellIntegrationEventTrust;
    }
  | {
      type: 'command-start';
      nonce?: string;
      trust: ShellIntegrationEventTrust;
    }
  | {
      type: 'command-end';
      exitCode: number | null;
      nonce?: string;
      trust: ShellIntegrationEventTrust;
    }
  | {
      type: 'property';
      key: string;
      value: string;
      nonce?: string;
      trust: ShellIntegrationEventTrust;
    }
  | {
      type: 'policy-request';
      requestId: string;
      command: string;
      cwd: string;
      status?: 'requested' | 'cancelled';
      nonce?: string;
      trust: ShellIntegrationEventTrust;
    };

export interface ParseResult {
  /**
   * The text chunk with all OSC 133 escape sequences stripped.
   */
  cleanText: string;
  /**
   * Any shell integration events detected in this chunk.
   */
  events: ShellIntegrationEvent[];
}

/**
 * Regex matching full OSC 133 sequences:
 * Matches \x1b]133; ... (\x07 | \x1b\\)
 */
// eslint-disable-next-line no-control-regex
const OSC_133_REGEX = new RegExp('\\x1b\\]133;([^\\x07\\x1b]*)(?:\\x07|\\x1b\\\\)', 'g');

/**
 * Maximum buffer size for incomplete escape sequences before forcing flush.
 * Prevents memory exhaustion on runaway or unterminated escape sequences.
 */
const MAX_ESCAPE_BUFFER_SIZE = 4096;

/**
 * Parses a single OSC 133 payload string (e.g. "D;0;aid=nonce" or "C;aid=nonce" or "D;0").
 * Authenticates against the expected session nonce if provided.
 */
export function parseOsc133Payload(
  payload: string,
  expectedNonce?: string | null,
): ShellIntegrationEvent | null {
  const parts = payload.split(';');
  const code = (parts[0] || '').trim().toUpperCase();

  // Find optional nonce parameter (e.g. "aid=<nonce>" or "nonce=<nonce>")
  let nonce: string | undefined;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part.startsWith('aid=')) {
      nonce = part.slice(4);
    } else if (part.startsWith('nonce=')) {
      nonce = part.slice(6);
    }
  }

  const isTrusted: ShellIntegrationEventTrust =
    expectedNonce && nonce && nonce === expectedNonce
      ? 'trusted'
      : 'untrusted';

  switch (code) {
    case 'A':
      return {
        type: 'prompt-start',
        options: parts[1],
        nonce,
        trust: isTrusted,
      };
    case 'B':
      return {
        type: 'prompt-end',
        options: parts[1],
        nonce,
        trust: isTrusted,
      };
    case 'C':
      return {
        type: 'command-start',
        nonce,
        trust: isTrusted,
      };
    case 'D': {
      let exitCode: number | null = null;
      if (parts.length > 1) {
        const candidate = parts[1].trim();
        // If parts[1] is an aid/nonce assignment, exit code was omitted
        if (!candidate.startsWith('aid=') && !candidate.startsWith('nonce=')) {
          const parsed = parseInt(candidate, 10);
          if (!isNaN(parsed)) {
            exitCode = parsed;
          }
        }
      }
      return {
        type: 'command-end',
        exitCode,
        nonce,
        trust: isTrusted,
      };
    }
    case 'P': {
      if (parts.length > 1) {
        let key = '';
        let value = '';
        for (let i = 1; i < parts.length; i++) {
          const part = parts[i].trim();
          if (part.startsWith('k=')) {
            key = part.slice(2);
          } else if (part.startsWith('v=')) {
            value = part.slice(2);
          } else if (
            part.includes('=') &&
            !part.startsWith('aid=') &&
            !part.startsWith('nonce=')
          ) {
            const eqIdx = part.indexOf('=');
            key = part.slice(0, eqIdx);
            value = part.slice(eqIdx + 1);
          }
        }
        if (key) {
          return {
            type: 'property',
            key,
            value,
            nonce,
            trust: isTrusted,
          };
        }
      }
      return null;
    }
    case 'Q': {
      // Policy request or cancellation marker:
      // Format: Q ; aid=<nonce> ; id=<requestId> [; cwd=<b64cwd>] [; cmd=<b64cmd>] [; status=<status>]
      let requestId = '';
      let b64Cmd = '';
      let b64Cwd = '';
      let status: 'requested' | 'cancelled' = 'requested';

      for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part.startsWith('id=')) {
          requestId = part.slice(3);
        } else if (part.startsWith('cmd=')) {
          b64Cmd = part.slice(4);
        } else if (part.startsWith('cwd=')) {
          b64Cwd = part.slice(4);
        } else if (part.startsWith('status=')) {
          const st = part.slice(7).toLowerCase();
          if (st === 'cancelled') status = 'cancelled';
        }
      }

      const command = b64Cmd ? decodeBase64Utf8(b64Cmd) : '';
      const cwd = b64Cwd ? decodeBase64Utf8(b64Cwd) : '';

      return {
        type: 'policy-request',
        requestId,
        command,
        cwd,
        status,
        nonce,
        trust: isTrusted,
      };
    }
    default:
      return null;
  }
}

/**
 * Decodes a base64 UTF-8 string safely in both Node.js and browser environments.
 */
export function decodeBase64Utf8(b64: string): string {
  try {
    const maybeBuffer = (
      globalThis as unknown as {
        Buffer?: {
          from(str: string, enc: string): { toString(enc: string): string };
        };
      }
    ).Buffer;
    if (maybeBuffer && typeof maybeBuffer.from === 'function') {
      return maybeBuffer.from(b64, 'base64').toString('utf8');
    }
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return b64;
  }
}

/**
 * Strips all OSC 133 escape sequences from a text string.
 */
export function stripOsc133(text: string): string {
  if (!text.includes('\x1b]133;')) {
    return text;
  }
  return text.replace(OSC_133_REGEX, '');
}

/**
 * Extracts all OSC 133 events from a string, evaluating trust against expectedNonce.
 */
export function extractOsc133Events(
  text: string,
  expectedNonce?: string | null,
): ShellIntegrationEvent[] {
  if (!text.includes('\x1b]133;')) {
    return [];
  }

  const events: ShellIntegrationEvent[] = [];
  OSC_133_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = OSC_133_REGEX.exec(text)) !== null) {
    const event = parseOsc133Payload(match[1], expectedNonce);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Stateful streaming parser for terminal output chunks.
 * Buffers partial escape sequences across chunk boundaries to ensure
 * OSC 133 sequences are never split or leaked to xterm or capture blocks.
 *
 * Evaluates authenticity against the active session's cryptographic nonce.
 */
export class ShellIntegrationStreamParser {
  private partialBuffer = '';
  private expectedNonce: string | null = null;

  constructor(expectedNonce?: string | null) {
    this.expectedNonce = expectedNonce ?? null;
  }

  /**
   * Sets or updates the active expected session nonce.
   */
  public setExpectedNonce(nonce: string | null): void {
    this.expectedNonce = nonce;
  }

  /**
   * Returns the currently configured expected session nonce.
   */
  public getExpectedNonce(): string | null {
    return this.expectedNonce;
  }

  /**
   * Ingests a new incoming text chunk, extracts any completed OSC 133 events,
   * buffers incomplete escape sequences, and returns the cleaned text.
   */
  public parse(chunk: string): ParseResult {
    const input = this.partialBuffer + chunk;
    this.partialBuffer = '';

    if (!input.includes('\x1b')) {
      return { cleanText: input, events: [] };
    }

    const events: ShellIntegrationEvent[] = [];
    let cleanText = '';
    let i = 0;

    while (i < input.length) {
      const escIdx = input.indexOf('\x1b', i);
      if (escIdx === -1) {
        cleanText += input.slice(i);
        break;
      }

      // Append text preceding the escape sequence
      cleanText += input.slice(i, escIdx);
      i = escIdx;

      // Check if this looks like the start of an OSC sequence (\x1b])
      if (i + 1 >= input.length) {
        // Trailing ESC at boundary: buffer for next chunk
        this.partialBuffer = input.slice(i);
        break;
      }

      if (input[i + 1] !== ']') {
        // Not an OSC sequence, pass ESC through as normal
        cleanText += input[i];
        i += 1;
        continue;
      }

      // Check if it matches \x1b]133; prefix
      const remaining = input.slice(i);
      const prefix = '\x1b]133;';

      if (remaining.length < prefix.length) {
        if (prefix.startsWith(remaining)) {
          // Partial prefix at end of chunk: buffer for next chunk
          this.partialBuffer = remaining;
          break;
        } else {
          // Not OSC 133, leave as is
          cleanText += input[i];
          i += 1;
          continue;
        }
      }

      if (remaining.startsWith(prefix)) {
        // Find terminator: either \x07 (BEL) or \x1b\ (ST)
        let termIdx = -1;
        let termLen = 0;

        for (let j = i + prefix.length; j < input.length; j++) {
          if (input[j] === '\x07') {
            termIdx = j;
            termLen = 1;
            break;
          }
          if (
            input[j] === '\x1b' &&
            j + 1 < input.length &&
            input[j + 1] === '\\'
          ) {
            termIdx = j;
            termLen = 2;
            break;
          }
        }

        if (termIdx === -1) {
          // Unterminated sequence: check buffer size guard
          if (remaining.length > MAX_ESCAPE_BUFFER_SIZE) {
            // Runaway or malformed sequence without terminator: flush safely
            cleanText += remaining.slice(0, prefix.length);
            i += prefix.length;
            continue;
          }

          // Incomplete OSC 133 sequence: buffer and wait for terminator in next chunk
          this.partialBuffer = remaining;
          break;
        }

        // Complete OSC 133 sequence found
        const payload = input.slice(i + prefix.length, termIdx);
        const event = parseOsc133Payload(payload, this.expectedNonce);
        if (event) {
          events.push(event);
        }
        // Advance past terminator without appending to cleanText
        i = termIdx + termLen;
      } else {
        // Other OSC sequence (e.g. OSC 0, OSC 7): pass through to cleanText
        cleanText += input[i];
        i += 1;
      }
    }

    return { cleanText, events };
  }

  /**
   * Flushes any remaining buffered text upon stream close or reset.
   */
  public flush(): string {
    const leftover = this.partialBuffer;
    this.partialBuffer = '';
    return leftover;
  }

  /**
   * Resets internal buffer state.
   */
  public reset(): void {
    this.partialBuffer = '';
  }
}
