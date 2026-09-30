/**
 * Pure deterministic prompt builder.
 *
 * Assembles selected evidence into clean, AI-ready markdown context without
 * requiring an LLM or network calls.
 *
 * INVARIANTS:
 * 1. Deterministic & local: zero network requests or API dependencies.
 * 2. Only selected evidence is included; unselected items are strictly excluded.
 * 3. Unknown or missing fields are omitted rather than fabricated.
 * 4. Provenance is preserved: commands, outcomes, exit codes, file statuses, numstats, verification results.
 * 5. Avoids giant raw dumps; formats structured summaries.
 * 6. Never reveals cryptographic nonces, tokens, or private secrets in formatted prompts.
 */

import type { BuildPromptOptions } from './types';
import type {
  RepositoryFileSelectionItem,
  ExecutionSelectionItem,
  StructuredEvidenceSelectionItem,
  VerificationResultSelectionItem,
  RepositoryAttributionSelectionItem,
  AgentEventSelectionItem,
  UsageSummarySelectionItem,
  PolicyDecisionSelectionItem,
  ApprovalRecordSelectionItem,
  PolicyAuditSelectionItem,
} from '../evidenceSelection/types';

export function buildDeterministicPrompt(options: BuildPromptOptions): string {
  const sections: string[] = [];
  const selectedItems = options.selectedItems ?? [];

  // 1. Request section
  const trimmedRequest = options.additionalRequest?.trim();
  if (trimmedRequest) {
    sections.push(`## Request\n\n${trimmedRequest}`);
  }

  // 2. Repository Changes section
  const repoFiles = selectedItems.filter(
    (item): item is RepositoryFileSelectionItem => item.kind === 'repository-file',
  );
  const repoAttributions = selectedItems.filter(
    (item): item is RepositoryAttributionSelectionItem => item.kind === 'repository-attribution',
  );

  if (repoFiles.length > 0 || repoAttributions.length > 0) {
    const repoLines: string[] = ['## Repository Changes\n'];

    if (options.repositoryRoot) {
      repoLines.push(`Repository root: \`${options.repositoryRoot}\`\n`);
    }

    if (repoFiles.length > 0) {
      for (const file of repoFiles) {
        let tag = 'M';
        if (file.status === 'modified') tag = 'M';
        else if (file.status === 'added') tag = 'A';
        else if (file.status === 'deleted') tag = 'D';
        else if (file.status === 'renamed') tag = 'R';
        else if (file.status === 'untracked') tag = '??';
        else if (file.status) tag = file.status.toUpperCase();

        let pathStr = file.path;
        if (file.previousPath) {
          pathStr += ` (renamed from ${file.previousPath})`;
        }

        const numstatParts: string[] = [];
        if (file.binary) {
          numstatParts.push('binary');
        } else {
          if (file.insertions !== undefined) numstatParts.push(`+${file.insertions}`);
          if (file.deletions !== undefined) numstatParts.push(`-${file.deletions}`);
        }
        const numstatStr = numstatParts.length > 0 ? ` (${numstatParts.join(' / ')})` : '';

        repoLines.push(`- ${tag} ${pathStr}${numstatStr}`);
      }
      repoLines.push('');
    }

    if (repoAttributions.length > 0) {
      repoLines.push('Attributed deltas:');
      for (const attr of repoAttributions) {
        repoLines.push(
          `- Target: \`${attr.targetId}\` — ${attr.filesChangedCount} files changed (+${attr.totalInsertions}, -${attr.totalDeletions})`,
        );
        if (attr.summary) {
          repoLines.push(`  Summary: ${attr.summary}`);
        }
      }
      repoLines.push('');
    }

    sections.push(repoLines.join('\n').trim());
  }

  // 3. Executions section
  const executions = selectedItems.filter(
    (item): item is ExecutionSelectionItem => item.kind === 'execution',
  );

  if (executions.length > 0) {
    const execLines: string[] = ['## Executions\n'];

    for (const exec of executions) {
      execLines.push(`Command: ${exec.command}`);
      if (exec.cwd) {
        execLines.push(`Working directory: ${exec.cwd}`);
      }
      if (exec.outcome) {
        execLines.push(`Outcome: ${exec.outcome}`);
      }
      if (exec.exitCode !== null && exec.exitCode !== undefined) {
        execLines.push(`Exit code: ${exec.exitCode}`);
      }
      if (exec.completedAt) {
        execLines.push(`Completed at: ${new Date(exec.completedAt).toISOString()}`);
      }
      if (exec.structuredSummary) {
        execLines.push(`Summary: ${exec.structuredSummary}`);
      }
      if (exec.outputSnippet && exec.outputSnippet.trim().length > 0) {
        execLines.push('```text');
        execLines.push(exec.outputSnippet.trim());
        execLines.push('```');
      }
      execLines.push('');
    }

    sections.push(execLines.join('\n').trim());
  }

  // 4. Verification section
  const verifications = selectedItems.filter(
    (item): item is VerificationResultSelectionItem => item.kind === 'verification-result',
  );

  if (verifications.length > 0) {
    const verLines: string[] = ['## Verification\n'];

    for (const v of verifications) {
      if (v.status) {
        verLines.push(`Status: ${v.status}`);
      }
      if (v.label) {
        verLines.push(`Criterion: ${v.label}`);
      }
      if (v.command) {
        verLines.push(`Command: ${v.command}`);
      }
      if (v.observedExitCode !== null && v.observedExitCode !== undefined) {
        verLines.push(`Exit code: ${v.observedExitCode}`);
      }
      if (v.message) {
        verLines.push(`Details: ${v.message}`);
      }
      verLines.push('');
    }

    sections.push(verLines.join('\n').trim());
  }

  // 5. Structured Evidence section
  const structuredItems = selectedItems.filter(
    (item): item is StructuredEvidenceSelectionItem => item.kind === 'structured-evidence',
  );

  if (structuredItems.length > 0) {
    const structLines: string[] = ['## Structured Evidence\n'];

    for (const s of structuredItems) {
      structLines.push(
        `- **${s.tool.toUpperCase()}** [${s.status.toUpperCase()}]: ${s.summary}`,
      );
    }

    sections.push(structLines.join('\n').trim());
  }

  // 6. Agent Activity section (if any)
  const agentEvents = selectedItems.filter(
    (item): item is AgentEventSelectionItem => item.kind === 'agent-event',
  );

  if (agentEvents.length > 0) {
    const agentLines: string[] = ['## Agent Activity\n'];

    for (const evt of agentEvents) {
      // Use clean summary without raw JSON
      const summaryText = evt.summary.startsWith('[')
        ? evt.summary
        : evt.summary;
      agentLines.push(`- ${summaryText}`);
    }

    sections.push(agentLines.join('\n').trim());
  }

  // 7. Usage & Cost section (if selected)
  const usageItems = selectedItems.filter(
    (item): item is UsageSummarySelectionItem => item.kind === 'usage-summary',
  );

  if (usageItems.length > 0) {
    const usageLines: string[] = ['## Usage & Cost\n'];
    for (const u of usageItems) {
      usageLines.push(`Provider: ${u.provider}`);
      if (u.model) usageLines.push(`Model: ${u.model}`);
      if (u.inputTokens !== undefined) usageLines.push(`Input tokens: ${u.inputTokens.toLocaleString()}`);
      if (u.outputTokens !== undefined) usageLines.push(`Output tokens: ${u.outputTokens.toLocaleString()}`);
      usageLines.push(`Total tokens: ${u.totalTokens.toLocaleString()}`);
      if (u.calculatedCost !== undefined) {
        usageLines.push(`Calculated cost: $${u.calculatedCost.toFixed(4)}`);
      }
      usageLines.push('');
    }
    sections.push(usageLines.join('\n').trim());
  }

  // 8. Policy & Approvals section (if selected)
  const policyItems = selectedItems.filter(
    (item): item is PolicyDecisionSelectionItem | ApprovalRecordSelectionItem =>
      item.kind === 'policy-decision' || item.kind === 'approval-record',
  );

  if (policyItems.length > 0) {
    const policyLines: string[] = ['## Policy & Approvals\n'];
    for (const item of policyItems) {
      if (item.kind === 'policy-decision') {
        const actionDesc = item.command ? `\`${item.command}\`` : item.filePath ? `\`${item.filePath}\`` : item.toolName || 'action';
        policyLines.push(`- Policy Decision [${item.effect.toUpperCase()}]: ${actionDesc} (${item.reason || 'Evaluated by workspace policy'})`);
      } else {
        const actionDesc = item.command ? `\`${item.command}\`` : item.filePath ? `\`${item.filePath}\`` : item.toolName || 'action';
        const actorDesc = item.resolvedByActorId ? ` by ${item.resolvedByActorId}` : '';
        policyLines.push(`- Approval Record [${item.status.toUpperCase()}]: ${actionDesc}${actorDesc} (${item.reason || item.comment || 'Approval status: ' + item.status})`);
      }
    }
    sections.push(policyLines.join('\n').trim());
  }

  // 9. Policy & Governance Audit section (if selected)
  const auditItems = selectedItems.filter(
    (item): item is PolicyAuditSelectionItem => item.kind === 'policy-audit',
  );

  if (auditItems.length > 0) {
    const auditLines: string[] = ['## Policy & Governance\n'];
    for (const item of auditItems) {
      const actionDesc = item.command ? `\`${item.command}\`` : item.filePath ? `\`${item.filePath}\`` : 'action';
      if (item.shellType) auditLines.push(`- Shell: ${item.shellType}`);
      auditLines.push(`- Coverage: ${item.governanceCoverage}`);
      auditLines.push(`- Request: ${actionDesc}`);
      if (item.decision) auditLines.push(`- Decision: ${item.decision}`);
      if (item.approvalStatus) auditLines.push(`- Resolution: ${item.approvalStatus}`);
      if (item.warningCodes && item.warningCodes.length > 0) {
        auditLines.push(`- Warning: ${item.warningCodes.join(', ')}`);
      }
      if (item.reason) auditLines.push(`- Reason: ${item.reason}`);
      auditLines.push('');
    }
    sections.push(auditLines.join('\n').trim());
  }

  return sections.join('\n\n');
}
