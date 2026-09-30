/**
 * Fontes de dados para a simulação e para o sync — agora MULTI-CONTA.
 *
 * O provedor tem duas contas MikWeb (bases de clientes distintas) e um único
 * canal. Este módulo varre TODAS as conexões ativas em sequência e devolve uma
 * base agregada, com os ids de cliente JÁ PREFIXADOS pelo slug da conta
 * (`a:123`, `b:456`) — é isso que impede cliente/fatura de uma conta de colidir
 * com os da outra no dedupe e nos contatos (ver `connections.ts`).
 *
 * Falha de UMA conta não derruba a varredura (decisão do provedor: seguir com a
 * outra) — ela é declarada em `LoadedBase.connections` e vira alerta de operação
 * no cron, nunca uma exceção silenciosa.
 *
 * Este é o único arquivo do diretório que faz I/O — e ainda assim só **lê**:
 * nenhuma escrita, nenhuma chamada à UazAPI. As dependências entram por injeção
 * (`SourcesDeps`) para não criar import circular com `../index.ts`, que é quem
 * possui `db()`, `listMikWebConnections()` e o cliente HTTP da MikWeb.
 *
 * Toda leitura de tabelas de consentimento/outbox é best-effort: se a tabela
 * faltar, o simulador continua e **declara no relatório** o que assumiu.
 */

import type { RawBilling, RawCustomer } from "./model.ts";
import { addDays, toMikwebDate } from "./model.ts";
import { syncDueWindow } from "./sync.ts";
import type { ReminderRule } from "./rules.ts";
import type { SimulationContact, SimulationSourceInfo } from "./simulate.ts";
import type { SupabaseLike } from "./outbox.ts";
import {
  activeConnections,
  describePerConnection,
  gatherPerConnection,
  prefixedCustomerId,
  type ConnectionsRead,
  type MikWebConnection,
} from "./connections.ts";

export type { SupabaseLike };

export interface SourcesDeps {
  db: () => SupabaseLike;
  /** Conexões MikWeb disponíveis (saneadas) — quem lê a tabela é o chamador. */
  listConnections: () => Promise<ConnectionsRead>;
  /** HTTP GET numa CONTA específica — quem resolve credencial é o chamador. */
  apiGetFor: <T>(
    connection: MikWebConnection,
    path: string
  ) => Promise<{ data: T; meta?: { pages?: { total_pages?: number } } }>;
}

export interface LoadOptions {
  from: string;
  to: string;
  /** Teto de clientes varridos na estratégia por cliente (que é N+1 e cara). */
  limitCustomers: number;
  maxPages: number;
  assumeOptIn: "table" | "all" | "none";
  assumePush: "table" | "all" | "none";
  /**
   * Régua em vigor. Presente, a janela de VENCIMENTO varrida passa a ser
   * `syncDueWindow(rules, from, …)` — cobre regras de atraso (ex.: "5 dias de
   * atraso" precisa de faturas com vencimento 5 dias antes de hoje), que a
   * janela plana `[from, to]` deixava de fora. Ausente, vale `[from, to]`.
   */
  rules?: ReminderRule[];
}

