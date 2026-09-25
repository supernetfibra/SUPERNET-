/**
 * Estágio de SYNC: base real → eventos na outbox.
 *
 * Até aqui nada era automático: o painel enfileirava uma fatura por clique. Este módulo
 * é o que faz a régua sair sozinha — lê a base, planeja com o **mesmo núcleo puro** do
 * simulador (`rules.ts` + `reach.ts`) e enfileira o dia no outbox, de onde o dispatcher
 * (cron de 5–15 min) entrega sem ninguém olhando.
 *
 * ## A fronteira deste estágio (o que ele NÃO decide)
 * Cota, janela, time-lock, ordem de fila e horário do disparo continuam sendo decisão do
 * dispatcher — que é quem conversa com o provedor e sabe do estado do canal. Aqui só se
 * responde "quais avisos pertencem a este dia, para quem e com qual texto". Se o sync
 * também aplicasse as cotas, existiriam dois lugares decidindo a mesma coisa e o
 * relatório voltaria a mentir sobre o envio (ver `routing.ts`).
 *
 * ## Por que um dia, e não o horizonte inteiro
 * `days: 1` (o padrão) enfileira só os avisos de hoje. Não é timidez: entre enfileirar e
 * enviar, o cliente pode **pagar a fatura** — e o lembrete de uma fatura paga é o pior
 * erro possível deste pipeline (o dispatcher não relê a situação; ele só tem o payload).
 * Enfileirando o dia, essa janela de risco é de horas, e não de dias. `days > 1` existe
 * para recarga deliberada (e está documentado como tal), não para operação normal.
 *
 * ## Idempotência
 * A chave de deduplicação é a do planejamento (`billing:<id>:<regra>`) — a MESMA que o
 * simulador usa em `dedupeKey`. Rodar o sync duas vezes no mesmo dia não manda dois
 * lembretes: o `enqueue_notification` no banco recusa a segunda (migration 003). A lista
 * de chaves já existentes (`alreadySent`) é só um atalho para não chamar o banco à toa.
 */

import { addDays, civilDayStartMs, civilToday, isCivilDate, maskPhone, type Channel, type RawBilling, type RawCustomer } from "./model.ts";
import { activeRules, type NotificationSettings } from "./settings.ts";
import { planNotifications, type ReminderRule } from "./rules.ts";
import { resolveReach, type SimulationContact } from "./reach.ts";
import { buildPayload, renderFor, toStoredPayload, type ChannelTemplate } from "./templates.ts";
import type { OutboxApi } from "./outbox.ts";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Por que um aviso planejado não virou evento na fila.
 *
 * A precedência importa e é esta (na dúvida, vence o motivo mais a montante):
 *   1. `no_customer`       — não há cadastro para montar a mensagem
 *   2. `already_enqueued`  — já existe evento com esta chave (dedupe)
 *   3. `channel_disabled`  — o canal está desligado na configuração
 *   4. `no_template`       — não há template ativo para o evento
 *   5. elegibilidade: `push_pending` (só teria push), `no_opt_in`, `invalid_phone`,
 *      `no_channel` (nem WhatsApp nem push)
 *
 * `push_pending` vence `no_opt_in`/`invalid_phone` de propósito: ele diz que o aviso
 * teria destino hoje se o adapter de push estivesse migrado — informação mais útil do
 * que "sem opt-in".
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
  /** Instante em que a entrega fica disponível (primeira janela do dia do aviso). */
  scheduledFor: number;
  channel: Channel | null;
  target: string | null;
  targetMasked: string | null;
  outcome: "enqueue" | "skip";
  reason: SyncSkipReason | null;
  /** Explicação humana do motivo (ex.: "só telefone fixo", "sem opt-in de WhatsApp"). */
  detail: string;
  preview: { title?: string; body: string } | null;
  /** Payload do evento, já com os metadados que o dispatcher lê. */
  payload: Record<string, unknown> | null;
}

