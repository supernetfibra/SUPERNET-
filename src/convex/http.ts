/**
 * HTTP Endpoints for MikWeb Customer Portal
 *
 * Handles login, logout, and session validation with httpOnly cookies.
 */

import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// Preserve built-in Convex Auth routes
auth.addHttpRoutes(http);

// ---------------------------------------------------------------------------
// Rate limiting state (in-memory, resets on deployment)
// ---------------------------------------------------------------------------
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_MAX = 5; // Max attempts
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

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

// ---------------------------------------------------------------------------
// POST /api/mikweb/login
// ---------------------------------------------------------------------------
const loginHandler = httpAction(async (ctx, request) => {
  const startTime = Date.now();
  const clientIp = getClientIp(request);

  try {
    // Parse request body
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

    // Rate limit by IP + CPF combination
    const rateLimitKey = `${clientIp}:${cpf}`;
    if (!checkRateLimit(rateLimitKey)) {
      console.warn(`[LOGIN_RATE_LIMIT] IP: ${clientIp}, CPF: ${cpf}`);
      return new Response(
        JSON.stringify({ error: "Muitas tentativas. Tente novamente em 15 minutos." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    // --- Step 1: Find customer by CPF ---
    let customers;
    try {
      customers = await ctx.runAction(api.mikweb.findCustomerByCPF, { cpf });
    } catch (err) {
      console.error(`[LOGIN_ERROR] findCustomerByCPF: ${err}`);
      return new Response(
        JSON.stringify({ error: "CPF não encontrado. Verifique e tente novamente." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Find the specific customer if contactId was provided (multiple contacts scenario)
    // For now, use the first customer found
    const customer = customers[0];

    // --- Step 2: Get contacts ---
    let contacts: Array<{ id: string; nome?: string; telefone?: string; celular?: string; email?: string; tipo?: string; principal?: boolean }> = [];
    try {
      contacts = await ctx.runAction(api.mikweb.getCustomerContacts, {
        customerId: customer.id,
      });
    } catch (err) {
      console.error(`[LOGIN_ERROR] getCustomerContacts: ${err}`);
      contacts = [];
    }

    // --- Step 3: Validate password (phone number) ---
    let validationResult;
    try {
      validationResult = await ctx.runAction(api.mikweb.validateInitialPassword, {
        customerId: customer.id,
        password: body.password,
      });
    } catch (err) {
      console.error(`[LOGIN_ERROR] validatePassword: ${err}`);
      return new Response(
        JSON.stringify({ error: "Erro ao validar credenciais. Tente novamente." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!validationResult.valid) {
      console.warn(`[LOGIN_FAILED] CPF: ${cpf}, IP: ${clientIp}`);
      return new Response(
        JSON.stringify({ error: "Senha incorreta. Use seu telefone de cadastro como senha inicial." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Authentication successful

    // Map contacts to the format expected by sessions
    const sessionContacts = contacts.map((c) => ({
      id: c.id,
      phone: c.telefone || c.celular || "",
      label: c.nome || c.tipo || undefined,
    }));

    // Create session
    const sessionResult = await ctx.runMutation(api.sessions.createSession, {
      cpf,
      customerId: customer.id,
      customerName: customer.nome,
      contacts: sessionContacts,
      selectedContactId: validationResult.contactId,
    });

    const responseHeaders = new Headers({
      "Content-Type": "application/json",
    });

    // Set httpOnly session cookie
    responseHeaders.append(
      "Set-Cookie",
      `mikweb_session=${sessionResult.sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${24 * 60 * 60}`
    );

    console.log(`[LOGIN_SUCCESS] CPF: ${cpf}, Customer: ${customer.nome}, Duration: ${Date.now() - startTime}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        customer: {
          id: customer.id,
          name: customer.nome,
          email: customer.email,
        },
        hasMultipleContacts: contacts.length > 1,
        contacts: contacts.map((c) => ({
          id: c.id,
          label: c.nome || c.tipo || "Contato",
          phoneMasked: maskPhone(c.telefone || c.celular || ""),
        })),
        sessionToken: sessionResult.sessionToken,
        expiresAt: sessionResult.expiresAt,
      }),
      { status: 200, headers: responseHeaders }
    );
  } catch (err) {
    console.error(`[LOGIN_ERROR] Unhandled: ${err}`);
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
    // Get session token from cookie
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/mikweb_session=([^;]+)/);
    const sessionToken = match ? match[1] : null;

    if (sessionToken) {
      await ctx.runMutation(api.sessions.deleteSession, { sessionToken });
    }

    const responseHeaders = new Headers({
      "Content-Type": "application/json",
    });

    // Clear cookie
    responseHeaders.append(
      "Set-Cookie",
      `mikweb_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
    );

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: responseHeaders }
    );
  } catch (err) {
    console.error(`[LOGOUT_ERROR] ${err}`);
    return new Response(
      JSON.stringify({ error: "Erro ao fazer logout." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
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
      return new Response(
        JSON.stringify({ authenticated: false }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const session = await ctx.runQuery(api.sessions.getSession, { sessionToken });

    if (!session) {
      // Session expired or invalid
      const responseHeaders = new Headers({
        "Content-Type": "application/json",
      });
      responseHeaders.append(
        "Set-Cookie",
        `mikweb_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
      );

      return new Response(
        JSON.stringify({ authenticated: false, error: "Sessão expirada." }),
        { status: 401, headers: responseHeaders }
      );
    }

    // Touch session (extend if needed)
    await ctx.runMutation(api.sessions.touchSession, { sessionToken });

    return new Response(
      JSON.stringify({
        authenticated: true,
        customer: {
          id: session.customerId,
          name: session.customerName,
          cpf: session.cpf,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[ME_ERROR] ${err}`);
    return new Response(
      JSON.stringify({ authenticated: false, error: "Erro ao verificar sessão." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
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
      return new Response(
        JSON.stringify({ error: "Sessão não encontrada." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = (await request.json()) as { contactId: string };
    if (!body.contactId) {
      return new Response(
        JSON.stringify({ error: "Contato não especificado." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    await ctx.runMutation(api.sessions.updateSessionContact, {
      sessionToken,
      contactId: body.contactId,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[SELECT_CONTACT_ERROR] ${err}`);
    return new Response(
      JSON.stringify({ error: "Erro ao selecionar contato." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
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

export default http;
