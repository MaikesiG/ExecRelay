/**
 * TraceRelay / CapTerm Evidence Clipboard Formatter (HARDEN-014)
 *
 * Formats resolved engineering evidence into a clean, deterministic, AI-ready
 * Markdown document for copying to clipboard.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Single shared formatter for all Monitor surfaces (Capture, Changes, Verify, Agents, Governance).
 * 2. Deterministic ordering: grouped by domain, sorted by selection order and stable IDs.
 * 3. Bounded output: respects MAX_ITEM_CHARS and MAX_TOTAL_COPY_CHARS with explicit truncation markers.
 * 4. Semantic truncation: preserves head and tail of output rather than arbitrary hard cutoff.
 * 5. Secret safety: never outputs cryptographic nonces, tokens, or credentials.
 * 6. Honest evidence: never fabricates exit codes, verdicts, tokens, or missing diffs.
 */

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
} from './resolvedEvidenceTypes';
import {
  fenceCode,
  getLanguageForPath,
} from '../evidenceCollectors/repositoryEvidenceCopy';

export const MAX_ITEM_CHARS = 100_000;
export const MAX_TOTAL_COPY_CHARS = 500_000;

export interface FormatClipboardOptions {
  maxItemChars?: number;
  maxTotalChars?: number;
  includeDocumentHeader?: boolean;
}

/**
 * Truncates long output semantically by preserving the beginning and end of the text.
 */
export function truncateOutputSemantically(
  text: string,
  maxChars: number = MAX_ITEM_CHARS,
): { text: string; truncated: boolean } {
  if (!text || text.length <= maxChars) {
    return { text, truncated: false };
  }

  const markerEstimate = 120;
  const half = Math.max(100, Math.floor((maxChars - markerEstimate) / 2));
  const head = text.slice(0, half);
  const tail = text.slice(text.length - half);

  return {
    text: `${head}\n\n... [Output truncated by CapTerm: showing first ${half.toLocaleString()} and last ${half.toLocaleString()} of ${text.length.toLocaleString()} characters] ...\n\n${tail}`,
    truncated: true,
  };
}

/**
 * Truncates diff or code content with an explicit single-direction truncation marker.
 */
export function truncateDiffOrContent(
  text: string,
  maxChars: number = MAX_ITEM_CHARS,
): { text: string; truncated: boolean } {
  if (!text || text.length <= maxChars) {
    return { text, truncated: false };
  }

  const sliced = text.slice(0, maxChars);
  return {
    text: `${sliced}\n\n[Output truncated by CapTerm: showing first ${maxChars.toLocaleString()} of ${text.length.toLocaleString()} characters]`,
    truncated: true,
  };
}

/**
 * Formats a single ResolvedExecutionEvidence item.
 */
