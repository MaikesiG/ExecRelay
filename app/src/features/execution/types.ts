/**
 * TraceRelay / CapTerm Execution Evidence Foundation
 *
 * Core domain types for Actors, Executions, and EvidenceBlocks.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. xterm.js is a terminal renderer, NOT the authoritative source of truth for execution evidence.
 * 2. Raw terminal evidence is the immutable source of truth; cleaned/normalized output is a presentation layer.
 * 3. Execution lifecycle and execution outcome are semantically separate.
 * 4. Output heuristics may classify diagnostic evidence, but must not fabricate authoritative execution success or failure.
 * 5. Completion provenance records why an execution was considered finished or interrupted.
 */

/* ========================================================================== */
/* Actor Domain Model                                                         */
/* ========================================================================== */

export type ActorType = 'human' | 'agent' | 'system';

export interface Actor {
  id: string;
  type: ActorType;
  name?: string;
}

export const DEFAULT_LOCAL_HUMAN_ACTOR: Actor = {
  id: 'actor-human-local',
  type: 'human',
  name: 'Local User',
};

/* ========================================================================== */
/* EvidenceBlock Domain Model                                                 */
/* ========================================================================== */

export type EvidenceBlockType = 'command' | 'output' | 'error' | 'status';

export interface EvidenceBlock {
  id: string;
  executionId: string;
  type: EvidenceBlockType;
  /**
   * Immutable raw source evidence (with ANSI escape sequences and exact PTY bytes).
   */
  rawText: string;
  /**
   * Derived presentation layer (sanitized, prompt stripped, ANSI removed).
   */
  displayText: string;
  createdAt: number;
  updatedAt?: number;
  cleanupApplied?: boolean;
  exitCode?: number | null;
}

/* ========================================================================== */
/* Execution Domain Model                                                     */
/* ========================================================================== */

/**
 * Execution Lifecycle represents whether the execution is currently in-flight,
 * has ended, or was aborted before normal completion.
 */
export type ExecutionLifecycle =
  | 'pending'
  | 'running'
  | 'finished'
  | 'interrupted';

/**
 * Execution Outcome represents the authoritative verdict of the execution.
 * MUST be 'unknown' unless backed by reliable process/shell exit codes
 * or trusted agent/tool metadata. Never fabricated from text heuristics.
 */
export type ExecutionOutcome = 'unknown' | 'succeeded' | 'failed';

/**
 * Execution Completion Source records WHY an execution was considered finished or interrupted.
 */
export type ExecutionCompletionSource =
  | 'shell'
  | 'capture-boundary'
  | 'capture-stop'
  | 'pane-close'
  | 'user-interrupt'
  | 'unknown';

/**
 * Source explaining why the execution outcome verdict is considered authoritative.
 * - 'trusted-shell': Authenticated shell integration carrying valid session nonce
 * - 'structured-agent': Validated structured agent/tool execution contract
 * - 'unknown': Unverified fallback boundary or untrusted/unauthenticated source
 */
export type ExecutionOutcomeSource =
  | 'trusted-shell'
  | 'trusted-process'
  | 'structured-agent'
  | 'unknown';

/**
 * Trust classification for incoming shell integration events.
 */
export type ShellIntegrationEventTrust = 'trusted' | 'untrusted';

/**
 * Level of shell integration active for the terminal session.
 * - 'none': No semantic shell metadata received.
 * - 'basic': Generic/untrusted shell metadata available (e.g. unauthenticated or remote).
 * - 'rich': CapTerm-authenticated shell lifecycle metadata available with valid session nonce.
 */
export type ShellIntegrationLevel = 'none' | 'basic' | 'rich';

export type ExecutionSource = 'terminal' | 'agent' | 'system';

/**
 * Semantic intent explaining why the command was executed.
 * - 'interactive': Command run directly by user or interactive input.
 * - 'verification': Command run as part of a verification criterion.
 * - 'evidence-collection': Command run internally by an evidence collector.
 * - 'agent': Command run on behalf of or initiated by an external coding agent.
 */
export type ExecutionIntent =
  | 'interactive'
  | 'verification'
  | 'evidence-collection'
  | 'agent';

/**
 * Legacy/compatibility alias combining lifecycle and outcome.
 */
export type ExecutionState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'finished';

export interface Execution {
  id: string;
  workspaceId: string;
  terminalTabId?: string;
  terminalPaneId?: string;
  actorId: string;
  source: ExecutionSource;
  command?: string;
  rawCommand?: string;

  /**
   * Semantic intent for the execution.
   */
  intent?: ExecutionIntent;

  /**
   * Associated Verification Run ID if initiated by verification.
   */
  verificationRunId?: string;

  /**
   * Associated Verification Criterion ID if initiated by verification.
   */
  verificationCriterionId?: string;

  /**
   * Authoritative lifecycle state.
   */
  lifecycle: ExecutionLifecycle;

  /**
   * Authoritative execution outcome verdict.
   */
  outcome: ExecutionOutcome;

