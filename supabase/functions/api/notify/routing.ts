/**
 * Roteamento e decisão. Módulo puro (ver `model.ts`).
 *
 * É a cascata de `NOTIFICACOES-HUB.md` §5, na forma executável. A distinção central:
 *
 *   bloqueio ESTRUTURAL  → o canal não existe para esse cliente agora
 *                          (sem opt-in, sem celular válido, desligado, desconectado)
 *                          ⇒ cai para o próximo canal (fallback_push)
 *
 *   bloqueio TRANSITÓRIO → o canal existe, mas não pode enviar neste momento
 *                          (fora da janela, cota do dia, time-lock do WhatsApp)
 *                          ⇒ adia e mantém o canal (defer_*)
 *
 * Trocar de canal por causa de bloqueio transitório seria pior que atrasar: o
 * cliente com opt-in de WhatsApp receberia push por causa de uma cota estourada.
 */

import { addDays, diffDays, type Channel, type PhoneFailure } from "./model.ts";
import type { PlannedNotification } from "./rules.ts";

export type DecisionCode =
  | "send_whatsapp"
  | "fallback_push"
  | "defer_window"
  | "defer_cap"
  | "defer_locked"
  | "skip_dedupe"
  | "skip_no_channel"
  | "skip_superseded";

export interface CustomerReach {
  customerId: string;
  push: boolean;
  whatsappOptIn: boolean;
  whatsappPhone?: string;
  phoneField?: string;
  phoneFailure?: PhoneFailure;
  /** Já existe conversa aberta com esse número (não consome cota de nova conversa). */
  hasExistingConversation: boolean;
}

export interface RoutingState {
  from: string;
  runAtHour: number;
  whatsappEnabled: boolean;
  instanceConnected: boolean;
  /** Time-lock do WhatsApp (erro 463): pausa tudo no canal até esse instante. */
  pausedUntilMs: number | null;
  windowStart: number;
  windowEnd: number;
  newChatCapPerDay: number;
  perCustomerCapPerDay: number;
  alreadySent: Set<string>;
  nowMs: number;
}

export interface Decision {
  dedupeKey: string;
  decision: DecisionCode;
  channel?: Channel;
  reason: string;
  scheduledFor: string;
  inNewChatQuota: boolean;
  whatsappBlockReason?: string;
}

export interface QueueProjection {
  newChatQuotaPerDay: number;
  /** Candidatos que consumiriam cota de nova conversa. */
  newChatCandidates: number;
  /** Dias necessários para escoar a fila respeitando a cota (null = cabe no dia). */
  exhaustionDays: number | null;
  deferredByCap: number;
  deferredByWindow: number;
}

export interface RoutingResult {
  decisions: Decision[];
  queue: QueueProjection;
}

/** Quantos dias um aviso pode ser adiado por cota antes de perder o sentido. */
const MAX_DEFER_DAYS = 45;
/** Teto de adiamento de um aviso de atraso (depois disso, a regra seguinte assume). */
const MAX_LATE_DEFER_DAYS = 5;

const DECISION_REASON: Record<DecisionCode, string> = {
  send_whatsapp: "envia no WhatsApp",
  fallback_push: "WhatsApp indisponível para este cliente — envia por push",
  defer_window: "fora da janela de envio — adiado para a próxima janela",
  defer_cap: "cota de envios do dia atingida — adiado",
  defer_locked: "WhatsApp em restrição temporária (time-lock) — adiado",
  skip_dedupe: "já enviado (dedupe_key existente)",
  skip_no_channel: "sem canal elegível (sem opt-in de WhatsApp e sem inscrição push)",
  skip_superseded: "adiamento passaria do vencimento — a regra seguinte assume",
};

/**
 * Motivo pelo qual o WhatsApp não é uma opção ESTRUTURAL para este cliente.
 * Instância desconectada e time-lock NÃO entram aqui: são transitórios e o aviso
 * é adiado no próprio canal, não trocado por outro (ver cabeçalho do arquivo).
 */
