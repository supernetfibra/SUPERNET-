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
 *   - Admin session:    header  `x-admin-token: <token>` (or `?token=`)
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
import { addDays, civilToday, isCivilDate, normalizeBrMobile } from "./notify/model.ts";
import { generateDemoBase, type DemoScenario } from "./notify/demo-data.ts";
import { loadRealBase, loadSyncBase, MikWebNotConfigured, type LoadedBase } from "./notify/sources.ts";
import { describeSync } from "./notify/sync.ts";
import { runSimulation } from "./notify/simulate.ts";
import { applyOverrides } from "./notify/settings-store.ts";
import { MAX_RULES, RULE_EVENT_KEYS, defaultDocument } from "./notify/settings.ts";
import { maskToken } from "./notify/config.ts";
import { createUazapiClient } from "./notify/uazapi.ts";
import { createWhatsAppRuntime } from "./notify/runtime.ts";
import { handleUazapiWebhook } from "./notify/webhook.ts";

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function env(name: string, fallback = ""): string {
  // Supabase edge functions inject SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  // automatically; all custom secrets come through Deno.env.get too.
  return Deno.env.get(name) ?? fallback;
}

function getAdminPassword(): string {
  return env("MIKWEB_ADMIN_PASSWORD", "slackware@");
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

function getAdminSessionToken(request: Request): string | null {
  return (
    request.headers.get("x-admin-token") ||
    extractCookie(request, "mikweb_admin_session")
  ) || (() => {
    try {
      return new URL(request.url).searchParams.get("token");
    } catch {
      return null;
    }
  })();
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

async function mikwebApiGet<T>(path: string, override?: { baseUrl?: string; token?: string }): Promise<T> {
  const config = override?.baseUrl && override?.token
    ? { baseUrl: override.baseUrl, token: override.token }
    : await getMikWebConfig();
  if (!config) throw new Error("MikWeb API não configurada.");

  const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`MikWeb API error (${response.status}): ${body.slice(0, 200) || response.statusText}`);
  }
  const parsed: Record<string, unknown> = await response.json();
  const dataKey = Object.keys(parsed).find((k) => k !== "meta");
  return (dataKey ? parsed[dataKey] : parsed) as T;
}

