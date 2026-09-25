/**
 * Núcleo puro do pipeline de lembretes de fatura — primitivas de domínio.
 *
 * Regra deste diretório: NADA aqui faz I/O, importa de `esm.sh` ou usa globais do
 * Deno. Isso permite rodar o mesmo código em três lugares:
 *   - Supabase Edge Function (produção)
 *   - `node scripts/simulate-reminders.ts` (dry-run local — Node 24 executa TS nativo)
 *   - testes
 *
 * Espelhos deliberados (o deploy de Edge Function empacota só a pasta da função,
 * então não é possível importar de `src/`):
 *   - classificação de situação → `src/lib/billing-utils.ts` (mapStatus)
 *   - normalização de telefone  → `src/lib/phone.ts` (normalizePhone)
 * Se um dos dois mudar, o espelho precisa mudar junto.
 *
 * Sintaxe: apenas "erasable syntax" (sem enum, sem namespace, sem parameter
 * properties) — exigência do type stripping nativo do Node.
 */

export type Channel = "whatsapp" | "push";

// ---------------------------------------------------------------------------
// Subconjunto estrutural das respostas da API MikWeb.
// É um subset de `MikWebBilling` / `MikWebCustomer` de `../index.ts`.
// ---------------------------------------------------------------------------

export interface RawBilling {
  id: number | string;
  customer_id: number | string;
  value?: number | null;
  reference?: string | null;
  due_day?: string | null;
  situation_name?: string | null;
  situation_id?: number | null;
  date_payment?: string | null;
  value_paid?: number | null;
  digitable_line?: string | null;
  integration_link?: string | null;
  url_boleto?: string | null;
  pix_copy_paste_base64?: string | null;
  pix_copy_paste?: string | null;
  pix_copia_cola?: string | null;
  pix_code?: string | null;
  pix_copiaecola?: string | null;
  fine_amount?: number | null;
  interest_amount?: number | null;
  [key: string]: unknown;
}

