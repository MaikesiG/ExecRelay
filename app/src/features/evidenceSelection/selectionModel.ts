/**
 * Pure functions for Evidence Selection operations.
 */

import type {
  EvidenceKind,
  EvidenceSelectionItem,
  EvidenceSelectionState,
  RepositoryFileSelectionItem,
  ExecutionSelectionItem,
  AgentEventSelectionItem,
  PolicyAuditSelectionItem,
  VerificationResultSelectionItem,
} from './types';
import type { AgentEvent } from './resolvedEvidenceTypes';

/**
 * Creates an empty EvidenceSelectionState.
 */
export function createEvidenceSelectionState(): EvidenceSelectionState {
  return {
    items: new Map(),
    updatedAt: Date.now(),
  };
}

/**
 * Checks whether an item ID is selected.
 */
export function isItemSelected(
  state: EvidenceSelectionState,
  id: string,
): boolean {
  return state.items.has(id);
}

/**
 * Retrieves a selected item by ID.
 */
export function getSelectedItem(
  state: EvidenceSelectionState,
  id: string,
): EvidenceSelectionItem | undefined {
  return state.items.get(id);
}

/**
 * Toggles selection of an item.
 */
export function toggleItemSelection(
  state: EvidenceSelectionState,
  item: EvidenceSelectionItem,
): EvidenceSelectionState {
  const nextMap = new Map(state.items);
  if (nextMap.has(item.id)) {
    nextMap.delete(item.id);
  } else {
    nextMap.set(item.id, { ...item, selectedAt: Date.now() });
  }
  return {
    items: nextMap,
    updatedAt: Date.now(),
  };
}

/**
 * Sets explicit selection status of an item.
 */
export function setItemSelection(
  state: EvidenceSelectionState,
  item: EvidenceSelectionItem,
  selected: boolean,
): EvidenceSelectionState {
  const isCurrentlySelected = state.items.has(item.id);
  if (selected === isCurrentlySelected) {
    return state;
  }
  const nextMap = new Map(state.items);
  if (selected) {
    nextMap.set(item.id, { ...item, selectedAt: Date.now() });
  } else {
    nextMap.delete(item.id);
  }
  return {
    items: nextMap,
    updatedAt: Date.now(),
  };
}

/**
 * Selects multiple items at once.
 */
export function selectMultipleItems(
  state: EvidenceSelectionState,
  items: EvidenceSelectionItem[],
): EvidenceSelectionState {
  if (items.length === 0) return state;
  const nextMap = new Map(state.items);
  const now = Date.now();
  for (const item of items) {
    nextMap.set(item.id, { ...item, selectedAt: now });
  }
  return {
    items: nextMap,
    updatedAt: now,
  };
}

/**
 * Deselects multiple items by their IDs.
 */
export function deselectMultipleItems(
  state: EvidenceSelectionState,
  ids: string[],
): EvidenceSelectionState {
  if (ids.length === 0) return state;
  const nextMap = new Map(state.items);
  let changed = false;
  for (const id of ids) {
    if (nextMap.delete(id)) {
      changed = true;
    }
  }
  if (!changed) return state;
  return {
    items: nextMap,
    updatedAt: Date.now(),
  };
}

/**
 * Clears all selections.
 */
export function clearEvidenceSelection(
  state: EvidenceSelectionState,
): EvidenceSelectionState {
  if (state.items.size === 0) return state;
  return {
    items: new Map(),
    updatedAt: Date.now(),
  };
}

/**
 * Returns an array of all currently selected items.
 */
export function getSelectedItems(
  state: EvidenceSelectionState,
): EvidenceSelectionItem[] {
  return Array.from(state.items.values());
}

/**
 * Returns the total count of selected items.
 */
export function getSelectedCount(state: EvidenceSelectionState): number {
  return state.items.size;
}

/**
 * Returns count of selected items broken down by kind.
 */
export function getSelectedCountsByKind(
  state: EvidenceSelectionState,
): Record<EvidenceKind, number> {
  const counts: Record<EvidenceKind, number> = {
    'repository-file': 0,
    'execution': 0,
    'structured-evidence': 0,
    'verification-result': 0,
    'repository-attribution': 0,
    'agent-event': 0,
    'usage-summary': 0,
    'policy-decision': 0,
    'approval-record': 0,
    'policy-audit': 0,
  };

  for (const item of state.items.values()) {
    if (counts[item.kind] !== undefined) {
      counts[item.kind] += 1;
    }
  }

  return counts;
}

