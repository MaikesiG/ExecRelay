/**
 * TraceRelay / CapTerm Evidence Selection Resolver (HARDEN-014)
 *
 * Resolves lightweight EvidenceSelectionItems against canonical domain state
 * (Executions, RepositorySnapshots, VerificationRuns, AgentRuns, Policy, Usage)
 * into rich, deterministic ResolvedEvidenceItems at action time.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Read-only: Resolving selections NEVER mutates canonical workspace or domain state.
 * 2. Exact provenance: Retains execution identity, shell trust level, exit codes, and diffs.
 * 3. Graceful degradation: Missing or evicted items resolve to explicit unavailable records.
 * 4. Deduplication awareness: Detects if an execution linked by Verification is separately selected.
 * 5. Secret safety: Never extracts or includes cryptographic nonces, tokens, or credentials.
 */

import type {
  EvidenceSelectionItem,
  RepositoryFileSelectionItem,
  ExecutionSelectionItem,
  VerificationResultSelectionItem,
  AgentEventSelectionItem,
  PolicyDecisionSelectionItem,
  ApprovalRecordSelectionItem,
  PolicyAuditSelectionItem,
  StructuredEvidenceSelectionItem,
  UsageSummarySelectionItem,
  RepositoryAttributionSelectionItem,
} from './types';
import type {
  ResolvedEvidenceItem,
  ResolvedExecutionEvidence,
  ResolvedRepositoryChangeEvidence,
  ResolvedVerificationEvidence,
  ResolvedAgentEventEvidence,
  ResolvedPolicyEvidence,
  ResolvedStructuredEvidence,
  ResolvedUsageEvidence,
  ResolvedAttributionEvidence,
  ResolvedUnavailableEvidence,
  EvidenceResolutionContext,
} from './resolvedEvidenceTypes';
import {
  executionFromTranscriptBlock,
  formatExecutionDuration,
} from '../execution';
import { cleanTranscriptForDisplay } from '../transcript/transcriptFormat';
import {
  parseEngineeringEvidence,
  buildParseContext,
} from '../structuredEvidence';
import { resolveRepositoryFileChangeEvidence } from '../evidenceCollectors/repositoryEvidenceCopy';

/**
 * Resolves a single ExecutionSelectionItem against current transcript blocks.
 */
