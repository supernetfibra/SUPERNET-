/**
 * Billing Context — Centralized billing data provider.
 *
 * Fetches billings from the API once (not per component) and shares the
 * result via React context. Automatically refetches every 5 minutes while
 * the user is authenticated, so Dashboard, Invoices, and the sidebar badge
 * always show fresh data without redundant HTTP requests.
 *
 * Falls back to localStorage cache when the API is unreachable (offline).
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useAuth } from "./auth-context";
import { getTestBillings, isTestCpf } from "./test-user";

// ---------------------------------------------------------------------------
// Import billing types and helpers from billing-utils (shared, no circular dep)
// ---------------------------------------------------------------------------

import { CACHE_NAME } from "./cache-config";
import diagStore from "./diagnostics";

import {
  type BillingSummary,
  type RawBilling,
  mapBilling,
  saveToCache,
  loadFromCache,
} from "./billing-utils";

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

export interface BillingContextValue {
  billings: BillingSummary[];
  isLoading: boolean;
  error: string | null;
  isCached: boolean;
  cacheAge: number | null; // ms since last successful fetch, null if fresh
  refetch: () => void; // manually trigger a fresh fetch
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const BillingContext = createContext<BillingContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function BillingProvider({ children }: { children: ReactNode }) {
  const [billings, setBillings] = useState<BillingSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const [fetchTick, setFetchTick] = useState(0); // bump to trigger refetch

  const { customer } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Manual refetch — bumps the tick so the fetch effect re-runs */
  const refetch = useCallback(() => {
    setFetchTick((t) => t + 1);
  }, []);

  // -----------------------------------------------------------------------
  // Fetch billings whenever customer changes or refetch() is called
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function fetchBillings() {
      // If not authenticated yet, keep loading
      if (!customer) {
        if (!cancelled) {
          setBillings([]);
          setIsLoading(true);
        }
        return;
      }

      // ---- TEST USER - return mock data instantly ----
      if (customer.id.startsWith("test-") && isTestCpf(customer.cpf)) {
        const mockRaw = getTestBillings() as RawBilling[];
        const sorted = mockRaw.sort((a, b) => {
          const aVencido =
            a.situation_name === "Vencido" || a.situation_name === "Em Atraso";
          const bVencido =
            b.situation_name === "Vencido" || b.situation_name === "Em Atraso";
          if (aVencido && !bVencido) return -1;
          if (!aVencido && bVencido) return 1;
          return (b.due_day || "").localeCompare(a.due_day || "");
        });
        if (!cancelled) {
          setBillings(sorted.map(mapBilling));
          setIsCached(false);
          setCacheAge(null);
          setError(null);
          setIsLoading(false);
        }
        return;
      }
      // ---- END TEST USER ----

      try {
        setIsLoading(true);

        const response = await fetch("/api/mikweb/billings", {
          method: "GET",
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error("Erro ao buscar faturas.");
        }

        // Clone BEFORE reading the body — once consumed, clone() throws TypeError
        const swCacheClone = response.clone();

        const data = await response.json();

        if (!cancelled) {
          let mapped: BillingSummary[] = [];
          if (Array.isArray(data.billings)) {
            const isVencido = (s: string) =>
              s === "Vencido" || s === "Em Atraso";

            const sorted = (data.billings as RawBilling[]).sort((a, b) => {
              const aVencido = isVencido(a.situation_name || "");
              const bVencido = isVencido(b.situation_name || "");
              if (aVencido && !bVencido) return -1;
              if (!aVencido && bVencido) return 1;
              const dateA = a.due_day || "";
              const dateB = b.due_day || "";
              return dateB.localeCompare(dateA);
            });
            mapped = sorted.map(mapBilling);
          }

          // Save to localStorage for offline fallback (fast, immediate access)
          saveToCache(customer.id, mapped);

          // Also cache the raw HTTP response in the SW cache so the SW
          // can serve it even on the first visit (when SW may not be active).
          if ("caches" in window) {
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put("/api/mikweb/billings", swCacheClone))
              .catch(() => {});
          }

          // ── Diagnostic: push to store + console ──
          const customerTag = customer.id.slice(0, 12) + "...";

          if (mapped.length < 2) {
            console.warn(
              "[BILLING] Poucas faturas retornadas:",
              "count=" + mapped.length,
              "customer=" + customerTag,
            );
            diagStore.push({
              type: "api_few_billings",
              timestamp: Date.now(),
              customer: customerTag,
              count: mapped.length,
            });
          } else {
            const paidCount = mapped.filter((b) => b.status === "pago").length;
            if (paidCount === mapped.length) {
              const dates = mapped
                .map((b) => {
                  const [d, m, y] = b.vencimento.split("/").map(Number);
                  return d && m && y ? new Date(y, m - 1, d) : null;
                })
                .filter((d): d is Date => d !== null);
              if (dates.length > 0) {
                const newest = dates.reduce((a, b) =>
                  a.getTime() > b.getTime() ? a : b,
                );
                const daysSince =
                  (Date.now() - newest.getTime()) / (1000 * 60 * 60 * 24);
                console.warn(
                  "[BILLING] Todas as faturas estão pagas:",
                  "count=" + mapped.length,
                  "maisRecente=" + Math.round(daysSince) + "d atr\u00e1s",
                  "customer=" + customerTag,
                );
                diagStore.push({
                  type: "api_all_paid",
                  timestamp: Date.now(),
                  customer: customerTag,
                  count: mapped.length,
                  mostRecentDays: Math.round(daysSince),
                });
              } else {
                console.warn(
                  "[BILLING] Todas as faturas estão pagas (sem data de vencimento):",
                  "count=" + mapped.length,
                  "customer=" + customerTag,
                );
                diagStore.push({
                  type: "api_all_paid_no_dates",
                  timestamp: Date.now(),
                  customer: customerTag,
                  count: mapped.length,
                });
              }
            } else {
              // Normal fetch — log for tracking
              diagStore.push({
                type: "fetch_ok",
                timestamp: Date.now(),
                customer: customerTag,
                count: mapped.length,
              });
            }
          }

          setBillings(mapped);
          setIsCached(false);
          setCacheAge(null);
          setError(null);
          setIsLoading(false);
        }
      } catch (err) {
        if (cancelled) return;

        // ---- OFFLINE FALLBACK — try localStorage cache ----
        const cached = loadFromCache(customer.id);
        const customerTag = customer.id.slice(0, 12) + "...";

        if (cached && cached.billings.length > 0) {
          const ageMinutes = Math.round(cached.age / 60000);
          console.warn(
            "[BILLING] Usando cache offline:",
            "count=" + cached.billings.length,
            "idade=" + ageMinutes + "min",
            "customer=" + customerTag,
          );
          diagStore.push({
            type: "cache_hit",
            timestamp: Date.now(),
            customer: customerTag,
            count: cached.billings.length,
            ageMinutes,
          });
          setBillings(cached.billings);
          setIsCached(true);
          setCacheAge(cached.age);
          setError(null);
          setIsLoading(false);
        } else {
          const errMsg =
            err instanceof Error ? err.message.slice(0, 80) : "Erro desconhecido";
          console.warn(
            "[BILLING] Sem cache offline dispon\u00edvel:",
            "customer=" + customerTag,
            "erro=" + errMsg,
          );
          diagStore.push({
            type: "cache_miss",
            timestamp: Date.now(),
            customer: customerTag,
            error: errMsg,
          });
          setError(
            err instanceof Error ? err.message : "Erro ao carregar faturas.",
          );
          setIsCached(false);
          setCacheAge(null);
          setIsLoading(false);
        }
      }
    }

    fetchBillings();

    return () => {
      cancelled = true;
    };
  }, [customer, fetchTick]);

  // -----------------------------------------------------------------------
  // Periodic refetch every 5 minutes while authenticated
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!customer || customer.id.startsWith("test-")) return;

    intervalRef.current = setInterval(() => {
      setFetchTick((t) => t + 1);
    }, REFETCH_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [customer]);

  // -----------------------------------------------------------------------
  // Refresh when the user returns to the tab (visibility change).
  // Only refetches if the last fetch was more than 60 seconds ago, so
  // quick tab switches don't cause unnecessary requests.
  // -----------------------------------------------------------------------
  const lastFetchRef = useRef(0);

  useEffect(() => {
    lastFetchRef.current = Date.now();
  }, [billings]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const elapsed = Date.now() - lastFetchRef.current;
      if (elapsed < 60_000) return;
      setFetchTick((t) => t + 1);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return (
    <BillingContext.Provider
      value={{ billings, isLoading, error, isCached, cacheAge, refetch }}
    >
      {children}
    </BillingContext.Provider>
  );
}

export function useBillingContext(): BillingContextValue {
  const ctx = useContext(BillingContext);
  if (!ctx) {
    throw new Error("useBillingContext must be used within a <BillingProvider>");
  }
  return ctx;
}
