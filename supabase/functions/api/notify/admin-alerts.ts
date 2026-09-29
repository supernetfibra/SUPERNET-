/**
 * admin-alerts — o sistema avisa o ADMIN quando a operação precisa dele.
 *
 * Motivação: se o WhatsApp desconectar (QR expira) ou a rodada de envio acumular
 * falhas, ninguém descobre até abrir o painel — e o lembrete morre em silêncio,
 * que é exatamente o tipo de falha que um sistema de cobrança não pode ter.
 *
 * Canal primário: WhatsApp para o número do admin (`adminAlertPhone`), com detalhes
 * da ocorrência. O alerta SOBRE o canal não pode depender apenas do canal, então
 * quando o envio por WhatsApp não for possível (sem número, sem credenciais,
 * instância fora) o fallback vai por PUSH para os inscritos do painel.
 *
 * Anti-spam: cada tipo de alerta tem uma chave; só reavisa depois de `cooldownMs`
 * (padrão 4h). A memória é o próprio documento de settings (`adminAlerts`) — sem
 * migration, igual às régua/templates. Alerta repetido vira ruído; ruído desliga
 * o alerta.
 *
 * Módulo PURO: nada aqui lê Deno.env nem banco. Entram números e saem mensagens —
 * por isso o check:notify consegue travar as regras exatamente como o dispatcher usa.
 */

// ---------------------------------------------------------------------------
// Configuração (guardada dentro do SettingsDocument, sem migration)
// ---------------------------------------------------------------------------

export interface AdminAlertsConfig {
  /** Celular do admin (E.164, só dígitos, ex.: 5511999990000). Vazio = sem alerta. */
  phone: string;
  /** Alertas ligados/desligados por gatilho. */
  alertChannelDown: boolean;
  alertDispatchFailures: boolean;
  /** Quantas falhas numa mesma rodada disparam o aviso. */
  failureThreshold: number;
}

export const DEFAULT_ADMIN_ALERTS: AdminAlertsConfig = {
  phone: "",
  alertChannelDown: true,
  alertDispatchFailures: true,
  failureThreshold: 5,
};

/** Valida e normaliza o que veio do painel/banco. Nunca lança. */
export function normalizeAdminAlerts(raw: unknown, base: AdminAlertsConfig = DEFAULT_ADMIN_ALERTS): AdminAlertsConfig {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  // Campo AUSENTE mantém o que está em vigor (documento parcial — mesma regra da régua).
  // Aceita com ou sem código do país: o admin digita "(11) 98765-4321", não E.164.
  let phone = base.phone;
  if (typeof record.phone === "string") {
    const digits = record.phone.replace(/\D/g, "");
    const withCountry = /^(55\d{2}9\d{8}|\d{2}9\d{8})$/.test(digits) ? (digits.startsWith("55") ? digits : `55${digits}`) : "";
    phone = withCountry;
  }

  return {
    phone,
    alertChannelDown: typeof record.alertChannelDown === "boolean" ? record.alertChannelDown : base.alertChannelDown,
    alertDispatchFailures:
      typeof record.alertDispatchFailures === "boolean" ? record.alertDispatchFailures : base.alertDispatchFailures,
    failureThreshold: Math.min(Math.max(Number(record.failureThreshold) || base.failureThreshold, 1), 200),
  };
}

// ---------------------------------------------------------------------------
// Regras de disparo (puras — o index.ts só executa o que daqui sai)
// ---------------------------------------------------------------------------

export type AlertKey = "channel-down" | "dispatch-failures" | "quota-paused";

export interface AlertRuleInput {
  key: AlertKey;
  enabled: boolean;
  cooldownMs: number;
  lastSentAt: number | null;
  now: number;
}

/** Dentro do cooldown? Silêncio — repetir não ajuda, só incomoda. */
export function shouldSendAlert(input: AlertRuleInput): boolean {
  if (!input.enabled) return false;
  if (input.lastSentAt === null) return true;
  return input.now - input.lastSentAt >= input.cooldownMs;
}

export const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

function formatBr(ts: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(ts);
}

/**
 * Instância fora do ar (status != connected) ou credenciais ausentes.
 * `hint` já vem pronto do chamador: para o alerta de status, o estado visto na UazAPI.
 */
export function buildChannelDownMessage(input: { reason: string }): string {
  return [
    `⚠️ Lembretes parados: o canal WhatsApp não está pronto.`,
    `Motivo: ${input.reason}.`,
    `Abra o painel → Conexões → reconecte pelo QR (ou verifique URL/token).`,
    `A fila continua guardada e sai quando o canal voltar.`,
  ].join("\n");
}

/** Falhas na rodada de envio. */
export function buildDispatchFailuresMessage(input: { failed: number; sent: number; sample: string | null; at: number }): string {
  const lines = [
    `⚠️ Envio de lembretes com problemas.`,
    `${input.failed} falha(s) na última rodada (${input.sent} enviada(s) com sucesso).`,
  ];
  if (input.sample) lines.push(`Exemplo: ${input.sample.slice(0, 120)}`);
  lines.push(`Abra o painel → Mensagens → filtre por "Falhou" para reenviar.`);
  lines.push(`Rodada de ${formatBr(input.at)}.`);
  return lines.join("\n");
}

/** WhatsApp impôs pausa por volume (time-lock). */
export function buildQuotaPausedMessage(input: { until: number }): string {
  return [
    `⏸️ WhatsApp impôs pausa (time-lock) por volume de novas conversas.`,
    `O canal retoma sozinho em ${formatBr(input.until)}.`,
    `Nada a fazer — avisado só para você não estranhar a fila parada.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Anti-spam no documento (memória dos últimos envios)
// ---------------------------------------------------------------------------

/** `{ "channel-down": 1730000000000, ... }` — último envio por chave. */
export type AdminAlertsState = Partial<Record<AlertKey, number>>;

export function sanitizeAlertsState(raw: unknown, now: number): AdminAlertsState {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: AdminAlertsState = {};
  for (const key of ["channel-down", "dispatch-failures", "quota-paused"] as AlertKey[]) {
    const value = Number(record[key]);
    // Timestamp futuro (relógio adiantado/cold start) é descartado: liberaria o
    // alerta imediatamente e, pior, “congelaria” o cooldown por dias.
    if (Number.isFinite(value) && value > 0 && value <= now && now - value < 30 * 24 * 60 * 60 * 1000) {
      out[key] = Math.trunc(value);
    }
  }
  return out;
}

export { formatBr };