/**
 * Formats a concise human-readable summary of selected items, e.g.:
 * \"3 repository files, 1 execution\"
 */
export function formatSelectionSummary(state: EvidenceSelectionState): string {
  const counts = getSelectedCountsByKind(state);
  const parts: string[] = [];

  if (counts['repository-file'] > 0) {
    const c = counts['repository-file'];
    parts.push(`${c} repository ${c === 1 ? 'file' : 'files'}`);
  }
  if (counts['execution'] > 0) {
    const c = counts['execution'];
    parts.push(`${c} ${c === 1 ? 'execution' : 'executions'}`);
  }
  if (counts['verification-result'] > 0) {
    const c = counts['verification-result'];
    parts.push(`${c} verification ${c === 1 ? 'result' : 'results'}`);
  }
  if (counts['structured-evidence'] > 0) {
    const c = counts['structured-evidence'];
    parts.push(`${c} structured ${c === 1 ? 'evidence' : 'evidence'}`);
  }
  if (counts['repository-attribution'] > 0) {
    const c = counts['repository-attribution'];
    parts.push(`${c} ${c === 1 ? 'attribution' : 'attributions'}`);
  }
  if (counts['agent-event'] > 0) {
    const c = counts['agent-event'];
    parts.push(`${c} agent ${c === 1 ? 'event' : 'events'}`);
  }
  if (counts['usage-summary'] > 0) {
    const c = counts['usage-summary'];
    parts.push(`${c} usage ${c === 1 ? 'summary' : 'summaries'}`);
  }
  if (counts['policy-decision'] > 0) {
    const c = counts['policy-decision'];
    parts.push(`${c} policy ${c === 1 ? 'decision' : 'decisions'}`);
  }
  if (counts['approval-record'] > 0) {
    const c = counts['approval-record'];
    parts.push(`${c} approval ${c === 1 ? 'record' : 'records'}`);
  }
  if (counts['policy-audit'] > 0) {
    const c = counts['policy-audit'];
    parts.push(`${c} governance audit ${c === 1 ? 'event' : 'events'}`);
  }

  return parts.length > 0 ? parts.join(', ') : '0 items selected';
}

export function createPolicyDecisionSelectionItem(params: {
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
}): import('./types').PolicyDecisionSelectionItem {
  return {
    id: `policy:${params.decisionId}`,
    kind: 'policy-decision',
    decisionId: params.decisionId,
    actionRequestId: params.actionRequestId,
    effect: params.effect,
    command: params.command,
    filePath: params.filePath,
    toolName: params.toolName,
    reason: params.reason,
    requesterType: params.requesterType,
    agentRunId: params.agentRunId,
    governanceCoverage: params.governanceCoverage,
    shellType: params.shellType,
    warningCodes: params.warningCodes,
    selectedAt: Date.now(),
  };
}

export function createApprovalRecordSelectionItem(params: {
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
}): import('./types').ApprovalRecordSelectionItem {
  return {
    id: `approval:${params.approvalId}`,
    kind: 'approval-record',
    approvalId: params.approvalId,
    actionRequestId: params.actionRequestId,
    status: params.status,
    command: params.command,
    filePath: params.filePath,
    toolName: params.toolName,
    reason: params.reason,
    resolvedByActorId: params.resolvedByActorId,
    comment: params.comment,
    agentRunId: params.agentRunId,
    governanceCoverage: params.governanceCoverage,
    shellType: params.shellType,
    warningCodes: params.warningCodes,
    selectedAt: Date.now(),
  };
}

