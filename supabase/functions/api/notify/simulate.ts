/**
 * Motor do simulador (dry-run). Módulo puro (ver `model.ts`).
 *
 * Propriedade central: `runSimulation` é uma **função pura dos dados**. Ela não lê
 * banco, não chama a UazAPI e não escreve nada — recebe a base já carregada e
 * devolve o relatório. Isso é o que torna o dry-run confiável: o mesmo código que
 * decide em produção decide aqui, e a única diferença é que aqui ninguém envia.
 *
 * Quem carrega os dados são as fontes (`sources.ts` na Edge Function,
 * `demo-data.ts`/CLI offline).
 */

import {
  billingValue,
  civilToday,
  diffDays,
  formatBR,
  maskCpf,
  maskPhone,
  type Channel,
  type PhoneFailure,
  type RawBilling,
  type RawCustomer,
} from "./model.ts";
import { planNotifications, type PlanCounts, type PlannedNotification } from "./rules.ts";
import {
  activeRules,
  defaultDocument,
  defaultWhatsAppSettings,
  describeRules,
  describeWhatsApp,
  normalizeDocument,
  settingsFingerprint,
  settingsFrom,
  type NotificationSettings,
  type SettingsDocument,
  type WhatsAppSettings,
} from "./settings.ts";
import { buildPayload, renderFor, type ChannelTemplate } from "./templates.ts";
import { resolveReach, type SimulationContact } from "./reach.ts";
import { decideAll, type DecisionCode, type QueueProjection, type RoutingState } from "./routing.ts";

// O alcance é resolvido em `reach.ts`, junto com o tipo do contato: quem enfileira
// (`sync.ts`) precisa da MESMA leitura de opt-in/celular. Reexportado aqui para as
// fontes de dados não precisarem conhecer o módulo novo.
export { resolveReach };
export type { SimulationContact };

export const SIMULATOR_VERSION = "1.0.0";

export const DECISION_LABEL: Record<DecisionCode, string> = {
  send_whatsapp: "Enviar (WhatsApp)",
  fallback_push: "Enviar (push — fallback)",
  defer_window: "Adiado (janela)",
  defer_cap: "Adiado (cota)",
  defer_locked: "Adiado (time-lock)",
  skip_dedupe: "Ignorado (duplicado)",
  skip_no_channel: "Ignorado (sem canal)",
  skip_superseded: "Ignorado (perdeu validade)",
};

export interface SimulationSourceInfo {
  kind: "mikweb" | "snapshot" | "synthetic";
  /** Como as faturas foram obtidas — importa para saber a cobertura do relatório. */
  strategy: "bulk" | "per-customer" | "synthetic" | "snapshot";
  customersScanned: number;
  billingsScanned: number;
  truncated: boolean;
  note?: string;
}

/**
 * Configuração que rege esta rodada.
 *
 * Aceita um documento parcial porque as três portas de entrada entregam coisas
 * diferentes: o painel manda o que leu do banco, a CLI manda o arquivo (ou nada), e a
 * rota manda a configuração persistida com os overrides da query. Todas passam pelo
 * MESMO `normalizeDocument` — nenhuma delas tem um caminho próprio de merge.
 */
export interface SimulationSettingsInput {
  rules?: unknown;
  horizonDays?: number;
  runAtHour?: number;
  skipInactiveCustomers?: boolean;
  portalBaseUrl?: string;
  companyName?: string;
  whatsapp?: Partial<WhatsAppSettings>;
  /** Procedência do documento base (o que o painel mostrou como "de onde veio"). */
  origin?: "db" | "defaults";
  updatedAt?: number | null;
  updatedBy?: string | null;
  notes?: string[];
}

/** A configuração efetiva da rodada, como ela aparece no relatório. */
export interface ReportSettings extends SettingsDocument {
  whatsapp: WhatsAppSettings;
  fingerprint: string;
  origin: "db" | "defaults";
  updatedAt: number | null;
  updatedBy: string | null;
  /** Chaves das regras que de fato geram avisos (as `active`). */
  activeRuleKeys: string[];
  notes: string[];
}

export interface SimulationInput {
  billings: RawBilling[];
  customers: RawCustomer[];
  pushCustomerIds?: string[];
  contacts?: SimulationContact[];
  /** Configuração efetiva. Ausente = régua padrão do código. */
  settings?: SimulationSettingsInput;
  /** Rótulos do que foi sobreposto à configuração persistida (não é o que será enviado). */
  overrides?: string[];
  templates?: ChannelTemplate[];
  source: SimulationSourceInfo;
  /** O que não foi possível ler — aparece no relatório, nunca fica implícito. */
  assumptions?: string[];
  state?: Partial<RoutingState>;
  today?: string;
  alreadySent?: string[];
  revealPhones?: boolean;
  itemLimit?: number;
  previewLimit?: number;
}

