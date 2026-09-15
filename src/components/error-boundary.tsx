/**
 * ErrorBoundary — Catches JavaScript errors in child components and renders
 * a fallback UI instead of crashing the entire app.
 *
 * Usage:
 *   <ErrorBoundary fallback={<CustomFallback />}>
 *     <MyComponent />
 *   </ErrorBoundary>
 */

import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-[40vh] px-4">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm font-medium text-foreground">
              Algo deu errado
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Ocorreu um erro inesperado. Tente recarregar a página.
            </p>
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={this.handleReset}
              >
                <RefreshCw className="h-3 w-3 mr-1.5" />
                Tentar novamente
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={() => window.location.reload()}
              >
                Recarregar página
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