/** Estado de cada conta dentro da varredura — o relatório declara, não estima. */
export interface PerConnectionScan {
  slug: string;
  label: string;
  ok: boolean;
  billings: number;
  customers: number;
  error?: string;
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
  /**
   * Resultado por conta: quem respondeu e quem falhou. O cron usa para o alerta
   * de operação ("Conta B fora do ar") sem re-derivar de strings.
   */
  connections?: PerConnectionScan[];
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
    super("Nenhuma conta MikWeb ativa — cadastre em Conexões ou nos secrets do Supabase.");
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

/** Busca o cadastro individual por ID (`/customers/{id}`, a rota do login/admin). */
async function fetchCustomerById(
  deps: SourcesDeps,
  connection: MikWebConnection,
  id: string
): Promise<RawCustomer | null> {
  try {
    const result = await deps.apiGetFor<RawCustomer | RawCustomer[]>(connection, `/customers/${id}`);
    const data = result.data;
    if (Array.isArray(data)) {
      // Algumas instalações devolvem lista mesmo para ID único.
      return data.find((customer) => String(customer?.id ?? "") === id) ?? data[0] ?? null;
    }
    return data && String((data as RawCustomer).id ?? "") === id ? data : null;
  } catch {
    return null; // rota indisponível → o fallback de paginação cobre
  }
}

async function readCustomers(
  deps: SourcesDeps,
  connection: MikWebConnection,
  ids: Set<string>,
  maxPages: number
): Promise<RawCustomer[]> {
  const found: RawCustomer[] = [];
  const seen = new Set<string>();
  const add = (customer: RawCustomer | null) => {
    if (!customer) return;
    const id = String(customer.id ?? "");
    if (id && ids.has(id) && !seen.has(id)) {
      seen.add(id);
      found.push(customer);
    }
  };

  // 1) Busca individual por ID (lotes de 5 em paralelo): precisa do cadastro EXATO
  //    de quem tem fatura na janela. A listagem paginada só cobre as primeiras
  //    páginas — a MikWeb limita o per_page efetivo e os clientes-alvo podem estar
  //    além do alcance, deixando o sync com `no_customer` em silêncio (peguei ao
  //    vivo: 32 de 38 avisos sem cadastro com 6 clientes carregados).
  const wanted = [...ids].slice(0, 100);
  const BATCH = 5;
  for (let index = 0; index < wanted.length; index += BATCH) {
    const batch = wanted.slice(index, index + BATCH);
    const results = await Promise.all(batch.map((id) => fetchCustomerById(deps, connection, id)));
    for (const customer of results) add(customer);
  }
  if (seen.size >= ids.size) return found;

  // 2) Fallback: folheia a listagem (comportamento antigo).
  for (let page = 1; page <= maxPages && seen.size < ids.size; page++) {
    let batch: RawCustomer[] = [];
    try {
      const result = await deps.apiGetFor<RawCustomer[]>(connection, `/customers?per_page=100&page=${page}`);
      batch = result.data ?? [];
      if (!batch.length) break;
    } catch {
      break;
    }
    for (const customer of batch) add(customer);
  }
  return found;
}

/** O que a varredura de UMA conta produziu (ainda sem prefixar). */
interface ConnectionScan {
  billings: RawBilling[];
  customers: RawCustomer[];
  strategy: SimulationSourceInfo["strategy"];
  truncated: boolean;
  assumptions: string[];
  note?: string;
}

/**
 * Varredura de UMA conta — a lógica antiga de `loadRealBase`, isolada por conta.
 * Duas estratégias (e o relatório diz qual foi usada):
 *
 *   bulk         → `/billings?start_date&end_date` (uma varredura, cobre a base)
 *   per-customer → varre N clientes e busca as faturas de cada um (N+1, amostra)
 *
 * O fallback existe porque não é garantido que a MikWeb aceite `/billings` sem
 * `customer_id`. Quando cai no caminho caro, o resultado é **uma amostra**.
 */
async function scanConnection(
  deps: SourcesDeps,
  connection: MikWebConnection,
  options: LoadOptions
): Promise<ConnectionScan> {
  const assumptions: string[] = [];
  const billings: RawBilling[] = [];
  let customers: RawCustomer[] = [];
  let strategy: SimulationSourceInfo["strategy"] = "bulk";
  let truncated = false;
  let note: string | undefined;

  // --- estratégia 1: varredura por janela de vencimento ---------------------
  // Filtros de data da MikWeb: `type_date=due_day` + `start_date`/`end_date` em
  // dd-MM-yyyy (docs oficiais, "Listando Cobranças"). Os antigos `date_from`/
  // `date_to` (ISO) NÃO existem na API — eram ignorados silenciosamente.
  // `situation_id=2` (Em Atraso) reduz o volume; o núcleo descarta pago/cancelado.
  try {
    const windowFrom = options.rules?.length ? syncDueWindow(options.rules, options.from, 1).from : options.from;
    const windowTo = options.rules?.length ? syncDueWindow(options.rules, options.to, 1).to : options.to;
    const dateQuery = `type_date=due_day&start_date=${toMikwebDate(windowFrom)}&end_date=${toMikwebDate(windowTo)}`;
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= options.maxPages) {
      const path = `/billings?${dateQuery}&situation_id=2&per_page=100${page > 1 ? `&page=${page}` : ""}`;
      const result = await deps.apiGetFor<RawBilling[]>(connection, path);
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
      assumptions.push(
        `[${connection.slug}] a varredura em lote foi limitada a ${options.maxPages} páginas — pode haver faturas fora do relatório`
      );
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
      const firstPage = await deps.apiGetFor<RawCustomer[]>(
        connection,
        `/customers?per_page=${options.limitCustomers}`
      );
      const sample = (firstPage.data ?? []).slice(0, options.limitCustomers);
      for (const customer of sample) {
        const id = String(customer?.id ?? "");
        if (!id) continue;
        customers.push(customer);
        try {
          const result = await deps.apiGetFor<RawBilling[]>(
            connection,
            `/billings?customer_id=${id}&type_date=due_day&start_date=${toMikwebDate(addDays(options.from, -60))}&end_date=${toMikwebDate(options.to)}&per_page=50`
          );
          for (const billing of result.data ?? []) billings.push(billing);
        } catch {
          // cliente sem faturas acessíveis — segue
        }
      }
      ids.clear();
      for (const billing of billings) ids.add(String(billing.customer_id));
      note = `amostra de ${customers.length} clientes — NÃO é a base inteira`;
      assumptions.push(
        `[${connection.slug}] a MikWeb não retornou faturas por janela de vencimento; foi usada uma amostra de ${customers.length} clientes`
      );
    } catch (error) {
      note = error instanceof Error ? error.message : String(error);
    }
  }

