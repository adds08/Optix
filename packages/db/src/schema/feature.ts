import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";

/*
  Generalises ADR-11 (docs/06-decisions.md) from a binary
  `tenant_settings.disabled_modules` list — specified but never built — into
  four states, because the first real consumer (an "AI Import" menu item,
  see apps/web/components/import-dialog.tsx) needed "visible but not yet
  usable", which a hide/show list cannot express.

  A keyed table rather than a jsonb column on `tenantSettings`: feature keys
  grow over time (a nav item id today, an in-page feature like `import.ai`
  tomorrow), and a bag of arbitrary keys on a fixed-shape settings row is
  neither queryable nor auditable the way a real table is. No row for a key
  means "enabled" — the default has to be the common case, or every tenant
  created before a new feature existed would silently lose it.

  This table decides PRESENTATION only, exactly as ADR-11 requires of its
  binary predecessor: hiding a key removes the nav row or greys a button, and
  changes nothing about what a permission check behind it allows. Settings
  can never be hidden regardless of what a row here says — enforced in
  apps/web/components/sti/nav-config.ts, not here, because the exemption is
  about which GROUP a key belongs to, a fact this table has no way to know.
*/
export const tenantFeature = pgTable(
  "tbl_entity_tenant_feature",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    /* A nav item's stable `id` (nav-config.ts), or a dotted in-page key like
       `import.ai`. Free text — the vocabulary lives wherever the key is
       consumed, the same way every other status column in this schema does
       (see .claude/rules/database.md). */
    key: text("key").notNull(),
    // enabled | beta | upcoming | hidden — see FEATURE_STATES in @stinventory/types
    state: text("state").notNull().default("enabled"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("tenant_feature_tenant_idx").on(t.tenantId),
    tenantKeyUq: uniqueIndex("tenant_feature_tenant_key_uq").on(t.tenantId, t.key),
  }),
);
