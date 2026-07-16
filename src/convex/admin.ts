/**
 * Admin service for MikWeb Customer Portal.
 * Handles API configuration, admin authentication, and audit logging.
 */

import { v, Infer } from "convex/values";
import { mutation, query } from "./_generated/server";

import { generateSessionToken } from "./shared";

// ---------------------------------------------------------------------------
// Admin Authentication
// ---------------------------------------------------------------------------

const ADMIN_PASSWORD =
  process.env.MIKWEB_ADMIN_PASSWORD || "slackware@";
const ADMIN_SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export const adminLogin = mutation({
  args: { password: v.string() },
  handler: async (ctx, args) => {
    if (args.password !== ADMIN_PASSWORD) {
      throw new Error("Senha de administrador incorreta.");
    }

    const now = Date.now();
    const sessionToken = generateSessionToken();

    await ctx.db.insert("mikwebAdminSessions", {
      sessionToken,
      createdAt: now,
      expiresAt: now + ADMIN_SESSION_DURATION_MS,
      lastActivityAt: now,
    });

    return { sessionToken, expiresAt: now + ADMIN_SESSION_DURATION_MS };
  },
});

export const verifyAdminSession = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("mikwebAdminSessions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .first();

    if (!session) return false;
    if (session.expiresAt < Date.now()) return false;

    return true;
  },
});

export const touchAdminSession = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("mikwebAdminSessions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .first();

    if (session) {
      await ctx.db.patch(session._id, { lastActivityAt: Date.now() });
    }
  },
});

export const adminLogout = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("mikwebAdminSessions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }
  },
});

// ---------------------------------------------------------------------------
// API Configuration
// ---------------------------------------------------------------------------

export const getApiConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db
      .query("mikwebConfig")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();

    if (!config) return null;

    return {
      apiUrl: config.apiUrl,
      apiToken: config.apiToken
        ? `${config.apiToken.slice(0, 4)}...${config.apiToken.slice(-4)}`
        : "",
      hasToken: !!config.apiToken,
      providerName: config.providerName,
      logoUrl: config.logoUrl,
      updatedAt: config.updatedAt,
    };
  },
});

export const saveApiConfig = mutation({
  args: {
    apiUrl: v.string(),
    apiToken: v.string(),
    providerName: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mikwebConfig")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        apiUrl: args.apiUrl,
        apiToken: args.apiToken,
        providerName: args.providerName ?? existing.providerName,
        logoUrl: args.logoUrl ?? existing.logoUrl,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("mikwebConfig", {
        key: "default",
        apiUrl: args.apiUrl,
        apiToken: args.apiToken,
        providerName: args.providerName,
        logoUrl: args.logoUrl,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Save branding config only (provider name + logo).
 */
export const saveBrandingConfig = mutation({
  args: {
    providerName: v.string(),
    logoUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mikwebConfig")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        providerName: args.providerName,
        logoUrl: args.logoUrl,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("mikwebConfig", {
        key: "default",
        apiUrl: "",
        apiToken: "",
        providerName: args.providerName,
        logoUrl: args.logoUrl,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Get the raw API config (token included) — only for use in HTTP actions.
 * Returns null if not configured, in which case env vars will be used.
 */
export const getRawApiConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db
      .query("mikwebConfig")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();

    return config
      ? { apiUrl: config.apiUrl, apiToken: config.apiToken, providerName: config.providerName, logoUrl: config.logoUrl }
      : null;
  },
});

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

// Shared union validator for audit log types
const auditLogTypeValidator = v.union(
  v.literal("login_success"),
  v.literal("login_failure"),
  v.literal("login_rate_limited"),
  v.literal("billing_error"),
  v.literal("billing_access"),
  v.literal("logout"),
);

export type AuditLogType = Infer<typeof auditLogTypeValidator>;

export const logEvent = mutation({
  args: {
    type: auditLogTypeValidator,
    cpf: v.optional(v.string()),
    customerId: v.optional(v.string()),
    customerName: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mikwebAuditLog", {
      type: args.type,
      cpf: args.cpf,
      customerId: args.customerId,
      customerName: args.customerName,
      errorMessage: args.errorMessage,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
      metadata: args.metadata,
      timestamp: Date.now(),
    });
  },
});

export const getAuditLogs = query({
  args: {
    limit: v.optional(v.number()),
    type: v.optional(auditLogTypeValidator),
    cpf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;

    let results;
    if (args.type) {
      results = await ctx.db
        .query("mikwebAuditLog")
        .withIndex("by_type", (q) => q.eq("type", args.type!))
        .order("desc")
        .take(limit);
    } else if (args.cpf) {
      results = await ctx.db
        .query("mikwebAuditLog")
        .withIndex("by_cpf", (q) => q.eq("cpf", args.cpf!))
        .order("desc")
        .take(limit);
    } else {
      results = await ctx.db
        .query("mikwebAuditLog")
        .withIndex("by_timestamp")
        .order("desc")
        .take(limit);
    }

    return results.map(toAuditEntry);
  },
});

/** Helper to map a raw audit log document to a safe serializable shape */
function toAuditEntry(entry: any) {
  return {
    _id: entry._id,
    type: entry.type,
    cpf: entry.cpf,
    customerId: entry.customerId,
    customerName: entry.customerName,
    errorMessage: entry.errorMessage,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    metadata: entry.metadata,
    timestamp: entry.timestamp,
  };
}

export const getAuditSummary = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const allLogs = await ctx.db
      .query("mikwebAuditLog")
      .withIndex("by_timestamp")
      .order("desc")
      .take(500);

    const today = allLogs.filter((l) => l.timestamp >= todayStart.getTime());
    const last7Days = allLogs.filter(
      (l) => l.timestamp >= now - 7 * 24 * 60 * 60 * 1000
    );

    return {
      totalLogins: allLogs.filter((l) => l.type === "login_success").length,
      totalFailures: allLogs.filter((l) => l.type === "login_failure").length,
      totalRateLimited: allLogs.filter((l) => l.type === "login_rate_limited").length,
      totalBillingErrors: allLogs.filter((l) => l.type === "billing_error").length,
      todayLogins: today.filter((l) => l.type === "login_success").length,
      todayFailures: today.filter((l) => l.type === "login_failure").length,
      last7DaysLogins: last7Days.filter((l) => l.type === "login_success").length,
      last7DaysFailures: last7Days.filter((l) => l.type === "login_failure").length,
      uniqueCpfs: new Set(
        allLogs.filter((l) => l.type === "login_success").map((l) => l.cpf)
      ).size,
    };
  },
});


