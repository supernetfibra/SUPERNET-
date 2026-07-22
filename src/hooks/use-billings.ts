/**
 * Hook to read billing data from BillingContext.
 * The actual fetch is handled by <BillingProvider> at the app root.
 *
 * Also re-exports all billing helper functions (mapping, formatting, caching)
 * from billing-utils.ts for backward compatibility with consumers.
 */

import { useBillingContext } from "@/lib/billing-context";

// ── Re-export shared types and helpers from billing-utils ──
// These were previously defined inline here, but were moved to billing-utils.ts
// to break the circular dependency (billing-context imports from use-billings).
export type {
  BillingSummary,
  BillingDetail,
  RawBilling,
} from "@/lib/billing-utils";
export {
  mapBilling,
  mapStatus,
  formatDate,
  extractPixCode,
  findPixCode,
  saveToCache,
  loadFromCache,
  clearCache,
} from "@/lib/billing-utils";
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
// Display helpers — labels inteligentes
// ---------------------------------------------------------------------------

const MESES: string[] = [
  "Janeiro", "Fevereiro", "Março", "Abril",
  "Maio", "Junho", "Julho", "Agosto",
  "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * Extract month info from a vencimento string (dd/MM/yyyy).
 * Returns Portuguese month name and a sortable "YYYY-MM" key.
 * Ex: "15/01/2026" → { mesNome: "Janeiro", mesAno: "2026-01", ano: "2026", mes: "01", dia: "15" }
 */
export function extractMesInfo(vencimento: string): {
  mesNome: string;
  mesAno: string;
  ano: string;
  mes: string;
  dia: string;
} | null {
  if (!vencimento) return null;
  const parts = vencimento.split("/");
  if (parts.length !== 3) return null;
  const [dia, mes, ano] = parts;
  const mesNum = parseInt(mes, 10);
  if (mesNum < 1 || mesNum > 12) return null;
  return {
    mesNome: MESES[mesNum - 1],
    mesAno: `${ano}-${mes}`,
    ano,
    mes,
    dia,
  };
}

/**
 * Format vencimento (dd/MM/yyyy) to show month name in Portuguese.
 * Ex: "10/03/2025" → "10 de Março de 2025"
 */
export function formatVencimentoComMes(vencimento: string): string {
  if (!vencimento) return "";
  const parts = vencimento.split("/");
  if (parts.length !== 3) return vencimento;

  const [dia, mes, ano] = parts;
  const mesNum = parseInt(mes, 10);
  const mesNome = MESES[mesNum - 1] || mes;

  return `${parseInt(dia, 10)} de ${mesNome} de ${ano}`;
}

/**
 * Convert dd/MM/yyyy string to a Date object at midnight local time.
 */
function parseDateBR(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [dia, mes, ano] = parts.map(Number);
  if (!dia || !mes || !ano) return null;
  return new Date(ano, mes - 1, dia);
}

/**
 * Calculate how many days until the due date.
 * Negative = already overdue.
 */
export function diasAteVencimento(vencimento: string): number | null {
  const dueDate = parseDateBR(vencimento);
  if (!dueDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffMs = dueDate.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Returns a smart label object for the billing card header.
 * Shows contextual status like "VENCE HOJE", "A VENCER", "VENCIDA".
 */
export function getSmartLabel(billing: BillingSummary): {
  text: string;
  type: "vencida" | "vence-hoje" | "a-vencer" | "normal" | "paga";
} {
  if (billing.status === "pago") {
    return { text: "Paga", type: "paga" };
  }

  if (billing.status === "cancelado") {
    return { text: "Cancelada", type: "normal" };
  }

  if (billing.status === "vencido") {
    const dias = diasAteVencimento(billing.vencimento);
    if (dias !== null && dias === 0) {
      return { text: "VENCE HOJE", type: "vence-hoje" };
    }
    return { text: "VENCIDA", type: "vencida" };
  }

  // pendente
  const dias = diasAteVencimento(billing.vencimento);
  if (dias === null) {
    return { text: "Pendente", type: "normal" };
  }
  if (dias <= 0) {
    return { text: "VENCE HOJE", type: "vence-hoje" };
  }
  if (dias <= 7) {
    return { text: `A VENCER em ${dias} dia${dias !== 1 ? "s" : ""}`, type: "a-vencer" };
  }
  if (dias <= 30) {
    return { text: `A vencer em ${dias} dias`, type: "normal" };
  }
  return { text: formatVencimentoComMes(billing.vencimento), type: "normal" };
}

/**
 * Format cache age in milliseconds to a human-readable string in Portuguese.
 */
export function formatCacheAge(ageMs: number | null): string | null {
  if (ageMs === null) return null;
  if (ageMs < 60000) return "menos de 1 min";
  if (ageMs < 3600000) return `${Math.floor(ageMs / 60000)} min atrás`;
  return `${Math.floor(ageMs / 3600000)}h atrás`;
}
