import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables,

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
    }).index("email", ["email"]),

    // MikWeb customer portal sessions
    mikwebSessions: defineTable({
      sessionToken: v.string(),
      cpf: v.string(),
      customerId: v.string(),
      customerName: v.string(),
      contacts: v.array(v.object({
        id: v.string(),
        phone: v.string(),
        label: v.optional(v.string()),
      })),
      selectedContactId: v.optional(v.string()),
      createdAt: v.number(),
      expiresAt: v.number(),
      lastActivityAt: v.number(),
    }).index("by_sessionToken", ["sessionToken"])
      .index("by_cpf", ["cpf"]),

    // MikWeb API configuration (stored in DB so admin can configure via UI)
    mikwebConfig: defineTable({
      // Only one config row — identified by key "default"
      key: v.string(),
      apiUrl: v.string(),
      apiToken: v.string(),
      updatedAt: v.number(),
      updatedBy: v.optional(v.string()),
    }).index("by_key", ["key"]),

    // Admin sessions for the admin dashboard
    mikwebAdminSessions: defineTable({
      sessionToken: v.string(),
      createdAt: v.number(),
      expiresAt: v.number(),
      lastActivityAt: v.number(),
    }).index("by_sessionToken", ["sessionToken"]),

    // Audit log for tracking login attempts, errors, and billing access
    mikwebAuditLog: defineTable({
      type: v.union(
        v.literal("login_success"),
        v.literal("login_failure"),
        v.literal("login_rate_limited"),
        v.literal("billing_error"),
        v.literal("billing_access"),
        v.literal("logout"),
      ),
      cpf: v.optional(v.string()),
      customerId: v.optional(v.string()),
      customerName: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      ipAddress: v.optional(v.string()),
      userAgent: v.optional(v.string()),
      metadata: v.optional(v.any()),
      timestamp: v.number(),
    }).index("by_type", ["type"])
      .index("by_cpf", ["cpf"])
      .index("by_timestamp", ["timestamp"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
