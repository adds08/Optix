import { date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    externalId: text("external_id"), // FoundationSoft / Mark 85 map (seam for future sync)
    name: text("name").notNull(),
    status: text("status").notNull().default("active"), // awarded | active | closing | complete
    startDate: date("start_date"),
    endDate: date("end_date"),
    costCenter: text("cost_center"),
    siteAddress: text("site_address"), // where the job physically is
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("project_tenant_idx").on(t.tenantId),
  }),
);

export const projectPhase = pgTable(
  "project_phase",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Every row carries tenant_id from commit one — this table was the one
    // exception and it blocked RLS, because a policy cannot be written against
    // a table with nothing to scope on. Reachable via project_id, but RLS
    // policies do not follow joins.
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    startDate: date("start_date"),
    endDate: date("end_date"),
  },
  (t) => ({
    tenantIdx: index("project_phase_tenant_idx").on(t.tenantId),
    projectIdx: index("project_phase_project_idx").on(t.projectId),
  }),
);
