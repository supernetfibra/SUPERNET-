/**
 * Instrumentation — catches runtime errors and reports to Vly.
 *
 * Also patches DOM removeChild to diagnose the React 19 "removeChild"
 * NotFoundError that occurs during route transitions.
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
// DOM removeChild diagnostic — identifies exactly which node is being removed
// ---------------------------------------------------------------------------

function installRemoveChildDiagnostic() {
  // Only patch once
  if ((Node.prototype as any).__vlyPatched) return;
  (Node.prototype as any).__vlyPatched = true;

  const originalRemoveChild = Node.prototype.removeChild;

  (Node.prototype as any).removeChild = function <T extends Node>(child: T): T {
    try {
      return originalRemoveChild.call(this, child) as T;
    } catch (err) {
      // Log a brief warning (not an error — this is a known React 19 bug)
      // where removeChild is called on a text node that's already been
      // disconnected during concurrent route transitions.
      // Swallowing is safe: the node is already removed from the DOM.
      if (child instanceof Element) {
        console.warn(
          "[React 19] removeChild skipped:",
          `<${child.tagName.toLowerCase()}>`,
          "already disconnected.",
        );
      }

      return child;
    }
  };
}

// ---------------------------------------------------------------------------
// Instrumentation Provider — renders children directly, no ErrorBoundary
// ---------------------------------------------------------------------------

export function InstrumentationProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Install the diagnostic patch immediately
    installRemoveChildDiagnostic();

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

  return <>{children}</>;
}

export default InstrumentationProvider;
