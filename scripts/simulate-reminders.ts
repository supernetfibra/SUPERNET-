#!/usr/bin/env node
/**
 * Simulador de lembretes de fatura — dry-run.
 *
 *   node scripts/simulate-reminders.ts                     # cenário sintético realista
 *   node scripts/simulate-reminders.ts --scenario stress    # 5.000 clientes, testa a cota
 *   node scripts/simulate-reminders.ts --snapshot base.json # extrato da base real
 *   node scripts/simulate-reminders.ts --opt-in all         # "e se todos aceitarem?"
 *   node scripts/simulate-reminders.ts --json > relatorio.json
 *
 * Não envia nada, não grava nada, não fala com a UazAPI. Usa exatamente o mesmo
 * núcleo puro (`supabase/functions/api/notify/*`) que a Edge Function usa, então o
 * que aparece aqui é o que o pipeline decidiria em produção — a única diferença é
 * que aqui ninguém recebe nada.
 *
 * A base real da MikWeb exige credencial que só existe nos secrets do Supabase;
 * para rodar sobre ela use o endpoint `GET /api/admin/notifications/simulate`.
 * Com `--mikweb` esta CLI tenta a API direto (precisa de MIKWEB_API_URL/TOKEN
 * reais no ambiente ou em .env/.env.local).
 *
 * Roda no Node 24 (type stripping nativo) — sem build, sem dependência.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { civilToday, formatBRL, type RawBilling, type RawCustomer } from "../supabase/functions/api/notify/model.ts";
import { generateDemoBase, parseSnapshot, type DemoScenario } from "../supabase/functions/api/notify/demo-data.ts";
import {
  defaultDocument,
  defaultWhatsAppSettings,
  normalizeDocument,
  normalizeWhatsApp,
  settingsFrom,
  type SettingsDocument,
  type WhatsAppSettings,
} from "../supabase/functions/api/notify/settings.ts";
import { applyOverrides } from "../supabase/functions/api/notify/settings-store.ts";
import {
  labelOf,
  runSimulation,
  summarize,
  type SimulationContact,
  type SimulationReport,
  type SimulationSourceInfo,
} from "../supabase/functions/api/notify/simulate.ts";

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

interface Args {
  scenario: DemoScenario;
  snapshot: string | null;
  customers: number | null;
  today: string | null;
  /** Configuração persistida exportada do painel (mesmo documento de notification_config). */
  settingsFile: string | null;
  // Estes são OVERRIDES: `null` = não passado na linha de comando, então vale o que
  // estiver no arquivo de configuração (ou o default do código).
  horizon: number | null;
  at: number | null;
  cap: number | null;
  perCustomerCap: number | null;
  optIn: "auto" | "all" | "none";
  push: "auto" | "all" | "none";
  whatsappEnabled: boolean | null;
  instanceConnected: boolean;
  lockedDays: number;
  markAlreadySent: boolean;
  revealPhones: boolean;
  mikweb: boolean;
  json: boolean;
  out: string | null;
  exportBase: string | null;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    scenario: "realistic",
    snapshot: null,
    customers: null,
    today: null,
    settingsFile: null,
    horizon: null,
    at: null,
    cap: null,
    perCustomerCap: null,
    optIn: "auto",
    push: "auto",
    whatsappEnabled: null,
    instanceConnected: true,
    lockedDays: 0,
    markAlreadySent: false,
    revealPhones: false,
    mikweb: false,
    json: false,
    out: null,
    exportBase: null,
    limit: 20,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) fail(`faltou valor para ${arg}`);
      return value;
    };
    switch (arg) {
      case "--scenario": {
        const value = next();
        if (value !== "realistic" && value !== "stress" && value !== "edge") fail(`cenário inválido: ${value}`);
        args.scenario = value;
        break;
      }
      case "--snapshot": args.snapshot = next(); break;
      case "--customers": args.customers = Number(next()); break;
      case "--today": args.today = next(); break;
      case "--settings": args.settingsFile = next(); break;
      case "--horizon": args.horizon = Number(next()); break;
      case "--at": args.at = Number(next()); break;
      case "--cap": args.cap = Number(next()); break;
      case "--per-customer-cap": args.perCustomerCap = Number(next()); break;
      case "--opt-in": args.optIn = next() as Args["optIn"]; break;
      case "--push": args.push = next() as Args["push"]; break;
      case "--no-whatsapp": args.whatsappEnabled = false; break;
      case "--instance-down": args.instanceConnected = false; break;
      case "--locked": args.lockedDays = Number(next()); break;
      case "--already-sent": args.markAlreadySent = true; break;
      case "--reveal-phones": args.revealPhones = true; break;
      case "--mikweb": args.mikweb = true; break;
      case "--json": args.json = true; break;
      case "--out": args.out = next(); break;
      case "--export-base": args.exportBase = next(); break;
      case "--limit": args.limit = Number(next()); break;
      case "--help":
      case "-h": usage(); process.exit(0); break;
      default: fail(`argumento desconhecido: ${arg}`);
    }
  }
  return args;
}

