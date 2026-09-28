#!/usr/bin/env node
/**
 * Invariantes da configuração do pipeline de notificações (LEMBRETES-WHATSAPP.md §15b).
 *
 * O projeto não tem framework de teste, mas a configuração persistida tem regras que
 * erram fácil e em silêncio — e errar aqui significa cobrar o cliente errado. Cada
 * bloco abaixo é uma dessas regras, verificada contra o código real (Node 24 roda os
 * módulos TS direto, sem build):
 *
 *   1. normalização      — documento quebrado não vira disparo errado
 *   2. fingerprint       — mesma configuração ⇒ mesmo número; time-lock não conta
 *   3. store             — leitura/gravação, tabela ausente, canal indisponível
 *   4. override          — desvio é DECLARADO, e documento parcial preserva a régua
 *   5. janela            — o dispatcher não envia fora da janela (e `manual` manda)
 *   6. envio             — a régua salva decide o template do envio sob demanda
 *   7. relatório         — a configuração usada entra no relatório, com fingerprint
 *   8. painel            — tela e servidor concordam sobre o que é override
 *   9. cota              — cota de novas conversas reservada antes de enviar (§15c)
 *  10. sync              — a régua vira fila: quem entra, quem fica de fora e por quê,
 *                          e o enfileirado bate com o que o simulador previu
 *
 * Uso:  node scripts/check-notification-settings.mjs   (ou `npm run check:notify`)
 */

