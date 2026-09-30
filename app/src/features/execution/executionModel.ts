/**
 * TraceRelay / CapTerm Execution & Evidence Engine
 *
 * Implements Execution creation, lifecycle transitions, EvidenceBlock decomposition,
 * trustworthy error detection, and formatting helpers.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. xterm.js renders terminal state. It is not the authoritative evidence store.
 * 2. Raw evidence is the immutable source of truth. Clean evidence is a derived presentation layer.
 * 3. Execution lifecycle and execution outcome are semantically separate.
 * 4. Output heuristics may classify diagnostic evidence, but must not fabricate authoritative execution success or failure.
 * 5. Completion provenance records why an execution was considered finished or interrupted.
 */

import {
  type Actor,
  type EvidenceBlock,
  type EvidenceBlockType,
  type Execution,
  type ExecutionCompletionSource,
  type ExecutionIntent,
  type ExecutionLifecycle,
  type ExecutionOutcome,
  type ExecutionOutcomeSource,
  type ExecutionSource,
  type ExecutionState,
  DEFAULT_LOCAL_HUMAN_ACTOR,
} from './types';
import type { TranscriptBlock } from '../transcript/types';
import type { StructuredEngineeringEvidence } from '../structuredEvidence/types';
import {
  normalizeCommand,
  normalizeOutput,
  cleanTranscriptForDisplay,
  stripAnsiAndControl,
} from '../transcript/transcriptFormat';

/**
 * Trustworthy shell & tool error line-prefix patterns.
 * Only line-anchored diagnostic errors are recognized to avoid false positives
 * on conversational words or benign text like "0 errors".
 */
const HIGH_CONFIDENCE_ERROR_PATTERNS: RegExp[] = [
  // Shell error diagnostics
  /^(?:bash|zsh|sh|dash):\s+(?:line\s+\d+:\s+)?.+:\s+command not found/i,
  /^(?:bash|zsh|sh|dash):\s+command not found:\s+.+/i,
  // Standard POSIX / libc perror formats (e.g. cat: file: No such file or directory)
  /^(?:[a-zA-Z0-9_.-]+:\s+)?(?:.+:\s+)?(?:no such file or directory|permission denied|is a directory|not a directory)/i,
  /^(?:bash|zsh|sh|dash):\s+syntax error/i,
  // Standard tool fatal / error lines
  /^fatal:\s+.+/i,
  /^npm\s+ERR!\s+.+/i,
  /^yarn\s+error\s+.+/i,
  /^pnpm\s+ERR!/i,
  /^cargo\s+error:\s+.+/i,
  /^error\[E\d+\]:\s+.+/i,
  // Language runtimes and unhandled errors
  /^(?:SyntaxError|ReferenceError|TypeError|RangeError|URIError|EvalError):\s+.+/,
  /^Traceback \(most recent call last\):/,
  /^panic:\s+.+/,
  // OS signals
  /^(?:SIGSEGV|Segmentation fault|Bus error|Aborted|Killed)(?:\s+\(core dumped\))?/i,
  // Explicit CLI failure reports
  /^command failed:\s+.+/i,
  /^Error:\s+.+/i,
  /^FAILED:\s+.+/i,
];

export interface ErrorDetectionResult {
  isError: boolean;
  confidence: 'high' | 'none';
  matchedPattern?: string;
}

/**
 * Analyzes output text for diagnostic error evidence.
 *
 * CRITICAL RULE:
 * This function returns diagnostic hints for classifying EvidenceBlocks (e.g. type 'error').
 * It MUST NOT authoritatively decide ExecutionOutcome.
 * For example: `grep "ERROR" server.log` outputs errors while succeeding (exit 0).
 */
export function detectErrorFromOutput(output: string): ErrorDetectionResult {
  if (!output || output.trim().length === 0) {
    return { isError: false, confidence: 'none' };
  }

  const clean = stripAnsiAndControl(output);
  const lines = clean.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const pattern of HIGH_CONFIDENCE_ERROR_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          isError: true,
          confidence: 'high',
          matchedPattern: trimmed.slice(0, 80),
        };
      }
    }
  }

  return { isError: false, confidence: 'none' };
}

