/**
 * Customer action logging — fire-and-forget.
 *
 * Logs payment-related actions (copied barcode, copied PIX, viewed PDF) to the
 * server audit log. The backend resolves the customer from the session cookie
 * and stores the event with rich metadata (billing id, reference, value).
 *
 * Safe by design: failures are swallowed (never blocks or errors the UI) and
 * rapid duplicate events for the same billing+action are coalesced so a
 * double-click doesn't flood the log.
 */

export type CustomerAction = "barcode_copied" | "pix_copied" | "pdf_viewed";

interface CustomerActionOptions {
  billingId?: string;
  reference?: string;
  value?: number;
}

// Coalescing window — the same (action, billingId) fired twice within this
// window is treated as a single event (guards against double-clicks).
const DEDUPE_WINDOW_MS = 2000;
const lastEvent = new Map<string, number>();

export function logCustomerAction(
  action: CustomerAction,
  opts: CustomerActionOptions = {}
): void {
  const dedupeKey = `${action}:${opts.billingId ?? ""}`;
  const now = Date.now();
  const last = lastEvent.get(dedupeKey);
  if (last && now - last < DEDUPE_WINDOW_MS) return;
  lastEvent.set(dedupeKey, now);

  // Skip immediately when offline — the fetch would fail anyway and the SW
  // wouldn't queue it reliably.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  fetch("/api/mikweb/action", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...opts }),
  }).catch(() => {
    // Fire-and-forget — ignore failures (offline, session expired, etc.)
  });
}
