/**
 * Shared billing status configuration.
 * Used by Dashboard, Invoices, and InvoiceDetail pages.
 */

import { AlertCircle, CheckCircle2, Clock } from "lucide-react";

export const statusConfig: Record<
  string,
  { label: string; color: string; icon: any }
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
};
