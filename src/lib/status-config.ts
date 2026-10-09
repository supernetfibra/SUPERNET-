/**
 * Shared billing status configuration.
 * Used by Dashboard, Invoices, and InvoiceDetail pages.
 */

import { AlertCircle, CheckCircle2, Clock, Handshake, type LucideIcon } from "lucide-react";
// Extensão explícita no import: permite ao Node resolver este módulo direto no
// `check:portal` (sem build). Vite e tsc aceitam a mesma forma.
import { diasAteVencimento } from "./billing-utils.ts";

export const statusConfig: Record<
  string,
  { label: string; color: string; icon: LucideIcon }
> = {
  pendente: {
    label: "Pendente",
    color:
      "text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400",
    icon: Clock,
  },
  pago: {
    label: "Pago",
    color:
      "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400",
    icon: CheckCircle2,
  },
  vencido: {
    label: "Vencido",
    color: "text-red-600 bg-red-50 dark:bg-red-950/20 dark:text-red-400",
    icon: AlertCircle,
  },
  cancelado: {
    label: "Cancelado",
    color:
      "text-gray-500 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400",
    icon: AlertCircle,
  },
  // Fatura em observação = acordo com o cliente, não cobrança. Cor informativa
  // (azul), nunca âmbar/vermelho: nada aqui pede pagamento ou corre atrás de prazo.
  observacao: {
    label: "Em acordo",
    color: "text-sky-600 bg-sky-50 dark:bg-sky-950/20 dark:text-sky-400",
    icon: Handshake,
  },
};

/**
 * Badge de status para uma fatura (label + cor + ícone).
 *
 * Refina o status do ERP: faturas em aberto que ainda não venceram mostram
 * "A vencer" (âmbar); as que vencem hoje (ou estão atrasadas e o ERP ainda
 * marca "Em Aberto") mostram "Vence hoje" (vermelho). Vencida, Paga,
 * Cancelada e **Em acordo** (fatura em observação) mantêm os labels padrão.
 *
 * Acordo nunca ganha prazo: o refinamento abaixo é só para `pendente`.
 */
export function statusBadge(status: string, vencimento: string) {
  const config = statusConfig[status] ?? statusConfig.pendente;
  if (status !== "pendente") return config;

  const dias = diasAteVencimento(vencimento);
  // Sem data válida, ou atrasada e o ERP ainda marca "Em Aberto": Pendente
  if (dias === null || dias < 0) return config;

  if (dias === 0) {
    // Vence exatamente hoje — amarelo
    return {
      label: "Vence hoje",
      color:
        "text-yellow-600 bg-yellow-50 dark:bg-yellow-950/20 dark:text-yellow-400",
      icon: Clock,
    };
  }

  // Futura — azul com relógio
  return {
    label: "A vencer",
    color:
      "text-blue-600 bg-blue-50 dark:bg-blue-950/20 dark:text-blue-400",
    icon: Clock,
  };
}
