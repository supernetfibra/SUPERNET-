/**
 * Freebuff Desktop — Supabase Edge Function ("api")
 *
 * Complete backend for the SuperNet customer portal.
 * The frontend lives on Vercel (static Vite build); this function serves /api/*.
 *
 * Auth model (cross-origin friendly — browsers won't send cookies to
 * another origin, so sessions travel in headers):
 *   - Customer session: header  `x-session-token: <token>`
 *     (also accepted: `Authorization: Bearer <token>`)
 *   - Admin session:    header  `x-admin-token: <token>`
 *
 * Env vars (set via `supabase secrets set`):
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  → auto-injected by Supabase
 *   MIKWEB_API_URL, MIKWEB_API_TOKEN          → MikWeb API (optional; can be set in admin panel)
 *   MIKWEB_ADMIN_PASSWORD                     → admin password
 *   VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT → web push
 *
 * Deploy:  supabase functions deploy api --no-verify-jwt
 */

import { Hono } from "https://esm.sh/hono@4.6.3";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildPushPayload, type PushSubscription as WebPushSubscription, type PushMessage, type VapidKeys } from "https://esm.sh/@block65/webcrypto-web-push@2.0.0";

// Núcleo puro dos lembretes de fatura (dry-run) — sem I/O, compartilhado com a CLI
// `scripts/simulate-reminders.ts`. Ver `LEMBRETES-WHATSAPP.md`.
import { addDays, civilToday, isCivilDate, normalizeBrMobile, pickCustomerPhone, type PhoneFailure } from "./notify/model.ts";
import { generateDemoBase, type DemoScenario } from "./notify/demo-data.ts";
import { loadRealBase, loadSyncBase, MikWebNotConfigured, type LoadedBase } from "./notify/sources.ts";
import { describeSync } from "./notify/sync.ts";
import { runSimulation } from "./notify/simulate.ts";
import { buildPayload, renderFor, EVENT_URL, type ChannelTemplate } from "./notify/templates.ts";
import { applyOverrides } from "./notify/settings-store.ts";
import { loadNotificationSettings } from "./notify/settings-store.ts";
import { billingLookupPath, verdictFromResponse, type BillingVerdict } from "./notify/billing-verdict.ts";
import { MAX_RULES, RULE_EVENT_KEYS, defaultDocument } from "./notify/settings.ts";
import { maskToken } from "./notify/config.ts";
import type { ChannelTemplate } from "./notify/templates.ts";
import { createUazapiClient, UAZAPI_WEBHOOK_EVENTS, UAZAPI_WEBHOOK_EXCLUDE } from "./notify/uazapi.ts";
import { createWhatsAppRuntime } from "./notify/runtime.ts";
import { handleUazapiWebhook } from "./notify/webhook.ts";
import { toDeliveryView, RULE_KEY_LABELS } from "./notify/deliveries-view.ts";
import {
  activeConnections,
  nextSlug,
  parsePrefixedCustomerId,
  prefixedCustomerId,
  sanitizeConnections,
  type ConnectionsRead,
  type MikWebConnection,
} from "./notify/connections.ts";
import {
  buildChannelDownMessage,
  buildDispatchFailuresMessage,
  buildQuotaPausedMessage,
  buildDailySummaryMessage,
  buildStuckQueueMessage,
  classifyStuckQueue,
  aggregateBillings,
  civilDayBr,
  shouldSendDailySummary,
  resolveButtons,
  normalizeAdminAlerts,
} from "./notify/admin-alerts.ts";
import { sendAdminAlert } from "./notify/admin-alerts-send.ts";
import { computeWhatsAppHealth, type HealthCheck } from "./notify/health.ts";
import { shouldSendWeeklySummary, buildWeeklySummaryMessage } from "./notify/admin-alerts.ts";
import type { DispatchSummary } from "./notify/dispatch.ts";
import { aggregateFunnel, buildFunnelWeeks, funnelTotals, weekStartToMs } from "./notify/engagement.ts";
import {
  buildReferralMeView,
  isReferralRewardKind,
  normalizeReferralCode,
  publicFirstName,
  redemptionTransitionAllowed,
  referralStats,
  referralApprovedDedupeKey,
  referralApprovedPayload,
  REFERRAL_APPROVED_EVENT_KEY,
  type InstallRequestReferralRow,
  type RedemptionRow,
  type ReferralLedgerRow,
} from "./notify/referrals.ts";
import { referralDashboardMetrics } from "./notify/referral-metrics.ts";

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function env(name: string, fallback = ""): string {
  // Supabase edge functions inject SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  // automatically; all custom secrets come through Deno.env.get too.
  return Deno.env.get(name) ?? fallback;
}

/**
 * Admin password — MANDATORY env var, no fallback.
 * If MIKWEB_ADMIN_PASSWORD is not configured, admin login fails closed
 * with a generic 500 (no config details are exposed to the client).
 */
function getAdminPassword(): string {
  const password = Deno.env.get("MIKWEB_ADMIN_PASSWORD");
  if (!password) {
    throw new Error("MIKWEB_ADMIN_PASSWORD não configurada");
  }
  return password;
}

// ---------------------------------------------------------------------------
// Supabase client (service role — server side only)
// ---------------------------------------------------------------------------

let _db: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (_db) return _db;
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  _db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _db;
}

// ---------------------------------------------------------------------------
// App + CORS (manual — full control, works for cross-origin Vercel frontend)
// ---------------------------------------------------------------------------

const app = new Hono().basePath("/api");

const ALLOWED_ORIGINS = [
  "https://minhasupernet.com",
  "https://www.minhasupernet.com",
  "http://localhost:5173",
  "http://localhost:4173",
];

