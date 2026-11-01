/**
 * Capture Block Model & Execution Metadata
 *
 * Implements structured block decomposition, trustworthy error detection,
 * execution state tracking, and formatting helpers for captured terminal evidence.
 */

import type {
  StructuredCaptureBlock,
  TranscriptBlock,
} from './types';
import {
  detectErrorFromOutput,
  deriveExecutionState,
  deriveExecutionLifecycle,
  deriveExecutionOutcome,
  deriveEvidenceHealth,
  describeEvidenceHealth,
  formatExecutionDuration,
  formatExecutionTimestamp,
  evidenceBlocksFromTranscriptBlock,
  executionFromTranscriptBlock,
  withEvidenceIssue,
  type ErrorDetectionResult,
} from '../execution/executionModel';
import {
  parseEngineeringEvidence,
  buildParseContext,
} from '../structuredEvidence/parserEngine';
import type { StructuredEngineeringEvidence } from '../structuredEvidence/types';

export {
  detectErrorFromOutput,
  deriveExecutionState,
  deriveExecutionLifecycle,
  deriveExecutionOutcome,
  deriveEvidenceHealth,
  describeEvidenceHealth,
  formatExecutionDuration,
  formatExecutionTimestamp,
  type ErrorDetectionResult,
};

const derivedEvidenceCache = new WeakMap<TranscriptBlock, StructuredEngineeringEvidence[]>();

/**
 * Structured evidence for display, derived once per finalized block object.
 *
 * Derivation runs over the full output, so re-running it on every streaming flush or
 * panel re-mount blocks the main thread for seconds on large outputs and freezes the
 * workspace. Running blocks are not parsed (parsers run on finalized evidence only), and a
 * derivation failure yields no derived evidence while the raw output stays authoritative.
 */
export function deriveBlockStructuredEvidence(
  block: TranscriptBlock,
): StructuredEngineeringEvidence[] {
  if (block.structuredEvidence) return block.structuredEvidence;
  if (!block.isComplete) return [];
  if (!block.output && !block.rawOutput) return [];
  let evidence = derivedEvidenceCache.get(block);
  if (!evidence) {
    try {
      const exec = executionFromTranscriptBlock(block);
      evidence = parseEngineeringEvidence(buildParseContext(exec, exec.evidenceBlocks));
    } catch (err) {
      console.warn(`[CaptureBlockModel] Structured evidence derivation failed safely for block '${block.id}':`, err);
      evidence = [];
    }
    derivedEvidenceCache.set(block, evidence);
  }
  return evidence;
}

/**
 * Attaches derived evidence (EvidenceBlocks, structured evidence) to a block being finalized.
 *
 * Derived processing must never cost the execution its record: on failure the block keeps
 * its raw output, exit code and outcome, and records 'derived-evidence-failed' so its
 * evidence health reads as degraded instead of the derivation error being swallowed.
 */
export function attachDerivedEvidence(block: TranscriptBlock): void {
  try {
    const evidenceBlocks = evidenceBlocksFromTranscriptBlock(block);
    const exec = executionFromTranscriptBlock(block);
    const structured = parseEngineeringEvidence(buildParseContext(exec, evidenceBlocks));
    block.evidenceBlocks = evidenceBlocks;
    block.evidenceBlockIds = evidenceBlocks.map((b) => b.id);
    block.structuredEvidence = structured.length > 0 ? structured : undefined;
  } catch (err) {
    console.warn(`[CaptureBlockModel] Derived evidence failed for block '${block.id}'; raw evidence retained:`, err);
    block.evidenceIssues = withEvidenceIssue(block.evidenceIssues, 'derived-evidence-failed');
  }
}

/**
 * Decomposes a TranscriptBlock into an array of typed StructuredCaptureBlock slices.
 * Used for detailed inspection, copy operations, and future AI context construction.
 * Backed by the canonical EvidenceBlock decomposition.
 */
export function decomposeIntoStructuredBlocks(
  block: TranscriptBlock,
  showRaw: boolean = false,
): StructuredCaptureBlock[] {
  const evidenceBlocks = evidenceBlocksFromTranscriptBlock(block, showRaw);

  return evidenceBlocks.map((b) => ({
    id: b.id,
    type: b.type,
    commandId: b.executionId,
    rawText: b.rawText,
    displayText: b.displayText,
    createdAt: b.createdAt,
    executionState: block.executionState ?? deriveExecutionState(block),
    exitCode: b.exitCode ?? block.exitCode ?? null,
    isRawAvailable: true,
    cleanupApplied: b.cleanupApplied ?? false,
  }));
}
