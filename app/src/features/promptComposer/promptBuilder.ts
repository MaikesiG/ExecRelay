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
        const trimmedSnippet = exec.outputSnippet.trim();
        const backtickMatches = trimmedSnippet.match(/`+/g);
        let maxBackticks = 0;
        if (backtickMatches) {
          for (const m of backtickMatches) {
            if (m.length > maxBackticks) {
              maxBackticks = m.length;
            }
          }
        }
        const fenceLength = Math.max(3, maxBackticks + 1);
        const fence = '`'.repeat(fenceLength);
        execLines.push(`${fence}text`);
        execLines.push(trimmedSnippet);
        execLines.push(fence);
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

  return sections.join('\n\n');
}
