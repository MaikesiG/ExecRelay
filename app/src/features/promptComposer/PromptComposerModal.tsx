import { useState, useMemo, useCallback } from 'react';
import type { PromptComposerProps } from './types';
import { buildDeterministicPrompt } from './promptBuilder';
import { copyToClipboard } from '../transcript/transcriptFormat';
import { formatSelectionSummary } from '../evidenceSelection';
import './PromptComposer.css';

export function PromptComposerModal({
  isOpen,
  selectedItems,
  repositoryRoot,
  workspaceName,
  onClose,
  onCopySuccess,
}: PromptComposerProps) {
  const [additionalRequest, setAdditionalRequest] = useState('');
  const [copied, setCopied] = useState(false);

  // Group selection items into a temporary selection state to format summary
  const summaryText = useMemo(() => {
    return formatSelectionSummary({
      items: new Map(selectedItems.map((i) => [i.id, i])),
      updatedAt: 0,
    });
  }, [selectedItems]);

  const generatedPrompt = useMemo(() => {
    return buildDeterministicPrompt({
      additionalRequest,
      selectedItems,
      repositoryRoot,
      workspaceName,
    });
  }, [additionalRequest, selectedItems, repositoryRoot, workspaceName]);

  const handleCopy = useCallback(async () => {
    if (!generatedPrompt) return;
    try {
      await copyToClipboard(generatedPrompt);
      setCopied(true);
      onCopySuccess?.('Copied prompt');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback handled by copyToClipboard
    }
  }, [generatedPrompt, onCopySuccess]);

  if (!isOpen) return null;

  return (
    <div
      className="prompt-composer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-composer-title"
    >
      <div
        className="prompt-composer-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="prompt-composer-header">
          <div className="prompt-composer-title-group">
            <span className="prompt-composer-icon" aria-hidden="true">
              📝
            </span>
            <h2 id="prompt-composer-title" className="prompt-composer-title">
              Create Prompt
            </h2>
          </div>
          <button
            type="button"
            className="compact-icon-btn prompt-composer-close-btn"
            onClick={onClose}
            aria-label="Close prompt composer"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="prompt-composer-body">
          {/* Selected Context Summary */}
          <div className="prompt-composer-context-card">
            <span className="prompt-composer-label">Selected Context</span>
            <div className="prompt-composer-summary-row">
              <span className="prompt-composer-badge">
                {selectedItems.length} {selectedItems.length === 1 ? 'item' : 'items'}
              </span>
              <span className="prompt-composer-summary-text">{summaryText}</span>
            </div>
          </div>

          {/* Additional Request Input */}
          <div className="prompt-composer-section">
            <label
              htmlFor="prompt-additional-request"
              className="prompt-composer-label"
            >
              Additional Request
            </label>
            <textarea
              id="prompt-additional-request"
              className="prompt-composer-textarea"
              placeholder="Review these changes and identify why authentication tests fail..."
              value={additionalRequest}
              onChange={(e) => setAdditionalRequest(e.target.value)}
              rows={3}
            />
          </div>

          {/* Generated Preview */}
          <div className="prompt-composer-section prompt-composer-preview-section">
            <div className="prompt-composer-preview-header">
              <span className="prompt-composer-label">Generated Prompt Preview</span>
              <span className="prompt-composer-preview-hint">Local deterministic generation</span>
            </div>
            <pre className="prompt-composer-preview-box">
              <code>{generatedPrompt || '(No evidence selected)'}</code>
            </pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="prompt-composer-footer">
          <div className="prompt-composer-footer-left">
            {/* Extensibility placeholder for future AI improvement */}
            <button
              type="button"
              className="compact-btn prompt-composer-ai-btn"
              disabled
              title="Future capability: Refine prompt with AI"
            >
              ✨ Improve with AI (Future)
            </button>
          </div>

          <div className="prompt-composer-footer-right">
            <button
              type="button"
              className="compact-btn prompt-composer-cancel-btn"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="compact-btn compact-btn--primary prompt-composer-copy-btn"
              onClick={handleCopy}
              disabled={!generatedPrompt}
              title="Copy composed prompt to clipboard"
            >
              {copied ? '✓ Copied' : 'Copy Prompt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
