import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";
import { project } from "./project";

// A person who can hold custody (foreman, superintendent, etc.). Separate from the
// auth `user`; a foreman who logs in is linked via user.employeeId.
export const employee = pgTable(
  "employee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    externalId: text("external_id"), // BambooHR / Mark 85 map (seam for future sync)
    name: text("name").notNull(),
    role: text("role").notNull().default("foreman"), // EmployeeRole
    primaryProjectId: uuid("primary_project_id").references(() => project.id, { onDelete: "set null" }),
    employmentStatus: text("employment_status").notNull().default("active"), // active | terminated | on_leave
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
    reportsToEmployeeId: uuid("reports_to_employee_id").references((): any => employee.id, { onDelete: "set null" }),
    email: text("email"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("employee_tenant_idx").on(t.tenantId),
  }),
);
