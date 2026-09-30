/**
 * Prompt Composer types
 */

import type { EvidenceSelectionItem } from '../evidenceSelection/types';
import type { ResolvedEvidenceItem } from '../evidenceSelection/resolvedEvidenceTypes';

export interface BuildPromptOptions {
  additionalRequest?: string;
  selectedItems?: EvidenceSelectionItem[];
  resolvedItems?: ResolvedEvidenceItem[];
  repositoryRoot?: string;
  workspaceName?: string;
}

export interface PromptComposerProps {
  isOpen: boolean;
  selectedItems: EvidenceSelectionItem[];
  repositoryRoot?: string;
  workspaceName?: string;
  onClose: () => void;
  onCopySuccess?: (message: string) => void;
}
