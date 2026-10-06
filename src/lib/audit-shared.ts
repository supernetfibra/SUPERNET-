/**
 * Audit shared — tipos e rótulos do log de auditoria, compartilhados entre a
 * página de Auditoria (/admin/audit) e o Cliente 360 (/admin/customers/:cpf).
 *
 * Origem: eram locais do AdminDashboard e migraram junto com a funcionalidade
 * na Fase 4 (mover UI não move regra de negócio — são apenas rótulos/types).
 */

export interface AuditEntry {
  _id: string;
  type: string;
  cpf?: string;
  customerName?: string;
  errorMessage?: string;
  ipAddress?: string;
  timestamp: number;
  metadata?: {
    billingId?: string;
    reference?: string;
    value?: number;
    // Eventos de operação (aba "Operação")
    test?: boolean;
    action?: string;
    scanned?: number;
    newContacts?: number;
    updates?: number;
    enabled?: boolean | null;
    origin?: string;
  };
}

export interface AuditSummary {
  totalLogins: number;
  totalFailures: number;
  totalRateLimited: number;
  totalBillingErrors: number;
  todayLogins: number;
  todayFailures: number;
  last7DaysLogins: number;
  last7DaysFailures: number;
  uniqueCpfs: number;
}

// ---------------------------------------------------------------------------
// Normalização do contrato (ponto único)
// ---------------------------------------------------------------------------
// GET /admin/audit-logs responde `select("*")` na tabela `mikweb_audit_log`
// (supabase/functions/api/index.ts), logo o topo do log é a LINHA DO BANCO em
// snake_case: `customer_name`, `error_message`, `ip_address`, `user_agent`,
// `customer_id`. O `metadata` já é gravado em camelCase pelo backend
// (`billingId`, `newContacts`, `ruleKey`...), por isso passa direto.
//
// Antes desta normalização, cada tela repetia o fallback
// `l.customer_name || l.customerName` no JSX — dois lugares, dois jeitos.
// As duas agora chamam `normalizeAuditLog`.
// ---------------------------------------------------------------------------

/** Linha crua do banco (snake_case) — o que o endpoint devolve de fato. */
export interface AuditLogRow {
  id?: string;
  type?: string;
  cpf?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  error_message?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  metadata?: AuditEntry["metadata"];
  timestamp?: number | null;
}

export function normalizeAuditLog(row: AuditLogRow, fallbackId: string): AuditEntry {
  return {
    _id: row.id ?? fallbackId,
    type: row.type ?? "",
    cpf: row.cpf ?? undefined,
    customerName: row.customer_name ?? undefined,
    errorMessage: row.error_message ?? undefined,
    ipAddress: row.ip_address ?? undefined,
    timestamp: typeof row.timestamp === "number" ? row.timestamp : 0,
    metadata: row.metadata,
  };
}

/** Aplica `normalizeAuditLog` a uma lista de logs cruos. */
export function normalizeAuditLogs(rows: AuditLogRow[]): AuditEntry[] {
  return rows.map((row, i) => normalizeAuditLog(row, String(i)));
}

/** Rótulo semântico de cada tipo de evento (ícone é decidido pela tela). */
export const auditTypeLabels: Record<string, { label: string; tone: "success" | "danger" | "warning" | "info" | "neutral" }> = {
  login_success: { label: "Login OK", tone: "success" },
  login_failure: { label: "Falha Login", tone: "danger" },
  login_rate_limited: { label: "Rate Limit", tone: "warning" },
  billing_error: { label: "Erro Fatura", tone: "warning" },
  billing_access: { label: "Acesso Fatura", tone: "info" },
  logout: { label: "Logout", tone: "neutral" },
  barcode_copied: { label: "Copiou Código", tone: "info" },
  pix_copied: { label: "Copiou PIX", tone: "info" },
  pdf_viewed: { label: "Acessou PDF", tone: "info" },
  // ── Operação do sistema (escopo "Operação"): crons, config salva, testes de envio ──
  whatsapp_config: { label: "Config WhatsApp", tone: "neutral" },
  notification_config: { label: "Config Régua", tone: "neutral" },
  whatsapp_sent: { label: "Envio/Teste OK", tone: "success" },
  whatsapp_failed: { label: "Envio/Teste Falhou", tone: "danger" },
  whatsapp_skipped: { label: "Envio Pulado", tone: "warning" },
  whatsapp_opt_in: { label: "Import Opt-in", tone: "info" },
};

/** Opções do filtro de tipo por escopo (mesmas do dashboard antes da Fase 4). */
export const CUSTOMER_AUDIT_TYPES = [
  { value: "all", label: "Todos" },
  { value: "login_success", label: "Logins OK" },
  { value: "login_failure", label: "Falhas" },
  { value: "login_rate_limited", label: "Rate Limit" },
  { value: "billing_error", label: "Erros Fatura" },
  { value: "barcode_copied", label: "Copiou Código" },
  { value: "pix_copied", label: "Copiou PIX" },
  { value: "pdf_viewed", label: "Acessou PDF" },
];

/**
 * Eventos de OPERAÇÃO (cron, configuração salva, teste de envio) não têm
 * cliente: são do sistema. Subtítulo da linha 2 para eventos sem erro.
 */
export const systemEventSubtitle = (entry: AuditEntry): string | null => {
  const meta = entry.metadata ?? {};
  switch (entry.type) {
    case "whatsapp_opt_in":
      return meta.action === "cron-import-contacts"
        ? "Cron diário: reimportação de contatos MikWeb"
        : "Importação de contatos (painel)";
    case "whatsapp_sent":
      return meta.test ? "Teste de envio do painel" : "Envio manual (painel)";
    case "whatsapp_failed":
    case "whatsapp_skipped":
      return meta.test ? "Teste de envio do painel" : null;
    case "whatsapp_config":
      return "Configuração do canal salva";
    case "notification_config":
      return "Régua de lembretes salva";
    default:
      return null;
  }
};

/** BRL — compartilhado entre Auditoria e Cliente 360 (faturas na consulta). */
export function formatBRL(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
