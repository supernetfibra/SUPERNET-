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
              .open("portal-cliente-v1")
              .then((cache) => cache.put("/api/mikweb/billings", swCacheClone))
              .catch(() => {});
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
        if (cached && cached.billings.length > 0) {
          setBillings(cached.billings);
          setIsCached(true);
          setCacheAge(cached.age);
          setError(null); // don't show error — we have cached data
          setIsLoading(false);
        } else {
          // No cache either — show the error
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
    // Don't poll for test users or unauthenticated sessions
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

  return (
    <BillingContext.Provider
      value={{ billings, isLoading, error, isCached, cacheAge, refetch }}
    >
      {children}
    </BillingContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useBillingContext(): BillingContextValue {
  const ctx = useContext(BillingContext);
  if (!ctx) {
    throw new Error("useBillingContext must be used within a <BillingProvider>");
  }
  return ctx;
}
