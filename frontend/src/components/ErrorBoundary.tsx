import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/* Last-resort safety net: without this, ANY uncaught render error anywhere in the
   app (a malformed API response, a bad prop, a library throwing) unmounts the
   entire React tree and leaves a blank white page with nothing but a browser
   console error - confirmed live: an invalid email on registration produced
   exactly that ("Objects are not valid as a React child"), with zero visible
   indication to the user that anything had gone wrong.

   This does not replace fixing the underlying bug (see apiErrorMessage.ts and
   main.py's RequestValidationError handler for the actual fix to THIS crash) -
   it exists for whatever the next unexpected one is, so it degrades to a
   recoverable screen instead of a silent blank one. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error caught by ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen w-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-amber-500" />
            </div>
            <h1 className="text-xl font-bold text-text-primary mb-2">Something went wrong</h1>
            <p className="text-sm text-text-secondary mb-6">
              This page ran into an unexpected error. Your work elsewhere in the app is safe - try reloading.
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.href = '/'; }}
              className="btn-primary"
            >
              Reload the app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
