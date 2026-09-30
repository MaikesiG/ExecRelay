/**
 * TraceRelay / CapTerm Structured Evidence Engine & Parser Registry
 *
 * Coordinates deterministic parsing of finalized Execution EvidenceBlocks
 * into derived StructuredEngineeringEvidence records.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Parsers are executed strictly on finalized evidence.
 * 2. Parsers are deterministic, side-effect free, and isolated in try/catch.
 * 3. Parser exceptions MUST NOT corrupt Execution or Verification state.
 * 4. Derived evidence never overrides authoritative process exit code or outcome.
 * 5. Every output record references its canonical executionId and sourceEvidenceBlockIds.
 */

import type { EvidenceBlock, Execution } from '../execution/types';
import type {
  EngineeringEvidenceParseContext,
  EngineeringEvidenceParser,
  StructuredEngineeringEvidence,
} from './types';
import { jestParser } from './parsers/jestParser';
import { vitestParser } from './parsers/vitestParser';
import { pytestParser } from './parsers/pytestParser';
import { cargoTestParser } from './parsers/cargoTestParser';
import { tscParser } from './parsers/tscParser';

/**
 * Ordered parser registry.
 * Specific test framework parsers take precedence over general fallback parsers.
 */
export const DEFAULT_PARSER_REGISTRY: EngineeringEvidenceParser[] = [
  jestParser,
  vitestParser,
  pytestParser,
  cargoTestParser,
  tscParser,
];

/**
 * Builds an EngineeringEvidenceParseContext from an Execution and its EvidenceBlocks.
 */
export function buildParseContext(
  execution: Execution,
  blocks: EvidenceBlock[] = [],
): EngineeringEvidenceParseContext {
  const effectiveBlocks =
    blocks.length > 0
      ? blocks
      : execution.evidenceBlocks && execution.evidenceBlocks.length > 0
        ? execution.evidenceBlocks
        : [];

  const rawPieces: string[] = [];
  const displayPieces: string[] = [];

  for (const block of effectiveBlocks) {
    if (block.type === 'output' || block.type === 'error') {
      if (block.rawText) rawPieces.push(block.rawText);
      if (block.displayText) displayPieces.push(block.displayText);
    }
  }

  const rawText = rawPieces.join('\n');
  const displayText = displayPieces.join('\n');

  return {
    execution,
    command: execution.command ?? execution.rawCommand ?? '',
    evidenceBlocks: effectiveBlocks,
    rawText,
    displayText,
  };
}

/**
 * Runs registered parsers over the execution context and collects structured evidence.
 *
 * Guarantees:
 * - Deterministic output order.
 * - Conflicting test summaries are avoided by prioritizing the first matching test framework.
 * - Complete exception isolation: parser failure returns an empty result for that parser without crashing.
 */
export function parseEngineeringEvidence(
  context: EngineeringEvidenceParseContext,
  parsers: EngineeringEvidenceParser[] = DEFAULT_PARSER_REGISTRY,
): StructuredEngineeringEvidence[] {
  const results: StructuredEngineeringEvidence[] = [];
  let hasTestSummary = false;

  for (const parser of parsers) {
    try {
      if (!parser.canParse(context)) {
        continue;
      }

      const parsedRecords = parser.parse(context);
      if (!parsedRecords || parsedRecords.length === 0) {
        continue;
      }

      for (const record of parsedRecords) {
        // Enforce single primary test-summary per execution to prevent conflicting frameworks
        if (record.type === 'test-summary') {
          if (hasTestSummary) {
            continue;
          }
          hasTestSummary = true;
        }

        results.push(record);
      }
    } catch (err) {
      // Intentional safety barrier: parser exceptions must never propagate to corrupt execution
      console.warn(
        `[StructuredEvidenceEngine] Parser '${parser.id}' failed safely on execution '${context.execution.id}':`,
        err,
      );
    }
  }

  return results;
}
