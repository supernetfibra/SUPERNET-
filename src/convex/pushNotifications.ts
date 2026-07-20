/**
 * Push Notification Service
 *
 * Manages Web Push subscriptions and sends push notifications to subscribed clients.
 * Uses the Web Push protocol via VAPID (Voluntary Application Server Identification).
 *
 * VAPID keys are stored as environment variables:
 *   VITE_VAPID_PUBLIC_KEY  — Public VAPID key (exposed to the client)
 *   VAPID_PRIVATE_KEY      — Private VAPID key (server-only)
 *   VAPID_SUBJECT          — Mailto or URL for the push service to contact
 */

"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, mutation, query, internalAction } from "./_generated/server";
import webPush from "web-push";

// Helper to bypass circular type references when calling queries from actions
// in the same module. The runtime still resolves correctly via the Convex
// internal API — this is purely a TypeScript workaround.
const PN = internal.pushNotifications as any;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushSubInfo {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface PushResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// VAPID configuration
// ---------------------------------------------------------------------------

function getVapidConfig() {
  return {
    publicKey: process.env.VITE_VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:admin@portalcliente.com.br",
  };
}

// ---------------------------------------------------------------------------
// Subscribe / Unsubscribe Mutations
// ---------------------------------------------------------------------------

export const saveSubscription = mutation({
  args: {
    endpoint: v.string(),
    keys: v.object({
      p256dh: v.string(),
      auth: v.string(),
    }),
    sessionToken: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("mikwebSessions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .first();

    if (!session) {
      throw new Error("Sess\u00e3o n\u00e3o encontrada ou expirada.");
    }

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    await ctx.db.insert("pushSubscriptions", {
      endpoint: args.endpoint,
      keys: args.keys,
      sessionToken: args.sessionToken,
      cpf: session.cpf,
      customerId: session.customerId,
      customerName: session.customerName,
      userAgent: args.userAgent,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

export const removeSubscription = mutation({
  args: {
    endpoint: v.string(),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { success: true };
  },
});

export const removeSubscriptionBySession = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .collect();

    await Promise.all(subscriptions.map((sub) => ctx.db.delete(sub._id)));

    return { success: true, removed: subscriptions.length };
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getSubscriptionsByCpf = query({
  args: { cpf: v.string() },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_cpf", (q) => q.eq("cpf", args.cpf))
      .collect();

    return subscriptions.map((s) => ({
      endpoint: s.endpoint,
      keys: s.keys,
      cpf: s.cpf,
      customerId: s.customerId,
      customerName: s.customerName,
      createdAt: s.createdAt,
    }));
  },
});

export const getSubscriptionsBySession = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .collect();

    return subscriptions.map((s) => ({
      endpoint: s.endpoint,
      keys: s.keys,
      createdAt: s.createdAt,
    }));
  },
});

export const getAllSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("pushSubscriptions").collect();
  },
});

// ---------------------------------------------------------------------------
// Send push notification to a single subscription
// ---------------------------------------------------------------------------

async function sendPushToSubscription(subscription: PushSubInfo, payload: {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
}): Promise<PushResult> {
  const vapid = getVapidConfig();

  if (!vapid.publicKey || !vapid.privateKey) {
    return { success: false, error: "VAPID keys not configured" };
  }

  try {
    webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

    const result = await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
      {
        TTL: 86400,
        urgency: "high",
      }
    );

    return { success: true, statusCode: result.statusCode };
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      return { success: false, error: "subscription_expired", statusCode: err.statusCode };
    }
    return { success: false, error: err.message || "Unknown error", statusCode: err.statusCode };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers for counting results
// ---------------------------------------------------------------------------

function countSent(results: PromiseSettledResult<PushResult>[]): number {
  return results.filter((r) => r.status === "fulfilled" && r.value.success).length;
}

function countFailed(results: PromiseSettledResult<PushResult>[]): number {
  return results.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)
  ).length;
}

function toPushSubInfo(raw: any): PushSubInfo {
  return { endpoint: raw.endpoint, keys: raw.keys };
}

// ---------------------------------------------------------------------------
// Internal action: send notification to all subscriptions for a given CPF
// ---------------------------------------------------------------------------

