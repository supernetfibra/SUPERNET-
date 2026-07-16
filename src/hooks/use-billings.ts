/**
 * Hook to fetch real billing data from the MikWeb API via Convex HTTP endpoint.
 */

import { useState, useEffect } from "react";

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
}

export interface BillingDetail extends BillingSummary {
  codigo_barras?: string;
  url_boleto?: string;
  multa?: number;
  juros?: number;
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
function extractPixCode(pixBase64?: string): string | undefined {
  if (!pixBase64) return undefined;
  try {
    // Check if it's base64-encoded
    if (/^[A-Za-z0-9+/=]+$/.test(pixBase64) && pixBase64.length > 50) {
      return atob(pixBase64);
    }
  } catch {
    // Not base64, return as-is
  }
  return pixBase64;
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
    pix_copiaecola: extractPixCode(raw.pix_copy_paste_base64),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseBillingsResult {
  billings: BillingSummary[];
  isLoading: boolean;
  error: string | null;
}

export function useBillings(): UseBillingsResult {
  const [billings, setBillings] = useState<BillingSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBillings() {
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
          if (Array.isArray(data.billings)) {
            // Sort raw billings by due_day descending (most recent first)
            // due_day format from API: yyyy-MM-dd
            const sorted = (data.billings as RawBilling[]).sort((a, b) => {
              const dateA = a.due_day || "";
              const dateB = b.due_day || "";
              return dateB.localeCompare(dateA);
            });
            setBillings(sorted.map(mapBilling));
          } else {
            setBillings([]);
          }
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao carregar faturas.");
          setIsLoading(false);
        }
      }
    }

    fetchBillings();

    return () => {
      cancelled = true;
    };
  }, []);

  return { billings, isLoading, error };
}

export function useBillingById(id: string | undefined): {
  billing: BillingDetail | null;
  isLoading: boolean;
} {
  const { billings, isLoading } = useBillings();
  const billing = billings.find((b) => b.id === id) || null;

  return { billing, isLoading };
}

export { mapBilling, mapStatus, formatDate };
