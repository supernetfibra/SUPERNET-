/**
 * Instrumentation — catches runtime errors and reports to Vly.
 *
 * Does NOT use a React ErrorBoundary. React 19's concurrent rendering
 * can produce transient "removeChild" DOMExceptions during route transitions
 * that are harmless — an ErrorBoundary would try to unmount the tree in
 * response, which creates cascading errors. Instead we only listen to
 * window-level error events for logging/reporting.
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
// Instrumentation Provider
// ---------------------------------------------------------------------------

export function InstrumentationProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error("[Instrumentation]", event.message);
      reportToVly(event.message, event.error?.stack);
      // DO NOT call setState or manipulate the DOM here —
      // that would trigger re-renders during a broken commit phase.
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

  // No ErrorBoundary here — just render children directly.
  return <>{children}</>;
}

export default InstrumentationProvider;
