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
import { renderFor, EVENT_DUE_DATE, EVENT_URL, type ChannelTemplate, type TemplatePayload } from "./templates.ts";
import type { ChannelRegistry, Rendered } from "./channel.ts";
import type { ClaimedDelivery, OutboxApi, OutboxEvent } from "./outbox.ts";

export interface DispatchDeps {
  outbox: OutboxApi;
  registry: ChannelRegistry;
  templates?: ChannelTemplate[];
  now?: () => number;
  /** Tentativas máximas antes de desistir (falha permanente). */
  maxAttempts?: number;
  /** Cota de mensagens por cliente por dia, quando `policy: "automated"`. */
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

  return {
    title: rendered.message.title,
    body: rendered.message.body,
    url: typeof raw[EVENT_URL] === "string" ? (raw[EVENT_URL] as string) : undefined,
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

    const rendered = renderAtSendTime({ event, channel, sendDate: todayIso, templates: deps.templates });
    if (!rendered) {
      summary.skipped++;
      push({ ok: false, status: "skipped", reason: `sem template ativo para ${channel}/${event.eventKey}` });
      await deps.outbox.markSkipped(delivery.id, `sem template ativo para ${channel}/${event.eventKey}`);
      continue;
    }

    if (Number.isFinite(cap) && delivery.customerId) {
      const recent = await deps.outbox.countRecentForCustomer({ customerId: delivery.customerId, channel, since: dayStart });
      if (recent >= cap) {
        const retryAt = await nextWindowOpenMs(deps, channel, now());
        summary.released++;
        push({ ok: false, status: "queued", reason: `cota de ${cap}/dia do cliente atingida — reagendado` });
        await deps.outbox.release({ deliveryId: delivery.id, scheduledFor: retryAt, reason: `cota por cliente (${cap}/dia)` });
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
      await deps.outbox.markSent(delivery.id, result.providerId ?? null);
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