function fail(message: string): never {
  console.error(`erro: ${message}\n`);
  usage();
  process.exit(2);
}

function usage(): void {
  console.log(`
Simulador de lembretes de fatura (dry-run)

  --scenario <realistic|stress|edge>  base sintética determinística (default: realistic)
  --snapshot <arquivo.json>           extrator da base real
  --mikweb                            tenta a API MikWeb do ambiente/.env
  --customers <n>                     tamanho da base sintética
  --today <YYYY-MM-DD>                data civil de referência (default: hoje em UTC-3)
  --settings <arquivo.json>           configuração persistida (o mesmo documento que o painel salva)
                                      vem de GET /api/admin/notifications/settings; sem ela, régua padrão
  --horizon <dias>                    OVERRIDE do horizonte simulado (default: o da configuração)
  --at <hora>                         OVERRIDE da hora de execução, 0-23 (default: o da configuração)
  --cap <n>                           OVERRIDE da cota de novas conversas/dia (default: a da configuração)
  --per-customer-cap <n>              OVERRIDE dos avisos por cliente por dia (default: o da configuração)
  --opt-in <auto|all|none>            quem aceitou receber (default: auto, o que a base diz)
  --push <auto|all|none>              quem tem inscrição push (default: auto)
  --no-whatsapp                       simula WhatsApp desligado no admin
  --instance-down                     simula instância desconectada
  --locked <dias>                     simula time-lock do WhatsApp por N dias
  --already-sent                      marca os envios do primeiro dia como já feitos (testa dedupe)
  --reveal-phones                     mostra o número completo (default: mascarado)
  --export-base <arquivo.json>        grava a base sintética usada, para virar um caso reproduzível
  --limit <n>                         linhas da tabela na saída (default: 20)
  --json                              relatório completo em JSON
  --out <arquivo.json>                grava o relatório em arquivo
  -h, --help                          esta ajuda
`);
}

// ---------------------------------------------------------------------------
// Fontes de dados
// ---------------------------------------------------------------------------

function readEnvFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

function looksLikePlaceholder(url: string, token: string): string | null {
  if (!url || !token) return "MIKWEB_API_URL e MIKWEB_API_TOKEN precisam estar definidos";
  if (/seu-mikweb|your-|example\.com/i.test(url)) return `a URL da MikWeb é um placeholder (${url}) — as credenciais reais estão nos secrets do Supabase`;
  if (token.length < 20) return "o token da MikWeb tem cara de placeholder";
  return null;
}

