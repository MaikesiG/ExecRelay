/**
 * Monitor Footer Component
 * HARDEN-011: Fixed Monitor footer shared by surfaces 2–6 for EvidenceSelection actions.
 */

import { memo } from 'react';
import {
  formatSelectionSummary,
  type EvidenceSelectionState,
} from '../evidenceSelection';
import './MonitorFooter.css';

export interface MonitorFooterProps {
  selectionState: EvidenceSelectionState;
  totalSelectedCount: number;
  isCopied: boolean;
  onClear: () => void;
  onCopy: () => void;
  onCreatePrompt: () => void;
}

export const MonitorFooter = memo(function MonitorFooter({
  selectionState,
  totalSelectedCount,
  isCopied,
  onClear,
  onCopy,
  onCreatePrompt,
}: MonitorFooterProps) {
  if (totalSelectedCount === 0) {
    return null;
  }

  const summary = formatSelectionSummary(selectionState);

  return (
    <footer
      className='monitor-footer'
      role='toolbar'
      aria-label='Selected evidence actions'
    >
      <div className='monitor-footer-info'>
        <span className='monitor-footer-count'>
          {totalSelectedCount} selected
        </span>
        <span className='monitor-footer-summary' title={summary}>
          ({summary})
        </span>
      </div>
      <div className='monitor-footer-actions'>
        <button
          type='button'
          className='compact-btn monitor-footer-clear-btn'
          onClick={onClear}
          title='Clear all selected evidence'
        >
          Clear
        </button>
        <button
          type='button'
          className='compact-btn monitor-footer-copy-btn'
          onClick={onCopy}
          title='Copy selected evidence text'
        >
          {isCopied ? 'Copied' : 'Copy'}
        </button>
        <button
          type='button'
          className='compact-btn compact-btn--primary monitor-footer-prompt-btn'
          onClick={onCreatePrompt}
          title='Create AI prompt from selected evidence'
        >
          Create Prompt
        </button>
      </div>
    </footer>
  );
});
