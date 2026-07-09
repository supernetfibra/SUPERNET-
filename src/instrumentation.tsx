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
      // Log detailed diagnostic info about what was being removed
      const parent = this;
      const parentInfo =
        parent instanceof Element
          ? `<${parent.tagName.toLowerCase()}${parent.id ? ` id="${parent.id}"` : ""}${parent.className && typeof parent.className === "string" ? ` class="${String(parent.className).slice(0, 80)}"` : ""}>`
          : String(parent);
      const childInfo =
        child instanceof Element
          ? `<${child.tagName.toLowerCase()}${child.id ? ` id="${child.id}"` : ""}${child.className && typeof child.className === "string" ? ` class="${String(child.className).slice(0, 80)}"` : ""}>`
          : String(child);

      console.error(
        "[Vly Diagnostic] removeChild FAILED:",
        `\n  Parent: ${parentInfo}`,
        `\n  Child: ${childInfo}`,
        `\n  Child isConnected: ${child.isConnected}`,
        `\n  Parent contains child: ${"contains" in parent ? parent.contains(child) : "N/A"}`,
        `\n  URL: ${window.location.pathname}`,
        `\n  Parent outerHTML (first 300): ${parent instanceof Element ? parent.outerHTML.slice(0, 300) : "N/A"}`,
        `\n  Child outerHTML (first 300): ${child instanceof Element ? child.outerHTML.slice(0, 300) : "N/A"}`,
      );

      // Also report to Vly monitoring
      reportToVly(
        `removeChild FAILED: parent=${parentInfo} child=${childInfo} connected=${child.isConnected} url=${window.location.pathname}`,
      );

      throw err;
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
