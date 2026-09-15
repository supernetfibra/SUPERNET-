/**
 * Logger — Conditional logging utility.
 *
 * In production, only errors are logged. In development, all levels are active.
 * This prevents console noise and info leaks in production while keeping
 * dev diagnostics available.
 */

const isDev =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

export const logger = {
  info: (...args: unknown[]) => {
    if (isDev) console.log("[INFO]", ...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn("[WARN]", ...args);
  },
  error: (...args: unknown[]) => {
    // Always log errors, even in production
    console.error("[ERROR]", ...args);
  },
  debug: (...args: unknown[]) => {
    if (isDev) console.debug("[DEBUG]", ...args);
  },
  /** Timing helper — logs how long an operation takes */
  time: (label: string, fn: () => void) => {
    if (!isDev) {
      fn();
      return;
    }
    const start = performance.now();
    fn();
    const elapsed = (performance.now() - start).toFixed(1);
    console.debug(`[PERF] ${label}: ${elapsed}ms`);
  },
};
