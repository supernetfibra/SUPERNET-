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