app.use("*", async (c, next) => {
  const origin = c.req.header("origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "*";

  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-session-token, x-admin-token",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  await next();
  c.header("Access-Control-Allow-Origin", allowOrigin);
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Vary", "Origin");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): number {
  return Date.now();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(error: string, status = 400): Response {
  return json({ error }, status);
}

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return phone;
  const ddd = digits.slice(0, 2);
  const last = digits.slice(-2);
  if (digits.length === 11) {
    return `(${ddd}) ${digits.slice(2, 7)}**-${last}`;
  }
  return `(${ddd}) ${digits.slice(2, 6)}**-${last}`;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getUserAgent(request: Request): string {
  return request.headers.get("user-agent") || "";
}

function extractCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

/**
 * Session tokens travel in headers (cross-origin). Cookie accepted as
 * fallback for backward compatibility / same-origin deployments.
 */
function getSessionToken(request: Request): string | null {
  return (
    request.headers.get("x-session-token") ||
    extractCookie(request, "mikweb_session") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null
  );
}

/**
 * Admin session tokens travel ONLY in the `x-admin-token` header (or the
 * legacy cookie for same-origin deployments). Query string transport was
 * removed: tokens in URLs leak via logs, history and Referer headers.
 */
function getAdminSessionToken(request: Request): string | null {
  return (
    request.headers.get("x-admin-token") ||
    extractCookie(request, "mikweb_admin_session")
  );
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory — per isolate)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const t = now();
  const entry = rateLimitMap.get(key);
  if (!entry || t > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: t + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Test user (mock customer — no MikWeb needed)
// ---------------------------------------------------------------------------

const TEST_CPFS = ["12345678909"];

function isTestCpf(cpf: string): boolean {
  return TEST_CPFS.includes(cpf.replace(/\D/g, ""));
}

function getTestCustomerId(cpf: string): string {
  return `test-${cpf.replace(/\D/g, "")}`;
}

function isTestCustomerId(id: string): boolean {
  return id.startsWith("test-");
}

const MOCK_TEST_CUSTOMER = {
  id: 999,
  full_name: "Usuário Teste",
  login: "teste",
  email: "teste@exemplo.com",
  cpf_cnpj: "12345678909",
  person_type: "Física",
  phone_number: "11987654321",
  cell_phone_number_1: "11912345678",
  status: "Ativo",
  due_day: 15,
  zip_code: "01234-567",
  street: "Rua das Flores",
  number: "123",
  complement: "Apto 45",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  server: { id: 1, name: "Servidor Principal", hash_server: "abc123" },
  plan: { id: 1, name: "Plano 500 Mega", value: "129.90" },
  customer_group: { id: 1, name: "Residencial" },
  financial_status: "L",
};

const MOCK_TEST_BILLINGS = [
  {
    id: 1001,
    customer_id: 999,
    value: 129.9,
    value_paid: null,
    date_payment: null,
    situation_id: 2,
    situation_name: "Vencido",
    reference: "Junho/2026",
    type_billing: "Mensalidade",
    due_day: "2026-06-15",
    form_payment: "Boleto",
    digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678901234",
    pix_copy_paste_base64:
      "000201010212261060014br.gov.bcb.pix2558api.pix.com/v2/cobv/12345678901234567890123456785204000053039865406129.905802BR5913Cliente Teste6009Sao Paulo62070503***63041234",
    observation: null,
    our_number: "123456",
    fine_amount: 12.99,
    interest_amount: 2.6,
  },
  {
    id: 1002,
    customer_id: 999,
    value: 129.9,
    value_paid: null,
    date_payment: null,
    situation_id: 1,
    situation_name: "Em Aberto",
    reference: "Julho/2026",
    type_billing: "Mensalidade",
    due_day: "2026-07-15",
    form_payment: "Boleto",
    digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678901235",
    pix_copy_paste_base64:
      "000201010212261060014br.gov.bcb.pix2558api.pix.com/v2/cobv/12345678901234567890123456785204000053039865406129.905802BR5913Cliente Teste6009Sao Paulo62070503***63041235",
    observation: null,
    our_number: "123457",
    integration_link: "https://boleto.exemplo.com/pdf/1002",
  },
  {
    id: 1003,
    customer_id: 999,
    value: 129.9,
    value_paid: 129.9,
    date_payment: "2026-06-10",
    situation_id: 3,
    situation_name: "Pago",
    reference: "Maio/2026",
    type_billing: "Mensalidade",
    due_day: "2026-05-15",
    form_payment: "PIX",
    observation: null,
    our_number: "123455",
  },
];

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

async function logEvent(event: {
  type: string;
  cpf?: string;
  customer_id?: string;
  customer_name?: string;
  error_message?: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: unknown;
}) {
  try {
    await db().from("mikweb_audit_log").insert({
      type: event.type,
      cpf: event.cpf,
      customer_id: event.customer_id,
      customer_name: event.customer_name,
      error_message: event.error_message,
      ip_address: event.ip_address,
      user_agent: event.user_agent,
      metadata: event.metadata ?? null,
      timestamp: now(),
    });
  } catch (err) {
    console.error("[AUDIT_LOG_ERROR]", err);
  }
}

async function getSession(sessionToken: string) {
  const { data } = await db()
    .from("mikweb_sessions")
    .select("*")
    .eq("session_token", sessionToken)
    .maybeSingle();
  if (!data) return null;
  if (data.expires_at < now()) return null;
  return data;
}

async function getAdminSession(sessionToken: string) {
  const { data } = await db()
    .from("mikweb_admin_sessions")
    .select("*")
    .eq("session_token", sessionToken)
    .maybeSingle();
  if (!data) return null;
  if (data.expires_at < now()) return null;
  return data;
}

async function requireSession(request: Request) {
  const token = getSessionToken(request);
  if (!token) return null;
  return getSession(token);
}

async function requireAdmin(request: Request): Promise<boolean> {
  const token = getAdminSessionToken(request);
  if (!token) return false;
  return (await getAdminSession(token)) !== null;
}

// ---------------------------------------------------------------------------
// Programa de indicação — helpers (lógica pura em notify/referrals.ts)
// ---------------------------------------------------------------------------

interface ReferralConfig {
  enabled: boolean;
  pointsPerApproved: number;
  migrationPending: boolean;
}

/**
 * Config do programa (linha única em referral_config, migration 011).
 * Tabela ausente = migration pendente → devolve default com flag: os
 * endpoints respondem como desligados em vez de 500.
 */
async function getReferralConfig(): Promise<ReferralConfig> {
  try {
    const { data, error } = await db().from("referral_config").select("*").eq("id", "default").maybeSingle();
    if (error) return { enabled: false, pointsPerApproved: 100, migrationPending: true };
    if (!data) return { enabled: false, pointsPerApproved: 100, migrationPending: true };
    return {
      enabled: Boolean(data.enabled),
      pointsPerApproved: Number(data.points_per_approved) || 100,
      migrationPending: false,
    };
  } catch {
    return { enabled: false, pointsPerApproved: 100, migrationPending: true };
  }
}

/** Saldo = SUM(delta) do ledger (fonte única — nunca campo derivado). */
async function referralBalance(customerRef: string): Promise<number> {
  try {
    const { data } = await db()
      .from("referral_points_ledger")
      .select("delta")
      .eq("customer_ref", customerRef);
    return (data ?? []).reduce((acc: number, row: { delta: number | null }) => acc + (Number(row.delta) || 0), 0);
  } catch {
    return 0;
  }
}

/** Garante a linha do código do cliente; devolve o código ativo (ou null se migration pendente). */
async function ensureReferralCode(customerRef: string, name: string, cpf: string): Promise<string | null> {
  try {
    const { data: existing } = await db()
      .from("referral_codes")
      .select("code")
      .eq("customer_ref", customerRef)
      .eq("active", true)
      .maybeSingle();
    if (existing?.code) return existing.code;
    const { data, error } = await db().rpc("ensure_referral_code", {
      p_customer_ref: customerRef,
      p_name: name,
      p_cpf: cpf,
    });
    if (error) throw error;
    return (data as string) || null;
  } catch (err) {
    console.error("[REFERRAL_CODE_ERROR]", err);
    return null;
  }
}

/** Busca o código ativo para validar a indicação do formulário público. */
async function findActiveReferralCode(code: string) {
  const { data } = await db()
    .from("referral_codes")
    .select("code, customer_ref, referrer_name, referrer_cpf, active")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  return data;
}

/**
 * Insere a instalação em install_requests (migration 001), tolerando o schema
 * antigo sem `referral_code` (deploy do código antes da migration): grava
 * sem o vínculo em vez de falhar a solicitação do cliente.
 */
async function insertInstallRequest(values: Record<string, unknown>, referralCode: string | null): Promise<void> {
  const attempt = { ...values, ...(referralCode ? { referral_code: referralCode } : {}) };
  const { error } = await db().from("install_requests").insert(attempt);
  if (error?.message?.includes("referral_code")) {
    const { error: retryError } = await db().from("install_requests").insert(values);
    if (retryError) throw new Error(`DB insert into install_requests failed: ${retryError.message}`);
    return;
  }
  if (error) throw new Error(`DB insert into install_requests failed: ${error.message}`);
}

/**
 * Enfileira (idempotente) o aviso de "indicação aprovada" para o indicador.
 *
 * Reaproveita TODA a infraestrutura do pipeline de lembretes: outbox → dispatcher
 * → UazAPI. Recebe de graça opt-out (webhook), janela de envio, cotas, ritmo
 * humano e botões — sem reimplementar nada. Regras:
 *   • só sai se o indicador tiver contato com opt-in em `whatsapp_contacts`
 *     (reengajar opt-out por here é exatamente o que o cliente NÃO quer);
 *   • dedupe key = `referral:<id>:approval` — a mesma do crédito: o segundo
 *     `enqueue_notification` é ignorado pelo banco;
 *   • preview é renderizado AQUI (enqueue com `rendered`) e o dispatcher
 *     re-renderiza no envio de qualquer forma (templates resolvidos por chamada);
 *   • `saldo` no payload é o saldo APÓS o crédito (lido depois do RPC).
 * Toda falha é logada e engolida: o crédito já aconteceu — o aviso é cortesia.
 */
async function enqueueReferralApprovedNotice(
  installRequestId: string,
  referrer: { customer_ref: string; referrer_name: string; referrer_cpf: string },
  referredName: string,
  points: number
): Promise<void> {
  try {
    const contact = await whatsappRuntime().getContact(referrer.customer_ref);
    if (!contact?.phoneE164 || !contact.optIn) {
      console.log(
        `[REFERRAL_NOTIFY] sem envio para ${referrer.customer_ref}: ${!contact?.phoneE164 ? "sem celular válido" : "sem opt-in"}`
      );
      return;
    }

    const balance = await referralBalance(referrer.customer_ref);
    const firstName = publicFirstName(referrer.referrer_name) ?? "cliente";
    // Mesma settings que o simulador/dispatcher leem (portalBaseUrl, companyName).
    const settingsLoaded = await loadNotificationSettings({
      db,
      getChannelConfig: () => whatsappRuntime().getConfig(),
    }).catch(() => null);
    const portalBaseUrl = settingsLoaded?.settings.portalBaseUrl ?? "https://minhasupernet.com";
    const companyName = settingsLoaded?.settings.companyName ?? "MinhaSuperNet";

    const payload = referralApprovedPayload({
      referrerFirstName: firstName,
      referredName: referredName || "seu indicado",
      points,
      balanceAfter: balance,
      portalBaseUrl,
      companyName,
    });
    const templates: ChannelTemplate[] | undefined = (await whatsappRuntime().getTemplates()).templates;
    const rendered = renderFor("whatsapp", REFERRAL_APPROVED_EVENT_KEY, payload, templates);
    const preview = rendered.message ? { body: rendered.message.body } : null;

    const enqueued = await whatsappRuntime().outbox.enqueue({
      eventKey: REFERRAL_APPROVED_EVENT_KEY,
      dedupeKey: referralApprovedDedupeKey(installRequestId),
      // Mesmo formato de customer_id do sync/contatos (a sessão usa o mesmo).
      customerId: referrer.customer_ref,
      cpf: referrer.referrer_cpf || null,
      payload: { ...payload, [EVENT_URL]: payload.link } as Record<string, unknown>,
      priority: "transactional",
      channel: "whatsapp",
      target: contact.phoneE164,
      rendered: preview,
      scheduledFor: now(),
    });

    if (enqueued.created) {
      console.log(`[REFERRAL_NOTIFY] aviso enfileirado (${enqueued.deliveryId}) para ${referrer.customer_ref}`);
      // Dispara o dispatcher para o aviso sair já (respeitando janela/cotas —
      // se a janela estiver fechada ele fica na fila para o cron de 5 min).
      await whatsappRuntime().dispatch({ ids: [enqueued.deliveryId!], policy: "manual", limit: 1 });
    } else {
      console.log(`[REFERRAL_NOTIFY] aviso já registrado para ${referrer.customer_ref} — nada reenviado`);
    }
  } catch (err) {
    console.error("[REFERRAL_NOTIFY_ERROR]", err);
  }
}

/**
 * Insert helper that THROWS on failure — supabase-js returns errors in the
 * result object instead of throwing, so a failed write would otherwise be
 * silently ignored (e.g. issuing a session token that isn't in the DB).
 */
async function insertOrThrow(
  table: string,
  values: Record<string, unknown>
): Promise<void> {
  const { error } = await db().from(table).insert(values);
  if (error) throw new Error(`DB insert into ${table} failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// MikWeb API integration
// ---------------------------------------------------------------------------

interface MikWebCustomer {
  id: number;
  full_name: string;
  login?: string;
  password?: string;
  email?: string;
  cpf_cnpj?: string;
  person_type?: string;
  phone_number?: string;
  cell_phone_number_1?: string;
  cell_phone_number_2?: string;
  cell_phone_number_3?: string;
  cell_phone_number_4?: string;
  status: string;
  due_day?: number;
  zip_code?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  server?: { id: number; name: string; hash_server: string };
  plan?: { id: number; name: string; value: string };
  customer_group?: { id: number; name: string };
  financial_status?: string;
  [key: string]: unknown;
}

interface MikWebBilling {
  id: number;
  customer_id: number;
  value: number;
  value_paid?: number | null;
  date_payment?: string | null;
  situation_id: number;
  situation_name: string;
  reference: string;
  type_billing: string;
  due_day: string;
  observation?: string | null;
  form_payment: string;
  digitable_line?: string;
  integration_link?: string;
  url_boleto?: string;
  pix_copy_paste_base64?: string;
  pix_qr_code_image_base64?: string;
  our_number?: number | string;
  fine_amount?: number;
  interest_amount?: number;
  [key: string]: unknown;
}

async function getMikWebConfig(): Promise<{ baseUrl: string; token: string } | null> {
  // Priority 1: environment secrets
  const envUrl = env("MIKWEB_API_URL");
  const envToken = env("MIKWEB_API_TOKEN");
  if (envUrl && envToken) return { baseUrl: envUrl, token: envToken };

  // Priority 2: config saved via admin panel (mikweb_config table)
  try {
    const { data } = await db()
      .from("mikweb_config")
      .select("api_url, api_token")
      .eq("key", "default")
      .maybeSingle();
    if (data?.api_url && data?.api_token) {
      return { baseUrl: data.api_url, token: data.api_token };
    }
  } catch {
    // table may not exist yet
  }
  return null;
}

// ---------------------------------------------------------------------------
// MULTI-CONTA: credenciais por conexão (tabela mikweb_connections, migration 010)
// ---------------------------------------------------------------------------
// A conexão 'a' herda os SECRETS de ambiente quando a tabela ainda não tem a
// credencial — o provedor que já usa env não precisa reconfigurar nada.
async function connectionWithEnvFallback(connection: MikWebConnection): Promise<MikWebConnection> {
  if (connection.apiToken) return connection;
  const envUrl = env("MIKWEB_API_URL");
  const envToken = env("MIKWEB_API_TOKEN");
  if (connection.slug === "a" && envUrl && envToken) {
    return { ...connection, apiUrl: connection.apiUrl || envUrl.replace(/\/+$/, ""), apiToken: envToken, active: true };
  }
  return connection;
}

/**
 * Contas MikWeb cadastradas (ativas em primeiro lugar, na ordem de uso).
 * A tabela ainda não existir (migration 010 pendente) NÃO é erro: cai para a
 * credencial única antiga (env → mikweb_config) como conexão 'a' — deploy do
 * código antes da migration não quebra o sync.
 */
async function listMikWebConnections(): Promise<ConnectionsRead> {
  try {
    const { data } = await db().from("mikweb_connections").select("*").order("sort_order").order("slug");
    if (data && data.length) {
      const read = sanitizeConnections(data);
      const withFallback = await Promise.all(read.connections.map((connection) => connectionWithEnvFallback(connection)));
      return { connections: withFallback, skipped: read.skipped };
    }
  } catch {
    // migration 010 pendente — segue para o fallback legado
  }

  // Fallback legado: credencial única → conexão 'a' (mesma origem do backfill).
  const legacy = await getMikWebConfig();
  if (legacy) {
    return {
      connections: [
        {
          slug: "a",
          label: "Conta A",
          apiUrl: legacy.baseUrl.replace(/\/+$/, ""),
          apiToken: legacy.token,
          active: true,
          sortOrder: 0,
          lastTestOk: null,
          lastTestAt: null,
          lastTestError: null,
        },
      ],
      skipped: [],
    };
  }
  return { connections: [], skipped: [] };
}

/** Conexões ativas na ordem de varredura — a porta de entrada das rotas. */
async function activeMikWebConnections(): Promise<MikWebConnection[]> {
  const read = await listMikWebConnections();
  return activeConnections(read);
}

/**
 * Conexão da SESSÃO do portal. Fallback deliberado: sessão sem prefixo (criada
 * antes do deploy multi-conta) ou com slug desativado cai na primeira conta
 * ativa — o cliente continua vendo as faturas dele em vez de erro 503.
 */
async function connectionForSession(slug: string | null): Promise<MikWebConnection | null> {
  const connections = await activeMikWebConnections();
  if (!connections.length) return null;
  if (slug) {
    const found = connections.find((connection) => connection.slug === slug);
    if (found) return found;
  }
  return connections[0];
}

function mikwebErrorDetails(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** GET autenticado numa CONTA específica — a forma da era multi-conta. */
async function mikwebApiGetFullFor<T>(
  connection: MikWebConnection,
  path: string
): Promise<{ data: T; meta?: { pages?: { total_pages?: number } } }> {
  const url = `${connection.apiUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${connection.apiToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`MikWeb API error (${response.status}): ${body.slice(0, 200) || response.statusText}`);
  }
  const parsed: Record<string, unknown> = await response.json();
  const meta = parsed.meta as { pages?: { total_pages?: number } } | undefined;
  const dataKey = Object.keys(parsed).find((k) => k !== "meta");
  return { data: (dataKey ? parsed[dataKey] : parsed) as T, meta };
}

// ---------------------------------------------------------------------------
// Web push (VAPID via @block65/webcrypto-web-push — Deno compatible)
// ---------------------------------------------------------------------------

function getVapidConfig(): VapidKeys | null {
  const publicKey = env("VITE_VAPID_PUBLIC_KEY");
  const privateKey = env("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: env("VAPID_SUBJECT", "mailto:admin@portalcliente.com.br"),
  };
}

interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

async function sendPushToSubscription(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: PushPayload
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const vapid = getVapidConfig();
  if (!vapid) return { success: false, error: "VAPID keys not configured" };

  try {
    const message: PushMessage = {
      data: JSON.stringify(payload),
      options: { ttl: 86400 },
    };
    const request = await buildPushPayload(
      message,
      sub as unknown as WebPushSubscription,
      vapid
    );
    const response = await fetch(sub.endpoint, request);
    if (response.ok) return { success: true, statusCode: response.status };
    if (response.status === 410 || response.status === 404) {
      return { success: false, error: "subscription_expired", statusCode: response.status };
    }
    return { success: false, error: `push service returned ${response.status}`, statusCode: response.status };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendPushToSubs(
  subs: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const expiredEndpoints: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      const result = await sendPushToSubscription(sub, payload);
      if (result.success) {
        sent++;
      } else {
        failed++;
        if (result.error === "subscription_expired") expiredEndpoints.push(sub.endpoint);
      }
    })
  );

  // Clean up expired subscriptions
  if (expiredEndpoints.length > 0) {
    await db().from("push_subscriptions").delete().in("endpoint", expiredEndpoints);
  }

  return { sent, failed };
}

// ===========================================================================
// ROUTES
// ===========================================================================

// GET /api/version — deploy version for the SW update check
app.get("/version", (c) => {
  const version = env("SUPABASE_FUNCTION_VERSION") || String(now());
  c.header("Cache-Control", "no-store");
  return json({ version, timestamp: now() });
});

// ---------------------------------------------------------------------------
// POST /api/mikweb/login
// ---------------------------------------------------------------------------
app.post("/mikweb/login", async (c) => {
  const request = c.req.raw;
  const startTime = now();
  const clientIp = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const body = await request.json();
    const { cpf: rawCpf, password, keepConnected } = body as {
      cpf: string;
      password: string;
      keepConnected?: boolean;
    };
    if (!rawCpf || !password) return jsonError("CPF e senha são obrigatórios.");

    const cpf = rawCpf.replace(/\D/g, "");
    if (!checkRateLimit(`${clientIp}:${cpf}`)) {
      return jsonError("Muitas tentativas. Tente novamente em 15 minutos.", 429);
    }

    // ---- TEST USER ----
    if (isTestCpf(cpf)) {
      if (password.replace(/\D/g, "") !== cpf.slice(0, 4)) {
        return jsonError("Senha incorreta. Use os 4 primeiros dígitos do seu CPF.", 401);
      }
      const mockContacts = [
        { id: `${MOCK_TEST_CUSTOMER.id}-phone`, phone: MOCK_TEST_CUSTOMER.phone_number, label: "Telefone" },
        { id: `${MOCK_TEST_CUSTOMER.id}-cell1`, phone: MOCK_TEST_CUSTOMER.cell_phone_number_1, label: "Celular 1" },
      ];
      const maxAge = keepConnected ? 7 * 86400 : 86400;
      const sessionToken = generateSessionToken();
      await insertOrThrow("mikweb_sessions", {
        session_token: sessionToken,
        cpf,
        customer_id: getTestCustomerId(cpf),
        customer_name: MOCK_TEST_CUSTOMER.full_name,
        contacts: mockContacts,
        selected_contact_id: null,
        created_at: now(),
        expires_at: now() + maxAge * 1000,
        last_activity_at: now(),
      });
      return json({
        success: true,
        customer: { id: getTestCustomerId(cpf), name: MOCK_TEST_CUSTOMER.full_name, email: MOCK_TEST_CUSTOMER.email },
        hasMultipleContacts: true,
        contacts: mockContacts.map((ct) => ({ id: ct.id, label: ct.label, phoneMasked: maskPhone(ct.phone) })),
        sessionToken,
        expiresAt: now() + maxAge * 1000,
      });
    }

    // ---- REAL USER ----
    // MULTI-CONTA: o CPF é procurado em TODAS as contas ativas, na ordem. As bases
    // são distintas (decisão do provedor), então a primeira que responde é A conta
    // do cliente — e a sessão passa a carregar essa origem (`connection_slug` e o
    // customer_id PREFIXADO), para faturas/boleto consultarem sempre a conta certa.
    const connections = await activeMikWebConnections();
    if (!connections.length) {
      await logEvent({ type: "login_failure", cpf, ip_address: clientIp, user_agent: userAgent, error_message: "Nenhuma conta MikWeb ativa" });
      return jsonError("Serviço temporariamente indisponível. Tente mais tarde.", 503);
    }

    let foundCustomer: MikWebCustomer | null = null;
    let customerConnection: MikWebConnection | null = null;
    let lastSearchError: string | null = null;
    for (const connection of connections) {
      try {
        const found = await mikwebApiGetFullFor<MikWebCustomer[]>(connection, `/customers?search=${cpf}`);
        const hit = (found.data ?? [])[0];
        if (hit) {
          foundCustomer = hit;
          customerConnection = connection;
          break;
        }
      } catch (err) {
        // Conta fora do ar não impede o cliente de logar pela outra.
        lastSearchError = mikwebErrorDetails(err);
      }
    }

    if (!foundCustomer) {
      if (lastSearchError) {
        await logEvent({ type: "login_failure", cpf, ip_address: clientIp, user_agent: userAgent, error_message: String(lastSearchError).slice(0, 200) });
      }
      return jsonError("CPF não encontrado. Verifique e tente novamente.", 404);
    }
    const connection = customerConnection!;
    const customer = foundCustomer;
    const prefixedId = prefixedCustomerId(connection.slug, customer.id);

    const normalizedPassword = password.replace(/\D/g, "");
    if (normalizedPassword !== cpf.slice(0, 4)) {
      await logEvent({
        type: "login_failure", cpf, customer_id: String(customer.id),
        customer_name: customer.full_name, ip_address: clientIp, user_agent: userAgent,
        error_message: "Senha incorreta",
      });
      return jsonError("Senha incorreta. Use os 4 primeiros dígitos do seu CPF.", 401);
    }

    // Collect contacts
    const contacts: Array<{ id: string; phone: string; label?: string }> = [];
    try {
      const full = await mikwebApiGetFullFor<MikWebCustomer>(connection, `/customers/${customer.id}`);
      if (full.phone_number) contacts.push({ id: `${customer.id}-phone`, phone: full.phone_number, label: "Telefone" });
      for (const key of ["cell_phone_number_1", "cell_phone_number_2", "cell_phone_number_3", "cell_phone_number_4"] as const) {
        const phone = full[key];
        if (typeof phone === "string" && phone) {
          contacts.push({ id: `${customer.id}-${key}`, phone, label: key === "cell_phone_number_1" ? "Celular 1" : key.replace("cell_phone_number_", "Celular ") });
        }
      }
    } catch {
      // Contacts are optional
    }

    const maxAge = keepConnected ? 7 * 86400 : 86400;
    const sessionToken = generateSessionToken();
    await insertOrThrow("mikweb_sessions", {
      session_token: sessionToken,
      cpf,
      // PREFIXADO (`a:123`): é o mesmo formato que sync/contatos/push usam — a
      // sessão do portal nunca consulta a conta errada.
      customer_id: prefixedId,
      connection_slug: connection.slug,
      customer_name: customer.full_name,
      contacts: contacts.map((ct) => ({ id: ct.id, phone: ct.phone, label: ct.label })),
      selected_contact_id: null,
      created_at: now(),
      expires_at: now() + maxAge * 1000,
      last_activity_at: now(),
    });

    await logEvent({
      type: "login_success", cpf, customer_id: prefixedId,
      customer_name: customer.full_name, ip_address: clientIp, user_agent: userAgent,
      metadata: { duration: now() - startTime },
    });

    return json({
      success: true,
      customer: { id: String(customer.id), name: customer.full_name, email: customer.email },
      hasMultipleContacts: contacts.length > 1,
      contacts: contacts.map((ct) => ({ id: ct.id, label: ct.label || "Contato", phoneMasked: maskPhone(ct.phone) })),
      sessionToken,
      expiresAt: now() + maxAge * 1000,
    });
  } catch (err) {
    console.error("[LOGIN_ERROR]", err);
    await logEvent({ type: "login_failure", ip_address: clientIp, user_agent: userAgent, error_message: String(err).slice(0, 200) });
    return jsonError("Erro interno. Tente novamente mais tarde.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/mikweb/logout
// ---------------------------------------------------------------------------
app.post("/mikweb/logout", async (c) => {
  const request = c.req.raw;
  try {
    const sessionToken = getSessionToken(request);
    if (sessionToken) {
      const session = await getSession(sessionToken);
      if (session) {
        await logEvent({
          type: "logout", cpf: session.cpf, customer_id: session.customer_id,
          customer_name: session.customer_name, ip_address: getClientIp(request),
        });
      }
      await db().from("mikweb_sessions").delete().eq("session_token", sessionToken);
    }
    return json({ success: true });
  } catch (err) {
    console.error("[LOGOUT_ERROR]", err);
    return jsonError("Erro ao fazer logout.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/mikweb/me
// ---------------------------------------------------------------------------
app.get("/mikweb/me", async (c) => {
  const request = c.req.raw;
  const session = await requireSession(request);
  if (!session) return json({ authenticated: false }, 401);

  await db()
    .from("mikweb_sessions")
    .update({ last_activity_at: now() })
    .eq("session_token", session.session_token);

  return json({
    authenticated: true,
    customer: { id: session.customer_id, name: session.customer_name, cpf: session.cpf },
  });
});

// ---------------------------------------------------------------------------
// GET /api/mikweb/customer
// ---------------------------------------------------------------------------
app.get("/mikweb/customer", async (c) => {
  const request = c.req.raw;
  const session = await requireSession(request);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  await db()
    .from("mikweb_sessions")
    .update({ last_activity_at: now() })
    .eq("session_token", session.session_token);

  if (isTestCustomerId(session.customer_id)) {
    return json({ customer: MOCK_TEST_CUSTOMER });
  }

  try {
    // MULTI-CONTA: a sessão sabe de qual conta o cliente veio (customer_id
    // prefixado + connection_slug) — consulta exatamente na conta de origem.
    const { slug, rawId } = parsePrefixedCustomerId(session.customer_id);
    const connection = await connectionForSession(slug);
    if (!connection) return jsonError("Conta MikWeb indisponível. Fale com o suporte.", 503);
    const customer = await mikwebApiGetFullFor<MikWebCustomer>(connection, `/customers/${rawId}`);
    if (!customer) return jsonError("Cliente não encontrado na API MikWeb.", 404);
    return json({ customer });
  } catch (err) {
    console.error("[CUSTOMER_ERROR]", err);
    return jsonError("Erro ao buscar dados do cliente.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/mikweb/select-contact
// ---------------------------------------------------------------------------
app.post("/mikweb/select-contact", async (c) => {
  const request = c.req.raw;
  const session = await requireSession(request);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  const body = await request.json();
  if (!body.contactId) return jsonError("Contato não especificado.", 400);

  await db()
    .from("mikweb_sessions")
    .update({ selected_contact_id: body.contactId, last_activity_at: now() })
    .eq("session_token", session.session_token);
  return json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /api/mikweb/billings
// ---------------------------------------------------------------------------
app.get("/mikweb/billings", async (c) => {
  const request = c.req.raw;
  const session = await requireSession(request);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  await db()
    .from("mikweb_sessions")
    .update({ last_activity_at: now() })
    .eq("session_token", session.session_token);

  const yearFilter = new URL(request.url).searchParams.get("year") || undefined;

  if (isTestCustomerId(session.customer_id)) {
    return json({ billings: MOCK_TEST_BILLINGS, customerId: session.customer_id });
  }

  try {
    const allBillings: MikWebBilling[] = [];
    let page = 1;
    let totalPages = 1;
    // MULTI-CONTA: a fatura é buscada na CONTA da sessão (ver login).
    const { slug, rawId } = parsePrefixedCustomerId(session.customer_id);
    const connection = await connectionForSession(slug);
    if (!connection) return jsonError("Conta MikWeb indisponível. Fale com o suporte.", 503);
    const params = new URLSearchParams({ customer_id: rawId });
    if (yearFilter) {
      params.set("date_from", `${yearFilter}-01-01`);
      params.set("date_to", `${yearFilter}-12-31`);
    }
    const basePath = `/billings?${params.toString()}`;

    while (page <= totalPages && page <= 6) {
      const { data, meta } = await mikwebApiGetFullFor<MikWebBilling[]>(
        connection,
        page === 1 ? basePath : `${basePath}&page=${page}`
      );
      if (data?.length) allBillings.push(...data);
      if (meta?.pages?.total_pages) totalPages = meta.pages.total_pages;
      else break;
      page++;
    }

    return json({ billings: allBillings, customerId: session.customer_id });
  } catch (err) {
    console.error("[BILLINGS_ERROR]", err);
    return jsonError("Erro ao buscar faturas.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/mikweb/billings/:id/download — proxy the boleto PDF bytes
// (proxying instead of 302 keeps the MikWeb URL/token secret and lets the
// cross-origin frontend read the response)
// ---------------------------------------------------------------------------
app.get("/mikweb/billings/:id/download", async (c) => {
  const request = c.req.raw;
  const session = await requireSession(request);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  const billingId = c.req.param("id");
  if (!billingId) return jsonError("ID da fatura não informado.", 400);

  // Test users: generate a sample PDF for mock billing IDs
  if (isTestCustomerId(session.customer_id)) {
    const mockBilling = MOCK_TEST_BILLINGS.find((b) => String(b.id) === billingId);
    if (!mockBilling) return jsonError("Fatura de teste não encontrada.", 404);

    const samplePdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 380>>stream
BT
/F1 18 Tf
72 720 Td
(FATURA - TESTE) Tj
/F1 12 Tf
0 -30 Td
(Competencia: ${mockBilling.reference}) Tj
0 -20 Td
(Vencimento: ${mockBilling.due_day}) Tj
0 -20 Td
(Valor: R$ ${mockBilling.value.toFixed(2)}) Tj
0 -20 Td
(Status: ${mockBilling.situation_name}) Tj
0 -40 Td
/F1 10 Tf
(Este e um documento de teste gerado pela area do cliente.) Tj
0 -15 Td
(Para fins de demonstracao apenas.) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000340 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
773
%%EOF`;

    return new Response(samplePdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="fatura-${billingId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Real users: proxy to MikWeb — na CONTA da sessão (ver login).
  try {
    const { slug } = parsePrefixedCustomerId(session.customer_id);
    const connection = await connectionForSession(slug);
    if (!connection) return jsonError("Conta MikWeb indisponível. Fale com o suporte.", 503);

    const url = `${connection.apiUrl.replace(/\/$/, "")}/billings/${billingId}/download?valid=true`;
    const pdfResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${connection.apiToken}` },
    });
    if (!pdfResponse.ok) {
      return jsonError("Boleto não disponível para esta fatura.", 404);
    }

    const headers = new Headers({
      "Content-Type": pdfResponse.headers.get("content-type") || "application/pdf",
      "Content-Disposition": `inline; filename="fatura-${billingId}.pdf"`,
      "Cache-Control": "no-store",
    });
    const length = pdfResponse.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    return new Response(pdfResponse.body, { status: 200, headers });
  } catch (err) {
    console.error("[BILLING_DOWNLOAD_ERROR]", err);
    return jsonError("Erro ao baixar PDF.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/mikweb/action — audit-log a payment action
// ---------------------------------------------------------------------------
app.post("/mikweb/action", async (c) => {
  const request = c.req.raw;
  const session = await requireSession(request);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  const body = await request.json();
  const validActions = ["barcode_copied", "pix_copied", "pdf_viewed"];
  if (!body.action || !validActions.includes(body.action)) {
    return jsonError("Ação inválida.", 400);
  }
  await logEvent({
    type: body.action,
    cpf: session.cpf,
    customer_id: session.customer_id,
    customer_name: session.customer_name,
    ip_address: getClientIp(request),
    user_agent: getUserAgent(request),
    metadata: {
      billingId: body.billingId ?? null,
      reference: body.reference ?? null,
      value: typeof body.value === "number" ? body.value : null,
    },
  });
  return json({ success: true });
});

// ===========================================================================
// ADMIN ROUTES
// ===========================================================================

app.post("/admin/login", async (c) => {
  try {
    const body = await c.req.json();
    const clientIp = getClientIp(c.req.raw);
    if (!checkRateLimit(`admin-login:${clientIp}`)) {
      return jsonError("Muitas tentativas. Tente novamente em alguns minutos.", 429);
    }
    if (body.password !== getAdminPassword()) {
      return jsonError("Senha incorreta.", 401);
    }
    const sessionToken = generateSessionToken();
    const expiresAt = now() + 8 * 3600 * 1000;
    await insertOrThrow("mikweb_admin_sessions", {
      session_token: sessionToken,
      created_at: now(),
      expires_at: expiresAt,
      last_activity_at: now(),
    });
    return json({ success: true, sessionToken, expiresAt });
  } catch (err) {
    console.error("[ADMIN_LOGIN_ERROR]", err);
    return jsonError("Erro interno.", 500);
  }
});

app.post("/admin/logout", async (c) => {
  const token = getAdminSessionToken(c.req.raw);
  if (token) {
    await db().from("mikweb_admin_sessions").delete().eq("session_token", token);
  }
  return json({ success: true });
});

app.get("/admin/verify", async (c) => {
  const token = getAdminSessionToken(c.req.raw);
  if (!token) return json({ authenticated: false }, 401);
  const session = await getAdminSession(token);
  if (!session) return json({ authenticated: false }, 401);
  return json({ authenticated: true });
});

app.get("/admin/branding", async (c) => {
  const request = c.req.raw;
  // Branding is public (needed for the landing page), but honor admin
  // sessions for caching consistency.
  const token = getAdminSessionToken(request);
  if (token && !(await getAdminSession(token))) {
    return jsonError("Não autorizado.", 401);
  }
  try {
    const { data } = await db()
      .from("mikweb_config")
      .select("provider_name, logo_url")
      .eq("key", "default")
      .maybeSingle();
    return json({
      providerName: data?.provider_name || "Seu Provedor",
      logoUrl: data?.logo_url || "",
    });
  } catch {
    return json({ providerName: "Seu Provedor", logoUrl: "" });
  }
});

app.post("/admin/branding", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json();
  if (!body.providerName?.trim()) return jsonError("Nome do provedor é obrigatório.");

  const { data: existing } = await db()
    .from("mikweb_config")
    .select("api_url, api_token")
    .eq("key", "default")
    .maybeSingle();

  await db().from("mikweb_config").upsert(
    {
      key: "default",
      api_url: existing?.api_url ?? "",
      api_token: existing?.api_token ?? "",
      provider_name: body.providerName.trim(),
      logo_url: body.logoUrl || "",
      updated_at: now(),
      updated_by: "admin",
    },
    { onConflict: "key" }
  );
  return json({ success: true });
});

app.get("/admin/config", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const { data } = await db()
    .from("mikweb_config")
    .select("*")
    .eq("key", "default")
    .maybeSingle();
  if (!data) return json({ apiUrl: "", hasToken: false, updatedAt: 0 });
  return json({
    apiUrl: data.api_url,
    apiToken: data.api_token ? `${data.api_token.slice(0, 4)}...${data.api_token.slice(-4)}` : "",
    hasToken: !!data.api_token,
    providerName: data.provider_name,
    logoUrl: data.logo_url,
    updatedAt: data.updated_at,
  });
});

app.post("/admin/config", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json();
  if (!body.apiToken) return jsonError("Token é obrigatório.");

  const { data: existing } = await db()
    .from("mikweb_config")
    .select("provider_name, logo_url")
    .eq("key", "default")
    .maybeSingle();

  await db().from("mikweb_config").upsert(
    {
      key: "default",
      api_url: body.apiUrl || "",
      api_token: body.apiToken,
      provider_name: existing?.provider_name ?? null,
      logo_url: existing?.logo_url ?? "",
      updated_at: now(),
      updated_by: "admin",
    },
    { onConflict: "key" }
  );
  return json({ success: true });
});

app.post("/admin/test-connection", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  try {
    const body = await c.req.json();
    const baseUrl = String(body.apiUrl || "").replace(/\/$/, "");
    const token = String(body.apiToken || "");
    if (!baseUrl || !token) {
      return json({ success: false, message: "URL e token são obrigatórios." });
    }

    const paths = ["/customers?per_page=1", "/customers"];
    for (const path of paths) {
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (response.ok) {
          return json({ success: true, message: `Conexão estabelecida com sucesso! (${path})` });
        }
      } catch {
        // Try next path
      }
    }
    return json({
      success: false,
      message: `Não foi possível conectar em "${baseUrl}". Verifique a URL e o token.`,
    });
  } catch {
    return json({ success: false, message: "Erro ao testar conexão." });
  }
});

// ---------------------------------------------------------------------------
// MULTI-CONTA — CRUD de conexões MikWeb (tabela `mikweb_connections`, migration 010)
//
// O token NUNCA volta na resposta (só o formato mascarado). Desativar a ÚLTIMA
// conexão ativa é recusado: sem ela o sync e o login do portal ficam cegos.
// ---------------------------------------------------------------------------

/** Linha da tabela → visão para o painel (token mascarado). */
function connectionView(row: Record<string, unknown>) {
  const token = String(row.api_token ?? "");
  return {
    id: String(row.id),
    slug: String(row.slug ?? ""),
    label: String(row.label ?? ""),
    apiUrl: String(row.api_url ?? ""),
    tokenMasked: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : "",
    hasToken: Boolean(token),
    active: row.active === true,
    sortOrder: Number(row.sort_order ?? 0),
    lastTestOk: row.last_test_ok === null || row.last_test_ok === undefined ? null : row.last_test_ok === true,
    lastTestAt: row.last_test_at === null || row.last_test_at === undefined ? null : Number(row.last_test_at),
    lastTestError: row.last_test_error ?? null,
    updatedAt: Number(row.updated_at ?? 0),
  };
}

/** Testa as credenciais contra a API da MikWeb (mesmos caminhos do test-connection). */
async function testMikwebCredentials(
  baseUrl: string,
  token: string
): Promise<{ ok: boolean; error?: string }> {
  const paths = ["/customers?per_page=1", "/customers"];
  for (const path of paths) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (response.ok) return { ok: true };
    } catch {
      // tenta o próximo caminho
    }
  }
  return { ok: false, error: `Não foi possível conectar em "${baseUrl}". Verifique a URL e o token.` };
}

app.get("/admin/connections", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  try {
    const { data } = await db()
      .from("mikweb_connections")
      .select("*")
      .order("sort_order")
      .order("slug");
    return json({
      connections: ((data ?? []) as Record<string, unknown>[]).map(connectionView),
      /** A conexão 'a' também funciona via secrets (fallback legado no backend). */
      envFallback: Boolean(env("MIKWEB_API_URL") && env("MIKWEB_API_TOKEN")),
    });
  } catch (error) {
    // Tabela ausente = migration 010 pendente — o painel mostra o aviso certo.
    return json({ connections: [], envFallback: Boolean(env("MIKWEB_API_URL") && env("MIKWEB_API_TOKEN")), migrationPending: true, error: mikwebErrorDetails(error) });
  }
});

app.post("/admin/connections", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const label = String(body.label ?? "").trim().slice(0, 60);
  const apiUrl = String(body.apiUrl ?? "").trim().replace(/\/+$/, "");
  const apiToken = String(body.apiToken ?? "").trim();
  if (!label) return jsonError("Nome da conta é obrigatório.");
  if (!apiUrl) return jsonError("URL da API é obrigatória.");
  if (!apiToken) return jsonError("Token é obrigatório.");

  try {
    const { data: existing } = await db().from("mikweb_connections").select("slug");
    const slugs = ((existing ?? []) as Array<{ slug: unknown }>).map((row) => String(row.slug ?? ""));
    const slug = nextSlug(slugs);
    const test = await testMikwebCredentials(apiUrl, apiToken);
    const ts = now();
    const { error } = await db().from("mikweb_connections").insert({
      slug,
      label,
      api_url: apiUrl,
      api_token: apiToken,
      active: true,
      sort_order: slugs.length,
      last_test_ok: test.ok,
      last_test_at: ts,
      last_test_error: test.ok ? null : (test.error ?? "").slice(0, 200),
      created_at: ts,
      updated_at: ts,
      updated_by: "admin",
    });
    if (error) return jsonError(`Erro ao salvar a conexão: ${error.message}`, 500);
    await logEvent({ type: "whatsapp_config", metadata: { action: "connection-created", slug } });
    return json({ success: true, slug, tested: test.ok, testError: test.ok ? null : test.error });
  } catch (error) {
    return jsonError(mikwebErrorDetails(error), 500);
  }
});

app.post("/admin/connections/:id/update", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  try {
    const patch: Record<string, unknown> = { updated_at: now(), updated_by: "admin" };
    if (typeof body.label === "string" && body.label.trim()) patch.label = body.label.trim().slice(0, 60);
    if (typeof body.apiUrl === "string" && body.apiUrl.trim()) patch.api_url = body.apiUrl.trim().replace(/\/+$/, "");
    // Token vazio = MANTER o atual (o painel envia só quando o admin digita um novo).
    if (typeof body.apiToken === "string" && body.apiToken.trim()) patch.api_token = body.apiToken.trim();
    if (!Object.keys(patch).length) return jsonError("Nada para atualizar.");

    const { error } = await db().from("mikweb_connections").update(patch).eq("id", id);
    if (error) return jsonError(`Erro ao atualizar: ${error.message}`, 500);
    return json({ success: true });
  } catch (error) {
    return jsonError(mikwebErrorDetails(error), 500);
  }
});

app.post("/admin/connections/:id/test", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const id = c.req.param("id");
  try {
    const { data } = await db().from("mikweb_connections").select("*").eq("id", id).maybeSingle();
    const row = (data ?? null) as Record<string, unknown> | null;
    if (!row) return jsonError("Conexão não encontrada.", 404);

    // Sem credencial salva, o teste usa o fallback de ambiente (conexão 'a').
    const apiUrl = String(row.api_url ?? "") || env("MIKWEB_API_URL");
    const apiToken = String(row.api_token ?? "") || (row.slug === "a" ? env("MIKWEB_API_TOKEN") : "");
    if (!apiUrl || !apiToken) return json({ success: false, message: "Credenciais incompletas nesta conta." });

    const test = await testMikwebCredentials(apiUrl, apiToken);
    await db()
      .from("mikweb_connections")
      .update({
        last_test_ok: test.ok,
        last_test_at: now(),
        last_test_error: test.ok ? null : (test.error ?? "").slice(0, 200),
      })
      .eq("id", id);
    return json({ success: test.ok, message: test.ok ? "Conexão estabelecida com sucesso!" : (test.error ?? "Falha no teste.") });
  } catch (error) {
    return jsonError(mikwebErrorDetails(error), 500);
  }
});

app.post("/admin/connections/:id/toggle", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const id = c.req.param("id");
  try {
    const { data } = await db().from("mikweb_connections").select("active").eq("id", id).maybeSingle();
    if (!data) return jsonError("Conexão não encontrada.", 404);
    const nextActive = !(data as Record<string, unknown>).active;
    if (!nextActive) {
      // A última conexão ativa não pode ser desligada: sem ela o sistema fica cego.
      const { data: actives } = await db()
        .from("mikweb_connections")
        .select("id")
        .eq("active", true);
      if (((actives ?? []) as unknown[]).length <= 1) {
        return jsonError("Não é possível desativar a última conta ativa.");
      }
    }
    const { error } = await db().from("mikweb_connections").update({ active: nextActive, updated_at: now() }).eq("id", id);
    if (error) return jsonError(`Erro ao atualizar: ${error.message}`, 500);
    return json({ success: true, active: nextActive });
  } catch (error) {
    return jsonError(mikwebErrorDetails(error), 500);
  }
});

app.delete("/admin/connections/:id", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const id = c.req.param("id");
  try {
    const { data } = await db().from("mikweb_connections").select("slug, active").eq("id", id).maybeSingle();
    const row = (data ?? null) as Record<string, unknown> | null;
    if (!row) return jsonError("Conexão não encontrada.", 404);
    if (row.active === true) {
      const { data: actives } = await db().from("mikweb_connections").select("id").eq("active", true);
      if (((actives ?? []) as unknown[]).length <= 1) {
        return jsonError("Não é possível remover a última conta ativa — desative outra antes.");
      }
    }
    const { error } = await db().from("mikweb_connections").delete().eq("id", id);
    if (error) return jsonError(`Erro ao remover: ${error.message}`, 500);
    await logEvent({ type: "whatsapp_config", metadata: { action: "connection-deleted", slug: String(row.slug ?? "") } });
    return json({ success: true });
  } catch (error) {
    return jsonError(mikwebErrorDetails(error), 500);
  }
});

// ---------------------------------------------------------------------------
// Eventos de OPERAÇÃO do sistema. Não são acessos de cliente: são gravações de
// configuração salva, testes de envio do painel e crons. O histórico de acesso
// do painel exclui por padrão (scope=customer); a aba "Operação" os mostra
// (scope=system). `scope=all` mantém o comportamento antigo de tudo junto.
// ---------------------------------------------------------------------------
const SYSTEM_AUDIT_TYPES = [
  "whatsapp_config",
  "whatsapp_sent",
  "whatsapp_failed",
  "whatsapp_skipped",
  "whatsapp_opt_in",
  "notification_config",
];

app.get("/admin/audit-logs", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const url = new URL(c.req.raw.url);
  const type = url.searchParams.get("type") || undefined;
  const cpf = url.searchParams.get("cpf") || undefined;
  const scope = url.searchParams.get("scope") || "customer";

  let query = db().from("mikweb_audit_log").select("*").order("timestamp", { ascending: false }).limit(100);
  if (type && type !== "all") query = query.eq("type", type);
  if (cpf) query = query.eq("cpf", cpf);
  if (scope === "customer") query = query.not("type", "in", `(${SYSTEM_AUDIT_TYPES.join(",")})`);
  else if (scope === "system") query = query.in("type", SYSTEM_AUDIT_TYPES);
  const { data: logs = [] } = await query;

  const { data: allLogs = [] } = await db()
    .from("mikweb_audit_log")
    .select("type, cpf, timestamp")
    .order("timestamp", { ascending: false })
    .limit(500);

  const todayTs = new Date().setHours(0, 0, 0, 0);
  return json({
    logs,
    summary: {
      totalLogins: allLogs.filter((l) => l.type === "login_success").length,
      totalFailures: allLogs.filter((l) => l.type === "login_failure").length,
      todayLogins: allLogs.filter((l) => l.type === "login_success" && l.timestamp >= todayTs).length,
      uniqueCpfs: new Set(allLogs.filter((l) => l.type === "login_success").map((l) => l.cpf)).size,
    },
  });
});

app.get("/admin/customer", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const cpf = (new URL(c.req.raw.url).searchParams.get("cpf") || "").replace(/\D/g, "");
  if (cpf.length !== 11) return jsonError("CPF inválido.");

  try {
    // MULTI-CONTA: procura o CPF em todas as contas ativas (bases distintas).
    // Cada resultado carrega `connection` (slug + label) para o painel etiquetar
    // a origem — e o botão "enviar lembrete" validar a fatura na conta certa.
    const connections = await activeMikWebConnections();
    if (!connections.length) return jsonError("Nenhuma conta MikWeb ativa — cadastre em Conexões.", 503);

    for (const connection of connections) {
      try {
        const found = await mikwebApiGetFullFor<MikWebCustomer[]>(connection, `/customers?search=${cpf}`);
        const customer = (found.data ?? [])[0];
        if (!customer) continue;
        const billingsResult = await mikwebApiGetFullFor<MikWebBilling[]>(connection, `/billings?customer_id=${customer.id}`);
        const { password: _pw, ...safeCustomer } = customer;
        return json({
          customer: safeCustomer,
          billings: billingsResult.data ?? [],
          connection: { slug: connection.slug, label: connection.label },
        });
      } catch (error) {
        // Conta fora do ar: tenta a próxima; se nenhuma responder, devolve o erro.
        console.error("[ADMIN_CUSTOMER_ERROR]", connection.slug, error);
      }
    }
    return jsonError("Cliente não encontrado.", 404);
  } catch (err) {
    console.error("[ADMIN_CUSTOMER_ERROR]", err);
    return jsonError("Erro ao buscar cliente.", 500);
  }
});

app.get("/admin/sessions", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const { data: sessions = [] } = await db()
    .from("mikweb_sessions")
    .select("id, cpf, customer_id, customer_name, created_at, expires_at, last_activity_at")
    .order("last_activity_at", { ascending: false })
    .limit(50);
  return json({
    sessions: sessions.map((s) => ({
      sessionId: s.id,
      cpf: s.cpf,
      customerId: s.customer_id,
      customerName: s.customer_name,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      lastActivityAt: s.last_activity_at,
      isActive: s.expires_at > now(),
    })),
  });
});

app.post("/admin/sessions/revoke", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json();
  if (!body.sessionId) return jsonError("sessionId é obrigatório.");
  const { data: session } = await db()
    .from("mikweb_sessions")
    .select("session_token")
    .eq("id", body.sessionId)
    .maybeSingle();
  if (session) {
    await db().from("push_subscriptions").delete().eq("session_token", session.session_token);
  }
  await db().from("mikweb_sessions").delete().eq("id", body.sessionId);
  return json({ success: true });
});

app.post("/admin/push", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  try {
    const body = await c.req.json();
    if (!body.title || !body.body) {
      return jsonError("Título e mensagem são obrigatórios.");
    }
    const payload: PushPayload = { title: body.title, body: body.body };

    let subs: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }> = [];
    if (body.cpf) {
      const cpf = body.cpf.replace(/\D/g, "");
      const { data } = await db().from("push_subscriptions").select("endpoint, keys").eq("cpf", cpf);
      subs = data ?? [];
    } else {
      const { data } = await db().from("push_subscriptions").select("endpoint, keys");
      subs = data ?? [];
    }

    if (subs.length === 0) {
      return json({
        success: false,
        error: "Nenhuma inscrição push encontrada" + (body.cpf ? ` para o CPF informado.` : "."),
        sent: 0,
        failed: 0,
      });
    }

    const { sent, failed } = await sendPushToSubs(subs, payload);
    if (sent === 0) {
      return json({
        success: false,
        error: "Nenhuma notificação foi entregue. Verifique as chaves VAPID configuradas nos secrets do Supabase.",
        sent,
        failed,
      });
    }
    return json({ success: true, sent, failed });
  } catch (err) {
    console.error("[ADMIN_PUSH_ERROR]", err);
    return jsonError("Erro ao enviar notificação.", 500);
  }
});

// ---------------------------------------------------------------------------
// WhatsApp / notificações — helpers de composição
// ---------------------------------------------------------------------------

/** Uma instância do runtime por chamada: tudo nele é sem estado (as credenciais vêm do banco). */
function whatsappRuntime() {
  return createWhatsAppRuntime({
    db,
    getEnv: (name: string, fallback?: string) => env(name, fallback),
    log: (message: string, extra?: Record<string, unknown>) => console.log(`[WHATSAPP] ${message}`, extra ?? ""),
    revalidateBilling,
  });
}

/**
 * Revalida a situação da fatura na MikWeb ANTES do envio (chamada pelo dispatcher
 * com cache por lote — uma consulta por fatura, não por lembrete).
 *
 * A REGRA do veredito não mora aqui: ela é o módulo puro `notify/billing-verdict.ts`
 * (`decideBillingVerdict` / `verdictFromResponse`), coberto por teste real em
 * `scripts/check-notification-settings.mjs`. Sobrou para esta função só o
 * TRANSPORTE, porque transporte é a única parte que não dá para testar sem rede:
 *
 *   - escolher a conexão MikWeb (a do evento, ou a primeira ativa);
 *   - montar o caminho da consulta (`billingLookupPath`, também puro e testado);
 *   - fazer o GET e traduzir exceção em `unknown` → o dispatcher ADIA sem gastar
 *     tentativa em vez de enviar às cegas.
 *
 * Antes disto o `Array.isArray(data) ? data : []` vivia aqui: resposta com envelope
 * inesperado virava lista vazia, a fatura "não era encontrada" e o veredito era
 * `open` SEMPRE — revalidação que nunca bloqueia nada e nunca reclama. Ler a
 * resposta agora é `extractBillingList`/`findBilling`, com teste de cada formato.
 */
async function revalidateBilling(input: {
  connection: string | null;
  customerId: string;
  invoiceId: string;
  dueDate: string | null;
  eventKey: string;
}): Promise<BillingVerdict> {
  const connections = await activeMikWebConnections();
  const connection = (input.connection ? connections.find((c) => c.slug === input.connection) : undefined) ?? connections[0];
  if (!connection) return { status: "unknown", error: "nenhuma conta MikWeb ativa" };

  const { rawId: rawCustomerId } = parsePrefixedCustomerId(input.customerId);
  if (!rawCustomerId) return { status: "open" };

  const path = billingLookupPath({ customerId: rawCustomerId, dueDate: input.dueDate, today: civilToday() });

  try {
    // `unknown`: o formato é lido por `verdictFromResponse`, não por um cast aqui.
    const { data } = await mikwebApiGetFullFor<unknown>(connection, path);
    return verdictFromResponse({ response: data, invoiceId: input.invoiceId, eventKey: input.eventKey });
  } catch (error) {
    return { status: "unknown", error: error instanceof Error ? error.message : String(error) };
  }
}

function uazapiClientFrom(config: { baseUrl: string; instanceToken: string; adminToken: string }) {
  return createUazapiClient({
    baseUrl: config.baseUrl,
    token: config.instanceToken,
    adminToken: config.adminToken,
  });
}

// ---------------------------------------------------------------------------
// Alertas de operação — o sistema avisa o ADMIN (WhatsApp + push) quando algo
// precisa de intervenção: canal parado, rodada com falhas, time-lock.
// ---------------------------------------------------------------------------

/** Fallback push para o admin: assinaturas do painel (o alerta de canal não pode depender do canal). */
async function sendPushToAdmins(payload: { title: string; body: string }): Promise<number> {
  try {
    const { data: subs } = await db()
      .from("push_subscriptions")
      .select("endpoint, keys")
      .limit(500);
    if (!subs || subs.length === 0) return 0;
    const { sent } = await sendPushToSubs(subs, { title: payload.title, body: payload.body, tag: "admin-alert" });
    return sent;
  } catch {
    return 0;
  }
}

/**
 * Botões do alerta: resolve URL vazia para o portal + caminho do contexto.
 * Best-effort: falha aqui não derruba o alerta (segue sem botões).
 */
function adminAlertButtons(config: ReturnType<typeof normalizeAdminAlerts>, portalBaseUrl: string, fallbackPath: string): Array<{ label: string; url: string }> | undefined {
  try {
    const buttons = resolveButtons(config.buttons ?? [], portalBaseUrl, fallbackPath);
    return buttons.length ? buttons : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Avalia os gatilhos de alerta após uma rodada de dispatch e avisa o admin.
 * Best-effort por design: NENHUM erro aqui pode derrubar o cron de envio.
 *
 * Gatilhos (com cooldown de 4h por tipo — ver admin-alerts.ts):
 *  - falhas >= adminAlerts.failureThreshold na rodada;
 *  - fila empacada: avisos com hora agendada passada há 12h+ ou presos há 48h+;
 *  - time-lock (WhatsApp impôs pausa por volume);
 *  - pausa com fila parada E instância desconectada (verificação pontual na UazAPI).
 */
async function runOperationAlertChecks(summary: DispatchSummary): Promise<void> {
  try {
    const runtime = whatsappRuntime();
    const loaded = await runtime.getSettings();
    const config = loaded.settings.adminAlerts;
    const portal = loaded.settings.portalBaseUrl;
    const nowMs = Date.now();
    const alertDeps = {
      db,
      getWhatsAppConfig: () => runtime.getConfig(),
      sendPushToAdmins,
      log: (message: string, extra?: Record<string, unknown>) => console.log(`[ADMIN_ALERT] ${message}`, extra ?? ""),
    };

    // 1) Rodada com muitas falhas — motivo e primeiro exemplo.
    if (summary.failed >= config.failureThreshold && config.alertDispatchFailures) {
      const sample = summary.results.find((r) => !r.ok)?.reason ?? null;
      await sendAdminAlert(alertDeps, {
        key: "dispatch-failures",
        config,
        title: "Lembretes: falhas no envio",
        message: buildDispatchFailuresMessage({ failed: summary.failed, sent: summary.sent, sample, at: nowMs }),
        phone: config.phone,
        now: nowMs,
        buttons: adminAlertButtons(config, portal, "/admin/messages"),
      });
      return;
    }

    // 1b) Fila empacada: avisos cujo horário agendado passou há 12h+ (deveria
    // ter saído e não saiu) ou criados há 48h+ (loop de re-agendamento — o
    // deadlock da cota de 30/09/2026 se escondia do sinal de atraso porque
    // re-agendava para o dia seguinte antes de completar 12h). Independente de
    // `summary.paused`: fila presa por bug não vem acompanhada de pausa declarada.
    if (config.alertStuckQueue) {
      try {
        const stuckRows = await runtime.outbox.inspectStuckQueue({ now: nowMs });
        const stuckSignal = classifyStuckQueue(stuckRows, nowMs);
        if (stuckSignal.stuck) {
          await sendAdminAlert(alertDeps, {
            key: "stuck-queue",
            config,
            title: "Lembretes: fila empacada",
            message: buildStuckQueueMessage({ signal: stuckSignal }),
            phone: config.phone,
            now: nowMs,
            buttons: adminAlertButtons(config, portal, "/admin/messages"),
          });
        }
      } catch (error) {
        console.warn("[ADMIN_ALERT] verificação de fila empacada falhou", error instanceof Error ? error.message : error);
      }
    }

    // 2) Pausa com fila: ou é time-lock (avisa) ou o canal está fora (verifica).
    if (!summary.paused) return;
    const pauseReason = summary.pauseReason ?? "";

    if (/time-lock/i.test(pauseReason)) {
      const cfg = await runtime.getConfig();
      if (cfg.pausedUntil) {
        await sendAdminAlert(alertDeps, {
          key: "quota-paused",
          config,
          title: "Lembretes: pausa do WhatsApp",
          message: buildQuotaPausedMessage({ until: cfg.pausedUntil }),
          phone: config.phone,
          now: nowMs,
          buttons: adminAlertButtons(config, portal, "/admin/messages"),
        });
      }
      return;
    }

    // Fora da janela com instância saudável é operação normal (madrugada): só
    // verifico a instância quando há fila pronta que não anda — sinais de canal fora.
    if (summary.claimed > 0 && summary.sent === 0 && summary.failed === 0) {
      const wa = await runtime.getConfig();
      if (wa.baseUrl && wa.instanceToken) {
        try {
          const status = await uazapiClientFrom(wa).instanceStatus();
          await runtime.setStatus(status.state);
          if (!status.connected) {
            await sendAdminAlert(alertDeps, {
              key: "channel-down",
              config,
              title: "Lembretes: canal WhatsApp parado",
              message: buildChannelDownMessage({ reason: `instância ${status.state}` }),
              phone: config.phone,
              now: nowMs,
              buttons: adminAlertButtons(config, portal, "/admin/connections"),
            });
          }
        } catch {
          // A própria verificação falhou (sem rede/credencial inválida): o alerta
          // de credencial quebrada viraria spam — fica no log do servidor.
        }
      } else if (wa.enabled) {
        await sendAdminAlert(alertDeps, {
          key: "channel-down",
          config,
          title: "Lembretes: canal WhatsApp parado",
          message: buildChannelDownMessage({ reason: "credenciais da UazAPI ausentes" }),
          phone: config.phone,
          now: nowMs,
          buttons: adminAlertButtons(config, portal, "/admin/connections"),
        });
      }
    }
  } catch (error) {
    console.error("[ADMIN_ALERT_ERROR]", error);
  }
}

/**
 * Endpoint interno: aceita o secret de cron OU um admin autenticado (para o painel
 * conseguir forçar o dreno da fila sem conhecer o secret).
 */
async function requireCron(request: Request): Promise<boolean> {
  const secret = env("CRON_SECRET");
  const provided = request.headers.get("x-cron-secret") || new URL(request.url).searchParams.get("secret") || "";
  if (secret && provided === secret) return true;
  return requireAdmin(request);
}

/** Webhook é chamado pela UazAPI (server-to-server). Sem secret configurado, aceita. */
function webhookAuthorized(request: Request): boolean {
  const secret = env("UAZAPI_WEBHOOK_SECRET");
  if (!secret) return true;
  const provided = request.headers.get("x-webhook-secret") || new URL(request.url).searchParams.get("secret") || "";
  return provided === secret;
}

// ---------------------------------------------------------------------------
// GET /api/admin/notifications/simulate — dry-run do pipeline de lembretes
//
// Responde "o que sairia hoje, para quem, por qual canal e por que não para o
// resto" — sem enviar nada, sem gravar nada e sem tocar na UazAPI. Usa o mesmo
// núcleo puro que o pipeline de produção usará, então o roteamento, as cotas, a
// janela e a idempotência são os reais. É o passo de validação antes de ligar o
// envio (LEMBRETES-WHATSAPP.md).
//
// A configuração (régua, cotas, janela, hora) vem de `notification_config` +
// `whatsapp_config`. Os parâmetros abaixo são OVERRIDES: só têm efeito quando vêm na
// query, e nesse caso aparecem em `report.overrides` — para o relatório nunca se
// confundir com "o que será enviado".
//
// Query (configuração): horizon=7, at=10, cap=20, per-customer-cap=1,
//                       whatsapp=on|off, rules=[{...}]
// Query (cenário):      instance=up|down, locked-days=0
// Query (execução):     source=mikweb|synthetic, today=YYYY-MM-DD, scenario=...,
//                       opt-in=auto|all|none, push=auto|all|none,
//                       limit-customers=25, max-pages=10, item-limit=500,
//                       preview-limit=25, reveal=1
// ---------------------------------------------------------------------------
app.get("/admin/notifications/simulate", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);

  const url = new URL(c.req.raw.url);
  const param = (name: string, fallback = "") => url.searchParams.get(name) ?? fallback;
  const has = (name: string) => url.searchParams.has(name);
  const int = (name: string, fallback: number) => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const today = param("today") || civilToday();
  if (!isCivilDate(today)) return jsonError("Parâmetro `today` deve estar no formato YYYY-MM-DD.", 400);

  // Cenário, não configuração: simular instância caída e time-lock do WhatsApp.
  const lockDays = Math.max(int("locked-days", 0), 0);
  const instanceConnected = param("instance", "up") !== "down";

  const optInParam = param("opt-in", "auto");
  const pushParam = param("push", "auto");
  if (!["auto", "all", "none"].includes(optInParam)) return jsonError("`opt-in` deve ser auto, all ou none.", 400);
  if (!["auto", "all", "none"].includes(pushParam)) return jsonError("`push` deve ser auto, all ou none.", 400);

  const scenarioParam = param("scenario", "realistic");
  if (!["realistic", "stress", "edge"].includes(scenarioParam)) return jsonError("`scenario` deve ser realistic, stress ou edge.", 400);

  // Régua da rodada, vinda do painel. `rules` na query permite explorar uma régua
  // diferente sem salvar — e o relatório marca isso como override.
  let rulesOverride: unknown;
  const rawRules = url.searchParams.get("rules");
  if (rawRules !== null && rawRules.trim() !== "") {
    try {
      rulesOverride = JSON.parse(rawRules);
    } catch {
      return jsonError("`rules` deve ser JSON válido.", 400);
    }
    if (!Array.isArray(rulesOverride)) return jsonError("`rules` deve ser uma lista JSON de regras.", 400);
  }

  try {
    const loaded = await whatsappRuntime().getSettings();
    const { settings, applied } = applyOverrides(loaded.settings, {
      rules: rulesOverride,
      horizonDays: has("horizon") ? Math.min(Math.max(int("horizon", loaded.settings.horizonDays), 1), 60) : undefined,
      runAtHour: has("at") ? Math.min(Math.max(int("at", loaded.settings.runAtHour), 0), 23) : undefined,
      newChatCapPerDay: has("cap") ? Math.max(int("cap", loaded.settings.whatsapp.newChatCapPerDay), 0) : undefined,
      perCustomerCapPerDay: has("per-customer-cap")
        ? Math.max(int("per-customer-cap", loaded.settings.whatsapp.perCustomerCapPerDay), 1)
        : undefined,
      whatsappEnabled: has("whatsapp") ? param("whatsapp", "on") !== "off" : undefined,
    });

    let base: LoadedBase;
    if (param("source", "mikweb") === "synthetic") {
      const demo = generateDemoBase({ scenario: scenarioParam as DemoScenario, today });
      base = {
        customers: demo.customers,
        billings: demo.billings,
        pushCustomerIds: demo.pushCustomerIds,
        contacts: demo.contacts,
        alreadySent: [],
        assumptions: demo.assumptions,
        source: {
          kind: "synthetic",
          strategy: "synthetic",
          customersScanned: demo.customers.length,
          billingsScanned: demo.billings.length,
          truncated: false,
          note: `cenário ${scenarioParam}`,
        },
      };
    } else {
      base = await loadRealBase(
        { db, listConnections: listMikWebConnections, apiGetFor: mikwebApiGetFullFor },
        {
          from: today,
          // Horizonte da configuração (ou do override) define a janela varrida.
          to: addDays(today, settings.horizonDays - 1),
          // A régua vira janela de VENCIMENTO (syncDueWindow): regras de atraso
          // exigem varrer faturas vencidas antes de hoje, que a janela plana
          // [hoje, hoje+horizonte] deixava de fora.
          rules: settings.rules,            limitCustomers: Math.min(Math.max(int("limit-customers", 25), 1), 200),
            // 50 páginas: o `readCustomers` folheia /customers até achar os cadastros
            // das faturas, e a MikWeb limita o per_page efetivo — com o default antigo
            // (10), 32 de 38 avisos caíam em `no_customer` (o cadastro não fora
            // carregado). O loop tem early-exit ao encontrar todos os IDs.
            maxPages: Math.min(Math.max(int("max-pages", 50), 1), 50),
            assumeOptIn: optInParam === "auto" ? "table" : (optInParam as "all" | "none"),
          assumePush: pushParam === "auto" ? "table" : (pushParam as "all" | "none"),
        }
      );
    }

    // UMA leitura só: os templates salvos regem o preview E entram nas settings do
    // relatório (fingerprint pelos desvios do padrão). O painel compara o que a
    // rodada usou com as edições não salvas do editor para avisar divergência.
    const savedTemplates = await whatsappRuntime()
      .getTemplates()
      .then((loadedT) => loadedT.templates)
      .catch(() => undefined);

    const report = runSimulation({
      customers: base.customers,
      billings: base.billings,
      pushCustomerIds: base.pushCustomerIds,
      contacts: base.contacts,
      alreadySent: base.alreadySent,
      source: base.source,
      assumptions: base.assumptions,
      // A configuração inteira entra no relatório, com fingerprint e procedência: o
      // que foi simulado fica auditável depois, sem depender da memória de quem rodou.
      settings: {
        ...settings,
        origin: loaded.origin,
        updatedAt: loaded.updatedAt,
        updatedBy: loaded.updatedBy,
        notes: loaded.notes,
        templates: savedTemplates,
      },
      templates: savedTemplates,
      overrides: applied,
      today,
      revealPhones: param("reveal") === "1",
      itemLimit: Math.min(Math.max(int("item-limit", 500), 1), 5000),
      previewLimit: Math.min(Math.max(int("preview-limit", 25), 0), 200),
      state: {
        instanceConnected,
        // Sem `locked-days`, vale o time-lock real registrado na configuração.
        pausedUntilMs: lockDays > 0 ? new Date(`${today}T12:00:00Z`).getTime() + lockDays * 86_400_000 : undefined,
      },
    });

    return json(report);
  } catch (error) {
    if (error instanceof MikWebNotConfigured) return jsonError(error.message, 400);
    console.error("[SIMULATE_LEMBRETES_ERROR]", error);
    return jsonError("Erro ao simular os lembretes.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET|POST /api/admin/notifications/templates — mensagens por evento/canal
//
// O editor vive no simulador: cada opção da régua tem seu texto, e o preview com
// dados de exemplo mostra exatamente como a mensagem chega ao cliente. Salvar grava
// overrides parciais sobre os templates do código — o que sai na fila é o que o
// simulador mostrou.
// ---------------------------------------------------------------------------
app.get("/admin/notifications/templates", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  try {
    const state = await whatsappRuntime().describeTemplates();
    const loaded = await whatsappRuntime().getTemplates();
    return json({
      templates: state.templates,
      defaults: state.defaults,
      origin: loaded.origin,
      updatedAt: loaded.updatedAt,
      updatedBy: loaded.updatedBy,
      channels: ["whatsapp", "push"],
      eventKeys: [...RULE_EVENT_KEYS],
      limits: { title: 120, body: 4096 },
      placeholders: [
        "nome", "primeiro_nome", "referencia", "valor", "valor_atualizado", "vencimento",
        "dias_atraso", "dias_para_vencer", "boleto", "pix", "link", "empresa", "tem_encargos",
      ],
    });
  } catch (error) {
    console.error("[TEMPLATES_READ_ERROR]", error);
    return jsonError("Erro ao ler os templates.", 500);
  }
});

app.post("/admin/notifications/templates", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  if (body.templates === undefined || body.templates === null || typeof body.templates !== "object" || Array.isArray(body.templates)) {
    return jsonError("`templates` deve ser um objeto (chave `canal:evento` → { body, title?, active }).", 400);
  }
  try {
    const result = await whatsappRuntime().saveTemplates(body.templates, { updatedBy: "admin" });
    if (!result.ok) {
      console.error("[TEMPLATES_SAVE_ERROR]", result.error);
      return jsonError(result.error, 500);
    }
    await logEvent({
      type: "notification_config",
      metadata: { action: "templates", keys: Object.keys(body.templates).slice(0, 20) },
    });
    const state = await whatsappRuntime().describeTemplates();
    return json({
      success: true,
      origin: result.loaded.origin,
      notes: result.notes ?? [],
      templates: state.templates,
      defaults: state.defaults,
    });
  } catch (error) {
    console.error("[TEMPLATES_SAVE_ERROR]", error);
    return jsonError("Erro ao salvar os templates.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/notifications/settings — configuração efetiva do pipeline
//
// É a resposta para "o que exatamente rege o envio?": a régua (que o simulador
// simula e o dispatcher agenda), as cotas e a janela do canal, o fingerprint e a
// PROCEDÊNCIA (`db` = salvo no painel, `defaults` = ainda a régua do código).
// Enquanto for `defaults`, um deploy muda o comportamento — salvar fixa.
// ---------------------------------------------------------------------------
app.get("/admin/notifications/settings", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  try {
    const loaded = await whatsappRuntime().getSettings();
    return json({
      ...loaded.settings,
      fingerprint: loaded.fingerprint,
      origin: loaded.origin,
      updatedAt: loaded.updatedAt,
      updatedBy: loaded.updatedBy,
      notes: loaded.notes,
      eventKeys: [...RULE_EVENT_KEYS],
      maxRules: MAX_RULES,
      defaults: defaultDocument(),
    });
  } catch (error) {
    console.error("[NOTIFICATION_SETTINGS_READ_ERROR]", error);
    return jsonError("Erro ao ler a configuração de notificações.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/notifications/settings — salva a régua (documento parcial)
//
// Só a régua e os parâmetros de agendamento moram aqui. Cota e janela são do canal e
// continuam em POST /admin/whatsapp/config — um dono por chave, para o painel não
// sobrescrever a config do canal por acidente.
// ---------------------------------------------------------------------------
app.post("/admin/notifications/settings", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));

  // Tipo errado é bug de cliente, não configuração a corrigir: 400 em vez de gravar.
  if (body.rules !== undefined && !Array.isArray(body.rules)) return jsonError("`rules` deve ser uma lista.", 400);
  if (body.rules !== undefined && body.rules.length > MAX_RULES) {
    return jsonError(`A régua aceita no máximo ${MAX_RULES} regras.`, 400);
  }
  for (const field of ["horizonDays", "runAtHour"] as const) {
    if (body[field] !== undefined && !Number.isFinite(Number(body[field]))) {
      return jsonError(`\`${field}\` deve ser numérico.`, 400);
    }
  }

  const result = await whatsappRuntime().saveSettings(
    {
      rules: body.rules,
      horizonDays: body.horizonDays === undefined ? undefined : Number(body.horizonDays),
      runAtHour: body.runAtHour === undefined ? undefined : Number(body.runAtHour),
      skipInactiveCustomers: typeof body.skipInactiveCustomers === "boolean" ? body.skipInactiveCustomers : undefined,
      portalBaseUrl: typeof body.portalBaseUrl === "string" ? body.portalBaseUrl : undefined,
      companyName: typeof body.companyName === "string" ? body.companyName : undefined,
      adminAlerts: body.adminAlerts === undefined ? undefined : normalizeAdminAlerts(body.adminAlerts),
    },
    { updatedBy: "admin" }
  );

  if (!result.ok) {
    console.error("[NOTIFICATION_SETTINGS_SAVE_ERROR]", result.error);
    return jsonError(result.error, 500);
  }

  await logEvent({
    type: "notification_config",
    metadata: {
      fingerprint: result.loaded.fingerprint,
      origin: result.loaded.origin,
      rules: result.loaded.settings.rules.map((rule) => `${rule.active ? "" : "✕"}${rule.key}@${rule.offsetDays}`),
      horizonDays: result.loaded.settings.horizonDays,
      runAtHour: result.loaded.settings.runAtHour,
      adminAlertsConfigured: Boolean(result.loaded.settings.adminAlerts.phone),
    },
  });

  return json({
    success: true,
    ...result.loaded.settings,
    fingerprint: result.loaded.fingerprint,
    origin: result.loaded.origin,
    updatedAt: result.loaded.updatedAt,
    updatedBy: result.loaded.updatedBy,
    // Notas da validação (o que foi limitado/corrigido) + o estado da leitura.
    notes: [...result.notes, ...result.loaded.notes],
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/whatsapp/button-stats — uso real dos botões de ação (30 dias)
//
// Agrega a view `whatsapp_button_click_stats` (migration 007): cliques por
// rótulo, telefones únicos e quantos cliques casaram com a entrega exata. É a
// resposta para "quantos clientes usam o Pix copiável?".
// ---------------------------------------------------------------------------
app.get("/admin/whatsapp/button-stats", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  try {
    const { data, error } = await db()
      .from("whatsapp_button_click_stats")
      .select("*")
      .limit(20);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    return json({
      success: true,
      stats: rows.map((row) => ({
        label: String(row.button_label ?? "—"),
        clicks: Number(row.clicks ?? 0),
        uniquePhones: Number(row.unique_phones ?? 0),
        matched: Number(row.matched ?? 0),
        unmatched: Number(row.unmatched ?? 0),
        lastClickAt: row.last_click_at ? new Date(String(row.last_click_at)).getTime() : null,
      })),
    });
  } catch (error) {
    // Migration 007 pendente: devolve vazio, não 500.
    return json({ success: true, stats: [], pending: error instanceof Error ? error.message : String(error) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/whatsapp/engagement-funnel — funil de engajamento por semana
//
// enviado → entregue → lido → clicou no Pix, agregado por semana (seg–dom, fuso
// do projeto). A agregação vive em `notify/engagement.ts` (módulo puro): aqui só
// buscam-se as linhas de `notification_deliveries` e `whatsapp_button_clicks` e
// injeta-se nelas. Sem as duas tabelas (migrations 003/007 pendentes) devolve
// vazio com flag `pending` — o painel oculta a seção, não estoura 500.
// ---------------------------------------------------------------------------
app.get("/admin/whatsapp/engagement-funnel", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);

  const weeksWanted = Math.min(Math.max(Number(c.req.query("weeks") ?? "8") || 8, 1), 12);
  const nowMs = Date.now();
  const weeks = buildFunnelWeeks({ now: nowMs, weeks: weeksWanted });
  // Consulta começa na segunda-feira da semana mais antiga (meia-noite local).
  const sinceMs = weekStartToMs(weeks[0]!.weekStart);
  // Esqueleto vazio já é resposta válida (migration pendente, erro de leitura):
  // o painel mostra semanas zeradas com a nota, nunca um 500.
  let funnel = weeks;

  try {
    // Colunas mínimas para a agregação — a tabela pode ter muitas linhas.
    const { data: deliveryRows, error: deliveryError } = await db()
      .from("notification_deliveries")
      .select("status, sent_at, created_at")
      .gte("created_at", sinceMs)
      .limit(10000);
    if (deliveryError) throw new Error(deliveryError.message);

    let clicks: Array<{ created_at: number; button_label: string | null }> = [];
    const { data: clickRows, error: clickError } = await db()
      .from("whatsapp_button_clicks")
      .select("created_at, button_label")
      .gte("created_at", sinceMs)
      .limit(10000);
    if (!clickError) {
      clicks = (clickRows ?? []) as Array<{ created_at: number; button_label: string | null }>;
    }
    // Erro na tabela de cliques (ex.: migration 007 pendente) NÃO derruba o funil:
    // as etapas de envio continuam válidas, só os cliques ficam zerados.

    funnel = aggregateFunnel({
      weeks,
      deliveries: (deliveryRows ?? []) as Array<{ status: string; sent_at: number | null; created_at: number }>,
      clicks,
    });

    return json({
      success: true,
      weeks: funnel,
      totals: funnelTotals(funnel),
      pending: clickError ? "whatsapp_button_clicks indisponível" : undefined,
    });
  } catch (error) {
    // Migration 003 pendente (ou erro de leitura): devolve vazio, não 500.
    return json({
      success: true,
      weeks: funnel,
      totals: funnelTotals(funnel),
      pending: error instanceof Error ? error.message : String(error),
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/whatsapp/config — config + status da instância + limites + números
// ---------------------------------------------------------------------------
app.get("/admin/whatsapp/config", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const runtime = whatsappRuntime();
  const config = await runtime.getConfig();

  let instance: { state: string; connected: boolean } | null = null;
  let limits: unknown = null;
  let instanceError: string | null = null;

  if (config.baseUrl && config.instanceToken) {
    try {
      const client = uazapiClientFrom(config);
      const status = await client.instanceStatus();
      instance = { state: status.state, connected: status.connected };
      limits = await client.messageLimits();
      await runtime.setStatus(status.state);
    } catch (error) {
      instanceError = error instanceof Error ? error.message : String(error);
    }
  }

  let stats: Record<string, number> = {};
  try {
    stats = await runtime.outbox.stats({ since: now() - 7 * 24 * 60 * 60 * 1000 });
  } catch {
    // migration 003 ainda não aplicada
  }

  return json({
    baseUrl: config.baseUrl,
    instanceName: config.instanceName,
    enabled: config.enabled,
    origin: config.origin,
    hasInstanceToken: !!config.instanceToken,
    hasAdminToken: !!config.adminToken,
    instanceTokenMasked: maskToken(config.instanceToken),
    adminTokenMasked: maskToken(config.adminToken),
    dailyNewChatCap: config.dailyNewChatCap,
    perCustomerCap: config.perCustomerCap,
    sendGapSeconds: config.sendGapSeconds,
    windowStart: config.windowStart,
    windowEnd: config.windowEnd,
    pausedUntil: config.pausedUntil,
    lastStatus: config.lastStatus,
    lastStatusAt: config.lastStatusAt,
    instance,
    limits,
    instanceError,
    stats,
    webhookSecretConfigured: !!env("UAZAPI_WEBHOOK_SECRET"),
    cronSecretConfigured: !!env("CRON_SECRET"),
    // URL completa (com `?secret=`) para colar na UazAPI. Montada aqui no
    // servidor — o secret nunca vive no bundle do frontend. Sem secret
    // configurado, devolve a URL nua: o webhook ainda aceita (com aviso no
    // log), e o painel mostra o campo para você ver o endereço.
    webhookUrl: buildWebhookUrl(c.req.raw),
  });
});

/**
 * URL pública do webhook da UazAPI, com o secret pronto para colar.
 * Derivada da própria request (o painel já fala com a função pela URL certa),
 * então não há nada para configurar separadamente. Sem secret configurado,
 * devolve a URL sem query — o painel indica que falta proteger o webhook.
 *
 * O esquema NÃO vem de `request.url`: o proxy do Supabase encaminha a chamada
 * internamente via HTTP e a função enxergaria `http://` em produção (verificado
 * ao vivo). Vale `x-forwarded-proto` quando presente, `https` como padrão fora
 * do localhost — e o esquema original só sobrevive no desenvolvimento local.
 */
function buildWebhookUrl(request: Request): string {
  const url = new URL(request.url);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const scheme = isLocal ? url.protocol.replace(/:$/, "") : forwardedProto || "https";
  const base = `${scheme}://${url.host}/functions/v1/api/webhooks/uazapi`;
  const webhookSecret = env("UAZAPI_WEBHOOK_SECRET");
  return webhookSecret ? `${base}?secret=${encodeURIComponent(webhookSecret)}` : base;
}

// ---------------------------------------------------------------------------
// GET /api/admin/whatsapp/flow-status — diagnóstico do fluxo de envio em 1 chamada
//
// Alimenta o card "Fluxo de envio" do painel: cada etapa do caminho (credenciais →
// conexão → régua → contatos → fila → janela/cotas) com um estado pronto para exibição.
// A avaliação vive AQUI (não no frontend) para que o teste e a tela digam a mesma coisa.
// ---------------------------------------------------------------------------
app.get("/admin/whatsapp/flow-status", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const runtime = whatsappRuntime();
  const config = await runtime.getConfig();
  const currentNow = now();

  let rulesActive: number | null = null;
  let rulesTotal: number | null = null;
  let adminAlertsConfigured = false;
  try {
    const loaded = await runtime.getSettings();
    const rules = (loaded as unknown as { settings?: { rules?: { active: boolean }[] } }).settings?.rules;
    if (rules) {
      rulesTotal = rules.length;
      rulesActive = rules.filter((rule) => rule.active).length;
    }
    adminAlertsConfigured = Boolean(loaded.settings.adminAlerts.phone);
  } catch {
    // régua indisponível: fica "?" na tela, não derruba o endpoint
  }

  let contactsOptIn: number | null = null;
  try {
    const { count } = await db()
      .from("whatsapp_contacts")
      .select("id", { count: "exact", head: true })
      .eq("opt_in", true);
    contactsOptIn = count ?? null;
  } catch {
    // migration de contatos ainda não aplicada
  }

  const { data: queueRows } = await db()
    .from("notification_deliveries")
    .select("status, scheduled_for, channel")
    .eq("channel", "whatsapp")
    .in("status", ["queued", "sending"])
    .limit(1000);
  const queueRowsSafe = (queueRows ?? []) as Record<string, unknown>[];
  const queuedNow = queueRowsSafe.filter((row) => Number(row.scheduled_for ?? 0) <= currentNow).length;
  const queuedFuture = queueRowsSafe.length - queuedNow;

  const { count: failedCount } = await db()
    .from("notification_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("channel", "whatsapp")
    .eq("status", "failed");

  const inWindow = (() => {
    const hourBR = Number(
      new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }).format(currentNow)
    );
    return hourBR >= config.windowStart && hourBR < config.windowEnd;
  })();

  return json({
    now: currentNow,
    // Etapa 1 — credenciais da UazAPI
    credentials: { ok: !!config.baseUrl && !!config.instanceToken, origin: config.origin },
    // Etapa 2 — instância conectada
    connected: { ok: config.lastStatus === "connected", state: config.lastStatus },
    // Etapa 3 — canal ativo
    enabled: { ok: config.enabled },
    // Etapa 4 — régua com regras ligadas
    rules: { ok: (rulesActive ?? 0) > 0, active: rulesActive, total: rulesTotal },
    // Etapa 5 — contatos com opt-in
    contacts: { ok: (contactsOptIn ?? 0) > 0, optIn: contactsOptIn },
    // Etapa 6 — fila (o que sai agora vs. agendado para depois)
    queue: { ready: queuedNow, scheduled: queuedFuture, failed: failedCount ?? 0 },
    // Janela de envio e pausas
    window: { inWindow, start: config.windowStart, end: config.windowEnd },
    pausedUntil: config.pausedUntil,
    timeLock: null,
    sendGapSeconds: config.sendGapSeconds,
    // Alerta de operação: configurado = número do admin salvo (o card mostra dica se não).
    adminAlerts: { configured: adminAlertsConfigured },
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/whatsapp/health — score do canal + checklist do que falta.
// Cada checagem diz ONDE resolver (fix = rota do painel): o card do dashboard
// vira o atalho. Consulta pontual na UazAPI (status da instância) — rota de
// leitura, nunca bloqueia nada.
app.get("/admin/whatsapp/health", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const runtime = whatsappRuntime();
  try {
    const config = await runtime.getConfig();
    const checks: HealthCheck[] = [];

    const hasCreds = Boolean(config.baseUrl && config.instanceToken);
    checks.push({
      key: "credentials",
      label: "Credenciais da UazAPI configuradas",
      ok: hasCreds,
      critical: true,
      fix: "/admin/connections",
      detail: config.origin === "env" ? "fixadas por secret" : config.origin === "db" ? "salvas no painel" : "ausentes",
    });

    checks.push({
      key: "enabled",
      label: "Canal ativo",
      ok: config.enabled,
      critical: true,
      fix: "/admin/connections",
      detail: config.enabled ? undefined : "switch desligado na configuração",
    });

    checks.push({
      key: "instance",
      label: "Instância conectada",
      ok: false,
      critical: true,
      fix: "/admin/connections",
    });
    if (hasCreds && config.enabled) {
      try {
        const status = await uazapiClientFrom(config).instanceStatus();
        const instanceCheck = checks[checks.length - 1]!;
        instanceCheck.ok = status.connected;
        instanceCheck.detail = `estado: ${status.state}`;
        if (config.lastStatus && config.lastStatus !== status.state) {
          instanceCheck.detail += ` (painel via atualização automática)`;
        }
      } catch (error) {
        checks[checks.length - 1]!.detail = `sem resposta: ${error instanceof Error ? error.message : String(error)}`.slice(0, 120);
      }
    } else {
      checks[checks.length - 1]!.detail = "depende das credenciais e do canal ativo";
    }

    checks.push({
      key: "paused",
      label: "Sem pausa de time-lock",
      ok: !(config.pausedUntil && config.pausedUntil > now()),
      critical: true,
      fix: "/admin/connections",
      detail: config.pausedUntil && config.pausedUntil > now()
        ? `pausado até ${new Date(config.pausedUntil).toLocaleString("pt-BR")}`
        : undefined,
    });

    checks.push({
      key: "webhook-secret",
      label: "Webhook com secret",
      ok: Boolean(env("UAZAPI_WEBHOOK_SECRET")),
      critical: false,
      fix: "/admin/connections",
      detail: env("UAZAPI_WEBHOOK_SECRET") ? undefined : "status/opt-out podem não chegar (aceita qualquer origem)",
    });

    const loaded = await runtime.getSettings();
    const activeRules = loaded.settings.rules.filter((rule) => rule.active);
    checks.push({
      key: "rules",
      label: "Régua de lembretes ativa",
      ok: activeRules.length > 0,
      critical: true,
      fix: "/admin/simulator",
      detail: activeRules.length ? `${activeRules.length} regra(s) ativa(s)` : "nenhuma regra ligada — nada é enfileirado",
    });

    let optIns = 0;
    try {
      const { count } = await db()
        .from("whatsapp_contacts")
        .select("customer_id", { count: "exact", head: true })
        .eq("opt_in", true);
      optIns = Number(count ?? 0);
    } catch {
      optIns = 0;
    }
    checks.push({
      key: "optins",
      label: "Base de opt-ins",
      ok: optIns > 0,
      critical: false,
      fix: "/admin/connections",
      detail: optIns > 0 ? `${optIns} cliente(s) autorizado(s)` : "nenhum opt-in — sync não teria destino",
    });

    // Informacional: descreve operação, não entra na nota.
    let uncertain = 0;
    try {
      uncertain = (await runtime.outbox.listUncertain({ limit: 100 })).length;
    } catch {
      uncertain = 0;
    }
    checks.push({
      key: "uncertain",
      label: "Envios incertos",
      ok: uncertain === 0,
      informational: true,
      fix: "/admin/messages",
      detail: uncertain > 0 ? `${uncertain} aguardando conciliação (podem ter saído)` : "nenhum",
    });

    const health = computeWhatsAppHealth(checks);
    return json({ success: true, health, optIns, uncertain });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Falha ao avaliar a saúde do canal.", 500);
  }
});

// POST /api/admin/whatsapp/webhook-apply — registra a URL do webhook na UazAPI
//
// O operador não precisa entrar no painel da UazAPI para colar a URL: este
// endpoint monta a URL com o secret (buildWebhookUrl) e chama POST /webhook da
// UazAPI com os eventos que o nosso handler sabe traduzir (messages,
// messages_update, connection; excluindo wasSentByApi — o eco do próprio canal).
// Idempotente: reaplicar sobrescreve a config do webhook com a mesma verdade.
// ---------------------------------------------------------------------------
app.post("/admin/whatsapp/webhook-apply", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const runtime = whatsappRuntime();
  const config = await runtime.getConfig();
  if (!config.baseUrl || !config.instanceToken) {
    return jsonError("Credenciais da UazAPI ausentes — salve a Server URL e o token da instância primeiro.", 400);
  }

  const webhookUrl = buildWebhookUrl(c.req.raw);
  const warning = env("UAZAPI_WEBHOOK_SECRET")
    ? null
    : "Sem UAZAPI_WEBHOOK_SECRET configurado, o webhook aceita chamadas de qualquer origem. Configure o secret e reaplique.";

  try {
    const client = uazapiClientFrom(config);
    await client.setWebhook({ url: webhookUrl });
    await logEvent({
      type: "notification_config",
      metadata: { action: "webhook-apply", hasSecret: Boolean(env("UAZAPI_WEBHOOK_SECRET")) },
    });
    return json({
      success: true,
      webhookUrl,
      events: [...UAZAPI_WEBHOOK_EVENTS],
      excludeMessages: [...UAZAPI_WEBHOOK_EXCLUDE],
      warning,
    });
  } catch (error) {
    console.error("[WEBHOOK_APPLY_ERROR]", error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`A UazAPI recusou o registro do webhook: ${message}`, 502);
  }
});

// ---------------------------------------------------------------------------
// GET|POST /api/admin/alerts — alertas de operação ao admin
//
// GET: config atual + quando cada alerta disparou por último (anti-spam visível).
// POST: salva número/gatilhos (merge parcial — campo ausente mantém o atual).
// ---------------------------------------------------------------------------
app.get("/admin/alerts", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  try {
    const runtime = whatsappRuntime();
    const loaded = await runtime.getSettings();
    const alerts = loaded.settings.adminAlerts;
    const lastSentAt: Record<string, number> = {};
    try {
      const { data } = await db().from("admin_alerts_state").select("state").eq("key", "default").maybeSingle();
      const raw = (data as { state?: Record<string, unknown> } | null)?.state ?? {};
      for (const [key, value] of Object.entries(raw)) {
        const num = Number(value);
        if (Number.isFinite(num) && num > 0) lastSentAt[key] = Math.trunc(num);
      }
    } catch {
      // migration 009 pendente: sem memória ainda
    }
    return json({
      alerts,
      lastSentAt,
      cooldownHours: 4,
      origin: loaded.origin,
      updatedAt: loaded.updatedAt,
      updatedBy: loaded.updatedBy,
    });
  } catch (error) {
    console.error("[ADMIN_ALERTS_READ_ERROR]", error);
    return jsonError("Erro ao ler a configuração de alertas.", 500);
  }
});

app.post("/admin/alerts", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  try {
    const runtime = whatsappRuntime();
    const current = await runtime.getSettings();
    const merged = normalizeAdminAlerts({ ...current.settings.adminAlerts, ...normalizeAdminAlerts(body) });
    const result = await runtime.saveSettings({ adminAlerts: merged }, { updatedBy: "admin" });
    if (!result.ok) {
      console.error("[ADMIN_ALERTS_SAVE_ERROR]", result.error);
      return jsonError(result.error, 500);
    }
    await logEvent({
      type: "notification_config",
      metadata: { action: "admin-alerts", configured: Boolean(result.loaded.settings.adminAlerts.phone) },
    });
    return json({ success: true, alerts: result.loaded.settings.adminAlerts, notes: [...result.notes, ...result.loaded.notes] });
  } catch (error) {
    console.error("[ADMIN_ALERTS_SAVE_ERROR]", error);
    return jsonError("Erro ao salvar os alertas.", 500);
  }
});

// POST /api/admin/alerts/test — envia AGORA uma mensagem de teste para o admin.
// Envio DIRETO (sem cooldown e sem gravar memória): é o botão "enviar teste" do
// painel — repetido de propósito quando o admin está ajustando o número.
app.post("/admin/alerts/test", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  try {
    const runtime = whatsappRuntime();
    const loaded = await runtime.getSettings();
    const config = loaded.settings.adminAlerts;
    if (!config.phone) {
      return jsonError("Salve o WhatsApp do admin antes de testar.", 400);
    }
    const message = "✅ Teste de alerta do sistema de lembretes. Este é o número que receberá avisos de operação (canal parado, falhas de envio).";
    const wa = await runtime.getConfig();
    if (wa.baseUrl && wa.instanceToken) {
      try {
        await uazapiClientFrom(wa).sendText({ number: config.phone, text: message });
        return json({ success: true, via: "whatsapp" });
      } catch (error) {
        console.warn("[ADMIN_ALERT_TEST] WhatsApp falhou, tentando push:", error instanceof Error ? error.message : error);
      }
    }
    const sent = await sendPushToAdmins({ title: "Teste de alerta", body: message });
    return json({ success: sent > 0, via: sent > 0 ? "push" : "none", reason: sent > 0 ? null : "canal WhatsApp indisponível e push não entregue" });
  } catch (error) {
    console.error("[ADMIN_ALERTS_TEST_ERROR]", error);
    return jsonError("Erro ao enviar o teste de alerta.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/whatsapp/config — salvar (token vazio não apaga o existente)
// ---------------------------------------------------------------------------
app.post("/admin/whatsapp/config", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const num = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const result = await whatsappRuntime().saveConfig({
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
    adminToken: typeof body.adminToken === "string" ? body.adminToken : undefined,
    instanceToken: typeof body.instanceToken === "string" ? body.instanceToken : undefined,
    instanceName: typeof body.instanceName === "string" ? body.instanceName : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    dailyNewChatCap: num(body.dailyNewChatCap),
    perCustomerCap: num(body.perCustomerCap),
    sendGapSeconds: num(body.sendGapSeconds),
    windowStart: num(body.windowStart),
    windowEnd: num(body.windowEnd),
  });

  if (!result.ok) return jsonError(result.error ?? "Erro ao salvar a configuração.", 500);
  await logEvent({ type: "whatsapp_config", metadata: { enabled: body.enabled ?? null, origin: "admin" } });
  return json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /api/admin/whatsapp/connect — inicia conexão (QR Code / código de pareamento)
// ---------------------------------------------------------------------------
app.post("/admin/whatsapp/connect", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const config = await whatsappRuntime().getConfig();
  if (!config.baseUrl || !config.instanceToken) {
    return jsonError("Configure a Server URL e o token da instância antes de conectar.", 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const phone = typeof body.phone === "string" ? normalizeBrMobile(body.phone) : null;

  try {
    const result = await uazapiClientFrom(config).connect(phone && phone.ok ? { phone: phone.e164 } : undefined);
    return json({ success: true, qrCode: result.qrCode, pairCode: result.pairCode });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Erro ao iniciar a conexão.", 502);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/whatsapp/import-contacts — importa opt-ins da base MikWeb
//
// Cria/atualiza `whatsapp_contacts` a partir dos telefones celulares dos clientes
// da MikWeb. POLÍTICA DE CONSENTIMENTO (importante):
//   - o cliente precisa ter um celular válido no cadastro;
//   - quem JÁ está na tabela NUNCA é reativado: `opt_out_at` vence — este endpoint
//     só PREENCHE telefone/nome e só liga opt-in para quem ainda não tem registro;
//   - `dryRun: true` devolve o plano completo (o que entraria, o que ficaria de
//     fora e por quê) SEM gravar nada.
// Opt-in é decisão do cliente: esta importação cadastra o MEIO de contato; a régua
// de envio continua só alcançando quem explicitamente autorizou — usar a campanha
// do portal (ou o opt-in automático no login) para coletar o consentimento.
// ---------------------------------------------------------------------------
/**
 * Núcleo da importação de opt-ins, compartilhado pelo endpoint do admin e pelo
 * cron diário (`/cron/whatsapp-import-contacts`). Mesma política nos dois: opt-out
 * vence, registro existente preserva o consentimento, upsert idempotente.
 *
 * MULTI-CONTA: varre TODAS as contas ativas e grava cada cliente com o id
 * PREFIXADO pela conta de origem — duas contas podem ter o mesmo `id` interno
 * sem colidir em `whatsapp_contacts` (que é UNIQUE por customer_id).
 */
async function importMikwebContacts(options: {
  dryRun: boolean;
  maxPages: number;
}): Promise<Record<string, unknown>> {
  const connections = await activeMikWebConnections();
  if (!connections.length) throw new Error("Nenhuma conta MikWeb ativa — cadastre em Conexões.");

  // Varredura completa dos clientes de CADA conta (paginada, em sequência).
  const customers: MikWebCustomer[] = [];
  const perConnection: Array<{ slug: string; label: string; ok: boolean; scanned: number; error?: string }> = [];
  for (const connection of connections) {
    let page = 1;
    let totalPages = 1;
    let scanned = 0;
    try {
      while (page <= totalPages && page <= options.maxPages) {
        const { data, meta } = await mikwebApiGetFullFor<MikWebCustomer[]>(
          connection,
          page === 1 ? "/customers?per_page=100" : `/customers?per_page=100&page=${page}`
        );
        if (data?.length) customers.push(...data);
        scanned += data?.length ?? 0;
        const next = meta?.pages?.total_pages;
        if (!next || !Number.isFinite(next)) break;
        totalPages = next;
        page++;
      }
      perConnection.push({ slug: connection.slug, label: connection.label, ok: true, scanned });
    } catch (error) {
      // Uma conta fora do ar não impede a importação das outras.
      perConnection.push({ slug: connection.slug, label: connection.label, ok: false, scanned, error: mikwebErrorDetails(error) });
    }
  }

  const ts = Date.now();
  const contacts = new Map<string, Record<string, unknown>>();
  const failures: Partial<Record<PhoneFailure, number>> = {};
  let noPhone = 0;
  let eligible = 0;

  // Estados atuais, para não reativar quem pediu para sair e não duplicar telefone.
  const existingRows = await db()
    .from("whatsapp_contacts")
    .select("customer_id, phone_e164, opt_in, opt_out_at")
    .limit(10_000);
  const existing = new Map<string, Record<string, unknown>>();
  const existingByPhone = new Set<string>();
  for (const row of existingRows.data ?? []) {
    const record = row as Record<string, unknown>;
    existing.set(String(record.customer_id), record);
    if (typeof record.phone_e164 === "string" && record.phone_e164) existingByPhone.add(record.phone_e164);
  }

  // PREFIXO por conta: cada cliente coletado é re-emitido com o id da sua conta.
  const prefixed: MikWebCustomer[] = [];
  let cursor = 0;
  for (const item of perConnection) {
    const connection = connections.find((c) => c.slug === item.slug)!;
    for (let index = 0; index < item.scanned; index++, cursor++) {
      const customer = customers[cursor];
      if (!customer) break;
      prefixed.push({ ...customer, id: prefixedCustomerId(connection.slug, customer.id) });
    }
  }

  // ORIGEM: itera a lista PREFIXADA (`prefixed`, montada acima por conta) — o
  // customer_id gravado já carrega a conta de origem.
  for (const customer of prefixed) {
    const customerId = String(customer.id ?? "");
    if (!customerId) continue;
    const phone = pickCustomerPhone(customer);
    if (!phone.ok) {
      if (phone.reason === "empty") noPhone++;
      else failures[phone.reason] = (failures[phone.reason] ?? 0) + 1;
      continue;
    }
    eligible++;
    const current = existing.get(customerId);
    const optedOut = current ? current.opt_out_at !== null && current.opt_out_at !== undefined : false;
    contacts.set(customerId, {
      customer_id: customerId,
      cpf: typeof customer.cpf_cnpj === "string" ? customer.cpf_cnpj : null,
      customer_name: customer.full_name ?? null,
      phone_e164: phone.e164,
      // Opt-in: só quem AINDA NÃO TEM registro entra como opt-in=true (o cliente
      // autorizou receber pelo portal). Registro existente preserva o consentimento
      // atual — e opt-out vence sempre.
      opt_in: current ? current.opt_in === true && !optedOut : true,
      opt_out_at: current ? (current.opt_out_at ?? null) : null,
      source: "mikweb-import",
      is_new: !current,
      phone_changed: current ? current.phone_e164 !== phone.e164 : false,
      _failure_reason: phone.reason === "landline" || phone.reason === "invalid" ? phone.reason : null,
    });
  }

  const toInsert = [...contacts.values()].filter((row) => row.is_new);
  const toUpdate = [...contacts.values()].filter((row) => !row.is_new && (row.phone_changed || row.opt_in === true));
  const plan = {
    scanned: customers.length,
    eligible,
    noPhone,
    phoneFailures: failures,
    newContacts: toInsert.length,
    updates: toUpdate.length,
    keptOptOut: [...contacts.values()].filter((row) => row.opt_out_at !== null && row.opt_out_at !== undefined).length,
    phoneConflicts: [...contacts.values()].filter((row) => row.phone_e164 && existingByPhone.has(String(row.phone_e164)) && row.is_new).length,
    perConnection,
  };

  if (options.dryRun) {
    return { dryRun: true, plan, sample: [...contacts.values()].slice(0, 10) };
  }

  // Gravação em lotes: upsert preserva o registro (idempotente, reprocessar não duplica).
  const rows = [...contacts.values()].map((row) => {
    // Chaves de planejamento (`is_new`, `phone_changed`) e o diagnóstico
    // `_failure_reason` NÃO são colunas da tabela — ir ao upsert com elas é
    // PGRST204 na cara (peguei ao vivo no primeiro run do cron).
    const { is_new: _isNew, phone_changed: _phoneChanged, _failure_reason: _failureReason, ...contact } = row;
    return { ...contact, created_at: ts, updated_at: ts };
  });
  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200);
    const { error } = await db()
      .from("whatsapp_contacts")
      .upsert(batch, { onConflict: "customer_id" });
    if (error) throw new Error(`Erro ao gravar os contatos: ${error.message}`);
  }

  return { dryRun: false, plan: { ...plan, written: rows.length }, updated: toUpdate.length };
}

app.post("/admin/whatsapp/import-contacts", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const maxPages = Math.min(Math.max(Number(body.maxPages ?? 30), 1), 100);

  try {
    const result = await importMikwebContacts({ dryRun, maxPages });
    const plan = result.plan as { scanned: number; newContacts: number; updates: number };
    if (!dryRun) {
      await logEvent({
        type: "whatsapp_opt_in",
        metadata: { action: "import-contacts", scanned: plan.scanned, newContacts: plan.newContacts, updates: plan.updates },
      });
    }
    return json({ success: true, ...result });
  } catch (error) {
    console.error("[IMPORT_CONTACTS_ERROR]", error);
    return jsonError(error instanceof Error ? error.message : "Erro ao importar os contatos.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/whatsapp/test — testa o canal (sem número: só status)
//
// Com `number` + `confirm: true` a mensagem de teste entra pela outbox e é
// entregue pelo mesmo adapter do lembrete. Um "teste" que não passa pela fila não
// prova nada sobre a fila.
// ---------------------------------------------------------------------------
app.post("/admin/whatsapp/test", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const runtime = whatsappRuntime();

  if (!body.number) {
    const readiness = await runtime.adapter.ready();
    return json({ ready: readiness.ok, reason: readiness.reason ?? null, retryAt: readiness.retryAt ?? null });
  }
  if (body.confirm !== true) return jsonError("É preciso confirmar o envio do teste.", 400);

  const phone = normalizeBrMobile(String(body.number));
  if (!phone.ok) {
    return jsonError(
      phone.reason === "landline" ? "O número informado é fixo — informe um celular." : "Número inválido: informe DDD + celular.",
      400
    );
  }

  // Régua de lembretes no teste: além da sonda do canal (`test`), o admin pode
  // receber QUALQUER opção da régua, no formato exato que o cliente recebe — mesmo
  // template salvo, mesmos campos, mesma contagem de dias. É o que torna o teste
  // previsível: o que chega aqui é o que sairia para o cliente naquele evento.
  const requestedEventKey = typeof body.eventKey === "string" ? body.eventKey : "test";
  const isReminderTest = requestedEventKey !== "test";
  const eventKey = requestedEventKey;
  let ruleLabel: string | null = null;
  if (isReminderTest) {
    const { settings } = await runtime.getSettings();
    const rule = settings.rules.find((candidate) => candidate.eventKey === requestedEventKey);
    if (!rule) {
      return jsonError("A régua em vigor não tem essa opção — recarregue a página.", 400);
    }
    ruleLabel = rule.label;
  }

  try {
    // Payload do teste. Na régua, é um payload REALISTA de fatura (referência,
    // valor, vencimento coerente com o deslocamento da regra — o aviso de atraso
    // exige vencimento no passado, senão o dispatcher reagenda/descarta o evento).
    const today = civilToday(now());
    const offsetDays = typeof body.offsetDays === "number" ? body.offsetDays : 0;
    const dueDate = addDays(today, isReminderTest ? -Math.abs(Math.trunc(offsetDays)) : 0);
    const reference = isReminderTest ? "Mensalidade de Acesso à Internet" : "Teste do canal";
    const payload = isReminderTest
      ? {
          ...buildPayload(
            {
              customer: {
                id: "teste",
                full_name: "Cliente Teste",
                cpf_cnpj: null,
                status: "Ativo",
                phone_number: null,
                cell_phone_number_1: null,
                cell_phone_number_2: null,
                cell_phone_number_3: null,
                cell_phone_number_4: null,
              },
              billing: {
                id: "teste",
                customer_id: "teste",
                value: 99.9,
                reference,
                due_day: dueDate,
                situation_name: "Em Aberto",
                // Dados de cobrança realistas para o teste exercitar os BOTÕES de
                // ação rápida (copiar Pix, copiar código de barras, abrir portal) —
                // sem eles o teste sairia sem botões, mascarando o formato real.
                pix_copy_paste_base64:
                  "000201010212261060014br.gov.bcb.pix2558api.pix.com/v2/cobv/12345678901234567890123456785204000053039865406129.905802BR5913Cliente Teste6009Sao Paulo62070503***63041234",
                digitable_line: "34191.09012 34567.890123 45678.901234 5 12345678901234",
                integration_link: "https://minhasupernet.com/faturas/teste/boleto.pdf",
              },
              dueDate,
              reference,
              referenceDate: today,
              portalBaseUrl: "https://minhasupernet.com",
              companyName: "MinhaSuperNet",
            }
          ),
        }
      : (() => {
          const localStamp = new Date(now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
          return { data_hora: localStamp, nome: "Teste", primeiro_nome: "Teste" };
        })();

    const enqueued = await runtime.outbox.enqueue({
      eventKey,
      dedupeKey: `test:${eventKey}:${phone.e164}:${now()}`,
      customerId: null,
      cpf: null,
      payload: { ...payload, __dueDate: dueDate } as Record<string, unknown>,
      priority: "transactional",
      channel: "whatsapp",
      target: phone.e164,
      rendered: null,
      scheduledFor: now(),
    });

    if (!enqueued.deliveryId) return jsonError("Não foi possível enfileirar a mensagem de teste.", 500);

    const summary = await runtime.dispatch({ ids: [enqueued.deliveryId], policy: "manual", limit: 1 });
    const item = summary.results.find((entry) => entry.deliveryId === enqueued.deliveryId);
    const ok = summary.sent > 0;
    if (ok) await logEvent({ type: "whatsapp_sent", metadata: { test: true, target: `${phone.e164.slice(0, 4)}…` } });
    else await logEvent({ type: "whatsapp_failed", error_message: summary.pauseReason ?? item?.reason ?? "teste não enviado", metadata: { test: true } });

    return json({
      success: ok,
      sent: summary.sent,
      eventKey,
      ruleLabel,
      reason: ok
        ? isReminderTest
          ? `Teste da régua "${ruleLabel}" enviado — confira o formato como o cliente receberia.`
          : "Mensagem de teste enviada."
        : summary.pauseReason ?? item?.reason ?? "Não foi possível enviar o teste.",
      detail: summary,
    });
  } catch (error) {
    console.error("[WHATSAPP_TEST_ERROR]", error);
    return jsonError(error instanceof Error ? error.message : "Erro ao enviar a mensagem de teste.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/notifications/send-now — o botão "enviar lembrete"
//
// `dryRun: true` devolve a mensagem renderizada para a caixa de confirmação;
// sem ele, enfileira (idempotente) e despacha pelo mesmo caminho da fila.
// `force: true` envia mesmo sem opt-in registrado — decisão humana, registrada
// na auditoria.
// ---------------------------------------------------------------------------
app.post("/admin/notifications/send-now", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const cpf = String(body.cpf || "").replace(/\D/g, "");
  const billingId = String(body.billingId || "");
  /** Conta de origem da fatura (o Dashboard recebe de /admin/customer). */
  const connectionSlug = typeof body.connection === "string" ? body.connection.trim() : "";

  if (cpf.length !== 11) return jsonError("CPF inválido.", 400);
  if (!billingId) return jsonError("billingId é obrigatório.", 400);

  try {
    // MULTI-CONTA: a busca e a validação acontecem na conta INFORMADA; sem ela,
    // varre as ativas na ordem (compatível com chamadas antigas do painel).
    const connections = await activeMikWebConnections();
    if (!connections.length) return jsonError("Nenhuma conta MikWeb ativa — cadastre em Conexões.", 503);
    const ordered = connectionSlug
      ? [...connections].sort((a, b) => (a.slug === connectionSlug ? -1 : b.slug === connectionSlug ? 1 : 0))
      : connections;

    let customer: MikWebCustomer | null = null;
    let customerConnection: MikWebConnection | null = null;
    for (const connection of ordered) {
      try {
        const found = await mikwebApiGetFullFor<MikWebCustomer[]>(connection, `/customers?search=${cpf}`);
        const hit = (found.data ?? [])[0];
        if (hit) {
          customer = hit;
          customerConnection = connection;
          break;
        }
      } catch {
        // Conta fora do ar — tenta a próxima.
      }
    }
    if (!customer || !customerConnection) return jsonError("Cliente não encontrado.", 404);
    const connection = customerConnection;

    const billings = await mikwebApiGetFullFor<MikWebBilling[]>(connection, `/billings?customer_id=${customer.id}`);
    const billing = (billings.data ?? []).find((item) => String(item.id) === billingId);
    if (!billing) return jsonError("Fatura não encontrada para este cliente.", 404);

    // O ID PREFIXADO conecta o envio manual ao mesmo universo do sync: dedupe,
    // contatos e histórico ficam inequívocos entre contas.
    const prefixedCustomerIdValue = prefixedCustomerId(connection.slug, customer.id);
    const result = await whatsappRuntime().sendBilling({
      customer: { ...customer, id: prefixedCustomerIdValue } as MikWebCustomer & { id: string },
      billing: { ...billing, customer_id: prefixedCustomerIdValue } as MikWebBilling & { customer_id: string },
      ruleKey: typeof body.ruleKey === "string" && body.ruleKey ? body.ruleKey : "manual",
      dryRun: body.dryRun === true,
      force: body.force === true,
    });

    if (result.status === "sent") {
      await logEvent({
        type: "whatsapp_sent",
        cpf,
        customer_id: prefixedCustomerIdValue,
        customer_name: customer.full_name,
        metadata: { billingId, reference: billing.reference, ruleKey: result.dedupeKey, forced: result.forced, connection: connection.slug },
      });
    } else if (result.status !== "preview") {
      await logEvent({
        type: "whatsapp_skipped",
        cpf,
        customer_id: prefixedCustomerIdValue,
        customer_name: customer.full_name,
        error_message: result.reason,
        metadata: { billingId, status: result.status, connection: connection.slug },
      });
    }

    return json(result);
  } catch (error) {
    console.error("[SEND_NOW_ERROR]", error);
    return jsonError(error instanceof Error ? error.message : "Erro ao enviar o lembrete.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/notifications/deliveries — fila e histórico, com o "porquê" de cada linha
// ---------------------------------------------------------------------------
// Enriquecimento aditivo (sem migration): cada entrega ganha `ruleKey`/`ruleLabel`
// (régua de origem, extraída da dedupe_key do evento), `customerName` (mapa com
// whatsapp_contacts) e `reasonLabel` (frase legível do estado/agendamento).
// Aceita `rule=` para filtrar por régua e `search=` também casa nome do cliente.
// GET /api/admin/notifications/uncertain — envios com resultado INCERTO
// (NETWORK_UNCERTAIN): o timeout abortou a resposta, mas a mensagem PODE ter
// saído. A listagem existe para a conciliação manual — o sistema não chuta.
app.get("/admin/notifications/uncertain", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const runtime = whatsappRuntime();
  try {
    const rows = await runtime.outbox.listUncertain({ limit: 100 });
    const viewNow = now();
    return json({
      success: true,
      deliveries: rows.map((d) => toDeliveryView(d, { customerName: null, now: viewNow })),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Falha ao listar envios incertos.", 500);
  }
});

// POST /api/admin/notifications/uncertain/:id/resolve — conciliação com veredito
// humano: "sent" (a mensagem saiu — marca `sent`) ou "not_sent" (não saiu —
// volta para a fila com tentativas zeradas para o dispatcher reenviar).
app.post("/admin/notifications/uncertain/:id/resolve", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const id = c.req.param("id");
  let body: { outcome?: unknown; note?: unknown } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }
  const outcome = body.outcome === "sent" ? "sent" : body.outcome === "not_sent" ? "not_sent" : null;
  if (!outcome) return jsonError("outcome precisa ser \"sent\" ou \"not_sent\".", 400);
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;
  const runtime = whatsappRuntime();
  try {
    const row = await runtime.outbox.resolveUncertain({ deliveryId: id, outcome, note, now: now() });
    if (!row) return jsonError("Entrega não encontrada.", 404);
    return json({ success: true, delivery: toDeliveryView(row, { customerName: null, now: now() }) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Falha ao conciliar.", 500);
  }
});

app.get("/admin/notifications/deliveries", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const url = new URL(c.req.raw.url);
  const status = url.searchParams.get("status") || "all";
  const customerId = url.searchParams.get("customerId") || undefined;
  const rule = url.searchParams.get("rule")?.trim() || undefined;
  const search = url.searchParams.get("search")?.trim().toLowerCase() || undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50) || 50, 1), 500);
  const runtime = whatsappRuntime();

  try {
    const [rawDeliveries, stats] = await Promise.all([
      runtime.outbox.list({ limit: search ? 300 : limit, status: status as never, customerId }),
      runtime.outbox.stats({ since: now() - 7 * 24 * 60 * 60 * 1000 }),
    ]);

    // Mapa id → nome: uma única leitura de whatsapp_contacts para a página inteira.
    const customerIds = [
      ...new Set(rawDeliveries.map((d) => d.customerId).filter((v): v is string => !!v)),
    ];
    const namesById = new Map<string, string>();
    if (customerIds.length) {
      const { data: contactRows } = await db()
        .from("whatsapp_contacts")
        .select("customer_id, customer_name")
        .in("customer_id", customerIds);
      for (const row of (contactRows ?? []) as Array<{ customer_id: unknown; customer_name: unknown }>) {
        const id = row.customer_id == null ? null : String(row.customer_id);
        const name = row.customer_name == null ? null : String(row.customer_name).trim();
        if (id && name) namesById.set(id, name);
      }
    }

    const viewNow = now();
    let deliveries = rawDeliveries.map((d) =>
      toDeliveryView(d, { customerName: d.customerId ? namesById.get(d.customerId) ?? null : null, now: viewNow })
    );

    if (rule) {
      const wanted = rule === "manual" ? "manual" : rule;
      deliveries = deliveries.filter((d) => d.ruleKey === wanted);
    }
    if (search) {
      const q = search;
      deliveries = deliveries.filter((d) => {
        const target = (d.target || "").toLowerCase();
        const cid = (d.customerId || "").toLowerCase();
        const cpf = (d.cpf || "").replace(/\D/g, "");
        const rawCpf = (d.cpf || "").toLowerCase();
        const err = (d.errorMessage || "").toLowerCase();
        const name = (d.customerName || "").toLowerCase();
        return (
          target.includes(q) ||
          cid.includes(q) ||
          cpf.includes(q.replace(/\D/g, "")) ||
          rawCpf.includes(q) ||
          err.includes(q) ||
          name.includes(q)
        )
      }).slice(0, limit);
    }

    // EXPORT CSV — o dono audita os disparos fora do painel (planilha, contador).
    // Mesmos filtros da consulta; stream simples, sem paginação extra.
    if (url.searchParams.get("format") === "csv") {
      const esc = (value: unknown) => {
        const text = value === null || value === undefined ? "" : String(value);
        return `"${text.replace(/"/g, '""')}"`;
      };
      const header = [
        "id", "status", "canal", "cliente", "cpf", "destino", "regra", "motivo",
        "criado_em", "agendado_para", "enviado_em", "tentativas",
        "codigo_erro", "detalhe_erro",
      ];
      const lines = [header.join(",")];
      for (const d of deliveries) {
        lines.push(
          [
            d.id, d.status, d.channel, d.customerName ?? "", d.cpf ?? "", d.target,
            d.ruleKey ?? "", d.reasonLabel ?? "",
            d.createdAt ? new Date(d.createdAt).toISOString() : "",
            d.scheduledFor ? new Date(d.scheduledFor).toISOString() : "",
            d.sentAt ? new Date(d.sentAt).toISOString() : "",
            d.attempts ?? 0,
            d.errorKey ?? "", d.errorMessage ?? "",
          ]
            .map(esc)
            .join(",")
        );
      }
      const csv = "\uFEFF" + lines.join("\r\n"); // BOM: Excel abre acentos direito
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="mensagens-${civilDayBr(viewNow)}.csv"`,
        },
      });
    }

    return json({ deliveries, stats, ruleKeys: Object.keys(RULE_KEY_LABELS), migrationPending: false });
  } catch (error) {
    // Migration 003 pendente é o caso esperado aqui — devolve vazio, não 500.
    return json({ deliveries: [], stats: {}, ruleKeys: Object.keys(RULE_KEY_LABELS), migrationPending: true, error: error instanceof Error ? error.message : String(error) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/notifications/deliveries/retry — reenvia falhas ou selecionadas
//
// Coloca as entregas especificadas (ou todas as que falharam se allFailed: true) de
// volta em 'queued' com attempts resetados para 0, scheduled_for imediato, e
// opcionalmente executa o dispatch imediatamente (dispatchNow: true).
// ---------------------------------------------------------------------------
app.post("/admin/notifications/deliveries/retry", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string" && id) : [];
  const allFailed = body.allFailed === true;
  const dispatchNow = body.dispatchNow !== false;

  const currentNow = now();
  try {
    let targetIds = ids;
    if (allFailed && targetIds.length === 0) {
      const { data, error } = await db()
        .from("notification_deliveries")
        .select("id")
        .eq("status", "failed")
        .limit(100);
      if (error) throw error;
      targetIds = (data || []).map((row: Record<string, unknown>) => String(row.id));
    }

    if (!targetIds.length) {
      return json({ success: true, updated: 0, message: "Nenhuma entrega elegível para retry." });
    }

    // Atualiza status para 'queued', reseta attempts e programa para agora
    const { error: updateError } = await db()
      .from("notification_deliveries")
      .update({
        status: "queued",
        attempts: 0,
        scheduled_for: currentNow,
        error_key: null,
        error_message: null,
        status_at: currentNow,
      })
      .in("id", targetIds);

    if (updateError) throw updateError;

    let dispatchSummary = null;
    if (dispatchNow) {
      dispatchSummary = await whatsappRuntime().dispatch({
        ids: targetIds,
        policy: "manual",
        limit: Math.min(targetIds.length, 50),
      });
    }

    return json({
      success: true,
      updated: targetIds.length,
      dispatched: !!dispatchSummary,
      dispatchSummary,
    });
  } catch (error) {
    console.error("[DELIVERIES_RETRY_ERROR]", error);
    return jsonError(error instanceof Error ? error.message : "Erro ao reprocessar entregas.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/notifications/deliveries/cancel — cancela mensagens pendentes
// ---------------------------------------------------------------------------
app.post("/admin/notifications/deliveries/cancel", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === "string" && id) : [];
  const allQueued = body.allQueued === true;

  if (!ids.length && !allQueued) {
    return jsonError("Nenhum ID de entrega fornecido para cancelamento.", 400);
  }

  const currentNow = now();
  try {
    let query = db().from("notification_deliveries").update({
      status: "canceled",
      error_message: body.reason?.trim() || "Cancelado manualmente pelo administrador",
      status_at: currentNow,
    });

    if (allQueued && !ids.length) {
      query = query.eq("status", "queued");
    } else {
      query = query.in("id", ids).eq("status", "queued");
    }

    const { error: cancelError } = await query;
    if (cancelError) throw cancelError;

    return json({ success: true, count: ids.length });
  } catch (error) {
    console.error("[DELIVERIES_CANCEL_ERROR]", error);
    return jsonError(error instanceof Error ? error.message : "Erro ao cancelar entregas.", 500);
  }
});

app.get("/admin/install-requests", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const status = new URL(c.req.raw.url).searchParams.get("status") || undefined;
  let query = db().from("install_requests").select("*").order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  const { data: requests = [] } = await query;
  return json({
    requests,
    summary: {
      total: requests.length,
      pending: requests.filter((r) => r.status === "pending").length,
      approved: requests.filter((r) => r.status === "approved").length,
      rejected: requests.filter((r) => r.status === "rejected").length,
    },
  });
});

app.post("/admin/install-requests/:id/status", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const requestId = c.req.param("id");
  const body = await c.req.json();
  if (body.status !== "approved" && body.status !== "rejected") {
    return jsonError("Status inválido.");
  }

  const { data: current } = await db().from("install_requests").select("status, referral_code, full_name").eq("id", requestId).maybeSingle();

  const { error: updateError } = await db()
    .from("install_requests")
    .update({
      status: body.status,
      admin_note: body.adminNote?.trim() || null,
      reviewed_at: now(),
    })
    .eq("id", requestId);
  if (updateError) {
    console.error("[INSTALL_STATUS_ERROR]", updateError.message);
    return jsonError("Erro ao atualizar a solicitação.", 500);
  }

  // ---------------------------------------------------------------------
  // Programa de indicação: aprovar uma solicitação VINDA de link credita os
  // pontos do indicador. Idempotente no BANCO (unique parcial no ledger):
  // re-aprovar, duplo clique ou retry não duplica. Migration pendente ou
  // erro aqui NUNCA reverte a aprovação — o crédito é best-effort logado.
  // ---------------------------------------------------------------------
  if (body.status === "approved" && current?.referral_code && current.status !== "approved") {
    try {
      const referrer = await findActiveReferralCode(current.referral_code);
      if (referrer) {
        const config = await getReferralConfig();
        if (config.enabled && config.pointsPerApproved > 0) {
          const { error: creditError } = await db().rpc("credit_referral_points", {
            p_customer_ref: referrer.customer_ref,
            p_delta: config.pointsPerApproved,
            p_reason: `approval:${requestId}`,
            p_source_type: "approval",
            p_source_id: requestId,
            p_created_by: "admin",
          });
          if (creditError) {
            // 23505 aqui = crédito já lançado (re-aprovação) — não é erro.
            console.error("[REFERRAL_CREDIT_ERROR]", creditError.message);
          }
          // Aviso via WhatsApp pela MESMA outbox dos lembretes (mesma dedupe key
          // do crédito: aprovar 2× não credita e não reenvia). Best-effort:
          // falha aqui nunca reverte a aprovação nem o crédito.
          await enqueueReferralApprovedNotice(requestId, referrer, current.full_name, config.pointsPerApproved);
        }
      }
    } catch (err) {
      console.error("[REFERRAL_CREDIT_ERROR]", err);
    }
  }

  return json({ success: true });
});

// ===========================================================================
// ADMIN — programa de indicação (tabelas referral_*, migration 011)
// ===========================================================================

/**
 * Métricas do card do dashboard (indicações do mês, taxa de aprovação, pontos).
 * Leitura leve (mesmas consultas do /admin/referrals, sem devolver linhas) e
 * tolerante a migration 011 pendente: 200 + migrationPending, nunca 500 — o
 * dashboard não pode quebrar por causa de um card.
 */
app.get("/admin/referrals/stats", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const config = await getReferralConfig();
  if (config.migrationPending) return json({ migrationPending: true, metrics: null });
  try {
    const [requestsRes, ledgerRes, redemptionsRes] = await Promise.all([
      db()
        .from("install_requests")
        .select("status, created_at")
        .not("referral_code", "is", null)
        .order("created_at", { ascending: false })
        .limit(2000),
      db()
        .from("referral_points_ledger")
        .select("delta, customer_ref, created_at")
        .order("created_at", { ascending: false })
        .limit(5000),
      db()
        .from("referral_redemptions")
        .select("status, points_cost")
        .limit(2000),
    ]);
    const metrics = referralDashboardMetrics({
      referrals: (requestsRes.data ?? []) as Array<{ status: string; created_at: number }>,
      ledger: (ledgerRes.data ?? []) as Array<{ delta: number; customer_ref: string; created_at: number }>,
      redemptions: (redemptionsRes.data ?? []) as Array<{ status: string; points_cost: number }>,
    });
    return json({ migrationPending: false, metrics, programEnabled: config.enabled });
  } catch (err) {
    console.error("[REFERRAL_STATS_ERROR]", err);
    return jsonError("Erro ao calcular as métricas de indicações.", 500);
  }
});

/** Admin endpoints toleram migration 011 pendente: 200 + migrationPending. */
app.get("/admin/referrals", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const config = await getReferralConfig();
  if (config.migrationPending) return json({ migrationPending: true, referrals: [], rewards: [], redemptions: [] });

  try {
    const [codesRes, requestsRes, rewardsRes, ledgerRes, redemptionsRes] = await Promise.all([
      db().from("referral_codes").select("*").order("created_at", { ascending: false }).limit(500),
      db()
        .from("install_requests")
        .select("id, full_name, cpf, phone, status, referral_code, created_at, reviewed_at")
        .not("referral_code", "is", null)
        .order("created_at", { ascending: false })
        .limit(500),
      db().from("referral_rewards").select("*").order("sort_order").order("created_at"),
      db()
        .from("referral_points_ledger")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000),
      db()
        .from("referral_redemptions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300),
    ]);

    const codeToReferrer = new Map(
      (codesRes.data ?? []).map((row: { code: string; referrer_name: string; customer_ref: string }) => [row.code, row])
    );
    const referrals = (requestsRes.data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      referrer_name: codeToReferrer.get(String(row.referral_code))?.referrer_name ?? "(código não encontrado)",
      referrer_customer_ref: codeToReferrer.get(String(row.referral_code))?.customer_ref ?? null,
    }));

    const stats = referralStats({
      ledger: (ledgerRes.data ?? []) as ReferralLedgerRow[],
      redemptions: (redemptionsRes.data ?? []) as RedemptionRow[],
      referrals: (requestsRes.data ?? []) as InstallRequestReferralRow[],
    });
    return json({ migrationPending: false, referrals, rewards: rewardsRes.data ?? [], redemptions: redemptionsRes.data ?? [], ledger: ledgerRes.data ?? [], stats, config });
  } catch (err) {
    console.error("[ADMIN_REFERRALS_ERROR]", err);
    return jsonError("Erro ao carregar indicações.", 500);
  }
});

app.post("/admin/referrals/config", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const enabled = Boolean(body.enabled);
  const points = Math.round(Number(body.pointsPerApproved));
  if (!Number.isFinite(points) || points < 1 || points > 100000) {
    return jsonError("Pontos por aprovação deve ser entre 1 e 100000.");
  }
  const { error } = await db()
    .from("referral_config")
    .upsert(
      { id: "default", enabled, points_per_approved: points, updated_at: now(), updated_by: "admin" },
      { onConflict: "id" }
    );
  if (error) {
    console.error("[REFERRAL_CONFIG_ERROR]", error.message);
    return jsonError("Erro ao salvar a configuração (migration aplicada?).", 500);
  }
  return json({ success: true });
});

app.post("/admin/referrals/rewards", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const pointsCost = Math.round(Number(body.pointsCost));
  const kind = String(body.kind || "desconto");
  if (title.length < 2) return jsonError("Informe o título da recompensa.");
  if (!Number.isFinite(pointsCost) || pointsCost < 1) return jsonError("Custo em pontos deve ser maior que zero.");
  if (!isReferralRewardKind(kind)) return jsonError("Tipo inválido.");
  const { error } = await db().from("referral_rewards").insert({
    title: title.slice(0, 120),
    description: body.description ? String(body.description).trim().slice(0, 500) : null,
    points_cost: pointsCost,
    kind,
    active: body.active !== false,
    sort_order: Math.round(Number(body.sortOrder)) || 0,
    created_at: now(),
  });
  if (error) {
    console.error("[REFERRAL_REWARD_CREATE_ERROR]", error.message);
    return jsonError("Erro ao criar a recompensa.", 500);
  }
  return json({ success: true });
});

app.put("/admin/referrals/rewards/:id", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: now() };
  if (body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (title.length < 2) return jsonError("Informe o título da recompensa.");
    patch.title = title.slice(0, 120);
  }
  if (body.description !== undefined) patch.description = body.description ? String(body.description).trim().slice(0, 500) : null;
  if (body.pointsCost !== undefined) {
    const pointsCost = Math.round(Number(body.pointsCost));
    if (!Number.isFinite(pointsCost) || pointsCost < 1) return jsonError("Custo em pontos deve ser maior que zero.");
    patch.points_cost = pointsCost;
  }
  if (body.kind !== undefined) {
    if (!isReferralRewardKind(body.kind)) return jsonError("Tipo inválido.");
    patch.kind = String(body.kind);
  }
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.sortOrder !== undefined) patch.sort_order = Math.round(Number(body.sortOrder)) || 0;
  const { error } = await db().from("referral_rewards").update(patch).eq("id", id);
  if (error) {
    console.error("[REFERRAL_REWARD_UPDATE_ERROR]", error.message);
    return jsonError("Erro ao atualizar a recompensa.", 500);
  }
  return json({ success: true });
});

app.delete("/admin/referrals/rewards/:id", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const id = c.req.param("id");
  // Pedidos antigos referenciam a recompensa (FK RESTRICT + snapshot dos
  // campos): em vez de apagar, DESATIVA — histórico preservado.
  const { error } = await db().from("referral_rewards").update({ active: false, updated_at: now() }).eq("id", id);
  if (error) {
    console.error("[REFERRAL_REWARD_DELETE_ERROR]", error.message);
    return jsonError("Erro ao desativar a recompensa.", 500);
  }
  return json({ success: true, softDeleted: true });
});

app.post("/admin/referrals/redemptions/:id/decision", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const decision = String(body.decision || "");
  if (!("approved rejected applied".split(" ")).includes(decision)) return jsonError("Decisão inválida.");
  try {
    const { data: current } = await db().from("referral_redemptions").select("*").eq("id", id).maybeSingle();
    if (!current) return jsonError("Resgate não encontrado.", 404);
    if (!redemptionTransitionAllowed(current.status, decision)) {
      return jsonError(`Transição de status inválida: ${current.status} → ${decision}.`);
    }

    if (decision === "approved" || decision === "applied") {
      const { error } = await db()
        .from("referral_redemptions")
        .update({ status: decision, admin_note: body.adminNote?.trim() || current.admin_note || null, reviewed_at: now(), applied_at: decision === "applied" ? now() : current.applied_at })
        .eq("id", id);
      if (error) throw error;
      return json({ success: true });
    }

    // rejected: devolve os pontos via ledger (delta positivo, reason único por
    // resgate — idempotente pelo mesmo unique parcial).
    const { error } = await db()
      .from("referral_redemptions")
      .update({ status: "rejected", admin_note: body.adminNote?.trim() || current.admin_note || null, reviewed_at: now() })
      .eq("id", id);
    if (error) throw error;
    const { error: refundError } = await db().rpc("credit_referral_points", {
      p_customer_ref: current.customer_ref,
      p_delta: current.points_cost,
      p_reason: `refund:${id}`,
      p_source_type: "redemption",
      p_source_id: id,
      p_created_by: "admin",
    });
    if (refundError) console.error("[REFERRAL_REFUND_ERROR]", refundError.message);
    return json({ success: true, refunded: true });
  } catch (err) {
    console.error("[REFERRAL_DECISION_ERROR]", err);
    return jsonError("Erro ao processar a decisão.", 500);
  }
});

app.post("/admin/referrals/adjust", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const body = await c.req.json().catch(() => ({}));
  const customerRef = String(body.customerRef || "").trim();
  const delta = Math.round(Number(body.delta));
  const reason = String(body.reason || "").trim();
  if (!customerRef) return jsonError("Cliente não informado.");
  if (!Number.isFinite(delta) || delta === 0) return jsonError("Informe um ajuste diferente de zero.");
  if (reason.length < 3) return jsonError("Descreva o motivo do ajuste (obrigatório para auditoria).");

  const { error } = await db().rpc("credit_referral_points", {
    p_customer_ref: customerRef,
    p_delta: delta,
    p_reason: `admin:${reason.slice(0, 80)}`, // reason na chave de idempotência: mesmo ajuste re-enviado não duplica
    p_source_type: "admin_adjust",
    p_source_id: null,
    p_created_by: "admin",
  });
  if (error) {
    console.error("[REFERRAL_ADJUST_ERROR]", error.message);
    return jsonError("Erro ao registrar o ajuste.", 500);
  }
  return json({ success: true });
});

// ===========================================================================
// ROTAS INTERNAS: CRON E WEBHOOK
// ===========================================================================

// ---------------------------------------------------------------------------
// /api/cron/notify-sync — enfileira os avisos do dia a partir da base real
//
// É o par do cron de dispatch: este enfileira, aquele envia. Agendar UMA vez por dia,
// antes da janela de envio abrir (ex.: 8h, com o cron de dispatch rodando a cada
// 5–15 min). Sem ele, o pipeline automático simplesmente não existe — quem enfileirava
// era o botão do painel.
//
// O que entra na fila é decidido pelo mesmo núcleo puro do simulador (régua, alcance,
// payload), então o relatório de `/admin/notifications/simulate` continua sendo a
// previsão honesta do que sai. Quem aplica cota, janela e time-lock é o dispatcher, na
// hora de enviar.
//
// Query: `days` (1..horizonte, default 1), `dryRun=1` (planeja e responde, sem gravar),
//        `from=YYYY-MM-DD` (dia alvo), `item-limit` (itens no resumo),
//        `limit-customers`/`max-pages` (varredura da MikWeb).
// ---------------------------------------------------------------------------
app.on(["GET", "POST"], "/cron/notify-sync", async (c) => {
  if (!(await requireCron(c.req.raw))) return jsonError("Não autorizado.", 401);

  const url = new URL(c.req.raw.url);
  const body = c.req.method === "POST" ? await c.req.json().catch(() => ({})) : {};
  const raw = (name: string) => body[name] ?? url.searchParams.get(name);
  const int = (name: string, fallback: number) => {
    const value = Number(raw(name));
    return Number.isFinite(value) ? value : fallback;
  };

  const from = raw("from") === null || raw("from") === undefined || raw("from") === "" ? undefined : String(raw("from"));
  if (from !== undefined && !isCivilDate(from)) return jsonError("`from` deve estar no formato YYYY-MM-DD.", 400);

  try {
    const dryRunRequested = raw("dryRun") === "1" || raw("dryRun") === true;
    /** A base que o sync carregou — o resumo diário agrega sobre ela, sem re-ler a MikWeb. */
    let loadedBase: LoadedBase | null = null;
    const summary = await whatsappRuntime().sync({
      from,
      days: Math.min(Math.max(int("days", 1), 1), 60),
      dryRun: dryRunRequested,
      itemLimit: Math.min(Math.max(int("item-limit", 50), 1), 500),
      loadBase: async (window) => {
        const base = await loadSyncBase(
          { db, listConnections: listMikWebConnections, apiGetFor: mikwebApiGetFullFor },
          {
            dueFrom: window.dueFrom,
            dueTo: window.dueTo,
            limitCustomers: Math.min(Math.max(int("limit-customers", 25), 1), 200),
            // Mesmo default do simulador: a MikWeb limita o per_page de /customers e
            // 10 páginas não cobriam a base — os avisos caíam em `no_customer`.
            maxPages: Math.min(Math.max(int("max-pages", 50), 1), 50),
          }
        );
        loadedBase = base;
        return base;
      },
    });

    console.log(`[NOTIFY_SYNC] ${describeSync(summary)}`);

    // MULTI-CONTA: uma conta que falhou na varredura é um problema de operação
    // (faturas dela não entraram na régua de hoje) — o admin é avisado pelo
    // mesmo canal dos outros alertas, com cooldown/anti-spam já embutido.
    const failedConnections = (loadedBase?.connections ?? []).filter((item) => !item.ok);
    if (!dryRunRequested && failedConnections.length) {
      try {
        const runtime = whatsappRuntime();
        const loaded = await runtime.getSettings();
        const alerts = loaded.settings.adminAlerts;
        if (alerts.phone) {
          const detail = failedConnections
            .map((item) => `${item.label || item.slug}: ${(item.error ?? "erro").slice(0, 120)}`)
            .join(" | ");
          await sendAdminAlert(
            {
              db,
              getWhatsAppConfig: () => runtime.getConfig(),
              sendPushToAdmins,
              log: (message, extra) => console.log(`[ADMIN_ALERT] ${message}`, extra ?? ""),
            },
            {
              key: "channel-down",
              config: alerts,
              title: "Conta MikWeb falhou",
              message: [
                `⚠️ Conta MikWeb falhou na sincronização de hoje.`,
                `Conta(s): ${detail}`,
                `Os lembretes das OUTRAS contas saíram normalmente.`,
                `Abra o painel → Conexões → verifique a conta (botão Testar).`,
              ].join("\n"),
              phone: alerts.phone,
              now: Date.now(),
              buttons: resolveButtons(alerts.buttons, loaded.settings.portalBaseUrl, "/admin/connections"),
            }
          );
        }
      } catch (alertError) {
        console.error("[ADMIN_ALERT_ERROR]", alertError);
      }
    }

    // Resumo diário de cobranças para o admin — a mesma varredura que enfileirou
    // os lembretes agrega vencem hoje / vencidas 1–5 / vencidas 6+ / próximos dias.
    // Uma vez por dia civil; best-effort: nunca derruba o sync.
    if (!dryRunRequested && loadedBase?.billings?.length) {
      try {
        {
          const runtime = whatsappRuntime();
          const loaded = await runtime.getSettings();
          const alerts = loaded.settings.adminAlerts;
          if (alerts.dailySummary && alerts.phone) {
            const state = await db().from("admin_alerts_state").select("state").eq("key", "default").maybeSingle();
            const lastAt = Number((state.data as { state?: Record<string, unknown> } | null)?.state?.["daily-summary"] ?? 0);
            const nowMs = Date.now();
            if (shouldSendDailySummary(lastAt > 0 ? lastAt : null, nowMs)) {
              const buckets = aggregateBillings(loadedBase.billings, civilDayBr(nowMs));
              await sendAdminAlert(
                {
                  db,
                  getWhatsAppConfig: () => runtime.getConfig(),
                  sendPushToAdmins,
                  log: (message, extra) => console.log(`[ADMIN_ALERT] ${message}`, extra ?? ""),
                },
                {
                  key: "daily-summary",
                  config: { ...alerts, alertDispatchFailures: true },
                  title: "Resumo de cobranças",
                  message: buildDailySummaryMessage({ buckets, at: nowMs }),
                  phone: alerts.phone,
                  now: nowMs,
                  buttons: adminAlertButtons(alerts, loaded.settings.portalBaseUrl, "/admin/simulator"),
                }
              );
            }
          }
        }
      } catch (error) {
        console.error("[ADMIN_DAILY_SUMMARY_ERROR]", error);
      }
    }

    // RESUMO SEMANAL de disparos — uma vez a cada 7 dias, mesma varredura, mesmo
    // canal dos alertas. Autonomia: o dono abre a semana sabendo entregue/lido/
    // falha/opt-out sem abrir o painel. Best-effort como o resto do cron.
    if (!dryRunRequested) {
      try {
        const runtime = whatsappRuntime();
        const loaded = await runtime.getSettings();
        const alerts = loaded.settings.adminAlerts;
        if (alerts.dailySummary && alerts.phone) {
          const state = await db().from("admin_alerts_state").select("state").eq("key", "default").maybeSingle();
          const lastAt = Number((state.data as { state?: Record<string, unknown> } | null)?.state?.["weekly-summary"] ?? 0);
          const nowMs = Date.now();
          if (shouldSendWeeklySummary(lastAt > 0 ? lastAt : null, nowMs)) {
            const since = nowMs - 7 * 24 * 60 * 60 * 1000;
            const stats = await runtime.outbox.stats({ since });
            let uncertain = 0;
            try {
              uncertain = (await runtime.outbox.listUncertain({ limit: 100 })).length;
            } catch {
              uncertain = 0;
            }
            let optOuts = 0;
            try {
              const { count } = await db()
                .from("whatsapp_contacts")
                .select("customer_id", { count: "exact", head: true })
                .gt("opt_out_at", since);
              optOuts = Number(count ?? 0);
            } catch {
              optOuts = 0;
            }
            await sendAdminAlert(
              {
                db,
                getWhatsAppConfig: () => runtime.getConfig(),
                sendPushToAdmins,
                log: (message, extra) => console.log(`[ADMIN_ALERT] ${message}`, extra ?? ""),
              },
              {
                key: "weekly-summary",
                config: { ...alerts, alertDispatchFailures: true },
                title: "Resumo semanal de lembretes",
                message: buildWeeklySummaryMessage({
                  stats: {
                    sent: Number(stats["sent"] ?? 0) + Number(stats["delivered"] ?? 0) + Number(stats["read"] ?? 0),
                    delivered: Number(stats["delivered"] ?? 0) + Number(stats["read"] ?? 0),
                    read: Number(stats["read"] ?? 0),
                    failed: Number(stats["failed"] ?? 0),
                    optOuts,
                    uncertain,
                  },
                  at: nowMs,
                }),
                phone: alerts.phone,
                now: nowMs,
                buttons: adminAlertButtons(alerts, loaded.settings.portalBaseUrl, "/admin/messages"),
              }
            );
          }
        }
      } catch (error) {
        console.error("[ADMIN_WEEKLY_SUMMARY_ERROR]", error);
      }
    }

    return json(summary);
  } catch (error) {
    if (error instanceof MikWebNotConfigured) return jsonError(error.message, 400);
    console.error("[NOTIFY_SYNC_ERROR]", error);
    return jsonError("Erro ao enfileirar os avisos do dia.", 500);
  }
});

// ---------------------------------------------------------------------------
// /api/cron/notify-dispatch — drena a fila de notificações
//
// Roda com o secret de cron (`x-cron-secret` ou `?secret=`) ou com um admin
// autenticado. Agendar a cada 5–15 min (ver LEMBRETES-WHATSAPP.md §8).
// ---------------------------------------------------------------------------
app.on(["GET", "POST"], "/cron/notify-dispatch", async (c) => {
  if (!(await requireCron(c.req.raw))) return jsonError("Não autorizado.", 401);

  const url = new URL(c.req.raw.url);
  const body = c.req.method === "POST" ? await c.req.json().catch(() => ({})) : {};
  const requested = Number(body.limit ?? url.searchParams.get("limit") ?? 10);
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 10, 1), 50);
  const channel = url.searchParams.get("channel") === "push" || body.channel === "push" ? "push" : "whatsapp";
  const rawPolicy = body.policy ?? url.searchParams.get("policy");
  const policy = rawPolicy === "manual" ? "manual" : "automated";

  try {
    const summary = await whatsappRuntime().dispatch({ limit, channel, policy });
    if (summary.paused) console.warn("[NOTIFY_DISPATCH_PAUSED]", summary.pauseReason);
    // Alertas ao admin só no modo automatizado: o clique manual no painel não deve
    // ganhar latência de verificação de canal (e quem clicou já está olhando).
    if (policy === "automated") await runOperationAlertChecks(summary);
    return json(summary);
  } catch (error) {
    console.error("[NOTIFY_DISPATCH_ERROR]", error);
    return jsonError("Erro ao processar a fila de notificações.", 500);
  }
});

// ---------------------------------------------------------------------------
// /api/cron/whatsapp-import-contacts — reimporta opt-ins da MikWeb (diário)
//
// Mantém `whatsapp_contacts` em dia com a base: clientes novos entram, telefone
// alterado é atualizado. Política idêntica ao botão do painel (mesmo núcleo,
// `importMikwebContacts`): opt-out vence sempre e registro existente NUNCA é
// reativado — este job não transforma não-consentido em consentido.
//
// Agendar UMA vez por dia (antes do notify-sync, para o alcance do dia já ver os
// contatos novos): `x-cron-secret` no header. Idempotente: rodar duas vezes não
// duplica nem desfaz nada.
// ---------------------------------------------------------------------------
app.on(["GET", "POST"], "/cron/whatsapp-import-contacts", async (c) => {
  if (!(await requireCron(c.req.raw))) return jsonError("Não autorizado.", 401);

  const url = new URL(c.req.raw.url);
  const body = c.req.method === "POST" ? await c.req.json().catch(() => ({})) : {};
  const raw = (name: string) => body[name] ?? url.searchParams.get(name);
  const maxPages = Math.min(Math.max(Number(raw("max-pages") ?? 30) || 30, 1), 100);

  try {
    const result = await importMikwebContacts({ dryRun: false, maxPages });
    const plan = result.plan as { scanned: number; newContacts: number; updates: number };
    await logEvent({
      type: "whatsapp_opt_in",
      metadata: { action: "cron-import-contacts", scanned: plan.scanned, newContacts: plan.newContacts, updates: plan.updates },
    });
    console.log(`[WHATSAPP_IMPORT_CRON] scanned=${plan.scanned} new=${plan.newContacts} updates=${plan.updates}`);
    return json({ success: true, ...result });
  } catch (error) {
    if (error instanceof MikWebNotConfigured) return jsonError(error.message, 400);
    console.error("[WHATSAPP_IMPORT_CRON_ERROR]", error);
    return jsonError("Erro ao reimportar os contatos da MikWeb.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/uazapi — status de entrega e opt-out
//
// Público (a função é deployada com --no-verify-jwt), protegido pelo secret
// `UAZAPI_WEBHOOK_SECRET`. Sem secret configurado ele aceita: é o que permite
// testar antes de subir o secret — e aparece como aviso nos logs.
// ---------------------------------------------------------------------------
app.post("/webhooks/uazapi", async (c) => {
  if (!webhookAuthorized(c.req.raw)) return jsonError("Não autorizado.", 401);
  if (!env("UAZAPI_WEBHOOK_SECRET")) {
    console.warn("[WHATSAPP_WEBHOOK] UAZAPI_WEBHOOK_SECRET não configurado; webhook aceitando qualquer origem.");
  }

  const body = await c.req.json().catch(() => null);
  try {
    const summary = await handleUazapiWebhook({
      db,
      outbox: whatsappRuntime().outbox,
      log: (message, extra) => console.log(`[WHATSAPP_WEBHOOK] ${message}`, extra ?? ""),
    }, body);
    return json({ success: true, ...summary });
  } catch (error) {
    console.error("[WHATSAPP_WEBHOOK_ERROR]", error);
    // 200 mesmo em erro: a UazAPI não deve ficar reenviando o mesmo evento.
    return json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// ===========================================================================
// PUBLIC + PUSH ROUTES
// ===========================================================================

app.post("/public/install-request", async (c) => {
  const request = c.req.raw;
  try {
    const body = await request.json();
    // Honeypot — bots fill hidden "website" field
    if (body.website && String(body.website).trim().length > 0) {
      return json({ success: true });
    }
    if (!checkRateLimit(`install:${getClientIp(request)}`)) {
      return jsonError("Muitas solicitações. Tente novamente mais tarde.", 429);
    }

    const fullName = String(body.fullName || "").trim();
    const cpf = String(body.cpf || "").replace(/\D/g, "");
    const phone = String(body.phone || "").replace(/\D/g, "");

    if (fullName.length < 3) return jsonError("Informe seu nome completo.");
    if (cpf.length !== 11) return jsonError("CPF inválido.");
    if (phone.length < 10) return jsonError("Telefone inválido.");
    if (!body.agreedToTerms) return jsonError("É necessário aceitar os termos.");

    // Helper: validate and cap base64 photo (max ~800KB encoded ≈ ~600KB raw)
    const MAX_PHOTO_BYTES = 800_000;
    const sanitizePhoto = (val: unknown): string | null => {
      if (typeof val !== "string" || !val.startsWith("data:image/")) return null;
      // Strip the data-URL prefix, keep only the base64 part
      const base64 = val.split(",")[1] || "";
      if (base64.length > MAX_PHOTO_BYTES) return null; // too large
      return val;
    };

    // ---------------------------------------------------------------------
    // Indicação: valida o código do link (?ref=). Falha de validação NUNCA
    // bloqueia a solicitação — o lead não pode pagar por link quebrado.
    // ---------------------------------------------------------------------
    let referralCode: string | null = null;
    const normalizedRef = normalizeReferralCode(body.referralCode);
    if (normalizedRef) {
      try {
        const referrer = await findActiveReferralCode(normalizedRef);
        // Auto-indicação: mesmo CPF no formulário e no código → salva sem vínculo.
        if (referrer && referrer.referrer_cpf !== cpf) {
          referralCode = normalizedRef;
        }
      } catch (err) {
        console.error("[REFERRAL_VALIDATE_ERROR]", err);
      }
    }

    await insertInstallRequest(
      {
        full_name: fullName.slice(0, 200),
        cpf,
        phone,
        email: body.email || null,
        zip_code: body.zipCode || null,
        street: body.street || null,
        number: body.number || null,
        complement: body.complement || null,
        neighborhood: body.neighborhood || null,
        city: body.city || null,
        state: body.state || null,
        desired_plan: body.desiredPlan || null,
        message: body.message || null,
        photo_house_front: sanitizePhoto(body.photoHouseFront),
        photo_street: sanitizePhoto(body.photoStreet),
        photo_id_front: sanitizePhoto(body.photoIdFront),
        photo_id_back: sanitizePhoto(body.photoIdBack),
        agreed_to_terms: true,
        ip_address: getClientIp(request),
        status: "pending",
        created_at: now(),
      },
      referralCode
    );
    return json({ success: true });
  } catch (err) {
    console.error("[INSTALL_REQUEST_ERROR]", err);
    return jsonError("Erro ao registrar solicitação.", 500);
  }
});

// ---------------------------------------------------------------------------
// PÚBLICO — programa de indicação
// ---------------------------------------------------------------------------

/**
 * Valida o código do link (?ref=) para o banner da landing. Devolve SOMENTE o
 * primeiro nome (LGPD — nada de CPF, telefone ou id interno no payload público).
 */
app.get("/public/referral/:code", async (c) => {
  const code = normalizeReferralCode(c.req.param("code"));
  if (!code) return jsonError("Código de indicação inválido.", 404);
  try {
    const row = await findActiveReferralCode(code);
    if (!row) return jsonError("Código de indicação não encontrado ou inativo.", 404);
    return json({ valid: true, firstName: publicFirstName(row.referrer_name) });
  } catch (err) {
    console.error("[REFERRAL_PUBLIC_ERROR]", err);
    return jsonError("Erro ao validar o código de indicação.", 500);
  }
});

/**
 * Catálogo público das recompensas ATIVAS (para a página do cliente). Campos
 * de gestão (sort_order, created_at) não saem daqui.
 */
app.get("/public/referral-catalog", async () => {
  const config = await getReferralConfig();
  if (config.migrationPending) return json({ migrationPending: true, rewards: [], enabled: false });
  try {
    const { data, error } = await db()
      .from("referral_rewards")
      .select("id, title, description, points_cost, kind")
      .eq("active", true)
      .order("sort_order")
      .order("points_cost");
    if (error) throw error;
    return json({ migrationPending: false, enabled: config.enabled, rewards: data ?? [] });
  } catch (err) {
    console.error("[REFERRAL_CATALOG_ERROR]", err);
    return jsonError("Erro ao carregar o catálogo.", 500);
  }
});

// ---------------------------------------------------------------------------
// CLIENTE — programa de indicação (sessão)
// ---------------------------------------------------------------------------

app.get("/referrals/me", async (c) => {
  const session = await requireSession(c.req.raw);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  const config = await getReferralConfig();
  if (config.migrationPending) {
    // Migration 011 pendente: flag declarada, nunca 500.
    return json({ migrationPending: true, referral: null });
  }

  const customerRef = session.customer_id;
  try {
    const code = await ensureReferralCode(customerRef, session.customer_name, session.cpf);
    // Link de compartilhamento aponta para o PORTAL (settings), nunca para a
    // origem da Edge Function (supabase.co/functions — daria "requested path
    // is invalid" ao abrir).
    const settingsLoaded = await whatsappRuntime().getSettings().catch(() => null);
    const portalBaseUrl = settingsLoaded?.settings.portalBaseUrl ?? "https://minhasupernet.com";
    const companyName = settingsLoaded?.settings.companyName ?? "MinhaSuperNet";

    const [ledgerRes, redemptionsRes, referralsRes] = await Promise.all([
      db()
        .from("referral_points_ledger")
        .select("created_at, customer_ref, delta, reason, source_type, source_id")
        .eq("customer_ref", customerRef)
        .order("created_at", { ascending: true })
        .limit(500),
      db()
        .from("referral_redemptions")
        .select("*")
        .eq("customer_ref", customerRef)
        .order("created_at", { ascending: false })
        .limit(100),
      db()
        .from("install_requests")
        .select("id, full_name, cpf, status, referral_code, created_at")
        .eq("referral_code", code ?? "__none__")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const view = buildReferralMeView(
      {
        codeRow: code ? { code, customer_ref: customerRef, referrer_name: session.customer_name, active: true } : null,
        ledger: (ledgerRes.data ?? []) as ReferralLedgerRow[],
        redemptions: (redemptionsRes.data ?? []) as RedemptionRow[],
        referrals: (referralsRes.data ?? []) as InstallRequestReferralRow[],
      },
      portalBaseUrl,
      companyName,
      config.pointsPerApproved
    );
    // `enabled` no payload: o painel do cliente (aviso do dashboard) só promove o
    // programa enquanto ele estiver ligado na configuração.
    return json({ migrationPending: false, referral: view, enabled: config.enabled });
  } catch (err) {
    console.error("[REFERRALS_ME_ERROR]", err);
    return jsonError("Erro ao carregar o programa de indicações.", 500);
  }
});

app.post("/referrals/redeem", async (c) => {
  const session = await requireSession(c.req.raw);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  const body = await c.req.json().catch(() => ({}));
  const rewardId = typeof body.rewardId === "string" ? body.rewardId : "";
  if (!rewardId) return jsonError("Recompensa não informada.");

  const config = await getReferralConfig();
  if (config.migrationPending) return jsonError("Programa de indicações ainda não configurado.", 503);
  if (!config.enabled) return jsonError("Programa de indicações desativado.", 403);

  try {
    const { data, error } = await db().rpc("redeem_referral_reward", {
      p_customer_ref: session.customer_id,
      p_reward_id: rewardId,
      p_customer_name: session.customer_name,
    });
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("Saldo insuficiente")) return jsonError("Saldo insuficiente para esta recompensa.");
      if (msg.includes("Recompensa indisponível")) return jsonError("Esta recompensa não está mais disponível.");
      if (msg.includes("não encontrada")) return jsonError("Recompensa não encontrada.", 404);
      throw error;
    }
    const result = (typeof data === "string" ? JSON.parse(data) : data) as { redemptionId: string; balance: number; duplicate?: boolean };
    const balance = await referralBalance(session.customer_id);
    return json({ success: true, redemptionId: result.redemptionId, balance, duplicate: Boolean(result.duplicate) });
  } catch (err) {
    console.error("[REFERRALS_REDEEM_ERROR]", err);
    return jsonError("Erro ao registrar o resgate. Tente novamente.", 500);
  }
});

app.post("/push/subscribe", async (c) => {
  const request = c.req.raw;
  const session = await requireSession(request);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  const body = await c.req.json();
  if (!body.endpoint || !body.keys) return jsonError("Dados incompletos.", 400);

  {
    const { error } = await db().from("push_subscriptions").upsert(
      {
        endpoint: body.endpoint,
        keys: body.keys,
        session_token: session.session_token,
        cpf: session.cpf,
        customer_id: session.customer_id,
        customer_name: session.customer_name,
        user_agent: body.userAgent || null,
        created_at: now(),
      },
      { onConflict: "endpoint" }
    );
    if (error) {
      console.error("[PUSH_SUBSCRIBE_ERROR]", error.message);
      return jsonError("Erro ao salvar inscrição push.", 500);
    }
  }
  return json({ success: true });
});

app.post("/push/unsubscribe", async (c) => {
  const body = await c.req.json();
  if (!body.endpoint) return jsonError("Endpoint não informado.", 400);
  await db().from("push_subscriptions").delete().eq("endpoint", body.endpoint);
  return json({ success: true });
});

app.post("/push/test", async (c) => {
  const request = c.req.raw;
  const session = await requireSession(request);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  const { data: subs } = await db()
    .from("push_subscriptions")
    .select("endpoint, keys")
    .eq("session_token", session.session_token);

  if (!subs || subs.length === 0) {
    return json({ success: false, error: "Nenhuma inscrição push para esta sessão." });
  }

  const { sent, failed } = await sendPushToSubs(subs, {
    title: "Notificação de teste",
    body: `Olá, ${session.customer_name}! As notificações estão funcionando.`,
    tag: "test",
  });

  if (sent === 0) {
    return json({ success: false, error: "Falha ao enviar. Verifique as chaves VAPID." });
  }
  return json({ success: true, sent, failed });
});

// ---------------------------------------------------------------------------
// Fallback 404
// ---------------------------------------------------------------------------
app.notFound(() => jsonError("Rota não encontrada.", 404));

Deno.serve(app.fetch);

// Exporta o app Hono para harnesses locais (deno test / supabase functions serve
// local via Deno.serve). Em produção o Deno.serve acima é o entrypoint.
export default app;
