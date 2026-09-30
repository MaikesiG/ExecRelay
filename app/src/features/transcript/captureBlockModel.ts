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
  formatExecutionDuration,
  formatExecutionTimestamp,
  evidenceBlocksFromTranscriptBlock,
  type ErrorDetectionResult,
} from '../execution/executionModel';

export {
  detectErrorFromOutput,
  deriveExecutionState,
  deriveExecutionLifecycle,
  deriveExecutionOutcome,
  formatExecutionDuration,
  formatExecutionTimestamp,
  type ErrorDetectionResult,
};

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