export interface SyncPlanInput {
  billings: RawBilling[];
  customers: RawCustomer[];
  contacts?: SimulationContact[];
  pushCustomerIds?: string[];
  alreadySent?: Iterable<string>;
  settings: NotificationSettings;
  templates?: ChannelTemplate[];
  /** Primeiro dia a enfileirar (`YYYY-MM-DD`). */
  from: string;
  /** Quantos dias enfileirar a partir de `from`. Default 1. */
  days?: number;
  nowMs?: number;
}

export interface SyncPlan {
  items: SyncItem[];
  /** Motivo que impede o lote inteiro (hoje, só canal desligado). */
  blocked: SyncSkipReason | null;
  counts: {
    planned: number;
    toEnqueue: number;
    skipped: Record<SyncSkipReason, number>;
    byRule: Record<string, number>;
  };
  /** Janela de vencimento consultada, para o relatório não ser um número solto. */
  dueWindow: { from: string; to: string };
  rulesActive: string[];
  templateWarnings: string[];
}

const HOUR_MS = 60 * 60_000;

function emptySkips(): Record<SyncSkipReason, number> {
  return {
    channel_disabled: 0,
    no_customer: 0,
    already_enqueued: 0,
    no_template: 0,
    no_opt_in: 0,
    invalid_phone: 0,
    push_pending: 0,
    no_channel: 0,
  };
}

/**
 * Janela de VENCIMENTO que cobre os avisos de `[from, from + days - 1]`.
 *
 * Uma fatura com vencimento em D gera aviso em `D + offsetDays`, então o aviso cai na
 * janela quando `D ∈ [from - maxOffset, to - minOffset]`. É por isso que o sync não pode
 * simplesmente varrer "as faturas de hoje": a régua padrão inclui `d_minus_3`, cujo
 * aviso de hoje é de uma fatura que vence em três dias.
 */
export function syncDueWindow(rules: ReminderRule[], from: string, days: number): { from: string; to: string } {
  const active = rules.filter((rule) => rule.active);
  if (!active.length) return { from, to: from };

  const offsets = active.map((rule) => rule.offsetDays);
  const to = addDays(from, Math.max(0, days - 1));
  return { from: addDays(from, -Math.max(...offsets)), to: addDays(to, -Math.min(...offsets)) };
}

/** Meio-dia do dia civil: base segura para o começo do dia no fuso do projeto (UTC-3). */
function dayStartOf(sendDate: string): number {
  return civilDayStartMs(new Date(`${sendDate}T12:00:00Z`).getTime());
}

/**
 * O planejamento do dia, como função pura dos dados — a mesma forma do
 * `runSimulation`, para o teste poder rodar as duas sobre a mesma base e comparar.
 */
