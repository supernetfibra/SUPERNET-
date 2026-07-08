/**
 * Instrumentation — catches runtime errors and reports to Vly.
 *
 * NOTE: We intentionally do NOT use an ErrorBoundary here. React 19 has a
 * known transient "removeChild" DOMError that occurs when framer-motion's
 * AnimatePresence (used by VlyToolbar) conflicts with React's concurrent
 * reconciliation during route transitions. React recovers from this
 * automatically. An ErrorBoundary would catch it and trigger re-renders,
 * which prevents the automatic recovery and causes cascading failures.
 */

import { type ReactNode, useEffect } from "react";

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
// Instrumentation Provider — renders children directly, no ErrorBoundary
// ---------------------------------------------------------------------------

export function InstrumentationProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // Log transient DOM errors but don't prevent React's recovery
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

  return <>{children}</>;
}

export default InstrumentationProvider;
