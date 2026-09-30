import type {
  DiagnosticEvidence,
  DiagnosticSeverity,
  EngineeringEvidenceParseContext,
  EngineeringEvidenceParser,
  StructuredEngineeringEvidence,
  TypecheckSummaryEvidence,
} from '../types';
import { stripAnsiAndControl } from '../../transcript/transcriptFormat';

export const TSC_PARSER_ID = 'tsc-parser';
export const TSC_PARSER_VERSION = '1.0.0';

/**
 * Regex matching standard TypeScript compiler diagnostics:
 * Form A: src/auth.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.
 * Form B: src/auth.ts:42:7 - error TS2322: Type 'string' is not assignable to type 'number'.
 */
const TSC_DIAGNOSTIC_REGEX =
  /^(?<file>[^\s():]+)(?:\((?<lineA>\d+),(?<colA>\d+)\):?|:(?<lineB>\d+):(?<colB>\d+))\s*(?:-\s*)?(?<severity>error|warning|info)\s+(?<code>TS\d+):\s*(?<message>.+)$/i;

/**
 * Deterministic parser for TypeScript compiler diagnostics and summary counts.
 */
export const tscParser: EngineeringEvidenceParser = {
  id: TSC_PARSER_ID,
  version: TSC_PARSER_VERSION,

  canParse(context: EngineeringEvidenceParseContext): boolean {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const cmd = context.command.toLowerCase();

    // Check for TS diagnostic pattern in output
    const lines = clean.split('\n');
    let hasTsDiagnostic = false;
    for (const line of lines) {
      if (TSC_DIAGNOSTIC_REGEX.test(line.trim())) {
        hasTsDiagnostic = true;
        break;
      }
    }

    if (hasTsDiagnostic) return true;

    // Or command explicitly invokes tsc or typecheck and output has "Found X errors"
    const hasTscCmd =
      cmd.includes('tsc') ||
      cmd.includes('typecheck') ||
      cmd.includes('tsc -b') ||
      cmd.includes('typescript');

    return hasTscCmd && /Found \d+ error/i.test(clean);
  },

  parse(context: EngineeringEvidenceParseContext): StructuredEngineeringEvidence[] {
    const clean = stripAnsiAndControl(context.displayText || context.rawText);
    const sourceEvidenceBlockIds = context.evidenceBlocks.map((b) => b.id);
    const lines = clean.split('\n');

    const diagnostics: DiagnosticEvidence[] = [];
    let diagIndex = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(TSC_DIAGNOSTIC_REGEX);
      if (match && match.groups) {
        const file = match.groups.file;
        const lineNumStr = match.groups.lineA ?? match.groups.lineB;
        const colNumStr = match.groups.colA ?? match.groups.colB;
        const rawSev = (match.groups.severity ?? 'error').toLowerCase();
        const code = match.groups.code;
        const message = match.groups.message.trim();

        const severity: DiagnosticSeverity =
          rawSev === 'warning' ? 'warning' : rawSev === 'info' ? 'info' : 'error';

        diagIndex += 1;
        diagnostics.push({
          id: `${context.execution.id}-tsc-diag-${diagIndex}`,
          executionId: context.execution.id,
          type: 'diagnostic',
          tool: 'typescript',
          severity,
          message,
          file,
          line: lineNumStr ? parseInt(lineNumStr, 10) : undefined,
          column: colNumStr ? parseInt(colNumStr, 10) : undefined,
          code,
          parserId: TSC_PARSER_ID,
          parserVersion: TSC_PARSER_VERSION,
          sourceEvidenceBlockIds,
          createdAt: Date.now(),
        });
      }
    }

    // Also check for total summary: e.g. "Found 12 errors in 3 files."
    let errorCount = diagnostics.filter((d) => d.severity === 'error').length;
    let warningCount = diagnostics.filter((d) => d.severity === 'warning').length;

    const summaryMatch = clean.match(/Found\s+(\d+)\s+errors?(?:\s+and\s+(\d+)\s+warnings?)?/i);
    if (summaryMatch) {
      const explicitErrors = parseInt(summaryMatch[1], 10);
      if (!isNaN(explicitErrors)) {
        errorCount = Math.max(errorCount, explicitErrors);
      }
      if (summaryMatch[2]) {
        const explicitWarnings = parseInt(summaryMatch[2], 10);
        if (!isNaN(explicitWarnings)) {
          warningCount = Math.max(warningCount, explicitWarnings);
        }
      }
    }

    const results: StructuredEngineeringEvidence[] = [...diagnostics];

    if (errorCount > 0 || warningCount > 0 || diagnostics.length > 0) {
      const typecheckSummary: TypecheckSummaryEvidence = {
        id: `${context.execution.id}-tsc-summary-${Math.random().toString(36).slice(2, 6)}`,
        executionId: context.execution.id,
        type: 'typecheck-summary',
        tool: 'typescript',
        parserId: TSC_PARSER_ID,
        parserVersion: TSC_PARSER_VERSION,
        sourceEvidenceBlockIds,
        createdAt: Date.now(),
        errorCount,
        warningCount,
      };
      results.unshift(typecheckSummary);
    }

    return results;
  },
};