  /**
   * Legacy execution state field (aliased to lifecycle or legacy state).
   */
  state: ExecutionState;

  /**
   * Provenance recording why the execution transitioned to finished/interrupted.
   */
  completionSource?: ExecutionCompletionSource;

  /**
   * Source providing authoritative outcome verification.
   */
  outcomeSource?: ExecutionOutcomeSource;

  /**
   * Whether the outcome was verified by a trusted source (e.g. authenticated shell).
   */
  outcomeTrusted?: boolean;

  /**
   * Reliable process exit code.
   * MUST be null/undefined when exit code is unknown or not reported by OS/shell.
   * NEVER fabricate exit codes.
   */
  exitCode?: number | null;

  /**
   * Whether diagnostic/error text was detected in the output (heuristic hint).
   * Note: This does NOT authoritatively change outcome to 'failed'.
   */
  hasDiagnosticError?: boolean;

  startedAt: number;
  completedAt?: number | null;
  evidenceBlockIds: string[];
  evidenceBlocks?: EvidenceBlock[];

  /**
   * Associated Change Attribution ID if change tracking was enabled for this execution.
   */
  attributionId?: string;

  /**
   * Associated AgentRun ID if initiated by or linked to a coding agent.
   */
  agentRunId?: string;

  /**
   * Resolved working directory where this execution took place.
   */
  cwd?: string;

  /**
   * Association provenance explaining how this execution was linked to the agent run.
   */
  agentExecutionLinkSource?: string;

  /**
   * Derived structured engineering evidence (test summaries, diagnostics, build summaries).
   * Note: Derived from evidenceBlocks; never overrides outcome or exitCode.
   */
  structuredEvidence?: import('../structuredEvidence/types').StructuredEngineeringEvidence[];

  /**
   * Associated ActionRequest ID if this execution was governed by policy.
   */
  actionRequestId?: string;

  /**
   * Associated PolicyDecision ID if evaluated under policy governance.
   */
  policyDecisionId?: string;

  /**
   * Associated ApprovalRecord ID if authorization required approval.
   */
  approvalRecordId?: string;
}

/* ========================================================================== */
/* Type Guards                                                                */
/* ========================================================================== */

export function isActorType(value: unknown): value is ActorType {
  return value === 'human' || value === 'agent' || value === 'system';
}

export function isActor(value: unknown): value is Actor {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return typeof a.id === 'string' && isActorType(a.type);
}

export function isExecutionLifecycle(value: unknown): value is ExecutionLifecycle {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'finished' ||
    value === 'interrupted'
  );
}

export function isExecutionOutcome(value: unknown): value is ExecutionOutcome {
  return value === 'unknown' || value === 'succeeded' || value === 'failed';
}

export function isExecutionOutcomeSource(
  value: unknown,
): value is ExecutionOutcomeSource {
  return (
    value === 'trusted-shell' ||
    value === 'trusted-process' ||
    value === 'structured-agent' ||
    value === 'unknown'
  );
}

export function isShellIntegrationEventTrust(
  value: unknown,
): value is ShellIntegrationEventTrust {
  return value === 'trusted' || value === 'untrusted';
}

export function isExecutionCompletionSource(
  value: unknown,
): value is ExecutionCompletionSource {
  return (
    value === 'shell' ||
    value === 'capture-boundary' ||
    value === 'capture-stop' ||
    value === 'pane-close' ||
    value === 'user-interrupt' ||
    value === 'unknown'
  );
}

export function isShellIntegrationLevel(
  value: unknown,
): value is ShellIntegrationLevel {
  return value === 'none' || value === 'basic' || value === 'rich';
}

export function isExecutionState(value: unknown): value is ExecutionState {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'interrupted' ||
    value === 'finished'
  );
}

export function isExecutionSource(value: unknown): value is ExecutionSource {
  return value === 'terminal' || value === 'agent' || value === 'system';
}

export function isExecutionIntent(value: unknown): value is ExecutionIntent {
  return (
    value === 'interactive' ||
    value === 'verification' ||
    value === 'evidence-collection' ||
    value === 'agent'
  );
}

export function isEvidenceBlockType(value: unknown): value is EvidenceBlockType {
  return (
    value === 'command' ||
    value === 'output' ||
    value === 'error' ||
    value === 'status'
  );
}

export function isEvidenceBlock(value: unknown): value is EvidenceBlock {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.executionId === 'string' &&
    isEvidenceBlockType(b.type) &&
    typeof b.rawText === 'string' &&
    typeof b.displayText === 'string' &&
    typeof b.createdAt === 'number'
  );
}

export function isExecution(value: unknown): value is Execution {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.workspaceId === 'string' &&
    typeof e.actorId === 'string' &&
    isExecutionSource(e.source) &&
    (isExecutionLifecycle(e.lifecycle) || isExecutionState(e.state)) &&
    typeof e.startedAt === 'number' &&
    Array.isArray(e.evidenceBlockIds)
  );
}