export function planSync(input: SyncPlanInput): SyncPlan {
  const settings = input.settings;
  const days = Math.max(1, Math.min(input.days ?? 1, Math.max(1, settings.horizonDays)));
  const nowMs = input.nowMs ?? Date.now();
  const dueWindow = syncDueWindow(settings.rules, input.from, days);
  const rules = activeRules(settings.rules);

  const billingMap = new Map(input.billings.map((billing) => [String(billing.id), billing]));
  const customerMap = new Map(input.customers.map((customer) => [String(customer.id), customer]));
  const reach = resolveReach(input);
  const already = new Set<string>([...(input.alreadySent ?? [])].map(String));

  const plan = planNotifications({
    billings: input.billings,
    customers: customerMap,
    from: input.from,
    horizonDays: days,
    rules: settings.rules,
    skipInactiveCustomers: settings.skipInactiveCustomers,
  });

  const skipped = emptySkips();
  const byRule: Record<string, number> = {};
  const warnings = new Set<string>();
  const items: SyncItem[] = [];
  const channelEnabled = settings.whatsapp.enabled;

  const push = (item: SyncItem) => {
    items.push(item);
    if (item.outcome === "skip" && item.reason) skipped[item.reason]++;
  };

  for (const planned of plan.planned) {
    const billing = billingMap.get(planned.billingId);
    const customer = customerMap.get(planned.customerId);
    const owner = reach.get(planned.customerId);

    byRule[planned.ruleKey] = (byRule[planned.ruleKey] ?? 0) + 1;

    const base: SyncItem = {
      dedupeKey: planned.dedupeKey,
      eventKey: planned.eventKey,
      ruleKey: planned.ruleKey,
      billingId: planned.billingId,
      customerId: planned.customerId,
      customerName: String(customer?.full_name ?? `cliente ${planned.customerId}`),
      reference: planned.reference,
      dueDate: planned.dueDate,
      sendDate: planned.sendDate,
      // O aviso fica disponível na PRIMEIRA janela do dia dele; se essa hora já passou,
      // já (`now`), para o próximo cron pegar — o dispatcher é quem decide se a janela
      // ainda está aberta. Nunca no passado: reagendar para trás é laço de claim/release.
      scheduledFor: Math.max(
        dayStartOf(planned.sendDate) + settings.whatsapp.windowStart * HOUR_MS,
        nowMs
      ),
      channel: null,
      target: null,
      targetMasked: null,
      outcome: "skip",
      reason: null,
      detail: "",
      preview: null,
      payload: null,
    };

    const skip = (reason: SyncSkipReason, detail: string) => push({ ...base, outcome: "skip", reason, detail });

    if (!billing || !customer) {
      skip("no_customer", !billing ? "fatura não está na base carregada" : "cadastro do cliente não foi carregado");
      continue;
    }
    if (already.has(planned.dedupeKey)) {
      skip("already_enqueued", "já existe evento com esta chave no outbox");
      continue;
    }
    if (!channelEnabled) {
      skip("channel_disabled", "canal WhatsApp desligado na configuração");
      continue;
    }

    const payload = buildPayload({
      customer,
      billing,
      dueDate: planned.dueDate,
      reference: planned.reference,
      // A data de referência é o DIA DO ENVIO, não hoje: um aviso de atraso marcado para
      // depois amanhã precisa contar os dias de amanhã (o dispatcher recalcula no envio).
      referenceDate: planned.sendDate,
      portalBaseUrl: settings.portalBaseUrl,
      companyName: settings.companyName,
    });
    const rendered = renderFor("whatsapp", planned.eventKey, payload, input.templates);
    for (const warning of rendered.warnings) warnings.add(warning);

    if (!rendered.message) {
      skip("no_template", `sem template ativo para whatsapp/${planned.eventKey}`);
      continue;
    }

    if (!owner?.whatsappOptIn || !owner.whatsappPhone) {
      const whatsappGap = !owner?.whatsappOptIn
        ? "sem opt-in de WhatsApp"
        : owner.phoneFailure === "landline"
          ? "só telefone fixo"
          : owner.phoneFailure === "empty"
            ? "sem telefone cadastrado"
            : "telefone não é celular válido";
      if (owner?.push) skip("push_pending", `teria destino por push (${whatsappGap}); adapter de push não migrado`);
      else if (!owner?.whatsappOptIn) skip("no_opt_in", whatsappGap);
      else skip("invalid_phone", whatsappGap);
      continue;
    }

    push({
      ...base,
      channel: "whatsapp",
      target: owner.whatsappPhone,
      targetMasked: maskPhone(owner.whatsappPhone),
      outcome: "enqueue",
      reason: null,
      detail: "enfileirado pelo sync",
      preview: { title: rendered.message.title, body: rendered.message.body },
      payload: toStoredPayload(payload, planned.dueDate),
    });
  }

  return {
    items,
    // Canal desligado bloqueia o LOTE: sem isso a fila encheria de avisos que só sairiam
    // (todos de uma vez) no dia em que o canal fosse ligado — rajada retroativa.
    blocked: channelEnabled ? null : "channel_disabled",
    counts: {
      planned: plan.planned.length,
      toEnqueue: items.filter((item) => item.outcome === "enqueue").length,
      skipped,
      byRule,
    },
    dueWindow,
    rulesActive: rules.map((rule) => rule.key),
    templateWarnings: [...warnings],
  };
}

