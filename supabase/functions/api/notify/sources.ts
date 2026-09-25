/**
 * Fontes de dados para a simulação na Edge Function.
 *
 * Este é o único arquivo do diretório que faz I/O — e ainda assim só **lê**:
 * nenhuma escrita, nenhuma chamada à UazAPI. As dependências entram por injeção
 * (`SourcesDeps`) para não criar import circular com `../index.ts`, que é quem
 * possui `db()`, `getMikWebConfig()` e `mikwebApiGetFull()`.
 *
 * As tabelas de consentimento e de outbox (`whatsapp_contacts`,
 * `notification_preferences`, `notification_deliveries`) pertencem à migration 003
 * e ainda não existem. Toda leitura delas é best-effort: se a tabela faltar, o
 * simulador continua e **declara no relatório** o que assumiu — em vez de falhar.
 * É o que permite validar as regras hoje, antes de a migration existir.
 */

import type { RawBilling, RawCustomer } from "./model.ts";
import type { SimulationContact, SimulationSourceInfo } from "./simulate.ts";
import type { SupabaseLike } from "./outbox.ts";

export type { SupabaseLike };

export interface SourcesDeps {
  db: () => SupabaseLike;
  getConfig: () => Promise<{ baseUrl: string; token: string } | null>;
  apiGetFull: <T>(path: string) => Promise<{ data: T; meta?: { pages?: { total_pages?: number } } }>;
}

export interface LoadOptions {
  from: string;
  to: string;
  /** Teto de clientes varridos na estratégia por cliente (que é N+1 e cara). */
  limitCustomers: number;
  maxPages: number;
  assumeOptIn: "table" | "all" | "none";
  assumePush: "table" | "all" | "none";
}

export interface LoadedBase {
  customers: RawCustomer[];
  billings: RawBilling[];
  pushCustomerIds: string[];
  contacts: SimulationContact[];
  alreadySent: string[];
  source: SimulationSourceInfo;
  assumptions: string[];
  /** Contagens do que foi lido de fato (usadas pelo sync; o simulador tem as suas). */
  scanned?: { billings: number; customers: number; contacts: number };
}

/**
 * Carrega a base do SYNC (enfileiramento automático).
 *
 * Delega para `loadRealBase`, e isso é o ponto: opt-in, celular e histórico de conversa
 * são lidos pelo MESMO código que o simulador usa, então o que o painel mostrou é o que
 * o sync enfileira. Duas diferenças, fixadas aqui:
 *
 *   - a varredura é por janela de **vencimento**, calculada pela régua
 *     (`syncDueWindow`): uma regra "3 dias antes" só gera aviso hoje para fatura que
 *     ainda não venceu, então varrer "as faturas de hoje" perderia justamente o aviso
 *     mais valioso da régua;
 *   - `assumeOptIn`/`assumePush` são sempre `table`: cenário otimista serve para medir
 *     cobertura no simulador, nunca para enfileirar mensagem a quem não autorizou.
 */
export async function loadSyncBase(
  deps: SourcesDeps,
  options: { dueFrom: string; dueTo: string; limitCustomers?: number; maxPages?: number }
): Promise<LoadedBase> {
  return loadRealBase(deps, {
    from: options.dueFrom,
    to: options.dueTo,
    limitCustomers: options.limitCustomers ?? 25,
    maxPages: options.maxPages ?? 10,
    assumeOptIn: "table",
    assumePush: "table",
  });
}

export class MikWebNotConfigured extends Error {
  constructor() {
    super("MikWeb API não configurada — defina em Configurações ou nos secrets do Supabase.");
    this.name = "MikWebNotConfigured";
  }
}

interface TableRead {
  ok: boolean;
  rows: Record<string, unknown>[];
  error?: string;
}

