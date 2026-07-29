import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary] Caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h2 style={{ color: 'var(--error)' }}>⚠️ 發生錯誤</h2>
          <p style={{ color: 'var(--text-light)', marginTop: '1rem' }}>
            {this.state.error?.message || '未知錯誤'}
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: '1.5rem' }}
            onClick={() => { this.setState({ hasError: false }); window.location.hash = ''; window.location.reload(); }}
          >
            🔄 重新開始
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
