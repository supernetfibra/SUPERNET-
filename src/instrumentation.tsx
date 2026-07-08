/**
 * Simple error boundary and instrumentation.
 *
 * Uses a class-based ErrorBoundary to catch render-phase errors and
 * a plain DOM-overlay approach to display them — no portal-based dialogs,
 * no simultaneous error handlers, no risk of cascading re-renders.
 */

import React from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

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
// Pure DOM overlay (no React reconciliation conflicts)
// ---------------------------------------------------------------------------

function showErrorOverlay(message: string, stack: string) {
  // Remove any previous overlay
  document.getElementById("vly-error-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "vly-error-overlay";
  overlay.innerHTML = `
    <div style="
      position: fixed; inset: 0; z-index: 999999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.15); backdrop-filter: blur(4px);
    ">
      <div style="
        max-width: 90vw; width: 700px;
        background: var(--card); border: 1px solid var(--border);
        border-radius: 8px; padding: 24px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.12);
        font-family: system-ui, -apple-system, sans-serif;
        color: var(--foreground);
      ">
        <h2 style="font-size: 16px; font-weight: 600; margin: 0 0 4px; color: var(--destructive);">
          Runtime Error
        </h2>
        <p style="font-size: 13px; color: var(--muted-foreground); margin: 0 0 12px;">
          A runtime error occurred. You can dismiss this and continue, or open the editor to debug.
        </p>
        <p style="
          font-size: 12px; font-family: monospace;
          background: var(--secondary); padding: 8px 12px;
          border-radius: 4px; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis; margin: 0 0 12px;
        ">${escapeHtml(message)}</p>
        <details style="margin-bottom: 16px;">
          <summary style="font-size: 12px; cursor: pointer; color: var(--muted-foreground);">
            See error details
          </summary>
          <pre style="
            margin-top: 8px; padding: 12px; font-size: 11px;
            background: var(--foreground); color: var(--background);
            border-radius: 4px; overflow-x: auto; max-height: 200px;
            white-space: pre-wrap; word-break: break-all;
          ">${escapeHtml(stack)}</pre>
        </details>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button
            id="vly-dismiss-btn"
            style="
              padding: 6px 16px; font-size: 12px; border-radius: 4px;
              border: 1px solid var(--border); background: transparent;
              cursor: pointer; color: var(--foreground);
            "
          >Dismiss</button>
          <button
            id="vly-reload-btn"
            style="
              padding: 6px 16px; font-size: 12px; border-radius: 4px;
              border: none; background: var(--foreground);
              color: var(--background); cursor: pointer;
            "
          >Reload page</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("vly-dismiss-btn")?.addEventListener("click", () => {
    overlay.remove();
  });
  document.getElementById("vly-reload-btn")?.addEventListener("click", () => {
    window.location.reload();
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Error Boundary (class component — no hooks, no extra re-renders)
// ---------------------------------------------------------------------------

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    reportToVly(error.message, error.stack);
    // Show overlay using plain DOM — no React rendering to avoid reconciliation loops
    showErrorOverlay(error.message, error.stack || "");
  }

  render() {
    if (this.state.hasError) {
      // Render nothing — the overlay is shown as a DOM element outside React
      return null;
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Instrumentation Provider
// ---------------------------------------------------------------------------

export function InstrumentationProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    // Only report to Vly — don't show dialogs, let ErrorBoundary handle rendering errors
    const handleError = (event: ErrorEvent) => {
      console.error("[Instrumentation]", event.message);
      reportToVly(event.message, event.error?.stack);

      // DO NOT call setState here — that would trigger a re-render of the entire app
      // during a reconciler error, making the DOM collision worse.
      // The ErrorBoundary class component above handles the UI overlay.
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
