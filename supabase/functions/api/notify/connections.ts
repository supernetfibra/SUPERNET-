/**
 * connections — multi-conta MikWeb: várias contas do ERP, um único canal SaaS.
 *
 * O provedor tem DUAS contas MikWeb (bases de clientes distintas, sem CPF
 * repetido) e um único número de WhatsApp. O sistema precisa saber, para cada
 * cliente e cada fatura, DE QUAL conta veio — sem isso os ids colidem: o cliente
 * `123` existe nas duas contas, e cobrar o errado é o pior erro possível.
 *
 * Convenção central: **o id do cliente trafega PREFIXADO pelo slug da conta** —
 * `a:123` é o cliente 123 da Conta A, `b:123` da Conta B. Consequências que caem
 * de graça (e são verificadas no check:notify, seção 20):
 *
 *   - a chave de dedupe vira `billing:a:123:late_5` → sem colisão entre contas;
 *   - `whatsapp_contacts.customer_id` já é único por conta;
 *   - a sessão do portal guarda `connection_slug` e o cliente só vê a própria conta.
 *
 * Módulo PURO (regra do diretório `notify/`): nada aqui lê banco nem env —
 * entra JSON bruto (linhas da tabela `mikweb_connections`) e sai conexão
 * saneada. Quem lê a tabela é o `index.ts`.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface MikWebConnection {
  /** Slug estável que prefixa ids (`a`, `b`, …). Nunca muda depois de criado. */
  slug: string;
  /** Nome no painel ("Conta A", "Matriz", …). */
  label: string;
  apiUrl: string;
  apiToken: string;
  /** Inativa = ignorada por sync, consultas e importação (dados preservados). */
  active: boolean;
  sortOrder: number;
  lastTestOk: boolean | null;
  lastTestAt: number | null;
  lastTestError: string | null;
}

/** Resultado de ler todas as conexões — a falha de UMA não derruba as outras. */
export interface ConnectionsRead {
  connections: MikWebConnection[];
  /** Conexões que não puderam ser saneadas (linha corrompida etc.), para o log. */
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Sanitização
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]{1,12}$/;

/**
 * Conexão do banco → objeto de domínio. Nunca lança: uma linha quebrada não
 * pode derrubar o sync inteiro (ela é devolvida em `skipped` e o resto segue).
 */
export function sanitizeConnection(raw: unknown): MikWebConnection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const slug = String(record.slug ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return null;

  // Sem credencial a conexão é inútil, mas PRESERVAR a linha é melhor que
  // descartar: o admin pode estar editando. Inativa = não entra na rotação.
  const apiUrl = String(record.api_url ?? record.apiUrl ?? "").trim().replace(/\/+$/, "");
  const apiToken = String(record.api_token ?? record.apiToken ?? "");
  const active = record.active === undefined ? true : record.active === true;

  const lastTestAt = Number(record.last_test_at ?? record.lastTestAt);
  return {
    slug,
    label: String(record.label ?? "").trim().slice(0, 60) || `Conta ${slug.toUpperCase()}`,
    apiUrl,
    apiToken,
    active: active && Boolean(apiUrl && apiToken),
    sortOrder: Number.isFinite(Number(record.sort_order ?? record.sortOrder))
      ? Number(record.sort_order ?? record.sortOrder)
      : 0,
    lastTestOk: record.last_test_ok === undefined ? null : record.last_test_ok === true,
    lastTestAt: Number.isFinite(lastTestAt) && lastTestAt > 0 ? lastTestAt : null,
    lastTestError:
      typeof record.last_test_error === "string" && record.last_test_error
        ? record.last_test_error.slice(0, 200)
        : null,
  };
}

/**
 * Lista bruta → conexões ativas em ordem de uso (sort_order, depois slug).
 * Ordenação estável importa: a Conta A responde primeiro nas buscas por CPF.
 */
export function sanitizeConnections(rows: unknown): ConnectionsRead {
  const list = Array.isArray(rows) ? rows : [];
  const connections: MikWebConnection[] = [];
  const skipped: string[] = [];
  for (const row of list) {
    const connection = sanitizeConnection(row);
    if (connection) connections.push(connection);
    else skipped.push(JSON.stringify(row ?? null).slice(0, 120));
  }
  connections.sort((a, b) => a.sortOrder - b.sortOrder || (a.slug < b.slug ? -1 : 1));
  return { connections, skipped };
}

/** Conexões que participam da varredura (ativas, com credencial), na ordem. */
export function activeConnections(read: ConnectionsRead): MikWebConnection[] {
  return read.connections.filter((connection) => connection.active);
}

/**
 * Próximo slug livre: `a`, `b`, … `z`, depois `a2` (teto prático: 26 + n).
 * O slug entra no ID PREFIXADO e não pode mudar depois — por isso não há
 * "renomear slug", só label.
 */
export function nextSlug(existing: string[]): string {
  const used = new Set(existing.map((slug) => slug.toLowerCase()));
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    if (!used.has(letter)) return letter;
  }
  for (let round = 2; ; round++) {
    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
      const candidate = `${letter}${round}`;
      if (!used.has(candidate)) return candidate;
    }
  }
}

// ---------------------------------------------------------------------------
// Ids prefixados — a convenção que atravessa o pipeline inteiro
// ---------------------------------------------------------------------------

const PREFIX_SEP = ":";

/**
 * `("a", "123")` → `"a:123"`. Id já prefixado passa reto (idempotente): o
 * sync pode reprefixar uma base agregada sem duplicar o prefixo.
 */
export function prefixedCustomerId(slug: string, customerId: string | number): string {
  const id = String(customerId ?? "");
  if (!id) return id;
  if (id.includes(PREFIX_SEP)) return id;
  return `${slug}${PREFIX_SEP}${id}`;
}

