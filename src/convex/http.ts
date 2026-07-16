/**
 * HTTP Endpoints for MikWeb Customer Portal
 *
 * Handles login, logout, session validation, admin auth, config, and audit logs.
 * All login attempts/failures are logged to the audit log.
 */

import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

auth.addHttpRoutes(http);

// ---------------------------------------------------------------------------
// Rate limiting state
// ---------------------------------------------------------------------------
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;

const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
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

async function logEvent(ctx: any, event: {
  type: "login_success" | "login_failure" | "login_rate_limited" | "billing_error" | "billing_access" | "logout";
  cpf?: string;
  customerId?: string;
  customerName?: string;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: any;
}) {
  try {
    await ctx.runMutation(api.admin.logEvent, event);
  } catch (err) {
    console.error("[AUDIT_LOG_ERROR]", err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/mikweb/login
// ---------------------------------------------------------------------------
const loginHandler = httpAction(async (ctx, request) => {
  const startTime = Date.now();
  const clientIp = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const body = (await request.json()) as {
      cpf: string;
      password: string;
      contactId?: string;
    };

    if (!body.cpf || !body.password) {
      return new Response(
        JSON.stringify({ error: "CPF e senha são obrigatórios." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const cpf = body.cpf.replace(/\D/g, "");
    const rateLimitKey = `${clientIp}:${cpf}`;
    if (!checkRateLimit(rateLimitKey)) {
      console.warn(`[LOGIN_RATE_LIMIT] IP: ${clientIp}, CPF: ${cpf}`);
      await logEvent(ctx, { type: "login_rate_limited", cpf, ipAddress: clientIp, userAgent, errorMessage: "Rate limit excedido" });
      return new Response(
        JSON.stringify({ error: "Muitas tentativas. Tente novamente em 15 minutos." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    let customers;
    try {
      customers = await ctx.runAction(api.mikweb.findCustomerByCPF, { cpf });
    } catch (err) {
      console.error(`[LOGIN_ERROR] findCustomerByCPF: ${err}`);
      await logEvent(ctx, { type: "login_failure", cpf, ipAddress: clientIp, userAgent, errorMessage: "CPF não encontrado no MikWeb" });
      return new Response(
        JSON.stringify({ error: "CPF não encontrado. Verifique e tente novamente." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const customer = customers[0];

    let contacts: Array<{ id: string; nome?: string; telefone?: string; celular?: string; email?: string; tipo?: string; principal?: boolean }> = [];
    try {
      contacts = await ctx.runAction(api.mikweb.getCustomerContacts, { customerId: customer.id });
    } catch (err) {
      console.error(`[LOGIN_ERROR] getCustomerContacts: ${err}`);
      contacts = [];
    }

    let validationResult;
    try {
      validationResult = await ctx.runAction(api.mikweb.validateInitialPassword, {
        customerId: customer.id,
        password: body.password,
      });
    } catch (err) {
      console.error(`[LOGIN_ERROR] validatePassword: ${err}`);
      await logEvent(ctx, { type: "login_failure", cpf, customerId: customer.id, customerName: customer.nome, ipAddress: clientIp, userAgent, errorMessage: "Erro ao validar senha na API" });
      return new Response(
        JSON.stringify({ error: "Erro ao validar credenciais. Tente novamente." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!validationResult.valid) {
      console.warn(`[LOGIN_FAILED] CPF: ${cpf}, IP: ${clientIp}`);
      await logEvent(ctx, { type: "login_failure", cpf, customerId: customer.id, customerName: customer.nome, ipAddress: clientIp, userAgent, errorMessage: "Senha incorreta" });
      return new Response(
        JSON.stringify({ error: "Senha incorreta. Use seu telefone de cadastro como senha inicial." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const sessionContacts = contacts.map((c) => ({
      id: c.id,
      phone: c.telefone || c.celular || "",
      label: c.nome || c.tipo || undefined,
    }));

    const sessionResult = await ctx.runMutation(api.sessions.createSession, {
      cpf,
      customerId: customer.id,
      customerName: customer.nome,
      contacts: sessionContacts,
      selectedContactId: validationResult.contactId,
    });

    const responseHeaders = new Headers({ "Content-Type": "application/json" });
    responseHeaders.append("Set-Cookie", `mikweb_session=${sessionResult.sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${24 * 60 * 60}`);

    console.log(`[LOGIN_SUCCESS] CPF: ${cpf}, Customer: ${customer.nome}, Duration: ${Date.now() - startTime}ms`);

    await logEvent(ctx, {
      type: "login_success",
      cpf,
      customerId: customer.id,
      customerName: customer.nome,
      ipAddress: clientIp,
      userAgent,
      metadata: { duration: Date.now() - startTime },
    });

    return new Response(JSON.stringify({
      success: true,
      customer: { id: customer.id, name: customer.nome, email: customer.email },
      hasMultipleContacts: contacts.length > 1,
      contacts: contacts.map((c) => ({
        id: c.id,
        label: c.nome || c.tipo || "Contato",
        phoneMasked: maskPhone(c.telefone || c.celular || ""),
      })),
      sessionToken: sessionResult.sessionToken,
      expiresAt: sessionResult.expiresAt,
    }), { status: 200, headers: responseHeaders });
  } catch (err) {
    console.error(`[LOGIN_ERROR] Unhandled: ${err}`);
    await logEvent(ctx, { type: "login_failure", ipAddress: clientIp, userAgent, errorMessage: `Erro interno: ${err instanceof Error ? err.message : "Desconhecido"}` });
    return new Response(
      JSON.stringify({ error: "Erro interno. Tente novamente mais tarde." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/mikweb/logout
// ---------------------------------------------------------------------------
const logoutHandler = httpAction(async (ctx, request) => {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/mikweb_session=([^;]+)/);
    const sessionToken = match ? match[1] : null;

    if (sessionToken) {
      const session = await ctx.runQuery(api.sessions.getSession, { sessionToken });
      if (session) {
        await logEvent(ctx, {
          type: "logout",
          cpf: session.cpf,
          customerId: session.customerId,
          customerName: session.customerName,
          ipAddress: getClientIp(request),
        });
      }
      await ctx.runMutation(api.sessions.deleteSession, { sessionToken });
    }

    const responseHeaders = new Headers({ "Content-Type": "application/json" });
    responseHeaders.append("Set-Cookie", `mikweb_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: responseHeaders });
  } catch (err) {
    console.error(`[LOGOUT_ERROR] ${err}`);
    return new Response(JSON.stringify({ error: "Erro ao fazer logout." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// ---------------------------------------------------------------------------
// GET /api/mikweb/me
// ---------------------------------------------------------------------------
const meHandler = httpAction(async (ctx, request) => {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/mikweb_session=([^;]+)/);
    const sessionToken = match ? match[1] : null;

    if (!sessionToken) {
      return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const session = await ctx.runQuery(api.sessions.getSession, { sessionToken });
    if (!session) {
      const h = new Headers({ "Content-Type": "application/json" });
      h.append("Set-Cookie", `mikweb_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
      return new Response(JSON.stringify({ authenticated: false, error: "Sessão expirada." }), { status: 401, headers: h });
    }

    await ctx.runMutation(api.sessions.touchSession, { sessionToken });

    return new Response(JSON.stringify({
      authenticated: true,
      customer: { id: session.customerId, name: session.customerName, cpf: session.cpf },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[ME_ERROR] ${err}`);
    return new Response(JSON.stringify({ authenticated: false, error: "Erro ao verificar sessão." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// ---------------------------------------------------------------------------
// POST /api/mikweb/select-contact
// ---------------------------------------------------------------------------
const selectContactHandler = httpAction(async (ctx, request) => {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/mikweb_session=([^;]+)/);
    const sessionToken = match ? match[1] : null;

    if (!sessionToken) {
      return new Response(JSON.stringify({ error: "Sessão não encontrada." }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const body = (await request.json()) as { contactId: string };
    if (!body.contactId) {
      return new Response(JSON.stringify({ error: "Contato não especificado." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    await ctx.runMutation(api.sessions.updateSessionContact, { sessionToken, contactId: body.contactId });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[SELECT_CONTACT_ERROR] ${err}`);
    return new Response(JSON.stringify({ error: "Erro ao selecionar contato." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// ---------------------------------------------------------------------------
// Admin HTTP Endpoints
// ---------------------------------------------------------------------------

// POST /api/admin/login
const adminLoginHandler = httpAction(async (ctx, request) => {
  try {
    const body = (await request.json()) as { password: string };
    if (!body.password) {
      return new Response(JSON.stringify({ error: "Senha obrigatória." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const result = await ctx.runMutation(api.admin.adminLogin, { password: body.password });
    const h = new Headers({ "Content-Type": "application/json" });
    // Set cookie — may be rejected by browser on HTTP (Secure flag), so also
    // return the token in the JSON body so the client can use localStorage.
    h.append("Set-Cookie", `mikweb_admin_session=${result.sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${8 * 60 * 60}`);
    return new Response(JSON.stringify({ success: true, sessionToken: result.sessionToken, expiresAt: result.expiresAt }), { status: 200, headers: h });
  } catch {
    return new Response(JSON.stringify({ error: "Senha de administrador incorreta." }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
});

// Helper: extract admin session token from cookie or query param
function getAdminSessionToken(request: Request): string | null {
  // Try cookie first
  const cookieHeader = request.headers.get("cookie") || "";
  const cookieMatch = cookieHeader.match(/mikweb_admin_session=([^;]+)/);
  if (cookieMatch) return cookieMatch[1];
  // Fallback: query param (for dev environments where Secure cookies are rejected)
  try {
    const url = new URL(request.url);
    return url.searchParams.get("token");
  } catch {
    return null;
  }
}

// POST /api/admin/logout
const adminLogoutHandler = httpAction(async (ctx, request) => {
  try {
    const sessionToken = getAdminSessionToken(request);
    if (sessionToken) {
      await ctx.runMutation(api.admin.adminLogout, { sessionToken });
    }
    const h = new Headers({ "Content-Type": "application/json" });
    h.append("Set-Cookie", `mikweb_admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: h });
  } catch {
    return new Response(JSON.stringify({ error: "Erro ao fazer logout." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/admin/verify
const adminVerifyHandler = httpAction(async (ctx, request) => {
  try {
    const sessionToken = getAdminSessionToken(request);
    if (!sessionToken) {
      return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const valid = await ctx.runQuery(api.admin.verifyAdminSession, { sessionToken });
    if (!valid) {
      const h = new Headers({ "Content-Type": "application/json" });
      h.append("Set-Cookie", `mikweb_admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
      return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: h });
    }
    return new Response(JSON.stringify({ authenticated: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ authenticated: false }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/admin/config
const adminGetConfigHandler = httpAction(async (ctx) => {
  try {
    const config = await ctx.runQuery(api.admin.getApiConfig);
    return new Response(JSON.stringify(config || { apiUrl: "", hasToken: false, updatedAt: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Erro ao ler configuração." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// POST /api/admin/config
const adminSaveConfigHandler = httpAction(async (ctx, request) => {
  try {
    const body = (await request.json()) as { apiUrl: string; apiToken: string };
    if (!body.apiToken) {
      return new Response(JSON.stringify({ error: "Token é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    await ctx.runMutation(api.admin.saveApiConfig, { apiUrl: body.apiUrl || "", apiToken: body.apiToken });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Erro ao salvar configuração." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// GET /api/admin/branding
const adminGetBrandingHandler = httpAction(async (ctx) => {
  try {
    const config = await ctx.runQuery(api.admin.getApiConfig);
    return new Response(JSON.stringify({
      providerName: config?.providerName || "Seu Provedor",
      logoUrl: config?.logoUrl || "",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ providerName: "Seu Provedor", logoUrl: "" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// POST /api/admin/branding
const adminSaveBrandingHandler = httpAction(async (ctx, request) => {
  try {
    const body = (await request.json()) as { providerName: string; logoUrl: string };
    if (!body.providerName || !body.providerName.trim()) {
      return new Response(JSON.stringify({ error: "Nome do provedor é obrigatório." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    await ctx.runMutation(api.admin.saveBrandingConfig, {
      providerName: body.providerName.trim(),
      logoUrl: body.logoUrl || "",
    });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Erro ao salvar marca." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// POST /api/admin/test-connection
const adminTestConnectionHandler = httpAction(async (ctx, request) => {
  try {
    const body = (await request.json()) as { apiUrl: string; apiToken: string };
    const result = await ctx.runAction(api.adminNode.testApiConnection, { apiUrl: body.apiUrl, apiToken: body.apiToken });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: "Erro ao testar conexão." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// GET /api/admin/audit-logs
const adminAuditLogsHandler = httpAction(async (ctx, request) => {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || undefined;
    const cpf = url.searchParams.get("cpf") || undefined;

    let logs;
    if (type && type !== "all") {
      logs = await ctx.runQuery(api.admin.getAuditLogs, {
        limit: 100,
        type: type as any,
        cpf: cpf || undefined,
      });
    } else {
      logs = await ctx.runQuery(api.admin.getAuditLogs, {
        limit: 100,
        cpf: cpf || undefined,
      });
    }

    const summary = await ctx.runQuery(api.admin.getAuditSummary);

    return new Response(JSON.stringify({ logs, summary }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ logs: [], summary: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// ---------------------------------------------------------------------------
// Helper: mask phone for display
// ---------------------------------------------------------------------------
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return phone;
  const ddd = digits.slice(0, 2);
  const first = digits.slice(2, 6);
  const last = digits.slice(-2);
  if (digits.length === 11) return `(${ddd}) ${first}**-${last}`;
  return `(${ddd}) ${first}**-${last}`;
}

// ---------------------------------------------------------------------------
// Register routes
// ---------------------------------------------------------------------------
http.route({ path: "/api/mikweb/login", method: "POST", handler: loginHandler });
http.route({ path: "/api/mikweb/logout", method: "POST", handler: logoutHandler });
http.route({ path: "/api/mikweb/me", method: "GET", handler: meHandler });
http.route({ path: "/api/mikweb/select-contact", method: "POST", handler: selectContactHandler });

http.route({ path: "/api/admin/login", method: "POST", handler: adminLoginHandler });
http.route({ path: "/api/admin/logout", method: "POST", handler: adminLogoutHandler });
http.route({ path: "/api/admin/verify", method: "GET", handler: adminVerifyHandler });
http.route({ path: "/api/admin/config", method: "GET", handler: adminGetConfigHandler });
http.route({ path: "/api/admin/config", method: "POST", handler: adminSaveConfigHandler });
http.route({ path: "/api/admin/test-connection", method: "POST", handler: adminTestConnectionHandler });
http.route({ path: "/api/admin/audit-logs", method: "GET", handler: adminAuditLogsHandler });
http.route({ path: "/api/admin/branding", method: "GET", handler: adminGetBrandingHandler });
http.route({ path: "/api/admin/branding", method: "POST", handler: adminSaveBrandingHandler });

export default http;
