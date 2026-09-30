import type {
  EngineeringEvidenceParseContext,
  EngineeringEvidenceParser,
  StructuredEngineeringEvidence,
  TestFailureEvidence,
  TestSummaryEvidence,
} from '../types';
import { stripAnsiAndControl } from '../../transcript/transcriptFormat';

export const PYTEST_PARSER_ID = 'pytest-parser';
export const PYTEST_PARSER_VERSION = '1.0.0';

/**
 * Deterministic parser for Pytest test runner summaries.
 */
export const pytestParser: EngineeringEvidenceParser = {
  id: PYTEST_PARSER_ID,
  version: PYTEST_PARSER_VERSION,

  canParse(context: EngineeringEvidenceParseContext): boolean {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const cmd = context.command.toLowerCase();

    // Strong pytest summary line signature: e.g. "=== ... passed in 0.42s ===" or "=== ... failed in 0.12s ==="
    const hasPytestSignature =
      /={2,}\s+(?:[\w\s,]+)\s+in\s+[0-9.]+(?:s|ms)?\s+={2,}/i.test(clean) ||
      /={2,}\s+short test summary info\s+={2,}/i.test(clean);

    const hasPytestCmd =
      cmd.includes('pytest') ||
      cmd.includes('py.test') ||
      (cmd.includes('python') && cmd.includes('test'));

    // Reject standalone words like 'FAILED' or 'PASSED' without the signature or command
    return hasPytestCmd
      ? (/passed|failed|skipped/i.test(clean) && /in\s+[0-9.]+s/i.test(clean))
      : hasPytestSignature;
  },

  parse(context: EngineeringEvidenceParseContext): StructuredEngineeringEvidence[] {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const sourceEvidenceBlockIds = context.evidenceBlocks.map((b) => b.id);

    // Pytest summary regex: e.g. "=== 12 passed, 2 failed, 1 skipped in 4.56s ==="
    // or: "=== 42 passed in 1.23s ==="
    const summaryMatch = clean.match(
      /={2,}\s+([^\n=]+?)\s+in\s+([0-9.]+)(s|ms)?\s+={2,}/i,
    );

    let passed: number | undefined;
    let failed: number | undefined;
    let skipped: number | undefined;
    let total: number | undefined;
    let durationMs: number | undefined;

    if (summaryMatch) {
      const countsStr = summaryMatch[1];
      const durationVal = parseFloat(summaryMatch[2]);
      const durationUnit = (summaryMatch[3] || 's').toLowerCase();
      durationMs = durationUnit === 's' ? Math.round(durationVal * 1000) : Math.round(durationVal);

      const passedM = countsStr.match(/(\d+)\s+passed/i);
      const failedM = countsStr.match(/(\d+)\s+failed/i);
      const skippedM = countsStr.match(/(\d+)\s+skipped/i);

      if (passedM) passed = parseInt(passedM[1], 10);
      if (failedM) failed = parseInt(failedM[1], 10);
      if (skippedM) skipped = parseInt(skippedM[1], 10);

      total = (passed ?? 0) + (failed ?? 0) + (skipped ?? 0);
    } else {
      // Fallback for pytest summary without outer equals
      const passedM = clean.match(/(\d+)\s+passed(?:\s*,|\s+in\b)/i);
      const failedM = clean.match(/(\d+)\s+failed(?:\s*,|\s+in\b)/i);
      const skippedM = clean.match(/(\d+)\s+skipped(?:\s*,|\s+in\b)/i);

      if (passedM) passed = parseInt(passedM[1], 10);
      if (failedM) failed = parseInt(failedM[1], 10);
      if (skippedM) skipped = parseInt(skippedM[1], 10);

      if (passed !== undefined || failed !== undefined || skipped !== undefined) {
        total = (passed ?? 0) + (failed ?? 0) + (skipped ?? 0);
      }
    }

    // Extract failed test names from pytest output (deduplicated)
    // e.g. "FAILED tests/test_auth.py::test_session - AssertionError: ..."
    const failedTests: TestFailureEvidence[] = [];
    const seenFailures = new Set<string>();
    const failedLinesRegex = /^FAILED\s+([^:\s]+)::([^\s]+)(?:\s+-\s+(.+))?$/gm;
    let failMatch: RegExpExecArray | null;
    while ((failMatch = failedLinesRegex.exec(clean)) !== null) {
      const file = failMatch[1];
      const name = failMatch[2];
      const key = `${file}::${name}`;
      if (!seenFailures.has(key)) {
        seenFailures.add(key);
        failedTests.push({
          file,
          name,
          message: failMatch[3] ? failMatch[3].trim() : undefined,
        });
      }
    }

    if (passed === undefined && failed === undefined && skipped === undefined) {
      return [];
    }

    const testSummary: TestSummaryEvidence = {
      id: `${context.execution.id}-pytest-${Math.random().toString(36).slice(2, 6)}`,
      executionId: context.execution.id,
      type: 'test-summary',
      framework: 'pytest',
      parserId: PYTEST_PARSER_ID,
      parserVersion: PYTEST_PARSER_VERSION,
      sourceEvidenceBlockIds,
      createdAt: Date.now(),
      total,
      passed,
      failed,
      skipped,
      durationMs,
      failedTests: failedTests.length > 0 ? failedTests : undefined,
    };

    return [testSummary];
  },
};
