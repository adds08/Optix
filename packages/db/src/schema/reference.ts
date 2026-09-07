import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";

/*
  Reference data an organisation maintains for itself: the lists that appear in
  dropdowns and are edited by an administrator rather than by the code.

  The bar for a table in here is deliberately high, because this repo has been
  burned by the opposite. `project_phase` was designed, migrated to every
  database, and never held a row — no router read it, no screen wrote it — and
  was eventually dropped with the note that "an empty table is not a head start,
  it is a guess that looks like a decision". Everything below is seeded with real
  rows in the same change that adds it, so none of it is that guess.
*/

/*
  What KIND of quantity a unit measures — length, mass, area, volume, count,
  and the awkward one, lump sum.

  A table rather than an enum because the categories themselves are the sort of
  thing a business adds to (labour hours, cubic yards of a specific mix), and
  because a unit's category is what makes conversion and validation possible
  later: adding square feet to yards is a bug, adding square feet to square
  yards is arithmetic. Nothing converts yet — this records the axis so that when
  something does, the data is already sorted along it.
*/
export const uomCategory = pgTable(
  "tbl_entity_uom_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /* Stable machine key — "length", "mass". Lets a seed be idempotent and a
       report group by something the user cannot rename out from under it. */
    code: text("code").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("uom_category_tenant_idx").on(t.tenantId),
    tenantCodeUq: uniqueIndex("uom_category_tenant_code_uq").on(t.tenantId, t.code),
  }),
);

/*
  A unit somebody actually types on a form: SF, SY, LF, TON, LS, EA.

  `symbol` is the identity a person recognises and the thing printed on a
  takeoff; `name` is the long form for a dropdown. Both are needed — "SY" is
  unreadable in a settings screen and "Square Yard" is unusable in a table cell.

  Lump sum is in here on purpose even though it measures nothing. It is how a
  line item that is not quantified gets priced, so leaving it out means the one
  case that does not fit the model is also the one with nowhere to go.
*/
export const unitOfMeasure = pgTable(
  "tbl_entity_unit_of_measure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => uomCategory.id, { onDelete: "set null" }),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("uom_tenant_idx").on(t.tenantId),
    tenantSymbolUq: uniqueIndex("uom_tenant_symbol_uq").on(t.tenantId, t.symbol),
  }),
);

/*
  The COMPANY role — a person's job title as HR describes it. Carpenter,
  Operator, Labourer, Electrician.

  Deliberately NOT the same thing as `employee.role`, and the distinction is the
  whole reason this table exists. `employee.role` is the OPERATIONAL role the
  system keys behaviour off: it decides who can hold a tool, who gets the field
  navigation rather than the desk, and who appears in a custodian picker. It is
  an enum in `packages/types` because code branches on its values, and adding a
  value there is a code change on purpose.

  A job title is not that. It reorganises, it varies by trade, and nothing in
  this system should branch on it — so it is data an administrator edits, with
  no behaviour attached. Two foremen can hold different titles and the product
  must not care.

  System roles (permissions) are a third thing again and stay in code, in
  `packages/db/src/role-perms.ts` with a matrix test. A permission model that
  can be edited in a settings screen is a permission model that can be edited by
  whoever gets into the settings screen.
*/
export const companyRole = pgTable(
  "tbl_entity_company_role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /* Short code for exports and payroll mapping — "CARP". Optional; the name
       is the identity, mirroring `department.code`. */
    code: text("code"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("company_role_tenant_idx").on(t.tenantId),
    tenantNameUq: uniqueIndex("company_role_tenant_name_uq").on(t.tenantId, t.name),
  }),
);

