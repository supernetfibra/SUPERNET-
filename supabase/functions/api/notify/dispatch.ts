/**
 * Dispatcher: drena a outbox e entrega pelo adapter do canal.
 *
 * Há **um único caminho de envio**. O botão "enviar agora" do painel não tem uma
 * função de envio própria: ele enfileira (idempotente) e chama este mesmo
 * dispatcher com `ids` — que passa pelo mesmo `claim`, pelo mesmo render de envio
 * e pelos mesmos updates de status. Dois caminhos de envio seriam dois lugares
 * onde a idempotência pode vazar.
 *
 * ## Renderização na hora do envio
 * O texto é montado AQUI, com a data do envio como referência — não no
 * enfileiramento. Um aviso de atraso agendado para daqui a três dias precisa
 * contar os dias do dia em que sai (bug que o simulador expôs, ver
 * LEMBRETES-WHATSAPP.md §14). Só as chaves dependentes de data são recalculadas:
 * `dias_atraso` e `dias_para_vencer`.
 *
 * ## Por que reagendar não é "tentativa"
 * Adiar por cota usa `release()`, que devolve a entrega para a fila e **desfaz** o
 * incremento de `attempts` do claim. Sem isso, um cliente barrado pela cota por
 * vários dias esgotaria as tentativas sem nunca ter falhado de verdade.
 *
 * ## As duas cotas (e por que só uma cede ao humano)
 *   cota POR CLIENTE   → quanto este cliente recebe. `manual` passa por cima: um
 *                        humano decidiu que aquela fatura merece o aviso agora.
 *   cota de NOVAS      → quanto o NÚMERO fala com gente nova. Vale nos dois modos,
 *   CONVERSAS (canal)    como o time-lock: estourá-la não gera erro de mensagem,
 *                        gera restrição do número. "Enviar agora" não é motivo para
 *                        arriscar o canal inteiro.
 * A segunda é a que fecha a última divergência com o simulador: `newChatCapPerDay`
 * existia no relatório desde o começo e não era aplicado em lugar nenhum — o estouro
 * só aparecia depois, como time-lock. A vaga é reservada no banco antes do envio
 * (`reserve_new_chat_slot`), então dois processos não passam do teto juntos.
 */

import { civilDayStartMs, civilHour, civilToday, diffDays, isCivilDate, type Channel } from "./model.ts";
import {
  renderFor,
  EVENT_DUE_DATE,
  EVENT_URL,
  EVENT_ACTIONS,
  EVENT_INVOICE_ID,
  EVENT_CUSTOMER_ID,
  type ChannelTemplate,
  type TemplatePayload,
} from "./templates.ts";
import { parseBillingDedupeKey, parsePrefixedCustomerId } from "./connections.ts";
import type { ChannelReconciliation, ChannelRegistry, Rendered } from "./channel.ts";
import type { BillingVerdict } from "./billing-verdict.ts";
import type { ClaimedDelivery, OutboxApi, OutboxEvent } from "./outbox.ts";

/**
 * Veredito da revalidação da fatura na fonte (MikWeb), feita na hora do envio.
 *
 * O tipo é do módulo puro `billing-verdict.ts` — o dispatcher só o consome. Manter
 * uma cópia da união aqui era o outro lado do problema: a regra podia mudar lá e o
 * tipo daqui continuar "verdadeiro", escondendo a divergência do compilador.
 */
export type BillingRevalidation = BillingVerdict;

