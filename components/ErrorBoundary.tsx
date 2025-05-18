import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // You can also log the error to an error reporting service
    console.error('[ERROR-BOUNDARY] Component error caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div className="p-4 m-4 bg-red-800/40 border border-red-600 rounded-lg text-white">
          <h2 className="text-xl font-bold text-red-300 mb-2">Something went wrong</h2>
          <p className="mb-2">The application encountered an error.</p>
          <details className="text-sm text-red-200 bg-red-900/50 p-2 rounded">
            <summary className="cursor-pointer">Error details</summary>
            <p className="mt-2 font-mono whitespace-pre-wrap">
              {this.state.error?.toString()}
            </p>
          </details>
          <button
            className="mt-4 px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded"
            onClick={() => window.location.reload()}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
} 