import { v } from "convex/values";
import { mutation } from "./_generated/server";

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
      throw new Error("Sessão não encontrada ou expirada.");
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
