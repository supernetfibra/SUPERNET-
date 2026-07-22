/**
 * SmoothAppear — Wraps lazy-loaded page content to fade/slide in smoothly
 * when React.Suspense swaps from the fallback (skeleton) to the real component.
 *
 * Without this, the swap is instant (frame N = skeleton, frame N+1 = content),
 * creating a jarring "flash". SmoothAppear starts at opacity 0 and transitions
 * to opacity 1 + translateY(0) over 250ms, so the eye sees a gentle reveal.
 *
 * Uses CSS transitions triggered by a requestAnimationFrame double-buffer so
 * the initial render has opacity 0, then instantly becomes visible.
 */

import { useEffect, useState, type ReactNode } from "react";

interface SmoothAppearProps {
  children: ReactNode;
  /** Duration in ms (default 250) */
  duration?: number;
  /** Vertical offset in px (default 8) */
  offset?: number;
}

export function SmoothAppear({
  children,
  duration = 250,
  offset = 8,
}: SmoothAppearProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // requestAnimationFrame creates a double-buffer: first paint is opacity 0,
    // then on the next frame we set visible = true which triggers the transition.
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : `translateY(${offset}px)`,
        transition: `opacity ${duration}ms ease-out, transform ${duration}ms ease-out`,
      }}
    >
      {children}
    </div>
  );
}