export function formatExecutionEvidence(
  item: ResolvedExecutionEvidence,
  maxItemChars: number = MAX_ITEM_CHARS,
): string {
  const lines: string[] = [];

  const cmdHeader =
    item.command.length > 60
      ? `${item.command.slice(0, 57)}...`
      : item.command;
  lines.push(`## Execution — ${cmdHeader}`);
  lines.push('');

  lines.push(`Command: \`${item.command}\``);

  if (item.actorType) {
    const actorLabel =
      item.actorType.charAt(0).toUpperCase() + item.actorType.slice(1);
    lines.push(`Actor: ${actorLabel}`);
  }

  if (item.cwd) {
    lines.push(`Working Directory: \`${item.cwd}\``);
  }

  if (item.intent && item.intent !== 'interactive') {
    lines.push(`Intent: ${item.intent}`);
  }

  // Lifecycle & Outcome Status
  let displayStatus: string;
  if (item.lifecycle === 'running') {
    displayStatus = 'Running';
  } else if (item.lifecycle === 'interrupted') {
    displayStatus = 'Interrupted';
  } else if (item.outcome === 'succeeded') {
    displayStatus = 'Passed';
  } else if (item.outcome === 'failed') {
    displayStatus = 'Failed';
  } else {
    displayStatus = 'Finished';
  }
  lines.push(`Status: ${displayStatus}`);

  if (item.exitCode !== null && item.exitCode !== undefined) {
    lines.push(`Exit Code: ${item.exitCode}`);
  }

  if (item.completionSource) {
    lines.push(`Completion Source: ${item.completionSource}`);
  }

  if (item.outcomeSource) {
    const trustSuffix = item.outcomeTrusted ? ' (trusted)' : '';
    lines.push(`Outcome Source: ${item.outcomeSource}${trustSuffix}`);
  }

  if (item.duration) {
    lines.push(`Duration: ${item.duration}`);
  }

  if (item.startedAt) {
    lines.push(`Started At: ${new Date(item.startedAt).toISOString()}`);
  }

  if (item.agentRunId) {
    lines.push(`Associated Agent Run: ${item.agentRunId}`);
  }

  lines.push('');

  // Primary Output
  if (item.output && item.output.trim().length > 0) {
    const semTrunc = truncateOutputSemantically(item.output.trim(), maxItemChars);
    lines.push('Output:');
    lines.push(fenceCode(semTrunc.text, 'text'));
    lines.push('');
  } else if (item.rawOutput && item.rawOutput.trim().length > 0) {
    const semTrunc = truncateOutputSemantically(item.rawOutput.trim(), maxItemChars);
    lines.push('Output:');
    lines.push(fenceCode(semTrunc.text, 'text'));
    lines.push('');
  } else {
    lines.push('Output: (none)');
    lines.push('');
  }

  // Separate Error Output (if present)
  if (item.errorOutput && item.errorOutput.trim().length > 0) {
    const semTrunc = truncateOutputSemantically(item.errorOutput.trim(), maxItemChars);
    lines.push('Error Output:');
    lines.push(fenceCode(semTrunc.text, 'text'));
    lines.push('');
  }

  // Structured Evidence
  if (item.structuredEvidence && item.structuredEvidence.length > 0) {
    lines.push('Structured Evidence:');
    for (const ev of item.structuredEvidence) {
      if (ev.type === 'test-summary') {
        const pass = ev.passed ?? 0;
        const fail = ev.failed ?? 0;
        const skipped = ev.skipped ? `, ${ev.skipped} skipped` : '';
        const statusLabel = fail === 0 ? 'PASSED' : 'FAILED';
        lines.push(
          `- ${ev.framework.toUpperCase()} [${statusLabel}]: ${pass} passed, ${fail} failed${skipped}`,
        );
      } else if (ev.type === 'diagnostic') {
        lines.push(`- ${ev.tool.toUpperCase()}: ${ev.message}`);
      } else if (ev.type === 'typecheck-summary' || ev.type === 'lint-summary') {
        lines.push(
          `- ${ev.tool.toUpperCase()}: ${ev.errorCount ?? 0} errors, ${ev.warningCount ?? 0} warnings`,
        );
      } else {
        lines.push(`- ${(ev as { tool?: string }).tool || 'evidence'}: ${ev.type}`);
      }
    }
    lines.push('');
  } else if (item.structuredSummary) {
    lines.push('Structured Evidence:');
    lines.push(`- ${item.structuredSummary}`);
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Formats a single ResolvedRepositoryChangeEvidence item.
 */
export function formatRepositoryChangeEvidence(
  item: ResolvedRepositoryChangeEvidence,
  maxItemChars: number = MAX_ITEM_CHARS,
): string {
  const lines: string[] = [];

  let headerPath = item.path;
  if (item.previousPath) {
    headerPath = `${item.previousPath} -> ${item.path}`;
  }
  lines.push(`## Repository Change — ${headerPath}`);
  lines.push('');

  lines.push(`Path: ${item.path}`);
  lines.push(`Status: ${item.status}`);

  if (item.insertions !== undefined || item.deletions !== undefined) {
    const ins = item.insertions ?? 0;
    const del = item.deletions ?? 0;
    lines.push(`Observed line changes: +${ins} -${del}`);
  }

  if (item.attribution) {
    lines.push(
      `Attribution: Observed during execution window (target: \`${item.attribution.targetId}\`${item.attribution.summary ? `, ${item.attribution.summary}` : ''})`,
    );
  }

  if (item.dirtyBaseline) {
    lines.push('Baseline context: Working tree was dirty prior to execution');
  }

  if (item.evidenceSource) {
    lines.push(`Evidence Source: ${item.evidenceSource}`);
  }

  lines.push('');

  if (item.binary) {
    lines.push('Content: binary');
    lines.push('Content body omitted.');
    return lines.join('\n').trim();
  }

  if (item.patch) {
    const trunc = truncateDiffOrContent(item.patch, maxItemChars);
    lines.push(fenceCode(trunc.text, 'diff'));
  } else if (item.content !== undefined) {
    const lang = item.language ?? getLanguageForPath(item.path);
    const trunc = truncateDiffOrContent(item.content, maxItemChars);
    lines.push('New File Content:');
    lines.push(fenceCode(trunc.text, lang));
  } else if (item.status === 'deleted') {
    lines.push('Previous content unavailable in retained evidence.');
  } else if (item.unavailableReason) {
    lines.push(item.unavailableReason);
  } else {
    lines.push('Content unavailable from collected repository evidence.');
  }

  return lines.join('\n').trim();
}

/**
 * Formats a single ResolvedVerificationEvidence item.
 */
export function formatVerificationEvidence(
  item: ResolvedVerificationEvidence,
  maxItemChars: number = MAX_ITEM_CHARS,
): string {
  const lines: string[] = [];

  lines.push(`## Verification — ${item.label || item.criterionId}`);
  lines.push('');

  if (item.profileName) {
    lines.push(`Profile: ${item.profileName}`);
  }

  lines.push(`Run ID: ${item.runId}`);
  lines.push(`Criterion: ${item.label}`);
  lines.push(`Command: \`${item.command}\``);

  if (item.expectedExitCodes && item.expectedExitCodes.length > 0) {
    lines.push(`Expected Exit Codes: ${item.expectedExitCodes.join(', ')}`);
  }

  // Verdict representation preserving STOP semantics
  let verdictLabel: string;
  if (item.status === 'passed') {
    verdictLabel = 'Passed';
  } else if (item.status === 'failed') {
    verdictLabel = 'Failed';
  } else if (item.status === 'cancelled') {
    verdictLabel = 'Cancelled (Verification stopped by user)';
  } else if (item.status === 'stop-timeout') {
    verdictLabel = 'Stop Issue (Underlying command remained unresolved after interrupt request)';
  } else if (item.status === 'error') {
    verdictLabel = 'Error';
  } else if (item.status === 'stopping') {
    verdictLabel = 'Stopping';
  } else if (item.status === 'running') {
    verdictLabel = 'Running';
  } else if (item.status === 'skipped') {
    verdictLabel = 'Skipped';
  } else {
    verdictLabel = item.status || 'Unknown';
  }
  lines.push(`Verdict: ${verdictLabel}`);

  if (item.observedExitCode !== null && item.observedExitCode !== undefined) {
    lines.push(`Observed Exit Code: ${item.observedExitCode}`);
  }

  if (item.message) {
    lines.push(`Details: ${item.message}`);
  }

  if (item.executionId) {
    lines.push(`Execution ID: ${item.executionId}`);
  }

  lines.push('');

  // Linked Execution Evidence
  if (item.linkedExecutionIncludedSeparately) {
    lines.push(`Linked Execution: \`${item.executionId}\` (included separately)`);
    lines.push('');
  } else if (item.linkedExecution) {
    lines.push('Linked Execution Evidence:');
    lines.push(`Command: \`${item.linkedExecution.command}\``);
    lines.push(`Status: ${item.linkedExecution.outcome}`);
    if (
      item.linkedExecution.exitCode !== null &&
      item.linkedExecution.exitCode !== undefined
    ) {
      lines.push(`Exit Code: ${item.linkedExecution.exitCode}`);
    }
    if (
      item.linkedExecution.output &&
      item.linkedExecution.output.trim().length > 0
    ) {
      const trunc = truncateOutputSemantically(
        item.linkedExecution.output.trim(),
        maxItemChars,
      );
      lines.push('Output:');
      lines.push(fenceCode(trunc.text, 'text'));
    }
    lines.push('');
  } else if (item.executionId) {
    lines.push(`Linked Execution: \`${item.executionId}\` (evidence unavailable in retained capture)`);
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Formats a single ResolvedAgentEventEvidence item.
 */
export function formatAgentEventEvidence(
  item: ResolvedAgentEventEvidence,
  maxItemChars: number = MAX_ITEM_CHARS,
): string {
  const lines: string[] = [];

  const titleSuffix = item.toolName
    ? `Tool Call (${item.toolName})`
    : item.eventType;
  lines.push(`## Agent Activity — ${titleSuffix}`);
  lines.push('');

  if (item.provider) {
    lines.push(`Provider: ${item.provider}`);
  }

  lines.push(`Run ID: ${item.agentRunId}`);
  lines.push(`Event Type: ${item.eventType}`);

  if (item.timestamp) {
    lines.push(`Timestamp: ${new Date(item.timestamp).toISOString()}`);
  }

  if (item.toolName) {
    lines.push(`Tool: ${item.toolName}`);
  }

  if (item.filePath) {
    lines.push(`Target File: \`${item.filePath}\``);
  }

  if (item.command) {
    lines.push(`Command: \`${item.command}\``);
  }

  if (item.summary) {
    lines.push(`Summary: ${item.summary}`);
  }

  if (item.linkedExecutionId) {
    lines.push(`Linked Execution: \`${item.linkedExecutionId}\``);
  }

  lines.push('');

  if (item.input) {
    const trunc = truncateOutputSemantically(item.input.trim(), maxItemChars);
    lines.push('Input:');
    lines.push(fenceCode(trunc.text, 'text'));
    lines.push('');
  }

  if (item.result) {
    const trunc = truncateOutputSemantically(item.result.trim(), maxItemChars);
    lines.push('Result:');
    lines.push(fenceCode(trunc.text, 'text'));
    lines.push('');
  }

  if (item.error) {
    const trunc = truncateOutputSemantically(item.error.trim(), maxItemChars);
    lines.push('Error:');
    lines.push(fenceCode(trunc.text, 'text'));
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Formats a single ResolvedPolicyEvidence item.
 */
export function formatPolicyEvidence(item: ResolvedPolicyEvidence): string {
  const lines: string[] = [];

  let headerTitle: string;
  if (item.subkind === 'decision') {
    headerTitle = `Policy Decision — ${item.effect?.toUpperCase() ?? 'DECISION'}`;
  } else if (item.subkind === 'approval') {
    headerTitle = `Approval Record — ${item.status?.toUpperCase() ?? 'APPROVAL'}`;
  } else {
    headerTitle = `Policy Audit — ${item.governanceCoverage || 'AUDIT'}`;
  }
  lines.push(`## ${headerTitle}`);
  lines.push('');

  const target = item.command
    ? `\`${item.command}\``
    : item.filePath
      ? `\`${item.filePath}\``
      : item.toolName || 'action';
  lines.push(`Action Request: ${target}`);

  if (item.requesterType) {
    lines.push(`Requester: ${item.requesterType}`);
  }

  if (item.governanceCoverage) {
    lines.push(`Coverage: ${item.governanceCoverage}`);
  }

  if (item.effect) {
    lines.push(`Effect: ${item.effect.toUpperCase()}`);
  }

  if (item.status) {
    lines.push(`Status: ${item.status.toUpperCase()}`);
  }

  if (item.resolvedByActorId) {
    lines.push(`Resolved By: ${item.resolvedByActorId}`);
  }

  if (item.comment) {
    lines.push(`Comment: ${item.comment}`);
  }

  if (item.reason) {
    lines.push(`Reason: ${item.reason}`);
  }

  if (item.warningCodes && item.warningCodes.length > 0) {
    lines.push(`Warnings: ${item.warningCodes.join(', ')}`);
  }

  if (item.timestamp) {
    lines.push(`Timestamp: ${new Date(item.timestamp).toISOString()}`);
  }

  if (item.requestFingerprint) {
    lines.push(`Request Fingerprint: ${item.requestFingerprint.slice(0, 16)}...`);
  }

  return lines.join('\n').trim();
}

/**
 * Formats a single ResolvedStructuredEvidence item.
 */
export function formatStructuredEvidence(item: ResolvedStructuredEvidence): string {
  const lines: string[] = [];

  lines.push(`## Structured Evidence — ${item.tool.toUpperCase()}`);
  lines.push('');
  lines.push(`Tool: ${item.tool}`);
  lines.push(`Status: ${item.status.toUpperCase()}`);
  lines.push(`Summary: ${item.summary}`);

  if (item.details) {
    lines.push('');
    lines.push('Details:');
    lines.push(item.details);
  }

  return lines.join('\n').trim();
}

/**
 * Formats a single ResolvedUsageEvidence item.
 */
export function formatUsageEvidence(item: ResolvedUsageEvidence): string {
  const lines: string[] = [];

  lines.push(`## Usage & Cost — ${item.provider}`);
  lines.push('');
  lines.push(`Provider: ${item.provider}`);

  if (item.model) {
    lines.push(`Model: ${item.model}`);
  }

  if (item.authoritative !== undefined) {
    lines.push(`Confidence: ${item.authoritative ? 'Authoritative' : 'Estimated'}`);
  }

  // Section 25 Invariant: Unknown tokens != 0!
  if (item.inputTokens !== undefined) {
    lines.push(
      `Input Tokens: ${item.inputTokens === 'unknown' ? 'Unknown' : item.inputTokens.toLocaleString()}`,
    );
  }

  if (item.outputTokens !== undefined) {
    lines.push(
      `Output Tokens: ${item.outputTokens === 'unknown' ? 'Unknown' : item.outputTokens.toLocaleString()}`,
    );
  }

  lines.push(
    `Total Tokens: ${item.totalTokens === 'unknown' ? 'Unknown' : item.totalTokens.toLocaleString()}`,
  );

  if (item.calculatedCost !== undefined) {
    lines.push(`Calculated Cost: $${item.calculatedCost.toFixed(4)}`);
  }

  lines.push(`Status: ${item.costStatus}`);

  return lines.join('\n').trim();
}

/**
 * Formats a single ResolvedAttributionEvidence item.
 */
export function formatAttributionEvidence(item: ResolvedAttributionEvidence): string {
  const lines: string[] = [];

  lines.push(`## Repository Attribution — ${item.targetId}`);
  lines.push('');
  lines.push(`Target: \`${item.targetId}\``);
  lines.push(`Files Changed: ${item.filesChangedCount}`);
  lines.push(`Observed Line Changes: +${item.totalInsertions} -${item.totalDeletions}`);

  if (item.summary) {
    lines.push(`Summary: ${item.summary}`);
  }

  return lines.join('\n').trim();
}

/**
 * Formats a single ResolvedUnavailableEvidence item.
 */
export function formatUnavailableEvidence(item: ResolvedUnavailableEvidence): string {
  const lines: string[] = [];

  lines.push(`## ${item.originalKind} — Evidence Unavailable`);
  lines.push('');
  lines.push(`Reference: \`${item.referenceId}\``);
  lines.push(`Status: Unavailable`);
  lines.push(`Reason: ${item.reason}`);

  return lines.join('\n').trim();
}

/**
 * Formats any ResolvedEvidenceItem dispatching to the appropriate domain formatter.
 */
export function formatResolvedItem(
  item: ResolvedEvidenceItem,
  maxItemChars: number = MAX_ITEM_CHARS,
): string {
  switch (item.kind) {
    case 'execution':
      return formatExecutionEvidence(item, maxItemChars);
    case 'repository-change':
      return formatRepositoryChangeEvidence(item, maxItemChars);
    case 'verification':
      return formatVerificationEvidence(item, maxItemChars);
    case 'agent-event':
      return formatAgentEventEvidence(item, maxItemChars);
    case 'policy':
      return formatPolicyEvidence(item);
    case 'structured-evidence':
      return formatStructuredEvidence(item);
    case 'usage':
      return formatUsageEvidence(item);
    case 'repository-attribution':
      return formatAttributionEvidence(item);
    case 'unavailable':
      return formatUnavailableEvidence(item);
    default:
      return `## Unknown Evidence\n\nKind: ${(item as { kind: string }).kind}`;
  }
}

/**
 * Canonical ordering weights for evidence domains.
 */
const DOMAIN_ORDER_WEIGHTS: Record<ResolvedEvidenceItem['kind'], number> = {
  'execution': 1,
  'repository-change': 2,
  'verification': 3,
  'structured-evidence': 4,
  'repository-attribution': 5,
  'agent-event': 6,
  'policy': 7,
  'usage': 8,
  'unavailable': 9,
};

/**
 * Deterministically sorts resolved evidence items by domain priority,
 * then by selection timestamp (selectedAt) ascending, with item ID as tie-breaker.
 */
export function sortResolvedEvidenceItems(
  items: ResolvedEvidenceItem[],
): ResolvedEvidenceItem[] {
  return [...items].sort((a, b) => {
    const weightA = DOMAIN_ORDER_WEIGHTS[a.kind] ?? 99;
    const weightB = DOMAIN_ORDER_WEIGHTS[b.kind] ?? 99;
    if (weightA !== weightB) {
      return weightA - weightB;
    }
    const timeA = a.selectedAt ?? 0;
    const timeB = b.selectedAt ?? 0;
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Formats all resolved evidence items into a single, cohesive Markdown document
 * ready for the system clipboard.
 */
export function formatResolvedEvidenceForClipboard(
  items: ResolvedEvidenceItem[],
  options: FormatClipboardOptions = {},
): string {
  if (items.length === 0) {
    return '';
  }

  const maxItemChars = options.maxItemChars ?? MAX_ITEM_CHARS;
  const maxTotalChars = options.maxTotalChars ?? MAX_TOTAL_COPY_CHARS;

  // 1. Sort items deterministically
  const sortedItems = sortResolvedEvidenceItems(items);

  // 2. Build markdown document
  const sections: string[] = [];

  if (options.includeDocumentHeader !== false) {
    sections.push('# CapTerm Evidence');
  }

  let accumulatedLength = sections.join('\n\n').length;

  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    const formatted = formatResolvedItem(item, maxItemChars);
    const additionLength = formatted.length + 2; // +2 for separator

    if (accumulatedLength + additionLength > maxTotalChars && i > 0) {
      const omittedCount = sortedItems.length - i;
      sections.push(
        `[Evidence export truncated: size limit reached (${maxTotalChars.toLocaleString()} characters; ${omittedCount} ${omittedCount === 1 ? 'item' : 'items'} omitted)]`,
      );
      break;
    }

    sections.push(formatted);
    accumulatedLength += additionLength;
  }

  return sections.join('\n\n').trim();
}