export interface DispatchDeps {
  outbox: OutboxApi;
  registry: ChannelRegistry;
  /**
   * Templates fixos (testes) ou resolvidos por chamada — os salvos no painel entram
   * por aqui sem rebuild do runtime.
   */
  templates?: ChannelTemplate[] | (() => ChannelTemplate[] | undefined | Promise<ChannelTemplate[] | undefined>);
  now?: () => number;
  /** Tentativas máximas antes de desistir (falha permanente). */
  maxAttempts?: number;
  /** Cota de mensagens ENVIADAS por cliente por dia (1 = um lembrete por dia), quando `policy: "automated"`. */
  perCustomerCap?: () => Promise<number> | number;
  /**
   * Cota de NOVAS CONVERSAS por dia do canal (a mesma que o simulador projeta).
   * `null` = o canal não tem esse conceito (push) — a reserva é pulada.
   * `0` = sem teto: registra se é conversa nova, sem bloquear (igual ao simulador,
   * que só aplica a cota quando `newChatCapPerDay > 0`).
   */
  newChatCap?: (channel: Channel) => Promise<number | null> | number | null;
  /**
   * Janela de envio (horas locais) por canal. Vem da configuração persistida
   * (`whatsapp_config.window_start/window_end`), a mesma que o simulador usa — é o
   * que faz o `defer_window` do relatório ser verdade em produção.
   */
  window?: (channel: Channel) => Promise<{ start: number; end: number } | null> | { start: number; end: number } | null;
  /**
   * Revalida a situação da fatura na fonte ANTES de enviar (`billing.*` com
   * `__invoiceId` no payload). É o que fecha o risco restante de lembrete para
   * fatura paga: o sync enfileira o dia (não o horizonte) exatamente porque o
   * dispatcher não relia a situação — agora ele relê.
   * Erro de rede aqui NÃO é tentativa: a entrega volta para a fila sem gastar
   * `attempts` (o alerta de fila empacada é o cinto de segurança do laço).
   */
  revalidateBilling?: (input: {
    /** Slug da conta MikWeb de origem (multi-conta), quando prefixado. */
    connection: string | null;
    /** customer_id do evento, com ou sem prefixo de conta. */
    customerId: string;
    invoiceId: string;
    dueDate: string | null;
    eventKey: string;
  }) => Promise<BillingRevalidation>;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

export interface DispatchOptions {
  limit?: number;
  channel?: Channel;
  /** Restringe o lote a entregas específicas (usado pelo "enviar agora"). */
  ids?: string[];
  /**
   * `manual` = um humano pediu o disparo agora: a janela de envio e a cota por
   * cliente não bloqueiam. A autorização por opt-in continua valendo nos dois casos
   * (checada no enfileiramento) e a cota de NOVAS CONVERSAS também — ela protege o
   * número, não a caixa de entrada do cliente.
   */
  policy?: "automated" | "manual";
}

export interface DispatchItemResult {
  deliveryId: string;
  customerId: string | null;
  target: string;
  ok: boolean;
  status: string;
  reason: string;
}

/**
 * Cota de novas conversas, como o LOTE a viu. Espelha o `queue` do relatório do
 * simulador (`newChatQuotaPerDay` / `deferredByCap`) para dar como comparar os dois
 * números depois de ligar o canal.
 */
export interface NewChatQuotaSummary {
  cap: number;
  /** Conversas novas que este lote começou. */
  started: number;
  /** Entregas adiadas por falta de vaga — devolvidas à fila sem gastar tentativa. */
  heldByCap: number;
  /** Total de novas conversas do dia, conforme o banco contou na última reserva. */
  usedToday: number;
  /** Preenchido quando a reserva não pôde ser consultada (cota NÃO aplicada). */
  error?: string;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  released: number;
  failed: number;
  skipped: number;
  uncertain: number;
  paused: boolean;
  pauseReason?: string;
  /** `null` quando o canal não tem cota de novas conversas (ou nenhuma foi informada). */
  newChats: NewChatQuotaSummary | null;
  /** Faturas revalidadas na fonte antes do envio (presente só com `revalidateBilling`). */
  revalidated?: number;
  /** Envios cancelados POR CAUSA da revalidação: fatura já paga/cancelada. */
  canceledPaid?: number;
  /** Envios cancelados por a fatura estar "Em Observação" (acordo do cliente). */
  canceledObservation?: number;
  /** Entregas órfãs em `sending` devolvidas à fila no início da rodada. */
  recovered?: number;
  /** Órfãos conciliados como JÁ ENVIADOS no provedor (marcados `sent`, sem reenvio). */
  recoveredSent?: number;
  /** Órfãos confirmados como NÃO enviados (devolvidos à fila). */
  recoveredQueued?: number;
  /** Órfãos com consulta inconclusiva (viram `NETWORK_UNCERTAIN`, sem reenvio). */
  recoveredUncertain?: number;
  results: DispatchItemResult[];
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Primeiro instante da próxima janela de envio do canal.
 *
 * A cota é diária, então o adiamento é para o próximo dia — e para a hora em que o
 * canal pode enviar, não para "daqui a 24h" (que cairia de madrugada, fora da
 * janela, e faria a entrega ser adiada outra vez).
 */
async function nextWindowOpenMs(deps: DispatchDeps, channel: Channel, nowMs: number): Promise<number> {
  let startHour = 9;
  try {
    const win = await deps.window?.(channel);
    if (win && win.end > win.start) startHour = win.start;
  } catch {
    // janela ilegível: mantém 9h, que é o default da configuração do canal
  }
  return civilDayStartMs(nowMs + DAY_MS) + startHour * 60 * 60_000;
}

/** Converte o payload do evento em payload de template (descarta metadados `__`). */
export function toTemplatePayload(payload: Record<string, unknown>): TemplatePayload {
  const out: TemplatePayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.startsWith("__")) continue;
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

/**
 * Recalcula as chaves sensíveis à data com a data do ENVIO como referência.
 * É o coração da garantia "render no envio, não no enfileiramento".
 *
 * O `dueDate` entra como parâmetro explícito de propósito: ele vive no payload
 * como metadado `__dueDate`, e `toTemplatePayload()` já o descartou quando esta
 * função roda. (Ler o campo depois de descartá-lo era o bug.)
 */
export function refreshTimeSensitiveKeys(
  payload: TemplatePayload,
  sendDate: string,
  dueDate: string | null
): TemplatePayload {
  if (!dueDate || !isCivilDate(dueDate)) return payload;

  const out = { ...payload };
  delete out.dias_atraso;
  delete out.dias_para_vencer;

  const diff = diffDays(sendDate, dueDate);
  if (diff > 0) out.dias_atraso = String(diff);
  else out.dias_para_vencer = String(Math.abs(diff));
  return out;
}

export function renderAtSendTime(input: {
  event: OutboxEvent;
  channel: Channel;
  sendDate: string;
  templates?: ChannelTemplate[];
}): Rendered | null {
  const raw = input.event.payload;
  const dueDate = typeof raw[EVENT_DUE_DATE] === "string" ? (raw[EVENT_DUE_DATE] as string) : null;
  const payload = refreshTimeSensitiveKeys(toTemplatePayload(raw), input.sendDate, dueDate);

  const rendered = renderFor(input.channel, input.event.eventKey, payload, input.templates);
  if (!rendered.message) return null;

  // Ações rápidas: do payload armazenado (`__actions`, gravado no enfileiramento)
  // ou, eventos antigos sem a chave, derivadas do payload na hora.
  const rawActions = raw[EVENT_ACTIONS];
  const actions = Array.isArray(rawActions)
    ? (rawActions as Array<{ label: string; copy?: string; url?: string }>).filter(
        (action) => action && typeof action.label === "string" && (typeof action.copy === "string" || typeof action.url === "string")
      )
    : rendered.message.actions;

  return {
    title: rendered.message.title,
    body: rendered.message.body,
    url: typeof raw[EVENT_URL] === "string" ? (raw[EVENT_URL] as string) : undefined,
    actions: actions?.length ? actions : undefined,
  };
}

/**
 * O evento faz sentido na data em que vai sair?
 *   `late_too_early`   → aviso de atraso antes do vencimento (reagenda)
 *   `pre_due_expired`  → aviso de vencimento depois do vencimento (descarta)
 *   `null`             → coerente
 * Descartar é seguro para `pre_due_expired` porque as regras de atraso são eventos
 * separados, com `dedupe_key` próprio — elas não são afetadas por este descarte.
 */
export function scheduleMismatch(
  eventKey: string,
  dueDate: string | null,
  sendDate: string
): "late_too_early" | "pre_due_expired" | null {
  if (!dueDate || !isCivilDate(dueDate)) return null;
  const diff = diffDays(sendDate, dueDate);

  if (eventKey === "billing.late") return diff <= 0 ? "late_too_early" : null;
  if (eventKey === "billing.due_soon" || eventKey === "billing.due_today") {
    return diff > 0 ? "pre_due_expired" : null;
  }
  return null;
}

export async function dispatchQueue(deps: DispatchDeps, options: DispatchOptions = {}): Promise<DispatchSummary> {
  const now = deps.now ?? (() => Date.now());
  const channel: Channel = options.channel ?? "whatsapp";
  const limit = options.limit ?? 10;
  const policy = options.policy ?? "automated";
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const log = deps.log ?? (() => {});
  // Templates podem chegar fixos (teste) ou resolvidos por chamada (painel). A leitura
  // acontece uma vez por rodada: um lote inteiro sai com o MESMO texto.
  const templatesForRun = (): Promise<ChannelTemplate[] | undefined> | ChannelTemplate[] | undefined =>
    typeof deps.templates === "function" ? deps.templates() : deps.templates;

  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    released: 0,
    failed: 0,
    skipped: 0,
    uncertain: 0,
    paused: false,
    newChats: null,
    results: [],
  };