/**
 * `"a:123"` → `{ slug: "a", rawId: "123" }`; `"123"` → `{ slug: null, rawId: "123" }`
 * (formato antigo, anterior à multi-conta — tratado como Conta A no histórico).
 */
export function parsePrefixedCustomerId(
  value: string | number | null | undefined
): { slug: string | null; rawId: string } {
  const id = String(value ?? "");
  const index = id.indexOf(PREFIX_SEP);
  if (index <= 0) return { slug: null, rawId: id };
  return { slug: id.slice(0, index), rawId: id.slice(index + PREFIX_SEP.length) };
}

// ---------------------------------------------------------------------------
// dedupe_key com conta — `billing:<slug>:<id>:<regra>`
// ---------------------------------------------------------------------------

/**
 * Fatura em id PREFIXADO (`prefixedCustomerId`) + regra → chave de idempotência.
 * O `billing.id` entra JÁ prefixado, então a chave natural fica
 * `billing:a:123:late_5` — e contas diferentes nunca dividem a mesma chave.
 */
export function dedupeKeyForBilling(billingId: string | number, ruleKey: string): string {
  return `billing:${billingId}:${ruleKey}`;
}

/**
 * Extrai a regra da chave, aceitando os DOIS formatos durante a transição:
 *   `billing:a:123:late_5` (novo, 4 partes) → `late_5`
 *   `billing:123:late_5`   (antigo, 3 partes) → `late_5`
 * `manual:…` é de envio sob demanda e continua mapeando para `manual`.
 */
export function extractRuleKeyFromDedupe(dedupeKey: string | null | undefined): string | null {
  if (!dedupeKey) return null;
  if (dedupeKey.startsWith("manual:")) return "manual";
  const match = /^billing:(?:(.+):)?([a-z0-9_-]+)$/i.exec(dedupeKey);
  return match ? (match[2] ?? null) : null;
}

/**
 * Reconstrói (slug, id da fatura, regra) de uma `dedupe_key` de fatura — nos DOIS
 * formatos, com conta e legado sem conta:
 *   `billing:a:123:late_5` → { slug: "a", billingId: "123", ruleKey: "late_5" }
 *   `billing:123:late_5`   → { slug: null, billingId: "123", ruleKey: "late_5" }
 *
 * Existe porque o payload de eventos enfileirados ANTES do metadado `__invoiceId`
 * (fila de 30/09–05/10/2026) não carrega a fatura — e o dispatcher, sem ela, PULAVA
 * a revalidação e enviava o lembrete para fatura já paga (produção 09/10/2026).
 * A dedupe_key sempre teve a fatura; aqui ela volta a ser legível.
 */
export function parseBillingDedupeKey(
  dedupeKey: string | null | undefined
): { slug: string | null; billingId: string; ruleKey: string } | null {
  if (!dedupeKey || !dedupeKey.startsWith("billing:")) return null;
  const parts = dedupeKey.split(":");
  // `billing:<...>:<idDaFatura>:<regra>` — a regra é o ÚLTIMO segmento e o id da
  // fatura é o penúltimo; o que sobra entre "billing" e o id é o slug da conta.
  if (parts.length < 3) return null;
  const ruleKey = parts[parts.length - 1] ?? "";
  const billingId = parts[parts.length - 2] ?? "";
  const slug = parts.length >= 4 ? parts.slice(1, parts.length - 2).join(":") : "";
  if (!billingId || !ruleKey) return null;
  return { slug: slug || null, billingId, ruleKey };
}

// ---------------------------------------------------------------------------
// Varredura por conta — agregação tolerante a falha
// ---------------------------------------------------------------------------

/**
 * Resultado de consultar UMA conta dentro da varredura multi-conta.
 * `error` presente = a conta falhou e o sync seguiu com as outras (decisão do
 * provedor): o chamador vira isso em alerta/log, nunca em exceção.
 */
export interface PerConnectionResult<T> {
  slug: string;
  label: string;
  ok: boolean;
  /** Dados com os ids JÁ prefixados por esta conta. */
  value: T | null;
  error?: string;
}

/**
 * Roda um fetcher por conexão, em sequência (a MikWeb é N+1 por natureza; em
 * paralelo as duas APIs competiriam pelo timeout da Edge Function). UMA falha
 * não derruba as outras — e o resultado declara o que falhou.
 */
export async function gatherPerConnection<T>(
  connections: MikWebConnection[],
  fetcher: (connection: MikWebConnection) => Promise<T>
): Promise<Array<PerConnectionResult<T>>> {
  const results: Array<PerConnectionResult<T>> = [];
  for (const connection of connections) {
    try {
      results.push({ slug: connection.slug, label: connection.label, ok: true, value: await fetcher(connection) });
    } catch (error) {
      results.push({
        slug: connection.slug,
        label: connection.label,
        ok: false,
        value: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/**
 * Agrega os resultados por conta num relatório legível — para o log do cron e
 * para o alerta de operação dizer qual conta está fora do ar.
 */
export function describePerConnection<T>(results: Array<PerConnectionResult<T>>): string {
  if (!results.length) return "nenhuma conta configurada";
  return results
    .map((result) =>
      result.ok ? `${result.slug}: ok` : `${result.slug}: FALHOU (${(result.error ?? "erro").slice(0, 80)})`
    )
    .join(" · ");
}

/** Slugs que falharam — o chamador usa para alertar "Conta B fora do ar". */
export function failedSlugs<T>(results: Array<PerConnectionResult<T>>): string[] {
  return results.filter((result) => !result.ok).map((result) => result.slug);
}