export interface SimReportItem {
  sendDate: string;
  sendDateBR: string;
  dueDate: string;
  dueDateBR: string;
  overdueDays: number;
  ruleKey: string;
  eventKey: string;
  dedupeKey: string;
  customerId: string;
  customerName: string;
  cpfMasked: string;
  phoneMasked: string | null;
  phone: string | null;
  phoneField: string | null;
  reference: string;
  value: number;
  valueWithCharges: number;
  decision: DecisionCode;
  decisionLabel: string;
  channel: Channel | null;
  reason: string;
  inNewChatQuota: boolean;
  preview: { title?: string; body: string; url?: string } | null;
}

export interface SimulationReport {
  dryRun: true;
  simulatorVersion: string;
  generatedAt: string;
  window: { from: string; to: string; days: number; runAtHour: number };
  source: SimulationSourceInfo;
  /**
   * A configuração que produziu este relatório — com o fingerprint. É o que permite
   * comparar "o que foi simulado" com "o que o dispatcher vai usar" sem confiar na
   * memória de quem rodou a simulação.
   */
  settings: ReportSettings;
  /** Parâmetros que sobrepuseram a configuração persistida nesta rodada. */
  overrides: string[];
  whatsapp: {
    enabled: boolean;
    instanceConnected: boolean;
    windowStart: number;
    windowEnd: number;
    newChatCapPerDay: number;
    perCustomerCapPerDay: number;
    pausedUntil: string | null;
  };
  reach: {
    customers: number;
    withPush: number;
    withWhatsappOptIn: number;
    withValidPhone: number;
    alreadyHaveConversation: number;
    phoneFailures: Partial<Record<PhoneFailure, number>>;
  };
  plan: PlanCounts & { staleBillings: number };
  totals: {
    candidates: number;
    wouldSend: number;
    deferred: number;
    skipped: number;
    whatsapp: number;
    push: number;
    newConversations: number;
  };
  byDecision: Record<string, number>;
  byRule: Record<string, number>;
  queue: QueueProjection;
  assumptions: string[];
  templateWarnings: string[];
  itemsTruncated: boolean;
  items: SimReportItem[];
  skippedSamples: Array<{ customerName: string; ruleKey: string; reason: string }>;
}

/**
 * Configuração efetiva da rodada.
 *
 * A normalização roda de novo sobre o que veio — mesmo que o dado já tenha sido
 * normalizado pelo store. É idempotente de propósito: significa que nenhuma porta de
 * entrada consegue injetar uma régua que o pipeline não aceitaria.
 */
export function resolveSimulationSettings(input?: SimulationSettingsInput): {
  settings: NotificationSettings;
  notes: string[];
} {
  const normalized = normalizeDocument(input ?? {}, defaultDocument());
  const whatsapp: WhatsAppSettings = { ...defaultWhatsAppSettings(), ...(input?.whatsapp ?? {}) };
  return {
    settings: settingsFrom(normalized.document, whatsapp),
    notes: [...(input?.notes ?? []), ...normalized.notes],
  };
}