/*
  The tiers a project_team_member row can occupy — pm, superintendent, foreman
  today. A table rather than the literal array `TEAM_ROLES` used to be
  (`routers/projectTeam.ts`), for the reason the client stated directly:
  "the roles and tiers are not fully set, this can expand later" — Urban's real
  chain is director -> area in-charge -> PM & general superintendent ->
  superintendent -> foreman, deeper than the three the product launched with,
  and the NEXT tenant's chain will not be the same shape at all.

  NOT the same thing as `role` (tbl_entity_role, the login/permission role) or
  `companyRole` (tbl_entity_company_role, the HR job title). Confirmed
  deliberately separate 2026-09-03 after nearly conflating this with `role`:
  the seed already has one person whose LOGIN role is `engineer` and whose team
  role is `pm` — the two vocabularies diverge for the same person on purpose,
  and a lookup between them would be exactly the two-lists-that-drift pattern
  `role`'s own header comment was written to end.

  `name` is what gets written into `project_team_member.role` and validated by
  the Zod edge in `projectTeam.assign`/`remove` — so renaming a row here that a
  project is currently using orphans that history's display, the same trade-off
  `department.code` already accepts. `canHoldCustody` replaces the hard-coded
  `TOOLS_FOLLOW` array: a tier can run a job without moving tools, which is
  exactly what a director or an area in-charge is.
*/
export const teamRole = pgTable(
  "tbl_entity_team_role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    label: text("label").notNull(),
    canHoldCustody: boolean("can_hold_custody").notNull().default(false),
    /*
      Which tier this tier answers to, as the COMPANY declares it — the ladder
      itself, with no people in it.

      Deliberately not a rank number. A rank asserts one total order and cannot
      express a register where two tiers share a boss, which is the normal case
      here: Urban's PM and general superintendent both answer to the area
      in-charge. An edge can say that; `rank: 3` twice cannot.

      NOT a revival of the thing `project_team_member.reportsToEmployeeId`'s
      comment refuses. What that comment forbids is a company-wide ladder
      asserted IN CODE, on the grounds that construction firms genuinely differ
      in shape. This is per-tenant data the tenant edits on the Team Roles
      screen, the same category of thing every other column on this table is,
      and the next customer's ladder is their own rows.

      Nothing about ACCESS may read this. `assertCanAssign` keeps naming
      `project.assign.pm` and friends; a permission decision made out of this
      column is exactly the drift the roster comment was written to prevent.
      Its two jobs are to tell the onboarding wizard which tiers to ask a person
      about, and to tell the progress screen whose work sits below whose.

      It SEEDS, it does not bind: a `project_team_member.reportsToEmployeeId`
      that disagrees with this ladder is legal and wins, because a real job
      beats a template. Null means top of the chain, or not decided yet — both
      normal, and a register whose rows all hold null is a tenant that has not
      described itself, not a broken one.
    */
    reportsToTeamRoleId: uuid("reports_to_team_role_id").references((): any => teamRole.id, { onDelete: "set null" }),
    /* pm, superintendent, foreman ship with the product and cannot be deleted
       — `projectTeam.remove` and the existing permission matrix
       (`project.assign.pm` etc.) name them directly. A tenant's own additions
       (director, area in-charge, ...) carry no dedicated permission and are
       gated by `project.team.assign` instead — see `assertCanAssign`. */
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("team_role_tenant_idx").on(t.tenantId),
    tenantNameUq: uniqueIndex("team_role_tenant_name_uq").on(t.tenantId, t.name),
  }),
);

/*
  An arm of the business — Operations, Heavy Civil, Utilities.

  Sits BESIDE `department`, not above it. `department` (tbl_entity_department)
  answers "who pays for this tool when it is not a job" — it is a financial
  target that mirrors `project`, which is why a mechanic working out of the shop
  still has something to charge to. A division is not that: it is which arm of
  the company a PERSON belongs to, and nothing is charged to it.

  Flat by decision, not by omission. See the comment on `employee.divisionId`
  for why department is not nested under it.

  Shaped exactly like `department` and `companyRole` — name is the identity,
  `code` is a convenience for exports — because it is the same category of
  thing: reference data an administrator maintains, that no code branches on.
*/
export const division = pgTable(
  "tbl_entity_division",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("division_tenant_idx").on(t.tenantId),
    tenantNameUq: uniqueIndex("division_tenant_name_uq").on(t.tenantId, t.name),
  }),
);