import { applyOverrides, loadNotificationSettings, saveNotificationSettings } from "../supabase/functions/api/notify/settings-store.ts";
import {
  defaultDocument,
  defaultWhatsAppSettings,
  documentOf,
  normalizeDocument,
  normalizeWhatsApp,
  settingsFingerprint,
  settingsFrom,
} from "../supabase/functions/api/notify/settings.ts";
import { toMikwebDate } from "../supabase/functions/api/notify/model.ts";
import { dispatchQueue } from "../supabase/functions/api/notify/dispatch.ts";
import {
  effectiveTemplates,
  sanitizeTemplates,
  describeTemplates,
  templatesDocKey,
} from "../supabase/functions/api/notify/template-store.ts";
import { eventKeyForRule, sendBillingReminder } from "../supabase/functions/api/notify/send-billing.ts";
import { describeSync, planSync, runBillingSync, syncDueWindow } from "../supabase/functions/api/notify/sync.ts";
import { buildActions, buildPayload, renderFor, toStoredPayload } from "../supabase/functions/api/notify/templates.ts";
import { handleUazapiWebhook, parseWebhookPayload } from "../supabase/functions/api/notify/webhook.ts";
import { aggregateFunnel, buildFunnelWeeks, formatWeekLabel, funnelTotals, weekStartOf, weekStartToMs } from "../supabase/functions/api/notify/engagement.ts";
import { resolveSimulationSettings, runSimulation } from "../supabase/functions/api/notify/simulate.ts";
import { generateDemoBase } from "../supabase/functions/api/notify/demo-data.ts";
import * as ui from "../src/lib/simulator-report.ts";

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) pass++;
  else failures.push(`${name}${extra === undefined ? "" : ` → ${JSON.stringify(extra)}`}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
function section(title) {
  console.log(`\n  ${title}`);
}

// ---------------------------------------------------------------------------
// 1. Normalização
// ---------------------------------------------------------------------------
section("1. Normalização do documento");

const clamped = normalizeDocument({ rules: [{ key: "late_10", offsetDays: 400, eventKey: "billing.xyz", active: false, sortOrder: 5 }] });
eq("offset fora da faixa é limitado", clamped.document.rules[0].offsetDays, 60);
eq("eventKey desconhecido é derivado do offset", clamped.document.rules[0].eventKey, "billing.late");
check("a correção é declarada em nota", clamped.notes.some((n) => n.includes("limitada a 60")));
eq("label default = chave", clamped.document.rules[0].label, "late_10");

eq("chave duplicada é descartada", normalizeDocument({ rules: [{ key: "a", offsetDays: 1 }, { key: "a", offsetDays: 2 }] }).document.rules.length, 1);
eq("`rules` não-lista mantém a régua em vigor", normalizeDocument({ rules: "nope" }).document.rules.length, 5);
eq("regra inválida não vira régua inventada", normalizeDocument({ rules: [{ key: "BAD KEY", offsetDays: 1 }, { key: "x", offsetDays: "abc" }] }).document.rules.length, 0);
check("régua esvaziada avisa em voz alta", normalizeDocument({ rules: [{ key: "BAD KEY", offsetDays: 1 }] }).notes.some((n) => n.includes("nenhum aviso")));
eq("`rules: []` é pausa legítima (sem nota de erro)", normalizeDocument({ rules: [] }).notes.filter((n) => n.includes("inválid")).length, 0);

const limits = normalizeDocument({ horizonDays: 999, runAtHour: 30, portalBaseUrl: "https://x.com/", companyName: "  Acme  " }).document;
eq("horizonte e hora são limitados", [limits.horizonDays, limits.runAtHour], [60, 23]);
eq("url do portal e marca são limpas", [limits.portalBaseUrl, limits.companyName], ["https://x.com", "Acme"]);

const channelInvalid = normalizeWhatsApp({ enabled: false, windowStart: 30, windowEnd: 5, newChatCapPerDay: -3 });
eq("janela inválida mantém a anterior", [channelInvalid.whatsapp.windowStart, channelInvalid.whatsapp.windowEnd], [9, 20]);
const channelValid = normalizeWhatsApp({ windowStart: 8, windowEnd: 22, newChatCapPerDay: 0, perCustomerCapPerDay: 0 });
eq("cota 0 é aceita (sem teto) e cota por cliente tem piso 1", [channelValid.whatsapp.newChatCapPerDay, channelValid.whatsapp.perCustomerCapPerDay], [0, 1]);

// ---------------------------------------------------------------------------
// 2. Fingerprint
// ---------------------------------------------------------------------------
section("2. Fingerprint");

const base = settingsFrom(defaultDocument(), defaultWhatsAppSettings());
eq("ignora a ordem da régua", settingsFingerprint(settingsFrom({ ...documentOf(base), rules: [...defaultDocument().rules].reverse() }, base.whatsapp)), settingsFingerprint(base));
check("muda com offset", settingsFingerprint(settingsFrom({ ...documentOf(base), rules: base.rules.map((r) => (r.key === "late_5" ? { ...r, offsetDays: 6 } : r)) }, base.whatsapp)) !== settingsFingerprint(base));
check("muda com cota", settingsFingerprint(settingsFrom(documentOf(base), { ...base.whatsapp, newChatCapPerDay: 21 })) !== settingsFingerprint(base));
check("muda com janela", settingsFingerprint(settingsFrom(documentOf(base), { ...base.whatsapp, windowEnd: 21 })) !== settingsFingerprint(base));
check("muda ao ligar o canal", settingsFingerprint(settingsFrom(documentOf(base), { ...base.whatsapp, enabled: true })) !== settingsFingerprint(base));
check("muda com a marca do portal", settingsFingerprint(settingsFrom({ ...documentOf(base), portalBaseUrl: "https://outro.com" }, base.whatsapp)) !== settingsFingerprint(base));
eq("time-lock NÃO é configuração", settingsFingerprint(settingsFrom(documentOf(base), { ...base.whatsapp, pausedUntilMs: Date.now() })), settingsFingerprint(base));

// ---------------------------------------------------------------------------
// 3. Store
// ---------------------------------------------------------------------------
section("3. Persistência (notification_config + whatsapp_config)");

function makeDb(options = {}) {
  const tables = new Map();
  const ensure = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };
  return {
    from(table) {
      if (options.missing?.includes(table)) throw new Error(`relation "${table}" does not exist`);
      const api = {
        select: () => api,
        eq: () => api,
        limit: () => api,
        maybeSingle: async () => ({ data: ensure(table)[0] ?? null, error: null }),
        upsert: (row) => {
          const rows = ensure(table);
          const index = rows.findIndex((existing) => existing.key === row.key);
          if (index >= 0) rows[index] = { ...rows[index], ...row };
          else rows.push({ ...row });
          return { error: null };
        },
      };
      return api;
    },
  };
}

const channel = { enabled: true, windowStart: 8, windowEnd: 21, dailyNewChatCap: 33, perCustomerCap: 2, pausedUntil: null };
const channelConfig = async () => channel;
const storeDeps = (db) => ({ db: () => db, getChannelConfig: channelConfig });

const empty = makeDb();
const loadedEmpty = await loadNotificationSettings(storeDeps(empty));
eq("sem linha salva → defaults", loadedEmpty.origin, "defaults");
eq("cotas vêm do canal, não do código", [loadedEmpty.settings.whatsapp.newChatCapPerDay, loadedEmpty.settings.whatsapp.perCustomerCapPerDay, loadedEmpty.settings.whatsapp.windowStart], [33, 2, 8]);
check("o estado \"nada salvo\" é declarado", loadedEmpty.notes.some((n) => n.includes("nenhuma configuração salva")));

const missingTable = await loadNotificationSettings(storeDeps(makeDb({ missing: ["notification_config"] })));
eq("tabela ausente → defaults", missingTable.origin, "defaults");
check("migration pendente é declarada", missingTable.notes.some((n) => n.includes("notification_config")));
eq("canal indisponível não derruba a leitura", (await loadNotificationSettings({ db: () => makeDb(), getChannelConfig: async () => { throw new Error("sem canal"); } })).settings.whatsapp.enabled, false);

const customDb = makeDb();
const savedCustom = await saveNotificationSettings(storeDeps(customDb), { rules: [{ key: "late_2", offsetDays: 2 }] });
eq("régua validada e gravada", savedCustom.ok ? savedCustom.loaded.settings.rules.map((r) => r.key) : null, ["late_2"]);
eq("eventKey derivado do offset", savedCustom.ok ? savedCustom.loaded.settings.rules[0].eventKey : null, "billing.late");
eq("origem passa a ser db", savedCustom.ok ? savedCustom.loaded.origin : null, "db");

const partialSave = await saveNotificationSettings(storeDeps(customDb), { runAtHour: 6 });
eq("gravação parcial preserva a régua salva", partialSave.ok ? partialSave.loaded.settings.rules.map((r) => r.key) : null, ["late_2"]);
eq("gravação parcial aplica o que foi pedido", partialSave.ok ? partialSave.loaded.settings.runAtHour : null, 6);
eq("fingerprint estável entre leituras", (await loadNotificationSettings(storeDeps(customDb))).fingerprint, partialSave.ok ? partialSave.loaded.fingerprint : null);

// ---------------------------------------------------------------------------
// 4. Overrides
// ---------------------------------------------------------------------------
section("4. Overrides do simulador");

const custom = settingsFrom({ ...documentOf(base), rules: [{ key: "late_7", eventKey: "billing.late", offsetDays: 7, active: true, sortOrder: 70, label: "7 dias" }], horizonDays: 12 }, base.whatsapp);
eq("documento parcial preserva régua não-padrão", normalizeDocument({ runAtHour: 7 }, documentOf(custom)).document.rules.map((r) => r.key), ["late_7"]);
eq("override sem régua mantém a régua em vigor", applyOverrides(custom, { runAtHour: 7 }).settings.rules.map((r) => r.key), ["late_7"]);
eq("override só lista o que mudou", applyOverrides(custom, { runAtHour: 7 }).applied, ["hora de execução 10h → 7h"]);
eq("override de régua é declarado", applyOverrides(custom, { rules: [{ key: "due_day", offsetDays: 0 }] }).applied, ["régua de lembretes alterada (não salva)"]);
check("fingerprint muda quando há override", settingsFingerprint(applyOverrides(base, { newChatCapPerDay: 50 }).settings) !== settingsFingerprint(base));

// ---------------------------------------------------------------------------
// 5. Janela de envio
// ---------------------------------------------------------------------------
section("5. Janela de envio no dispatcher");

function fakeDispatch(nowMs) {
  const calls = { claim: 0 };
  const outbox = {
    async claim() { calls.claim++; return []; },
    async eventsByIds() { return new Map(); },
    async markSent() {}, async markFailed() {}, async markSkipped() {}, async release() {},
    async countRecentForCustomer() { return 0; }, async updateContactOutcome() {},
  };
  const adapter = { key: "whatsapp", async ready() { return { ok: true }; }, async deliver() { return { ok: true }; } };
  return { calls, outbox, registry: { get: () => adapter } };
}

const hour3 = Date.UTC(2026, 8, 23, 6, 0, 0); // 03:00 em UTC-3
const hour12 = Date.UTC(2026, 8, 23, 15, 0, 0); // 12:00 em UTC-3
const window910 = () => ({ start: 9, end: 20 });

const outside = fakeDispatch(hour3);
const outsideSummary = await dispatchQueue({ outbox: outside.outbox, registry: outside.registry, now: () => hour3, window: window910 }, { policy: "automated" });
check("fora da janela nada é reservado", outside.calls.claim === 0);
check("fora da janela o canal fica pausado com motivo", outsideSummary.paused && /janela/.test(outsideSummary.pauseReason ?? ""), outsideSummary.pauseReason);

const inside = fakeDispatch(hour12);
await dispatchQueue({ outbox: inside.outbox, registry: inside.registry, now: () => hour12, window: window910 }, { policy: "automated" });
check("dentro da janela reserva normal", inside.calls.claim === 1);

const manual = fakeDispatch(hour3);
await dispatchQueue({ outbox: manual.outbox, registry: manual.registry, now: () => hour3, window: window910 }, { policy: "manual" });
check("`manual` (botão Lembrar) ignora a janela", manual.calls.claim === 1);

const noWindow = fakeDispatch(hour3);
await dispatchQueue({ outbox: noWindow.outbox, registry: noWindow.registry, now: () => hour3 }, { policy: "automated" });
check("sem janela configurada nada muda", noWindow.calls.claim === 1);

// ---------------------------------------------------------------------------
// 6. Régua salva no envio sob demanda
// ---------------------------------------------------------------------------
section("6. Régua salva decide o template do envio");

const savedRules = [{ key: "late_3", eventKey: "billing.late", offsetDays: 3, active: true, sortOrder: 10, label: "3 dias de atraso" }];
eq("regra do painel resolve o evento", eventKeyForRule("late_3", savedRules), "billing.late");
eq("regra desconhecida cai no aviso de vencimento", eventKeyForRule("zzz", savedRules), "billing.due_soon");

const overdueBilling = {
  id: 999,
  customer_id: 7,
  value: 100,
  due_day: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
  reference: "SET/26",
  situation_name: "Aberto",
};
const sendDeps = {
  outbox: { async findEventByDedupeKey() { return null; }, async findDelivery() { return null; } },
  getContact: async () => ({ phoneE164: "5511987654321", optIn: true }),
  dispatch: async () => ({ sent: 0, results: [], paused: false }),
  getRules: async () => savedRules,
  now: () => Date.now(),
};
const latePreview = await sendBillingReminder(sendDeps, { customer: { id: 7, full_name: "Cliente" }, billing: overdueBilling, ruleKey: "late_3", dryRun: true });
const manualPreview = await sendBillingReminder(sendDeps, { customer: { id: 7, full_name: "Cliente" }, billing: overdueBilling, ruleKey: "manual", dryRun: true });
check("envio com regra salva usa o template de atraso", /atraso/i.test(latePreview.preview?.body ?? ""), latePreview.preview?.body);
check("envio manual segue no template de vencimento", /vence/i.test(manualPreview.preview?.body ?? ""), manualPreview.preview?.body);

// ---------------------------------------------------------------------------
// 7. Relatório
// ---------------------------------------------------------------------------
section("7. O relatório carrega a configuração");

const demo = generateDemoBase({ scenario: "realistic", today: "2026-09-23" });
const source = { kind: "synthetic", strategy: "synthetic", customersScanned: demo.customers.length, billingsScanned: demo.billings.length, truncated: false };
const effective = settingsFrom(
  { ...documentOf(base), rules: [{ key: "due_day", eventKey: "billing.due_today", offsetDays: 0, active: true, sortOrder: 10, label: "no dia" }], horizonDays: 3 },
  { ...base.whatsapp, enabled: true, newChatCapPerDay: 50 }
);
const report = runSimulation({
  customers: demo.customers,
  billings: demo.billings,
  pushCustomerIds: demo.pushCustomerIds,
  contacts: demo.contacts,
  source,
  settings: { ...effective, origin: "db", updatedAt: 123, updatedBy: "admin", notes: ["nota do store"] },
  overrides: ["cota de novas conversas 20 → 50"],
  today: "2026-09-23",
});
eq("fingerprint do relatório = da configuração", report.settings.fingerprint, settingsFingerprint(effective));
eq("origem e autor são ecoados", [report.settings.origin, report.settings.updatedAt, report.settings.updatedBy], ["db", 123, "admin"]);
eq("overrides são ecoados", report.overrides, ["cota de novas conversas 20 → 50"]);
eq("só a régua configurada é usada", Object.keys(report.byRule), ["due_day"]);
eq("cota e horizonte vêm da configuração", [report.whatsapp.newChatCapPerDay, report.window.days], [50, 3]);
check("notas da configuração entram no relatório", report.settings.notes.includes("nota do store"));
eq("skipInactiveCustomers é respeitado", runSimulation({ customers: demo.customers, billings: demo.billings, contacts: demo.contacts, source, settings: { rules: effective.rules, skipInactiveCustomers: false }, today: "2026-09-23" }).plan.billingsInactiveCustomer, 0);
eq("sem configuração, cai na régua padrão", resolveSimulationSettings(undefined).settings.rules.length, 5);

// ---------------------------------------------------------------------------
// 8. Painel × servidor
// ---------------------------------------------------------------------------
section("8. Painel e servidor concordam");

const settingsResponse = {
  ...effective,
  whatsapp: channel ? { ...effective.whatsapp, enabled: true, windowStart: 8, windowEnd: 21, newChatCapPerDay: 35, perCustomerCapPerDay: 2 } : effective.whatsapp,
  fingerprint: "s1-painel",
  origin: "db",
  updatedAt: 1750000000000,
  updatedBy: "admin",
  notes: [],
  eventKeys: ["billing.due_soon", "billing.due_today", "billing.late"],
  maxRules: 12,
  defaults: defaultDocument(),
};

const seeded = ui.paramsFromSettings(settingsResponse);
eq("seed herda horizonte, hora e cotas", [seeded.horizon, seeded.at, seeded.cap, seeded.perCustomerCap], [3, 10, 35, 2]);
eq("rodada padrão não manda parâmetro de configuração", ui.configQuery(seeded, settingsResponse), {});
eq("rodada padrão não lista override", ui.describeSettingsOverrides(seeded, settingsResponse), []);
eq("cada desvio vira exatamente um parâmetro", Object.keys(ui.configQuery({ ...seeded, cap: 50 }, settingsResponse)), ["cap"]);
eq("mudar a régua manda a régua", Object.keys(ui.configQuery({ ...seeded, rules: [{ ...seeded.rules[0], offsetDays: 4 }] }, settingsResponse)), ["rules"]);
eq("reordenar a régua não é mudança", ui.configQuery({ ...seeded, rules: [...seeded.rules].reverse() }, settingsResponse), {});

/** Espelha a rota de simulação: só o que veio na query sobrepõe a configuração. */
function serverRun(params, settings = settingsResponse) {
  const query = ui.configQuery(params, settings);
  const overrides = applyOverrides(settingsFrom(documentOf(settings), settings.whatsapp), {
    rules: query.rules === undefined ? undefined : JSON.parse(query.rules),
    horizonDays: query.horizon === undefined ? undefined : Number(query.horizon),
    runAtHour: query.at === undefined ? undefined : Number(query.at),
    newChatCapPerDay: query.cap === undefined ? undefined : Number(query.cap),
    perCustomerCapPerDay: query["per-customer-cap"] === undefined ? undefined : Number(query["per-customer-cap"]),
    whatsappEnabled: query.whatsapp === undefined ? undefined : query.whatsapp !== "off",
  });
  return runSimulation({
    customers: demo.customers,
    billings: demo.billings,
    pushCustomerIds: demo.pushCustomerIds,
    contacts: demo.contacts,
    source,
    settings: { ...overrides.settings, origin: "db" },
    overrides: overrides.applied,
    today: "2026-09-23",
  });
}

const defaultServerRun = serverRun(seeded);
eq("rodada padrão no servidor: zero override", defaultServerRun.overrides, []);
eq("rodada padrão usa a régua SALVA (não a do código)", Object.keys(defaultServerRun.byRule), ["due_day"]);
eq("rodada padrão usa as cotas persistidas", [defaultServerRun.whatsapp.newChatCapPerDay, defaultServerRun.whatsapp.perCustomerCapPerDay], [35, 2]);

const deviated = { ...seeded, cap: 50, at: 12, whatsapp: "off" };
const deviatedRun = serverRun(deviated);
eq("cliente e servidor concordam nos rótulos de override", ui.describeSettingsOverrides(deviated, settingsResponse), deviatedRun.overrides);
check("a rodada desviada realmente desviou", deviatedRun.overrides.length === 3, deviatedRun.overrides);

eq("régua válida não tem problema", ui.validateRules(settingsResponse.rules, 12), []);
check("chave duplicada é apontada antes de salvar", ui.validateRules([{ key: "a", offsetDays: 1 }, { ...settingsResponse.rules[0], key: "a" }].map((r) => ({ eventKey: "billing.late", active: true, sortOrder: 1, label: "x", ...r })), 12).some((p) => p.includes("repetida")));
check("offset absurdo é apontado antes de salvar", ui.validateRules([{ key: "x", eventKey: "billing.late", offsetDays: 400, active: true, sortOrder: 1, label: "x" }], 12).some((p) => p.includes("60")));
check("limite de regras é apontado", ui.validateRules(Array.from({ length: 13 }, (_, i) => ({ key: `r${i}`, eventKey: "billing.late", offsetDays: 1, active: true, sortOrder: i, label: "x" })), 12).some((p) => p.includes("12")));

const ruleDiff = ui.diffRules(seeded.rules, [...seeded.rules.map((r) => (r.key === "due_day" ? { ...r, active: false } : r)), { key: "late_15", eventKey: "billing.late", offsetDays: 15, active: true, sortOrder: 60, label: "15d" }]);
check("comparação mostra regra desligada e regra nova", ruleDiff.some((d) => d.includes("due_day") && d.includes("desligada")) && ruleDiff.some((d) => d.startsWith("+late_15")), ruleDiff);
eq("mesma configuração não gera diff de parâmetros", ui.diffParams(seeded, ui.paramsFromSettings(settingsResponse)), []);

// ---------------------------------------------------------------------------
// 9. Cota diária de novas conversas no dispatcher
// ---------------------------------------------------------------------------
section("9. Cota diária de novas conversas no dispatcher");

const NOON = Date.UTC(2026, 8, 23, 15, 0, 0); // 12:00 em UTC-3 (dentro da janela)
// Próxima janela, 9h local = 12:00Z do dia seguinte (13:00Z se a janela começa 8h).
const NEXT_WINDOW_9 = Date.UTC(2026, 8, 24, 12, 0, 0);
const NEXT_WINDOW_8 = Date.UTC(2026, 8, 24, 11, 0, 0);

/**
 * Outbox falso que implementa o CONTRATO de `reserve_new_chat_slot` (migration 005):
 * só a primeira mensagem para um destino consome vaga, a vaga é contada por dia e
 * `cap 0` significa sem teto. O SQL é verificado à parte, contra um Postgres de
 * verdade (scripts/check-new-chat-quota.sql); aqui o alvo é o dispatcher — ele
 * reserva ANTES de enviar? adia sem gastar tentativa? transfere o resultado para o
 * resumo?
 */
function quotaHarness(options = {}) {
  const {
    cap = 5,
    policy = "automated",
    targets = [],
    existing = [],
    usedBefore = 0,
    reserveError,
    windowStart = 9,
  } = options;

  const calls = { reserve: [], release: [], delivered: [], markedSent: [], trace: [] };
  const state = { used: usedBefore };
  const rows = targets.map((target, index) => ({
    id: `d${index + 1}`,
    eventId: `e${index + 1}`,
    channel: "whatsapp",
    customerId: `c${index + 1}`,
    cpf: null,
    target,
    status: "sending",
    attempts: 1,
    scheduledFor: NOON,
    createdAt: NOON,
  }));
  const events = new Map(
    rows.map((row) => [
      row.eventId,
      {
        id: row.eventId,
        eventKey: "billing.due_soon",
        customerId: row.customerId,
        cpf: null,
        dedupeKey: `billing:${row.id}:due_soon`,
        // `__dueDate` de hoje: um aviso de vencimento não é descartado por data.
        payload: { referencia: "SET/26", primeiro_nome: "Cliente", __dueDate: "2026-09-23" },
        priority: "transactional",
      },
    ])
  );

  const outbox = {
    async claim() { return rows; },
    async eventsByIds() { return events; },
    async countRecentForCustomer() { return 0; },
    async reserveNewChatSlot({ deliveryId, cap: value, dayStart }) {
      const row = rows.find((item) => item.id === deliveryId);
      const isNew = !existing.includes(row.target);
      calls.reserve.push({ deliveryId, cap: value, dayStart, isNew });
      calls.trace.push(`reserve:${deliveryId}`);
      if (reserveError) return { allowed: true, isNewChat: false, usedToday: 0, cap: value, error: reserveError };
      const allowed = !isNew || value === 0 || state.used < value;
      if (allowed && isNew) state.used++;
      return { allowed, isNewChat: isNew, usedToday: state.used, cap: value };
    },
    async release(input) { calls.release.push(input); },
    async markSent(id) { calls.markedSent.push(id); },
    async markFailed() {},
    async markSkipped() {},
    async updateContactOutcome() {},
  };
  const adapter = {
    key: "whatsapp",
    async ready() { return { ok: true }; },
    async deliver(target) {
      calls.delivered.push(target);
      calls.trace.push(`deliver:${rows.find((row) => row.target === target)?.id}`);
      return { ok: true, providerId: "p1" };
    },
  };
  const deps = {
    outbox,
    registry: { get: () => adapter },
    now: () => NOON,
    perCustomerCap: () => 1,
    newChatCap: options.newChatCap === undefined ? () => cap : options.newChatCap,
    window: () => ({ start: windowStart, end: 20 }),
  };
  return { calls, state, deps, policy };
}

// --- a cota do dia é respeitada antes do envio ------------------------------
const blocked = quotaHarness({ cap: 2, targets: ["5511900000001", "5511900000002", "5511900000003", "5511900000004"] });
const blockedSummary = await dispatchQueue(blocked.deps, { policy: blocked.policy });
eq("cota 2: só duas conversas novas saem", blocked.calls.delivered.length, 2);
eq("cota 2: as outras duas são adiadas, não descartadas", [blockedSummary.sent, blockedSummary.released], [2, 2]);
eq("cota 2: o resumo declara quantas começaram e quantas ficaram para depois", blockedSummary.newChats, { cap: 2, started: 2, heldByCap: 2, usedToday: 2 });
check(
  "cada envio é precedido pela reserva da própria vaga (não é reserva em lote depois)",
  blocked.calls.trace.join(" ") === "reserve:d1 deliver:d1 reserve:d2 deliver:d2 reserve:d3 reserve:d4",
  blocked.calls.trace
);
check("a entrega barrada nunca vai para o provedor nem é marcada como enviada", !blocked.calls.delivered.includes("5511900000003") && !blocked.calls.markedSent.includes("d3"));
eq("adiamento por cota é para a próxima janela do dia seguinte", blocked.calls.release.map((r) => r.scheduledFor), [NEXT_WINDOW_9, NEXT_WINDOW_9]);
check("o motivo do adiamento diz a cota e não conta como tentativa", /cota de novas conversas \(2\/2\)/.test(blocked.calls.release[0]?.reason ?? ""), blocked.calls.release[0]?.reason);
check("a razão devolvida ao painel explica o adiamento", /cota de novas conversas do dia esgotada/.test(blockedSummary.results.find((r) => r.deliveryId === "d3")?.reason ?? ""), blockedSummary.results.map((r) => r.reason));

// --- conversa já aberta não consome vaga ------------------------------------
const mixed = quotaHarness({
  cap: 1,
  targets: ["5511900000010", "5511900000011", "5511900000012"],
  existing: ["5511900000010", "5511900000012"],
  usedBefore: 1,
});
const mixedSummary = await dispatchQueue(mixed.deps, { policy: mixed.policy });
eq("cliente com conversa aberta passa mesmo com a cota esgotada", mixed.calls.delivered, ["5511900000010", "5511900000012"]);
eq("a conversa nova é a única barrada", [mixedSummary.sent, mixedSummary.newChats?.heldByCap], [2, 1]);

// --- `manual` respeita a cota do canal (mas segue ignorando a janela) --------
const manualCap = quotaHarness({ cap: 1, targets: ["5511900000020", "5511900000021"] });
const manualSummary = await dispatchQueue(manualCap.deps, { policy: "manual" });
eq("o botão 'enviar agora' também respeita a cota de novas conversas", [manualSummary.sent, manualSummary.newChats?.heldByCap], [1, 1]);
check("o botão 'enviar agora' continua contando a conversa nova que começou", manualSummary.newChats?.started === 1, manualSummary.newChats);
const manualWindow = quotaHarness({ cap: 5, targets: ["5511900000022"] });
await dispatchQueue({ ...manualWindow.deps, now: () => Date.UTC(2026, 8, 23, 6, 0, 0) }, { policy: "manual" });
eq("o botão 'enviar agora' continua ignorando a janela", manualWindow.calls.delivered.length, 1);

// --- cota 0 = sem teto (mesma leitura do simulador) --------------------------
const unlimited = quotaHarness({ cap: 0, targets: ["5511900000030", "5511900000031", "5511900000032"] });
const unlimitedSummary = await dispatchQueue(unlimited.deps, { policy: unlimited.policy });
eq("cota 0 não bloqueia nada (igual ao simulador)", [unlimitedSummary.sent, unlimitedSummary.newChats?.heldByCap], [3, 0]);
check("cota 0 continua CONTANDO as conversas novas", unlimitedSummary.newChats?.started === 3, unlimitedSummary.newChats);

// --- canal sem o conceito (push) não reserva --------------------------------
const pushy = quotaHarness({ targets: ["5511900000040"], newChatCap: () => null });
const pushySummary = await dispatchQueue(pushy.deps, { policy: pushy.policy });
eq("canal sem cota de novas conversas não reserva vaga", pushy.calls.reserve.length, 0);
eq("canal sem cota não inventa um resumo de cota", pushySummary.newChats, null);
const noDep = quotaHarness({ targets: ["5511900000041"], newChatCap: null });
await dispatchQueue(noDep.deps, { policy: noDep.policy });
eq("sem a dependência informada não reserva (e não quebra)", noDep.calls.reserve.length, 0);

// --- falha na reserva é declarada, não silenciosa ---------------------------
const brokenQuota = quotaHarness({ cap: 1, targets: ["5511900000050"], reserveError: 'relation "reserve_new_chat_slot" does not exist' });
const brokenSummary = await dispatchQueue(brokenQuota.deps, { policy: brokenQuota.policy });
eq("migration pendente não para a fila (fail-open)", brokenSummary.sent, 1);
check("…e o resumo DECLARA que a cota não foi aplicada", /does not exist/.test(brokenSummary.newChats?.error ?? ""), brokenSummary.newChats);

// --- a janela adiada é a da configuração, não 9h fixas ----------------------
const lateWindow = quotaHarness({ cap: 1, targets: ["5511900000060", "5511900000061"], windowStart: 8 });
await dispatchQueue(lateWindow.deps, { policy: "automated" });
eq("o adiamento usa o início da janela configurada", lateWindow.calls.release.map((r) => r.scheduledFor), [NEXT_WINDOW_8]);

// --- o admin precisa VER o adiamento, não um silêncio -----------------------
// Botão "Lembrar" sobre um cliente com opt-in, com a cota do dia já estourada: o
// enfileiramento funciona, o dispatcher barra, e o resultado tem de chegar ao toast.
const quotaReason =
  "cota de novas conversas do dia esgotada (20/20) — reagendado; aumente a cota de novas conversas em Configurações para enviar antes";
const blockedSend = await sendBillingReminder(
  {
    outbox: {
      async findEventByDedupeKey() { return null; },
      async findDelivery() { return null; },
      async enqueue() { return { eventId: "e1", deliveryId: "d1", created: true }; },
    },
    getContact: async () => ({ phoneE164: "5511987654321", optIn: true }),
    saveContact: async () => {},
    dispatch: async () => ({
      claimed: 1,
      sent: 0,
      released: 1,
      failed: 0,
      skipped: 0,
      uncertain: 0,
      paused: false,
      newChats: { cap: 20, started: 0, heldByCap: 1, usedToday: 20 },
      results: [{ deliveryId: "d1", customerId: "7", target: "5511987654321", ok: false, status: "queued", reason: quotaReason }],
    }),
    getRules: async () => savedRules,
    now: () => NOON,
  },
  {
    customer: { id: 7, full_name: "Cliente" },
    billing: { id: 555, customer_id: 7, value: 100, due_day: "2026-09-25", reference: "OUT/26", situation_name: "Aberto" },
    ruleKey: "manual",
  }
);
eq("botão 'Lembrar' barrado pela cota devolve `queued` (não `failed`)", blockedSend.status, "queued");
check("…e diz ao admin o que fazer para enviar antes", /aumente a cota de novas conversas/.test(blockedSend.reason), blockedSend.reason);
eq("…sem perder a mensagem que seria enviada", typeof blockedSend.preview?.body, "string");

// ---------------------------------------------------------------------------
// 10. Sync: a régua vira fila
// ---------------------------------------------------------------------------
section("10. Sync: a régua vira fila");

const TODAY = "2026-09-23";
const NOON_SYNC = Date.UTC(2026, 8, 23, 15, 0, 0); // 12:00 em UTC-3

/** Base pequena e explícita: cada cliente exercita UM motivo de não-envio. */
const syncSettings = settingsFrom(
  { ...documentOf(base), horizonDays: 7 },
  { ...base.whatsapp, enabled: true, windowStart: 9, windowEnd: 20, newChatCapPerDay: 20, perCustomerCapPerDay: 1 }
);
const syncCustomers = [
  { id: 1, full_name: "Ana Com OptIn", cell_phone_number_1: "11987654321", status: "active" },
  { id: 2, full_name: "Bruno Sem OptIn", cell_phone_number_1: "11987654322", status: "active" },
  { id: 3, full_name: "Carla So Fixo", cell_phone_number_1: "1133334444", status: "active" },
  { id: 4, full_name: "Dora Sem Whats", status: "active" },
  { id: 5, full_name: "Elias Inativo", cell_phone_number_1: "11987654325", status: "Bloqueado" },
];
const syncBillings = [
  { id: 101, customer_id: 1, value: 100, due_day: TODAY, reference: "SET/26", situation_name: "Aberto" },
  { id: 102, customer_id: 2, value: 100, due_day: TODAY, reference: "SET/26", situation_name: "Aberto" },
  { id: 103, customer_id: 3, value: 100, due_day: TODAY, reference: "SET/26", situation_name: "Aberto" },
  { id: 104, customer_id: 4, value: 100, due_day: TODAY, reference: "SET/26", situation_name: "Aberto" },
  { id: 105, customer_id: 5, value: 100, due_day: TODAY, reference: "SET/26", situation_name: "Aberto" },
  // Paga e desconhecida: a cobrança nem é planejada.
  { id: 106, customer_id: 1, value: 100, due_day: TODAY, reference: "SET/26", situation_name: "Pago" },
  { id: 107, customer_id: 1, value: 100, due_day: TODAY, reference: "SET/26", situation_name: "Em análise" },
  // Vence em 3 dias: é o aviso `d_minus_3` de HOJE (a fatura ainda não venceu).
  { id: 108, customer_id: 1, value: 100, due_day: "2026-09-26", reference: "SET/26", situation_name: "Aberto" },
  // Vence amanhã: só entra quando o sync pede 2 dias.
  { id: 109, customer_id: 1, value: 100, due_day: "2026-09-24", reference: "SET/26", situation_name: "Aberto" },
];
const syncBase = {
  customers: syncCustomers,
  billings: syncBillings,
  pushCustomerIds: ["4"], // Dora tem push: sem WhatsApp, mas teria destino
  contacts: [
    { customerId: "1", optIn: true },
    { customerId: "3", optIn: true },
  ],
  alreadySent: [],
  scanned: { billings: syncBillings.length, customers: syncCustomers.length, contacts: 2 },
};

/** Outbox falso com a MESMA garantia do banco: dedupe_key repetida não cria evento. */
function fakeSync(overrides = {}) {
  const seen = new Set(overrides.seen ?? []);
  const calls = { enqueue: [], loadBase: [] };
  const settings = overrides.settings ?? syncSettings;
  const base = overrides.base ?? syncBase;
  const nowMs = overrides.nowMs ?? NOON_SYNC;
  return {
    calls,
    seen,
    deps: {
      outbox: {
        async enqueue(input) {
          calls.enqueue.push(input);
          if (seen.has(input.dedupeKey)) return { eventId: "e", deliveryId: null, created: false };
          seen.add(input.dedupeKey);
          return { eventId: `e${seen.size}`, deliveryId: `d${seen.size}`, created: true };
        },
      },
      getSettings: async () => ({
        settings,
        origin: overrides.origin ?? "db",
        fingerprint: settingsFingerprint(settings),
        updatedAt: 1,
        updatedBy: "admin",
        notes: [],
      }),
      loadBase: async (window) => {
        calls.loadBase.push(window);
        if (overrides.loadError) throw new Error(overrides.loadError);
        return base;
      },
      templates: overrides.templates,
      now: () => nowMs,
      log: () => {},
      // Concorrência máxima em teste: a ordem das chamadas fica a do plano.
      enqueueConcurrency: 1,
    },
  };
}

const syncPlan = planSync({
  billings: syncBase.billings,
  customers: syncBase.customers,
  contacts: syncBase.contacts,
  pushCustomerIds: syncBase.pushCustomerIds,
  settings: syncSettings,
  from: TODAY,
  days: 1,
  nowMs: NOON_SYNC,
});
// Um item por chave: cada fatura da base gera no máximo uma regra no dia (a que cai no
// dia escrito), então a chave identifica o item sem ambiguidade.
const itemOf = (key) => syncPlan.items.find((item) => item.dedupeKey === key);
const reasonOf = (key) => itemOf(key)?.reason;

eq("fatura paga e situação desconhecida não são planejadas", syncPlan.counts.planned, 5);
check("cliente inativo não entra", !syncPlan.items.some((item) => item.billingId === "105"), syncPlan.items.map((i) => i.billingId));
check("com opt-in e celular: enfileira", itemOf("billing:101:due_day")?.outcome === "enqueue" && reasonOf("billing:101:due_day") === null);
eq("sem opt-in e sem push: não enfileira", reasonOf("billing:102:due_day"), "no_opt_in");
eq("opt-in com telefone fixo: não enfileira", [reasonOf("billing:103:due_day"), itemOf("billing:103:due_day")?.detail], ["invalid_phone", "só telefone fixo"]);
eq("sem WhatsApp mas com push: declara que falta o adapter, não some", reasonOf("billing:104:due_day"), "push_pending");

// Os números têm de fechar: todo item planejado cai em exatamente um balde.
const skipTotal = Object.values(syncPlan.counts.skipped).reduce((sum, n) => sum + n, 0);
eq("planejados = enfileirados + motivos declarados", syncPlan.counts.planned, syncPlan.counts.toEnqueue + skipTotal);
eq("o resumo declara os 4 motivos, um por cliente", syncPlan.counts.skipped, {
  channel_disabled: 0, no_customer: 0, already_enqueued: 0, no_template: 0, no_opt_in: 1, invalid_phone: 1, push_pending: 1, no_channel: 0,
});
eq("o aviso de hoje da fatura que vence em 3 dias sai hoje", itemOf("billing:108:d_minus_3")?.outcome, "enqueue");
check("o aviso de amanhã não entra num sync de 1 dia", !syncPlan.items.some((item) => item.sendDate !== TODAY), syncPlan.items.map((i) => i.sendDate));

// --- janela de vencimento consultada ----------------------------------------
eq("a varredura cobre o vencimento de todas as regras", syncDueWindow(syncSettings.rules, TODAY, 1), { from: "2026-09-18", to: "2026-09-26" });
eq("com 2 dias a janela acompanha", syncDueWindow(syncSettings.rules, TODAY, 2), { from: "2026-09-18", to: "2026-09-27" });
const quietRules = [{ key: "x", eventKey: "billing.due_today", offsetDays: 0, active: false, sortOrder: 1, label: "x" }];
eq("régua toda desligada não varre nada", syncDueWindow(quietRules, TODAY, 1), { from: TODAY, to: TODAY });

// --- payload, preview e agendamento ----------------------------------------
const ok = itemOf("billing:101:due_day");
eq("o destino é o celular normalizado", ok.target, "5511987654321");
eq("o payload carrega os metadados que o dispatcher lê", [ok.payload.__dueDate, ok.payload.__url], [TODAY, "https://minhasupernet.com/faturas/101"]);
check("o preview não tem placeholder faltando no template", /Ana/i.test(ok.preview?.body ?? "") && !(ok.preview?.body ?? "").includes("{{"), ok.preview?.body);
eq("agendado para a primeira janela do dia (hoje às 9h já passou: agora)", ok.scheduledFor, NOON_SYNC);
const tomorrow = planSync({
  billings: syncBase.billings,
  customers: syncBase.customers,
  contacts: syncBase.contacts,
  settings: syncSettings,
  from: TODAY,
  days: 2,
  nowMs: NOON_SYNC,
});
const tomorrowItem = tomorrow.items.find((item) => item.sendDate === "2026-09-24" && item.outcome === "enqueue");
eq("aviso de amanhã é agendado para amanhã às 9h (não para agora)", tomorrowItem?.scheduledFor, Date.UTC(2026, 8, 24, 12, 0, 0));

// --- canal desligado --------------------------------------------------------
const offSettings = settingsFrom(documentOf(syncSettings), { ...syncSettings.whatsapp, enabled: false });
const offPlan = planSync({ billings: syncBase.billings, customers: syncBase.customers, contacts: syncBase.contacts, settings: offSettings, from: TODAY, days: 1, nowMs: NOON_SYNC });
eq("canal desligado bloqueia o lote e diz por quê", [offPlan.blocked, offPlan.counts.toEnqueue], ["channel_disabled", 0]);
eq("e cada item planejado aponta o canal desligado", offPlan.counts.skipped.channel_disabled, 5);
const offRun = fakeSync({ settings: offSettings });
const offSummary = await runBillingSync(offRun.deps, { from: TODAY });
eq("canal desligado não chama o outbox", [offRun.calls.enqueue.length, offSummary.enqueued], [0, 0]);

// --- execução + idempotência ------------------------------------------------
const run1 = fakeSync();
const summary1 = await runBillingSync(run1.deps, { from: TODAY });
eq("o sync enfileira o que restou elegível (2 faturas da Ana)", [summary1.enqueued, summary1.duplicates], [2, 0]);
eq("a varredura foi feita na janela de vencimento, não em 'hoje'", run1.calls.loadBase, [{ dueFrom: "2026-09-18", dueTo: "2026-09-26" }]);
eq("o evento entra com prioridade que respeita a janela", run1.calls.enqueue[0]?.priority, "marketing");
eq("o resumo ecoa a configuração que o produziu", summary1.settings.fingerprint, settingsFingerprint(syncSettings));
check("e o texto do cron é legível", /2 enfileirados/.test(describeSync(summary1)), describeSync(summary1));

const run2 = fakeSync({ seen: run1.seen });
const summary2 = await runBillingSync(run2.deps, { from: TODAY });
eq("segunda rodada do dia não duplica nada", [summary2.enqueued, summary2.duplicates], [0, 2]);

// Duas camadas de dedupe, e as duas contam: a lista de chaves evita a chamada, e o
// BANCO recusa o que a lista não soube (ela é limitada a 5000 linhas em `sources.ts`).
const preFiltered = fakeSync({ base: { ...syncBase, alreadySent: ["billing:101:due_day"] } });
const preSummary = await runBillingSync(preFiltered.deps, { from: TODAY });
eq("evento já listado nem chega ao outbox", [preFiltered.calls.enqueue.some((c) => c.dedupeKey === "billing:101:due_day"), preSummary.plan.skipped.already_enqueued, preSummary.enqueued], [false, 1, 1]);
const staleList = fakeSync({ seen: ["billing:101:due_day"] });
const staleSummary = await runBillingSync(staleList.deps, { from: TODAY });
eq("lista desatualizada não duplica: o banco recusa o segundo evento", [staleSummary.enqueued, staleSummary.duplicates], [1, 1]);

const dry = fakeSync();
const drySummary = await runBillingSync(dry.deps, { from: TODAY, dryRun: true });
eq("dry-run planeja e não grava", [dry.calls.enqueue.length, drySummary.enqueued, drySummary.plan.toEnqueue], [0, 0, 2]);

const capped = fakeSync();
eq("`days` maior que o horizonte é limitado ao horizonte", (await runBillingSync(capped.deps, { from: TODAY, days: 99 })).day.days, syncSettings.horizonDays);

// Falha de leitura tem de doer: um sync que "conclui" com a base fora do ar seria
// "hoje não saiu lembrete nenhum" sem ninguém perceber.
const failing = fakeSync({ loadError: "MikWeb não respondeu" });
let syncThrew = false;
try {
  await runBillingSync(failing.deps, { from: TODAY });
} catch {
  syncThrew = true;
}
check("base ilegível não vira 'nada a enfileirar' silencioso", syncThrew);

const noCustomers = fakeSync({ base: { ...syncBase, customers: [], contacts: [], pushCustomerIds: [] } });
const noCustomersSummary = await runBillingSync(noCustomers.deps, { from: TODAY });
// 6 e não 5: sem o cadastro o filtro de cliente inativo também deixa de valer, então a
// fatura do cliente bloqueado entra na contagem e morre no motivo seguinte.
eq("base sem cadastro não explode: vira motivo declarado", [noCustomersSummary.enqueued, noCustomersSummary.plan.planned, noCustomersSummary.plan.skipped.no_customer], [0, 6, 6]);

// --- a propriedade que fecha o pedido --------------------------------------
// "O que foi simulado é o que será enviado": com cotas neutralizadas (para medir só o
// PLANEJAMENTO, que é a fronteira do sync), o conjunto que o sync enfileira tem de ser
// exatamente o conjunto que o simulador descreve como `send_whatsapp` para o dia.
const wideBase = generateDemoBase({ scenario: "realistic", today: TODAY });
const neutral = settingsFrom(
  { ...documentOf(base), horizonDays: 1 },
  { ...base.whatsapp, enabled: true, newChatCapPerDay: 0, perCustomerCapPerDay: 999, windowStart: 9, windowEnd: 20 }
);
const syncRun = planSync({
  billings: wideBase.billings,
  customers: wideBase.customers,
  contacts: wideBase.contacts,
  pushCustomerIds: wideBase.pushCustomerIds,
  settings: neutral,
  from: TODAY,
  days: 1,
  nowMs: Date.UTC(2026, 8, 23, 13, 0, 0),
});
const simulated = runSimulation({
  billings: wideBase.billings,
  customers: wideBase.customers,
  contacts: wideBase.contacts,
  pushCustomerIds: wideBase.pushCustomerIds,
  source,
  settings: { ...neutral, origin: "db" },
  today: TODAY,
});
const enqueuedKeys = syncRun.items.filter((item) => item.outcome === "enqueue").map((item) => item.dedupeKey).sort();
const simulatedKeys = simulated.items.filter((item) => item.decision === "send_whatsapp").map((item) => item.dedupeKey).sort();
check("a base de teste tem avisos de sobra (o teste não passa por vazio)", enqueuedKeys.length > 5, enqueuedKeys.length);
eq("o que o sync enfileira é exatamente o que o simulador diz que sai hoje", enqueuedKeys, simulatedKeys);
check(
  "e todo item enfileirado passa no template e no payload",
  syncRun.items.filter((i) => i.outcome === "enqueue").every((i) => i.payload?.__dueDate === i.dueDate && !!i.preview?.body),
  syncRun.items.find((i) => i.outcome === "enqueue" && !i.preview?.body) ?? null
);

// ---------------------------------------------------------------------------
// 11. Filtro de data da MikWeb — a consulta que alimenta a varredura
// ---------------------------------------------------------------------------
// A API aceita datas por `type_date` + `start_date`/`end_date` em dd-MM-yyyy
// (docs oficiais, "Listando Cobranças"). `date_from`/`date_to` ISO NÃO existem:
// a API os ignora e a varredura trazia o histórico inteiro, cortado pelo teto
// de páginas antes de chegar às faturas em aberto — relatório com zero avisos.

section("11. Filtro de data da MikWeb (bug do zero falso)");

eq(
  "converte ISO para o formato dd-MM-yyyy que a MikWeb aceita",
  toMikwebDate("2026-09-25"),
  "25-09-2026"
);
eq("data de um dígito vai com zero à esquerda", toMikwebDate("2026-01-05"), "05-01-2026");
eq("round-trip estável", toMikwebDate(addDaysT("2026-12-31", 1)), "01-01-2027");

// ---------------------------------------------------------------------------
// 12. Templates editáveis — o que o painel salva é o que a fila envia
// ---------------------------------------------------------------------------

section("12. Templates de mensagem (editor do simulador)");

const tNotes = [];
const bad = sanitizeTemplates(
  {
    "whatsapp:billing.late": { body: "Olá {{primeiro_nome}}, fatura em atraso." },
    "whatsapp:evento.falso": { body: "x" },
    "canal.falso:billing.late": { body: "x" },
    "push:billing.due_today": { body: "   " },
    "whatsapp:billing.due_soon": "não é objeto",
  },
  tNotes,
  "teste"
);
eq("template válido entra, desconhecido/vazio é descartado", Object.keys(bad.doc), ["whatsapp:billing.late"]);
check("cada descarte declara o motivo", tNotes.length >= 3, tNotes);
eq("título só entra quando informado", bad.doc["whatsapp:billing.late"].title, undefined);

const eff = effectiveTemplates({
  "whatsapp:billing.late": { body: "TEXTO SALVO {{primeiro_nome}}", active: true },
});
eq(
  "salvo sobrepõe o código um a um",
  eff.find((t) => t.channel === "whatsapp" && t.eventKey === "billing.late").body,
  "TEXTO SALVO {{primeiro_nome}}"
);
eq("pares não salvos continuam no padrão", eff.find((t) => t.channel === "whatsapp" && t.eventKey === "billing.due_today").body.length > 50, true);
const off = effectiveTemplates({ "push:billing.late": { body: "x", active: false } });
const offPair = off.find((t) => t.channel === "push" && t.eventKey === "billing.late");
check("active: false fica na lista mas sem renderizar (renderFor filtra)", offPair?.active === false, offPair);
check(
  "e o renderFor devolve null para o par desligado",
  (() => {
    const { message } = renderFor("push", "billing.late", { empresa: "ACME" }, off);
    return message === null;
  })()
);
check("template de teste nunca é editável", !eff.some((t) => t.eventKey === "test" && t.body.includes("EDITADO")), null);

const described = describeTemplates({});
eq("o editor lista 3 eventos × 2 canais", described.templates.length, 6);
check("todo item vem com render de exemplo", described.templates.every((t) => t.sampleFull.length > 0));
check("nenhum placeholder quebra o render padrão", described.templates.every((t) => t.missing.length === 0), described.templates.filter((t) => t.missing.length));
const late = described.templates.find((t) => t.key === "whatsapp:billing.late");
check("seção opcional some sem Pix (preview mínimo)", late.sampleMinimal.includes("Pix") === false, late.sampleMinimal);
eq("sem override, edited é falso", described.templates.every((t) => t.edited === false), true);
eq("chave canônica é canal:evento", templatesDocKey("whatsapp", "billing.late"), "whatsapp:billing.late");

// O fingerprint da configuração cobre as MENSAGENS: editar o texto muda a impressão
// digital — sem isso, "o que foi simulado" e "o que será enviado" voltariam a poder
// divergir em silêncio quando o texto muda.
const baseSettings = {
  rules: [],
  horizonDays: 7,
  runAtHour: 10,
  skipInactiveCustomers: true,
  portalBaseUrl: "https://x.com",
  companyName: "X",
  whatsapp: { enabled: false, windowStart: 9, windowEnd: 20, newChatCapPerDay: 20, perCustomerCapPerDay: 1, pausedUntilMs: null },
};
const fpNoTemplates = settingsFingerprint(baseSettings);
const fpDefaultTemplates = settingsFingerprint({
  ...baseSettings,
  templates: effectiveTemplates({}),
});
eq("sem templates = templates iguais ao padrão (mesmo fingerprint)", fpNoTemplates, fpDefaultTemplates);
const fpEdited = settingsFingerprint({
  ...baseSettings,
  templates: effectiveTemplates({ "whatsapp:billing.late": { body: "TEXTO DIFERENTE", active: true } }),
});
check("editar uma mensagem muda o fingerprint", fpEdited !== fpNoTemplates, { fpEdited, fpNoTemplates });
const fpDisabled = settingsFingerprint({
  ...baseSettings,
  templates: effectiveTemplates({ "push:billing.late": { body: "x", active: false } }),
});
check("desligar uma mensagem também muda o fingerprint", fpDisabled !== fpNoTemplates, { fpDisabled, fpNoTemplates });
eq(
  "reverter ao texto padrão devolve o fingerprint",
  settingsFingerprint({ ...baseSettings, templates: effectiveTemplates({ "whatsapp:billing.late": { body: described.templates.find((t) => t.key === "whatsapp:billing.late").body, active: true } }) }),
  fpNoTemplates
);

// O dispatcher/sync/simulador recebem a lista efetiva pelo mesmo contrato
// (renderFor): um template salvo com {{empresa}} sai com o valor do payload.
check(
  "renderFor aceita a lista efetiva (contrato comum)",
  (() => {
    const list = effectiveTemplates({ "whatsapp:billing.late": { body: "SAVED {{empresa}}", active: true } });
    const { message } = renderFor("whatsapp", "billing.late", { empresa: "ACME" }, list);
    return message?.body === "SAVED ACME";
  })()
);

// ---------------------------------------------------------------------------
// 13. Botões de ação rápida — copiar Pix / código de barras / abrir portal
// ---------------------------------------------------------------------------

section("13. Botões de ação rápida (Pix, código de barras, PDF)");

const actionsInputBase = {
  customer: { full_name: "Maria Souza" },
  dueDate: "2026-09-25",
  reference: "Mensalidade",
  referenceDate: "2026-09-27",
  portalBaseUrl: "https://portal.com",
  companyName: "ACME",
};
const actionsFullPayload = buildPayload({
  ...actionsInputBase,
  billing: {
    id: "b1",
    value: 99.9,
    reference: "Mensalidade",
    due_day: "2026-09-25",
    situation_name: "Em Aberto",
    pix_copy_paste_base64: "PIX000",
    digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678901234",
    integration_link: "https://boleto.exemplo.com/pdf/b1",
  },
});

const acts = buildActions(actionsFullPayload);
eq("Pix copiável é o primeiro botão", acts[0], { label: "Copiar código Pix", copy: "PIX000" });
eq("código de barras sai só com dígitos (47)", acts[1].copy, "34191090123456789012345678901234512345678901234");
eq("portal é o terceiro botão", acts[2], { label: "Abrir portal", url: "https://portal.com/faturas/b1" });
check("nunca mais de 3 botões (limite do WhatsApp)", acts.length <= 3, acts.length);

// Com botões de cópia, o CÓDIGO não pode aparecer no corpo da mensagem (é ilegível
// e redundante). O texto só APONTA para o botão — o fallback de texto puro do
// cliente UazAPI é quem anexa os códigos em linhas 📋 quando o menu é recusado.
const renderedWithButtons = renderFor("whatsapp", "billing.due_soon", actionsFullPayload).message;
check(
  "corpo do WhatsApp não repete o código Pix (fica só no botão)",
  !renderedWithButtons.body.includes("PIX000"),
  renderedWithButtons.body
);
check(
  "corpo do WhatsApp não repete a linha digitável",
  !renderedWithButtons.body.includes("34191090123456789012345678901234512345678901234"),
  renderedWithButtons.body
);
check(
  "corpo ainda aponta para o botão quando há Pix",
  renderedWithButtons.body.includes("Pix copiável no botão"),
  renderedWithButtons.body
);
// Fatura SEM Pix: a linha apontando para o botão não pode sobrar pendurada.
const noPixPayload = buildPayload({
  ...actionsInputBase,
  billing: { id: "b3", value: 99.9, reference: "Mensalidade", due_day: "2026-09-25", situation_name: "Em Aberto", integration_link: "https://boleto.exemplo.com/pdf/b3" },
});
const renderedNoPix = renderFor("whatsapp", "billing.due_soon", noPixPayload).message;
check(
  "sem Pix, texto não menciona botão de Pix",
  !renderedNoPix.body.includes("Pix copiável"),
  renderedNoPix.body
);

const actionsPdfPayload = buildPayload({
  ...actionsInputBase,
  billing: { id: "b1", value: 99.9, reference: "Mensalidade", due_day: "2026-09-25", situation_name: "Em Aberto", integration_link: "https://boleto.exemplo.com/pdf/b1" },
});
eq("boleto sem linha digitável vira botão de PDF (sem Pix, é o primeiro)", buildActions(actionsPdfPayload)[0], { label: "Baixar PDF da fatura", url: "https://boleto.exemplo.com/pdf/b1" });

const actionsMinimalPayload = buildPayload({
  ...actionsInputBase,
  billing: { id: "b2", value: 99.9, reference: "Mensalidade", due_day: "2026-09-25", situation_name: "Em Aberto" },
});
eq("sem dados de cobrança, sobra só o portal", buildActions(actionsMinimalPayload), [{ label: "Abrir portal", url: "https://portal.com/faturas/b2" }]);

// O payload armazenado carrega __actions: um reenvio do mesmo aviso reusa os
// botões sem re-render (o texto do template pode ter mudado; os dados, não).
const storedWithActions = toStoredPayload(actionsFullPayload, "2026-09-25");
check("payload armazenado carrega __actions", Array.isArray(storedWithActions.__actions) && storedWithActions.__actions.length === 3, storedWithActions.__actions);
eq("__dueDate continua viajando junto", storedWithActions.__dueDate, "2026-09-25");
// Payload sem link/pix/boleto (aviso de teste do canal, por exemplo) não ganha chave vazia.
eq("payload sem botões não ganha chave vazia", "__actions" in toStoredPayload({ nome: "x" }, "2026-09-25"), false);

// ---------------------------------------------------------------------------
// 14. Cliques em botões (webhook UazAPI → métricas de uso)
// ---------------------------------------------------------------------------

section("14. Cliques em botões de ação (webhook)");

const buttonEventBody = {
  EventType: "messages",
  message: {
    id: "wamid.CLIQUE1",
    messageid: "wamid.CLIQUE1",
    chatid: "5598999990001@s.whatsapp.net",
    fromMe: false,
    isGroup: false,
    messageType: "buttonsResponseMessage",
    text: "Copiar código Pix",
    buttons_response_message: { selectedDisplayText: "Copiar código Pix" },
    contextInfo: { stanzaId: "MSG-PIX-1" },
  },
};

const parsedClick = parseWebhookPayload(buttonEventBody);
eq("resposta de botão é reconhecida no parse", parsedClick.events.length, 1);
eq("rótulo do botão é extraído", parsedClick.events[0].buttonReply?.label, "Copiar código Pix");
eq("stanzaId (ID da mensagem original) é extraído", parsedClick.events[0].stanzaId, "MSG-PIX-1");

const parsedText = parseWebhookPayload({
  EventType: "messages",
  message: { messageid: "wamid.TXT", chatid: "5598999990001@s.whatsapp.net", fromMe: false, messageType: "Conversation", text: "PARAR" },
});
eq("mensagem de texto não vira clique de botão", parsedText.events[0].buttonReply, null);

function makeWebhookDb() {
  const clicks = [];
  const deliveries = [
    { id: "d-pix", provider_id: "MSG-PIX-1", target: "5598999990001", status: "sent", actions: [{ label: "Copiar código Pix", copy: "PIX1" }, { label: "Abrir portal", url: "https://x" }] },
    { id: "d-outro", provider_id: "MSG-OUTRO", target: "5598999990002", status: "sent", actions: [{ label: "Abrir portal", url: "https://y" }] },
  ];
  const optOutPhones = [];
  const db = () => ({
    from(table) {
      const state = { table, filters: [] };
      const api = {
        select: () => api,
        eq: (col, val) => (state.filters.push([col, val]), api),
        contains: (col, val) => (state.filters.push(["contains", col, val]), api),
        order: () => api,
        limit: async (n) => {
          let rows = state.table === "notification_deliveries" ? deliveries : [];
          for (const [kind, col, val] of state.filters) {
            rows =
              kind === "contains"
                ? rows.filter((r) => JSON.stringify(r[col] ?? []).includes(JSON.stringify(val[0] ?? val)))
                : rows.filter((r) => r[col] === val);
          }
          return { data: rows.slice(0, n), error: null };
        },
        insert: async (row) => {
          if (state.table === "whatsapp_button_clicks") clicks.push(row);
          return { error: null };
        },
        update: () => api,
      };
      return api;
    },
  });
  return { db, clicks, deliveries, optOutPhones };
}

// Clique com stanzaId casa com a entrega exata pelo provider_id.
const wb1 = makeWebhookDb();
const summaryClick = await handleUazapiWebhook(
  { db: wb1.db, outbox: { async markStatusByProviderId() { return 0; } }, log: () => {} },
  buttonEventBody
);
eq("clique é contabilizado", summaryClick.buttonClicks, 1);
// O clique de botão casa com a entrega exata pelo provider_id (stanzaId).
eq("clique casa com a entrega pelo stanzaId", wb1.clicks[0]?.delivery_id, "d-pix");
eq("telefone é gravado (de message.chatid)", wb1.clicks[0]?.phone_e164, "5598999990001");
eq("clique não incrementa opt-outs", summaryClick.optOuts, 0);

// Sem stanzaId: casa pela última entrega enviada ao telefone que incluiu o rótulo.
const wb2 = makeWebhookDb();
const bodyNoStanza = structuredClone(buttonEventBody);
delete bodyNoStanza.message.contextInfo;
bodyNoStanza.message.chatid = "5598999990002@s.whatsapp.net";
await handleUazapiWebhook({ db: wb2.db, outbox: { async markStatusByProviderId() { return 0; } }, log: () => {} }, bodyNoStanza);
eq("fallback casa pela entrega com o mesmo rótulo", wb2.clicks[0]?.delivery_id, null);

// Clique de botão não deve se perder como ignorado nem virar update de status.
check("clique não é contado como ignorado", summaryClick.ignored === 0, summaryClick);

// Fluxos antigos continuam: opt-out por texto e status de entrega.
const wb3 = makeWebhookDb();
const summaryText = await handleUazapiWebhook(
  { db: wb3.db, outbox: { async markStatusByProviderId() { return 0; } }, log: () => {} },
  { EventType: "messages", message: { messageid: "wamid.TXT", chatid: "5598999990001@s.whatsapp.net", fromMe: false, messageType: "Conversation", text: "PARAR" } }
);
eq("opt-out por texto segue funcionando", summaryText.optOuts, 1);
const summaryStatus = await handleUazapiWebhook(
  { db: wb3.db, outbox: { async markStatusByProviderId() { return 1; } }, log: () => {} },
  { EventType: "messages_update", message: { messageid: "MSG-PIX-1", fromMe: true }, status: "read" }
);
eq("status de entrega segue funcionando", summaryStatus.statusUpdated, 1);

function addDaysT(date, days) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 15. Funil de engajamento (enviado → entregue → lido → clicou no Pix)
// ---------------------------------------------------------------------------

section("15. Funil de engajamento semanal");

// Determinismo: o funil é puro — mesma entrada, mesma saída, sem `Date.now()`
// escondido. O instante "agora" é uma quarta-feira qualquer do fim de setembro/2026.
const FUNNEL_NOW = Date.parse("2026-09-23T15:00:00Z"); // qua

// weekStartOf: sempre devolve uma SEGUNDA-FEIRA, inclusive na virada de mês/ano.
eq("weekStartOf de uma quarta é a segunda da mesma semana", weekStartOf(FUNNEL_NOW), "2026-09-21");
eq("weekStartOf de um domingo volta para a segunda", weekStartOf(Date.parse("2026-09-27T23:00:00Z")), "2026-09-21");
eq("weekStartOf na virada de ano cai na segunda anterior", weekStartOf(Date.parse("2026-01-01T12:00:00Z")), "2025-12-29");
eq("weekStartToMs é o inverso (meia-noite local)", weekStartToMs("2026-09-21"), Date.parse("2026-09-21T03:00:00Z"));

const skeleton = buildFunnelWeeks({ now: FUNNEL_NOW, weeks: 4 });
eq("esqueleto tem 4 semanas", skeleton.length, 4);
eq("esqueleto termina na semana corrente", skeleton[3]?.weekStart, "2026-09-21");
eq("esqueleto começa 3 semanas antes", skeleton[0]?.weekStart, "2026-08-31");
eq("rótulo da semana no mesmo mês", skeleton[3]?.label, "21–27 set");

// Rótulo na troca de mês e de ano.
eq("rótulo trocando o mês", formatWeekLabel("2026-09-28", "2026-10-04"), "28 set – 4 out");
eq("rótulo trocando o ano", formatWeekLabel("2025-12-29", "2026-01-04"), "29 dez 25 – 4 jan 26");

// Agregação: uma coorte de entregas e cliques espalhada por duas semanas.
// Semana 1 (31 ago–6 set): 4 enviados, 3 entregues, 2 lidos, 1 clique Pix,
// 1 falha. Semana 4 (21–27 set): 2 enviados, 1 entregue, 0 lidos, 1 clique Pix.
const funnelDeliveries = [
  // Semana de 31/08 — coorte completa (status finais).
  { status: "read", sent_at: Date.parse("2026-09-01T12:00:00Z"), created_at: Date.parse("2026-08-31T12:00:00Z") },
  { status: "read", sent_at: Date.parse("2026-09-02T12:00:00Z"), created_at: Date.parse("2026-09-01T12:00:00Z") },
  { status: "delivered", sent_at: Date.parse("2026-09-03T12:00:00Z"), created_at: Date.parse("2026-09-02T12:00:00Z"), },
  { status: "sent", sent_at: Date.parse("2026-09-04T12:00:00Z"), created_at: Date.parse("2026-09-03T12:00:00Z") },
  { status: "failed", sent_at: null, created_at: Date.parse("2026-09-05T12:00:00Z") },
  // Semana de 21/09 — coorte recente.
  { status: "delivered", sent_at: Date.parse("2026-09-22T12:00:00Z"), created_at: Date.parse("2026-09-22T11:00:00Z") },
  { status: "sent", sent_at: Date.parse("2026-09-23T12:00:00Z"), created_at: Date.parse("2026-09-23T11:00:00Z") },
  // Linha antiga sem sent_at: cai no created_at (cinto de segurança).
  { status: "sent", sent_at: null, created_at: Date.parse("2026-09-02T12:00:00Z") },
  // Enviada na semana 1, LIDA na semana 3: conta tudo na semana 1 (coorte por
  // sent_at) — senão a leitura atrasada inflaria a semana 3.
  { status: "read", sent_at: Date.parse("2026-09-01T12:00:00Z"), created_at: Date.parse("2026-09-01T12:00:00Z") },
  // Fora da janela do esqueleto: ignorada.
  { status: "sent", sent_at: Date.parse("2026-08-01T12:00:00Z"), created_at: Date.parse("2026-08-01T12:00:00Z") },
  // Queued/skipped/canceled não entram no funil.
  { status: "queued", sent_at: null, created_at: Date.parse("2026-09-22T12:00:00Z") },
  { status: "skipped", sent_at: null, created_at: Date.parse("2026-09-22T12:00:00Z") },
];
const funnelClicks = [
  { created_at: Date.parse("2026-09-02T14:00:00Z"), button_label: "Copiar código Pix" },
  { created_at: Date.parse("2026-09-23T14:00:00Z"), button_label: "Copiar código Pix" },
  { created_at: Date.parse("2026-09-23T15:00:00Z"), button_label: "Abrir portal" }, // não é Pix
  { created_at: Date.parse("2026-08-20T14:00:00Z"), button_label: "Copiar código Pix" }, // fora da janela
];

const funnel = aggregateFunnel({ weeks: buildFunnelWeeks({ now: FUNNEL_NOW, weeks: 4 }), deliveries: funnelDeliveries, clicks: funnelClicks });
eq("semana 1: 6 enviados", funnel[0]?.sent, 6);
eq("semana 1: 4 entregues", funnel[0]?.delivered, 4);
eq("semana 1: 3 lidos", funnel[0]?.read, 3);
eq("semana 1: 1 falha", funnel[0]?.failed, 1);
eq("semana 1: 1 clique no Pix", funnel[0]?.pixClicks, 1);
eq("semana 4: 2 enviados", funnel[3]?.sent, 2);
eq("semana 4: 1 entregue", funnel[3]?.delivered, 1);
eq("semana 4: 0 lidos", funnel[3]?.read, 0);
eq("semana 4: 1 clique no Pix", funnel[3]?.pixClicks, 1);
eq("semana 2 e 3 ficam zeradas", [funnel[1]?.sent, funnel[2]?.sent], [0, 0]);

const funnelTotal = funnelTotals(funnel);
eq("totais somam as semanas", funnelTotal, { sent: 8, delivered: 5, read: 3, pixClicks: 2, failed: 1 });

// O funil é CUMULATIVO por etapa (entregue ⊇ lido) — nunca entregue > enviado.
check(
  "funil cumulativo: entregue nunca passa de enviado",
  funnel.every((w) => w.delivered <= w.sent && w.read <= w.delivered),
  funnel
);

// Cliques sem rótulo não quebram a agregação.
const funnelNoLabel = aggregateFunnel({ weeks: buildFunnelWeeks({ now: FUNNEL_NOW, weeks: 2 }), deliveries: [], clicks: [{ created_at: Date.parse("2026-09-22T14:00:00Z"), button_label: null }] });
eq("clique sem rótulo é ignorado", funnelNoLabel[1]?.pixClicks, 0);

// ---------------------------------------------------------------------------

console.log(`\n${failures.length === 0 ? "✓" : "✗"} ${pass} verificações passaram, ${failures.length} falharam`);
for (const item of failures) console.log(`  ✗ ${item}`);
process.exit(failures.length === 0 ? 0 : 1);
