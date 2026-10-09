/**
 * Regras de lembrete → planejamento. Módulo puro (ver `model.ts`).
 *
 * Aqui mora a única resposta para "quais avisos sairiam neste dia". O planejamento
 * transforma faturas em `PlannedNotification[]`, ainda sem saber de canal, opt-in,
 * cota ou janela — isso é o roteamento (`routing.ts`). Separar os dois estágios é
 * o que permite ao simulador dizer *por que* algo não saiu, e não só que não saiu.
 */

import {
  addDays,
  billingValue,
  classifyBilling,
  diffDays,
  isCivilDate,
  isInactiveCustomer,
  type RawBilling,
  type RawCustomer,
} from "./model.ts";

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

export interface ReminderRule {
  key: string;
  /** Evento do hub que esta regra produz (`NOTIFICACOES-HUB.md` §4). */
  eventKey: string;
  /** Deslocamento em dias a partir do vencimento. Negativo = antes de vencer. */
  offsetDays: number;
  active: boolean;
  /** Ordem de prioridade na fila quando a cota do dia aperta (menor primeiro). */
  sortOrder: number;
  label: string;
}

/**
 * Evento da MENSAGEM DEDICADA de observação. Não é cobrança: é o aviso de que existe
 * um acordo/agendamento ativo para a fatura. Fica num evento próprio para nunca ser
 * confundido com `billing.late`/`due_*` na fila, no revalidador ou no painel.
 */
export const OBSERVATION_EVENT_KEY = "billing.observation";

/**
 * Regras default propostas em `LEMBRETES-WHATSAPP.md` §6.
 * `late_10` fica desligada de propósito: só liga depois de validar `late_5`.
 *
 * `observation` também nasce DESLIGADA: fatura em observação (acordo pedido pelo
 * cliente) não deve ser cobrada por padrão. Ligar a regra na régua troca o silêncio
 * pela mensagem dedicada — nunca por cobrança, porque ela aponta para outro evento.
 */
export const DEFAULT_RULES: ReminderRule[] = [
  { key: "d_minus_3", eventKey: "billing.due_soon", offsetDays: -3, active: true, sortOrder: 30, label: "3 dias antes do vencimento" },
  { key: "due_day", eventKey: "billing.due_today", offsetDays: 0, active: true, sortOrder: 10, label: "no dia do vencimento" },
  { key: "late_1", eventKey: "billing.late", offsetDays: 1, active: true, sortOrder: 20, label: "1 dia de atraso" },
  { key: "late_5", eventKey: "billing.late", offsetDays: 5, active: true, sortOrder: 40, label: "5 dias de atraso" },
  { key: "late_10", eventKey: "billing.late", offsetDays: 10, active: false, sortOrder: 50, label: "10 dias de atraso" },
  { key: "observation", eventKey: OBSERVATION_EVENT_KEY, offsetDays: 0, active: false, sortOrder: 5, label: "Aviso de acordo (fatura em observação)" },
];

// ---------------------------------------------------------------------------
// Planejamento
// ---------------------------------------------------------------------------

export interface PlannedNotification {
  billingId: string;
  customerId: string;
  ruleKey: string;
  eventKey: string;
  /** Chave de idempotência do evento — ver NOTIFICACOES-HUB.md §6. */
  dedupeKey: string;
  dueDate: string;
  /** Data civil em que o aviso deveria sair (vencimento + offset). */
  sendDate: string;
  ruleOffsetDays: number;
  /** Dias desde o vencimento até `today` (positivo = já venceu). */
  overdueDays: number;
  reference: string;
  situation: string;
}

export interface PlanCounts {
  billingsScanned: number;
  billingsOpen: number;
  billingsPaid: number;
  billingsCanceled: number;
  /** Faturas "Em Observação" (acordo ativo) — fora da cobrança por definição. */
  billingsObservation: number;
  billingsUnknownSituation: number;
  billingsInvalidDueDate: number;
  billingsInactiveCustomer: number;
  /** Regras cujo dia de envio já passou (não há disparo retroativo). */
  missedWindows: number;
  /** Regras cujo dia de envio está além do horizonte simulado. */
  beyondHorizon: number;
  rulesEvaluated: number;
}

export interface PlanResult {
  planned: PlannedNotification[];
  counts: PlanCounts;
  /** Faturas que ficaram fora da janela por estarem vencidas há muito tempo. */
  staleBillingIds: string[];
}

export interface PlanInput {
  billings: RawBilling[];
  customers?: Map<string, RawCustomer>;
  from: string;
  horizonDays: number;
  rules?: ReminderRule[];
  /** Clientes inativos (bloqueado/cancelado) não recebem cobrança. */
  skipInactiveCustomers?: boolean;
}

