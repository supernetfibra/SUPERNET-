import { v } from "convex/values";
import { query } from "./_generated/server";

export const getAllSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("pushSubscriptions").collect();
  },
});

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
