import { date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";

export const project = pgTable(
  "tbl_entity_project",
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

/*
  There was a `project_phase` table here. It was migrated to every database and
  never held a row: no router read it, no screen wrote it, the seed ignored it.

  Phases are real in the business — a project has them, a project without them
  still counts as having one ("No Phase" is phase zero) — and each carries cost
  codes. None of that reaches small-tools custody, which needs to know the job a
  tool is booked to and nothing finer. FoundationSoft is the system of record for
  cost codes, so modelling phases here before that shape is settled would mean
  migrating twice to arrive at somebody else's schema.

  Dropped rather than kept as a seam: an empty table is not a head start, it is
  a guess that looks like a decision. Rebuild it from what FoundationSoft
  actually exposes, if tools ever need to be booked below job level.
*/
