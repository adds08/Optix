import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";
import { user } from "./identity";
import { employee } from "./employee";
import { asset } from "./asset";
import { project } from "./project";

export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("pending"),
    priority: text("priority").notNull().default("medium"),
    assignedToEmployeeId: uuid("assigned_to_employee_id").references(() => employee.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => user.id, { onDelete: "set null" }),
    relatedAssetId: uuid("related_asset_id").references(() => asset.id, { onDelete: "set null" }),
    relatedProjectId: uuid("related_project_id").references(() => project.id, { onDelete: "set null" }),
    source: text("source").notNull().default("chat"),
    sourceMessageId: uuid("source_message_id"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("task_tenant_idx").on(t.tenantId),
    statusIdx: index("task_status_idx").on(t.status),
    assigneeIdx: index("task_assignee_idx").on(t.assignedToEmployeeId),
  }),
);
