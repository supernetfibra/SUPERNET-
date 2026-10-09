/**
 * Hook to read billing data from BillingContext.
 * The actual fetch is handled by <BillingProvider> at the app root.
 *
 * Also re-exports all billing helper functions (mapping, formatting, caching)
 * from billing-utils.ts for backward compatibility with consumers.
 */

import { useBillingContext } from "@/lib/billing-context";

// Import types locally so the file can use them in its own function signatures.
// `isolatedModules` mode (used by Vite) does NOT make re-exported types
// available in the local scope — a separate import is required.
import {
  type BillingSummary,
  type BillingDetail,
} from "@/lib/billing-utils";

// ── Re-export shared types and helpers from billing-utils ──
// These were previously defined inline here, but were moved to billing-utils.ts
// to break the circular dependency (billing-context imports from use-billings).
export type { BillingSummary, BillingDetail } from "@/lib/billing-utils";
export {
  mapBilling,
  mapStatus,
  formatDate,
  parseDateBR,
  diasAteVencimento,
  extractPixCode,
  findPixCode,
  saveToCache,
  loadFromCache,
  clearCache,
} from "@/lib/billing-utils";

// ── Rótulos de apresentação (módulo puro, sem React) ──
// Extraídos para `billing-labels.ts` para o `check:portal` poder rodá-los no Node;
// re-exportados aqui para quem já importava de `@/hooks/use-billings`.
export {
  extractMesInfo,
  formatVencimentoComMes,
  getSmartLabel,
} from "@/lib/billing-labels";

// Local value import — re-export alone doesn't make it usable inside this file.
import { parseDateBR } from "@/lib/billing-utils";
// ---------------------------------------------------------------------------
// Hook — reads from centralized BillingContext (no local state/effects)
// ---------------------------------------------------------------------------

export function useBillings() {
  const ctx = useBillingContext();
  return {
    billings: ctx.billings,
    isLoading: ctx.isLoading,
    error: ctx.error,
    isCached: ctx.isCached,
    cacheAge: ctx.cacheAge,
  };
}

export function useBillingById(id: string | undefined): {
  billing: BillingDetail | null;
  isLoading: boolean;
} {
  const { billings, isLoading } = useBillings();
  const billing = billings.find((b) => b.id === id) || null;

  return { billing, isLoading };
}

// ---------------------------------------------------------------------------
// Display helpers
//
// Os rótulos do card (extractMesInfo / formatVencimentoComMes / getSmartLabel)
// moraram aqui e foram extraídos para `src/lib/billing-labels.ts` — módulo puro,
// coberto pelo `check:portal`. Re-exportados acima para os consumidores.
// ---------------------------------------------------------------------------

/**
 * Format cache age in milliseconds to a human-readable string in Portuguese.
 */
export function formatCacheAge(ageMs: number | null): string | null {
  if (ageMs === null) return null;
  if (ageMs < 60000) return "menos de 1 min";
  if (ageMs < 3600000) return `${Math.floor(ageMs / 60000)} min atrás`;
  return `${Math.floor(ageMs / 3600000)}h atrás`;
}

// ---------------------------------------------------------------------------
// Stale data detection — shared between Invoices and Dashboard
// ---------------------------------------------------------------------------

/**
 * Check whether the billing data looks suspiciously stale.
 * Returns null if data seems fresh, or an object with title/message if the
 * most recent invoice (paid or not) is older than `thresholdDays`.
 */
export function checkStaleData(
  billings: BillingSummary[],
  thresholdDays = 60,
): { title: string; message: string } | null {
  if (billings.length === 0) return null;

  // Find the most recent vencimento by parsing dd/MM/yyyy
  const dates = billings
    .map((b) => parseDateBR(b.vencimento))
    .filter((d): d is Date => d !== null);

  if (dates.length === 0) return null;

  const latestDate = dates.reduce((latest, d) =>
    d.getTime() > latest.getTime() ? d : latest,
  );

  const now = new Date();
  const diffDays =
    (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays > thresholdDays) {
    const mes = latestDate.getMonth() + 1;
    const ano = latestDate.getFullYear();
    const diasAtras = Math.round(diffDays);
    return {
      title: "Dados podem estar desatualizados",
      message: `A fatura mais recente é de ${mes}/${ano} (há ${diasAtras} dias). Pode haver cobranças mais recentes não carregadas.`,
    };
  }

  return null;
}