/**
 * Derives the execution lifecycle (pending, running, finished, interrupted).
 */
export function deriveExecutionLifecycle(
  block: Pick<TranscriptBlock, 'isComplete' | 'executionState' | 'lifecycle'>,
): ExecutionLifecycle {
  if (block.lifecycle) {
    return block.lifecycle;
  }
  if (block.executionState === 'interrupted') {
    return 'interrupted';
  }
  if (block.executionState === 'pending') {
    return 'pending';
  }
  if (!block.isComplete || block.executionState === 'running') {
    return 'running';
  }
  return 'finished';
}

/**
 * Derives the authoritative execution outcome (unknown, succeeded, failed).
 *
 * CRITICAL RULE:
 * Outcome is authoritative ONLY when backed by reliable process/shell exit code
 * or trusted metadata. Output heuristics MUST NEVER fabricate outcome.
 */
export function deriveExecutionOutcome(
  block: Pick<
    TranscriptBlock,
    'exitCode' | 'outcome' | 'outcomeSource' | 'outcomeTrusted'
  >,
): ExecutionOutcome {
  if (block.outcome) {
    return block.outcome;
  }
  if (
    block.outcomeSource === 'trusted-shell' ||
    block.outcomeSource === 'trusted-process' ||
    block.outcomeTrusted
  ) {
    if (block.exitCode !== null && block.exitCode !== undefined) {
      return block.exitCode === 0 ? 'succeeded' : 'failed';
    }
  }
  if (block.outcomeSource === 'unknown') {
    return 'unknown';
  }
  if (block.exitCode !== null && block.exitCode !== undefined) {
    return block.exitCode === 0 ? 'succeeded' : 'failed';
  }
  return 'unknown';
}

/**
 * Derives the legacy execution state for backward compatibility.
 */
export function deriveExecutionState(
  block: Pick<
    TranscriptBlock,
    'isComplete' | 'executionState' | 'lifecycle' | 'outcome' | 'exitCode' | 'hasError' | 'output'
  >,
): ExecutionState {
  if (block.executionState) {
    return block.executionState;
  }

  if (block.lifecycle === 'interrupted') {
    return 'interrupted';
  }

  if (!block.isComplete || block.lifecycle === 'running') {
    return 'running';
  }

  if (block.exitCode !== null && block.exitCode !== undefined) {
    return block.exitCode === 0 ? 'completed' : 'failed';
  }

  if (block.outcome === 'failed') {
    return 'failed';
  }

  if (block.outcome === 'succeeded') {
    return 'completed';
  }

  // When exit status is unknown, legacy fallback returns completed (never infer failed from text)
  return 'completed';
}

/**
 * Formats elapsed duration between startedAt and completedAt.
 * Returns human-friendly format (e.g. "45ms", "1.2s") or null if in progress/unknown.
 */
export function formatExecutionDuration(
  startedAt: number,
  completedAt?: number | null,
): string | null {
  if (completedAt == null || completedAt < startedAt) {
    return null;
  }

  const diffMs = completedAt - startedAt;
  if (diffMs < 1000) {
    return `${diffMs}ms`;
  }

  const seconds = (diffMs / 1000).toFixed(1);
  return `${seconds}s`;
}

/**
 * Formats timestamp to HH:mm:ss in local time.
 */
export function formatExecutionTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export interface CreateExecutionParams {
  id?: string;
  workspaceId: string;
  terminalTabId?: string;
  terminalPaneId?: string;
  actorId?: string;
  source?: ExecutionSource;
  command?: string;
  rawCommand?: string;
  intent?: ExecutionIntent;
  verificationRunId?: string;
  verificationCriterionId?: string;
  lifecycle?: ExecutionLifecycle;
  outcome?: ExecutionOutcome;
  state?: ExecutionState;
  completionSource?: ExecutionCompletionSource;
  outcomeSource?: ExecutionOutcomeSource;
  outcomeTrusted?: boolean;
  exitCode?: number | null;
  hasDiagnosticError?: boolean;
  startedAt?: number;
  completedAt?: number | null;
  evidenceBlockIds?: string[];
  evidenceBlocks?: EvidenceBlock[];
  structuredEvidence?: StructuredEngineeringEvidence[];
  actionRequestId?: string;
  policyDecisionId?: string;
  approvalRecordId?: string;
}

