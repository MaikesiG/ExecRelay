import { stripAnsiAndControl } from './transcriptFormat';

/**
 * Result of cleanTranscriptForDisplay containing cleaned output and metadata
 * for UI rendering and future raw/cleaned view toggling.
 */
export interface CleanedTranscriptResult {
  /** The cleaned output string ready for display */
  cleanedText: string;
  /** The raw transcript input (unmutated) */
  rawText: string;
  /** Whether any prompt lines were hidden or collapsed */
  hasHiddenPrompts: boolean;
  /** The number of prompt lines that were hidden or collapsed */
  hiddenPromptCount: number;
  /** Whether consecutive blank lines were collapsed or trimmed */
  hasCollapsedBlankLines: boolean;
  /** Total line count of cleaned output (0 if output is empty or only shell chrome) */
  lineCount: number;
  /** Whether substantive output was captured (false if output was empty or only shell chrome) */
  hasSubstantiveOutput: boolean;
}

/**
 * Configuration options for transcript display cleanup.
 */
export interface CleanTranscriptOptions {
  /** Fallback string when output is empty or only prompts (default: "(no output captured)") */
  fallbackText?: string;
  /** Whether to strip trailing prompt lines (default: true) */
  stripTrailingPrompts?: boolean;
  /** Whether to collapse repeated prompt lines (default: true) */
  collapsePrompts?: boolean;
  /** Maximum consecutive blank lines to retain in interior (default: 1) */
  maxConsecutiveBlankLines?: number;
}

/**
 * Conservative heuristic for detecting standalone shell prompt lines.
 *
 * Detects patterns like:
 * - xingchiguo@MacBookPro ~ %
 * - user@host path $
 * - root@host:/path#
 * - (base) user@host:~$
 * - [user@host path]$
 * - simple standalone prompt-only lines like "%", "$", "❯", "›"
 *
 * Strictly guards against:
 * - command lines (e.g. "$ ls")
 * - percentages (e.g. "100%", "50.5%")
 * - error messages / stack traces / logs
 * - currency (e.g. "$10")
 * - code / file paths / diffs
 */