  if (!customers.length && ids.size) {
    customers = await readCustomers(deps, connection, ids, options.maxPages);
    if (customers.length < ids.size) {
      assumptions.push(
        `[${connection.slug}] apenas ${customers.length} de ${ids.size} clientes das faturas foram carregados — nome e telefone dos demais ficam indisponíveis`
      );
    }
  }

  return { billings, customers, strategy, truncated, assumptions, note };
}

/**
 * Carrega a base real de TODAS as contas ativas, agregada.
 *
 * A varredura é em sequência (não em paralelo): cada conta já é N+1 contra a API
 * da MikWeb, e em paralelo as duas competiriam pelo orçamento de tempo da Edge
 * Function. Uma conta que falha é registrada e o resto segue.
 */
export async function loadRealBase(deps: SourcesDeps, options: LoadOptions): Promise<LoadedBase> {
  const read = await deps.listConnections();
  const connections = activeConnections(read);
  if (!connections.length) throw new MikWebNotConfigured();

  // --- varredura por conta (sequencial, tolerante a falha) ------------------
  const scans = await gatherPerConnection(connections, (connection) => scanConnection(deps, connection, options));

  const billings: RawBilling[] = [];
  const customers: RawCustomer[] = [];
  const assumptions: string[] = [];
  const perConnection: PerConnectionScan[] = [];
  let anyBulk = false;
  let anyTruncated = false;
  const notes: string[] = [];

  for (const scan of scans) {
    if (!scan.ok || !scan.value) {
      perConnection.push({ slug: scan.slug, label: scan.label, ok: false, billings: 0, customers: 0, error: scan.error });
      assumptions.push(`[${scan.slug}] conta FALHOU na varredura: ${scan.error ?? "erro"}`);
      continue;
    }
    const connection = connections.find((item) => item.slug === scan.slug)!;
    // ORIGEM: cliente e FATURA ganham o prefixo da conta — daqui para frente o
    // pipeline inteiro (dedupe, contatos, push, envio) é inequívoco. O id da
    // fatura prefixado é o que evita `billing:123:…` colidir entre contas.
    for (const billing of scan.value.billings) {
      billings.push({
        ...billing,
        id: prefixedCustomerId(connection.slug, billing.id),
        customer_id: prefixedCustomerId(connection.slug, billing.customer_id),
      });
    }
    for (const customer of scan.value.customers) {
      customers.push({ ...customer, id: prefixedCustomerId(connection.slug, customer.id) });
    }
    const label = connection.label || connection.slug;
    perConnection.push({
      slug: scan.slug,
      label,
      ok: true,
      billings: scan.value.billings.length,
      customers: scan.value.customers.length,
    });
    if (scan.value.strategy === "bulk") anyBulk = true;
    else anyTruncated = true;
    if (scan.value.truncated) anyTruncated = true;
    if (scan.value.note) notes.push(`${connection.slug}: ${scan.value.note}`);
    assumptions.push(...scan.value.assumptions);
  }

  const customersScanned = perConnection.reduce((total, item) => total + item.customers, 0);
  const noteParts: string[] = [];
  if (notes.length) noteParts.push(notes.join(" · "));
  noteParts.push(describePerConnection(scans));

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
      // `bulk` se QUALQUER conta varreu por janela; amostra parcial é sinalizada.
      strategy: anyBulk ? "bulk" : "per-customer",
      customersScanned,
      billingsScanned: billings.length,
      truncated: anyTruncated,
      note: noteParts.join(" — ") || undefined,
    },
    assumptions,
    connections: perConnection,
  };
}
