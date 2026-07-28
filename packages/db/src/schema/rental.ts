import { date, decimal, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant, user } from "./identity";
import { project } from "./project";
import { employee } from "./employee";

/*
  Equipment Urban rents, as opposed to equipment Urban owns.

  These are deliberately NOT rows in `asset`. The register's central rule is
  that the Equipment Department owns every asset and ownership never transfers
  — the whole custody model, `owning_project_id`, the tag/assign/dispose event
  vocabulary, all of it assumes a thing Urban bought. A rented pump breaks
  every one of those: nobody's capital bought it, it is never disposed, and it
  has a date on which it must go back or the meter keeps running.

  Mixing the two would corrupt the one number the register exists to produce —
  what Urban's own fleet is worth and where it is.

  The operational difference that matters: an owned tool sitting idle is
  wasted capital, and someone will get to it eventually. A rented one sitting
  idle is an invoice arriving every day until someone calls it off rent.
*/

export const vendor = pgTable(
  "vendor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /* Urban's account number with this vendor — the number on the invoice and
       the one their rep asks for. */
    accountNumber: text("account_number"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    /* Their id for us in an integration, when one exists. */
    externalId: text("external_id"),
    isActive: text("is_active").notNull().default("active"), // active | inactive
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vendor_tenant_idx").on(t.tenantId),
  }),
);

/*
  One quote or contract from a vendor.

  `jobsiteLabel` and `orderedByLabel` hold the vendor's own text verbatim.
  United Rentals knows a job as "TXDOT PUMP STATION IMPROVEMENT"; Urban knows
  it as "Legacy West Phase 3" with a cost code. Those will not match, and
  forcing a foreign key at import time would reject every row of a real export.
  So the raw text is kept and `projectId` is filled in when somebody confirms
  the match — the label is what arrived, the link is what was decided.
*/
export const rentalOrder = pgTable(
  "rental_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id").notNull().references(() => vendor.id, { onDelete: "restrict" }),
    /* The vendor's contract or quote number — what you quote back to them on
       the phone. Unique per vendor within a tenant. */
    externalNumber: text("external_number").notNull(),
    orderType: text("order_type").notNull().default("quote"), // RentalOrderType
    status: text("status").notNull().default("quoted"), // RentalOrderStatus

    jobsiteLabel: text("jobsite_label"),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    orderedByLabel: text("ordered_by_label"),
    orderedByEmployeeId: uuid("ordered_by_employee_id").references(() => employee.id, { onDelete: "set null" }),

    startDate: date("start_date"),
    endDate: date("end_date"),
    notes: text("notes"),

    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("rental_order_tenant_idx").on(t.tenantId),
    vendorIdx: index("rental_order_vendor_idx").on(t.vendorId),
    numberIdx: index("rental_order_number_idx").on(t.externalNumber),
    statusIdx: index("rental_order_status_idx").on(t.status),
    projectIdx: index("rental_order_project_idx").on(t.projectId),
  }),
);

/*
  A line on that order: one kind of equipment, in some quantity.

  `catClass` is the vendor's catalogue code (United Rentals' "520-6005" is a
  12x8 diesel vacuum-assisted pump). It is their identifier, not ours, which is
  exactly why it is worth storing — it is what makes two lines on two different
  contracts comparable, and what a future catalogue integration keys on.

  Rates are nullable and usually null. The export Urban can pull carries no
  pricing at all, so anything this module says about cost would be invented.
  When rates arrive — typed in, or from an integration — the fields are here;
  until then the UI says it does not know rather than showing a confident zero.
*/
export const rentalLine = pgTable(
  "rental_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => rentalOrder.id, { onDelete: "cascade" }),

    catClass: text("cat_class"),
    itemName: text("item_name").notNull(),
    quantity: integer("quantity").notNull().default(1),

    /* A line can come back before the contract closes, so it carries its own
       dates rather than inheriting the header's. */
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: text("status").notNull().default("quoted"), // RentalLineStatus
    returnedOn: date("returned_on"),

    /* Null means unknown, not free. Never default these to 0. */
    unitRate: decimal("unit_rate", { precision: 12, scale: 2 }),
    rateUnit: text("rate_unit"), // day | week | month

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("rental_line_tenant_idx").on(t.tenantId),
    orderIdx: index("rental_line_order_idx").on(t.orderId),
    statusIdx: index("rental_line_status_idx").on(t.status),
    catClassIdx: index("rental_line_cat_class_idx").on(t.catClass),
  }),
);
