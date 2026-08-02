/**
 * Session management for MikWeb customer portal.
 * Sessions are stored in the database and referenced by httpOnly cookies.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const EXTENDED_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_EXTEND_THRESHOLD_MS = 30 * 60 * 1000; // Extend if more than 30min left

import { generateSessionToken } from "./shared";

// ---------------------------------------------------------------------------
// Session Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new session after successful authentication.
 * Returns the session token to be stored in an httpOnly cookie.
 */
export const createSession = mutation({
  args: {
    cpf: v.string(),
    customerId: v.string(),
    customerName: v.string(),
    contacts: v.array(
      v.object({
        id: v.string(),
        phone: v.string(),
        label: v.optional(v.string()),
      })
    ),
    selectedContactId: v.optional(v.string()),
    keepConnected: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sessionToken = generateSessionToken();

    const duration = args.keepConnected
      ? EXTENDED_SESSION_DURATION_MS
      : SESSION_DURATION_MS;

    await ctx.db.insert("mikwebSessions", {
      sessionToken,
      cpf: args.cpf,
      customerId: args.customerId,
      customerName: args.customerName,
      contacts: args.contacts,
      selectedContactId: args.selectedContactId,
      createdAt: now,
      expiresAt: now + duration,
      lastActivityAt: now,
    });

    return { sessionToken, expiresAt: now + duration };
  },
});

/**
 * Update the selected contact for a session.
 */
export const updateSessionContact = mutation({
  args: {
    sessionToken: v.string(),
    contactId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("mikwebSessions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .first();

    if (!session) {
      throw new Error("Sessão não encontrada.");
    }

    if (session.expiresAt < Date.now()) {
      throw new Error("Sessão expirada.");
    }

    await ctx.db.patch(session._id, {
      selectedContactId: args.contactId,
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Delete a session (logout).
 */
export const deleteSession = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("mikwebSessions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }
  },
});

/**
 * Extend session expiration (called on activity).
 */
export const touchSession = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("mikwebSessions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .first();

    if (!session) return;

    const now = Date.now();

    // Only extend if session would expire soon
    if (session.expiresAt - now < SESSION_EXTEND_THRESHOLD_MS) {
      await ctx.db.patch(session._id, {
        lastActivityAt: now,
        expiresAt: now + SESSION_DURATION_MS,
      });
    } else {
      await ctx.db.patch(session._id, {
        lastActivityAt: now,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Session Queries
// ---------------------------------------------------------------------------

/**
 * List recent customer sessions (admin tooling).
 * Returns sessions ordered by most recent activity.
 * NOTE: sessionToken is intentionally NOT exposed — use sessionId for revoke.
 */
export const listSessions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("mikwebSessions")
      .order("desc")
      .take(args.limit ?? 50);

    const now = Date.now();
    return sessions
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map((s) => ({
        sessionId: s._id,
        cpf: s.cpf,
        customerId: s.customerId,
        customerName: s.customerName,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastActivityAt: s.lastActivityAt,
        isActive: s.expiresAt > now,
      }));
  },
});

/**
 * Revoke a session by its document ID (admin tooling).
 * Also removes any push subscriptions bound to that session.
 */
export const revokeSessionById = mutation({
  args: { sessionId: v.id("mikwebSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    // Delete push subscriptions tied to this session
    const subs = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", session.sessionToken))
      .collect();
    await Promise.all(subs.map((sub) => ctx.db.delete(sub._id)));

    await ctx.db.delete(session._id);
  },
});

/**
 * Get a session by its token.
 * Returns null if not found or expired.
 */
export const getSession = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("mikwebSessions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .first();

    if (!session) return null;
    if (session.expiresAt < Date.now()) return null;

    return {
      sessionToken: session.sessionToken,
      cpf: session.cpf,
      customerId: session.customerId,
      customerName: session.customerName,
      contacts: session.contacts,
      selectedContactId: session.selectedContactId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastActivityAt: session.lastActivityAt,
    };
  },
});
