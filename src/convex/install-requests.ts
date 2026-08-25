/**
 * Installation requests — new customer signup from the public landing page.
 *
 * The landing form submits to POST /api/public/install-request (public),
 * which stores a "pending" request. Admins review them in the dashboard and
 * approve or reject via POST /api/admin/install-requests/:id/status.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const installRequestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

// ---------------------------------------------------------------------------
// Public: submit a new installation request (called via HTTP endpoint)
// ---------------------------------------------------------------------------
export const submitInstallRequest = mutation({
  args: {
    fullName: v.string(),
    cpf: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    street: v.optional(v.string()),
    number: v.optional(v.string()),
    complement: v.optional(v.string()),
    neighborhood: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    desiredPlan: v.optional(v.string()),
    message: v.optional(v.string()),
    agreedToTerms: v.boolean(),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("installRequests", {
      fullName: args.fullName,
      cpf: args.cpf,
      phone: args.phone,
      email: args.email,
      zipCode: args.zipCode,
      street: args.street,
      number: args.number,
      complement: args.complement,
      neighborhood: args.neighborhood,
      city: args.city,
      state: args.state,
      desiredPlan: args.desiredPlan,
      message: args.message,
      agreedToTerms: args.agreedToTerms,
      status: "pending",
      ipAddress: args.ipAddress,
      createdAt: Date.now(),
    });
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Admin: list installation requests (optionally filtered by status)
// ---------------------------------------------------------------------------
export const listInstallRequests = query({
  args: {
    status: v.optional(installRequestStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 200;

    let results;
    if (args.status) {
      results = await ctx.db
        .query("installRequests")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    } else {
      results = await ctx.db
        .query("installRequests")
        .withIndex("by_createdAt")
        .order("desc")
        .take(limit);
    }

    return results.map((r) => ({
      _id: r._id,
      fullName: r.fullName,
      cpf: r.cpf,
      phone: r.phone,
      email: r.email,
      zipCode: r.zipCode,
      street: r.street,
      number: r.number,
      complement: r.complement,
      neighborhood: r.neighborhood,
      city: r.city,
      state: r.state,
      desiredPlan: r.desiredPlan,
      message: r.message,
      agreedToTerms: r.agreedToTerms,
      status: r.status,
      adminNote: r.adminNote,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
    }));
  },
});

// ---------------------------------------------------------------------------
// Admin: approve or reject an installation request
// ---------------------------------------------------------------------------
export const updateInstallRequestStatus = mutation({
  args: {
    requestId: v.id("installRequests"),
    status: v.union(v.literal("approved"), v.literal("rejected")),
    adminNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.requestId);
    if (!existing) {
      throw new Error("Solicitação não encontrada.");
    }

    await ctx.db.patch(args.requestId, {
      status: args.status,
      adminNote: args.adminNote ?? existing.adminNote,
      reviewedAt: Date.now(),
    });

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Admin: summary counts for the dashboard badge
// ---------------------------------------------------------------------------
export const getInstallRequestsSummary = query({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db
      .query("installRequests")
      .withIndex("by_createdAt")
      .order("desc")
      .take(200);

    return {
      total: recent.length,
      pending: recent.filter((r) => r.status === "pending").length,
      approved: recent.filter((r) => r.status === "approved").length,
      rejected: recent.filter((r) => r.status === "rejected").length,
    };
  },
});