function whatsappStructuralBlock(reach: CustomerReach, state: RoutingState): string | null {
  if (!state.whatsappEnabled) return "WhatsApp desligado na configuração";
  if (!reach.whatsappOptIn) return "cliente sem opt-in de WhatsApp";
  if (!reach.whatsappPhone) {
    return reach.phoneFailure === "landline"
      ? "só telefone fixo"
      : reach.phoneFailure === "empty"
        ? "sem telefone cadastrado"
        : "telefone inválido";
  }
  return null;
}

export function decideAll(planned: PlannedNotification[], reach: Map<string, CustomerReach>, state: RoutingState): RoutingResult {
  const decisions: Decision[] = [];
  /** `${dia}|${cliente}` → envios no dia (cota por cliente). */
  const perCustomerDay = new Map<string, number>();
  /** `dia` → conversas novas iniciadas no dia (cota global). */
  const newChatDay = new Map<string, number>();
  let deferredByCap = 0;
  let deferredByWindow = 0;

  const plannedNewChats = planned.filter((item) => {
    const r = reach.get(item.customerId);
    return Boolean(r) && !r!.hasExistingConversation && !whatsappStructuralBlock(r!, state);
  });

  for (const item of planned) {
    const customerReach = reach.get(item.customerId);
    const base = { dedupeKey: item.dedupeKey, scheduledFor: item.sendDate, inNewChatQuota: false };

    if (state.alreadySent.has(item.dedupeKey)) {
      decisions.push({ ...base, decision: "skip_dedupe", reason: DECISION_REASON.skip_dedupe });
      continue;
    }

    const structural = customerReach ? whatsappStructuralBlock(customerReach, state) : "destinatário não resolvido";

    if (structural) {
      // Fallback só para bloqueio estrutural: o WhatsApp não existe para este
      // cliente, então o push é a única forma de ele saber da fatura.
      if (customerReach?.push) {
        decisions.push({
          ...base,
          decision: "fallback_push",
          channel: "push",
          reason: `${DECISION_REASON.fallback_push} (${structural})`,
          whatsappBlockReason: structural,
        });
        continue;
      }
      decisions.push({
        ...base,
        decision: "skip_no_channel",
        reason: `${DECISION_REASON.skip_no_channel} — ${structural}`,
        whatsappBlockReason: structural,
      });
      continue;
    }

    // Bloqueios TRANSITÓRIOS do canal: adia mantendo o WhatsApp, sem fallback.
    if (!state.instanceConnected) {
      decisions.push({
        ...base,
        decision: "defer_locked",
        channel: "whatsapp",
        reason: "instância do WhatsApp desconectada — adiado até reconectar",
      });
      continue;
    }

    // Time-lock do WhatsApp (erro 463): o servidor recusa novas conversas por
    // volume/qualidade. Adia até a data informada em `paused_until`.
    if (state.pausedUntilMs !== null && state.pausedUntilMs > state.nowMs) {
      const until = new Date(state.pausedUntilMs).toISOString().slice(0, 10);
      decisions.push({
        ...base,
        decision: "defer_locked",
        channel: "whatsapp",
        scheduledFor: until,
        reason: `${DECISION_REASON.defer_locked} até ${until}`,
      });
      continue;
    }

    // Janela horária: se a hora de execução já passou do fim, só amanhã.
    let day = item.sendDate;
    if (state.runAtHour < state.windowStart) {
      deferredByWindow++;
      decisions.push({
        ...base,
        decision: "defer_window",
        channel: "whatsapp",
        scheduledFor: day,
        reason: `${DECISION_REASON.defer_window} (hoje às ${state.windowStart}h)`,
      });
      continue;
    }
    if (state.runAtHour >= state.windowEnd) {
      deferredByWindow++;
      day = addDays(day, 1);
      decisions.push({
        ...base,
        decision: "defer_window",
        channel: "whatsapp",
        scheduledFor: day,
        reason: `${DECISION_REASON.defer_window} (amanhã às ${state.windowStart}h)`,
      });
      continue;
    }

    // Cotas: procura o primeiro dia com espaço, respeitando o limite de adiamento.
    const slot = findSlot(item, customerReach!, day, state, perCustomerDay, newChatDay);

    if (!slot.ok) {
      decisions.push({ ...base, decision: "skip_superseded", reason: `${DECISION_REASON.skip_superseded} (${slot.reason})` });
      continue;
    }

    const key = `${slot.day}|${item.customerId}`;
    perCustomerDay.set(key, (perCustomerDay.get(key) ?? 0) + 1);
    if (slot.newChat) newChatDay.set(slot.day, (newChatDay.get(slot.day) ?? 0) + 1);

    if (slot.deferred) {
      deferredByCap++;
      decisions.push({
        ...base,
        decision: "defer_cap",
        channel: "whatsapp",
        scheduledFor: slot.day,
        inNewChatQuota: slot.newChat,
        reason: `${DECISION_REASON.defer_cap} para ${slot.day} (${slot.reason})`,
      });
      continue;
    }

    decisions.push({
      ...base,
      decision: "send_whatsapp",
      channel: "whatsapp",
      inNewChatQuota: slot.newChat,
      reason: slot.newChat ? `${DECISION_REASON.send_whatsapp} (nova conversa)` : DECISION_REASON.send_whatsapp,
    });
  }

  const newChatCandidates = plannedNewChats.length;
  const exhaustionDays = state.newChatCapPerDay > 0 ? Math.ceil(newChatCandidates / state.newChatCapPerDay) : null;

  return {
    decisions,
    queue: {
      newChatQuotaPerDay: state.newChatCapPerDay,
      newChatCandidates,
      exhaustionDays: exhaustionDays && exhaustionDays > 1 ? exhaustionDays : null,
      deferredByCap,
      deferredByWindow,
    },
  };
}

