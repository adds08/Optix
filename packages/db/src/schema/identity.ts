import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Tenant — multi-tenant-ready from day one. Constant for Urban in the prototype.
export const tenant = pgTable(
  "tenant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUq: uniqueIndex("tenant_slug_uq").on(t.slug),
  }),
);

// Auth identity. Optionally linked to a domain `employee` (custodian) for foremen who
// log in. employeeId is a plain uuid (no DB FK) to keep the schema import-graph acyclic;
// the employee↔user link is resolved in the API layer.
export const user = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id"),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    /* STI-303 criterion 5. An admin who resets a password KNOWS it, so a reset
       that does not force a change leaves a live account whose credential a
       second person holds indefinitely. The alternative design — a one-time
       link — needs a token table and an unauthenticated consume endpoint; this
       is the smaller honest version of the same guarantee.

       Set by `user.resetPassword` and by `user.create`; cleared only when the
       user sets their own password. `login()` reports it so the client can
       force the change; it does NOT refuse the login, because a user who
       cannot log in also cannot change their password. */
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("user_tenant_idx").on(t.tenantId),
    emailIdx: index("user_email_idx").on(t.email),
    /* STI-305. `email` alone was a plain index, so the same address could exist
       twice in one tenant and the credential lookup — which had no tenant
       predicate — resolved to whichever row Postgres happened to return first.
       A user could authenticate into the wrong tenant, non-deterministically.

       This closes the within-tenant half at the database. The cross-tenant half
       cannot be an index (the same person may legitimately hold an account in
       two tenants); it is closed in `login()`, which now refuses to guess when
       an address is ambiguous rather than picking a row. */
    tenantEmailUq: uniqueIndex("user_tenant_email_uq").on(t.tenantId, t.email),
  }),
);

// Lucia-compatible session table.
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const role = pgTable(
  "role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenant.id, { onDelete: "cascade" }), // null = system role
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => ({
    tenantIdx: index("role_tenant_idx").on(t.tenantId),
    tenantNameUq: uniqueIndex("role_tenant_name_uq").on(t.tenantId, t.name),
  }),
);

export const permission = pgTable("permission", {
  name: text("name").primaryKey(),
  description: text("description"),
});

export const rolePermission = pgTable(
  "role_permission",
  {
    roleId: uuid("role_id").notNull().references(() => role.id, { onDelete: "cascade" }),
    permissionName: text("permission_name").notNull().references(() => permission.name, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionName] }),
  }),
);

export const userRole = pgTable(
  "user_role",
  {
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => role.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
  }),
);

/*
  Per-user appearance and dashboard preferences (docs/19).

  One row per user, read on boot to theme the shell and write on change. The
  dashboard jsonb holds widget visibility so the command center is the same
  on every browser, not just the one it was arranged in. Values are validated
  against the theme catalog in the router — the database stores what the UI
  chose, it does not invent choices.
*/
export const userPreferences = pgTable(
  "user_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    themeName: text("theme_name").notNull().default("blocky"),
    fontFamily: text("font_family").notNull().default("system"),
    fontScale: text("font_scale").notNull().default("1.0"),
    density: text("density").notNull().default("comfortable"),
    dashboard: jsonb("dashboard").$type<{ widgets: Record<string, boolean>; defaultTab?: "fleet" | "command" }>().notNull().default({ widgets: {} }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUq: uniqueIndex("user_preferences_user_uq").on(t.userId),
    tenantIdx: index("user_preferences_tenant_idx").on(t.tenantId),
  }),
);
