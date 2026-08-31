import { boolean, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { role, tenant, user } from "./identity";
import { companyRole } from "./reference";
import { project } from "./project";

// A person who can hold custody (foreman, superintendent, etc.). Separate from the
// auth `user`; a foreman who logs in is linked via user.employeeId.
export const employee = pgTable(
  "tbl_entity_employee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    /*
      The HR-issued employee ID — the number a person actually knows themselves
      by, printed on the badge and used on the yard's own sheets. It is NOT
      `id`: that is a uuid this system mints and nobody reads aloud.

      Confirmed 2026-08-27 to be one field, not two. It doubles as the
      BambooHR / Mark 85 sync seam, and the temptation is to add a second
      "user_id" column beside it for the HR number — don't. Two columns holding
      the same business identifier is two columns to drift.

      NAMING TRAP, worth the line: this value is sometimes spoken as a person's
      "contact", meaning "the reference we contact them by". It has nothing to
      do with `phone` — see the contact-number note below. Reading a `contact`
      column out of an HR export into a phone field, or the reverse, is the
      mistake this comment exists to stop.
    */
    externalId: text("external_id"),
    name: text("name").notNull(),
    /*
      LEGACY. `roleId` below is the source of truth as of 2026-08-28.

      Kept because the import spec still reads it and because deleting a column
      in the same change that backfills its replacement leaves no way back if the
      backfill is wrong. It holds whatever it held; where a row's role has a
      legacy equivalent the two agree, and where it does not — `crew` has no
      entry in the old nine-value enum — this column keeps its old value and
      means nothing. Read `roleId`.

      Do not add a new reader.
    */
    role: text("role").notNull().default("foreman"), // EmployeeRole
    /*
      THE person's role, and the source of truth for it.

      Lives on the PERSON rather than on the account, which is the whole point:
      a labourer has a role, holds tools, and will never have a login. Putting
      it on `user` made "what is this person" unanswerable for most of the yard.

      `user_role` still carries the same role for anyone who has an account, and
      is the row `resolveSession` reads — auth was deliberately not rewritten
      for this. `user.setRole` is the single writer that keeps the pair in step,
      exactly as `custody.ts` is the single writer for custody. Anything else
      setting one without the other is a bug, and `role-sync.test.ts` says so.
    */
    roleId: uuid("role_id").references(() => role.id, { onDelete: "set null" }),
    /*
      The COMPANY role — the job title HR uses (Carpenter, Operator, Labourer).
      Data, not an enum, and nothing branches on it. Null is normal: most of the
      register predates this and a title is not needed to hold a tool.
    */
    companyRoleId: uuid("company_role_id").references(() => companyRole.id, { onDelete: "set null" }),
    primaryProjectId: uuid("primary_project_id").references(() => project.id, { onDelete: "set null" }),
    employmentStatus: text("employment_status").notNull().default("active"), // active | terminated | on_leave
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
    reportsToEmployeeId: uuid("reports_to_employee_id").references((): any => employee.id, { onDelete: "set null" }),
    /*
      Frequently a PERSONAL address on a domain Urban does not own. Labourers
      and foremen mostly have no company mailbox, so this cannot be treated as
      proof of employment, as a tenant discriminator, or as identity — it is a
      way to reach somebody. `user.email` is the login and is a different thing.
    */
    email: text("email"),
    /*
      ONE number, which is already known to be too few: a person has a mobile, a
      work line and sometimes a personal one, and this column silently picks a
      winner. Recorded rather than fixed here — see docs/10-entity-model.md for
      the typed contact list this becomes. Do not overload it with a second
      number separated by a slash; that has to be parsed by somebody later.
    */
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
  "tbl_ops_employee_project_assignment",
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
  "tbl_ops_project_team_member",
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
    /* Which system put this row here — see TEAM_SOURCES in packages/types.
       Descriptive only: nothing branches on it, and nothing should. It exists
       so that when the equipment department's idea of a crew and payroll's
       disagree, the reconciliation can tell which one wrote the row. That is
       not answerable retrospectively, so the column is added before there is a
       second writer rather than after. Plain `text` like every other
       vocabulary here (see .claude/rules/database.md) — Zod at the router edge
       is what refuses an unlisted value. */
    source: text("source").notNull().default("equipment_department"),
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

/*
  Contact numbers, one row each.

  `employee.phone` is a single column and a person has several numbers — a
  mobile, a work line, sometimes a personal one. A single column does not fail
  loudly when that is untrue; it silently keeps whichever number was typed last,
  and the yard ends up calling a disconnected work line for a foreman whose
  mobile was known all along.

  `employee.phone` is NOT dropped by this change. It still holds the primary
  number and every screen still reads it, so nothing breaks while this fills up.
  Collapsing it into `isPrimary` here is its own change, once something writes
  these rows.

  Naming trap, repeated from `employee.externalId` because it has already caused
  confusion: a person's HR-issued employee id is sometimes spoken as their
  "contact". It is not a contact number and does not belong in this table.
*/
export const employeeContact = pgTable(
  "tbl_entity_employee_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull().references(() => employee.id, { onDelete: "cascade" }),
    /* mobile | work | personal | home | other */
    kind: text("kind").notNull().default("mobile"),
    value: text("value").notNull(),
    /* At most one primary per person is enforced by the partial index below —
       the same shape as `assignment_one_active_uq`, for the same reason: a rule
       the database keeps cannot be forgotten by a new writer. */
    isPrimary: boolean("is_primary").notNull().default(false),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("employee_contact_tenant_idx").on(t.tenantId),
    employeeIdx: index("employee_contact_employee_idx").on(t.employeeId),
    onePrimaryUq: uniqueIndex("employee_contact_one_primary_uq")
      .on(t.tenantId, t.employeeId)
      .where(sql`${t.isPrimary}`),
  }),
);
