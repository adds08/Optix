import { date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant, user } from "./identity";
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

/*
  Which job a person was on, and when.

  `employee.primaryProjectId` answers "now" and is overwritten in place, so the
  moment a foreman changes jobs the previous answer is gone. That matters more
  here than in most systems: tools follow the foreman rather than the site, so
  this table IS the charging history — the asset ledger says who held a tool on
  a date, and this says which job that person was running.

  One row per posting. `endedOn` null means current; there should be at most one
  open row per employee.
*/
export const employeeProjectAssignment = pgTable(
  "employee_project_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull().references(() => employee.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
    assignedByUserId: uuid("assigned_by_user_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("epa_tenant_idx").on(t.tenantId),
    employeeIdx: index("epa_employee_idx").on(t.employeeId),
    projectIdx: index("epa_project_idx").on(t.projectId),
  }),
);
