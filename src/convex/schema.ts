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
    ...authTables, // do not remove or modify

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
    // Stores authenticated sessions with httpOnly cookie
    mikwebSessions: defineTable({
      sessionToken: v.string(),         // Unique session token (stored in httpOnly cookie)
      cpf: v.string(),                   // Normalized CPF
      customerId: v.string(),            // MikWeb customer ID
      customerName: v.string(),          // Customer name (cached)
      contacts: v.array(v.object({       // Available contacts for this customer
        id: v.string(),
        phone: v.string(),
        label: v.optional(v.string()),
      })),
      selectedContactId: v.optional(v.string()), // Which contact was used for auth
      createdAt: v.number(),             // Session creation timestamp
      expiresAt: v.number(),             // Session expiration timestamp
      lastActivityAt: v.number(),        // Last activity timestamp
    }).index("by_sessionToken", ["sessionToken"])
      .index("by_cpf", ["cpf"]),

    // Add other tables here if needed
  },
  {
    schemaValidation: false,
  },
);

export default schema;
