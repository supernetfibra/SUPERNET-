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
  /** Fila empacada: avisos cujo horário agendado passou há 12h+ (ou presos há 48h+). */
  alertStuckQueue: boolean;
  /** Quantas falhas numa mesma rodada disparam o aviso. */
  failureThreshold: number;
  /** Resumo diário de cobranças (vencem hoje, vencidas 1–5, vencidas 6+). */
  dailySummary: boolean;
  /** Botões de ação rápida enviados com os alertas (máx. 3 — limite do WhatsApp). URL vazia = portal do provedor. */
  buttons: Array<{ label: string; url: string }>;
}

export const DEFAULT_ADMIN_ALERTS: AdminAlertsConfig = {
  phone: "",
  alertChannelDown: true,
  alertDispatchFailures: true,
  alertStuckQueue: true,
  failureThreshold: 5,
  // Digest diário LIGADO por padrão (autonomia): o dono do provedor abre o dia
  // sabendo o que saiu, sem abrir o painel. Quem não quiser desliga no painel
  // (Conexões → Alertas de operação); se a config salva já trouxer a chave
  // explícita, ela vence — nada muda para quem já escolheu.
  dailySummary: true,
  buttons: [{ label: "Abrir painel", url: "" }],
};

/** Botões saneados: rótulo obrigatório, URL http(s) ou vazia (= portal), máx. 3. */
function sanitizeButtons(raw: unknown, base: AdminAlertsConfig["buttons"]): AdminAlertsConfig["buttons"] {
  const list = Array.isArray(raw) ? raw.slice(0, 3) : base;
  const out: AdminAlertsConfig["buttons"] = [];
  for (const entry of list) {
    const record = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
    const label = String(record.label ?? "").trim().slice(0, 40);
    const url = String(record.url ?? "").trim();
    if (label && (url === "" || /^https?:\/\//i.test(url))) out.push({ label, url });
  }
  return out;
}

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
    alertStuckQueue: typeof record.alertStuckQueue === "boolean" ? record.alertStuckQueue : base.alertStuckQueue,
    failureThreshold: Math.min(Math.max(Number(record.failureThreshold) || base.failureThreshold, 1), 200),
    dailySummary: typeof record.dailySummary === "boolean" ? record.dailySummary : base.dailySummary,
    buttons: record.buttons === undefined ? base.buttons : sanitizeButtons(record.buttons, base.buttons),
  };
}

// ---------------------------------------------------------------------------
// Regras de disparo (puras — o index.ts só executa o que daqui sai)
// ---------------------------------------------------------------------------

export type AlertKey = "channel-down" | "dispatch-failures" | "quota-paused" | "daily-summary" | "stuck-queue" | "weekly-summary";

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

/** Dia civil (YYYY-MM-DD) no fuso de São Paulo — o mesmo dia do pipeline. */
export function civilDayBr(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(ts);
}

/** Resumo diário: uma vez por DIA CIVIL (cooldown de 4h deixaria buracos de cron duplicar). */
export function shouldSendDailySummary(lastSentAt: number | null, now: number): boolean {
  if (!lastSentAt) return true;
  return civilDayBr(lastSentAt) !== civilDayBr(now);
}

// ---------------------------------------------------------------------------
// Botões de ação rápida (UazAPI aceita até 3 por mensagem)
// ---------------------------------------------------------------------------