// ---------------------------------------------------------------------------
// Execução (a única parte com I/O)
// ---------------------------------------------------------------------------

export interface SyncBase {
  customers: RawCustomer[];
  billings: RawBilling[];
  pushCustomerIds: string[];
  contacts: SimulationContact[];
  alreadySent: string[];
  assumptions?: string[];
  /** Quantos itens a fonte conseguiu ler — o relatório declara, não estima. */
  scanned?: { billings: number; customers: number; contacts: number };
}

export type SyncBaseLoader = (options: { dueFrom: string; dueTo: string }) => Promise<SyncBase>;

export interface SyncSettingsView {
  settings: NotificationSettings;
  origin: "db" | "defaults";
  updatedAt?: number | null;
  updatedBy?: string | null;
  notes?: string[];
  fingerprint: string;
}

export interface SyncDeps {
  outbox: OutboxApi;
  getSettings: () => Promise<SyncSettingsView>;
  /** Carrega a base real (só leitura). Injetado: as credenciais da MikWeb vivem no
   *  `index.ts`, e assim este módulo continua typecheckável fora do Deno. */
  loadBase: SyncBaseLoader;
  templates?: ChannelTemplate[];
  now?: () => number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
  /**
   * Quantos `enqueue` em voo ao mesmo tempo. Default 5.
   *
   * O cron tem orçamento de tempo e cada evento é uma ida ao banco; um dia cheio
   * (200 avisos) em série chega perto do limite da Edge Function. Paralelizar é
   * seguro porque a idempotência é do banco, não do processo — e um erro em qualquer
   * item derruba a rodada inteira (que é idempotente, então repetir não duplica).
   */
  enqueueConcurrency?: number;
}

export interface SyncOptions {
  /** Primeiro dia a enfileirar. Default: hoje (fuso do projeto). */
  from?: string;
  /** Quantos dias enfileirar. Default 1. */
  days?: number;
  /** Planeja e responde, sem gravar nada. */
  dryRun?: boolean;
  /** Teto de itens devolvidos no resumo (a contagem continua completa). */
  itemLimit?: number;
}

export interface SyncSummary {
  dryRun: boolean;
  day: { from: string; to: string; days: number };
  dueWindow: { from: string; to: string };
  settings: { fingerprint: string; origin: "db" | "defaults"; updatedAt: number | null; updatedBy: string | null; rulesActive: string[] };
  source: { billings: number; customers: number; contacts: number };
  plan: SyncPlan["counts"];
  /** Eventos criados nesta rodada. */
  enqueued: number;
  /** Já existiam no outbox (dedupe): a segunda rodada do dia não duplica nada. */
  duplicates: number;
  /** Motivo que impediu o lote inteiro. */
  blocked: SyncSkipReason | null;
  templateWarnings: string[];
  assumptions: string[];
  items: SyncItem[];
  itemsTruncated: boolean;
}

/**
 * Roda o sync: lê a base, planeja e enfileira.
 *
 * Falha de leitura da base **não** é engolida: sem base não há o que enfileirar, e um
 * erro silencioso aqui viraria "não saiu lembrete nenhum hoje" sem ninguém notar. O
 * chamador (rota de cron) responde 5xx e o agendador registra.
 */