export function createPolicyAuditSelectionItem(params: {
  auditEventId?: string;
  actionRequestId?: string;
  governanceCoverage?: string;
  command?: string;
  filePath?: string;
  shellType?: string;
  decision?: string;
  approvalStatus?: string;
  warningCodes?: string[];
  reason?: string;
  timestamp?: number;
  auditEvent?: {
    id: string;
    actionRequestId?: string;
    governanceCoverage: string;
    command?: string;
    filePath?: string;
    shellType?: string;
    decision?: string;
    approvalStatus?: string;
    warningCodes?: string[];
    reason?: string;
    occurredAt?: number;
    timestamp?: number;
  };
}): PolicyAuditSelectionItem {
  const ev = params.auditEvent;
  const auditEventId = ev ? ev.id : (params.auditEventId || '');
  const governanceCoverage = ev ? ev.governanceCoverage : (params.governanceCoverage || 'observed-only');
  const actionRequestId = ev ? ev.actionRequestId : params.actionRequestId;
  const command = ev ? ev.command : params.command;
  const filePath = ev ? ev.filePath : params.filePath;
  const shellType = ev ? ev.shellType : params.shellType;
  const decision = ev ? ev.decision : params.decision;
  const approvalStatus = ev ? ev.approvalStatus : params.approvalStatus;
  const warningCodes = ev ? ev.warningCodes : params.warningCodes;
  const reason = ev ? ev.reason : params.reason;
  const timestamp = ev ? (ev.timestamp ?? ev.occurredAt ?? Date.now()) : (params.timestamp ?? Date.now());

  return {
    id: `audit:${auditEventId}`,
    kind: 'policy-audit',
    auditEventId,
    actionRequestId,
    governanceCoverage,
    command,
    filePath,
    shellType,
    decision,
    approvalStatus,
    warningCodes,
    reason,
    timestamp,
    selectedAt: Date.now(),
  };
}

export function createUsageSummarySelectionItem(params: {
  agentRunId: string;
  provider: string;
  model?: string;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  calculatedCost?: number;
  costStatus: string;
}): import('./types').UsageSummarySelectionItem {
  return {
    id: `usage:${params.agentRunId}`,
    kind: 'usage-summary',
    agentRunId: params.agentRunId,
    provider: params.provider,
    model: params.model,
    totalTokens: params.totalTokens,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    calculatedCost: params.calculatedCost,
    costStatus: params.costStatus,
    selectedAt: Date.now(),
  };
}

/**
 * Formats a repository file item for compact clipboard copy.
 */
export function formatRepositoryFileText(file: {
  path: string;
  status?: string;
  previousPath?: string;
  insertions?: number;
  deletions?: number;
  binary?: boolean;
}): string {
  let tag = 'M';
  if (file.status === 'modified') tag = 'M';
  else if (file.status === 'added') tag = 'A';
  else if (file.status === 'deleted') tag = 'D';
  else if (file.status === 'renamed') tag = 'R';
  else if (file.status === 'untracked') tag = '??';
  else if (file.status) tag = file.status.toUpperCase();

  let numstat = '';
  if (file.binary) {
    numstat = ' (binary)';
  } else if (file.insertions !== undefined || file.deletions !== undefined) {
    numstat = ` +${file.insertions ?? 0} -${file.deletions ?? 0}`;
  }

  const renamePart = file.previousPath ? ` (from ${file.previousPath})` : '';
  return `${tag} ${file.path}${renamePart}${numstat}`;
}

/**
 * Helper to construct a RepositoryFileSelectionItem with stable, canonical ID.
 */
export function createRepositoryFileSelectionItem(params: {
  path: string;
  snapshotId?: string;
  status?: string;
  previousPath?: string;
  insertions?: number;
  deletions?: number;
  binary?: boolean;
  lineStatsSource?: string;
  repositoryRoot?: string;
}): RepositoryFileSelectionItem {
  const snap = params.snapshotId ?? (params.repositoryRoot ? params.repositoryRoot.replace(/[/\\:]/g, '_') : 'snap');
  const renameSuffix = params.previousPath ? `:${params.previousPath}` : '';
  const id = `repo-file:${snap}:${params.path}${renameSuffix}`;

  return {
    id,
    kind: 'repository-file',
    path: params.path,
    snapshotId: params.snapshotId,
    status: params.status,
    previousPath: params.previousPath,
    insertions: params.insertions,
    deletions: params.deletions,
    binary: params.binary,
    lineStatsSource: params.lineStatsSource,
    repositoryRoot: params.repositoryRoot,
    selectedAt: Date.now(),
  };
}

/**
 * Helper to construct an ExecutionSelectionItem.
 */