export function runSimulation(input: SimulationInput): SimulationReport {
  const today = input.today ?? civilToday();
  const resolved = resolveSimulationSettings(input.settings);
  const settings = resolved.settings;
  const { rules, horizonDays, runAtHour, portalBaseUrl, companyName } = settings;

  const customerMap = new Map(input.customers.map((c) => [String(c.id), c]));
  const billingMap = new Map(input.billings.map((b) => [String(b.id), b]));

  const plan = planNotifications({
    billings: input.billings,
    customers: customerMap,
    from: today,
    horizonDays,
    rules,
    skipInactiveCustomers: settings.skipInactiveCustomers,
  });
  const reach = resolveReach(input);

  const alreadySent = new Set<string>(input.alreadySent ?? []);
  for (const key of input.state?.alreadySent ?? []) alreadySent.add(key);

  // `input.state` sobrepõe apenas o que é CENÁRIO (instância caída, time-lock) e o
  // toggle do canal; cota, janela e hora vêm da configuração, sem segunda via.
  const state: RoutingState = {
    from: today,
    runAtHour,
    whatsappEnabled: input.state?.whatsappEnabled ?? settings.whatsapp.enabled,
    instanceConnected: input.state?.instanceConnected ?? true,
    pausedUntilMs: input.state?.pausedUntilMs ?? settings.whatsapp.pausedUntilMs,
    windowStart: settings.whatsapp.windowStart,
    windowEnd: settings.whatsapp.windowEnd,
    newChatCapPerDay: settings.whatsapp.newChatCapPerDay,
    perCustomerCapPerDay: settings.whatsapp.perCustomerCapPerDay,
    alreadySent,
    nowMs: input.state?.nowMs ?? Date.now(),
  };

  const routing = decideAll(plan.planned, reach, state);
  const decisionByKey = new Map(routing.decisions.map((d) => [d.dedupeKey, d]));

  const warnings = new Set<string>();
  const items: SimReportItem[] = [];
  const byDecision: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  const skippedSamples: Array<{ customerName: string; ruleKey: string; reason: string }> = [];
  const previewLimit = input.previewLimit ?? 25;
  const itemLimit = input.itemLimit ?? 500;

  let wouldSend = 0;
  let deferred = 0;
  let skipped = 0;
  let whatsappCount = 0;
  let pushCount = 0;
  let newConversations = 0;
  let previews = 0;

  for (const planned of plan.planned) {
    const decision = decisionByKey.get(planned.dedupeKey);
    if (!decision) continue;

    byDecision[decision.decision] = (byDecision[decision.decision] ?? 0) + 1;
    byRule[planned.ruleKey] = (byRule[planned.ruleKey] ?? 0) + 1;

    const isSend = decision.decision === "send_whatsapp" || decision.decision === "fallback_push";
    if (isSend) wouldSend++;
    else if (decision.decision.startsWith("defer")) deferred++;
    else skipped++;
    if (decision.decision === "send_whatsapp") whatsappCount++;
    if (decision.decision === "fallback_push") pushCount++;
    if (isSend && decision.inNewChatQuota) newConversations++;

    const billing = billingMap.get(planned.billingId);
    const customer = customerMap.get(planned.customerId);
    const customerReach = reach.get(planned.customerId);

    let preview: SimReportItem["preview"] = null;
    if (isSend && decision.channel && billing && previews < previewLimit) {
      const payload = buildPayload({
        customer,
        billing,
        dueDate: planned.dueDate,
        reference: planned.reference,
        // Renderiza como se fosse a data do envio, não hoje: é isso que faz o
        // preview ser fiel (ver o comentário em templates.ts › referenceDate).
        referenceDate: decision.scheduledFor,
        portalBaseUrl,
        companyName,
      });
      const rendered = renderFor(decision.channel, planned.eventKey, payload, input.templates);
      for (const warning of rendered.warnings) warnings.add(warning);
      if (rendered.message) {
        previews++;
        preview = {
          title: rendered.message.title,
          body: rendered.message.body,
          url: decision.channel === "push" ? payload.link : undefined,
        };
      }
    }

    if (!isSend && skippedSamples.length < 12) {
      skippedSamples.push({
        customerName: String(customer?.full_name ?? planned.customerId),
        ruleKey: planned.ruleKey,
        reason: decision.reason,
      });
    }

    if (items.length >= itemLimit) continue;

    const value = billing?.value ?? 0;
    const charges = billing ? billingValue(billing).total : 0;

    items.push({
      sendDate: decision.scheduledFor,
      sendDateBR: formatBR(decision.scheduledFor),
      dueDate: planned.dueDate,
      dueDateBR: formatBR(planned.dueDate),
      overdueDays: diffDays(today, planned.dueDate),
      ruleKey: planned.ruleKey,
      eventKey: planned.eventKey,
      dedupeKey: planned.dedupeKey,
      customerId: planned.customerId,
      customerName: String(customer?.full_name ?? `cliente ${planned.customerId}`),
      cpfMasked: maskCpf(customer?.cpf_cnpj ?? null),
      phoneMasked: customerReach?.whatsappPhone ? maskPhone(customerReach.whatsappPhone) : null,
      phone: input.revealPhones ? (customerReach?.whatsappPhone ?? null) : null,
      phoneField: customerReach?.phoneField ?? null,
      reference: planned.reference,
      value: Number(value) || 0,
      valueWithCharges: Number(charges) || 0,
      decision: decision.decision,
      decisionLabel: DECISION_LABEL[decision.decision],
      channel: decision.channel ?? null,
      reason: decision.reason,
      inNewChatQuota: decision.inNewChatQuota,
      preview,
    });
  }

  const phoneFailures: Partial<Record<PhoneFailure, number>> = {};
  let withPush = 0;
  let withOptIn = 0;
  let withPhone = 0;
  let withConversation = 0;
  for (const r of reach.values()) {
    if (r.push) withPush++;
    if (r.whatsappOptIn) {
      withOptIn++;
      if (r.whatsappPhone) withPhone++;
      else if (r.phoneFailure) phoneFailures[r.phoneFailure] = (phoneFailures[r.phoneFailure] ?? 0) + 1;
    }
    if (r.hasExistingConversation) withConversation++;
  }

  return {
    dryRun: true,
    simulatorVersion: SIMULATOR_VERSION,
    generatedAt: new Date().toISOString(),
    window: { from: today, to: addDaysSafe(today, horizonDays - 1), days: horizonDays, runAtHour: state.runAtHour },
    source: input.source,
    settings: {
      ...settings,
      rules: settings.rules.map((rule) => ({ ...rule })),
      whatsapp: { ...settings.whatsapp },
      fingerprint: settingsFingerprint(settings),
      origin: input.settings?.origin ?? "defaults",
      updatedAt: input.settings?.updatedAt ?? null,
      updatedBy: input.settings?.updatedBy ?? null,
      activeRuleKeys: activeRules(settings.rules).map((rule) => rule.key),
      notes: resolved.notes,
    } satisfies ReportSettings,
    overrides: input.overrides ?? [],
    whatsapp: {
      enabled: state.whatsappEnabled,
      instanceConnected: state.instanceConnected,
      windowStart: state.windowStart,
      windowEnd: state.windowEnd,
      newChatCapPerDay: state.newChatCapPerDay,
      perCustomerCapPerDay: state.perCustomerCapPerDay,
      pausedUntil: state.pausedUntilMs ? new Date(state.pausedUntilMs).toISOString() : null,
    },
    reach: {
      customers: input.customers.length,
      withPush,
      withWhatsappOptIn: withOptIn,
      withValidPhone: withPhone,
      alreadyHaveConversation: withConversation,
      phoneFailures,
    },
    plan: { ...plan.counts, staleBillings: plan.staleBillingIds.length },
    totals: {
      candidates: plan.planned.length,
      wouldSend,
      deferred,
      skipped,
      whatsapp: whatsappCount,
      push: pushCount,
      newConversations,
    },
    byDecision,
    byRule,
    queue: routing.queue,
    assumptions: input.assumptions ?? [],
    templateWarnings: [...warnings],
    itemsTruncated: plan.planned.length > items.length,
    items,
    skippedSamples,
  };
}

