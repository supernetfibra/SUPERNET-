/**
 * Instrumentation — catches runtime errors and reports to Vly.
 *
 * Uses a minimal ErrorBoundary that catches render-phase errors but
 * CONTINUES rendering children (instead of rendering null). This prevents
 * cascading "removeChild" DOMErrors during Vite HMR, where Vite replaces
 * a module and React tries to reconcile against already-removed DOM nodes.
 */

import React from "react";

// ---------------------------------------------------------------------------
// Error reporting
// ---------------------------------------------------------------------------

async function reportToVly(message: string, stack?: string) {
  const appId = import.meta.env.VITE_VLY_APP_ID;
  if (!appId) return;
  try {
    await fetch(import.meta.env.VITE_VLY_MONITORING_URL, {
      method: "POST",
      body: JSON.stringify({
        error: message,
        stackTrace: stack,
        url: window.location.href,
        projectSemanticIdentifier: appId,
      }),
    });
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Error Boundary — logs but continues rendering children
// ---------------------------------------------------------------------------

type EBProps = { children: React.ReactNode };
type EBState = { hasError: boolean };

class ErrorBoundary extends React.Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error.message);
    reportToVly(error.message, error.stack);
    // Clear the error state after a tick so the next render re-tries children.
    // The "removeChild" error from HMR is transient — on the next commit cycle
    // the DOM is stable again and rendering succeeds.
    setTimeout(() => this.setState({ hasError: false }), 0);
  }

  render() {
    // Always render children — even after catching an error.
    // This prevents React from trying to unmount the tree (which would
    // trigger more "removeChild" errors if DOM nodes were already removed).
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Instrumentation Provider
// ---------------------------------------------------------------------------

export function InstrumentationProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error("[Instrumentation]", event.message);
      reportToVly(event.message, event.error?.stack);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error("[Instrumentation] Unhandled rejection:", event.reason);
      reportToVly(
        event.reason?.message || "Unhandled rejection",
        event.reason?.stack,
      );
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export default InstrumentationProvider;