/** URL vazia = portal do provedor + caminho contextual daquele alerta. */
export function resolveButtons(
  buttons: AdminAlertsConfig["buttons"],
  portalBaseUrl: string,
  fallbackPath: string
): Array<{ label: string; url: string }> {
  const portal = portalBaseUrl.replace(/\/+$/, "");
  const resolved = buttons
    .slice(0, 3)
    .map((b) => ({ label: b.label, url: b.url || `${portal}${fallbackPath}` }))
    .filter((b) => /^https?:\/\//i.test(b.url));
  // Sem botão configurável válido, o atalho contextual é o mínimo útil.
  if (resolved.length === 0 && portal) {
    return [{ label: "Abrir painel", url: `${portal}${fallbackPath}` }];
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Resumo diário de cobranças
// ---------------------------------------------------------------------------

export interface SummaryBucket {
  count: number;
  value: number;
}

export interface SummaryBuckets {
  /** Vencem hoje. */
  dueToday: SummaryBucket;
  /** Vencidas há 1–5 dias. */
  late1to5: SummaryBucket;
  /** Vencidas há mais de 5 dias. */
  late6plus: SummaryBucket;
  /** Vencem nos próximos dias (dentro da janela varrida). */
  upcoming: SummaryBucket;
}

function daysFromToday(dueDay: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDay)) return null;
  const due = Date.parse(`${dueDay}T12:00:00Z`);
  const ref = Date.parse(`${today}T12:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(ref)) return null;
  return Math.round((due - ref) / 86_400_000);
}

/**
 * Faturas em aberto → baldes do resumo. A entrada já vem sem pago/cancelado
 * (a varredura usa situation_id=2), então aqui é só classificar por vencimento.
 */
export function aggregateBillings(
  billings: Array<{ due_day?: string | null; value?: number | null }>,
  today: string
): SummaryBuckets {
  const buckets: SummaryBuckets = {
    dueToday: { count: 0, value: 0 },
    late1to5: { count: 0, value: 0 },
    late6plus: { count: 0, value: 0 },
    upcoming: { count: 0, value: 0 },
  };
  for (const billing of billings) {
    const diff = daysFromToday(String(billing.due_day ?? ""), today);
    if (diff === null) continue;
    const value = Number(billing.value) || 0;
    let bucket: SummaryBucket;
    if (diff === 0) bucket = buckets.dueToday;
    else if (diff > 0) bucket = buckets.upcoming;
    else if (diff >= -5) bucket = buckets.late1to5;
    else bucket = buckets.late6plus;
    bucket.count += 1;
    bucket.value += value;
  }
  return buckets;
}

function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function bucketLine(label: string, bucket: SummaryBucket): string {
  return `• ${label}: ${bucket.count} fatura(s) — ${brl(bucket.value)}`;
}

/** Resumo em 6 linhas: o operador lê de pé, no celular, antes do café. */
export function buildDailySummaryMessage(input: { buckets: SummaryBuckets; at: number }): string {
  const day = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(input.at);
  return [
    `📋 Resumo de cobranças — ${day}`,
    bucketLine("Vencem hoje", input.buckets.dueToday),
    bucketLine("Vencidas até 5 dias", input.buckets.late1to5),
    bucketLine("Vencidas há mais de 5 dias", input.buckets.late6plus),
    bucketLine("Vencem nos próximos dias", input.buckets.upcoming),
    `Os lembretes do dia já foram enfileirados pela régua.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Resumo SEMANAL de disparos — autonomia: o dono do provedor recebe uma vez por
// semana o retrato do canal (enviados, entregues, lidos, falhas, opt-outs) sem
// abrir o painel. Sai pela MESMA régua de alertas (phone + push de fallback).
// ---------------------------------------------------------------------------

/** Uma vez a cada 7 dias (o dia exato segue o cron do sync — não promete segunda). */
export function shouldSendWeeklySummary(lastSentAt: number | null, now: number): boolean {
  if (!lastSentAt) return true;
  return now - lastSentAt >= 7 * 24 * 60 * 60 * 1000;
}

export interface WeeklySummaryStats {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  optOuts: number;
  uncertain: number;
}

export function buildWeeklySummaryMessage(input: { stats: WeeklySummaryStats; at: number }): string {
  const period = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(
    input.at - 6 * 24 * 60 * 60 * 1000
  );
  const end = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(input.at);
  const pct = (part: number, total: number) => (total > 0 ? ` (${Math.round((part / total) * 100)}%)` : "");
  return [
    `📊 Resumo semanal de lembretes — ${period} a ${end}`,
    `• Enviados: ${input.stats.sent}`,
    `• Entregues: ${input.stats.delivered}${pct(input.stats.delivered, input.stats.sent)}`,
    `• Lidos: ${input.stats.read}${pct(input.stats.read, input.stats.sent)}`,
    `• Falhas: ${input.stats.failed}`,
    ...(input.stats.uncertain > 0 ? [`• ⚠️ ${input.stats.uncertain} envio(s) incerto(s) aguardando conciliação em Mensagens`] : []),
    ...(input.stats.optOuts > 0 ? [`• 🚫 ${input.stats.optOuts} opt-out(s) — clientes que pediram PARAR`] : []),
    `Detalhes: painel → Mensagens.`,
  ].join("\n");
}

export const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fila empacada (o incidente que motivou: "cota por cliente", 30/09/2026)
// ---------------------------------------------------------------------------

/** Horário agendado passou há mais de 12h sem sair: algo parou a fila. */
export const STUCK_QUEUE_OVERDUE_MS = 12 * 60 * 60 * 1000;
/** Na fila há mais de 48h: um pré-agendado legítimo nunca fica tanto tempo. */
export const STUCK_QUEUE_AGE_MS = 48 * 60 * 60 * 1000;

export interface StuckQueueRow {
  id: string;
  /** Horário agendado (passado — nunca olhamos futuro). */
  scheduledFor: number;
  /** Criação da entrega (o "quanto tempo está preso" dos dois sinais). */
  createdAt: number;
  /** Motivo registrado pela última passagem (ex.: "cota por cliente (1/dia)"). */
  errorMessage: string | null;
}

export interface StuckQueueSignal {
  /** O alerta deve disparar. */
  stuck: boolean;
  /** Quantos avisos estão empacados (os dois sinais somados). */
  count: number;
  /** Do sinal forte: agendada para X e nada até agora. */
  overdue: number;
  /** Do sinal lento: criada há 48h+ e ainda na fila. */
  aged: number;
  /** Hora agendada mais antiga entre os empacados (para a mensagem citar). */
  oldestScheduledFor: number | null;
  /** O registro mais empacado é overdue (mensagem destaca "agendada para"). */
  worstIsOverdue: boolean;
  /** Motivo do registro mais velho — é ele que diz O QUÊ parou (cota, release...). */
  oldestReason: string | null;
}

/**
 * Classifica a amostra de entregas `queued` com `scheduled_for` no passado.
 * Duas portas de entrada, porque nenhum sinal sozinho é completo:
 *
 *   - **overdue (12h)** — deveria ter saído e não saiu. Forte, mas cego para um
 *     loop que re-agenda para o dia seguinte ANTES de completar 12h de atraso;
 *   - **age (48h)** — presa desde a criação. Lento, mas pega qualquer loop: um
 *     pré-agendado legítimo nunca fica 2 dias na fila (o sync agenda no máximo
 *     para o horizonte da régua, e o aviso SAI no dia dele).
 *
 * O incidente da cota (30/09/2026, 57 entregas re-agendadas dia após dia) não
 * dispararia só pelo overdue — disparou pelos dois juntos.
 */
export function classifyStuckQueue(rows: StuckQueueRow[], now: number): StuckQueueSignal {
  const signal: StuckQueueSignal = {
    stuck: false,
    count: 0,
    overdue: 0,
    aged: 0,
    oldestScheduledFor: null,
    worstIsOverdue: false,
    oldestReason: null,
  };
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const isOverdue = row.scheduledFor <= now - STUCK_QUEUE_OVERDUE_MS;
    const isAged = row.createdAt <= now - STUCK_QUEUE_AGE_MS;
    if (!isOverdue && !isAged) continue;
    signal.count += 1;
    if (isOverdue) signal.overdue += 1;
    if (isAged) signal.aged += 1;
    if (row.createdAt < oldestAt) {
      oldestAt = row.createdAt;
      signal.oldestScheduledFor = row.scheduledFor;
      signal.worstIsOverdue = isOverdue;
      signal.oldestReason = row.errorMessage;
    }
  }
  signal.stuck = signal.count > 0;
  return signal;
}

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

/** Fila empacada: o alerta cita o QUANTO, o DESDE QUANDO e o motivo registrado. */
export function buildStuckQueueMessage(input: { signal: StuckQueueSignal }): string {
  const s = input.signal;
  const head = s.worstIsOverdue && s.oldestScheduledFor !== null
    ? `${s.count} aviso(s) na fila com horário agendado no passado — o mais antigo era para ${formatBr(s.oldestScheduledFor)}.`
    : `${s.count} aviso(s) presos na fila há mais de 2 dias.`;
  const lines = [
    `🚨 Lembretes empacados: a fila não anda.`,
    head,
  ];
  if (s.oldestReason) lines.push(`Motivo registrado: ${s.oldestReason.slice(0, 140)}.`);
  lines.push(`Abra o painel → Mensagens para ver o motivo de cada aviso e reenviar manualmente se precisar.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Anti-spam no documento (memória dos últimos envios)
// ---------------------------------------------------------------------------

/** `{ "channel-down": 1730000000000, ... }` — último envio por chave. */
export type AdminAlertsState = Partial<Record<AlertKey, number>>;

export function sanitizeAlertsState(raw: unknown, now: number): AdminAlertsState {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: AdminAlertsState = {};
  for (const key of ["channel-down", "dispatch-failures", "quota-paused", "daily-summary", "stuck-queue", "weekly-summary"] as AlertKey[]) {
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
