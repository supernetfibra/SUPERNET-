/**
 * Rótulos e motivos de descarte da sincronização de cobranças.
 *
 * Extraído de AdminSyncDialog.tsx: o arquivo do componente exportava helpers
 * junto com o componente, o que quebra o Fast Refresh (regra
 * `react-refresh/only-export-components`). São funções puras de apresentação —
 * não carregam estado nem efeito.
 */

export type SyncSkipReason =
  | "channel_disabled"
  | "no_customer"
  | "already_enqueued"
  | "no_template"
  | "no_opt_in"
  | "invalid_phone"
  | "push_pending"
  | "no_channel";

export interface SyncItem {
  dedupeKey: string;
  eventKey: string;
  ruleKey: string;
  billingId: string;
  customerId: string;
  customerName: string;
  reference: string;
  dueDate: string;
  sendDate: string;
  scheduledFor: number;
  channel: string | null;
  target: string | null;
  targetMasked: string | null;
  outcome: "enqueue" | "skip";
  reason: SyncSkipReason | null;
  detail: string;
  preview: { title?: string; body: string } | null;
  payload: Record<string, unknown> | null;
}

export interface SyncSummary {
  dryRun: boolean;
  day: { from: string; to: string; days: number };
  dueWindow: { from: string; to: string };
  settings: {
    fingerprint: string;
    origin: "db" | "defaults";
    updatedAt: number | null;
    updatedBy: string | null;
    rulesActive: string[];
  };
  source: { billings: number; customers: number; contacts: number };
  plan: {
    planned: number;
    toEnqueue: number;
    skipped: Record<SyncSkipReason, number>;
    byRule: Record<string, number>;
  };
  enqueued: number;
  duplicates: number;
  blocked: SyncSkipReason | null;
  templateWarnings: string[];
  assumptions: string[];
  items: SyncItem[];
  itemsTruncated: boolean;
}


// ---------------------------------------------------------------------------
// Autenticação admin — consolidada em src/lib/api-config.ts. Este dialog sempre
// enviou o token TAMBÉM no header x-admin-token (variante adminFetchHeader).
// ---------------------------------------------------------------------------

export function formatDateBR(iso: string | undefined): string {
  if (!iso) return "—";
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
}

export function getCivilToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formatRuleLabel(ruleKey: string): string {
  switch (ruleKey) {
    case "d_minus_3":
      return "3 dias antes (D-3)";
    case "due_date":
    case "d_0":
      return "No vencimento (D0)";
    case "d_plus_1":
      return "1 dia vencido (D+1)";
    case "d_plus_5":
      return "5 dias vencido (D+5)";
    default:
      return ruleKey.replace(/_/g, " ");
  }
}

export function describeReason(reason: SyncSkipReason | null): {
  label: string;
  badgeClass: string;
  description: string;
} {
  switch (reason) {
    case "already_enqueued":
      return {
        label: "Já enfileirado",
        badgeClass:
          "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
        description: "Evento já existe na outbox com a mesma chave (dedupe)",
      };
    case "no_opt_in":
      return {
        label: "Sem opt-in",
        badgeClass:
          "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
        description: "Cliente sem consentimento de WhatsApp registrado",
      };
    case "invalid_phone":
      return {
        label: "Telefone inválido",
        badgeClass:
          "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800",
        description: "Telefone fixo, malformado ou ausente",
      };
    case "push_pending":
      return {
        label: "Aguardando Push",
        badgeClass:
          "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
        description: "Cliente só tem push; adapter de push ainda não migrado",
      };
    case "channel_disabled":
      return {
        label: "Canal desativado",
        badgeClass:
          "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
        description: "WhatsApp desligado na configuração",
      };
    case "no_template":
      return {
        label: "Sem template",
        badgeClass:
          "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
        description: "Nenhum template ativo para a regra deste evento",
      };
    case "no_customer":
      return {
        label: "Sem cadastro",
        badgeClass:
          "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
        description: "Cadastro do cliente não retornado na varredura",
      };
    case "no_channel":
      return {
        label: "Sem canal",
        badgeClass:
          "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
        description: "Nenhum canal de envio elegível disponível",
      };
    default:
      return {
        label: reason ?? "Descartado",
        badgeClass:
          "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
        description: "Descartado pelo planejamento",
      };
  }
}
