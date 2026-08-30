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