export const sendNotificationToCustomer = internalAction({
  args: {
    cpf: v.string(),
    title: v.string(),
    body: v.string(),
    tag: v.optional(v.string()),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<{ sent: number; failed: number }> => {
    const raw = await ctx.runQuery(PN.getSubscriptionsByCpf, {
      cpf: args.cpf,
    });
    const subscriptions: PushSubInfo[] = (raw || []).map(toPushSubInfo);

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        sendPushToSubscription(sub, {
          title: args.title,
          body: args.body,
          tag: args.tag || "billing",
          data: { cpf: args.cpf, ...(args.data as Record<string, unknown>) },
        })
      )
    );

    return { sent: countSent(results), failed: countFailed(results) };
  },
});

// ---------------------------------------------------------------------------
// Internal action: send notification to ALL subscriptions (broadcast)
// ---------------------------------------------------------------------------

export const broadcastNotification = internalAction({
  args: {
    title: v.string(),
    body: v.string(),
    tag: v.optional(v.string()),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<{ total: number; sent: number; failed: number }> => {
    const raw = await ctx.runQuery(PN.getAllSubscriptions);
    const subscriptions: PushSubInfo[] = (raw || []).map(toPushSubInfo);

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        sendPushToSubscription(sub, {
          title: args.title,
          body: args.body,
          tag: args.tag || "broadcast",
          data: args.data as Record<string, unknown>,
        })
      )
    );

    return {
      total: subscriptions.length,
      sent: countSent(results),
      failed: countFailed(results),
    };
  },
});

// ---------------------------------------------------------------------------
// Action: Send a test notification (for debugging)
// ---------------------------------------------------------------------------

export const sendTestNotification = action({
  args: {
    sessionToken: v.string(),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ sent: number; failed: number }> => {
    const raw = await ctx.runQuery(PN.getSubscriptionsBySession, {
      sessionToken: args.sessionToken,
    });
    const subscriptions: PushSubInfo[] = (raw || []).map(toPushSubInfo);

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        sendPushToSubscription(sub, {
          title: args.title || "\ud83d\udd14 Teste de Notifica\u00e7\u00e3o",
          body: args.body || "Se voc\u00ea est\u00e1 vendo isso, as notifica\u00e7\u00f5es push est\u00e3o funcionando! \ud83c\udf89",
          tag: "test",
          data: { url: "/dashboard" },
        })
      )
    );

    return { sent: countSent(results), failed: countFailed(results) };
  },
});

// ---------------------------------------------------------------------------
// Cron: Check billings and send notifications for upcoming/overdue invoices
// ---------------------------------------------------------------------------

export const checkAndNotify = internalAction({
  args: {},
  handler: async (ctx): Promise<{ notified: number; totalCpfs: number }> => {
    const raw = await ctx.runQuery(PN.getAllSubscriptions);
    const allSubs: any[] = raw || [];

    if (allSubs.length === 0) {
      return { notified: 0, totalCpfs: 0 };
    }

    const uniqueCpfs: string[] = [...new Set(allSubs.map((s: any) => s.cpf))];

    let totalNotified = 0;

    for (const cpf of uniqueCpfs) {
      try {
        const customerSubs: any[] = allSubs.filter((s: any) => s.cpf === cpf);
        const customerName: string = customerSubs[0]?.customerName || "Cliente";

        const pushSubs: PushSubInfo[] = customerSubs.map(toPushSubInfo);

        const results = await Promise.allSettled(
          pushSubs.map((sub) =>
            sendPushToSubscription(sub, {
              title: "\ud83d\udccb Faturas Pendentes",
              body: `${customerName}, verifique suas faturas no Portal do Cliente.`,
              tag: `billing-reminder-${cpf}`,
              data: { url: "/faturas", cpf },
              actions: [
                { action: "open", title: "Ver faturas" },
                { action: "close", title: "Fechar" },
              ],
            })
          )
        );

        totalNotified += countSent(results);
      } catch (err) {
        console.error(`[CRON] Error notifying customer ${cpf}:`, err);
      }
    }

    return { notified: totalNotified, totalCpfs: uniqueCpfs.length };
  },
});
