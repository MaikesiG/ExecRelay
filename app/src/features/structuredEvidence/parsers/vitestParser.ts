import type {
  EngineeringEvidenceParseContext,
  EngineeringEvidenceParser,
  StructuredEngineeringEvidence,
  TestSummaryEvidence,
} from '../types';
import { stripAnsiAndControl } from '../../transcript/transcriptFormat';

export const VITEST_PARSER_ID = 'vitest-parser';
export const VITEST_PARSER_VERSION = '1.0.0';

/**
 * Deterministic parser for Vitest test runner summaries.
 */
export const vitestParser: EngineeringEvidenceParser = {
  id: VITEST_PARSER_ID,
  version: VITEST_PARSER_VERSION,

  canParse(context: EngineeringEvidenceParseContext): boolean {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const cmd = context.command.toLowerCase();

    const hasVitestCmd = cmd.includes('vitest');
    const hasVitestSignature =
      /Test Files\s+/.test(clean) && /Tests\s+/.test(clean);

    return hasVitestCmd ? (/Test Files\s+|Tests\s+/.test(clean)) : hasVitestSignature;
  },

  parse(context: EngineeringEvidenceParseContext): StructuredEngineeringEvidence[] {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const sourceEvidenceBlockIds = context.evidenceBlocks.map((b) => b.id);

    // 1. Parse Test Files (suites)
    // e.g., "Test Files  2 passed (2)"
    // or:   "Test Files  1 failed | 3 passed (4)"
    let suitesTotal: number | undefined;
    let suitesPassed: number | undefined;
    let suitesFailed: number | undefined;

    const filesMatch = clean.match(/Test Files\s+([^\n]+)/);
    if (filesMatch) {
      const line = filesMatch[1];
      const passedM = line.match(/(\d+)\s+passed/);
      const failedM = line.match(/(\d+)\s+failed/);
      const totalM = line.match(/\((\d+)\)/);

      if (passedM) suitesPassed = parseInt(passedM[1], 10);
      if (failedM) suitesFailed = parseInt(failedM[1], 10);
      if (totalM) {
        suitesTotal = parseInt(totalM[1], 10);
      } else if (suitesPassed !== undefined || suitesFailed !== undefined) {
        suitesTotal = (suitesPassed ?? 0) + (suitesFailed ?? 0);
      }
    }

    // 2. Parse Tests
    // e.g., "Tests  18 passed (18)"
    // or:   "Tests  2 failed | 1 skipped | 15 passed (18)"
    let total: number | undefined;
    let passed: number | undefined;
    let failed: number | undefined;
    let skipped: number | undefined;

    const testsMatch = clean.match(/Tests\s+([^\n]+)/);
    if (testsMatch) {
      const line = testsMatch[1];
      const passedM = line.match(/(\d+)\s+passed/);
      const failedM = line.match(/(\d+)\s+failed/);
      const skippedM = line.match(/(\d+)\s+skipped/);
      const totalM = line.match(/\((\d+)\)/);

      if (passedM) passed = parseInt(passedM[1], 10);
      if (failedM) failed = parseInt(failedM[1], 10);
      if (skippedM) skipped = parseInt(skippedM[1], 10);
      if (totalM) {
        total = parseInt(totalM[1], 10);
      } else if (passed !== undefined || failed !== undefined || skipped !== undefined) {
        total = (passed ?? 0) + (failed ?? 0) + (skipped ?? 0);
      }
    }

    // 3. Parse Duration
    // e.g., "Duration  1.42s" or "Duration  450ms"
    let durationMs: number | undefined;
    const durMatch = clean.match(/Duration\s+([0-9.]+)\s*(s|ms)/i);
    if (durMatch) {
      const val = parseFloat(durMatch[1]);
      const unit = durMatch[2].toLowerCase();
      durationMs = unit === 's' ? Math.round(val * 1000) : Math.round(val);
    }

    if (
      total === undefined &&
      passed === undefined &&
      failed === undefined &&
      suitesTotal === undefined
    ) {
      return [];
    }

    const testSummary: TestSummaryEvidence = {
      id: `${context.execution.id}-vitest-${Math.random().toString(36).slice(2, 6)}`,
      executionId: context.execution.id,
      type: 'test-summary',
      framework: 'vitest',
      parserId: VITEST_PARSER_ID,
      parserVersion: VITEST_PARSER_VERSION,
      sourceEvidenceBlockIds,
      createdAt: Date.now(),
      total,
      passed,
      failed,
      skipped,
      suitesTotal,
      suitesPassed,
      suitesFailed,
      durationMs,
    };

    return [testSummary];
  },
};
