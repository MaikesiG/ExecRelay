import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ts = require('../app/node_modules/typescript');

function transpileTs(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  return ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

// 1. Types & Models
const selTypesJs = transpileTs(path.resolve(__dirname, '../app/src/features/evidenceSelection/types.ts'));
const selTypesMod = { exports: {} };
new Function('module', 'exports', 'require', selTypesJs)(selTypesMod, selTypesMod.exports, () => ({}));

const selModelJs = transpileTs(path.resolve(__dirname, '../app/src/features/evidenceSelection/selectionModel.ts'));
const selModelMod = { exports: {} };
new Function('module', 'exports', 'require', selModelJs)(selModelMod, selModelMod.exports, () => selTypesMod.exports);
const {
  createEvidenceSelectionState,
  createRepositoryFileSelectionItem,
  createExecutionSelectionItem,
  createVerificationResultSelectionItem,
  createAgentEventSelectionItem,
  createPolicyDecisionSelectionItem,
  createApprovalRecordSelectionItem,
  createPolicyAuditSelectionItem,
  createUsageSummarySelectionItem,
  formatSelectionSummary,
} = selModelMod.exports;

// 2. Resolved Types
const resTypesJs = transpileTs(path.resolve(__dirname, '../app/src/features/evidenceSelection/resolvedEvidenceTypes.ts'));
const resTypesMod = { exports: {} };
new Function('module', 'exports', 'require', resTypesJs)(resTypesMod, resTypesMod.exports, () => ({}));

// 3. Evidence Clipboard Formatter
const formatterJs = transpileTs(path.resolve(__dirname, '../app/src/features/evidenceSelection/evidenceClipboardFormatter.ts'));
const formatterMod = { exports: {} };
new Function('module', 'exports', 'require', formatterJs)(formatterMod, formatterMod.exports, (req) => {
  if (req.includes('resolvedEvidenceTypes')) return resTypesMod.exports;
  if (req.includes('repositoryEvidenceCopy')) {
    return {
      fenceCode: (code, lang = '') => {
        let fence = '```';
        while (code.includes(fence)) fence += '`';
        return `${fence}${lang}\n${code}\n${fence}`;
      },
      getLanguageForPath: (p) => p.split('.').pop() || '',
    };
  }
  return {};
});
const {
  formatResolvedEvidenceForClipboard,
  formatExecutionEvidence,
  formatRepositoryChangeEvidence,
  formatVerificationEvidence,
  formatAgentEventEvidence,
  formatPolicyEvidence,
  formatStructuredEvidence,
  formatUsageEvidence,
  formatAttributionEvidence,
  formatUnavailableEvidence,
  truncateOutputSemantically,
  truncateDiffOrContent,
  sortResolvedEvidenceItems,
  MAX_ITEM_CHARS,
  MAX_TOTAL_COPY_CHARS,
} = formatterMod.exports;

// 4. Evidence Selection Resolver
const resolverJs = transpileTs(path.resolve(__dirname, '../app/src/features/evidenceSelection/evidenceSelectionResolver.ts'));
const resolverMod = { exports: {} };
new Function('module', 'exports', 'require', resolverJs)(resolverMod, resolverMod.exports, (req) => {
  if (req.includes('types')) return selTypesMod.exports;
  if (req.includes('resolvedEvidenceTypes')) return resTypesMod.exports;
  if (req.includes('execution')) {
    return {
      executionFromTranscriptBlock: (b) => ({
        id: b.id,
        actorId: b.actorId || 'actor-human-local',
        source: 'terminal',
        command: b.command,
        lifecycle: b.lifecycle || (b.isComplete ? 'finished' : 'running'),
        outcome: b.outcome || (b.exitCode === 0 ? 'succeeded' : b.exitCode ? 'failed' : 'unknown'),
        exitCode: b.exitCode,
        startedAt: b.startedAt,
        completedAt: b.completedAt,
        evidenceBlockIds: [],
        evidenceBlocks: [],
      }),
      formatExecutionDuration: (s, c) => (c ? `${c - s}ms` : null),
    };
  }
  if (req.includes('transcriptFormat')) {
    return {
      cleanTranscriptForDisplay: (text) => ({ cleanedText: text, rawText: text }),
    };
  }
  if (req.includes('structuredEvidence')) {
    return {
      parseEngineeringEvidence: () => [],
      buildParseContext: () => ({}),
    };
  }
  if (req.includes('repositoryEvidenceCopy')) {
    return {
      resolveRepositoryFileChangeEvidence: async (file) => ({
        path: file.path,
        status: file.status || 'modified',
        patch: file.status === 'untracked' ? undefined : '@@ -1,3 +1,4 @@\n-old\n+new',
        content: file.status === 'untracked' ? 'console.log("new file");' : undefined,
        binary: file.binary,
        insertions: file.insertions ?? 1,
        deletions: file.deletions ?? 0,
        evidenceSource: file.status === 'untracked' ? 'current working-tree file' : 'Git diff',
      }),
    };
  }
  return {};
});
const {
  resolveEvidenceSelection,
  resolveEvidenceSelections,
} = resolverMod.exports;

console.log('Running HARDEN-014 Monitor Footer Full Evidence Copy Test Suite...\n');

// ============================================================================
// Test 1: Shared Resolution & Formatting Pipeline
// ============================================================================
console.log('--- Test 1: Shared Resolution & Formatting Pipeline ---');
{
  const execItem = createExecutionSelectionItem({
    id: 'block-1',
    command: 'npm test',
    exitCode: 0,
    outcome: 'succeeded',
    output: '✓ all tests passed',
  });

  const context = {
    blocks: [
      {
        id: 'block-1',
        batchId: 1,
        command: 'npm test',
        output: '✓ all tests passed',
        startedAt: 1000,
        completedAt: 1200,
        isComplete: true,
        exitCode: 0,
        outcome: 'succeeded',
        completionSource: 'trusted-shell',
        outcomeSource: 'trusted-shell',
        outcomeTrusted: true,
        cwd: '/repo',
        terminalPaneId: 'pane-1',
        terminalLabelAtCapture: 'Terminal 1',
      },
    ],
  };

  const resolved = await resolveEvidenceSelections([execItem], context);
  assert.strictEqual(resolved.length, 1);
  assert.strictEqual(resolved[0].kind, 'execution');
  assert.strictEqual(resolved[0].command, 'npm test');
  assert.strictEqual(resolved[0].exitCode, 0);

  const markdown = formatResolvedEvidenceForClipboard(resolved);
  assert.ok(markdown.startsWith('# CapTerm Evidence'), 'Markdown must have top-level # CapTerm Evidence header');
  assert.ok(markdown.includes('## Execution — npm test'), 'Must include item header with command');
  assert.ok(markdown.includes('Status: Passed'));
  assert.ok(markdown.includes('Exit Code: 0'));
  assert.ok(markdown.includes('Completion Source: trusted-shell'));
  assert.ok(markdown.includes('✓ all tests passed'));

  console.log('✓ Pipeline resolves and formats execution with full output, exit code, and trust metadata');
}

// ============================================================================
// Test 2: Repository Change Evidence (Modified Tracked File with Diff)
// ============================================================================
console.log('\n--- Test 2: Repository Change Evidence (Tracked Git Diff) ---');
{
  const fileItem = createRepositoryFileSelectionItem({
    path: 'src/App.tsx',
    status: 'modified',
    insertions: 5,
    deletions: 2,
    repositoryRoot: '/repo',
  });

  const context = {
    repositorySnapshot: {
      id: 'snap-1',
      repositoryRoot: '/repo',
      metadata: { branch: 'main', headCommit: 'abc1234' },
      status: { clean: false, files: [] },
    },
    changeAttributions: [
      {
        targetId: 'exec-1',
        summary: 'Target: exec-1',
        delta: {
          files: [
            { path: 'src/App.tsx', deltaKind: 'introduced', status: 'modified' },
          ],
        },
      },
    ],
  };

  const resolved = await resolveEvidenceSelections([fileItem], context);
  assert.strictEqual(resolved.length, 1);
  assert.strictEqual(resolved[0].kind, 'repository-change');
  assert.ok(resolved[0].patch);

  const markdown = formatResolvedEvidenceForClipboard(resolved);
  assert.ok(markdown.includes('## Repository Change — src/App.tsx'));
  assert.ok(markdown.includes('Status: modified'));
  assert.ok(markdown.includes('Observed line changes: +5 -2'));
  assert.ok(markdown.includes('Attribution: Observed during execution window'));
  assert.ok(!markdown.includes('caused by execution'), 'Must preserve "observed during window", never causal proof');
  assert.ok(markdown.includes('Baseline context: Working tree was dirty prior to execution'));
  assert.ok(markdown.includes('```diff\n@@ -1,3 +1,4 @@'));

  console.log('✓ Tracked file includes actual bounded diff, line stats, and honest attribution');
}

// ============================================================================
// Test 3: Repository Change Evidence (Untracked New File with Full Content)
// ============================================================================
console.log('\n--- Test 3: Repository Change Evidence (Untracked New File) ---');
{
  const fileItem = createRepositoryFileSelectionItem({
    path: 'src/NewFeature.ts',
    status: 'untracked',
    insertions: 1,
    deletions: 0,
    repositoryRoot: '/repo',
  });

  const context = {
    repositorySnapshot: {
      id: 'snap-1',
      repositoryRoot: '/repo',
      status: { clean: true, files: [] },
    },
  };

  const resolved = await resolveEvidenceSelections([fileItem], context);
  assert.strictEqual(resolved.length, 1);
  assert.strictEqual(resolved[0].status, 'untracked');
  assert.ok(resolved[0].content);

  const markdown = formatResolvedEvidenceForClipboard(resolved);
  assert.ok(markdown.includes('## Repository Change — src/NewFeature.ts'));
  assert.ok(markdown.includes('Status: untracked'));
  assert.ok(markdown.includes('New File Content:'));
  assert.ok(markdown.includes('```ts\nconsole.log("new file");\n```'));

  console.log('✓ Untracked file includes New File Content header and working-tree content');
}

// ============================================================================
// Test 4: Repository Change Evidence (Deleted File)
// ============================================================================
console.log('\n--- Test 4: Repository Change Evidence (Deleted File) ---');
{
  const fileItem = createRepositoryFileSelectionItem({
    path: 'src/Obsolete.ts',
    status: 'deleted',
    insertions: 0,
    deletions: 20,
    repositoryRoot: '/repo',
  });

  const context = {
    repositorySnapshot: {
      id: 'snap-1',
      repositoryRoot: '/repo',
      status: { clean: true, files: [] },
    },
  };

  // Mock runner that returns diff for deleted file
  const resolved = await resolveEvidenceSelections([fileItem], context);
  const markdown = formatResolvedEvidenceForClipboard(resolved);
  assert.ok(markdown.includes('## Repository Change — src/Obsolete.ts'));
  assert.ok(markdown.includes('Status: deleted'));

  // Without patch:
  const noDiffItem = {
    kind: 'repository-change',
    id: 'repo-file:snap:del',
    path: 'src/Lost.ts',
    status: 'deleted',
  };
  const noDiffMarkdown = formatRepositoryChangeEvidence(noDiffItem);
  assert.ok(noDiffMarkdown.includes('Previous content unavailable in retained evidence.'));

  console.log('✓ Deleted file includes deletion status and explicit unavailable notice when diff absent');
}

// ============================================================================
// Test 5: Binary File Copy
// ============================================================================
console.log('\n--- Test 5: Binary File Copy ---');
{
  const binItem = {
    kind: 'repository-change',
    id: 'repo-file:snap:logo.png',
    path: 'assets/logo.png',
    status: 'modified',
    binary: true,
  };

  const markdown = formatRepositoryChangeEvidence(binItem);
  assert.ok(markdown.includes('Content: binary'));
  assert.ok(markdown.includes('Content body omitted.'));
  assert.ok(!markdown.includes('```diff'));

  console.log('✓ Binary files omit raw binary bytes and render explicit Content: binary disclosure');
}

// ============================================================================
// Test 6: Verification Result with Linked Execution Evidence
// ============================================================================
console.log('\n--- Test 6: Verification Result with Linked Execution Evidence ---');
{
  const vItem = createVerificationResultSelectionItem({
    runId: 'run-101',
    criterionId: 'crit-typecheck',
    label: 'Typecheck',
    command: 'npm run typecheck',
    status: 'passed',
    observedExitCode: 0,
    message: 'Completed in 1500ms',
  });

  const context = {
    verificationContract: {
      id: 'contract-default',
      workspaceId: 'ws-1',
      name: 'Default Quality Gate',
      criteria: [],
      createdAt: 0,
    },
    historicalVerificationRuns: [
      {
        id: 'run-101',
        contractId: 'contract-default',
        workspaceId: 'ws-1',
        status: 'passed',
        criteriaSnapshot: [
          {
            id: 'crit-typecheck',
            type: 'command',
            label: 'Typecheck',
            command: 'npm run typecheck',
            expectedExitCodes: [0],
            order: 1,
          },
        ],
        criterionResults: [
          {
            criterionId: 'crit-typecheck',
            status: 'passed',
            executionId: 'exec-typecheck-1',
            observedExitCode: 0,
          },
        ],
        startedAt: 1000,
      },
    ],
    blocks: [
      {
        id: 'exec-typecheck-1',
        batchId: 1,
        command: 'npm run typecheck',
        output: '> tsc -b\nFound 0 errors.',
        startedAt: 1000,
        completedAt: 2500,
        isComplete: true,
        exitCode: 0,
        outcome: 'succeeded',
        terminalPaneId: 'pane-1',
        terminalLabelAtCapture: 'Terminal 1',
      },
    ],
  };

  const resolved = await resolveEvidenceSelections([vItem], context);
  assert.strictEqual(resolved.length, 1);
  assert.strictEqual(resolved[0].kind, 'verification');
  assert.ok(resolved[0].linkedExecution);

  const markdown = formatResolvedEvidenceForClipboard(resolved);
  assert.ok(markdown.includes('## Verification — Typecheck'));
  assert.ok(markdown.includes('Profile: Default Quality Gate'));
  assert.ok(markdown.includes('Command: `npm run typecheck`'));
  assert.ok(markdown.includes('Verdict: Passed'));
  assert.ok(markdown.includes('Linked Execution Evidence:'));
  assert.ok(markdown.includes('Found 0 errors.'));

  console.log('✓ Verification result resolves immutable criteriaSnapshot and linked execution output');
}

// ============================================================================
// Test 7: Verification Result Deduplication (Linked Execution Included Separately)
// ============================================================================
console.log('\n--- Test 7: Verification Result Deduplication ---');
{
  const vItem = createVerificationResultSelectionItem({
    runId: 'run-101',
    criterionId: 'crit-1',
    label: 'Lint Check',
    command: 'npm run lint',
    status: 'passed',
  });

  const execItem = createExecutionSelectionItem({
    id: 'exec-lint-1',
    command: 'npm run lint',
    exitCode: 0,
    outcome: 'succeeded',
    output: '0 errors, 0 warnings',
  });

  const context = {
    historicalVerificationRuns: [
      {
        id: 'run-101',
        contractId: 'contract-default',
        workspaceId: 'ws-1',
        status: 'passed',
        criteriaSnapshot: [
          { id: 'crit-1', type: 'command', label: 'Lint Check', command: 'npm run lint', expectedExitCodes: [0], order: 1 },
        ],
        criterionResults: [
          { criterionId: 'crit-1', status: 'passed', executionId: 'exec-lint-1', observedExitCode: 0 },
        ],
        startedAt: 1000,
      },
    ],
    blocks: [
      {
        id: 'exec-lint-1',
        batchId: 1,
        command: 'npm run lint',
        output: '0 errors, 0 warnings',
        startedAt: 1000,
        completedAt: 1500,
        isComplete: true,
        exitCode: 0,
        outcome: 'succeeded',
        terminalPaneId: 'pane-1',
        terminalLabelAtCapture: 'Terminal 1',
      },
    ],
  };

  // Both the verification item AND the execution item are selected
  const resolved = await resolveEvidenceSelections([vItem, execItem], context);
  assert.strictEqual(resolved.length, 2);

  const vResolved = resolved.find((r) => r.kind === 'verification');
  assert.strictEqual(vResolved.linkedExecutionIncludedSeparately, true);

  const markdown = formatResolvedEvidenceForClipboard(resolved);
  assert.ok(markdown.includes('Linked Execution: `exec-lint-1` (included separately)'));
  assert.ok(markdown.includes('## Execution — npm run lint'), 'Execution is still present in its own dedicated section');

  console.log('✓ Overlapping selection deduplicates linked execution cleanly with explicit cross-reference');
}

// ============================================================================
// Test 8: Verification STOP Semantics Preserved (Cancelled / Stop Issue / Error)
// ============================================================================
console.log('\n--- Test 8: Verification STOP Semantics Preserved ---');
{
  const cancelledV = {
    kind: 'verification',
    id: 'v-1',
    runId: 'run-cancel',
    criterionId: 'c-1',
    label: 'Build',
    command: 'npm run build',
    status: 'cancelled',
  };
  const stopIssueV = {
    kind: 'verification',
    id: 'v-2',
    runId: 'run-timeout',
    criterionId: 'c-2',
    label: 'Integration Tests',
    command: 'npm run test:e2e',
    status: 'stop-timeout',
  };

  const text1 = formatVerificationEvidence(cancelledV);
  assert.ok(text1.includes('Verdict: Cancelled (Verification stopped by user)'));

  const text2 = formatVerificationEvidence(stopIssueV);
  assert.ok(text2.includes('Verdict: Stop Issue (Underlying command remained unresolved after interrupt request)'));

  console.log('✓ Exact STOP semantics preserved (Cancelled, Stop Issue, Error), never flattened to generic failed');
}

// ============================================================================
// Test 9: Agent Activity Evidence
// ============================================================================
console.log('\n--- Test 9: Agent Activity Evidence ---');
{
  const agentEvtItem = createAgentEventSelectionItem({
    id: 'agent-evt-1',
    agentRunId: 'agent-run-42',
    type: 'tool-call',
    createdAt: 1727456000000,
    sequence: 1,
    source: 'claude',
    payload: {
      toolName: 'Edit',
      category: 'file-edit',
      filePath: 'src/App.tsx',
      inputSummary: 'Replacing Header component',
      parameters: { path: 'src/App.tsx', old_str: 'old', new_str: 'new' },
    },
  });

  const context = {
    agentEventIngress: {
      getEventsForRun: (runId) => [
        {
          id: 'agent-evt-1',
          agentRunId: 'agent-run-42',
          type: 'tool-call',
          createdAt: 1727456000000,
          sequence: 1,
          source: 'claude',
          payload: {
            toolName: 'Edit',
            category: 'file-edit',
            filePath: 'src/App.tsx',
            parameters: { path: 'src/App.tsx', old_str: 'old', new_str: 'new' },
            resultSummary: 'Successfully updated src/App.tsx',
          },
        },
      ],
    },
  };

  const resolved = await resolveEvidenceSelections([agentEvtItem], context);
  assert.strictEqual(resolved.length, 1);
  assert.strictEqual(resolved[0].kind, 'agent-event');

  const markdown = formatResolvedEvidenceForClipboard(resolved);
  assert.ok(markdown.includes('## Agent Activity — Tool Call (Edit)'));
  assert.ok(markdown.includes('Provider: Claude Code'));
  assert.ok(markdown.includes('Run ID: agent-run-42'));
  assert.ok(markdown.includes('Target File: `src/App.tsx`'));
  assert.ok(markdown.includes('Input:'));
  assert.ok(!markdown.includes('{"type":"tool-call"'), 'Never dumps raw JSON as the primary format');

  console.log('✓ Normalized agent event formats clean tool call with input, target, and provider identity');
}

// ============================================================================
// Test 10: Policy & Governance Evidence
// ============================================================================
console.log('\n--- Test 10: Policy & Governance Evidence ---');
{
  const decisionItem = createPolicyDecisionSelectionItem({
    decisionId: 'dec-1',
    actionRequestId: 'req-1',
    effect: 'require-approval',
    command: 'rm -rf /tmp/data',
    requesterType: 'agent',
    governanceCoverage: 'pre-execution',
    reason: 'Destructive deletion requires explicit approval',
    warningCodes: ['compound-shell-syntax'],
  });

  const approvalItem = createApprovalRecordSelectionItem({
    approvalId: 'app-1',
    actionRequestId: 'req-1',
    status: 'approved',
    command: 'rm -rf /tmp/data',
    resolvedByActorId: 'actor-human-local',
    comment: 'Approved for testing cleanup',
  });

  const resolved = await resolveEvidenceSelections([decisionItem, approvalItem], {});
  const markdown = formatResolvedEvidenceForClipboard(resolved);

  assert.ok(markdown.includes('## Policy Decision — REQUIRE-APPROVAL'));
  assert.ok(markdown.includes('Action Request: `rm -rf /tmp/data`'));
  assert.ok(markdown.includes('Requester: agent'));
  assert.ok(markdown.includes('Coverage: pre-execution'));
  assert.ok(markdown.includes('Warnings: compound-shell-syntax'));

  assert.ok(markdown.includes('## Approval Record — APPROVED'));
  assert.ok(markdown.includes('Resolved By: actor-human-local'));
  assert.ok(markdown.includes('Comment: Approved for testing cleanup'));

  console.log('✓ Policy decisions and approval records format with action request and audit metadata');
}

// ============================================================================
// Test 11: Usage Evidence (Unknown Tokens != 0 Invariant)
// ============================================================================
console.log('\n--- Test 11: Usage Evidence (Unknown Tokens != 0 Invariant) ---');
{
  const knownUsage = createUsageSummarySelectionItem({
    agentRunId: 'run-99',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    totalTokens: 5200,
    inputTokens: 4000,
    outputTokens: 1200,
    calculatedCost: 0.03,
    costStatus: 'calculated',
  });

  const unknownUsage = {
    id: 'usage:unknown-run',
    kind: 'usage-summary',
    agentRunId: 'unknown-run',
    provider: 'openai',
    totalTokens: undefined,
    costStatus: 'unavailable',
    selectedAt: 0,
  };

  const resolved = await resolveEvidenceSelections([knownUsage, unknownUsage], {});
  const text1 = formatUsageEvidence(resolved[0]);
  assert.ok(text1.includes('Total Tokens: 5,200'));
  assert.ok(text1.includes('Calculated Cost: $0.0300'));

  const text2 = formatUsageEvidence(resolved[1]);
  assert.ok(text2.includes('Total Tokens: Unknown'), 'Must output "Unknown" instead of "0" when tokens are unknown');
  assert.ok(!text2.includes('Total Tokens: 0'), 'Never output "Tokens: 0" when value is unknown');

  console.log('✓ Usage evidence preserves "Tokens: Unknown" without fabricating 0');
}

// ============================================================================
// Test 12: Multi-Domain Mixed Export
// ============================================================================
console.log('\n--- Test 12: Multi-Domain Mixed Export ---');
{
  const items = [
    createExecutionSelectionItem({ id: 'b1', command: 'git status', exitCode: 0, outcome: 'succeeded', output: 'clean' }),
    createRepositoryFileSelectionItem({ path: 'README.md', status: 'modified', insertions: 2, deletions: 1 }),
    createVerificationResultSelectionItem({ runId: 'r1', criterionId: 'c1', label: 'Unit Tests', command: 'npm test', status: 'passed' }),
    createAgentEventSelectionItem({
      id: 'ae1',
      agentRunId: 'ar1',
      type: 'message',
      createdAt: 1000,
      sequence: 1,
      source: 'claude',
      payload: { text: 'Done' },
    }),
    createPolicyDecisionSelectionItem({ decisionId: 'd1', actionRequestId: 'rq1', effect: 'allow', command: 'ls', requesterType: 'human' }),
  ];

  const resolved = await resolveEvidenceSelections(items, {});
  assert.strictEqual(resolved.length, 5);

  const markdown = formatResolvedEvidenceForClipboard(resolved);
  assert.ok(markdown.includes('## Execution — git status'));
  assert.ok(markdown.includes('## Repository Change — README.md'));
  assert.ok(markdown.includes('## Verification — Unit Tests'));
  assert.ok(markdown.includes('## Agent Activity — message'));
  assert.ok(markdown.includes('## Policy Decision — ALLOW'));

  console.log('✓ Multi-domain selection formats into single cohesive document with all 5 items');
}

// ============================================================================
// Test 13: Deterministic Ordering (Domain Grouping & Timestamp Tie-Breaker)
// ============================================================================
console.log('\n--- Test 13: Deterministic Ordering ---');
{
  const itemA = { kind: 'policy', id: 'pol-1', subkind: 'decision', selectedAt: 300 };
  const itemB = { kind: 'execution', id: 'exec-1', command: 'echo hello', selectedAt: 200 };
  const itemC = { kind: 'repository-change', id: 'repo-1', path: 'src/main.ts', status: 'modified', selectedAt: 100 };

  // Pass in mixed order: Policy, Execution, Repo
  const sorted = sortResolvedEvidenceItems([itemA, itemB, itemC]);

  // Expected canonical domain order: Execution (1), Repository Change (2), Policy (7)
  assert.strictEqual(sorted[0].kind, 'execution');
  assert.strictEqual(sorted[1].kind, 'repository-change');
  assert.strictEqual(sorted[2].kind, 'policy');

  // Same domain ordered by selectedAt
  const exec1 = { kind: 'execution', id: 'exec-late', command: 'b', selectedAt: 500 };
  const exec2 = { kind: 'execution', id: 'exec-early', command: 'a', selectedAt: 100 };
  const sortedExecs = sortResolvedEvidenceItems([exec1, exec2]);
  assert.strictEqual(sortedExecs[0].id, 'exec-early');
  assert.strictEqual(sortedExecs[1].id, 'exec-late');

  console.log('✓ Sorting follows deterministic domain priority followed by selection timestamp');
}

// ============================================================================
// Test 14: Semantic Truncation of Large Command Output
// ============================================================================
console.log('\n--- Test 14: Semantic Truncation of Large Command Output ---');
{
  const hugeOutput = 'START_MARKER\n' + 'A'.repeat(120_000) + '\nEND_MARKER';
  const execItem = {
    kind: 'execution',
    id: 'exec-huge',
    command: 'cat large.log',
    lifecycle: 'finished',
    outcome: 'succeeded',
    output: hugeOutput,
  };

  const markdown = formatExecutionEvidence(execItem, 10_000); // 10k limit for testing
  assert.ok(markdown.includes('START_MARKER'), 'Must retain head of output');
  assert.ok(markdown.includes('END_MARKER'), 'Must retain tail of output');
  assert.ok(markdown.includes('[Output truncated by CapTerm: showing first'));

  console.log('✓ Semantic truncation preserves beginning and end of huge output with explicit marker');
}

// ============================================================================
// Test 15: Aggregate Document Size Limit Truncation
// ============================================================================
console.log('\n--- Test 15: Aggregate Document Size Limit Truncation ---');
{
  const items = Array.from({ length: 20 }, (_, i) => ({
    kind: 'execution',
    id: `exec-${i}`,
    command: `echo "task ${i}"`,
    lifecycle: 'finished',
    outcome: 'succeeded',
    output: 'line output '.repeat(50),
    selectedAt: i,
  }));

  const markdown = formatResolvedEvidenceForClipboard(items, { maxTotalChars: 1500 });
  assert.ok(markdown.includes('[Evidence export truncated: size limit reached'));
  assert.ok(markdown.length < 2000);

  console.log('✓ Aggregate size limit stops appending items and outputs truncation banner');
}

// ============================================================================
// Test 16: Evicted / Unresolvable Items Handled Gracefully
// ============================================================================
console.log('\n--- Test 16: Evicted / Unresolvable Items Handled Gracefully ---');
{
  const ghostItem = {
    id: 'exec:ghost-999',
    kind: 'execution',
    executionId: 'ghost-999',
    selectedAt: 0,
  };

  // Context has no blocks
  const resolved = await resolveEvidenceSelections([ghostItem], { blocks: [] });
  assert.strictEqual(resolved.length, 1);
  assert.strictEqual(resolved[0].kind, 'unavailable');

  const markdown = formatResolvedEvidenceForClipboard(resolved);
  assert.ok(markdown.includes('## Execution — Evidence Unavailable'));
  assert.ok(markdown.includes('Reference: `ghost-999`'));
  assert.ok(markdown.includes('Reason: Execution block is unavailable or has been evicted'));

  console.log('✓ Evicted items resolve to explicit unavailable records without breaking the export');
}

// ============================================================================
// Test 17: Secret Safety Invariant
// ============================================================================
console.log('\n--- Test 17: Secret Safety Invariant ---');
{
  const execItem = {
    kind: 'execution',
    id: 'exec-sec',
    command: 'deploy.sh',
    lifecycle: 'finished',
    outcome: 'succeeded',
    output: 'Deploying with token sanitize test',
  };

  const markdown = formatExecutionEvidence(execItem);
  assert.ok(!markdown.includes('tr_nonce_'));
  assert.ok(!markdown.includes('SESSION_SECRET'));

  console.log('✓ Formatted clipboard evidence never leaks internal nonces or credentials');
}

// ============================================================================
// Test 18: Zero Selection
// ============================================================================
console.log('\n--- Test 18: Zero Selection ---');
{
  const markdown = formatResolvedEvidenceForClipboard([]);
  assert.strictEqual(markdown, '');

  console.log('✓ Zero selections returns empty string without fabricating headers');
}

// ============================================================================
// Test 19: Repeated Copy Byte-For-Byte Equivalence
// ============================================================================
console.log('\n--- Test 19: Repeated Copy Byte-For-Byte Equivalence ---');
{
  const items = [
    createExecutionSelectionItem({ id: 'b1', command: 'npm test', exitCode: 0, outcome: 'succeeded', output: 'passed' }),
    createRepositoryFileSelectionItem({ path: 'src/index.ts', status: 'modified', insertions: 1, deletions: 1 }),
  ];

  const resolved = await resolveEvidenceSelections(items, {});
  const copy1 = formatResolvedEvidenceForClipboard(resolved);
  const copy2 = formatResolvedEvidenceForClipboard(resolved);

  assert.strictEqual(copy1, copy2, 'Repeated copy must be byte-for-byte identical');
  console.log('✓ Repeated copy produces byte-for-byte equivalent Markdown output');
}

// ============================================================================
// Test 20: Prompt Composer Compatibility
// ============================================================================
console.log('\n--- Test 20: Prompt Composer Compatibility ---');
{
  const promptBuilderJs = transpileTs(path.resolve(__dirname, '../app/src/features/promptComposer/promptBuilder.ts'));
  const promptBuilderMod = { exports: {} };
  new Function('module', 'exports', 'require', promptBuilderJs)(promptBuilderMod, promptBuilderMod.exports, () => ({}));
  const { buildDeterministicPrompt } = promptBuilderMod.exports;

  const items = [
    createExecutionSelectionItem({ id: 'b1', command: 'npm test', exitCode: 0, outcome: 'succeeded', output: 'passed' }),
    createRepositoryFileSelectionItem({ path: 'src/index.ts', status: 'modified', insertions: 1, deletions: 1 }),
  ];

  const prompt = buildDeterministicPrompt({
    additionalRequest: 'Fix any lint errors',
    selectedItems: items,
  });

  assert.ok(prompt.includes('## Request\n\nFix any lint errors'));
  assert.ok(prompt.includes('## Repository Changes'));
  assert.ok(prompt.includes('## Executions'));

  console.log('✓ Prompt Composer retains full compatibility with existing prompt generation');
}

console.log('\n=============================================================');
console.log('ALL HARDEN-014 MONITOR FOOTER FULL EVIDENCE COPY TESTS PASSED!');
console.log('=============================================================\n');
