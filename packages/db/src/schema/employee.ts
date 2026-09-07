import { boolean, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { role, tenant, user } from "./identity";
import { companyRole, division } from "./reference";
import { department } from "./department";
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

      Confirmed 2026-08-27 to be one field, not two. The temptation is to add a
      second "user_id" column beside it for the HR number — don't. Two columns
      holding the same business identifier is two columns to drift.

      NAMED `code`, not `externalId`, since 2026-09-06, and the distinction is
      the whole reason `employeeExternalRef` below exists. A CODE is assigned by
      the company: it happens at company level, so the same value identifies
      this person across every system Urban runs. An EXTERNAL ID is a foreign
      system's primary key, minted by them for their own purposes and meaningless
      outside it. This column has only ever held the first kind — badge numbers
      — while its old comment described it as "the BambooHR / Mark 85 sync
      seam", which is the second. Those are different facts and a sync that
      overwrote one with the other would destroy the badge numbers.

      Where a far system's key happens to equal this value, record it as an
      external ref anyway rather than assuming they stay equal.

      NAMING TRAP, worth the line: this value is sometimes spoken as a person's
      "contact", meaning "the reference we contact them by". It has nothing to
      do with `phone` — see the contact-number note below. Reading a `contact`
      column out of an HR export into a phone field, or the reverse, is the
      mistake this comment exists to stop.
    */
    code: text("code"),
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
    /*
      Which arm of the business a person sits in — Operations, Heavy Civil.

      FLAT, and deliberately not nested under `department`. BambooHR ships
      `divisionName` and `departmentName` as two independent fields on one
      record and models no relationship between them; so do we. A sample
      suggesting "Operations" contains "Heavy Civil" is one company's shape read
      off one payload, and baking it into the schema forces every importer to
      resolve department-within-division for data no API supplies that way.

      Which combinations are legitimate is a RULE, not a hierarchy. Confirmed
      with the client 2026-09-06: rules limiting which division or department
      may be offered come later, on top of these two columns.
    */
    divisionId: uuid("division_id").references(() => division.id, { onDelete: "set null" }),
    /*
      The other half of the pair above, and the reason the comment on
      `divisionId` says "these two columns" — until now it named a column that
      did not exist. `BAMBOOHR_PEOPLE_SYNC.md` §4 has mapped `departmentName`
      here since 2026-09-06 while migration `0050` added `division_id` alone,
      so that row of the mapping table pointed at nothing and the gap was
      rediscovered twice before being closed.

      `tbl_entity_department` is NOT new and was not created for this.
      `asset.owning_department_id` has referenced it for cost targets since
      long before any HR sync existed, which is why this is a column on
      `employee` rather than a table plus a column: the vocabulary already
      exists, and a second departments table would be the duplication this
      codebase pays for most.

      `set null` rather than `restrict`, matching `divisionId`: retiring a
      department is an org change and must not be blocked by, or cascade into,
      the people who were in it. Nullable because most of the register predates
      it and a department is not needed to hold a tool.
    */
    departmentId: uuid("department_id").references(() => department.id, { onDelete: "set null" }),
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
    /*
      Who this person answers to ON THIS JOB — the org chart's only edge.

      Deliberately NOT a rank on the role. A rank asserts one company-wide
      ladder ("a PM always outranks a superintendent"), and Optix is multi-tenant
      selling to construction firms whose structures genuinely differ — the
      client's own chain is director -> area in-charge -> PM & general
      superintendent -> superintendent -> foreman, and the next customer's will
      not be. Recording the edge per row asserts nothing and can represent any
      shape, including the messy ones: a PM who acts as area in-charge on the one
      job in his patch is two rows, not a contradiction.

      NOT the same thing as `employee.reportsToEmployeeId`, and not a revival of
      it. That column was dropped from scoping on 2026-08-23 (scope.ts crewOf)
      precisely because it lived on the PERSON, away from the roster, and drifted
      from it. This lives on the roster row itself, so it cannot disagree with
      the row that says where the person is working. `employee.reportsToEmployeeId`
      stays what it became: a display field on the People screen.

      NULL is normal and legal — "no boss recorded yet". Those rows hang off the
      project in the chart rather than being rejected at the door; a yard that
      has not decided who reports to whom must still be able to record that
      somebody is on the job.

      Points at an EMPLOYEE, not at another team row, so the person named needs
      no row of their own on this project. That is what lets one director sit
      above forty jobs without forty rows restating it.
    */
    reportsToEmployeeId: uuid("reports_to_employee_id").references(() => employee.id, { onDelete: "set null" }),
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
    /*
      Verified by the person who owns this decision, or null if not yet.

      The case this exists for: a superintendent puts a foreman on a job, and the
      PM above them onboards afterwards. The PM should see what the superintendent
      already did rather than an empty crew step, and say "yes, that's right" once.
      Null means nobody senior has looked at it, which is a normal state and not
      an error — most rows written by an administrator are confirmed on creation
      because the person writing them IS the decision-maker.

      NOT a gate on anything. The row is live from the moment it is written: a
      foreman's roster row physically moves their tools and truck (see
      `project-assign.ts`), and that happens on write, not on confirmation.
      Making custody wait for a confirmation would change the custody model, and
      any diff that does so needs to say it out loud rather than arriving as a
      side effect of this column. What confirmation changes is what the progress
      screen counts as outstanding, and nothing else.
    */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("ptm_tenant_idx").on(t.tenantId),
    projectIdx: index("ptm_project_idx").on(t.projectId),
    employeeIdx: index("ptm_employee_idx").on(t.employeeId),
    /* The chart walks DOWN this edge ("who reports to X") far more than up, so
       the index is on the target, not the source. */
    reportsToIdx: index("ptm_reports_to_idx").on(t.reportsToEmployeeId),
    oneActiveUq: uniqueIndex("ptm_one_active_uq")
      .on(t.tenantId, t.projectId, t.employeeId, t.role)
      .where(sql`${t.endedOn} is null`),
  }),
);