export function createExecutionSelectionItem(params: {
  id: string;
  command: string;
  exitCode?: number | null;
  outcome?: string;
  completedAt?: number;
  cwd?: string;
  output?: string;
  structuredSummary?: string;
}): ExecutionSelectionItem {
  let outputSnippet: string | undefined;
  if (params.output) {
    const lines = params.output.split('\n');
    outputSnippet =
      lines.length > 15
        ? lines.slice(0, 15).join('\n') + `\n... [${lines.length - 15} more lines]`
        : params.output;
  }

  return {
    id: `exec:${params.id}`,
    kind: 'execution',
    executionId: params.id,
    command: params.command,
    exitCode: params.exitCode,
    outcome: params.outcome,
    completedAt: params.completedAt,
    cwd: params.cwd,
    outputSnippet,
    structuredSummary: params.structuredSummary,
    selectedAt: Date.now(),
  };
}

/**
 * Determines whether an AgentEvent represents useful selectable activity.
 */
export function isSelectableAgentEvent(event: AgentEvent): boolean {
  if (event.type === 'permission' || event.type === 'user-input-request') {
    return true;
  }
  if (event.type === 'tool-result') {
    const payload = event.payload as Record<string, unknown> | undefined;
    return Boolean(payload && payload.success === false);
  }
  if (event.type === 'tool-call') {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) return false;
    const cat = payload.category;
    return (
      cat === 'file-edit' ||
      cat === 'file-write' ||
      cat === 'shell'
    );
  }
  return false;
}

/**
 * Formats a clean human-readable summary of a selectable AgentEvent for prompt context.
 */
export function formatAgentEventSummary(event: AgentEvent): string {
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload) return `[${event.type}]`;

  const agentLabel =
    event.source === 'codex-app-server' || event.source === 'codex'
      ? 'Codex'
      : 'Claude Code';

  if (event.type === 'tool-call') {
    if (payload.category === 'file-edit' && typeof payload.filePath === 'string') {
      return `${agentLabel} edited \`${payload.filePath}\``;
    }
    if (payload.category === 'file-write' && typeof payload.filePath === 'string') {
      return `${agentLabel} wrote \`${payload.filePath}\``;
    }
    if (payload.category === 'shell' && typeof payload.command === 'string') {
      return `${agentLabel} ran \`${payload.command}\``;
    }
    return `${agentLabel} called tool \`${(payload.toolName as string) ?? 'unknown'}\``;
  }

  if (event.type === 'tool-result') {
    if (payload.success === false) {
      const errStr = typeof payload.error === 'string' ? ` (${payload.error.slice(0, 100)})` : '';
      return `Tool result: failed${errStr}`;
    }
    return `Tool result: succeeded`;
  }

  if (event.type === 'permission') {
    return `${agentLabel} requested approval`;
  }

  if (event.type === 'user-input-request') {
    return `${agentLabel} requested user input: "${typeof payload.prompt === 'string' ? payload.prompt.slice(0, 100) : ''}"`;
  }

  return `[${event.type}]`;
}

/**
 * Helper to construct an AgentEventSelectionItem from a selectable AgentEvent.
 */
export function createAgentEventSelectionItem(event: AgentEvent): AgentEventSelectionItem {
  const payload = event.payload as Record<string, unknown> | undefined;
  return {
    id: `agent-evt:${event.id}`,
    kind: 'agent-event',
    agentRunId: event.agentRunId,
    eventId: event.id,
    eventType: event.type,
    category: typeof payload?.category === 'string' ? payload.category : undefined,
    toolName: typeof payload?.toolName === 'string' ? payload.toolName : undefined,
    filePath: typeof payload?.filePath === 'string' ? payload.filePath : undefined,
    command: typeof payload?.command === 'string' ? payload.command : undefined,
    summary: formatAgentEventSummary(event),
    selectedAt: Date.now(),
  };
}

/**
 * Helper to construct a VerificationResultSelectionItem from a verification criterion result.
 */
export function createVerificationResultSelectionItem(params: {
  runId: string;
  criterionId: string;
  label: string;
  command: string;
  status: string;
  observedExitCode?: number | null;
  message?: string;
}): VerificationResultSelectionItem {
  return {
    id: `verification:${params.runId}:${params.criterionId}`,
    kind: 'verification-result',
    runId: params.runId,
    criterionId: params.criterionId,
    label: params.label,
    command: params.command,
    status: params.status,
    observedExitCode: params.observedExitCode,
    message: params.message,
    selectedAt: Date.now(),
  };
}
