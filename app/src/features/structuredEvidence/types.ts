/**
 * TraceRelay / CapTerm Structured Engineering Evidence Foundation
 *
 * Domain types for derived structured evidence (test summaries, compiler/linter diagnostics,
 * build summaries) extracted from canonical Execution EvidenceBlocks.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. StructuredEngineeringEvidence is DERIVED evidence; it interprets raw/clean evidence
 *    without replacing or mutating the authoritative Execution record.
 * 2. Parsed evidence never overrides trusted Execution outcome or Verification verdicts.
 * 3. Every structured evidence record MUST reference its canonical executionId and sourceEvidenceBlockIds.
 * 4. Unknown values MUST remain unknown; counts and fields are never fabricated.
 * 5. Parsers are deterministic, side-effect free, and versioned.
 */

import type { EvidenceBlock, Execution } from '../execution/types';

/* ========================================================================== */
/* Structured Evidence Domain Types                                           */
/* ========================================================================== */

export type StructuredEvidenceType =
  | 'test-summary'
  | 'diagnostic'
  | 'build-summary'
  | 'lint-summary'
  | 'typecheck-summary';

export interface StructuredEvidenceBase {
  /**
   * Unique ID of the structured evidence record.
   */
  id: string;

  /**
   * Canonical ID of the owning Execution.
   */
  executionId: string;

  /**
   * Type discriminator for the structured evidence record.
   */
  type: StructuredEvidenceType;

  /**
   * Identifier of the parser that produced this record (e.g. 'jest-parser').
   */
  parserId: string;

  /**
   * Version of the parser that produced this record (e.g. '1.0.0').
   */
  parserVersion: string;

  /**
   * Canonical IDs of the source EvidenceBlocks from which this evidence was derived.
   * Required for auditability and "[Show source evidence]" navigation.
   */
  sourceEvidenceBlockIds: string[];

  /**
   * Epoch timestamp when this structured evidence was derived.
   */
  createdAt: number;
}

/* ========================================================================== */
/* 1. Test Summary Evidence                                                   */
/* ========================================================================== */

export type TestFramework =
  | 'jest'
  | 'vitest'
  | 'pytest'
  | 'cargo-test'
  | 'unknown';

export interface TestFailureEvidence {
  name?: string;
  suite?: string;
  file?: string;
  line?: number;
  message?: string;
}

export interface TestSummaryEvidence extends StructuredEvidenceBase {
  type: 'test-summary';

  /**
   * Detected or reported test framework.
   */
  framework: TestFramework;

  /**
   * Total individual test count.
   */
  total?: number;

  /**
   * Passed test count.
   */
  passed?: number;

  /**
   * Failed test count.
   */
  failed?: number;

  /**
   * Skipped or pending test count.
   */
  skipped?: number;

  /**
   * Todo test count (if reported by framework).
   */
  todo?: number;

  /**
   * Total test suites / files count.
   */
  suitesTotal?: number;

  /**
   * Passed test suites count.
   */
  suitesPassed?: number;

  /**
   * Failed test suites count.
   */
  suitesFailed?: number;

  /**
   * Execution duration reported by test runner in milliseconds.
   */
  durationMs?: number;

  /**
   * List of specific test failures extracted from output.
   */
  failedTests?: TestFailureEvidence[];
}

/* ========================================================================== */
/* 2. Diagnostic Evidence (e.g. TypeScript, compiler, linter diagnostics)      */
/* ========================================================================== */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface DiagnosticEvidence extends StructuredEvidenceBase {
  type: 'diagnostic';

  /**
   * Originating tool or compiler (e.g. 'typescript', 'eslint').
   */
  tool: string;

  /**
   * Diagnostic severity level.
   */
  severity: DiagnosticSeverity;

  /**
   * Human-readable diagnostic message.
   */
  message: string;

  /**
   * File path referenced in the diagnostic.
   */
  file?: string;

  /**
   * 1-based line number.
   */
  line?: number;

  /**
   * 1-based column number.
   */
  column?: number;

  /**
   * Diagnostic error or rule code (e.g. 'TS2322', '@typescript-eslint/no-explicit-any').
   */
  code?: string;
}