  const adapter = deps.registry.get(channel);
  if (!adapter) {
    summary.paused = true;
    summary.pauseReason = `nenhum adapter registrado para o canal "${channel}"`;
    return summary;
  }

  const readiness = await adapter.ready();
  if (!readiness.ok) {
    summary.paused = true;
    summary.pauseReason = readiness.reason;
    return summary;
  }

  // Janela de envio. Fora dela NADA é reservado: as entregas continuam na fila e o
  // próximo cron (5–15 min) pega assim que a janela abrir. Sem esta checagem, a
  // janela existiria só no relatório do simulador — promessa falsa.
  // `manual` passa por cima de propósito: um humano clicou em "enviar agora".
  if (policy === "automated" && deps.window) {
    let win: { start: number; end: number } | null = null;
    try {
      win = await deps.window(channel);
    } catch {
      win = null;
    }
    if (win && win.end > win.start) {
      const hour = civilHour(now());
      if (hour < win.start || hour >= win.end) {
        summary.paused = true;
        summary.pauseReason = `fora da janela de envio (${win.start}h–${win.end}h, agora ${hour}h)`;
        return summary;
      }
    }
  }

  // Recuperação de claims órfãos RECONCILIATION-FIRST (antes do claim desta
  // rodada): uma entrega `sending` há mais de 15 min ficou presa porque o
  // processo morreu no meio do envio. Requeue cego aqui DUPLICARIA mensagem —
  // o provedor pode já ter aceitado/enviado. Para cada órfão:
  //   provedor TEM a mensagem → marca `sent` (com provider_id), nunca reenvia;
  //   provedor NÃO tem      → volta à fila sem gastar tentativa (reenvio seguro);
  //   consulta falhou       → vira `NETWORK_UNCERTAIN` (conciliação posterior),
  //                           NUNCA reenvia automático. Nada fica preso em `sending`.
  // Com `ids` explícitos (envio manual de um humano) a varredura é pulada.
  if (!options.ids) {
    try {
      const stale = await deps.outbox.listStaleClaims({ channel, staleMs: 15 * 60_000, now: now() });
      for (const orphan of stale) {
        let verdict: ChannelReconciliation;
        try {
          verdict = (await adapter.reconcile?.(orphan.eventId)) ?? {
            outcome: "uncertain" as const,
            reason: "canal sem conciliação",
          };
        } catch (error) {
          verdict = { outcome: "uncertain", reason: error instanceof Error ? error.message : String(error) };
        }
        if (verdict.outcome === "sent") {
          summary.recoveredSent = (summary.recoveredSent ?? 0) + 1;
          await deps.outbox.markSent(orphan.id, verdict.providerId ?? null);
          log("órfão conciliado: já saiu no provedor", { deliveryId: orphan.id, providerId: verdict.providerId ?? null });
        } else if (verdict.outcome === "not_sent") {
          // "Não achou" na sonda NÃO prova que não saiu: com sendText async +
          // delay humano, a mensagem pode estar ENFILEIRADA no provedor e ainda
          // fora do histórico (duplicado em massa em 09/10/2026). Reenvio cego
          // aqui DUPLICA. Conservador: INCERTEZA — conciliação posterior decide.
          summary.recoveredUncertain = (summary.recoveredUncertain ?? 0) + 1;
          await deps.outbox.markFailed({
            deliveryId: orphan.id,
            errorKey: "NETWORK_UNCERTAIN",
            errorMessage: `claim órfão conciliado como "não achado" — pode estar enfileirado no provedor; NÃO reenviado automaticamente`,
            permanent: true,
          });
          log("órfão conciliado: não achado na sonda — incerto, sem reenvio", { deliveryId: orphan.id });
        } else {
          summary.recoveredUncertain = (summary.recoveredUncertain ?? 0) + 1;
          await deps.outbox.markFailed({
            deliveryId: orphan.id,
            errorKey: "NETWORK_UNCERTAIN",
            errorMessage: `claim órfão com consulta inconclusiva (${verdict.reason}) — aguardando conciliação, NÃO reenviado`,
            permanent: true,
          });
          log("órfão inconclusivo — sem reenvio automático", { deliveryId: orphan.id, reason: verdict.reason });
        }
      }
      if (stale.length > 0) {
        summary.recovered = stale.length;
        log("varredura de claims órfãos concluída", { total: stale.length });
      }
    } catch (error) {
      // Best-effort: falhar aqui não pode impedir a rodada normal. Os órfãos
      // continuam `sending` e a próxima rodada tenta de novo.
      log("recuperação de claims órfãos falhou", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  let claimed: ClaimedDelivery[] = [];
  try {
    claimed = await deps.outbox.claim({ limit, channel, now: now(), ids: options.ids });
  } catch (error) {
    summary.paused = true;
    summary.pauseReason = `falha ao reservar o lote: ${error instanceof Error ? error.message : String(error)}`;
    return summary;
  }
  summary.claimed = claimed.length;
  if (!claimed.length) return summary;

  const events = await deps.outbox.eventsByIds([...new Set(claimed.map((item) => item.eventId))]);
  const todayIso = civilToday(now());
  const dayStart = civilDayStartMs(now());
  const cap = policy === "automated" ? await (deps.perCustomerCap?.() ?? 1) : Number.POSITIVE_INFINITY;

  // Cota de novas conversas lida UMA vez por lote (a configuração não muda no meio
  // do lote) e o dia civil vem do núcleo puro, para o dia do banco ser o mesmo dia
  // que o simulador usa.
  let newChatCap: number | null = null;
  if (deps.newChatCap) {
    try {
      const value = await deps.newChatCap(channel);
      newChatCap = value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.trunc(value));
    } catch (error) {
      log("cota de novas conversas ilegível", { error: error instanceof Error ? error.message : String(error) });
      newChatCap = null;
    }
  }
  if (newChatCap !== null) summary.newChats = { cap: newChatCap, started: 0, heldByCap: 0, usedToday: 0 };

  // Revalidação por rodada: uma fatura com dois lembretes no mesmo lote é
  // consultada UMA vez (o lote inteiro sai em segundos; a fatura não muda nele).
  const revalidationCache = new Map<string, BillingRevalidation>();

  for (let index = 0; index < claimed.length; index++) {
    const delivery = claimed[index]!;
    const target = delivery.target;
    const push = (result: Omit<DispatchItemResult, "deliveryId" | "customerId" | "target">) =>
      summary.results.push({ deliveryId: delivery.id, customerId: delivery.customerId, target, ...result });

    if (delivery.attempts > maxAttempts) {
      summary.failed++;
      push({ ok: false, status: "failed", reason: `excedeu ${maxAttempts} tentativas` });
      await deps.outbox.markFailed({
        deliveryId: delivery.id,
        errorKey: "MAX_ATTEMPTS",
        errorMessage: `excedeu ${maxAttempts} tentativas`,
        permanent: true,
      });
      continue;
    }

    const event = events.get(delivery.eventId);
    if (!event) {
      summary.skipped++;
      push({ ok: false, status: "skipped", reason: "evento não encontrado" });
      await deps.outbox.markSkipped(delivery.id, "evento não encontrado na outbox");
      continue;
    }

    // Guardo de coerência entre o texto do evento e a data do envio. Sem isto, um
    // aviso de atraso enviado cedo sai como "— dias em atraso" e um aviso de
    // vencimento enviado tarde diz "vence hoje" para algo que venceu na semana
    // passada. Ambos já apareceram na simulação ao vivo.
    const dueDateIso = typeof event.payload[EVENT_DUE_DATE] === "string" ? (event.payload[EVENT_DUE_DATE] as string) : null;
    const mismatch = scheduleMismatch(event.eventKey, dueDateIso, todayIso);

    if (mismatch === "late_too_early") {
      // Primeiro instante em que a cobrança de atraso faz sentido: dia seguinte ao
      // vencimento, 9h local. `+1h` garante que nunca reagenda para o passado —
      // reagendar para o passado viraria laço de claim/release.
      const dueDate = new Date(`${dueDateIso}T12:00:00Z`).getTime();
      const retryAt = Math.max(civilDayStartMs(dueDate) + 24 * 60 * 60_000 + 9 * 60 * 60_000, now() + 60 * 60_000);
      summary.released++;
      push({ ok: false, status: "queued", reason: "fatura ainda não está atrasada — reagendado" });
      await deps.outbox.release({ deliveryId: delivery.id, scheduledFor: retryAt, reason: "fatura ainda não está atrasada" });
      continue;
    }

    if (mismatch === "pre_due_expired") {
      summary.skipped++;
      push({ ok: false, status: "skipped", reason: "vencimento já passou — o aviso de atraso assume" });
      await deps.outbox.markSkipped(delivery.id, "vencimento já passou — o aviso de atraso assume");
      continue;
    }

    // REVALIDAÇÃO — o envio relê a fatura na fonte. Pagar entre o agendamento e o
    // envio é o caso comum (o cliente recebe o aviso, paga, e a régua seguinte
    // ainda estava na fila). Antes disto, a proteção era só o sync enfileirar um
    // dia por vez; agora a janela de risco é a rodada de dispatch, não o dia.
    if (deps.revalidateBilling && event.eventKey.startsWith("billing.")) {
      const payloadInvoiceId = typeof event.payload[EVENT_INVOICE_ID] === "string" ? (event.payload[EVENT_INVOICE_ID] as string) : "";
      const payloadCustomerId = typeof event.payload[EVENT_CUSTOMER_ID] === "string" ? (event.payload[EVENT_CUSTOMER_ID] as string) : "";
      // Eventos enfileirados ANTES do metadado `__invoiceId` (fila de 30/09–05/10/2026)
      // não carregam a fatura no payload. O guard antigo (`if (invoiceId)`) PULAVA a
      // revalidação nesses casos e o lembrete saía para fatura já paga — foi o que
      // aconteceu em 09/10/2026. Reconstrói o que falta: a fatura vem da dedupe_key
      // (`billing:<slug>:<id>:<regra>`) e o cliente, do próprio evento.
      const fromDedupe = parseBillingDedupeKey(event.dedupeKey);
      const invoiceId = payloadInvoiceId || fromDedupe?.billingId || "";
      const customerIdRaw = payloadCustomerId || event.customerId || "";
      if (!invoiceId || !customerIdRaw) {
        // Sem como identificar a fatura (ou o cliente dela) NÃO se envia às cegas:
        // um lembrete para fatura já paga é pior que um lembrete a menos. Bloqueia
        // e fica visível no painel (skipped com motivo), nunca num laço de
        // reagendamento — e nunca "open" silencioso por dado ausente.
        const missing = !invoiceId ? "id da fatura" : "cliente da fatura";
        summary.skipped++;
        push({ ok: false, status: "skipped", reason: `evento de fatura sem ${missing} para revalidar — envio bloqueado (segurança)` });
        await deps.outbox.markSkipped(delivery.id, `evento de fatura sem ${missing} para revalidar — envio bloqueado por segurança`);
        continue;
      }
      {
        const { slug } = parsePrefixedCustomerId(customerIdRaw);
        const connectionSlug = slug ?? fromDedupe?.slug ?? null;
        // A fatura entra na chave com o EVENTO: o veredito de uma fatura em observação
        // depende de ser (ou não) a mensagem dedicada, então cachear só por fatura
        // faria um evento cobrar o que o outro deveria silenciar.
        const cacheKey = `${connectionSlug ?? ""}:${invoiceId}:${event.eventKey}`;
        let verdict = revalidationCache.get(cacheKey);
        if (!verdict) {
          try {
            verdict = await deps.revalidateBilling({
              connection: connectionSlug,
              customerId: customerIdRaw,
              invoiceId,
              dueDate: dueDateIso,
              eventKey: event.eventKey,
            });
          } catch (error) {
            verdict = { status: "unknown", error: error instanceof Error ? error.message : String(error) };
          }
          revalidationCache.set(cacheKey, verdict);
        }
        summary.revalidated = (summary.revalidated ?? 0) + 1;

        if (verdict.status === "paid") {
          summary.skipped++;
          summary.canceledPaid = (summary.canceledPaid ?? 0) + 1;
          const reason = `fatura paga — lembrete cancelado (situação na fonte: ${verdict.situation || "paga"})`;
          push({ ok: false, status: "skipped", reason });
          await deps.outbox.markSkipped(delivery.id, reason);
          continue;
        }
        if (verdict.status === "observation") {
          // Fatura em observação = acordo pedido pelo cliente. Cobrar aqui é o erro que
          // o admin pediu para eliminar: cancela com motivo, do mesmo jeito que a paga.
          summary.skipped++;
          summary.canceledObservation = (summary.canceledObservation ?? 0) + 1;
          const reason = `fatura em observação — lembrete de cobrança cancelado (situação na fonte: ${verdict.situation || "em observação"})`;
          push({ ok: false, status: "skipped", reason });
          await deps.outbox.markSkipped(delivery.id, reason);
          continue;
        }
        if (verdict.status === "unknown") {
          // A fonte não respondeu: ADIA sem gastar tentativa. Enviar sem saber
          // arrisca cobrar fatura paga; marcar falha permanente mentiria sobre
          // o motivo. O alerta de fila empacada cobre o laço prolongado.
          const retryAt = now() + 15 * 60_000;
          summary.released++;
          push({ ok: false, status: "queued", reason: `revalidação indisponível (${verdict.error}) — reagendado` });
          await deps.outbox.release({
            deliveryId: delivery.id,
            scheduledFor: retryAt,
            reason: "fonte de faturas indisponível para revalidar",
          });
          continue;
        }
      }
    }

    const rendered = renderAtSendTime({ event, channel, sendDate: todayIso, templates: await templatesForRun() });
    if (!rendered) {
      summary.skipped++;
      push({ ok: false, status: "skipped", reason: `sem template ativo para ${channel}/${event.eventKey}` });
      await deps.outbox.markSkipped(delivery.id, `sem template ativo para ${channel}/${event.eventKey}`);
      continue;
    }

    if (Number.isFinite(cap) && delivery.customerId) {
      // O próprio envio em avaliação fica FORA da contagem (e `sending` não conta):
      // sem isto, cap 1 se barrava sozinha — a entrega já estava em `sending` quando
      // a checagem rodava e virava a 1ª mensagem "do dia" para o próprio cliente.
      const recent = await deps.outbox.countRecentForCustomer({
        customerId: delivery.customerId,
        channel,
        since: dayStart,
        excludeDeliveryId: delivery.id,
      });
      if (recent >= cap) {
        const retryAt = await nextWindowOpenMs(deps, channel, now());
        summary.released++;
        push({ ok: false, status: "queued", reason: `limite de ${cap} aviso(s)/dia por cliente atingido — reagendado` });
        await deps.outbox.release({ deliveryId: delivery.id, scheduledFor: retryAt, reason: `limite por cliente (${cap}/dia)` });
        continue;
      }
    }

    // Cota de NOVAS CONVERSAS do canal — a última divergência entre o relatório do
    // simulador e o envio. A vaga é reservada no banco (atômico, com lock por canal)
    // ANTES de falar com o provedor: estourar esse teto não devolve erro de mensagem,
    // devolve time-lock — e o canal inteiro paga por isso. Vale em `manual` também.
    if (newChatCap !== null) {
      const slot = await deps.outbox.reserveNewChatSlot({
        deliveryId: delivery.id,
        channel,
        cap: newChatCap,
        dayStart,
      });

      if (summary.newChats) {
        summary.newChats.usedToday = slot.usedToday;
        if (slot.error) summary.newChats.error = slot.error;
      }
      if (slot.error) log("cota de novas conversas não pôde ser reservada — envio liberado", { error: slot.error });

      if (!slot.allowed) {
        // Adiar (não descartar): a conversa acontece amanhã, na primeira janela. E
        // `release()` devolve o `attempts` do claim — esperar cota não é tentativa.
        const retryAt = await nextWindowOpenMs(deps, channel, now());
        summary.released++;
        if (summary.newChats) summary.newChats.heldByCap++;
        // A razão chega ao painel (toast do botão "Lembrar") e ao resumo do cron: ela
        // diz o que aconteceu E o que fazer para enviar antes da próxima janela.
        push({
          ok: false,
          status: "queued",
          reason: `cota de novas conversas do dia esgotada (${slot.usedToday}/${newChatCap}) — reagendado; aumente a cota de novas conversas em Configurações para enviar antes`,
        });
        await deps.outbox.release({
          deliveryId: delivery.id,
          scheduledFor: retryAt,
          reason: `cota de novas conversas (${slot.usedToday}/${newChatCap})`,
        });
        continue;
      }

      if (slot.isNewChat && summary.newChats) summary.newChats.started++;
    }

    const result = await adapter.deliver(target, rendered, {
      eventId: event.id,
      eventKey: event.eventKey,
      priority: event.priority,
      manual: policy === "manual",
      now: now(),
    });

    if (result.ok) {
      summary.sent++;
      push({ ok: true, status: "sent", reason: "enviado" });
      await deps.outbox.markSent(delivery.id, result.providerId ?? null, rendered.actions);
      await deps.outbox.updateContactOutcome({ customerId: delivery.customerId, target, error: null });
      continue;
    }

    // Time-lock: para o LOTE inteiro. Continuar enviando durante um bloqueio de
    // novas conversas só agrava a restrição do número.
    if (result.errorKey === "WHATSAPP_REACHOUT_TIMELOCK") {
      const until = result.retryAt ?? now() + 24 * 60 * 60_000;
      summary.paused = true;
      summary.pauseReason = `WhatsApp bloqueou novas conversas: ${result.errorMessage ?? "time-lock"}`;
      await adapter.onGlobalPause?.(until, summary.pauseReason);
      for (const item of claimed.slice(index)) {
        await deps.outbox.release({ deliveryId: item.id, scheduledFor: until, reason: "canal em time-lock" });
        summary.released++;
        summary.results.push({
          deliveryId: item.id,
          customerId: item.customerId,
          target: item.target,
          ok: false,
          status: "queued",
          reason: "canal em time-lock — reagendado",
        });
      }
      log("time-lock: lote interrompido", { pauseUntil: until });
      break;
    }

    // Resultado incerto (timeout): NÃO repetir automaticamente. O envio pode ter
    // acontecido; repetir cego entrega mensagem duplicada ao cliente.
    if (result.uncertain) {
      summary.uncertain++;
      push({ ok: false, status: "failed", reason: result.errorMessage ?? "resultado incerto" });
      await deps.outbox.markFailed({
        deliveryId: delivery.id,
        errorKey: result.errorKey ?? "UNCERTAIN",
        errorMessage: result.errorMessage ?? "resultado incerto — verificar antes de reenviar",
        permanent: true,
      });
      continue;
    }

    if (result.permanent) {
      summary.failed++;
      push({ ok: false, status: "failed", reason: result.errorMessage ?? "falha permanente" });
      await deps.outbox.markFailed({
        deliveryId: delivery.id,
        errorKey: result.errorKey ?? "PERMANENT",
        errorMessage: result.errorMessage ?? "falha permanente",
        permanent: true,
      });
      await adapter.onPermanentFailure?.(target, result);
      await deps.outbox.updateContactOutcome({ customerId: delivery.customerId, target, error: result.errorMessage ?? "falha permanente" });
      continue;
    }

    // Transitório: volta para a fila com backoff exponencial + jitter.
    const attempts = Math.max(delivery.attempts, 1);
    const backoff = Math.min(60 * 60_000, 60_000 * 2 ** (attempts - 1));
    const retryAt = (result.retryAt ?? now() + backoff) + (delivery.id.length * 137) % 30_000;
    summary.released++;
    push({ ok: false, status: "queued", reason: `${result.errorMessage ?? "erro transitório"} — tentativa ${attempts}` });
    await deps.outbox.markFailed({
      deliveryId: delivery.id,
      errorKey: result.errorKey ?? "TRANSIENT",
      errorMessage: `${result.errorMessage ?? "erro transitório"} (tentativa ${attempts})`,
      retryAt,
    });
  }

  return summary;
}