/**
 * Factory function to create a typed Execution record.
 */
export function createExecution(params: CreateExecutionParams): Execution {
  const now = Date.now();
  const id =
    params.id ?? `exec-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const cleanCmd = params.command
    ? normalizeCommand(params.command)
    : undefined;

  const lifecycle = params.lifecycle ?? (params.state === 'running' || !params.completedAt ? 'running' : 'finished');
  const outcome = params.outcome ?? (params.exitCode !== null && params.exitCode !== undefined ? (params.exitCode === 0 ? 'succeeded' : 'failed') : 'unknown');

  return {
    id,
    workspaceId: params.workspaceId,
    terminalTabId: params.terminalTabId,
    terminalPaneId: params.terminalPaneId,
    actorId: params.actorId ?? DEFAULT_LOCAL_HUMAN_ACTOR.id,
    source: params.source ?? 'terminal',
    command: cleanCmd,
    rawCommand: params.rawCommand ?? params.command,
    intent: params.intent ?? 'interactive',
    verificationRunId: params.verificationRunId,
    verificationCriterionId: params.verificationCriterionId,
    lifecycle,
    outcome,
    state: params.state ?? lifecycle,
    completionSource: params.completionSource,
    outcomeSource: params.outcomeSource,
    outcomeTrusted: params.outcomeTrusted,
    exitCode: params.exitCode ?? null,
    hasDiagnosticError: params.hasDiagnosticError ?? false,
    startedAt: params.startedAt ?? now,
    completedAt: params.completedAt ?? null,
    evidenceBlockIds: params.evidenceBlockIds ?? [],
    evidenceBlocks: params.evidenceBlocks,
    structuredEvidence: params.structuredEvidence,
    actionRequestId: params.actionRequestId,
    policyDecisionId: params.policyDecisionId,
    approvalRecordId: params.approvalRecordId,
  };
}

export interface CreateEvidenceBlockParams {
  id?: string;
  executionId: string;
  type: EvidenceBlockType;
  rawText: string;
  displayText?: string;
  createdAt?: number;
  updatedAt?: number;
  cleanupApplied?: boolean;
  exitCode?: number | null;
}

/**
 * Factory function to create an immutable EvidenceBlock.
 * Preserves rawText as the authoritative source evidence.
 */
export function createEvidenceBlock(
  params: CreateEvidenceBlockParams,
): EvidenceBlock {
  const now = Date.now();
  return {
    id:
      params.id ??
      `${params.executionId}-${params.type}-${Math.random().toString(36).slice(2, 6)}`,
    executionId: params.executionId,
    type: params.type,
    rawText: params.rawText,
    displayText: params.displayText ?? params.rawText,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt,
    cleanupApplied: params.cleanupApplied ?? false,
    exitCode: params.exitCode ?? null,
  };
}

/**
 * Converts a TranscriptBlock to a first-class Execution record with constituent EvidenceBlocks.
 */
export function executionFromTranscriptBlock(
  block: TranscriptBlock,
  actor: Actor = DEFAULT_LOCAL_HUMAN_ACTOR,
): Execution {
  const lifecycle = deriveExecutionLifecycle(block);
  const outcome = deriveExecutionOutcome(block);
  const state = deriveExecutionState(block);
  const evidenceBlocks = evidenceBlocksFromTranscriptBlock(block);
  const evidenceBlockIds = evidenceBlocks.map((b) => b.id);
  const diagErr = block.hasDiagnosticError ?? (block.output ? detectErrorFromOutput(block.output).isError : false);

  return {
    id: block.id,
    workspaceId: block.workspaceId ?? 'workspace-default',
    terminalTabId: block.terminalTabId,
    terminalPaneId: block.terminalPaneId,
    actorId: actor.id,
    source: 'terminal',
    command: block.command,
    rawCommand: block.rawCommand ?? block.command,
    intent: block.intent ?? 'interactive',
    verificationRunId: block.verificationRunId,
    verificationCriterionId: block.verificationCriterionId,
    lifecycle,
    outcome,
    state,
    completionSource: block.completionSource ?? 'unknown',
    outcomeSource:
      block.outcomeSource ?? (block.outcomeTrusted ? 'trusted-shell' : 'unknown'),
    outcomeTrusted:
      block.outcomeTrusted ?? (block.outcomeSource === 'trusted-shell'),
    exitCode: block.exitCode ?? null,
    hasDiagnosticError: diagErr,
    startedAt: block.startedAt,
    completedAt: block.completedAt ?? null,
    evidenceBlockIds,
    evidenceBlocks,
    structuredEvidence: block.structuredEvidence,
    attributionId: block.attributionId,
    agentRunId: block.agentRunId,
    agentExecutionLinkSource: block.agentExecutionLinkSource,
    cwd: block.cwd,
  };
}

/**
 * Decomposes a TranscriptBlock into an array of typed EvidenceBlocks.
 *
 * CRITICAL RULE:
 * rawText is immutable source evidence.
 * displayText is the derived presentation layer.
 */
export function evidenceBlocksFromTranscriptBlock(
  block: TranscriptBlock,
  showRaw: boolean = false,
): EvidenceBlock[] {
  const lifecycle = deriveExecutionLifecycle(block);
  const outcome = deriveExecutionOutcome(block);
  const items: EvidenceBlock[] = [];

  // 1. Command EvidenceBlock
  const rawCmd = block.rawCommand ?? block.command;
  const cleanCmd = normalizeCommand(block.command);
  items.push({
    id: `${block.id}-cmd`,
    executionId: block.id,
    type: 'command',
    rawText: rawCmd,
    displayText: cleanCmd,
    createdAt: block.startedAt,
    cleanupApplied: Boolean(block.rawCommand && block.rawCommand !== block.command),
  });

  // 2. Output / Error EvidenceBlock (if output exists)
  const rawOutputText = block.rawOutput ?? block.output;

  if (rawOutputText && rawOutputText.length > 0) {
    const errorCheck = detectErrorFromOutput(rawOutputText);
    const isErr = outcome === 'failed' || errorCheck.isError || block.hasDiagnosticError || block.hasError;
    const cleanedOutput = cleanTranscriptForDisplay(block.output);
    const displayOutput = showRaw
      ? normalizeOutput(block.output)
      : cleanedOutput.cleanedText;

    const isCleaned =
      cleanedOutput.rawText !== cleanedOutput.cleanedText ||
      cleanedOutput.hasHiddenPrompts ||
      cleanedOutput.hasCollapsedBlankLines;

    items.push({
      id: `${block.id}-${isErr ? 'err' : 'out'}`,
      executionId: block.id,
      type: isErr ? 'error' : 'output',
      rawText: rawOutputText,
      displayText: displayOutput,
      createdAt: block.completedAt ?? block.startedAt,
      exitCode: block.exitCode ?? null,
      cleanupApplied: isCleaned,
    });
  }

  // 3. Status EvidenceBlock
  let statusSummary: string;
  if (lifecycle === 'running') {
    statusSummary = 'Running';
  } else if (lifecycle === 'interrupted') {
    statusSummary = 'Interrupted';
  } else {
    // finished
    if (outcome === 'succeeded') {
      statusSummary = 'Succeeded';
    } else if (outcome === 'failed') {
      statusSummary = 'Failed';
    } else {
      statusSummary = 'Finished';
    }
  }

  const duration = formatExecutionDuration(block.startedAt, block.completedAt);
  if (duration) {
    statusSummary += ` • ${duration}`;
  }
  if (block.exitCode !== null && block.exitCode !== undefined) {
    statusSummary += ` (exit ${block.exitCode})`;
  }

  items.push({
    id: `${block.id}-status`,
    executionId: block.id,
    type: 'status',
    rawText: statusSummary,
    displayText: statusSummary,
    createdAt: block.completedAt ?? block.startedAt,
    cleanupApplied: false,
    exitCode: block.exitCode ?? null,
  });

  return items;
}
