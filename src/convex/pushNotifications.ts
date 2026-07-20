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
import { action, mutation, query, internalAction, internalMutation } from "./_generated/server";
import webPush from "web-push";

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
// Called from the client when the user opts in or out of push notifications.
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
    // Find the session to associate subscriber with customer data
    const session = await ctx.db
      .query("mikwebSessions")
      .withIndex("by_sessionToken", (q) => q.eq("sessionToken", args.sessionToken))
      .first();

    if (!session) {
      throw new Error("Sessão não encontrada ou expirada.");
    }

    // Remove any existing subscription with the same endpoint (device re-subscribes)
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
      // Optional: only allow removal if the session matches or no session required
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

async function sendPushToSubscription(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}, payload: {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
}): Promise<{ success: boolean; statusCode?: number; error?: string }> {
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
        TTL: 86400, // 24 hours
        urgency: "high",
      }
    );

    return { success: true, statusCode: result.statusCode };
  } catch (err: any) {
    // Handle 410/404 — subscription is expired or invalid
    if (err.statusCode === 410 || err.statusCode === 404) {
      return { success: false, error: "subscription_expired", statusCode: err.statusCode };
    }
    return { success: false, error: err.message || "Unknown error", statusCode: err.statusCode };
  }
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
  handler: async (ctx, args) => {
    const subscriptions = await ctx.runQuery(internal.pushNotifications.getSubscriptionsByCpf, {
      cpf: args.cpf,
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        sendPushToSubscription(
          { endpoint: sub.endpoint, keys: sub.keys },
          {
            title: args.title,
            body: args.body,
            tag: args.tag || "billing",
            data: { cpf: args.cpf, ...(args.data as Record<string, unknown>) },
          }
        )
      )
    );

    // Clean up expired subscriptions
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled" && result.value.success === false && result.value.error === "subscription_expired") {
        await ctx.runMutation(internal.pushNotifications.removeSubscription, {
          endpoint: subscriptions[i].endpoint,
          sessionToken: "",
        });
      }
    }

    return {
      sent: results.filter((r) => r.status === "fulfilled" && r.value.success).length,
      failed: results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)).length,
    };
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
  handler: async (ctx, args) => {
    const subscriptions = await ctx.runQuery(internal.pushNotifications.getAllSubscriptions);

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        sendPushToSubscription(
          { endpoint: sub.endpoint, keys: sub.keys },
          {
            title: args.title,
            body: args.body,
            tag: args.tag || "broadcast",
            data: args.data as Record<string, unknown>,
          }
        )
      )
    );

    return {
      total: subscriptions.length,
      sent: results.filter((r) => r.status === "fulfilled" && r.value.success).length,
      failed: results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)).length,
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
  handler: async (ctx, args) => {
    const subscriptions = await ctx.runQuery(internal.pushNotifications.getSubscriptionsBySession, {
      sessionToken: args.sessionToken,
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        sendPushToSubscription(
          { endpoint: sub.endpoint, keys: sub.keys },
          {
            title: args.title || "\ud83d\udd14 Teste de Notifica\u00e7\u00e3o",
            body: args.body || "Se voc\u00ea est\u00e1 vendo isso, as notifica\u00e7\u00f5es push est\u00e3o funcionando! \ud83c\udf89",
            tag: "test",
            data: { url: "/dashboard" },
          }
        )
      )
    );

    return {
      sent: results.filter((r) => r.status === "fulfilled" && r.value.success).length,
      failed: results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)).length,
    };
  },
});

// ---------------------------------------------------------------------------
// Cron: Check billings and send notifications for upcoming/overdue invoices
// ---------------------------------------------------------------------------

export const checkAndNotify = internalAction({
  args: {},
  handler: async (ctx) => {
    const subscriptions = await ctx.runQuery(internal.pushNotifications.getAllSubscriptions);
    if (subscriptions.length === 0) {
      return { notified: 0, message: "No subscriptions" };
    }

    // Group unique CPFs
    const uniqueCpfs = [...new Set(subscriptions.map((s) => s.cpf))];

    let totalNotified = 0;

    for (const cpf of uniqueCpfs) {
      try {
        const customerSubscriptions = subscriptions.filter((s) => s.cpf === cpf);
        const customerName = customerSubscriptions[0]?.customerName || "Cliente";

        const results = await Promise.allSettled(
          customerSubscriptions.map((sub) =>
            sendPushToSubscription(
              { endpoint: sub.endpoint, keys: sub.keys },
              {
                title: "\ud83d\udccb Faturas Pendentes",
                body: `${customerName}, verifique suas faturas no Portal do Cliente.`,
                tag: `billing-reminder-${cpf}`,
                data: { url: "/faturas", cpf },
                actions: [
                  { action: "open", title: "Ver faturas" },
                  { action: "close", title: "Fechar" },
                ],
              }
            )
          )
        );

        totalNotified += results.filter(
          (r) => r.status === "fulfilled" && r.value.success
        ).length;

        // Clean up expired subscriptions
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (
            result.status === "fulfilled" &&
            result.value.success === false &&
            result.value.error === "subscription_expired"
          ) {
            await ctx.runMutation(internal.pushNotifications.removeSubscription, {
              endpoint: customerSubscriptions[i].endpoint,
              sessionToken: customerSubscriptions[i].sessionToken,
            });
          }
        }
      } catch (err) {
        console.error(`[CRON] Error notifying customer ${cpf}:`, err);
      }
    }

    return { notified: totalNotified, totalCpfs: uniqueCpfs.length };
  },
});
