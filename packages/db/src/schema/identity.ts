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
    /*
      When this person proved they own the address — by accepting an invite or
      completing a reset, both of which arrive only in the mailbox.

      Null means the account was created by an administrator and nobody has
      confirmed the address is real. That is a normal state, not an error, and
      the people register shows it as its own thing: an account nobody can reach
      is different from one nobody has used.
    */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /*
      Stamped by `login()`. Null means the account exists and has never been
      used, which is the state an administrator actually wants to see — a login
      handed out three months ago and never touched is either a person who does
      not need it or a person who never got the message.

      Deliberately not a login COUNT: the question is "is this account live",
      and a count invites treating it as activity analytics, which it is not.
    */
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
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

/*
  A ROLE is what a person is in this system: what they may do, whether they need
  a login at all, and how the product behaves for them.

  It replaced three overlapping ideas on 2026-08-28. `employee.role` was an enum
  deciding custody and layout; `user_role` decided permissions; `company_role`
  is the job title HR uses. The first two are the same idea and are now this
  table; `company_role` stays exactly what it was, a label with no behaviour.

  The three booleans are behaviour that used to be hard-coded name lists in the
  client — `FIELD_ROLES` in `nav-config.ts` and the custody-capable set. A new
  role needed a code edit in two places to behave correctly, and the lists had
  already drifted apart once. Data means a role you add works without one.
*/
export const role = pgTable(
  "role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenant.id, { onDelete: "cascade" }), // null = system role
    name: text("name").notNull(),
    description: text("description"),
    /*
      Whether people in this role are expected to sign in.

      False is the normal case for most of a yard: a labourer or an operator
      holds tools and never touches the product. Without this, the people
      register cannot tell "we have not got round to inviting them" from
      "they will never have an account", and every uninvited labourer reads as
      an outstanding task forever.

      It is a STATEMENT OF INTENT, not a control. It changes what the register
      shows and what it nags about. Nothing about authentication reads it — a
      role flipped to false does not disable an account that already exists,
      because a flag on a lookup table must never be load-bearing for access.
    */
    needsLogin: boolean("needs_login").notNull().default(true),
    /* May be named as a tool's custodian. Was a hard-coded set in the domain
       package that three custodian pickers had each copied and drifted from. */
    canHoldCustody: boolean("can_hold_custody").notNull().default(false),
    /* Gets the field layout rather than the desk one — a phone in a yard, not a
       screen at a desk. Was `FIELD_ROLES` in `nav-config.ts`, a literal set of
       role names that had to be edited every time a role was added, and whose
       own comment called itself "wrong by construction". */
    usesFieldLayout: boolean("uses_field_layout").notNull().default(false),
    /*
      A built-in role. Its NAME and its `isSystem` mark cannot be edited away,
      because the seed and the permission matrix in `role-perms.ts` refer to
      these by name. Its permissions and description remain editable — that is
      the point of the roles screen — but renaming `owner` out from under the
      matrix would leave the tenant with no route back.
    */
    isSystem: boolean("is_system").notNull().default(false),
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

/*
  Invite and password-reset links.

  A token table rather than a second `must_change_password`-style flag,
  because the flag's whole design depends on the account already being able
  to log in — an invite is issued to somebody with NO account yet, and a reset
  is issued to somebody locked out of the one they have. Neither can be
  satisfied by a boolean on a row the recipient cannot reach.

  `tokenHash` stores a SHA-256 digest, never the token itself. This table is
  read by an UNAUTHENTICATED endpoint (spending the token), so a leaked row —
  a backup, a `pg_dump` — must not hand out a live credential the way a stored
  plaintext token would. The email is the only place the plaintext exists.

  One table for both kinds because both are the same shape — a single-use,
  time-boxed, unauthenticated action tied to one user — and the consume
  endpoint is one code path either way; `kind` is what it branches on for the
  different consume-time effect (activate an account vs. just set a password).
*/
export const authToken = pgTable(
  "auth_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /* "invite" | "reset" — see AUTH_TOKEN_KINDS in packages/types. Plain text
       like every other status column in this schema (see database.md): the
       database will not stop an unlisted value, Zod at the router/endpoint
       edge does. */
    kind: text("kind").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /* Null until spent. Kept rather than deleted on consume — it is what lets
       the consume endpoint and `resend` tell "already used" apart from
       "never existed", and it is the audit trail that a reset actually
       happened. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("auth_token_tenant_idx").on(t.tenantId),
    userIdx: index("auth_token_user_idx").on(t.userId),
    /* The consume endpoint has no session and therefore nothing to scope a
       lookup by — the same shape `login()` is in when it reads `user` by
       email alone. It looks up by hash only; this unique index is what makes
       "the hash is the whole credential" actually true rather than aspirational. */
    hashUq: uniqueIndex("auth_token_hash_uq").on(t.tokenHash),
  }),
);