export interface RawCustomer {
  id: number | string;
  full_name?: string | null;
  cpf_cnpj?: string | null;
  status?: string | null;
  phone_number?: string | null;
  cell_phone_number_1?: string | null;
  cell_phone_number_2?: string | null;
  cell_phone_number_3?: string | null;
  cell_phone_number_4?: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Datas civis (YYYY-MM-DD), sem fuso horário
//
// Fatura tem dia de vencimento, não instante. Se usarmos `toISOString()` cru
// para descobrir "hoje", às 22h no Brasil (UTC-3) o dia já virou em UTC e o
// aviso "vence hoje" sai com um dia de erro. Por isso tudo aqui é data civil
// calculada com um offset de fuso explícito.
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fuso padrão do projeto: America/Sao_Paulo (UTC-3, sem horário de verão desde 2019). */
export const DEFAULT_TZ_OFFSET_MINUTES = -180;

export function civilToday(nowMs: number = Date.now(), tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES): string {
  return new Date(nowMs + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Dias de `a` menos `b` (positivo quando `a` é depois de `b`). */
export function diffDays(a: string, b: string): number {
  const ms = new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Instante (ms) da meia-noite do dia civil corrente.
 *
 * A cota "por dia" do dispatcher usa isto e precisa concordar com o "por dia" do
 * simulador (`routing.ts`) — se um usa dia civil local e o outro usa 24h
 * corridas, a previsão e a execução divergem sem ninguém perceber.
 */
export function civilDayStartMs(nowMs: number = Date.now(), tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES): number {
  const shifted = nowMs + tzOffsetMinutes * 60_000;
  const dayStartShifted = Math.floor(shifted / 86_400_000) * 86_400_000;
  return dayStartShifted - tzOffsetMinutes * 60_000;
}

/**
 * Hora do dia (0–23) no fuso do projeto.
 *
 * É a mesma hora que o simulador usa como `runAtHour` e que a janela de envio
 * compara. Se um lado usasse a hora do servidor (UTC no Supabase) e o outro a hora
 * local, a janela "9h–20h" viraria "6h–17h" em produção sem aviso.
 */
export function civilHour(nowMs: number = Date.now(), tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES): number {
  return new Date(nowMs + tzOffsetMinutes * 60_000).getUTCHours();
}

/** Lista de datas civis de `from` até `to` (inclusive). */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  for (let guard = 0; guard < 5000 && diffDays(to, cursor) >= 0; guard++) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function formatBR(date: string): string {
  const m = DATE_RE.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

/**
 * Formata em BRL sem depender de ICU (que pode variar entre Deno e Node).
 * Determinístico por construção.
 */
export function formatBRL(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const [int, dec] = (Math.round(safe * 100) / 100).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = grouped.startsWith("-") ? "-" : "";
  return `R$ ${sign}${grouped.replace("-", "")},${dec}`;
}

// ---------------------------------------------------------------------------
// Telefone
// ---------------------------------------------------------------------------

export type PhoneFailure = "empty" | "landline" | "invalid";

export type PhoneResult =
  | { ok: true; e164: string; field: string }
  | { ok: false; reason: PhoneFailure };

/**
 * Normaliza um número brasileiro para o formato que a UazAPI exige:
 * internacional, **somente dígitos**, sem `+`, sem espaços.
 * Ex.: "(11) 98765-4321" → "5511987654321".
 *
 * Só aceita celular (9 dígitos após o DDD iniciando em 9): WhatsApp não entrega
 * em fixo, e um fixo na base vira falha de envio se não for filtrado aqui.
 */
export function normalizeBrMobile(raw: unknown): PhoneResult {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  let digits = raw.replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "empty" };

  if (digits.startsWith("0055")) digits = digits.slice(4);
  // "0" de discagem (011…) — remove zeros à esquerda antes do DDD.
  while (digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!digits.startsWith("55")) return { ok: false, reason: "invalid" };

  const ddd = Number(digits.slice(2, 4));
  if (!(ddd >= 11 && ddd <= 99)) return { ok: false, reason: "invalid" };

  const local = digits.slice(4);
  if (local.length === 8) {
    // 8 dígitos começando em 9 é celular com um dígito faltando (erro de cadastro),
    // não fixo. A distinção importa: o relatório usa isso para dizer ao admin se o
    // problema é "cadastro sem celular" ou "número digitado errado".
    return { ok: false, reason: local.startsWith("9") ? "invalid" : "landline" };
  }
  if (local.length !== 9 || !local.startsWith("9")) return { ok: false, reason: "invalid" };
  if (/^0+$/.test(local)) return { ok: false, reason: "invalid" };

  return { ok: true, e164: digits, field: "unknown" };
}

/** Campos de telefone da MikWeb, na ordem de preferência. */
export const PHONE_FIELDS = [
  "cell_phone_number_1",
  "cell_phone_number_2",
  "cell_phone_number_3",
  "cell_phone_number_4",
  "phone_number",
] as const;

/** Escolhe o primeiro número celular válido do cliente, informando de qual campo veio. */
export function pickCustomerPhone(customer: RawCustomer): PhoneResult {
  let lastFailure: PhoneFailure = "empty";
  for (const field of PHONE_FIELDS) {
    const raw = customer[field];
    if (typeof raw !== "string" || raw.replace(/\D/g, "") === "") continue;
    const result = normalizeBrMobile(raw);
    if (result.ok) return { ok: true, e164: result.e164, field };
    lastFailure = result.reason;
  }
  return { ok: false, reason: lastFailure };
}

export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `+${digits.slice(0, 4)} *****-${digits.slice(-4)}`;
}

export function maskCpf(cpf?: string | null): string {
  const digits = String(cpf ?? "").replace(/\D/g, "");
  if (digits.length !== 11) return "";
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

// ---------------------------------------------------------------------------
// Situação da fatura / status do cliente
// ---------------------------------------------------------------------------

export type BillingState = "open" | "paid" | "canceled" | "unknown";

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Espelho de `mapStatus()` de `src/lib/billing-utils.ts`, mas devolvendo também
 * `unknown` em vez de assumir "pendente" — o simulador precisa saber quando não
 * entendeu a situação, para não tratar desconhecido como "em aberto" e mandar
 * cobrança indevida.
 */
export function classifyBilling(situationName?: string | null): BillingState {
  const name = stripAccents(String(situationName ?? "").trim());
  if (!name) return "unknown";
  if (name.includes("cansel") || name.includes("cancel")) return "canceled";
  if (name.includes("efetuad") || name.includes("quitad") || name.includes("pag") || name.includes("baixad")) return "paid";
  if (
    name.includes("aberto") ||
    name.includes("atras") ||
    name.includes("vencid") ||
    name.includes("observa") ||
    name.includes("pendent")
  ) {
    return "open";
  }
  return "unknown";
}

const INACTIVE_RE = /(inativ|inactive|cancel|suspend|bloquead|blocked|cortad|encerrad)/;

/** Cliente claramente inativo não recebe cobrança. Status vazio/desconhecido = ativo. */
export function isInactiveCustomer(status?: string | null): boolean {
  const value = stripAccents(String(status ?? "").trim());
  if (!value) return false;
  return INACTIVE_RE.test(value);
}

// ---------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------

export interface BillingValue {
  base: number;
  fine: number;
  interest: number;
  /** base + multa + juros — pode ser igual a `base` quando a API não informa os encargos. */
  total: number;
  hasCharges: boolean;
}

export function billingValue(billing: RawBilling): BillingValue {
  const base = Number(billing.value ?? 0) || 0;
  const fine = Number(billing.fine_amount ?? 0) || 0;
  const interest = Number(billing.interest_amount ?? 0) || 0;
  return { base, fine, interest, total: base + fine + interest, hasCharges: fine > 0 || interest > 0 };
}

const PIX_FIELDS = [
  "pix_copy_paste_base64",
  "pix_copy_paste",
  "pix_copia_cola",
  "pix_code",
  "pix_copiaecola",
] as const;

/**
 * Decodifica o valor do campo quando a MikWeb o entrega em base64.
 * Espelha `extractPixCode()` de `src/lib/billing-utils.ts`: só aceita o resultado
 * se ele for texto imprimível — assim um código que já venha em texto puro não é
 * corrompido por um decode indevido.
 * `atob` existe tanto no Deno quanto no Node ≥16, então não quebra o módulo puro.
 */
function decodeBase64Text(value: string): string {
  try {
    const decoded = atob(value.trim());
    return /^[\x20-\x7E]+$/.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

/**
 * Primeiro campo de Pix preenchido (a MikWeb muda o nome entre versões).
 * Sem isso, o lembrete sairia com um blob base64 no lugar do Pix copia e cola.
 */
export function findPixRaw(billing: RawBilling): string | null {
  for (const field of PIX_FIELDS) {
    const value = billing[field];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    return field.includes("base64") ? decodeBase64Text(value) : value.trim();
  }
  return null;
}

export function boletoUrl(billing: RawBilling): string | null {
  for (const field of ["url_boleto", "integration_link"] as const) {
    const value = billing[field];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}
