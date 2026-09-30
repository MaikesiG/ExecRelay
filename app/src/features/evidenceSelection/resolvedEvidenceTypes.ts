/**
 * TraceRelay / CapTerm Resolved Evidence Types (HARDEN-014)
 *
 * Intermediate export and presentation model for selected evidence.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. ResolvedEvidenceItem is export/presentation data, NOT new canonical truth.
 * 2. Never mutates or replaces canonical Execution, EvidenceBlock, VerificationRun,
 *    RepositorySnapshot, AgentRun, PolicyDecision, or UsageEvent records.
 * 3. Bounded reads: all raw strings/diffs adhere to MAX_ITEM_CHARS and MAX_TOTAL_COPY_CHARS.
 * 4. Honest representation: unresolvable or missing items are explicitly reported as unavailable.
 * 5. Secret safety: cryptographic nonces, tokens, and credentials are never exported.
 */

import type { StructuredEngineeringEvidence } from '../structuredEvidence/types';
import type { TranscriptBlock } from '../transcript/types';
import type { RepositorySnapshot } from '../evidenceCollectors/types';
import type { VerificationContract, VerificationRun } from '../verification/types';
export interface AgentRun {
  id: string;
  agentId?: string;
  displayName?: string;
  providerName?: string;
  taskText?: string;
  status?: string;
  lifecycle?: string;
  outcome?: string;
  workspaceId?: string;
  startedAt?: number;
  completedAt?: number | null;
  executionIds?: string[];
  verificationRunIds?: string[];
  [key: string]: unknown;
}
export interface AgentEvent {
  id: string;
  agentRunId: string;
  type: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
  [key: string]: unknown;
}
import type { ChangeAttribution } from '../attribution/types';

export interface ResolvedExecutionEvidence {
  kind: 'execution';
  id: string; // executionId
  command: string;
  actorId?: string;
  actorType?: 'human' | 'agent' | 'system';
  cwd?: string;
  intent?: string;
  lifecycle: string;
  outcome: string;
  exitCode?: number | null;
  completionSource?: string;
  outcomeSource?: string;
  outcomeTrusted?: boolean;
  startedAt?: number;
  completedAt?: number | null;
  duration?: string | null;
  output?: string;
  rawOutput?: string;
  errorOutput?: string;
  hasDiagnosticError?: boolean;
  structuredEvidence?: StructuredEngineeringEvidence[];
  structuredSummary?: string;
  agentRunId?: string;
  verificationRunId?: string;
  attributionId?: string;
  truncated?: boolean;
  selectedAt?: number;
}

export interface ResolvedRepositoryChangeEvidence {
  kind: 'repository-change';
  id: string; // selection composite key
  path: string;
  previousPath?: string;
  status: string; // 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | etc.
  insertions?: number;
  deletions?: number;
  binary?: boolean;
  lineStatsSource?: string;
  evidenceSource?: string;
  patch?: string;
  content?: string;
  language?: string;
  truncated?: boolean;
  unavailableReason?: string;
  attribution?: {
    targetId: string;
    summary?: string;
  };
  dirtyBaseline?: boolean;
  selectedAt?: number;
}

export interface ResolvedVerificationEvidence {
  kind: 'verification';
  id: string; // selection composite key
  runId: string;
  criterionId: string;
  profileName?: string;
  label: string;
  command: string;
  expectedExitCodes?: number[];
  status: string; // 'passed' | 'failed' | 'error' | 'cancelled' | 'stop-timeout' | 'stopping' | 'running' | 'skipped'
  observedExitCode?: number | null;
  message?: string;
  executionId?: string;
  linkedExecution?: ResolvedExecutionEvidence;
  linkedExecutionIncludedSeparately?: boolean;
  structuredEvidence?: StructuredEngineeringEvidence[];
  selectedAt?: number;
}

export interface ResolvedAgentEventEvidence {
  kind: 'agent-event';
  id: string; // selection composite key
  agentRunId: string;
  eventId: string;
  eventType: string;
  provider?: string;
  category?: string;
  toolName?: string;
  filePath?: string;
  command?: string;
  summary: string;
  detail?: string;
  input?: string;
  result?: string;
  success?: boolean;
  error?: string;
  timestamp?: number;
  linkedExecutionId?: string;
  linkedExecution?: ResolvedExecutionEvidence;
  policyDecision?: string;
  selectedAt?: number;
}

export interface ResolvedPolicyEvidence {
  kind: 'policy';
  id: string; // selection composite key
  subkind: 'decision' | 'approval' | 'audit';
  actionRequestId?: string;
  effect?: 'allow' | 'require-approval' | 'deny';
  status?: string;
  governanceCoverage?: string;
  command?: string;
  filePath?: string;
  toolName?: string;
  reason?: string;
  requesterType?: string;
  agentRunId?: string;
  shellType?: string;
  warningCodes?: string[];
  resolvedByActorId?: string;
  comment?: string;
  decision?: string;
  approvalStatus?: string;
  timestamp?: number;
  requestFingerprint?: string;
  selectedAt?: number;
}

export interface ResolvedStructuredEvidence {
  kind: 'structured-evidence';
  id: string;
  evidenceId: string;
  executionId: string;
  tool: string;
  status: 'passed' | 'failed';
  summary: string;
  details?: string;
  linkedExecution?: ResolvedExecutionEvidence;
  selectedAt?: number;
}

export interface ResolvedUsageEvidence {
  kind: 'usage';
  id: string;
  agentRunId: string;
  provider: string;
  model?: string;
  totalTokens: number | 'unknown';
  inputTokens?: number | 'unknown';
  outputTokens?: number | 'unknown';
  calculatedCost?: number;
  costStatus: string;
  authoritative?: boolean;
  selectedAt?: number;
}

export interface ResolvedAttributionEvidence {
  kind: 'repository-attribution';
  id: string;
  attributionId: string;
  targetId: string;
  filesChangedCount: number;
  totalInsertions: number;
  totalDeletions: number;
  summary: string;
  selectedAt?: number;
}

export interface ResolvedUnavailableEvidence {
  kind: 'unavailable';
  id: string;
  originalKind: string;
  referenceId: string;
  reason: string;
  selectedAt?: number;
}

export type ResolvedEvidenceItem =
  | ResolvedExecutionEvidence
  | ResolvedRepositoryChangeEvidence
  | ResolvedVerificationEvidence
  | ResolvedAgentEventEvidence
  | ResolvedPolicyEvidence
  | ResolvedStructuredEvidence
  | ResolvedUsageEvidence
  | ResolvedAttributionEvidence
  | ResolvedUnavailableEvidence;

export interface EvidenceResolutionContext {
  workspaceId?: string;
  blocks?: TranscriptBlock[];
  repositorySnapshot?: RepositorySnapshot | null;
  runCommand?: (input: {
    program: string;
    args: string[];
    cwd?: string;
    timeoutMs?: number;
  }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  fsModule?: unknown;
  verificationContract?: VerificationContract;
  verificationContracts?: VerificationContract[];
  activeVerificationRun?: VerificationRun | null;
  latestVerificationRun?: VerificationRun | null;
  historicalVerificationRuns?: VerificationRun[];
  changeAttributions?: ChangeAttribution[];
  agentRuns?: AgentRun[];
  activeAgentRun?: AgentRun | null;
  agentEventIngress?: {
    getEventsForRun: (runId: string) => AgentEvent[];
  };
  maxPerItemChars?: number;
  maxAggregateChars?: number;
}
