import type {
  EngineeringEvidenceParseContext,
  EngineeringEvidenceParser,
  StructuredEngineeringEvidence,
  TestFailureEvidence,
  TestSummaryEvidence,
} from '../types';
import { stripAnsiAndControl } from '../../transcript/transcriptFormat';

export const CARGO_TEST_PARSER_ID = 'cargo-test-parser';
export const CARGO_TEST_PARSER_VERSION = '1.0.0';

/**
 * Deterministic parser for Cargo / Rust test summaries.
 */
export const cargoTestParser: EngineeringEvidenceParser = {
  id: CARGO_TEST_PARSER_ID,
  version: CARGO_TEST_PARSER_VERSION,

  canParse(context: EngineeringEvidenceParseContext): boolean {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const cmd = context.command.toLowerCase();

    const hasCargoCmd = cmd.includes('cargo test') || cmd.includes('cargo nextest');
    const hasCargoSignature =
      /test result:\s+(?:ok|FAILED)\./i.test(clean) &&
      /\d+\s+passed;\s+\d+\s+failed/i.test(clean);

    return hasCargoCmd ? (/test result:\s+(?:ok|FAILED)/i.test(clean)) : hasCargoSignature;
  },

  parse(context: EngineeringEvidenceParseContext): StructuredEngineeringEvidence[] {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const sourceEvidenceBlockIds = context.evidenceBlocks.map((b) => b.id);

    // Signature line:
    // "test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s"
    // "test result: FAILED. 10 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.12s"
    const summaryRegex =
      /test result:\s+(?:ok|FAILED)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored;(?:\s+\d+\s+measured;)?(?:\s+\d+\s+filtered out;)?(?:\s+finished in\s+([0-9.]+)(s|ms))?/i;

    const match = clean.match(summaryRegex);
    if (!match) {
      return [];
    }

    const passed = parseInt(match[1], 10);
    const failed = parseInt(match[2], 10);
    const ignored = parseInt(match[3], 10);
    const total = passed + failed + ignored;

    let durationMs: number | undefined;
    if (match[4]) {
      const durVal = parseFloat(match[4]);
      const durUnit = (match[5] || 's').toLowerCase();
      durationMs = durUnit === 's' ? Math.round(durVal * 1000) : Math.round(durVal);
    }

    // Extract failure names if any
    // e.g. failures:
    //     tests::test_foo
    const failedTests: TestFailureEvidence[] = [];
    const failuresSectionMatch = clean.match(/failures:\s*\n((?:\s+[\w:_-]+\s*\n)+)/);
    if (failuresSectionMatch) {
      const lines = failuresSectionMatch[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('failures:')) {
          failedTests.push({
            name: trimmed,
          });
        }
      }
    }

    const testSummary: TestSummaryEvidence = {
      id: `${context.execution.id}-cargo-test-${Math.random().toString(36).slice(2, 6)}`,
      executionId: context.execution.id,
      type: 'test-summary',
      framework: 'cargo-test',
      parserId: CARGO_TEST_PARSER_ID,
      parserVersion: CARGO_TEST_PARSER_VERSION,
      sourceEvidenceBlockIds,
      createdAt: Date.now(),
      total,
      passed,
      failed,
      skipped: ignored,
      durationMs,
      failedTests: failedTests.length > 0 ? failedTests : undefined,
    };

    return [testSummary];
  },
};