export async function runBillingSync(deps: SyncDeps, options: SyncOptions = {}): Promise<SyncSummary> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const loaded = await deps.getSettings();
  const settings = loaded.settings;

  const from = options.from && isCivilDate(options.from) ? options.from : civilToday(now());
  const maxDays = Math.max(1, settings.horizonDays);
  const days = Math.max(1, Math.min(options.days ?? 1, maxDays));
  const dryRun = options.dryRun === true;
  const itemLimit = Math.max(1, options.itemLimit ?? 50);

  const dueWindow = syncDueWindow(settings.rules, from, days);
  const base = await deps.loadBase({ dueFrom: dueWindow.from, dueTo: dueWindow.to });

  const plan = planSync({
    billings: base.billings,
    customers: base.customers,
    contacts: base.contacts,
    pushCustomerIds: base.pushCustomerIds,
    alreadySent: base.alreadySent,
    settings,
    templates: deps.templates,
    from,
    days,
    nowMs: now(),
  });

  const summary: SyncSummary = {
    dryRun,
    day: { from, to: addDays(from, days - 1), days },
    dueWindow: plan.dueWindow,
    settings: {
      fingerprint: loaded.fingerprint,
      origin: loaded.origin,
      updatedAt: loaded.updatedAt ?? null,
      updatedBy: loaded.updatedBy ?? null,
      rulesActive: plan.rulesActive,
    },
    source: {
      billings: base.scanned?.billings ?? base.billings.length,
      customers: base.scanned?.customers ?? base.customers.length,
      contacts: base.scanned?.contacts ?? base.contacts.length,
    },
    plan: plan.counts,
    enqueued: 0,
    duplicates: 0,
    blocked: plan.blocked,
    templateWarnings: plan.templateWarnings,
    assumptions: base.assumptions ?? [],
    items: plan.items.slice(0, itemLimit),
    itemsTruncated: plan.items.length > itemLimit,
  };

  if (dryRun) {
    log("sync em dry-run: nada foi enfileirado", { toEnqueue: plan.counts.toEnqueue, day: summary.day });
    return summary;
  }

  if (plan.blocked) {
    log("sync bloqueado", { reason: plan.blocked, planned: plan.counts.planned });
    return summary;
  }

  // `cpf` acompanha o evento para o painel conseguir cruzar cobrança e cliente sem
  // depender do cadastro da MikWeb — que pode estar indisponível na hora de listar.
  const cpfById = new Map(base.customers.map((customer) => [String(customer.id), String(customer.cpf_cnpj ?? "")]));

  const eligible = plan.items.filter(
    (item) => item.outcome === "enqueue" && item.target && item.payload && item.channel
  );
  const chunkSize = Math.max(1, deps.enqueueConcurrency ?? 5);

  for (let index = 0; index < eligible.length; index += chunkSize) {
    const batch = eligible.slice(index, index + chunkSize);
    const results = await Promise.all(
      batch.map((item) =>
        deps.outbox.enqueue({
          eventKey: item.eventKey,
          dedupeKey: item.dedupeKey,
          customerId: item.customerId,
          cpf: cpfById.get(item.customerId) || null,
          payload: item.payload as Record<string, unknown>,
          // `marketing` (e não `transactional`): a prioridade transacional ignora a
          // janela (ver NOTIFICACOES-HUB.md §8), e lembrete automático precisa dela.
          priority: "marketing",
          channel: item.channel as Channel,
          target: item.target as string,
          rendered: item.preview,
          scheduledFor: item.scheduledFor,
        })
      )
    );

    for (const result of results) {
      if (result.created) summary.enqueued++;
      else summary.duplicates++;
    }
  }

  log("sync concluído", {
    day: summary.day,
    enqueued: summary.enqueued,
    duplicates: summary.duplicates,
    blocked: summary.blocked,
  });

  return summary;
}

/** Texto curto do resumo, para o log do cron e para o console do operador. */
export function describeSync(summary: SyncSummary): string {
  const parts = [
    `${summary.day.from}${summary.day.days > 1 ? `→${summary.day.to}` : ""}`,
    `${summary.plan.planned} planejados`,
    summary.dryRun ? `${summary.plan.toEnqueue} seriam enfileirados (dry-run)` : `${summary.enqueued} enfileirados`,
  ];
  if (summary.duplicates) parts.push(`${summary.duplicates} já existiam`);
  if (summary.blocked) parts.push(`bloqueado: ${summary.blocked}`);
  const skipped = Object.entries(summary.plan.skipped).filter(([, count]) => count > 0);
  if (skipped.length) parts.push(skipped.map(([reason, count]) => `${count}× ${reason}`).join(" · "));
  return parts.join(" | ");
}
