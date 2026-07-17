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
  const { customer } = useAuth();

  useEffect(() => {
    let cancelled = false;

    async function fetchBillings() {
      try {
        // ---- TEST USER - return mock billings ----
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
            setIsLoading(false);
          }
          return;
        }
        // ---- END TEST USER ----

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
  }, [customer]);

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

export { mapBilling, mapStatus, formatDate };