export function isPromptLine(line: string): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 300) {
    return false;
  }

  // Guard: lines that look like error messages, stack traces, log lines, diffs, file listings
  if (
    /^(?:error|fatal|warn|info|debug|traceback|exception|\s*at\s|drwx|[-rwx]{9,}|commit\s|\+{3}|-{3}|@@)/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  // Guard: percentages (e.g. "100%", "50.5%", "[ 85%]", "progress: 40%")
  if (/\d+\s*%\s*$/.test(trimmed)) {
    return false;
  }

  // Guard: currency (e.g. "$10", "$ 100.50", "US$ 50")
  if (/\$\s*\d/.test(trimmed)) {
    return false;
  }

  // Guard: LaTeX or PID (e.g. "$$")
  if (trimmed === '$$') {
    return false;
  }

  // 1. Simple standalone prompt-only symbol: "$", "%", "❯", "›", "➜"
  if (/^[$%❯›➜]\s*$/.test(trimmed)) {
    return true;
  }

  // Standalone prompt lines must END with a prompt terminator: $, %, #, ❯, ›
  const lastChar = trimmed[trimmed.length - 1];
  if (
    lastChar !== '$' &&
    lastChar !== '%' &&
    lastChar !== '#' &&
    lastChar !== '❯' &&
    lastChar !== '›'
  ) {
    return false;
  }

  // 2. Multi-line prompt symbols (e.g. box drawing prompt like ╰─$ or ╰─❯ or └─$)
  if (/^[╰└]\s*─*\s*[$%❯›]\s*$/.test(trimmed)) {
    return true;
  }

  // 3. User@host prompt pattern ending in $, %, ❯, ›
  // Examples:
  // - "xingchiguo@MacBookPro ~ %"
  // - "user@host path $"
  // - "user@host:~$ "
  // - "(base) xingchiguo@MacBookPro ~ %"
  // - "(venv) user@host:/path$"
  // - "[user@host path]$"
  if (
    /^(?:\([\w.-]+\)\s+)?\[?[\w.-]+@[\w.-]+(?:[:\s][^$%\n]*)?\]?[$%❯›]\s*$/.test(
      trimmed,
    )
  ) {
    return true;
  }

  // 4. Root prompt ending in # (must explicitly have root@ or user@host)
  // Examples: "root@host:/path#", "root@host:~#", "[root@host dir]#"
  if (
    /^(?:\([\w.-]+\)\s+)?\[?(?:root|[\w.-]+)@[\w.-]+(?:[:\s][^#\n]*)?\]?#\s*$/.test(
      trimmed,
    )
  ) {
    return true;
  }

  // 5. Modern shell prompts starting with ➜ or ❯:
  // e.g. "➜  ~ %", "➜  traceRelay git:(main) $"
  if (/^➜\s+.*[$%❯›]\s*$/.test(trimmed)) {
    return true;
  }

  // 6. Path-based prompt ending in $ or %:
  // e.g. "host:path user$", "MacBookPro:traceRelay user%"
  if (/^[\w.-]+:[^$%\n]+\s+[\w.-]+[$%]\s*$/.test(trimmed)) {
    return true;
  }

  // 7. Pure path prompt ending in $ or %:
  // e.g. "~/development/projects %", "/usr/local/bin $"
  if (/^(?:\([\w.-]+\)\s+)?(?:~|\/)[^$%\n]*\s+[$%]\s*$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Cleans raw transcript output for structured block display in the TraceRelay capture panel.
 *
 * Rules:
 * 1. Strips ANSI escape codes and terminal control sequences.
 * 2. Trims trailing whitespace from each line.
 * 3. Hides trailing prompt-only lines at the end of the block.
 * 4. Trims leading and trailing blank lines.
 * 5. Collapses consecutive blank lines to at most one rendered blank line.
 * 6. Collapses repeated consecutive prompt lines (or prompts separated only by blank lines) to at most one visible prompt line.
 * 7. Preserves meaningful command output, paths, errors, code, and intentional line breaks.
 * 8. Does not mutate the input raw transcript string.
 */
export function cleanTranscriptForDisplay(
  rawTranscript: string,
  options?: CleanTranscriptOptions,
): CleanedTranscriptResult {
  const rawText = rawTranscript ?? '';
  const fallbackText = options?.fallbackText ?? '(no output captured)';
  const stripTrailingPrompts = options?.stripTrailingPrompts !== false;
  const collapsePrompts = options?.collapsePrompts !== false;
  const maxConsecutiveBlankLines = options?.maxConsecutiveBlankLines ?? 1;

  if (!rawText) {
    return {
      cleanedText: fallbackText,
      rawText,
      hasHiddenPrompts: false,
      hiddenPromptCount: 0,
      hasCollapsedBlankLines: false,
      lineCount: 0,
      hasSubstantiveOutput: false,
    };
  }

  // 1. Strip ANSI and non-printable control sequences
  const clean = stripAnsiAndControl(rawText);
  const rawLines = clean.split('\n');

  // 2. Strip trailing spaces and tabs from every line
  const lines = rawLines.map((line) => line.replace(/[ \t]+$/, ''));

  let hasHiddenPrompts = false;
  let hiddenPromptCount = 0;
  let hasCollapsedBlankLines = false;

  // 3. Phase A: Identify and trim trailing prompt lines and blank lines
  let endIndex = lines.length - 1;

  if (stripTrailingPrompts) {
    while (endIndex >= 0) {
      const line = lines[endIndex];
      if (line === '') {
        hasCollapsedBlankLines = true;
        endIndex--;
      } else if (isPromptLine(line)) {
        hasHiddenPrompts = true;
        hiddenPromptCount++;
        endIndex--;
      } else {
        break;
      }
    }
  } else {
    while (endIndex >= 0 && lines[endIndex] === '') {
      hasCollapsedBlankLines = true;
      endIndex--;
    }
  }

  // If no substantive lines remain:
  if (endIndex < 0) {
    return {
      cleanedText: fallbackText,
      rawText,
      hasHiddenPrompts,
      hiddenPromptCount,
      hasCollapsedBlankLines: true,
      lineCount: 0,
      hasSubstantiveOutput: false,
    };
  }

  // 4. Phase B: Identify and trim leading blank lines
  let startIndex = 0;
  while (startIndex <= endIndex && lines[startIndex] === '') {
    hasCollapsedBlankLines = true;
    startIndex++;
  }

  if (startIndex > endIndex) {
    return {
      cleanedText: fallbackText,
      rawText,
      hasHiddenPrompts,
      hiddenPromptCount,
      hasCollapsedBlankLines: true,
      lineCount: 0,
      hasSubstantiveOutput: false,
    };
  }

  // 5. Phase C: Process interior lines (from startIndex to endIndex)
  const resultLines: string[] = [];
  let consecutiveBlankCount = 0;
  let inPromptRun = false;

  for (let i = startIndex; i <= endIndex; i++) {
    const line = lines[i];

    if (isPromptLine(line)) {
      if (collapsePrompts && inPromptRun) {
        // Consecutive prompt line in run -> collapse it
        hasHiddenPrompts = true;
        hiddenPromptCount++;
        consecutiveBlankCount = 0;
      } else {
        inPromptRun = true;
        consecutiveBlankCount = 0;
        resultLines.push(line);
      }
    } else if (line === '') {
      // Check if this blank line is between prompt lines in a prompt run
      if (collapsePrompts && inPromptRun) {
        // Lookahead to check if the next non-blank line is also a prompt line
        let nextNonBlankIdx = i + 1;
        while (nextNonBlankIdx <= endIndex && lines[nextNonBlankIdx] === '') {
          nextNonBlankIdx++;
        }

        if (
          nextNonBlankIdx <= endIndex &&
          isPromptLine(lines[nextNonBlankIdx])
        ) {
          // Multiple prompt-only lines with only blank lines between them:
          // Collapse the intervening blank line as well
          hasCollapsedBlankLines = true;
          continue;
        }
      }

      // Normal blank line handling
      inPromptRun = false;
      consecutiveBlankCount++;
      if (consecutiveBlankCount <= maxConsecutiveBlankLines) {
        resultLines.push('');
      } else {
        hasCollapsedBlankLines = true;
      }
    } else {
      // Regular content line
      inPromptRun = false;
      consecutiveBlankCount = 0;
      resultLines.push(line);
    }
  }

  const cleanedText =
    resultLines.length === 0 ? fallbackText : resultLines.join('\n');

  return {
    cleanedText,
    rawText,
    hasHiddenPrompts,
    hiddenPromptCount,
    hasCollapsedBlankLines,
    lineCount: resultLines.length,
    hasSubstantiveOutput: resultLines.length > 0,
  };
}