async function mikwebApiGetFull<T>(
  path: string
): Promise<{ data: T; meta?: { pages?: { total_pages?: number } } }> {
  const config = await getMikWebConfig();
  if (!config) throw new Error("MikWeb API não configurada.");

  const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
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
    let customers: MikWebCustomer[];
    try {
      customers = await mikwebApiGet<MikWebCustomer[]>(`/customers?search=${cpf}`);
    } catch (err) {
      await logEvent({ type: "login_failure", cpf, ip_address: clientIp, user_agent: userAgent, error_message: String(err).slice(0, 200) });
      return jsonError("CPF não encontrado. Verifique e tente novamente.", 404);
    }
    if (!customers?.length) {
      await logEvent({ type: "login_failure", cpf, ip_address: clientIp, user_agent: userAgent, error_message: "CPF não encontrado" });
      return jsonError("CPF não encontrado. Verifique e tente novamente.", 404);
    }

    const customer = customers[0];

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
      const full = await mikwebApiGet<MikWebCustomer>(`/customers/${customer.id}`);
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
      customer_id: String(customer.id),
      customer_name: customer.full_name,
      contacts: contacts.map((ct) => ({ id: ct.id, phone: ct.phone, label: ct.label })),
      selected_contact_id: null,
      created_at: now(),
      expires_at: now() + maxAge * 1000,
      last_activity_at: now(),
    });

    await logEvent({
      type: "login_success", cpf, customer_id: String(customer.id),
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
    const customer = await mikwebApiGet<MikWebCustomer>(`/customers/${session.customer_id}`);
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
    const params = new URLSearchParams({ customer_id: session.customer_id });
    if (yearFilter) {
      params.set("date_from", `${yearFilter}-01-01`);
      params.set("date_to", `${yearFilter}-12-31`);
    }
    const basePath = `/billings?${params.toString()}`;

    while (page <= totalPages && page <= 6) {
      const { data, meta } = await mikwebApiGetFull<MikWebBilling[]>(
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

  // Real users: proxy to MikWeb
  try {
    const config = await getMikWebConfig();
    if (!config) return jsonError("MikWeb API não configurada.", 500);

    const url = `${config.baseUrl.replace(/\/$/, "")}/billings/${billingId}/download?valid=true`;
    const pdfResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${config.token}` },
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

app.get("/admin/audit-logs", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const url = new URL(c.req.raw.url);
  const type = url.searchParams.get("type") || undefined;
  const cpf = url.searchParams.get("cpf") || undefined;

  let query = db().from("mikweb_audit_log").select("*").order("timestamp", { ascending: false }).limit(100);
  if (type && type !== "all") query = query.eq("type", type);
  if (cpf) query = query.eq("cpf", cpf);
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
    const customers = await mikwebApiGet<MikWebCustomer[]>(`/customers?search=${cpf}`);
    if (!customers?.length) return jsonError("Cliente não encontrado.", 404);
    const customer = customers[0];
    const billings = await mikwebApiGet<MikWebBilling[]>(`/billings?customer_id=${customer.id}`);
    const { password: _pw, ...safeCustomer } = customer;
    return json({ customer: safeCustomer, billings });
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
  });
}

function uazapiClientFrom(config: { baseUrl: string; instanceToken: string; adminToken: string }) {
  return createUazapiClient({
    baseUrl: config.baseUrl,
    token: config.instanceToken,
    adminToken: config.adminToken,
  });
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
        { db, getConfig: getMikWebConfig, apiGetFull: mikwebApiGetFull },
        {
          from: today,
          // Horizonte da configuração (ou do override) define a janela varrida.
          to: addDays(today, settings.horizonDays - 1),
          limitCustomers: Math.min(Math.max(int("limit-customers", 25), 1), 200),
          maxPages: Math.min(Math.max(int("max-pages", 10), 1), 50),
          assumeOptIn: optInParam === "auto" ? "table" : (optInParam as "all" | "none"),
          assumePush: pushParam === "auto" ? "table" : (pushParam as "all" | "none"),
        }
      );
    }

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
      },
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
  });
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

  try {
    // `data_hora` no fuso do projeto (UTC-3), sem depender de ICU do runtime.
    const localStamp = new Date(now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
    const enqueued = await runtime.outbox.enqueue({
      eventKey: "test",
      dedupeKey: `test:${phone.e164}:${now()}`,
      customerId: null,
      cpf: null,
      payload: { data_hora: localStamp, nome: "Teste", primeiro_nome: "Teste" },
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
      reason: ok ? "Mensagem de teste enviada." : summary.pauseReason ?? item?.reason ?? "Não foi possível enviar o teste.",
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

  if (cpf.length !== 11) return jsonError("CPF inválido.", 400);
  if (!billingId) return jsonError("billingId é obrigatório.", 400);

  try {
    const customers = await mikwebApiGet<MikWebCustomer[]>(`/customers?search=${cpf}`);
    if (!customers?.length) return jsonError("Cliente não encontrado.", 404);
    const customer = customers[0]!;

    const billings = await mikwebApiGet<MikWebBilling[]>(`/billings?customer_id=${customer.id}`);
    const billing = (billings || []).find((item) => String(item.id) === billingId);
    if (!billing) return jsonError("Fatura não encontrada para este cliente.", 404);

    const result = await whatsappRuntime().sendBilling({
      customer,
      billing,
      ruleKey: typeof body.ruleKey === "string" && body.ruleKey ? body.ruleKey : "manual",
      dryRun: body.dryRun === true,
      force: body.force === true,
    });

    if (result.status === "sent") {
      await logEvent({
        type: "whatsapp_sent",
        cpf,
        customer_id: String(customer.id),
        customer_name: customer.full_name,
        metadata: { billingId, reference: billing.reference, ruleKey: result.dedupeKey, forced: result.forced },
      });
    } else if (result.status !== "preview") {
      await logEvent({
        type: "whatsapp_skipped",
        cpf,
        customer_id: String(customer.id),
        customer_name: customer.full_name,
        error_message: result.reason,
        metadata: { billingId, status: result.status },
      });
    }

    return json(result);
  } catch (error) {
    console.error("[SEND_NOW_ERROR]", error);
    return jsonError(error instanceof Error ? error.message : "Erro ao enviar o lembrete.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/notifications/deliveries — fila e histórico
// ---------------------------------------------------------------------------
app.get("/admin/notifications/deliveries", async (c) => {
  if (!(await requireAdmin(c.req.raw))) return jsonError("Não autorizado.", 401);
  const url = new URL(c.req.raw.url);
  const status = url.searchParams.get("status") || "all";
  const customerId = url.searchParams.get("customerId") || undefined;
  const search = url.searchParams.get("search")?.trim().toLowerCase() || undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50) || 50, 1), 500);
  const runtime = whatsappRuntime();

  try {
    const [rawDeliveries, stats] = await Promise.all([
      runtime.outbox.list({ limit: search ? 300 : limit, status: status as never, customerId }),
      runtime.outbox.stats({ since: now() - 7 * 24 * 60 * 60 * 1000 }),
    ]);

    // Opcionalmente associa o nome do cliente a partir de whatsapp_contacts ou evento
    let deliveries = rawDeliveries;
    if (search) {
      const q = search;
      deliveries = rawDeliveries.filter((d) => {
        const target = (d.target || "").toLowerCase();
        const cid = (d.customerId || "").toLowerCase();
        const cpf = (d.cpf || "").replace(/\D/g, "");
        const rawCpf = (d.cpf || "").toLowerCase();
        const err = (d.errorMessage || "").toLowerCase();
        return (
          target.includes(q) ||
          cid.includes(q) ||
          cpf.includes(q.replace(/\D/g, "")) ||
          rawCpf.includes(q) ||
          err.includes(q)
        );
      }).slice(0, limit);
    }

    return json({ deliveries, stats, migrationPending: false });
  } catch (error) {
    // Migration 003 pendente é o caso esperado aqui — devolve vazio, não 500.
    return json({ deliveries: [], stats: {}, migrationPending: true, error: error instanceof Error ? error.message : String(error) });
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
  await db()
    .from("install_requests")
    .update({
      status: body.status,
      admin_note: body.adminNote?.trim() || null,
      reviewed_at: now(),
    })
    .eq("id", requestId);
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
    const summary = await whatsappRuntime().sync({
      from,
      days: Math.min(Math.max(int("days", 1), 1), 60),
      dryRun: raw("dryRun") === "1" || raw("dryRun") === true,
      itemLimit: Math.min(Math.max(int("item-limit", 50), 1), 500),
      loadBase: (window) =>
        loadSyncBase(
          { db, getConfig: getMikWebConfig, apiGetFull: mikwebApiGetFull },
          {
            dueFrom: window.dueFrom,
            dueTo: window.dueTo,
            limitCustomers: Math.min(Math.max(int("limit-customers", 25), 1), 200),
            maxPages: Math.min(Math.max(int("max-pages", 10), 1), 50),
          }
        ),
    });

    console.log(`[NOTIFY_SYNC] ${describeSync(summary)}`);
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
    return json(summary);
  } catch (error) {
    console.error("[NOTIFY_DISPATCH_ERROR]", error);
    return jsonError("Erro ao processar a fila de notificações.", 500);
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

    await insertOrThrow("install_requests", {
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
    });
    return json({ success: true });
  } catch (err) {
    console.error("[INSTALL_REQUEST_ERROR]", err);
    return jsonError("Erro ao registrar solicitação.", 500);
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
app.notFound((c) => jsonError("Rota não encontrada.", 404));

Deno.serve(app.fetch);
