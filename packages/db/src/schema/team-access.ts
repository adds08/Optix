import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenant, user } from "./identity";
import { employee } from "./employee";
import { project } from "./project";

// Removal is a durable access decision, independent of historical postings and groups.
export const projectAccessRestriction = pgTable("tbl_ops_project_access_restriction", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
  projectId: uuid("project_id").notNull().references(() => project.id),
  employeeId: uuid("employee_id").notNull().references(() => employee.id),
  createdByUserId: uuid("created_by_user_id").references(() => user.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
}, t => ({ unique: uniqueIndex("project_access_restriction_uq").on(t.tenantId, t.projectId, t.employeeId) }));