/* ========================================================================== */
/* 3. Lightweight Summaries                                                   */
/* ========================================================================== */

export interface LintSummaryEvidence extends StructuredEvidenceBase {
  type: 'lint-summary';
  tool: string;
  errorCount?: number;
  warningCount?: number;
  fixableErrorCount?: number;
  fixableWarningCount?: number;
}

export interface TypecheckSummaryEvidence extends StructuredEvidenceBase {
  type: 'typecheck-summary';
  tool: string;
  errorCount?: number;
  warningCount?: number;
}

export interface BuildSummaryEvidence extends StructuredEvidenceBase {
  type: 'build-summary';
  tool: string;
  durationMs?: number;
  artifactCount?: number;
  diagnosticsCount?: number;
}

/* ========================================================================== */
/* Union & Parser Context Types                                               */
/* ========================================================================== */

export type StructuredEngineeringEvidence =
  | TestSummaryEvidence
  | DiagnosticEvidence
  | LintSummaryEvidence
  | TypecheckSummaryEvidence
  | BuildSummaryEvidence;

/**
 * Parsing context passed to each EngineeringEvidenceParser.
 */
export interface EngineeringEvidenceParseContext {
  /**
   * Canonical Execution being parsed.
   */
  execution: Execution;

  /**
   * Normalized command string executed.
   */
  command: string;

  /**
   * Constituent EvidenceBlocks belonging to this Execution.
   */
  evidenceBlocks: EvidenceBlock[];

  /**
   * Aggregated raw output text.
   */
  rawText: string;

  /**
   * Aggregated display/cleaned output text.
   */
  displayText: string;
}

/**
 * Deterministic, side-effect free parser interface.
 */
export interface EngineeringEvidenceParser {
  /**
   * Unique parser identifier (e.g. 'jest-parser', 'tsc-parser').
   */
  id: string;

  /**
   * Semantic version of the parser logic (e.g. '1.0.0').
   */
  version: string;

  /**
   * Fast signature check to determine if the parser can handle this execution.
   */
  canParse(context: EngineeringEvidenceParseContext): boolean;

  /**
   * Parses the finalized execution output and returns structured evidence records.
   * MUST be deterministic and never throw uncaught exceptions.
   */
  parse(context: EngineeringEvidenceParseContext): StructuredEngineeringEvidence[];
}

/* ========================================================================== */
/* Type Guards                                                                */
/* ========================================================================== */

export function isStructuredEvidenceType(value: unknown): value is StructuredEvidenceType {
  return (
    value === 'test-summary' ||
    value === 'diagnostic' ||
    value === 'build-summary' ||
    value === 'lint-summary' ||
    value === 'typecheck-summary'
  );
}

export function isStructuredEngineeringEvidence(
  value: unknown,
): value is StructuredEngineeringEvidence {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.executionId === 'string' &&
    isStructuredEvidenceType(s.type) &&
    typeof s.parserId === 'string' &&
    typeof s.parserVersion === 'string' &&
    Array.isArray(s.sourceEvidenceBlockIds) &&
    typeof s.createdAt === 'number'
  );
}

export function isTestSummaryEvidence(
  value: unknown,
): value is TestSummaryEvidence {
  return isStructuredEngineeringEvidence(value) && value.type === 'test-summary';
}

export function isDiagnosticEvidence(
  value: unknown,
): value is DiagnosticEvidence {
  return isStructuredEngineeringEvidence(value) && value.type === 'diagnostic';
}

export function isTypecheckSummaryEvidence(
  value: unknown,
): value is TypecheckSummaryEvidence {
  return isStructuredEngineeringEvidence(value) && value.type === 'typecheck-summary';
}

export function isLintSummaryEvidence(
  value: unknown,
): value is LintSummaryEvidence {
  return isStructuredEngineeringEvidence(value) && value.type === 'lint-summary';
}

export function isBuildSummaryEvidence(
  value: unknown,
): value is BuildSummaryEvidence {
  return isStructuredEngineeringEvidence(value) && value.type === 'build-summary';
}