async function loadFromMikWeb(
  today: string,
  horizon: number,
  limitCustomers: number
): Promise<{ base: ReturnType<typeof generateDemoBase>; source: SimulationSourceInfo }> {
  const envFile = readEnvFiles();
  const baseUrl = (process.env.MIKWEB_API_URL || envFile.MIKWEB_API_URL || "").replace(/\/+$/, "");
  const token = process.env.MIKWEB_API_TOKEN || envFile.MIKWEB_API_TOKEN || "";
  const problem = looksLikePlaceholder(baseUrl, token);
  if (problem) throw new Error(problem);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const from = today;
  const to = new Date(new Date(`${today}T00:00:00Z`).getTime() + horizon * 86_400_000).toISOString().slice(0, 10);

  const get = async (path: string): Promise<{ data: unknown; totalPages: number }> => {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    if (!response.ok) throw new Error(`MikWeb ${path} → HTTP ${response.status}`);
    const parsed = (await response.json()) as Record<string, unknown>;
    const dataKey = Object.keys(parsed).find((k) => k !== "meta");
    const meta = parsed.meta as { pages?: { total_pages?: number } } | undefined;
    return { data: dataKey ? parsed[dataKey] : parsed, totalPages: meta?.pages?.total_pages ?? 1 };
  };

  // Caminho barato: faturas por janela de vencimento, sem varrer cliente por cliente.
  try {
    const page = await get(`/billings?date_from=${from}&date_to=${to}&per_page=100`);
    const billings = Array.isArray(page.data) ? (page.data as RawBilling[]) : [];
    if (billings.length > 0) {
      const customers = await loadCustomers(get, billings, limitCustomers);
      return {
        base: { customers, billings, pushCustomerIds: [], contacts: [], assumptions: [] },
        source: {
          kind: "mikweb",
          strategy: "bulk",
          customersScanned: customers.length,
          billingsScanned: billings.length,
          truncated: false,
          note: "faturas obtidas em lote por janela de vencimento",
        },
      };
    }
  } catch {
    // cai para o caminho por cliente
  }

  // Caminho caro (N+1): só funciona com uma amostra de clientes.
  const { data: rawCustomers } = await get(`/customers?per_page=${limitCustomers}`);
  const customers = Array.isArray(rawCustomers) ? (rawCustomers as RawCustomer[]) : [];
  const billings: RawBilling[] = [];
  for (const customer of customers) {
    try {
      const page = await get(`/billings?customer_id=${customer.id}&per_page=50`);
      if (Array.isArray(page.data)) billings.push(...(page.data as RawBilling[]));
    } catch {
      // cliente sem fatura acessível — segue
    }
  }
  return {
    base: { customers, billings, pushCustomerIds: [], contacts: [], assumptions: [] },
    source: {
      kind: "mikweb",
      strategy: "per-customer",
      customersScanned: customers.length,
      billingsScanned: billings.length,
      truncated: true,
      note: `varredura por cliente limitada a ${limitCustomers} clientes — NÃO é a base inteira`,
    },
  };
}

