import type {
  EngineeringEvidenceParseContext,
  EngineeringEvidenceParser,
  StructuredEngineeringEvidence,
  TestFailureEvidence,
  TestSummaryEvidence,
} from '../types';
import { stripAnsiAndControl } from '../../transcript/transcriptFormat';

export const JEST_PARSER_ID = 'jest-parser';
export const JEST_PARSER_VERSION = '1.0.0';

/**
 * Deterministic parser for Jest test runner summaries and failures.
 */
export const jestParser: EngineeringEvidenceParser = {
  id: JEST_PARSER_ID,
  version: JEST_PARSER_VERSION,

  canParse(context: EngineeringEvidenceParseContext): boolean {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const cmd = context.command.toLowerCase();

    // Must have Jest in the command, OR strong Jest output signatures.
    // Generic words like 'PASS' or 'FAILED' alone are strictly rejected.
    const hasJestCmd = cmd.includes('jest');
    const hasJestSignature =
      /Test Suites:\s+/.test(clean) && /Tests:\s+/.test(clean);

    return hasJestCmd ? (/Test Suites:\s+|Tests:\s+/.test(clean)) : hasJestSignature;
  },

  parse(context: EngineeringEvidenceParseContext): StructuredEngineeringEvidence[] {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const sourceEvidenceBlockIds = context.evidenceBlocks.map((b) => b.id);

    // 1. Parse Test Suites
    // e.g., "Test Suites: 1 failed, 23 passed, 24 total"
    let suitesTotal: number | undefined;
    let suitesPassed: number | undefined;
    let suitesFailed: number | undefined;

    const suitesMatch = clean.match(/Test Suites:\s+([^\n]+)/);
    if (suitesMatch) {
      const line = suitesMatch[1];
      const passedM = line.match(/(\d+)\s+passed/);
      const failedM = line.match(/(\d+)\s+failed/);
      const totalM = line.match(/(\d+)\s+total/);

      if (passedM) suitesPassed = parseInt(passedM[1], 10);
      if (failedM) suitesFailed = parseInt(failedM[1], 10);
      if (totalM) suitesTotal = parseInt(totalM[1], 10);
    }

    // 2. Parse Tests
    // e.g., "Tests:       2 failed, 3 skipped, 187 passed, 192 total"
    // or:   "Tests:       187 passed, 187 total"
    // or:   "Tests:       1 todo, 2 skipped, 10 passed, 13 total"
    let total: number | undefined;
    let passed: number | undefined;
    let failed: number | undefined;
    let skipped: number | undefined;
    let todo: number | undefined;

    const testsMatch = clean.match(/Tests:\s+([^\n]+)/);
    if (testsMatch) {
      const line = testsMatch[1];
      const passedM = line.match(/(\d+)\s+passed/);
      const failedM = line.match(/(\d+)\s+failed/);
      const skippedM = line.match(/(\d+)\s+skipped/);
      const todoM = line.match(/(\d+)\s+todo/);
      const totalM = line.match(/(\d+)\s+total/);

      if (passedM) passed = parseInt(passedM[1], 10);
      if (failedM) failed = parseInt(failedM[1], 10);
      if (skippedM) skipped = parseInt(skippedM[1], 10);
      if (todoM) todo = parseInt(todoM[1], 10);
      if (totalM) total = parseInt(totalM[1], 10);
    }

    // 3. Parse Duration
    // e.g., "Time:        8.234 s" or "Time: 450 ms"
    let durationMs: number | undefined;
    const timeMatch = clean.match(/Time:\s+([0-9.]+)\s*(s|ms)/i);
    if (timeMatch) {
      const val = parseFloat(timeMatch[1]);
      const unit = timeMatch[2].toLowerCase();
      durationMs = unit === 's' ? Math.round(val * 1000) : Math.round(val);
    }

    // 4. Parse Failed Test Names
    // e.g., "  ● Auth > expires session after 30m"
    const failedTests: TestFailureEvidence[] = [];
    const failureHeaderRegex = /^\s*●\s+([^\n]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = failureHeaderRegex.exec(clean)) !== null) {
      const rawName = match[1].trim();
      if (rawName) {
        // Check if it has suite > test format
        const parts = rawName.split('›').map((p) => p.trim());
        if (parts.length > 1) {
          failedTests.push({
            suite: parts.slice(0, -1).join(' › '),
            name: parts[parts.length - 1],
          });
        } else {
          failedTests.push({
            name: rawName,
          });
        }
      }
    }

    // If no suites or tests found, do not produce false summary
    if (
      total === undefined &&
      passed === undefined &&
      failed === undefined &&
      suitesTotal === undefined
    ) {
      return [];
    }

    const testSummary: TestSummaryEvidence = {
      id: `${context.execution.id}-jest-${Math.random().toString(36).slice(2, 6)}`,
      executionId: context.execution.id,
      type: 'test-summary',
      framework: 'jest',
      parserId: JEST_PARSER_ID,
      parserVersion: JEST_PARSER_VERSION,
      sourceEvidenceBlockIds,
      createdAt: Date.now(),
      total,
      passed,
      failed,
      skipped,
      todo,
      suitesTotal,
      suitesPassed,
      suitesFailed,
      durationMs,
      failedTests: failedTests.length > 0 ? failedTests : undefined,
    };

    return [testSummary];
  },
};
