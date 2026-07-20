/**
 * Hook to fetch real billing data from the MikWeb API via Convex HTTP endpoint.
 */

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { getTestBillings, isTestCpf } from "@/lib/test-user";

// ---------------------------------------------------------------------------
// Types — mapped from MikWeb API response to frontend-friendly format
// ---------------------------------------------------------------------------

export interface BillingSummary {
  id: string;
  competencia: string;
  vencimento: string;
  valor: number;
  status: "pendente" | "pago" | "vencido" | "cancelado";
  data_pagamento?: string;
  valor_pago?: number;
  linha_digitavel?: string;
  pix_copiaecola?: string;
  url_boleto?: string;
  multa?: number;
  juros?: number;
}

export interface BillingDetail extends BillingSummary {
  codigo_barras?: string;
  nosso_numero?: string;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Map MikWeb API situation names to frontend status */
function mapStatus(situationName: string): BillingSummary["status"] {
  const map: Record<string, BillingSummary["status"]> = {
    "Em Aberto": "pendente",
    "Efetuado": "pago",
    "Pago": "pago",
    "Em Atraso": "vencido",
    "Vencido": "vencido",
    "Cancelado": "cancelado",
    "Em Observação": "pendente",
  };
  return map[situationName] || "pendente";
}

/** Format date string from yyyy-MM-dd to dd/MM/yyyy */
function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

/** Extract PIX copy-paste code from base64 if encoded */
function extractPixCode(pixValue?: string): string | undefined {
  if (!pixValue) return undefined;
  try {
    // Check if it's base64-encoded (long strings of only base64 chars)
    if (/^[A-Za-z0-9+/=]+$/.test(pixValue) && pixValue.length > 50) {
      return atob(pixValue);
    }
  } catch {
    // Not base64, return as-is
  }
  return pixValue;
}

/**
 * Try multiple field names from the raw API response to find the PIX code.
 * The MikWeb API may return it under different names depending on the version.
 * Logs a debug warning when no PIX field is found, listing available fields.
 */
function findPixCode(raw: Record<string, unknown>): string | undefined {
  const possibleFields = [
    "pix_copy_paste_base64",
    "pix_copy_paste",
    "pix_copia_cola",
    "pix_code",
    "pix_copiaecola",
  ];

  for (const field of possibleFields) {
    const value = raw[field];
    if (typeof value === "string" && value.length > 0) {
      const extracted = extractPixCode(value);
      if (extracted) return extracted;
    }
  }

  // Log available PIX-related fields for debugging when none was found
  if (process.env.NODE_ENV !== "production") {
    const pixKeys = Object.keys(raw).filter((k) =>
      k.toLowerCase().includes("pix")
    );
    if (pixKeys.length > 0) {
      console.warn(
        "[PIX] Nenhum campo PIX reconhecido encontrado. Campos disponíveis:",
        pixKeys.map((k) => `${k}: ${typeof raw[k]}${raw[k] ? ` ("${String(raw[k]).slice(0, 40)}...")` : ""}`)
      );
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Raw billing type from API
// ---------------------------------------------------------------------------

interface RawBilling {
  id: number | string;
  reference?: string;
  due_day?: string;
  value?: number;
  situation_name?: string;
  date_payment?: string | null;
  value_paid?: number | null;
  digitable_line?: string;
  pix_copy_paste_base64?: string;
  pix_qr_code_image_base64?: string;
  integration_link?: string;
  form_payment?: string;
  observation?: string | null;
  our_number?: string;
  // Possible alternate PIX field names from the API
  pix_copy_paste?: string;
  pix_copia_cola?: string;
  pix_code?: string;
  pix_copiaecola?: string;
  // Late payment fees
  fine_amount?: number;
  interest_amount?: number;
}

/** Map raw API billing to frontend-friendly format */
function mapBilling(raw: RawBilling): BillingSummary {
  return {
    id: String(raw.id),
    competencia: raw.reference || "",
    vencimento: formatDate(raw.due_day || ""),
    valor: raw.value || 0,
    status: mapStatus(raw.situation_name || ""),
    data_pagamento: raw.date_payment ? formatDate(raw.date_payment) : undefined,
    valor_pago: raw.value_paid ?? undefined,
    linha_digitavel: raw.digitable_line,
    pix_copiaecola: findPixCode(raw as unknown as Record<string, unknown>),
    url_boleto: raw.integration_link,
    multa: raw.fine_amount ?? undefined,
    juros: raw.interest_amount ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Offline cache — stores last successful billing response in localStorage
// Keys are customer-specific so different users don't mix data.
// ---------------------------------------------------------------------------

const CACHE_PREFIX = "mikweb_billing_cache_";
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

interface BillingCache {
  billings: BillingSummary[];
  timestamp: number;
  customerId: string;
}

function getCacheKey(customerId?: string): string | null {
  if (!customerId) return null;
  return CACHE_PREFIX + customerId;
}

function loadFromCache(customerId?: string): { billings: BillingSummary[]; age: number } | null {
  const key = getCacheKey(customerId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached: BillingCache = JSON.parse(raw);
    const age = Date.now() - cached.timestamp;
    // Only use cache if it's from the same user and not too stale
    if (cached.customerId !== customerId) return null;
    if (age > CACHE_MAX_AGE) {
      localStorage.removeItem(key);
      return null;
    }
    return { billings: cached.billings, age };
  } catch {
    return null;
  }
}

function saveToCache(customerId: string | undefined, billings: BillingSummary[]) {
  if (!customerId) return;
  const key = getCacheKey(customerId);
  if (!key) return;
  try {
    const cache: BillingCache = {
      billings,
      timestamp: Date.now(),
      customerId,
    };
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function clearCache(customerId?: string) {
  if (customerId) {
    const key = getCacheKey(customerId);
    if (key) {
      try { localStorage.removeItem(key); } catch {}
    }
  } else {
    // Clear all billing caches (used on logout)
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseBillingsResult {
  billings: BillingSummary[];
  isLoading: boolean;
  error: string | null;
  isCached: boolean;
  cacheAge: number | null; // ms since last successful fetch, null if fresh
}

export function useBillings(): UseBillingsResult {
  const [billings, setBillings] = useState<BillingSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const { customer } = useAuth();

  useEffect(() => {
    let cancelled = false;

    async function fetchBillings() {
      // ---- TEST USER - skip cache, return mock billings ----
      if (customer?.id?.startsWith("test-") && isTestCpf(customer.cpf)) {
        const mockRaw = getTestBillings() as RawBilling[];
        const sorted = mockRaw.sort((a, b) => {
          const aVencido = a.situation_name === "Vencido" || a.situation_name === "Em Atraso";
          const bVencido = b.situation_name === "Vencido" || b.situation_name === "Em Atraso";
          if (aVencido && !bVencido) return -1;
          if (!aVencido && bVencido) return 1;
          return (b.due_day || "").localeCompare(a.due_day || "");
        });
        if (!cancelled) {
          setBillings(sorted.map(mapBilling));
          setIsCached(false);
          setCacheAge(null);
          setIsLoading(false);
        }
        return;
      }
      // ---- END TEST USER ----

      try {
        const response = await fetch("/api/mikweb/billings", {
          method: "GET",
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error("Erro ao buscar faturas.");
        }

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

          // Save to cache for offline fallback
          saveToCache(customer?.id, mapped);

          setBillings(mapped);
          setIsCached(false);
          setCacheAge(null);
          setIsLoading(false);
        }
      } catch (err) {
        // ---- OFFLINE FALLBACK — try cache ----
        const cached = loadFromCache(customer?.id);
        if (cached && cached.billings.length > 0) {
          if (!cancelled) {
            setBillings(cached.billings);
            setIsCached(true);
            setCacheAge(cached.age);
            setError(null); // Don't show error — we have cached data
            setIsLoading(false);
          }
        } else {
          // No cache either — show the error
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Erro ao carregar faturas.");
            setIsCached(false);
            setCacheAge(null);
            setIsLoading(false);
          }
        }
      }
    }

    fetchBillings();

    return () => {
      cancelled = true;
    };
  }, [customer]);

  return { billings, isLoading, error, isCached, cacheAge };
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
  if (ageMs < 3600000) return `${Math.floor(ageMs / 60000)} min atr\u00e1s`;
  return `${Math.floor(ageMs / 3600000)}h atr\u00e1s`;
}

export { mapBilling, mapStatus, formatDate, extractPixCode, findPixCode, clearCache };