/*
  A tier somebody deliberately left for their boss to fill.

  The state this exists to distinguish: a job with no superintendent recorded
  because nobody got round to it, versus one with no superintendent recorded
  because the foreman said "my PM names those". Absence cannot tell those apart,
  and without the distinction the first reads as an outstanding task on the
  foreman forever, and the second never reaches the PM at all.

  The same reasoning as `role.needsLogin` on the people register: "we have not
  invited them" and "they will never have an account" look identical in the data
  until something records the intent.

  Rows are CLOSED, never deleted, by `resolvedAt` — the audit answer to "who was
  supposed to do this and did it happen" needs the history, and a deleted row
  says nothing. Closing is the job of `projectTeam.assign`: the moment a roster
  row appears for this (project, team role), the deferral has been answered and
  is stamped. That is the single writer, and a deferral closed anywhere else
  would drift from the roster the way every parallel record in this codebase
  eventually has.

  NOT scoped to the person who deferred. The question a PM's screen asks is
  "what is waiting for me on this job", and two foremen on one job both deferring
  the superintendent tier is one outstanding decision, not two. The unique index
  says so.
*/
export const projectRoleDeferral = pgTable(
  "tbl_ops_project_role_deferral",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
    /* The team-role NAME, matching `project_team_member.role` — the same
       vocabulary and the same reason it is text here (see that column). Not a
       foreign key to `team_role.id`: a tier deleted from the register should
       leave the history of what was deferred readable, exactly as a closed
       roster row naming a since-renamed tier does. */
    teamRole: text("team_role").notNull(),
    deferredByUserId: uuid("deferred_by_user_id").references(() => user.id, { onDelete: "set null" }),
    /* Who it was pushed to, when the person knew. Null means "whoever owns this
       tier" — the ladder answers that, and it may not have been decided yet. */
    deferredToEmployeeId: uuid("deferred_to_employee_id").references(() => employee.id, { onDelete: "set null" }),
    note: text("note"),
    /* Stamped when a roster row for this (project, team role) appears. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("prd_tenant_idx").on(t.tenantId),
    projectIdx: index("prd_project_idx").on(t.projectId),
    /* One open deferral per job and tier, the same partial-index shape
       `ptm_one_active_uq` uses for the same reason: a rule the database keeps
       cannot be forgotten by a second writer. */
    oneOpenUq: uniqueIndex("prd_one_open_uq")
      .on(t.tenantId, t.projectId, t.teamRole)
      .where(sql`${t.resolvedAt} is null`),
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

  Naming trap, repeated from `employee.code` because it has already caused
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

/*
  One row per (person, far system) — how somebody else's database identifies
  this person.

  NOT the same thing as `employee.code`, and keeping them apart is the whole
  point. A code is Urban's own, assigned at company level, and the same value
  identifies the person in every system Urban runs. An external id is a foreign
  primary key: BambooHR minted `4471` for its own purposes and it means nothing
  outside BambooHR. The old `employee.external_id` column held the first kind
  under a name promising the second, and a sync that believed the name would
  have overwritten every badge number in the register.

  A CHILD TABLE rather than two more columns on `employee`, because a
  (external_system, external_id) pair holds exactly ONE far system per person
  and this codebase's own comments already name three — BambooHR, Mark 85,
  FoundationSoft. The pair gets widened or duplicated the first time a second
  system syncs, and widening an identity column is the kind of migration that
  goes wrong quietly.

  It also lets the unique index say the true thing: the same digits arriving
  from two different systems are two different facts and must not collide.

  `project.externalId` still carries the identical double duty — its own comment
  says "the project code shown to users" AND "the FoundationSoft / Mark 85 map".
  That is deliberately NOT fixed here; recorded so the next reader knows it is
  known rather than missed.
*/
export const employeeExternalRef = pgTable(
  "tbl_entity_employee_external_ref",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull().references(() => employee.id, { onDelete: "cascade" }),
    /* bamboohr | mark85 | foundationsoft — plain text like every other
       vocabulary here (.claude/rules/database.md); Zod at the router edge is
       what refuses an unlisted value. */
    system: text("system").notNull(),
    /* Their primary key, VERBATIM. Never normalised, never parsed — the far
       system is free to change what its ids look like and we only have to send
       them back unaltered. */
    externalId: text("external_id").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /*
      Fields the API refused to tell us, by their name in the far system.

      BambooHR returns `null` for a field the caller may not read and names it
      in `_restrictedFields` — so null means "not permitted", not "cleared". An
      importer treating the two the same blanks real data on the second sync.
      Stored so a thin record is explainable later instead of looking like bad
      data somebody typed.
    */
    restrictedFields: jsonb("restricted_fields"),
    /*
      The last payload, as received.

      Earns its place twice over: when a sync produces a wrong value the only
      useful question is "what did they actually send", which is unanswerable
      after the fact without this; and it is what makes the NEXT sync a diff
      rather than a blind overwrite.
    */
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("eer_tenant_idx").on(t.tenantId),
    employeeIdx: index("eer_employee_idx").on(t.employeeId),
    /* One id per system per tenant: two of our people cannot both be BambooHR
       employee 4471. This is what makes a re-run idempotent rather than
       duplicating the whole directory. */
    systemIdUq: uniqueIndex("eer_system_id_uq").on(t.tenantId, t.system, t.externalId),
    /* And one ref per system per person, from the other direction: a re-sync
       updates the row it already wrote instead of adding a second. */
    employeeSystemUq: uniqueIndex("eer_employee_system_uq").on(t.tenantId, t.employeeId, t.system),
  }),
);
