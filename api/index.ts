/**
 * Freebuff Desktop — Hono API Backend
 *
 * Replaces Convex HTTP endpoints. Runs as a Vercel serverless function.
 * Uses Supabase for database and MikWeb API for external integration.
 *
 * Routes mirror the original Convex HTTP endpoints:
 *   POST   /api/mikweb/login
 *   POST   /api/mikweb/logout
 *   GET    /api/mikweb/me
 *   GET    /api/mikweb/customer
 *   POST   /api/mikweb/select-contact
 *   GET    /api/mikweb/billings
 *   GET    /api/mikweb/billings/:id/download
 *   POST   /api/mikweb/action
 *   POST   /api/admin/login
 *   POST   /api/admin/logout
 *   GET    /api/admin/verify
 *   GET    /api/admin/config
 *   POST   /api/admin/config
 *   GET    /api/admin/branding
 *   POST   /api/admin/branding
 *   POST   /api/admin/test-connection
 *   GET    /api/admin/audit-logs
 *   GET    /api/admin/customer
 *   GET    /api/admin/sessions
 *   POST   /api/admin/sessions/revoke
 *   POST   /api/admin/push
 *   GET    /api/admin/install-requests
 *   POST   /api/admin/install-requests/:id/status
 *   POST   /api/public/install-request
 *   POST   /api/push/subscribe
 *   POST   /api/push/unsubscribe
 *   POST   /api/push/test
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Supabase server client (inline to avoid import path issues in Vercel)
// ---------------------------------------------------------------------------
let _serverClient: SupabaseClient | null = null;

function getSupabaseServerClient(): SupabaseClient {
  if (_serverClient) return _serverClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  }
  _serverClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _serverClient;
}

const app = new Hono().basePath("/api");

// ---------------------------------------------------------------------------
// CORS — allow the frontend origin
// ---------------------------------------------------------------------------
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    const first5 = digits.slice(2, 7);
    return `(${ddd}) ${first5}**-${last}`;
  }
  const first4 = digits.slice(2, 6);
  return `(${ddd}) ${first4}**-${last}`;
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

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function jsonError(error: string, status = 400): Response {
  return json({ error }, status);
}

function setCookie(
  name: string,
  value: string,
  maxAge: number,
  options?: { httpOnly?: boolean; secure?: boolean }
): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Strict",
  ];
  if (options?.httpOnly !== false) parts.push("HttpOnly");
  if (options?.secure !== false) parts.push("Secure");
  return parts.join("; ");
}

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory — per function invocation)
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
// Test user config
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
    pix_copy_paste_base64: "000201010212261060014br.gov.bcb.pix2558api.pix.com/v2/cobv/12345678901234567890123456785204000053039865406129.905802BR5913Cliente Teste6009Sao Paulo62070503***63041234",
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
    pix_copy_paste_base64: "000201010212261060014br.gov.bcb.pix2558api.pix.com/v2/cobv/12345678901234567890123456785204000053039865406129.905802BR5913Cliente Teste6009Sao Paulo62070503***63041235",
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
// Supabase helpers
// ---------------------------------------------------------------------------
function db() {
  return getSupabaseServerClient();
}

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
      metadata: event.metadata,
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
    .single();
  if (!data) return null;
  if (data.expires_at < now()) return null;
  return data;
}

async function getAdminSession(sessionToken: string) {
  const { data } = await db()
    .from("mikweb_admin_sessions")
    .select("*")
    .eq("session_token", sessionToken)
    .single();
  if (!data) return null;
  if (data.expires_at < now()) return null;
  return data;
}

// ---------------------------------------------------------------------------
// MikWeb API integration (replaces convex/mikweb.ts actions)
// ---------------------------------------------------------------------------

interface MikWebCustomer {
  id: number;
  full_name: string;
  login: string;
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
  pix_copy_paste_base64?: string;
  pix_qr_code_image_base64?: string;
  our_number?: number;
  fine_amount?: number;
  interest_amount?: number;
}

async function getMikWebConfig(): Promise<{ baseUrl: string; token: string } | null> {
  // Priority 1: Environment variables
  const envUrl = process.env.MIKWEB_API_URL;
  const envToken = process.env.MIKWEB_API_TOKEN;
  if (envUrl && envToken) return { baseUrl: envUrl, token: envToken };

  // Priority 2: Database config
  try {
    const { data } = await db()
      .from("mikweb_config")
      .select("api_url, api_token")
      .eq("key", "default")
      .single();
    if (data && data.api_url && data.api_token) {
      return { baseUrl: data.api_url, token: data.api_token };
    }
  } catch {}

  return null;
}

async function mikwebApiGet<T>(path: string): Promise<T> {
  const config = await getMikWebConfig();
  if (!config) {
    throw new Error(
      "MikWeb API não configurada. Configure no painel de administração."
    );
  }

  const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `MikWeb API error (${response.status}): ${errorBody || response.statusText}`
    );
  }

  const json: Record<string, unknown> = await response.json();
  const dataKey = Object.keys(json).find((k) => k !== "meta");
  return (dataKey ? json[dataKey] : json) as T;
}

async function mikwebApiGetFull<T>(
  path: string
): Promise<{ data: T; meta?: any }> {
  const config = await getMikWebConfig();
  if (!config) {
    throw new Error("MikWeb API não configurada.");
  }

  const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `MikWeb API error (${response.status}): ${errorBody || response.statusText}`
    );
  }

  const json: Record<string, unknown> = await response.json();
  const meta = json.meta as any;
  const dataKey = Object.keys(json).find((k) => k !== "meta");
  const data = (dataKey ? json[dataKey] : json) as T;
  return { data, meta };
}

// ---------------------------------------------------------------------------
// Admin auth middleware
// ---------------------------------------------------------------------------
function getAdminSessionToken(request: Request): string | null {
  const cookie = extractCookie(request, "mikweb_admin_session");
  if (cookie) return cookie;
  try {
    const url = new URL(request.url);
    return url.searchParams.get("token");
  } catch {
    return null;
  }
}

async function requireAdmin(request: Request): Promise<boolean> {
  const token = getAdminSessionToken(request);
  if (!token) return false;
  const session = await getAdminSession(token);
  return session !== null;
}

// ===========================================================================
// ROUTES
// ===========================================================================

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

    if (!rawCpf || !password) {
      return jsonError("CPF e senha são obrigatórios.");
    }

    const cpf = rawCpf.replace(/\D/g, "");
    const rateLimitKey = `${clientIp}:${cpf}`;
    if (!checkRateLimit(rateLimitKey)) {
      return jsonError("Muitas tentativas. Tente novamente em 15 minutos.", 429);
    }

    // ---- TEST USER ----
    if (isTestCpf(cpf)) {
      const testPassword = cpf.slice(0, 4);
      const normalizedPassword = password.replace(/\D/g, "");
      if (normalizedPassword !== testPassword) {
        return jsonError(
          "Senha incorreta. Use os 4 primeiros dígitos do seu CPF como senha inicial.",
          401
        );
      }

      const mockContacts = [
        { id: `${MOCK_TEST_CUSTOMER.id}-phone`, phone: MOCK_TEST_CUSTOMER.phone_number, label: "Telefone" },
        { id: `${MOCK_TEST_CUSTOMER.id}-cell1`, phone: MOCK_TEST_CUSTOMER.cell_phone_number_1, label: "Celular 1" },
      ];

      const keep = keepConnected === true;
      const sessionMaxAge = keep ? 7 * 24 * 60 * 60 : 24 * 60 * 60;
      const sessionToken = generateSessionToken();
      const expiresAt = now() + sessionMaxAge * 1000;

      await db().from("mikweb_sessions").insert({
        session_token: sessionToken,
        cpf,
        customer_id: getTestCustomerId(cpf),
        customer_name: MOCK_TEST_CUSTOMER.full_name,
        contacts: mockContacts,
        selected_contact_id: null,
        created_at: now(),
        expires_at: expiresAt,
        last_activity_at: now(),
      });

      const h = new Headers({ "Content-Type": "application/json" });
      h.append("Set-Cookie", setCookie("mikweb_session", sessionToken, sessionMaxAge));

      return new Response(
        JSON.stringify({
          success: true,
          customer: { id: getTestCustomerId(cpf), name: MOCK_TEST_CUSTOMER.full_name, email: MOCK_TEST_CUSTOMER.email },
          hasMultipleContacts: mockContacts.length > 1,
          contacts: mockContacts.map((c) => ({ id: c.id, label: c.label, phoneMasked: maskPhone(c.phone) })),
          sessionToken,
          expiresAt,
        }),
        { status: 200, headers: h }
      );
    }

    // ---- REAL USER ----
    let customers: MikWebCustomer[];
    try {
      customers = await mikwebApiGet<MikWebCustomer[]>(`/customers?search=${cpf}`);
    } catch {
      await logEvent({ type: "login_failure", cpf, ip_address: clientIp, user_agent: userAgent, error_message: "CPF não encontrado" });
      return jsonError("CPF não encontrado. Verifique e tente novamente.", 404);
    }

    if (!customers || customers.length === 0) {
      return jsonError("CPF não encontrado. Verifique e tente novamente.", 404);
    }

    const customer = customers[0];

    // Get contacts
    let contacts: Array<{ id: string; phone: string; label?: string }> = [];
    try {
      const full = await mikwebApiGet<MikWebCustomer>(`/customers/${customer.id}`);
      if (full.phone_number) contacts.push({ id: `${customer.id}-phone`, phone: full.phone_number, label: "Telefone" });
      const cellFields = ["cell_phone_number_1", "cell_phone_number_2", "cell_phone_number_3", "cell_phone_number_4"] as const;
      for (const key of cellFields) {
        const phone = full[key];
        if (typeof phone === "string" && phone) {
          const label = key === "cell_phone_number_1" ? "Celular 1" : key.replace("cell_phone_number_", "Celular ");
          contacts.push({ id: `${customer.id}-${key}`, phone, label });
        }
      }
    } catch {}

    // Validate password (first 4 digits of CPF)
    const cpfDigits = cpf;
    const normalizedPassword = password.replace(/\D/g, "");
    if (normalizedPassword !== cpfDigits.slice(0, 4)) {
      await logEvent({ type: "login_failure", cpf, customer_id: String(customer.id), customer_name: customer.full_name, ip_address: clientIp, user_agent: userAgent, error_message: "Senha incorreta" });
      return jsonError("Senha incorreta. Use os 4 primeiros dígitos do seu CPF como senha inicial.", 401);
    }

    const sessionContacts = contacts.map((c) => ({ id: c.id, phone: c.phone, label: c.label }));
    const keep2 = keepConnected === true;
    const sessionMaxAge2 = keep2 ? 7 * 24 * 60 * 60 : 24 * 60 * 60;
    const sessionToken2 = generateSessionToken();
    const expiresAt2 = now() + sessionMaxAge2 * 1000;

    await db().from("mikweb_sessions").insert({
      session_token: sessionToken2,
      cpf,
      customer_id: String(customer.id),
      customer_name: customer.full_name,
      contacts: sessionContacts,
      selected_contact_id: null,
      created_at: now(),
      expires_at: expiresAt2,
      last_activity_at: now(),
    });

    console.log(`[LOGIN_SUCCESS] CPF: ${cpf}, Customer: ${customer.full_name}, Duration: ${now() - startTime}ms`);

    await logEvent({
      type: "login_success",
      cpf,
      customer_id: String(customer.id),
      customer_name: customer.full_name,
      ip_address: clientIp,
      user_agent: userAgent,
      metadata: { duration: now() - startTime },
    });

    const h2 = new Headers({ "Content-Type": "application/json" });
    h2.append("Set-Cookie", setCookie("mikweb_session", sessionToken2, sessionMaxAge2));

    return new Response(
      JSON.stringify({
        success: true,
        customer: { id: String(customer.id), name: customer.full_name, email: customer.email },
        hasMultipleContacts: contacts.length > 1,
        contacts: contacts.map((c) => ({ id: c.id, label: c.label || "Contato", phoneMasked: maskPhone(c.phone) })),
        sessionToken: sessionToken2,
        expiresAt: expiresAt2,
      }),
      { status: 200, headers: h2 }
    );
  } catch (err) {
    console.error("[LOGIN_ERROR]", err);
    await logEvent({ type: "login_failure", ip_address: clientIp, user_agent: userAgent, error_message: String(err) });
    return jsonError("Erro interno. Tente novamente mais tarde.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/mikweb/logout
// ---------------------------------------------------------------------------
app.post("/mikweb/logout", async (c) => {
  const request = c.req.raw;
  try {
    const sessionToken = extractCookie(request, "mikweb_session");
    if (sessionToken) {
      const session = await getSession(sessionToken);
      if (session) {
        await logEvent({ type: "logout", cpf: session.cpf, customer_id: session.customer_id, customer_name: session.customer_name, ip_address: getClientIp(request) });
      }
      await db().from("mikweb_sessions").delete().eq("session_token", sessionToken);
    }

    const h = new Headers({ "Content-Type": "application/json" });
    h.append("Set-Cookie", setCookie("mikweb_session", "", 0));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: h });
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
  try {
    const sessionToken = extractCookie(request, "mikweb_session");
    if (!sessionToken) {
      return json({ authenticated: false }, 401);
    }

    const session = await getSession(sessionToken);
    if (!session) {
      const h = new Headers({ "Content-Type": "application/json" });
      h.append("Set-Cookie", setCookie("mikweb_session", "", 0));
      return new Response(JSON.stringify({ authenticated: false, error: "Sessão expirada." }), { status: 401, headers: h });
    }

    // Touch session
    await db().from("mikweb_sessions").update({ last_activity_at: now() }).eq("session_token", sessionToken);

    return json({
      authenticated: true,
      customer: { id: session.customer_id, name: session.customer_name, cpf: session.cpf },
    });
  } catch (err) {
    console.error("[ME_ERROR]", err);
    return json({ authenticated: false, error: "Erro ao verificar sessão." }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/mikweb/customer
// ---------------------------------------------------------------------------
app.get("/mikweb/customer", async (c) => {
  const request = c.req.raw;
  try {
    const sessionToken = extractCookie(request, "mikweb_session");
    if (!sessionToken) return jsonError("Sessão não encontrada.", 401);

    const session = await getSession(sessionToken);
    if (!session) return jsonError("Sessão expirada.", 401);

    await db().from("mikweb_sessions").update({ last_activity_at: now() }).eq("session_token", sessionToken);

    if (isTestCustomerId(session.customer_id)) {
      return json({ customer: MOCK_TEST_CUSTOMER });
    }

    const customer = await mikwebApiGet<MikWebCustomer>(`/customers/${session.customer_id}`);
    if (!customer) return jsonError("Cliente não encontrado na API MikWeb.", 404);
    return json({ customer });
  } catch (err) {
    console.error("[CUSTOMER_ERROR]", err);
    return jsonError(`Erro ao buscar dados do cliente: ${err}`, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/mikweb/select-contact
// ---------------------------------------------------------------------------
app.post("/mikweb/select-contact", async (c) => {
  const request = c.req.raw;
  try {
    const sessionToken = extractCookie(request, "mikweb_session");
    if (!sessionToken) return jsonError("Sessão não encontrada.", 401);

    const body = await request.json();
    if (!body.contactId) return jsonError("Contato não especificado.", 400);

    await db().from("mikweb_sessions").update({ selected_contact_id: body.contactId, last_activity_at: now() }).eq("session_token", sessionToken);
    return json({ success: true });
  } catch (err) {
    console.error("[SELECT_CONTACT_ERROR]", err);
    return jsonError("Erro ao selecionar contato.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/mikweb/billings
// ---------------------------------------------------------------------------
app.get("/mikweb/billings", async (c) => {
  const request = c.req.raw;
  try {
    const sessionToken = extractCookie(request, "mikweb_session");
    if (!sessionToken) return jsonError("Sessão não encontrada.", 401);

    const session = await getSession(sessionToken);
    if (!session) return jsonError("Sessão expirada.", 401);

    await db().from("mikweb_sessions").update({ last_activity_at: now() }).eq("session_token", sessionToken);

    const url = new URL(request.url);
    const yearFilter = url.searchParams.get("year") || undefined;

    if (isTestCustomerId(session.customer_id)) {
      return json({ billings: MOCK_TEST_BILLINGS, customerId: session.customer_id });
    }

    // Fetch billings with pagination
    const allBillings: MikWebBilling[] = [];
    let page = 1;
    let totalPages = 1;
    const MAX_PAGES = 6;

    const params = new URLSearchParams();
    params.set("customer_id", session.customer_id);
    if (yearFilter) {
      params.set("date_from", `${yearFilter}-01-01`);
      params.set("date_to", `${yearFilter}-12-31`);
    }
    const basePath = `/billings?${params.toString()}`;

    while (page <= totalPages && page <= MAX_PAGES) {
      const pagePath = page === 1 ? basePath : `${basePath}&page=${page}`;
      const { data, meta } = await mikwebApiGetFull<MikWebBilling[]>(pagePath);
      if (data && Array.isArray(data)) allBillings.push(...data);
      if (meta?.pages) totalPages = meta.pages.total_pages;
      else break;
      page++;
    }

    return json({ billings: allBillings, customerId: session.customer_id });
  } catch (err) {
    console.error("[BILLINGS_ERROR]", err);
    return json({ error: "Erro ao buscar faturas.", billings: [] });
  }
});

// ---------------------------------------------------------------------------
// GET /api/mikweb/billings/:id/download
// ---------------------------------------------------------------------------
app.get("/mikweb/billings/:id/download", async (c) => {
  const request = c.req.raw;
  try {
    const sessionToken = extractCookie(request, "mikweb_session");
    if (!sessionToken) return jsonError("Sessão não encontrada.", 401);
    const session = await getSession(sessionToken);
    if (!session) return jsonError("Sessão expirada.", 401);

    const billingId = c.req.param("id");
    if (!billingId) return jsonError("ID da fatura não informado.", 400);

    const config = await getMikWebConfig();
    if (!config) return jsonError("MikWeb API não configurada.", 500);

    const url = `${config.baseUrl.replace(/\/$/, "")}/billings/${billingId}/download?valid=true`;
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${config.token}` } });
    if (!response.ok) return jsonError("Boleto não disponível.", 404);

    return new Response(null, { status: 302, headers: { Location: url } });
  } catch (err) {
    console.error("[BILLING_DOWNLOAD_ERROR]", err);
    return jsonError("Erro ao baixar PDF.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/mikweb/action
// ---------------------------------------------------------------------------
app.post("/mikweb/action", async (c) => {
  const request = c.req.raw;
  const CUSTOMER_ACTIONS = ["barcode_copied", "pix_copied", "pdf_viewed"];

  try {
    const sessionToken = extractCookie(request, "mikweb_session");
    if (!sessionToken) return jsonError("Sessão não encontrada.", 401);
    const session = await getSession(sessionToken);
    if (!session) return jsonError("Sessão expirada.", 401);

    const body = await request.json();
    if (!body.action || !CUSTOMER_ACTIONS.includes(body.action)) {
      return jsonError("Ação inválida.", 400);
    }

    await logEvent({
      type: body.action,
      cpf: session.cpf,
      customer_id: session.customer_id,
      customer_name: session.customer_name,
      ip_address: getClientIp(request),
      user_agent: getUserAgent(request),
      metadata: { billingId: body.billingId ?? null, reference: body.reference ?? null, value: typeof body.value === "number" ? body.value : null },
    });

    return json({ success: true });
  } catch (err) {
    console.error("[CUSTOMER_ACTION_LOG_ERROR]", err);
    return json({ success: true }); // Fire-and-forget
  }
});

// ===========================================================================
// ADMIN ROUTES
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /api/admin/login
// ---------------------------------------------------------------------------
app.post("/admin/login", async (c) => {
  const request = c.req.raw;
  try {
    const body = await request.json();
    const { password } = body as { password: string };
    if (!password) return jsonError("Senha obrigatória.");

    const adminPassword = process.env.MIKWEB_ADMIN_PASSWORD || "slackware@";
    if (password !== adminPassword) {
      return jsonError("Senha de administrador incorreta.", 401);
    }

    const sessionToken = generateSessionToken();
    const expiresAt = now() + 8 * 60 * 60 * 1000;

    await db().from("mikweb_admin_sessions").insert({
      session_token: sessionToken,
      created_at: now(),
      expires_at: expiresAt,
      last_activity_at: now(),
    });

    const h = new Headers({ "Content-Type": "application/json" });
    h.append("Set-Cookie", setCookie("mikweb_admin_session", sessionToken, 8 * 60 * 60));
    return new Response(
      JSON.stringify({ success: true, sessionToken, expiresAt }),
      { status: 200, headers: h }
    );
  } catch {
    return jsonError("Senha de administrador incorreta.", 401);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/logout
// ---------------------------------------------------------------------------
app.post("/admin/logout", async (c) => {
  const request = c.req.raw;
  try {
    const token = getAdminSessionToken(request);
    if (token) {
      await db().from("mikweb_admin_sessions").delete().eq("session_token", token);
    }
    const h = new Headers({ "Content-Type": "application/json" });
    h.append("Set-Cookie", setCookie("mikweb_admin_session", "", 0));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: h });
  } catch {
    return jsonError("Erro ao fazer logout.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/verify
// ---------------------------------------------------------------------------
app.get("/admin/verify", async (c) => {
  const request = c.req.raw;
  const token = getAdminSessionToken(request);
  if (!token) return json({ authenticated: false }, 401);
  const session = await getAdminSession(token);
  if (!session) {
    const h = new Headers({ "Content-Type": "application/json" });
    h.append("Set-Cookie", setCookie("mikweb_admin_session", "", 0));
    return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: h });
  }
  return json({ authenticated: true });
});

// ---------------------------------------------------------------------------
// GET /api/admin/config
// ---------------------------------------------------------------------------
app.get("/admin/config", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const { data } = await db().from("mikweb_config").select("*").eq("key", "default").single();
    if (!data) return json({ apiUrl: "", hasToken: false, updatedAt: 0 });
    return json({
      apiUrl: data.api_url,
      apiToken: data.api_token ? `${data.api_token.slice(0, 4)}...${data.api_token.slice(-4)}` : "",
      hasToken: !!data.api_token,
      providerName: data.provider_name,
      logoUrl: data.logo_url,
      updatedAt: data.updated_at,
    });
  } catch {
    return jsonError("Erro ao ler configuração.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/config
// ---------------------------------------------------------------------------
app.post("/admin/config", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const body = await request.json();
    const { apiUrl, apiToken } = body as { apiUrl: string; apiToken: string };
    if (!apiToken) return jsonError("Token é obrigatório.");

    await db().from("mikweb_config").upsert({
      key: "default",
      api_url: apiUrl || "",
      api_token: apiToken,
      updated_at: now(),
    }, { onConflict: "key" });

    return json({ success: true });
  } catch {
    return jsonError("Erro ao salvar configuração.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/branding
// ---------------------------------------------------------------------------
app.get("/admin/branding", async (c) => {
  try {
    const { data } = await db().from("mikweb_config").select("provider_name, logo_url").eq("key", "default").single();
    return json({ providerName: data?.provider_name || "Seu Provedor", logoUrl: data?.logo_url || "" });
  } catch {
    return json({ providerName: "Seu Provedor", logoUrl: "" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/branding
// ---------------------------------------------------------------------------
app.post("/admin/branding", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const body = await request.json();
    const { providerName, logoUrl } = body as { providerName: string; logoUrl: string };
    if (!providerName?.trim()) return jsonError("Nome do provedor é obrigatório.");

    await db().from("mikweb_config").upsert({
      key: "default",
      api_url: "",
      api_token: "",
      provider_name: providerName.trim(),
      logo_url: logoUrl || "",
      updated_at: now(),
    }, { onConflict: "key" });

    return json({ success: true });
  } catch {
    return jsonError("Erro ao salvar marca.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/test-connection
// ---------------------------------------------------------------------------
app.post("/admin/test-connection", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const body = await request.json();
    const { apiUrl, apiToken } = body as { apiUrl: string; apiToken: string };
    const url = `${apiUrl.replace(/\/$/, "")}/customers`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    });
    return json({ success: response.ok, statusCode: response.status, message: response.ok ? "Conexão bem-sucedida!" : `Erro HTTP ${response.status}` });
  } catch (err) {
    return json({ success: false, message: "Erro ao testar conexão." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/audit-logs
// ---------------------------------------------------------------------------
app.get("/admin/audit-logs", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || undefined;
    const cpf = url.searchParams.get("cpf") || undefined;

    let query = db().from("mikweb_audit_log").select("*").order("timestamp", { ascending: false }).limit(100);
    if (type && type !== "all") query = query.eq("type", type);
    if (cpf) query = query.eq("cpf", cpf);

    const { data: logs = [] } = await query;

    // Summary
    const { data: allLogs = [] } = await db().from("mikweb_audit_log").select("type, cpf, timestamp").order("timestamp", { ascending: false }).limit(500);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = todayStart.getTime();
    const weekAgo = now() - 7 * 24 * 60 * 60 * 1000;

    const summary = {
      totalLogins: allLogs.filter((l) => l.type === "login_success").length,
      totalFailures: allLogs.filter((l) => l.type === "login_failure").length,
      totalRateLimited: allLogs.filter((l) => l.type === "login_rate_limited").length,
      totalBillingErrors: allLogs.filter((l) => l.type === "billing_error").length,
      todayLogins: allLogs.filter((l) => l.type === "login_success" && l.timestamp >= todayTs).length,
      todayFailures: allLogs.filter((l) => l.type === "login_failure" && l.timestamp >= todayTs).length,
      last7DaysLogins: allLogs.filter((l) => l.type === "login_success" && l.timestamp >= weekAgo).length,
      last7DaysFailures: allLogs.filter((l) => l.type === "login_failure" && l.timestamp >= weekAgo).length,
      uniqueCpfs: new Set(allLogs.filter((l) => l.type === "login_success").map((l) => l.cpf)).size,
    };

    return json({ logs, summary });
  } catch {
    return json({ logs: [], summary: null });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/customer?cpf=...
// ---------------------------------------------------------------------------
app.get("/admin/customer", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const url = new URL(request.url);
    const cpf = (url.searchParams.get("cpf") || "").replace(/\D/g, "");
    if (cpf.length !== 11) return jsonError("CPF inválido. Informe os 11 dígitos.");

    const customers = await mikwebApiGet<MikWebCustomer[]>(`/customers?search=${cpf}`);
    if (!customers || customers.length === 0) return jsonError("Cliente não encontrado.", 404);

    const customer = customers[0];
    const billings = await mikwebApiGet<MikWebBilling[]>(`/billings?customer_id=${customer.id}`);

    const { password: _pw, ...safeCustomer } = customer as any;

    const isVencido = (s: string) => s === "Vencido" || s === "Em Atraso";
    billings.sort((a: any, b: any) => {
      const aV = isVencido(a.situation_name || "");
      const bV = isVencido(b.situation_name || "");
      if (aV && !bV) return -1;
      if (!aV && bV) return 1;
      return (b.due_day || "").localeCompare(a.due_day || "");
    });

    return json({ customer: safeCustomer, billings });
  } catch (err) {
    console.error("[ADMIN_CUSTOMER_ERROR]", err);
    return jsonError("Erro ao consultar cliente.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/sessions
// ---------------------------------------------------------------------------
app.get("/admin/sessions", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const { data: sessions = [] } = await db()
      .from("mikweb_sessions")
      .select("id, cpf, customer_id, customer_name, created_at, expires_at, last_activity_at")
      .order("last_activity_at", { ascending: false })
      .limit(50);

    const enriched = sessions.map((s) => ({
      sessionId: s.id,
      cpf: s.cpf,
      customerId: s.customer_id,
      customerName: s.customer_name,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      lastActivityAt: s.last_activity_at,
      isActive: s.expires_at > now(),
    }));

    return json({ sessions: enriched });
  } catch {
    return jsonError("Erro ao listar sessões.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/sessions/revoke
// ---------------------------------------------------------------------------
app.post("/admin/sessions/revoke", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const body = await request.json();
    if (!body.sessionId) return jsonError("sessionId é obrigatório.");

    // Get session to find token for push sub cleanup
    const { data: session } = await db().from("mikweb_sessions").select("session_token").eq("id", body.sessionId).single();
    if (session) {
      await db().from("push_subscriptions").delete().eq("session_token", session.session_token);
    }
    await db().from("mikweb_sessions").delete().eq("id", body.sessionId);
    return json({ success: true });
  } catch {
    return jsonError("Erro ao revogar sessão.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/push
// ---------------------------------------------------------------------------
app.post("/admin/push", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const body = await request.json();
    const { title, body: pushBody, cpf } = body as { title?: string; body?: string; cpf?: string };
    if (!title || !pushBody) return jsonError("Título e mensagem são obrigatórios.");

    // Get subscriptions
    let query = db().from("push_subscriptions").select("endpoint, keys");
    if (cpf) query = query.eq("cpf", cpf.replace(/\D/g, ""));
    const { data: subs = [] } = await query;

    if (subs.length === 0) {
      return json({ success: false, error: "Nenhum dispositivo inscrito.", sent: 0 });
    }

    // Send push via web-push
    const VAPID_PUBLIC = process.env.VITE_VAPID_PUBLIC_KEY || "";
    const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return json({ success: false, error: "VAPID keys não configuradas.", sent: 0 });
    }

    const webPush = (await import("web-push")).default;
    webPush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@portal.com", VAPID_PUBLIC, VAPID_PRIVATE);

    let sent = 0;
    let failed = 0;
    for (const sub of subs) {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({ title, body: pushBody, tag: cpf ? `billing-${cpf}` : "broadcast" }),
          { TTL: 86400, urgency: "high" as const }
        );
        sent++;
      } catch {
        failed++;
      }
    }

    return json({ success: sent > 0, sent, failed });
  } catch {
    return jsonError("Erro ao enviar notificação.", 500);
  }
});

// ===========================================================================
// PUBLIC ROUTES
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /api/public/install-request
// ---------------------------------------------------------------------------
app.post("/public/install-request", async (c) => {
  const request = c.req.raw;
  try {
    const clientIp = getClientIp(request);
    const body = await request.json();

    // Honeypot
    if (body.website && String(body.website).trim().length > 0) {
      return json({ success: true }); // Silently accept
    }

    if (!checkRateLimit(`install:${clientIp}`)) {
      return jsonError("Muitas solicitações. Tente novamente em 15 minutos.", 429);
    }

    const fullName = String(body.fullName || "").trim();
    const cpf = String(body.cpf || "").replace(/\D/g, "");
    const phone = String(body.phone || "").replace(/\D/g, "");
    const email = String(body.email || "").trim();
    const agreedToTerms = body.agreedToTerms === true;

    if (fullName.length < 3) return jsonError("Informe seu nome completo.");
    if (cpf.length !== 11) return jsonError("CPF inválido. Informe os 11 dígitos.");
    if (phone.length < 10) return jsonError("Telefone inválido. Informe um número com DDD.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("E-mail inválido.");
    if (!agreedToTerms) return jsonError("Você precisa aceitar os termos.");

    const optionalStr = (key: string): string | undefined => {
      const raw = body[key];
      if (raw === undefined || raw === null) return undefined;
      const s = String(raw).trim();
      return s.length > 0 ? s.slice(0, 500) : undefined;
    };

    await db().from("install_requests").insert({
      full_name: fullName.slice(0, 200),
      cpf,
      phone,
      email: email ? email.slice(0, 200) : null,
      zip_code: optionalStr("zipCode"),
      street: optionalStr("street"),
      number: optionalStr("number"),
      complement: optionalStr("complement"),
      neighborhood: optionalStr("neighborhood"),
      city: optionalStr("city"),
      state: optionalStr("state"),
      desired_plan: optionalStr("desiredPlan"),
      message: optionalStr("message"),
      agreed_to_terms: agreedToTerms,
      ip_address: clientIp,
      status: "pending",
      created_at: now(),
    });

    console.log(`[INSTALL_REQUEST] Nova solicitação de ${fullName} (${cpf}) — IP ${clientIp}`);
    return json({ success: true });
  } catch (err) {
    console.error("[INSTALL_REQUEST_ERROR]", err);
    return jsonError("Erro ao enviar a solicitação.", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/install-requests
// ---------------------------------------------------------------------------
app.get("/admin/install-requests", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || undefined;

    let query = db().from("install_requests").select("*").order("created_at", { ascending: false }).limit(200);
    if (status) query = query.eq("status", status);

    const { data: requests = [] } = await query;

    const summary = {
      total: requests.length,
      pending: requests.filter((r) => r.status === "pending").length,
      approved: requests.filter((r) => r.status === "approved").length,
      rejected: requests.filter((r) => r.status === "rejected").length,
    };

    return json({ requests, summary });
  } catch {
    return jsonError("Erro ao listar solicitações.", 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/install-requests/:id/status
// ---------------------------------------------------------------------------
app.post("/admin/install-requests/:id/status", async (c) => {
  const request = c.req.raw;
  if (!(await requireAdmin(request))) return jsonError("Não autorizado.", 401);
  try {
    const requestId = c.req.param("id");
    const body = await request.json();
    const { status, adminNote } = body as { status?: string; adminNote?: string };

    if (status !== "approved" && status !== "rejected") {
      return jsonError("Status inválido. Use 'approved' ou 'rejected'.");
    }

    const { error } = await db().from("install_requests").update({
      status,
      admin_note: adminNote?.trim() || null,
      reviewed_at: now(),
    }).eq("id", requestId);

    if (error) return jsonError("Solicitação não encontrada.", 404);
    return json({ success: true });
  } catch {
    return jsonError("Erro ao atualizar a solicitação.", 500);
  }
});

// ===========================================================================
// PUSH ROUTES
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /api/push/subscribe
// ---------------------------------------------------------------------------
app.post("/push/subscribe", async (c) => {
  const request = c.req.raw;
  try {
    const sessionToken = extractCookie(request, "mikweb_session");
    if (!sessionToken) return jsonError("Sessão não encontrada.", 401);

    const session = await getSession(sessionToken);
    if (!session) return jsonError("Sessão expirada.", 401);

    const body = await request.json();
    const { endpoint, keys, userAgent } = body as { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string };
    if (!endpoint || !keys) return jsonError("Dados da inscrição incompletos.", 400);

    // Upsert subscription
    await db().from("push_subscriptions").upsert({
      endpoint,
      keys,
      session_token: sessionToken,
      cpf: session.cpf,
      customer_id: session.customer_id,
      customer_name: session.customer_name,
      user_agent: userAgent,
      created_at: now(),
    }, { onConflict: "endpoint" });

    return json({ success: true });
  } catch (err) {
    console.error("[PUSH_SUBSCRIBE_ERROR]", err);
    return jsonError(String(err), 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/push/unsubscribe
// ---------------------------------------------------------------------------
app.post("/push/unsubscribe", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.endpoint) return jsonError("Endpoint não informado.", 400);

    await db().from("push_subscriptions").delete().eq("endpoint", body.endpoint);
    return json({ success: true });
  } catch (err) {
    console.error("[PUSH_UNSUBSCRIBE_ERROR]", err);
    return jsonError(String(err), 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/push/test
// ---------------------------------------------------------------------------
app.post("/push/test", async (c) => {
  const request = c.req.raw;
  try {
    const sessionToken = extractCookie(request, "mikweb_session");
    if (!sessionToken) return jsonError("Sessão não encontrada.", 401);

    const { data: subs = [] } = await db().from("push_subscriptions").select("endpoint, keys").eq("session_token", sessionToken);

    if (subs.length === 0) return json({ sent: 0, failed: 0 });

    const VAPID_PUBLIC = process.env.VITE_VAPID_PUBLIC_KEY || "";
    const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ sent: 0, failed: 0 });

    const webPush = (await import("web-push")).default;
    webPush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@portal.com", VAPID_PUBLIC, VAPID_PRIVATE);

    let sent = 0;
    let failed = 0;
    for (const sub of subs) {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({ title: "🔔 Teste de Notificação", body: "Se você está vendo isso, as notificações push estão funcionando! 🎉", tag: "test", data: { url: "/dashboard" } }),
          { TTL: 86400, urgency: "high" as const }
        );
        sent++;
      } catch {
        failed++;
      }
    }

    return json({ sent, failed });
  } catch (err) {
    console.error("[PUSH_TEST_ERROR]", err);
    return jsonError(String(err), 500);
  }
});

// ===========================================================================
// VERSION ENDPOINT — used by frontend to detect new deploys
// ===========================================================================

const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.APP_VERSION || String(Date.now());

app.get("/version", (c) => {
  return json({ version: APP_VERSION, timestamp: Date.now() });
});

// ===========================================================================
// Export for Vercel serverless function
// ===========================================================================
export default async function handler(request: Request): Promise<Response> {
  return app.fetch(request);
}