interface SlotResult {
  ok: boolean;
  day: string;
  deferred: boolean;
  newChat: boolean;
  reason: string;
}

/**
 * Encontra o primeiro dia em que o aviso cabe nas cotas.
 *
 * Regra de coerência: aviso *antes* do vencimento não pode ser adiado para depois
 * do vencimento — o aviso "vence hoje" já cobre. Aviso de atraso pode escorregar
 * até MAX_LATE_DEFER_DAYS antes de a regra seguinte assumir.
 */
function findSlot(
  item: PlannedNotification,
  reach: CustomerReach,
  startDay: string,
  state: RoutingState,
  perCustomerDay: Map<string, number>,
  newChatDay: Map<string, number>
): SlotResult {
  const isNewChat = !reach.hasExistingConversation;
  let day = startDay;
  let reason = "";

  for (let attempt = 0; attempt <= MAX_DEFER_DAYS; attempt++) {
    const dayShift = diffDays(day, startDay);
    const lateCap = item.ruleOffsetDays < 0 ? 0 : MAX_LATE_DEFER_DAYS;
    if (item.ruleOffsetDays < 0) {
      if (diffDays(day, item.dueDate) > 0) return { ok: false, day, deferred: false, newChat: isNewChat, reason: "adiado além do vencimento" };
    } else if (dayShift > lateCap) {
      return { ok: false, day, deferred: false, newChat: isNewChat, reason: `adiado mais de ${MAX_LATE_DEFER_DAYS} dias` };
    }

    const customerCount = perCustomerDay.get(`${day}|${item.customerId}`) ?? 0;
    if (customerCount >= state.perCustomerCapPerDay) {
      reason = `limite de ${state.perCustomerCapPerDay}/dia deste cliente em ${day}`;
      day = addDays(day, 1);
      continue;
    }

    if (isNewChat && state.newChatCapPerDay > 0) {
      const used = newChatDay.get(day) ?? 0;
      if (used >= state.newChatCapPerDay) {
        reason = `cota de novas conversas de ${day} esgotada (${used}/${state.newChatCapPerDay})`;
        day = addDays(day, 1);
        continue;
      }
    }

    return { ok: true, day, deferred: day !== startDay, newChat: isNewChat, reason: reason || "cota disponível" };
  }

  return { ok: false, day, deferred: false, newChat: isNewChat, reason: "sem cota em 45 dias" };
}
