import type { PaneAccentId } from '../workspace/types';
import type {
  Actor,
  ActorType,
  EvidenceBlock,
  EvidenceBlockType,
  Execution,
  ExecutionCompletionSource,
  ExecutionIntent,
  ExecutionLifecycle,
  ExecutionOutcome,
  ExecutionOutcomeSource,
  ExecutionSource,
  ExecutionState,
  ShellIntegrationEventTrust,
  ShellIntegrationLevel,
} from '../execution/types';

export type {
  Actor,
  ActorType,
  EvidenceBlock,
  EvidenceBlockType,
  Execution,
  ExecutionCompletionSource,
  ExecutionIntent,
  ExecutionLifecycle,
  ExecutionOutcome,
  ExecutionOutcomeSource,
  ExecutionSource,
  ExecutionState,
  ShellIntegrationEventTrust,
  ShellIntegrationLevel,
};

export {
  DEFAULT_LOCAL_HUMAN_ACTOR,
  isActor,
  isActorType,
  isEvidenceBlock,
  isEvidenceBlockType,
  isExecution,
  isExecutionCompletionSource,
  isExecutionIntent,
  isExecutionLifecycle,
  isExecutionOutcome,
  isExecutionOutcomeSource,
  isExecutionSource,
  isExecutionState,
  isShellIntegrationEventTrust,
  isShellIntegrationLevel,
} from '../execution/types';

/**
 * Structured Capture Block Type Model (alias to EvidenceBlockType)
 */
export type CaptureBlockType = EvidenceBlockType;

/**
 * Capture Execution Lifecycle State (alias to ExecutionState)
 */
export type CaptureExecutionState = ExecutionState;

/**
 * Discrete structured block representing a single semantic slice of captured activity.
 * Aliased / compatible with EvidenceBlock.
 */
export interface StructuredCaptureBlock {
  id: string;
  type: CaptureBlockType;
  rawText: string;
  displayText: string;
  createdAt: number;
  updatedAt?: number;

  commandId?: string;
  executionState?: CaptureExecutionState;
  exitCode?: number | null;

  isRawAvailable?: boolean;
  cleanupApplied?: boolean;
}

/**
 * Capture Block container representing a command execution unit with its outputs and metadata.
 * Serves as the primary bridge between legacy TranscriptBlock state and the new Execution domain model.
 */
export type TranscriptBlock = {
  id: string;
  batchId: number;
  command: string;
  output: string;
  startedAt: number;
  completedAt: number | null;
  isComplete: boolean;

  // Execution Domain Model linkage
  type?: CaptureBlockType;
  executionId?: string;
  actorId?: string;
  executionSource?: ExecutionSource;
  intent?: ExecutionIntent;
  verificationRunId?: string;
  verificationCriterionId?: string;
  executionState?: CaptureExecutionState;
  lifecycle?: ExecutionLifecycle;
  outcome?: ExecutionOutcome;
  completionSource?: ExecutionCompletionSource;
  outcomeSource?: ExecutionOutcomeSource;
  outcomeTrusted?: boolean;
  shellIntegrationLevel?: ShellIntegrationLevel;
  exitCode?: number | null;
  hasError?: boolean;
  hasDiagnosticError?: boolean;
  rawCommand?: string;
  rawOutput?: string;
  errorOutput?: string;
  evidenceBlockIds?: string[];
  evidenceBlocks?: EvidenceBlock[];
  structuredBlocks?: StructuredCaptureBlock[];
  structuredEvidence?: import('../structuredEvidence/types').StructuredEngineeringEvidence[];
  attributionId?: string;
  agentRunId?: string;
  agentExecutionLinkSource?: string;
  actionRequestId?: string;
  policyDecisionId?: string;
  approvalRecordId?: string;
  cwd?: string;

  workspaceId?: string;
  terminalTabId?: string;
  terminalPaneId: string;
  terminalLabelAtCapture: string;

  sourcePaneId?: string;
  sourcePaneOrdinal?: number;
  sourcePaneAccentId?: PaneAccentId;

  captureSessionId?: string;
  captureGroupId?: string;
};

export type CaptureBlock = TranscriptBlock;

export function isCaptureBlockType(value: unknown): value is CaptureBlockType {
  return (
    value === 'command' ||
    value === 'output' ||
    value === 'error' ||
    value === 'status'
  );
}

export function isCaptureExecutionState(
  value: unknown,
): value is CaptureExecutionState {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'interrupted'
  );
}

export function isStructuredCaptureBlock(
  value: unknown,
): value is StructuredCaptureBlock {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    isCaptureBlockType(b.type) &&
    typeof b.rawText === 'string' &&
    typeof b.displayText === 'string' &&
    typeof b.createdAt === 'number'
  );
}

export type CaptureBatch = {
  id: number;
  startedAt: number;
  stoppedAt: number | null;
};

export interface TranscriptFeedback {
  message: string;
  type: 'success' | 'error';
}

export type CaptureStatus = 'ready' | 'capturing' | 'paused' | 'error';

export interface CaptureStateLike {
  isListening: boolean;
  blockCount?: number;
  hasRetainedData?: boolean;
  blocks?: ReadonlyArray<unknown>;
  currentBatchId?: number | null;
}

export function deriveHasRetainedData(
  blocks?: ReadonlyArray<unknown> | number,
  currentBatchId?: number | null,
  hasRetainedDataFallback?: boolean,
): boolean {
  if (currentBatchId != null) return true;
  if (typeof blocks === 'number') return blocks > 0;
  if (Array.isArray(blocks)) return blocks.length > 0;
  return Boolean(hasRetainedDataFallback);
}

export function getCaptureStatus(
  isListening: boolean,
  hasRetainedData: boolean | number | ReadonlyArray<unknown>,
): CaptureStatus;
export function getCaptureStatus(
  capture: CaptureStateLike,
): CaptureStatus;
export function getCaptureStatus(
  captureOrIsListening: CaptureStateLike | boolean,
  hasRetainedDataOrCount?: boolean | number | ReadonlyArray<unknown>,
): CaptureStatus {
  if (typeof captureOrIsListening === 'object' && captureOrIsListening !== null) {
    if (captureOrIsListening.isListening) {
      return 'capturing';
    }
    const hasRetained = deriveHasRetainedData(
      captureOrIsListening.blocks ?? captureOrIsListening.blockCount,
      captureOrIsListening.currentBatchId,
      captureOrIsListening.hasRetainedData,
    );
    return hasRetained ? 'paused' : 'ready';
  }

  if (captureOrIsListening) {
    return 'capturing';
  }

  if (Array.isArray(hasRetainedDataOrCount)) {
    return hasRetainedDataOrCount.length > 0 ? 'paused' : 'ready';
  }

  if (typeof hasRetainedDataOrCount === 'number') {
    return hasRetainedDataOrCount > 0 ? 'paused' : 'ready';
  }

  return hasRetainedDataOrCount ? 'paused' : 'ready';
}