export function resolveExecutionItem(
  item: ExecutionSelectionItem,
  context: EvidenceResolutionContext,
): ResolvedExecutionEvidence | ResolvedUnavailableEvidence {
  const block = context.blocks?.find((b) => b.id === item.executionId);

  if (block) {
    const exec = executionFromTranscriptBlock(block);
    const cleaned = cleanTranscriptForDisplay(block.output);

    let structuredEvidence = block.structuredEvidence;
    if (!structuredEvidence && (block.output || block.rawOutput)) {
      try {
        structuredEvidence = parseEngineeringEvidence(
          buildParseContext(exec, exec.evidenceBlocks),
        );
      } catch {
        structuredEvidence = undefined;
      }
    }

    const duration = formatExecutionDuration(block.startedAt, block.completedAt);
    const isAgent = Boolean(
      block.agentRunId ||
      exec.actorId?.includes('agent') ||
      exec.source === 'agent',
    );

    return {
      kind: 'execution',
      id: block.id,
      command: block.command,
      actorId: exec.actorId,
      actorType: isAgent ? 'agent' : 'human',
      cwd: block.cwd,
      intent: block.intent,
      lifecycle: exec.lifecycle,
      outcome: exec.outcome,
      exitCode: block.exitCode,
      completionSource: block.completionSource,
      outcomeSource: block.outcomeSource,
      outcomeTrusted: block.outcomeTrusted,
      startedAt: block.startedAt,
      completedAt: block.completedAt,
      duration,
      output: cleaned.cleanedText || block.output,
      rawOutput: block.rawOutput,
      errorOutput: block.errorOutput,
      hasDiagnosticError: block.hasDiagnosticError || block.hasError,
      structuredEvidence:
        structuredEvidence && structuredEvidence.length > 0
          ? structuredEvidence
          : undefined,
      structuredSummary: item.structuredSummary,
      agentRunId: block.agentRunId,
      verificationRunId: block.verificationRunId,
      attributionId: block.attributionId,
      selectedAt: item.selectedAt,
    };
  }

  // Fallback to metadata retained in selection item
  if (item.command) {
    return {
      kind: 'execution',
      id: item.executionId,
      command: item.command,
      cwd: item.cwd,
      lifecycle: item.completedAt ? 'finished' : 'running',
      outcome: item.outcome || 'unknown',
      exitCode: item.exitCode,
      completedAt: item.completedAt,
      output: item.outputSnippet,
      structuredSummary: item.structuredSummary,
      selectedAt: item.selectedAt,
    };
  }

  return {
    kind: 'unavailable',
    id: item.id,
    originalKind: 'Execution',
    referenceId: item.executionId,
    reason: 'Execution block is unavailable or has been evicted from active capture.',
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves a single RepositoryFileSelectionItem against repository filesystem or collector.
 */
export async function resolveRepositoryFileItem(
  item: RepositoryFileSelectionItem,
  context: EvidenceResolutionContext,
): Promise<ResolvedRepositoryChangeEvidence> {
  const repoRoot =
    item.repositoryRoot ?? context.repositorySnapshot?.repositoryRoot;

  let resolvedPatch: string | undefined;
  let resolvedContent: string | undefined;
  let resolvedBinary = item.binary;
  let resolvedTruncated = false;
  let unavailableReason: string | undefined;
  let evidenceSource =
    item.status === 'untracked' ? 'current working-tree file' : 'Git diff';

  if (repoRoot) {
    try {
      const res = await resolveRepositoryFileChangeEvidence(
        {
          ...item,
          lineStatsSource: item.lineStatsSource as
            | import('../evidenceCollectors/types').RepositoryFileLineStatsSource
            | undefined,
        },
        {
          repositoryRoot: repoRoot,
          runCommand: context.runCommand,
          fsModule: context.fsModule,
          maxPerFileBytes: context.maxPerItemChars,
        },
      );

      resolvedPatch = res.patch;
      resolvedContent = res.content;
      resolvedBinary = res.binary ?? resolvedBinary;
      resolvedTruncated = Boolean(res.truncated);
      unavailableReason = res.unavailableReason;
      if (res.evidenceSource) {
        evidenceSource = res.evidenceSource;
      }
    } catch (err: unknown) {
      unavailableReason =
        err instanceof Error ? err.message : String(err);
    }
  } else {
    unavailableReason = 'Repository root unavailable for collecting diff evidence.';
  }

  // Check attribution context
  let attribution: { targetId: string; summary?: string } | undefined;
  if (context.changeAttributions && context.changeAttributions.length > 0) {
    for (const attr of context.changeAttributions) {
      const matchFile = attr.delta?.files?.find((f) => f.path === item.path);
      if (matchFile) {
        attribution = {
          targetId: attr.targetId,
          summary: `Delta: ${matchFile.deltaKind} (${matchFile.status})`,
        };
        break;
      }
    }
  }

  // Dirty baseline check
  const dirtyBaseline = Boolean(
    context.repositorySnapshot?.status &&
      !context.repositorySnapshot.status.clean,
  );

  return {
    kind: 'repository-change',
    id: item.id,
    path: item.path,
    previousPath: item.previousPath,
    status: item.status || 'modified',
    insertions: item.insertions,
    deletions: item.deletions,
    binary: resolvedBinary,
    lineStatsSource: item.lineStatsSource,
    evidenceSource,
    patch: resolvedPatch,
    content: resolvedContent,
    truncated: resolvedTruncated,
    unavailableReason,
    attribution,
    dirtyBaseline,
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves a VerificationResultSelectionItem, including linked Execution evidence.
 */
export function resolveVerificationItem(
  item: VerificationResultSelectionItem,
  context: EvidenceResolutionContext,
  allSelectedKeys: Set<string>,
): ResolvedVerificationEvidence {
  const allRuns = [
    ...(context.historicalVerificationRuns ?? []),
    ...(context.activeVerificationRun ? [context.activeVerificationRun] : []),
    ...(context.latestVerificationRun ? [context.latestVerificationRun] : []),
  ];

  const run = allRuns.find((r) => r.id === item.runId);
  const criterion = run?.criteriaSnapshot?.find((c) => c.id === item.criterionId);
  const result = run?.criterionResults?.find((cr) => cr.criterionId === item.criterionId);

  const contract =
    context.verificationContracts?.find((c) => c.id === run?.contractId) ??
    context.verificationContract;

  const executionId = result?.executionId;
  let linkedExecution: ResolvedExecutionEvidence | undefined;
  let linkedExecutionIncludedSeparately = false;

  if (executionId) {
    // Section 27: Check if the linked execution is separately selected
    const isSeparatelySelected =
      allSelectedKeys.has(executionId) ||
      allSelectedKeys.has(`exec:${executionId}`);

    if (isSeparatelySelected) {
      linkedExecutionIncludedSeparately = true;
    } else {
      const linkedBlock = context.blocks?.find((b) => b.id === executionId);
      if (linkedBlock) {
        const resolved = resolveExecutionItem(
          {
            id: `exec:${linkedBlock.id}`,
            kind: 'execution',
            executionId: linkedBlock.id,
            command: linkedBlock.command,
            selectedAt: item.selectedAt,
          },
          context,
        );
        if (resolved.kind === 'execution') {
          linkedExecution = resolved;
        }
      }
    }
  }

  return {
    kind: 'verification',
    id: item.id,
    runId: item.runId,
    criterionId: item.criterionId,
    profileName: contract?.name,
    label: criterion?.label ?? item.label,
    command: criterion?.command ?? item.command,
    expectedExitCodes: criterion?.expectedExitCodes ?? [0],
    status: result?.status ?? item.status,
    observedExitCode: result?.observedExitCode ?? item.observedExitCode,
    message: result?.message ?? item.message,
    executionId,
    linkedExecution,
    linkedExecutionIncludedSeparately,
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves an AgentEventSelectionItem against registered agent events.
 */
export function resolveAgentEventItem(
  item: AgentEventSelectionItem,
  context: EvidenceResolutionContext,
): ResolvedAgentEventEvidence {
  const events = context.agentEventIngress?.getEventsForRun(item.agentRunId) ?? [];
  const event = events.find((e) => e.id === item.eventId);

  if (event) {
    const payload = event.payload as Record<string, unknown> | undefined;
    const provider =
      event.source === 'codex-app-server' || event.source === 'codex'
        ? 'Codex'
        : 'Claude Code';

    let input: string | undefined;
    if (payload?.parameters) {
      input =
        typeof payload.parameters === 'string'
          ? payload.parameters
          : JSON.stringify(payload.parameters, null, 2);
    } else if (typeof payload?.inputSummary === 'string') {
      input = payload.inputSummary;
    }

    let result: string | undefined;
    if (typeof payload?.resultSummary === 'string') {
      result = payload.resultSummary;
    } else if (payload?.result !== undefined) {
      result =
        typeof payload.result === 'string'
          ? payload.result
          : JSON.stringify(payload.result, null, 2);
    }

    return {
      kind: 'agent-event',
      id: item.id,
      agentRunId: item.agentRunId,
      eventId: item.eventId,
      eventType: event.type,
      provider,
      category: typeof payload?.category === 'string' ? payload.category : item.category,
      toolName: typeof payload?.toolName === 'string' ? payload.toolName : item.toolName,
      filePath: typeof payload?.filePath === 'string' ? payload.filePath : item.filePath,
      command: typeof payload?.command === 'string' ? payload.command : item.command,
      summary: item.summary,
      detail: item.detail,
      input,
      result,
      success: typeof payload?.success === 'boolean' ? payload.success : undefined,
      error: typeof payload?.error === 'string' ? payload.error : undefined,
      timestamp: event.createdAt,
      linkedExecutionId: typeof payload?.executionId === 'string' ? payload.executionId : undefined,
      selectedAt: item.selectedAt,
    };
  }

  // Fallback to item metadata
  return {
    kind: 'agent-event',
    id: item.id,
    agentRunId: item.agentRunId,
    eventId: item.eventId,
    eventType: item.eventType,
    category: item.category,
    toolName: item.toolName,
    filePath: item.filePath,
    command: item.command,
    summary: item.summary,
    detail: item.detail,
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves a PolicyDecisionSelectionItem.
 */
export function resolvePolicyDecisionItem(
  item: PolicyDecisionSelectionItem,
): ResolvedPolicyEvidence {
  return {
    kind: 'policy',
    id: item.id,
    subkind: 'decision',
    actionRequestId: item.actionRequestId,
    effect: item.effect,
    command: item.command,
    filePath: item.filePath,
    toolName: item.toolName,
    reason: item.reason,
    requesterType: item.requesterType,
    agentRunId: item.agentRunId,
    governanceCoverage: item.governanceCoverage,
    shellType: item.shellType,
    warningCodes: item.warningCodes,
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves an ApprovalRecordSelectionItem.
 */
export function resolveApprovalRecordItem(
  item: ApprovalRecordSelectionItem,
): ResolvedPolicyEvidence {
  return {
    kind: 'policy',
    id: item.id,
    subkind: 'approval',
    actionRequestId: item.actionRequestId,
    status: item.status,
    command: item.command,
    filePath: item.filePath,
    toolName: item.toolName,
    reason: item.reason,
    resolvedByActorId: item.resolvedByActorId,
    comment: item.comment,
    agentRunId: item.agentRunId,
    governanceCoverage: item.governanceCoverage,
    shellType: item.shellType,
    warningCodes: item.warningCodes,
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves a PolicyAuditSelectionItem.
 */
export function resolvePolicyAuditItem(
  item: PolicyAuditSelectionItem,
): ResolvedPolicyEvidence {
  return {
    kind: 'policy',
    id: item.id,
    subkind: 'audit',
    actionRequestId: item.actionRequestId,
    governanceCoverage: item.governanceCoverage,
    command: item.command,
    filePath: item.filePath,
    shellType: item.shellType,
    decision: item.decision,
    approvalStatus: item.approvalStatus,
    warningCodes: item.warningCodes,
    reason: item.reason,
    timestamp: item.timestamp,
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves a StructuredEvidenceSelectionItem.
 */
export function resolveStructuredEvidenceItem(
  item: StructuredEvidenceSelectionItem,
  context: EvidenceResolutionContext,
): ResolvedStructuredEvidence {
  let linkedExecution: ResolvedExecutionEvidence | undefined;
  const block = context.blocks?.find((b) => b.id === item.executionId);
  if (block) {
    const res = resolveExecutionItem(
      {
        id: `exec:${block.id}`,
        kind: 'execution',
        executionId: block.id,
        command: block.command,
        selectedAt: item.selectedAt,
      },
      context,
    );
    if (res.kind === 'execution') {
      linkedExecution = res;
    }
  }

  return {
    kind: 'structured-evidence',
    id: item.id,
    evidenceId: item.evidenceId,
    executionId: item.executionId,
    tool: item.tool,
    status: item.status,
    summary: item.summary,
    linkedExecution,
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves a UsageSummarySelectionItem.
 */
export function resolveUsageSummaryItem(
  item: UsageSummarySelectionItem,
): ResolvedUsageEvidence {
  return {
    kind: 'usage',
    id: item.id,
    agentRunId: item.agentRunId,
    provider: item.provider,
    model: item.model,
    totalTokens: item.totalTokens ?? 'unknown',
    inputTokens: item.inputTokens ?? 'unknown',
    outputTokens: item.outputTokens ?? 'unknown',
    calculatedCost: item.calculatedCost,
    costStatus: item.costStatus,
    authoritative: true,
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves a RepositoryAttributionSelectionItem.
 */
export function resolveAttributionItem(
  item: RepositoryAttributionSelectionItem,
): ResolvedAttributionEvidence {
  return {
    kind: 'repository-attribution',
    id: item.id,
    attributionId: item.attributionId,
    targetId: item.targetId,
    filesChangedCount: item.filesChangedCount,
    totalInsertions: item.totalInsertions,
    totalDeletions: item.totalDeletions,
    summary: item.summary,
    selectedAt: item.selectedAt,
  };
}

/**
 * Resolves a single EvidenceSelectionItem against the provided context.
 */
export async function resolveEvidenceSelection(
  item: EvidenceSelectionItem,
  context: EvidenceResolutionContext,
  allSelectedKeys: Set<string> = new Set(),
): Promise<ResolvedEvidenceItem> {
  switch (item.kind) {
    case 'execution':
      return resolveExecutionItem(item, context);
    case 'repository-file':
      return await resolveRepositoryFileItem(item, context);
    case 'verification-result':
      return resolveVerificationItem(item, context, allSelectedKeys);
    case 'agent-event':
      return resolveAgentEventItem(item, context);
    case 'policy-decision':
      return resolvePolicyDecisionItem(item);
    case 'approval-record':
      return resolveApprovalRecordItem(item);
    case 'policy-audit':
      return resolvePolicyAuditItem(item);
    case 'structured-evidence':
      return resolveStructuredEvidenceItem(item, context);
    case 'usage-summary':
      return resolveUsageSummaryItem(item);
    case 'repository-attribution':
      return resolveAttributionItem(item);
    default:
      return {
        kind: 'unavailable',
        id: (item as EvidenceSelectionItem).id || 'unknown',
        originalKind: (item as EvidenceSelectionItem).kind || 'Unknown',
        referenceId: (item as EvidenceSelectionItem).id || 'unknown',
        reason: 'Unrecognized evidence selection item kind.',
      };
  }
}

/**
 * Resolves an array of EvidenceSelectionItems concurrently and returns them in deterministic order.
 */
export async function resolveEvidenceSelections(
  items: EvidenceSelectionItem[],
  context: EvidenceResolutionContext,
): Promise<ResolvedEvidenceItem[]> {
  if (items.length === 0) return [];

  const allSelectedKeys = new Set(items.map((i) => i.id));

  // Concurrently resolve all items
  const resolved = await Promise.all(
    items.map((item) => resolveEvidenceSelection(item, context, allSelectedKeys)),
  );

  return resolved;
}
