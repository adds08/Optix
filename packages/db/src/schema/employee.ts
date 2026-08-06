import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

/*
  Who works on which project — the role-based team roster.

  `employee_project_assignment` answers "where were this person's tools" (the
  charging history behind tools-follow-the-foreman). This table answers a
  different question: "who runs this job" — the PM, the superintendents, and
  the foremen working it, each as its own row so a person can hold one role on
  several projects (a PM runs three jobs) and several people share one role.

  The assignment hierarchy is enforced in project.team.assign, not here:
    - Admins / the equipment department assign PMs.
    - Admins, PMs and the equipment department assign superintendents.
    - Admins, PMs, superintendents and the equipment department assign foremen.

  A foreman's team row is kept in lockstep with their posting
  (employee_project_assignment): linking a foreman to a project here IS "they
  are working there now", which is the rule the Tools by Jobsite hub is built
  on — their tools and truck follow them.

  One current row per (project, employee, role): the partial unique index is
  the physical guarantee. Closing a row means setting `endedOn`, never delete.
*/
export const projectTeamMember = pgTable(
  "project_team_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull().references(() => employee.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'pm' | 'superintendent' | 'foreman'
    assignedByUserId: uuid("assigned_by_user_id").references(() => user.id, { onDelete: "set null" }),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("ptm_tenant_idx").on(t.tenantId),
    projectIdx: index("ptm_project_idx").on(t.projectId),
    employeeIdx: index("ptm_employee_idx").on(t.employeeId),
    oneActiveUq: uniqueIndex("ptm_one_active_uq")
      .on(t.tenantId, t.projectId, t.employeeId, t.role)
      .where(sql`${t.endedOn} is null`),
  }),
);