export function planNotifications(input: PlanInput): PlanResult {
  const activeRules = (input.rules ?? DEFAULT_RULES).filter((rule) => rule.active);
  // Duas réguas SEPARADAS: a de cobrança e a mensagem dedicada de observação. Uma
  // fatura em observação nunca entra na régua de cobrança, e as regras de cobrança
  // nunca pegam uma fatura em observação.
  const billingRules = activeRules.filter((rule) => rule.eventKey !== OBSERVATION_EVENT_KEY);
  const observationRules = activeRules.filter((rule) => rule.eventKey === OBSERVATION_EVENT_KEY);
  const skipInactive = input.skipInactiveCustomers ?? true;
  const to = addDays(input.from, Math.max(0, input.horizonDays - 1));

  const counts: PlanCounts = {
    billingsScanned: 0,
    billingsOpen: 0,
    billingsPaid: 0,
    billingsCanceled: 0,
    billingsObservation: 0,
    billingsUnknownSituation: 0,
    billingsInvalidDueDate: 0,
    billingsInactiveCustomer: 0,
    missedWindows: 0,
    beyondHorizon: 0,
    rulesEvaluated: 0,
  };

  const planned: PlannedNotification[] = [];
  const staleBillingIds: string[] = [];
  const maxOffset = Math.max(...billingRules.map((rule) => rule.offsetDays), 0);

  for (const billing of input.billings) {
    counts.billingsScanned++;

    const state = classifyBilling(billing.situation_name);
    if (state === "paid") {
      counts.billingsPaid++;
      continue;
    }
    if (state === "canceled") {
      counts.billingsCanceled++;
      continue;
    }
    if (state === "unknown") {
      // Conservador: situação que não entendemos não vira cobrança.
      counts.billingsUnknownSituation++;
      continue;
    }

    // "Em Observação" = acordo/agendamento pedido pelo cliente. Por PADRÃO não dispara
    // cobrança: a régua de observação nasce desligada, então a fatura só é contada e
    // fica de fora. Com a regra ligada, gera APENAS a mensagem dedicada — nunca a cobrança.
    if (state === "observation") {
      counts.billingsObservation++;
      if (observationRules.length === 0) continue;
    } else {
      counts.billingsOpen++;
    }
    const applicableRules = state === "observation" ? observationRules : billingRules;

    const dueDate = billing.due_day;
    if (!isCivilDate(dueDate)) {
      counts.billingsInvalidDueDate++;
      continue;
    }

    const customerId = String(billing.customer_id ?? "");
    const customer = input.customers?.get(customerId);
    if (skipInactive && customer && isInactiveCustomer(customer.status)) {
      counts.billingsInactiveCustomer++;
      continue;
    }

    const overdueDays = diffDays(input.from, dueDate);
    // Fatura muito antiga: as regras de atraso já passaram e não queremos
    // disparar uma rajada retroativa no primeiro dia de operação. Vale só para a
    // cobrança — a mensagem de observação não é uma rajada de atraso.
    if (state !== "observation" && overdueDays > maxOffset + input.horizonDays) {
      staleBillingIds.push(String(billing.id));
    }

    const reference = String(billing.reference ?? billing.id ?? "");
    const situation = String(billing.situation_name ?? "");

    for (const rule of applicableRules) {
      counts.rulesEvaluated++;
      const sendDate = addDays(dueDate, rule.offsetDays);

      if (diffDays(sendDate, input.from) < 0) {
        counts.missedWindows++;
        continue;
      }
      if (diffDays(sendDate, to) > 0) {
        counts.beyondHorizon++;
        continue;
      }

      planned.push({
        billingId: String(billing.id),
        customerId,
        ruleKey: rule.key,
        eventKey: rule.eventKey,
        dedupeKey: `billing:${billing.id}:${rule.key}`,
        dueDate,
        sendDate,
        ruleOffsetDays: rule.offsetDays,
        overdueDays,
        reference,
        situation,
      });
    }
  }

  planned.sort(comparePlanned(activeRules));
  return { planned, counts, staleBillingIds };
}

/**
 * Prioridade da fila quando a cota do dia não cobre todos os candidatos.
 * Ordem default, por urgência comercial:
 *   1. vence hoje (o aviso evita o atraso)
 *   2. vencimento mais próximo
 *   3. atraso mais antigo (cobrança)
 * `sortOrder` da regra desempata.
 */
export function comparePlanned(rules: ReminderRule[]) {
  const order = new Map(rules.map((rule) => [rule.key, rule.sortOrder]));
  return (a: PlannedNotification, b: PlannedNotification): number => {
    if (a.sendDate !== b.sendDate) return a.sendDate < b.sendDate ? -1 : 1;
    const aRelative = a.overdueDays;
    const bRelative = b.overdueDays;
    const aUrgency = aRelative > 0 ? 1 : aRelative === 0 ? 0 : 2;
    const bUrgency = bRelative > 0 ? 1 : bRelative === 0 ? 0 : 2;
    if (aUrgency !== bUrgency) return aUrgency - bUrgency;
    if (aUrgency === 2 && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (aUrgency === 1 && a.dueDate !== b.dueDate) return a.dueDate > b.dueDate ? -1 : 1;
    const aOrder = order.get(a.ruleKey) ?? 99;
    const bOrder = order.get(b.ruleKey) ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0;
  };
}

/** Valor a exibir no aviso (inclui multa/juros quando a API informa). */
export function plannedValue(billing: RawBilling) {
  return billingValue(billing);
}
