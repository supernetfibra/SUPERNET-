import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ExternalLink } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

type SyncError = {
  error: string;
  stack: string;
  filename: string;
  lineno: number;
  colno: number;
};

type AsyncError = {
  error: string;
  stack: string;
};

type GenericError = SyncError | AsyncError;

async function reportErrorToVly(errorData: {
  error: string;
  stackTrace?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}) {
  if (!import.meta.env.VITE_VLY_APP_ID) {
    return;
  }

  try {
    await fetch(import.meta.env.VITE_VLY_MONITORING_URL, {
      method: "POST",
      body: JSON.stringify({
        ...errorData,
        url: window.location.href,
        projectSemanticIdentifier: import.meta.env.VITE_VLY_APP_ID,
      }),
    });
  } catch (error) {
    console.error("Failed to report error to Vly:", error);
  }
}

function ErrorDialog({
  error,
  setError,
}: {
  error: GenericError;
  setError: (error: GenericError | null) => void;
}) {
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="relative max-w-4xl w-[90vw] rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mb-4">
          <h2 className="text-lg font-medium text-destructive">Runtime Error</h2>
          <p className="text-sm text-muted-foreground mt-1">
            A runtime error occurred. Open the editor to automatically debug the error.
          </p>
        </div>
        <p className="text-sm text-foreground font-mono bg-secondary/50 rounded-sm px-3 py-2 mb-4 truncate">
          {error.error}
        </p>
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className="h-3 w-3" />
            See error details
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 p-3 bg-foreground text-background rounded text-xs overflow-x-auto max-h-60 max-w-full [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <pre className="whitespace-pre-wrap break-all">{error.stack}</pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
          <a
            href={`https://freebuff.com/project/${import.meta.env.VITE_VLY_APP_ID}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" className="text-xs">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Open editor
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: GenericError | null;
};

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      error: {
        error: error.message,
        stack: error.stack || "",
      },
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportErrorToVly({
      error: error.message,
      stackTrace: error.stack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorDialog
          error={this.state.error || { error: "An error occurred", stack: "" }}
          setError={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}

export function InstrumentationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [error, setError] = useState<GenericError | null>(null);
  const isHandlingError = useRef(false);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // Prevent cascading errors — if we're already handling one, ignore
      if (isHandlingError.current) return;
      isHandlingError.current = true;

      try {
        console.error("[Instrumentation]", event.message);

        if (import.meta.env.VITE_VLY_APP_ID) {
          reportErrorToVly({
            error: event.message,
            stackTrace: event.error?.stack,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          });
        }

        setError({
          error: event.message,
          stack: event.error?.stack || "",
          filename: event.filename || "",
          lineno: event.lineno,
          colno: event.colno,
        });
      } catch (err) {
        console.error("Error in handleError:", err);
      } finally {
        // Reset the flag after a short delay to avoid rapid re-entry
        setTimeout(() => {
          isHandlingError.current = false;
        }, 1000);
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isHandlingError.current) return;
      isHandlingError.current = true;

      try {
        console.error("[Instrumentation] Unhandled rejection:", event.reason);

        if (import.meta.env.VITE_VLY_APP_ID) {
          reportErrorToVly({
            error: event.reason?.message || "Unhandled rejection",
            stackTrace: event.reason?.stack,
          });
        }

        setError({
          error: event.reason?.message || "Unhandled promise rejection",
          stack: event.reason?.stack || "",
        });
      } catch (err) {
        console.error("Error in handleRejection:", err);
      } finally {
        setTimeout(() => {
          isHandlingError.current = false;
        }, 1000);
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return (
    <>
      <ErrorBoundary>{children}</ErrorBoundary>
      {error && <ErrorDialog error={error} setError={setError} />}
    </>
  );
}