async function loadCustomers(
  get: (path: string) => Promise<{ data: unknown; totalPages: number }>,
  billings: RawBilling[],
  limitCustomers: number
): Promise<RawCustomer[]> {
  const ids = [...new Set(billings.map((b) => String(b.customer_id)))].slice(0, limitCustomers);
  const customers: RawCustomer[] = [];
  const found = new Set<string>();
  for (let page = 1; page <= 20 && found.size < ids.length; page++) {
    let result: { data: unknown; totalPages: number };
    try {
      result = await get(`/customers?per_page=100&page=${page}`);
    } catch {
      break;
    }
    if (!Array.isArray(result.data)) break;
    for (const customer of result.data as RawCustomer[]) {
      const id = String(customer.id);
      if (ids.includes(id) && !found.has(id)) {
        found.add(id);
        customers.push(customer);
      }
    }
    if (page >= result.totalPages) break;
  }
  return customers;
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

function pad(value: string, width: number): string {
  const text = value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;
  return text.padEnd(width, " ");
}

function printReport(report: SimulationReport, args: Args): void {
  const summary = summarize(report);
  const line = "─".repeat(96);

  console.log(`\n${line}`);
  console.log("  SIMULAÇÃO DE LEMBRETES POR WHATSAPP — DRY-RUN (nada é enviado, nada é gravado)");
  console.log(line);

  console.log(`\n  RESUMO — ${summary.headline}\n`);
  for (const item of summary.lines) console.log(`    ${item}`);

  const notable = Object.entries(report.reach.phoneFailures);
  if (notable.length) {
    console.log(`    telefone .......... ${notable.map(([reason, count]) => `${count} com ${reasonLabel(reason)}`).join(" | ")}`);
  }

  if (report.assumptions.length) {
    console.log("\n  SUPOSIÇÕES (o que não foi possível saber)\n");
    for (const item of report.assumptions) console.log(`    • ${item}`);
  }

  if (report.templateWarnings.length) {
    console.log("\n  ATENÇÃO — TEMPLATE\n");
    for (const item of report.templateWarnings) console.log(`    ! ${item}`);
  }

  const shown = report.items.slice(0, args.limit);
  console.log(`\n  FILA (${shown.length} de ${report.items.length}${report.itemsTruncated ? "+ (truncado)" : ""})\n`);
  console.log(
    `    ${pad("ENVIO", 11)}${pad("CLIENTE", 26)}${pad("REF", 8)}${pad("VENC", 11)}${pad("VALOR", 11)}${pad("REGRA", 10)}${pad("DECISÃO", 26)}`
  );
  for (const item of shown) {
    console.log(
      `    ${pad(item.sendDateBR, 11)}${pad(item.customerName, 26)}${pad(item.reference, 8)}${pad(item.dueDateBR, 11)}${pad(
        formatBRL(item.valueWithCharges),
        11
      )}${pad(item.ruleKey, 10)}${pad(item.decisionLabel, 26)}`
    );
    if (item.decision !== "send_whatsapp" && item.decision !== "fallback_push") {
      console.log(`      ${" ".repeat(4)}↳ ${item.reason}`);
    }
  }

  const previews = report.items.filter((item) => item.preview).slice(0, 3);
  if (previews.length) {
    console.log("\n  PREVIEW DAS MENSAGENS\n");
    for (const item of previews) {
      console.log(`    ┌─ ${item.channel === "push" ? "PUSH" : "WHATSAPP"} · ${item.eventKey} · ${item.customerName} (${item.phone ?? item.phoneMasked ?? "sem telefone"})`);
      if (item.preview?.title) console.log(`    │ ${item.preview.title}`);
      for (const bodyLine of (item.preview?.body ?? "").split("\n")) console.log(`    │ ${bodyLine}`);
      console.log(`    └─ ${line.slice(0, 40)}`);
    }
  }

  const byRuleRows = Object.entries(report.byRule).sort((a, b) => b[1] - a[1]);
  if (byRuleRows.length) {
    console.log(`\n  POR REGRA\n    ${byRuleRows.map(([rule, count]) => `${rule}: ${count}`).join("   ")}`);
  }
  const byDecisionRows = Object.entries(report.byDecision).sort((a, b) => b[1] - a[1]);
  if (byDecisionRows.length) {
    console.log(`\n  POR DECISÃO\n    ${byDecisionRows.map(([code, count]) => `${labelOf(code)}: ${count}`).join("   ")}`);
  }

  console.log(`\n  ${line}\n`);
}

/**
 * Lê o documento exportado do painel (a resposta de
 * `GET /api/admin/notifications/settings`). Passa pelo `normalizeDocument` como
 * qualquer outra entrada: um arquivo editado à mão com offset maluco é limitado (e o
 * relatório diz o que foi limitado) em vez de virar disparo errado.
 *
 * O bloco `whatsapp` do arquivo, quando existe, define o CENÁRIO do canal. Sem ele, a
 * CLI assume canal ligado — esta ferramenta existe para simular o pipeline de
 * WhatsApp, e um canal desligado por padrão responderia sempre "sem canal".
 */
function readSettingsFile(path: string | null): {
  document: SettingsDocument;
  whatsapp: WhatsAppSettings;
  origin: "db" | "defaults";
} {
  const scenarioBase: WhatsAppSettings = { ...defaultWhatsAppSettings(), enabled: true };
  if (!path) return { document: defaultDocument(), whatsapp: scenarioBase, origin: "defaults" };

  const resolved = resolve(path);
  if (!existsSync(resolved)) fail(`arquivo de configuração não encontrado: ${resolved}`);
  try {
    const raw = JSON.parse(readFileSync(resolved, "utf8")) as Record<string, unknown>;
    return {
      document: normalizeDocument(raw, defaultDocument()).document,
      whatsapp: normalizeWhatsApp(raw.whatsapp, scenarioBase).whatsapp,
      // O export traz a procedência (`GET /settings` devolve `origin`): preservá-la é o
      // que permite ler o relatório depois e saber se aquilo era a config salva.
      origin: raw.origin === "db" ? "db" : "defaults",
    };
  } catch (error) {
    fail(`não foi possível ler a configuração: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function reasonLabel(reason: string): string {
  if (reason === "landline") return "telefone fixo";
  if (reason === "empty") return "sem telefone";
  return "telefone inválido";
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const today = args.today ?? civilToday();

  // Configuração da rodada: o arquivo (se houver) sobre os defaults do código, e os
  // flags da linha de comando como OVERRIDE — pelo mesmo `applyOverrides` que a rota
  // admin usa. Nenhuma porta de entrada constrói configuração por conta própria.
  const fromFile = readSettingsFile(args.settingsFile);
  const { settings, applied: overrides } = applyOverrides(settingsFrom(fromFile.document, fromFile.whatsapp), {
    horizonDays: args.horizon ?? undefined,
    runAtHour: args.at ?? undefined,
    newChatCapPerDay: args.cap ?? undefined,
    perCustomerCapPerDay: args.perCustomerCap ?? undefined,
    whatsappEnabled: args.whatsappEnabled ?? undefined,
  });

  let customers: RawCustomer[];
  let billings: RawBilling[];
  let pushCustomerIds: string[];
  let contacts: SimulationContact[];
  let assumptions: string[];
  let source: SimulationSourceInfo;

  if (args.snapshot) {
    const path = resolve(args.snapshot);
    if (!existsSync(path)) fail(`snapshot não encontrado: ${path}`);
    const parsed = parseSnapshot(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.ok && parsed.errors.some((e) => e.includes("faturas"))) {
      for (const error of parsed.errors) console.error(`  ! ${error}`);
      fail("snapshot inválido");
    }
    customers = parsed.base.customers;
    billings = parsed.base.billings;
    pushCustomerIds = parsed.base.pushCustomerIds;
    contacts = parsed.base.contacts;
    assumptions = parsed.base.assumptions;
    source = {
      kind: "snapshot",
      strategy: "snapshot",
      customersScanned: customers.length,
      billingsScanned: billings.length,
      truncated: false,
      note: path,
    };
  } else if (args.mikweb) {
    const loaded = await loadFromMikWeb(today, settings.horizonDays, args.customers ?? 50);
    customers = loaded.base.customers;
    billings = loaded.base.billings;
    pushCustomerIds = loaded.base.pushCustomerIds;
    contacts = loaded.base.contacts;
    assumptions = [
      loaded.source.note ?? "base MikWeb",
      "o histórico de conversas e a tabela de cota do WhatsApp não foram lidos — nenhum cliente tem conversa aberta",
      "nenhum cliente tem opt-in registrado (a tabela de consentimento ainda não existe) — use --opt-in all para simular o cenário otimista",
    ];
    source = loaded.source;
  } else {
    const demo = generateDemoBase({ scenario: args.scenario, customers: args.customers ?? undefined, today });
    customers = demo.customers;
    billings = demo.billings;
    pushCustomerIds = demo.pushCustomerIds;
    contacts = demo.contacts;
    assumptions = [...demo.assumptions];
    source = {
      kind: "synthetic",
      strategy: "synthetic",
      customersScanned: customers.length,
      billingsScanned: billings.length,
      truncated: false,
      note: `cenário ${args.scenario}`,
    };
  }

  if (args.exportBase) {
    const path = resolve(args.exportBase);
    writeFileSync(
      path,
      JSON.stringify({ generatedAt: new Date().toISOString(), customers, billings, pushCustomerIds, whatsappContacts: contacts }, null, 2)
    );
    console.log(`base exportada para ${path}`);
  }

  if (args.optIn === "all") {
    contacts = customers.map((customer) => ({ customerId: String(customer.id), optIn: true, phone: null, hasConversation: false }));
    assumptions.push("--opt-in all: assumido que 100% dos clientes aceitaram receber por WhatsApp");
  } else if (args.optIn === "none") {
    contacts = [];
    assumptions.push("--opt-in none: assumido que nenhum cliente aceitou receber por WhatsApp");
  }
  if (args.push === "all") {
    pushCustomerIds = customers.map((customer) => String(customer.id));
    assumptions.push("--push all: assumido que 100% dos clientes têm inscrição push ativa");
  } else if (args.push === "none") {
    pushCustomerIds = [];
    assumptions.push("--push none: assumido que nenhum cliente tem inscrição push");
  }
  if (!args.whatsappEnabled) assumptions.push("--no-whatsapp: canal WhatsApp desligado — tudo cai no fallback de push");
  if (!args.instanceConnected) assumptions.push("--instance-down: instância desconectada (bloqueio transitório, não faz fallback)");
  if (args.lockedDays > 0) assumptions.push(`--locked: time-lock do WhatsApp por ${args.lockedDays} dia(s)`);

  const lockUntil = args.lockedDays > 0 ? new Date(`${today}T12:00:00Z`).getTime() + args.lockedDays * 86_400_000 : null;

  assumptions.push(
    args.settingsFile
      ? `configuração lida de ${args.settingsFile} (origem: ${fromFile.origin}) — o fingerprint dela abre o relatório`
      : "sem --settings: a régua padrão do código está em vigor (use GET /api/admin/notifications/settings para simular a configuração do painel)"
  );
  if (!args.settingsFile) {
    assumptions.push("sem --settings não há estado de canal: a CLI assume WhatsApp ligado (use --no-whatsapp para o cenário desligado)");
  }
  for (const item of overrides) assumptions.push(`sobreposto nesta rodada: ${item} — não é o que será enviado enquanto não for salvo`);

  const simulate = (sentKeys: string[]): SimulationReport =>
    runSimulation({
      customers,
      billings,
      pushCustomerIds,
      contacts,
      source,
      assumptions,
      settings: { ...settings, origin: fromFile.origin },
      overrides,
      today,
      alreadySent: sentKeys,
      revealPhones: args.revealPhones,
      state: {
        instanceConnected: args.instanceConnected,
        pausedUntilMs: lockUntil,
        nowMs: Date.now(),
      },
    });

  const before = simulate([]);
  let report = before;

  if (args.markAlreadySent) {
    // Segunda passada com os avisos já entregues: prova que a idempotência por
    // dedupe_key segura a repetição. Se a segunda passada enviasse de novo, o
    // índice único de (evento, canal, destino) estaria furado.
    const sentKeys = before.items
      .filter((item) => item.decision === "send_whatsapp" || item.decision === "fallback_push")
      .slice(0, 25)
      .map((item) => item.dedupeKey);
    report = simulate(sentKeys);
    const deduped = report.byDecision["skip_dedupe"] ?? 0;
    const beforeDeduped = before.byDecision["skip_dedupe"] ?? 0;
    console.log(
      `\n  [--already-sent] ${sentKeys.length} avisos dados como já entregues: ${deduped - beforeDeduped} ficaram como duplicados na segunda passada.`
    );
  }

  if (args.out) {
    const path = resolve(args.out);
    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(`relatório gravado em ${path}`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, args);
  }
}

main().catch((error) => {
  console.error(`\nerro: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
