/**
 * usePullToRefresh — Shared hook for mobile pull-to-refresh gesture.
 *
 * Extracted from Invoices.tsx and Dashboard.tsx to eliminate duplication.
 * Provides touch event handlers, state, and a reusable PullIndicator
 * component that renders the animated pull-down indicator.
 */

import { useRef, useCallback, useState, useEffect, type ReactNode } from "react";
import { ArrowDown, RefreshCw } from "lucide-react";

interface UsePullToRefreshReturn {
  /** Spread onto the scroll container: ref + touch event handlers */
  pullContainerProps: {
    ref: React.RefObject<HTMLDivElement | null>;
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
  };
  pullDistance: number;
  isRefreshing: boolean;
  /** Render the pull indicator element at the top of the container */
  PullIndicator: () => ReactNode;
}

/**
 * Hook that manages pull-to-refresh gesture state.
 *
 * @param isLoading - External loading flag (from context). When it flips
 *   from true to false while a refresh is in progress, the indicator resets.
 * @param onRefresh - Called when the user pulls past the threshold and
 *   releases. Typically `refetch()` from BillingContext.
 */
export function usePullToRefresh(
  isLoading: boolean,
  onRefresh: () => void,
): UsePullToRefreshReturn {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const pullContainerRef = useRef<HTMLDivElement>(null);

  // When the actual loading flag goes back to false after a refresh,
  // reset the pull indicator.
  useEffect(() => {
    if (isRefreshing && !isLoading) {
      setIsRefreshing(false);
      setPullDistance(0);
    }
  }, [isLoading, isRefreshing]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY > 0) return; // only pull when scrolled to top
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isRefreshing) return;
      if (window.scrollY > 0) {
        setPullDistance(0);
        return;
      }
      const diff = e.touches[0].clientY - touchStartY.current;
      if (diff > 0) {
        // Apply resistance: pulling 100px feels like 40px
        setPullDistance(Math.min(diff * 0.4, 120));
      }
    },
    [isRefreshing],
  );

  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= 60 && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(60); // hold at indicator height while refreshing
      onRefresh();
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, onRefresh]);

  function PullIndicator() {
    return (
      <div
        className="absolute left-0 right-0 flex items-center justify-center overflow-hidden transition-all duration-200 ease-out z-10"
        style={{
          top: 0,
          height: pullDistance,
          opacity: Math.min(pullDistance / 40, 1),
        }}
      >
        <div
          className={`flex items-center gap-2 text-xs text-muted-foreground ${
            isRefreshing ? "animate-spin" : ""
          }`}
        >
          {isRefreshing ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown
              className="h-3.5 w-3.5 transition-transform"
              style={{ transform: `rotate(${pullDistance > 30 ? 180 : 0}deg)` }}
            />
          )}
          <span>
            {isRefreshing
              ? "Atualizando..."
              : pullDistance > 50
              ? "Solte para atualizar"
              : "Puxe para atualizar"}
          </span>
        </div>
      </div>
    );
  }

  return {
    pullContainerProps: {
      ref: pullContainerRef,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    pullDistance,
    isRefreshing,
    PullIndicator,
  };
}
