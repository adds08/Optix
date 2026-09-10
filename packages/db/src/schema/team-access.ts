import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenant, user } from "./identity";
import { employee } from "./employee";
import { project } from "./project";

// Removal is a durable access decision, independent of historical postings and groups.
export const projectAccessRestriction = pgTable("tbl_ops_project_access_restriction", {
  id: uuid("id").primaryKey().defaultRandom(),
  /* CASCADE on all three, matching every sibling table. Without it a tenant
     cannot be deleted while a restriction exists — `SEED_RESET` and every test
     teardown failed on this FK, which is how orphan test tenants accumulated
     in the dev database (four before anyone looked, then six more). A
     restriction is meaningless once its tenant, project or person is gone. */
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employee.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").references(() => user.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
}, t => ({ unique: uniqueIndex("project_access_restriction_uq").on(t.tenantId, t.projectId, t.employeeId) }));
