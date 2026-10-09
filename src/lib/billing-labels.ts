/**
 * Rótulos de apresentação das faturas (área do cliente).
 *
 * Módulo puro (sem React, sem fetch), pelo mesmo motivo de `simulator-report.ts`:
 * aqui moram regras que erram fácil e em silêncio. Dizer "VENCE HOJE" ou
 * "A VENCER em N dias" numa fatura em acordo é cobrar um acordo — foi exatamente
 * o que acontecia quando "Em Observação" virava `pendente`.
 *
 * Como este módulo não importa React nem o contexto de faturas, o
 * `check:portal` roda estas funções direto no Node (sem build). Por isso o
 * import de `./billing-utils.ts` traz a extensão explícita: é o que o Node
 * precisa para resolver o módulo; o Vite e o `tsc` (com
 * `allowImportingTsExtensions`) aceitam a mesma forma.
 */

import { diasAteVencimento, type BillingSummary } from "./billing-utils.ts";

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
 * Returns a smart label object for the billing card header.
 * Shows contextual status like "VENCE HOJE", "A VENCER", "VENCIDA".
 *
 * Acordo (observação) sai da régua de prazo: a fatura está em observação, então
 * anunciar "vence hoje" ou "a vencer em N dias" seria cobrar um acordo.
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

  if (billing.status === "observacao") {
    return { text: "Em acordo", type: "normal" };
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
