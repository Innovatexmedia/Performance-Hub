import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('App render error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-ink-50 p-6 text-center">
          <div className="max-w-md rounded-2xl border border-ink-200 bg-white p-8 shadow-soft">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-2xl">⚠️</div>
            <h1 className="text-lg font-bold text-ink-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-ink-500">The app hit an unexpected error. Reloading usually fixes it. If it keeps happening, please contact support.</p>
            <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-ink-50 p-3 text-left text-xs text-red-600">{this.state.error.message}</pre>
            <div className="mt-5 flex justify-center gap-2">
              <button onClick={() => window.location.reload()} className="btn-primary">Reload</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}