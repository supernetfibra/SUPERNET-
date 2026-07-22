/**
 * Billing Utilities — Shared types and helper functions for billings.
 *
 * Extracted from use-billings.ts to break the circular dependency between
 * use-billings.ts (hook → context) and billing-context.tsx (context → hook).
 * Both files import from here for types and pure helpers.
 */

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
// Raw billing type from API
// ---------------------------------------------------------------------------

export interface RawBilling {
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

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Map MikWeb API situation names to frontend status */
export function mapStatus(situationName: string): BillingSummary["status"] {
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
export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

/** Extract PIX copy-paste code from base64 if encoded */
export function extractPixCode(pixValue?: string): string | undefined {
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
export function findPixCode(raw: Record<string, unknown>): string | undefined {
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
      k.toLowerCase().includes("pix"),
    );
    if (pixKeys.length > 0) {
      console.warn(
        "[PIX] Nenhum campo PIX reconhecido encontrado. Campos disponíveis:",
        pixKeys.map(
          (k) =>
            `${k}: ${typeof raw[k]}${raw[k] ? ` ("${String(raw[k]).slice(0, 40)}...")` : ""}`,
        ),
      );
    }
  }

  return undefined;
}

/** Map raw API billing to frontend-friendly format */
export function mapBilling(raw: RawBilling): BillingSummary {
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

export function loadFromCache(
  customerId?: string,
): { billings: BillingSummary[]; age: number } | null {
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

export function saveToCache(
  customerId: string | undefined,
  billings: BillingSummary[],
) {
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

export function clearCache(customerId?: string) {
  if (customerId) {
    const key = getCacheKey(customerId);
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {}
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
