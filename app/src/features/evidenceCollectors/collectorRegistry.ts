import type { EvidenceCollector } from './types';
import { gitMetadataCollector } from './parsers/gitMetadataCollector';
import { gitStatusCollector } from './parsers/gitStatusCollector';
import { gitDiffSummaryCollector } from './parsers/gitDiffSummaryCollector';

/**
 * Standard registry of available read-only evidence collectors.
 */
export const DEFAULT_COLLECTOR_REGISTRY: readonly EvidenceCollector[] = [
  gitMetadataCollector,
  gitStatusCollector,
  gitDiffSummaryCollector,
] as const;
