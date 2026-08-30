import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";

/*
  Who pays for a tool when it is not a job.

  Mirrors `project` as a financial target, not an operational one — mechanics
  work out of the shop, not a site, and their tools still have to be charged to
  something.

  Distinct from `task.department` (a chat-routing label) — that is not this.
  A GL code string on `project` itself (`costCenter`) existed briefly and was
  dropped 2026-08-29 as unused; this table is not a replacement for it and
  never was.
*/
export const department = pgTable(
  "tbl_entity_department",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /* Short code for reports and exports — "RM". Optional; the name is the
       identity, this is a convenience. */
    code: text("code"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("department_tenant_idx").on(t.tenantId),
    tenantNameUq: uniqueIndex("department_tenant_name_uq").on(t.tenantId, t.name),
  }),
);