// ---------------------------------------------------------------------------
// Helpers de apresentação (usados pela CLI)
// ---------------------------------------------------------------------------

export interface HumanSummary {
  headline: string;
  lines: string[];
}

export function summarize(report: SimulationReport): HumanSummary {
  const t = report.totals;
  const lines: string[] = [];
  lines.push(`configuração ....... ${report.settings.fingerprint} (${report.settings.origin}) · régua: ${describeRules(report.settings.rules)}`);
  lines.push(`canal .............. ${describeWhatsApp(report.settings.whatsapp)}`);
  if (report.overrides.length) {
    lines.push(`⚠ sobreposto ....... ${report.overrides.join(" | ")} — NÃO é o que será enviado até ser salvo`);
  }
  lines.push(`janela simulada .... ${report.window.from} → ${report.window.to} (${report.window.days} dias, execução às ${report.window.runAtHour}h)`);
  lines.push(`base ............... ${report.source.kind}/${report.source.strategy}: ${report.source.billingsScanned} faturas, ${report.source.customersScanned} clientes${report.source.truncated ? " (truncada)" : ""}`);
  lines.push(`faturas ............ ${report.plan.billingsOpen} em aberto | ${report.plan.billingsPaid} pagas | ${report.plan.billingsCanceled} canceladas | ${report.plan.billingsUnknownSituation} situação desconhecida | ${report.plan.billingsInvalidDueDate} vencimento inválido`);
  lines.push(`alcance ............ ${report.reach.withWhatsappOptIn} com opt-in de WhatsApp (${report.reach.withValidPhone} com celular válido) | ${report.reach.withPush} com push`);
  lines.push(`candidatos ......... ${t.candidates} avisos no horizonte`);
  lines.push(`seriam enviados .... ${t.wouldSend} (${t.whatsapp} WhatsApp, ${t.push} push) | ${t.deferred} adiados | ${t.skipped} ignorados`);
  lines.push(`novas conversas .... ${t.newConversations} (cota ${report.queue.newChatQuotaPerDay}/dia)`);
  if (report.queue.exhaustionDays) {
    lines.push(`escoamento ......... a cota cobre ${t.newConversations} novas conversas em ~${report.queue.exhaustionDays} dias`);
  }
  lines.push(`faturas antigas .... ${report.plan.staleBillings} fora do alcance das regras`);

  const skips = Object.entries(report.byDecision)
    .filter(([code]) => code.startsWith("skip") || code.startsWith("defer"))
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => `${count}× ${labelOf(code)}`);
  if (skips.length) lines.push(`principais motivos . ${skips.join(" | ")}`);

  return { headline: `${t.wouldSend} de ${t.candidates} avisos sairiam`, lines };
}

export function labelOf(code: string): string {
  return DECISION_LABEL[code as DecisionCode] ?? code;
}

function addDaysSafe(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
