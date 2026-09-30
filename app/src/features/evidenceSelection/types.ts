/**
 * TraceRelay / CapTerm Evidence Selection Model
 *
 * Lightweight, extensible selection model representing selected evidence
 * across different categories:
 * - repository-file
 * - execution
 * - structured-evidence
 * - verification-result
 * - repository-attribution
 * - agent-event
 * - usage-summary
 * - policy-decision
 * - approval-record
 * - policy-audit
 *
 * INVARIANTS:
 * - Pure UI state: selection never mutates canonical Evidence, Execution, or Verification records.
 * - Multi-kind selection support: items of different evidence kinds can be selected simultaneously.
 * - Immutable transitions: all selection state modifications return new state objects.
 */

export type EvidenceKind =
  | 'repository-file'
  | 'execution'
  | 'structured-evidence'
  | 'verification-result'
  | 'repository-attribution'
  | 'agent-event'
  | 'usage-summary'
  | 'policy-decision'
  | 'approval-record'
  | 'policy-audit';

export interface BaseEvidenceSelectionItem {
  /** Unique composite selection key, e.g. "repo-file:src/auth.ts" or "exec:block-123" */
  id: string;
  kind: EvidenceKind;
  selectedAt: number;
}

export interface RepositoryFileSelectionItem extends BaseEvidenceSelectionItem {
  kind: 'repository-file';
  path: string;
  snapshotId?: string;
  status?: string; // 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | etc.
  previousPath?: string;
  insertions?: number;
  deletions?: number;
  binary?: boolean;
  lineStatsSource?: string;
  repositoryRoot?: string;
}

export interface ExecutionSelectionItem extends BaseEvidenceSelectionItem {
  kind: 'execution';
  executionId: string;
  command: string;
  exitCode?: number | null;
  outcome?: string; // 'succeeded' | 'failed' | 'unknown'
  completedAt?: number;
  cwd?: string;
  outputSnippet?: string;
  structuredSummary?: string;
}

export interface StructuredEvidenceSelectionItem extends BaseEvidenceSelectionItem {
  kind: 'structured-evidence';
  evidenceId: string;
  executionId: string;
  tool: string; // 'jest' | 'vitest' | 'pytest' | 'cargo-test' | 'tsc'
  status: 'passed' | 'failed';
  summary: string;
}

export interface VerificationResultSelectionItem extends BaseEvidenceSelectionItem {
  kind: 'verification-result';
  runId: string;
  criterionId: string;
  label: string;
  command: string;
  status: string; // 'passed' | 'failed' | 'error' | 'skipped'
  observedExitCode?: number | null;
  message?: string;
}

export interface RepositoryAttributionSelectionItem extends BaseEvidenceSelectionItem {
  kind: 'repository-attribution';
  attributionId: string;
  targetId: string;
  filesChangedCount: number;
  totalInsertions: number;
  totalDeletions: number;
  summary: string;
}

export interface AgentEventSelectionItem extends BaseEvidenceSelectionItem {
  kind: 'agent-event';
  agentRunId: string;
  eventId: string;
  eventType: string;
  category?: string;
  toolName?: string;
  filePath?: string;
  command?: string;
  summary: string;
  detail?: string;
}

export interface UsageSummarySelectionItem extends BaseEvidenceSelectionItem {
  kind: 'usage-summary';
  agentRunId: string;
  provider: string;
  model?: string;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  calculatedCost?: number;
  costStatus: string;
}

export interface PolicyDecisionSelectionItem extends BaseEvidenceSelectionItem {
  kind: 'policy-decision';
  decisionId: string;
  actionRequestId: string;
  effect: 'allow' | 'require-approval' | 'deny';
  command?: string;
  filePath?: string;
  toolName?: string;
  reason?: string;
  requesterType: string;
  agentRunId?: string;
  governanceCoverage?: string;
  shellType?: string;
  warningCodes?: string[];
}

export interface ApprovalRecordSelectionItem extends BaseEvidenceSelectionItem {
  kind: 'approval-record';
  approvalId: string;
  actionRequestId: string;
  status: 'pending' | 'approved' | 'denied' | 'consumed' | 'cancelled' | 'expired';
  command?: string;
  filePath?: string;
  toolName?: string;
  reason?: string;
  resolvedByActorId?: string;
  comment?: string;
  agentRunId?: string;
  governanceCoverage?: string;
  shellType?: string;
  warningCodes?: string[];
}

export interface PolicyAuditSelectionItem extends BaseEvidenceSelectionItem {
  kind: 'policy-audit';
  auditEventId: string;
  actionRequestId?: string;
  governanceCoverage: string;
  command?: string;
  filePath?: string;
  shellType?: string;
  decision?: string;
  approvalStatus?: string;
  warningCodes?: string[];
  reason?: string;
  timestamp: number;
}

export type EvidenceSelectionItem =
  | RepositoryFileSelectionItem
  | ExecutionSelectionItem
  | StructuredEvidenceSelectionItem
  | VerificationResultSelectionItem
  | RepositoryAttributionSelectionItem
  | AgentEventSelectionItem
  | UsageSummarySelectionItem
  | PolicyDecisionSelectionItem
  | ApprovalRecordSelectionItem
  | PolicyAuditSelectionItem;

export interface EvidenceSelectionState {
  items: Map<string, EvidenceSelectionItem>;
  updatedAt: number;
}