async function tryRead(deps: SourcesDeps, table: string, columns: string, limit = 5000): Promise<TableRead> {
  try {
    const { data, error } = await deps.db().from(table).select(columns).limit(limit);
    if (error) return { ok: false, rows: [], error: String(error.message ?? error) };
    return { ok: true, rows: (data ?? []) as Record<string, unknown>[] };
  } catch (error) {
    return { ok: false, rows: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function readCustomers(
  deps: SourcesDeps,
  ids: Set<string>,
  maxPages: number
): Promise<RawCustomer[]> {
  const found: RawCustomer[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages && seen.size < ids.size; page++) {
    let batch: RawCustomer[] = [];
    try {
      const result = await deps.apiGetFull<RawCustomer[]>(`/customers?per_page=100&page=${page}`);
      batch = result.data ?? [];
      if (!batch.length) break;
    } catch {
      break;
    }
    for (const customer of batch) {
      const id = String(customer?.id ?? "");
      if (ids.has(id) && !seen.has(id)) {
        seen.add(id);
        found.push(customer);
      }
    }
  }
  return found;
}

/**
 * Carrega a base real. Duas estratégias, e o relatório sempre diz qual foi usada:
 *
 *   bulk         → `/billings?date_from&date_to` (uma varredura, cobre toda a base)
 *   per-customer → varre N clientes e busca as faturas de cada um (N+1, só uma amostra)
 *
 * O fallback existe porque não é garantido que a MikWeb aceite `/billings` sem
 * `customer_id`. Quando cai no caminho caro, o resultado é **uma amostra** e o
 * relatório marca `truncated: true` — sem isso o admin acharia que viu a base toda.
 */
export async function loadRealBase(deps: SourcesDeps, options: LoadOptions): Promise<LoadedBase> {
  const config = await deps.getConfig();
  if (!config) throw new MikWebNotConfigured();

  const assumptions: string[] = [];
  const billings: RawBilling[] = [];
  let customers: RawCustomer[] = [];
  let strategy: SimulationSourceInfo["strategy"] = "bulk";
  let truncated = false;
  let note: string | undefined;

  // --- estratégia 1: varredura por janela de vencimento ---------------------
  try {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= options.maxPages) {
      const path = `/billings?date_from=${options.from}&date_to=${options.to}&per_page=100${page > 1 ? `&page=${page}` : ""}`;
      const result = await deps.apiGetFull<RawBilling[]>(path);
      const batch = result.data ?? [];
      if (!batch.length) break;
      billings.push(...batch);
      totalPages = result.meta?.pages?.total_pages ?? 1;
      if (totalPages === 1) break;
      page++;
    }
    if (page > options.maxPages && totalPages > options.maxPages) {
      truncated = true;
      note = `varredura limitada a ${options.maxPages} páginas`;
      assumptions.push(`a varredura em lote foi limitada a ${options.maxPages} páginas — pode haver faturas fora do relatório`);
    }
  } catch {
    billings.length = 0;
  }

  const ids = new Set(billings.map((billing) => String(billing.customer_id)));

  // --- estratégia 2: varredura por cliente (amostra) ------------------------
  if (ids.size === 0) {
    strategy = "per-customer";
    truncated = true;
    try {
      const firstPage = await deps.apiGetFull<RawCustomer[]>(`/customers?per_page=${options.limitCustomers}`);
      const sample = (firstPage.data ?? []).slice(0, options.limitCustomers);
      for (const customer of sample) {
        const id = String(customer?.id ?? "");
        if (!id) continue;
        customers.push(customer);
        try {
          const result = await deps.apiGetFull<RawBilling[]>(`/billings?customer_id=${id}&per_page=50`);
          for (const billing of result.data ?? []) billings.push(billing);
        } catch {
          // cliente sem faturas acessíveis — segue
        }
      }
      ids.clear();
      for (const billing of billings) ids.add(String(billing.customer_id));
      note = `amostra de ${customers.length} clientes — NÃO é a base inteira`;
      assumptions.push(`a MikWeb não retornou faturas por janela de vencimento; foi usada uma amostra de ${customers.length} clientes`);
    } catch (error) {
      note = error instanceof Error ? error.message : String(error);
    }
  }

  if (!customers.length && ids.size) {
    customers = await readCustomers(deps, ids, options.maxPages);
    if (customers.length < ids.size) {
      assumptions.push(
        `apenas ${customers.length} de ${ids.size} clientes das faturas foram carregados — nome e telefone dos demais ficam indisponíveis`
      );
    }
  }

  // --- alcance por canal ----------------------------------------------------
  const pushRead = await tryRead(deps, "push_subscriptions", "customer_id");
  let pushCustomerIds: string[] =
    pushRead.ok && options.assumePush === "table"
      ? pushRead.rows.map((row) => String(row.customer_id ?? "")).filter(Boolean)
      : [];
  if (options.assumePush === "all") {
    pushCustomerIds = customers.map((customer) => String(customer.id));
    assumptions.push("assumido que 100% dos clientes têm inscrição push ativa");
  } else if (options.assumePush === "none") {
    pushCustomerIds = [];
    assumptions.push("assumido que nenhum cliente tem inscrição push");
  } else if (!pushRead.ok) {
    assumptions.push(`tabela push_subscriptions não pôde ser lida (${pushRead.error ?? "erro"}) — assumido que ninguém tem push`);
  }

  const contactRead = await tryRead(deps, "whatsapp_contacts", "customer_id, phone_e164, opt_in, opt_out_at");
  const prefRead = await tryRead(deps, "notification_preferences", "customer_id, channel, enabled");

  const contacts = new Map<string, SimulationContact>();
  if (contactRead.ok && options.assumeOptIn === "table") {
    for (const row of contactRead.rows) {
      const id = String(row.customer_id ?? "");
      if (!id) continue;
      contacts.set(id, {
        customerId: id,
        phone: row.phone_e164 ? String(row.phone_e164) : null,
        optIn: row.opt_in === true && !row.opt_out_at,
      });
    }
    const prefRows = prefRead.rows.filter((row) => row.channel === "whatsapp");
    for (const row of prefRows) {
      const id = String(row.customer_id ?? "");
      const existing = contacts.get(id);
      contacts.set(id, {
        customerId: id,
        phone: existing?.phone ?? null,
        optIn: row.enabled === true,
      });
    }
  } else if (options.assumeOptIn === "all") {
    for (const customer of customers) {
      contacts.set(String(customer.id), { customerId: String(customer.id), optIn: true, phone: null, hasConversation: false });
    }
    assumptions.push("assumido que 100% dos clientes aceitaram receber por WhatsApp (cenário otimista)");
  } else if (options.assumeOptIn === "none") {
    assumptions.push("assumido que nenhum cliente aceitou receber por WhatsApp");
  } else {
    assumptions.push(
      "a tabela de consentimento de WhatsApp ainda não existe — nenhum cliente consta como opt-in (use `optIn=all` para simular o cenário otimista)"
    );
  }

  // --- histórico: dedupe e conversas já abertas ----------------------------
  const eventRead = await tryRead(deps, "notification_events", "dedupe_key");
  const alreadySent = eventRead.ok
    ? eventRead.rows.map((row) => String(row.dedupe_key ?? "")).filter(Boolean)
    : [];

  const deliveryRead = await tryRead(deps, "notification_deliveries", "channel, target, status");
  if (!deliveryRead.ok) {
    assumptions.push("a outbox (`notification_deliveries`) ainda não existe — nenhuma conversa é considerada já aberta");
  } else {
    const talkedTo = new Set(
      deliveryRead.rows
        .filter((row) => row.channel === "whatsapp" && ["sent", "delivered", "read"].includes(String(row.status)))
        .map((row) => String(row.target ?? ""))
    );
    for (const contact of contacts.values()) {
      if (contact.phone && talkedTo.has(contact.phone)) contact.hasConversation = true;
    }
  }

  assumptions.push(
    "a cota de novas conversas vem da configuração do admin (whatsapp_config), não de /instance/wa_messages_limits"
  );

  return {
    customers,
    billings,
    pushCustomerIds,
    contacts: [...contacts.values()],
    alreadySent,
    scanned: { billings: billings.length, customers: customers.length, contacts: contacts.size },
    source: {
      kind: "mikweb",
      strategy,
      customersScanned: customers.length,
      billingsScanned: billings.length,
      truncated,
      note,
    },
    assumptions,
  };
}
