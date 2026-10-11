import React from 'react';

export interface DerivedSurfaceErrorBoundaryProps {
  children: React.ReactNode;
  surfaceName?: string;
  panelId?: string;
  fallbackTitle?: string;
  onReset?: () => void;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

export interface DerivedSurfaceErrorBoundaryState {
  hasError: boolean;
}

export class DerivedSurfaceErrorBoundary extends React.Component<
  DerivedSurfaceErrorBoundaryProps,
  DerivedSurfaceErrorBoundaryState
> {
  constructor(props: DerivedSurfaceErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): DerivedSurfaceErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const label = this.props.surfaceName ?? this.props.panelId ?? 'derived surface';
    console.error(
      `[DerivedSurfaceErrorBoundary] Render failure caught in '${label}':`,
      error,
      info,
    );
    this.props.onError?.(error, info);
  }

  handleReset = (): void => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      const surface = this.props.surfaceName ?? (this.props.panelId ? `Panel ${this.props.panelId}` : null);
      const title =
        this.props.fallbackTitle ??
        (surface ? `${surface} encountered an error.` : 'This panel encountered an error.');
      const testId = `derived-error-${(surface ?? 'panel').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

      return (
        <div
          className="panel-error-fallback"
          role="alert"
          data-testid={testId}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
            padding: '24px',
            boxSizing: 'border-box',
            color: '#f87171',
            background: 'rgba(248, 113, 113, 0.04)',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: '20px', marginBottom: '8px' }} aria-hidden="true">
            ⚠
          </span>
          <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 500, color: '#fca5a5' }}>
            {title}
          </p>
          <button
            type="button"
            className="compact-btn"
            onClick={this.handleReset}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              borderRadius: '6px',
              cursor: 'pointer',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#e2e8f0',
              border: '1px solid rgba(255, 255, 255, 0.15)',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
