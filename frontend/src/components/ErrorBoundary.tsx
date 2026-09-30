// Purpose: React error boundary that shows a recoverable fallback screen instead of a blank page when rendering crashes.
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
  // Holds the caught error; null means everything rendered fine.
  state: State = { error: null };

  // React calls this when a child throws during render; storing the error switches render() to the fallback UI.
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  // Logs the error and the component stack to the console for debugging.
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error caught by ErrorBoundary:', error, info.componentStack);
  }

  // Shows the fallback screen if an error was caught (Reload resets state and goes to '/'), otherwise renders children normally.
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
