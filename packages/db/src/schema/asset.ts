import { bigint, boolean, date, decimal, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant, user } from "./identity";
import { assetModel } from "./catalog";
import { project } from "./project";
import { location } from "./location";
import { employee } from "./employee";
import { department } from "./department";

// The asset register — small tools are the first-class entity.
// `current_*` columns are the PROJECTION (denormalized from `transactions`); never the
// source of truth. `owning_project_id` (financial capital owner) is immutable once set.
export const asset = pgTable(
  "asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    /*
      The register's own reference number — every asset gets one, stamped by
      the database at insert time (mirrors how `transaction`/`event_log` mint
      their ids), never entered or editable. This exists because `id` is a
      uuid nobody reads off a screen, and `tag` is deliberately the opposite of
      reliable: a physical label that may never have been stuck on the tool at
      all. Reverifying the real source data (docs/data, 2026-08) confirmed
      Urban's own sheets carry no tool-ID column anywhere — every "TOOL-0001"
      style value that predates this column was invented at seed time, not a
      real label. `assetNumber` is what a report or a screen can always point
      to; `tag` and `serialNumber` stay exactly what they were — optional,
      physical, never generated.
    */
    assetNumber: bigint("asset_number", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    /*
      A tag is a physical label on the tool, not an id the system assigns. Null
      means nobody has labelled it yet — a normal state for anything imported from
      the yard's own sheets. See docs/17-optional-tags.md.
    */
    tag: text("tag"),
    modelId: uuid("model_id").references(() => assetModel.id, { onDelete: "set null" }),
    /*
      Vestigial. Nothing reads or writes through `asset_model` / `manufacturer` /
      `asset.modelId` — only the seed populates them and no router, intent or UI
      joins back. They look like an obvious duplicate of the flat make/model
      columns below; leave the normalisation for its own change. See
      docs/12-model-field-split.md.
    */
    /* What the tool is, in the four columns Urban's own sheets use. Replaces the
       single `model_name` blob — see docs/12-model-field-split.md. */
    make: text("make"),
    modelNumber: text("model_number"),
    description: text("description"),
    /* The unlabelled trailing column on the trailer sheets: a secondary equipment
       number ("PC-08", "QS-602", "106"). Free text because the yard's numbering is
       not ours to constrain. Note this is NOT the sheets' "OTHER" column, which
       holds NEW/USED and maps to `condition` — see docs/13-excel-round-trip.md. */
    otherRef: text("other_ref"),
    categoryName: text("category_name"), // denormalized
    serialNumber: text("serial_number"),
    isSerialized: boolean("is_serialized").notNull().default(true),
    quantity: integer("quantity").notNull().default(1),
    acquisitionCost: decimal("acquisition_cost", { precision: 14, scale: 2 }),
    acquisitionDate: date("acquisition_date"),
    owningProjectId: uuid("owning_project_id").references(() => project.id, { onDelete: "set null" }),
    /* Which kind of thing pays for this tool. Set at registration and meant to
       stay put, like owningProjectId — see docs/11-department-cost-targets.md. */
    costTarget: text("cost_target").notNull().default("project"), // 'project' | 'department'
    owningDepartmentId: uuid("owning_department_id").references(() => department.id, { onDelete: "restrict" }),
    warrantyExpiresOn: date("warranty_expires_on"),
    /*
      Object key, not a URL.

      Storing the full URL would bake the storage host into every row, so moving
      from the MinIO container to Spaces later would mean rewriting the register.
      The key is stable; the API turns it into a signed URL at read time.
    */
    photoKey: text("photo_key"),
    // Projection (derived from transactions; never edited directly except by projection builder):
    currentStatus: text("current_status").notNull().default("available"),
    currentCustodianId: uuid("current_custodian_id").references(() => employee.id, { onDelete: "set null" }),
    currentProjectId: uuid("current_project_id").references(() => project.id, { onDelete: "set null" }),
    currentLocationId: uuid("current_location_id").references(() => location.id, { onDelete: "set null" }),
    condition: text("condition").default("good"), // new | good | fair | poor | damaged
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("asset_tenant_idx").on(t.tenantId),
    assetNumberIdx: index("asset_number_idx").on(t.assetNumber),
    tagIdx: index("asset_tag_idx").on(t.tag),
    custodianIdx: index("asset_custodian_idx").on(t.currentCustodianId),
    projectIdx: index("asset_project_idx").on(t.currentProjectId),
    statusIdx: index("asset_status_idx").on(t.currentStatus),
  }),
);

/*
  Active custody link. At most one row per serialized asset with
  status = active|pending_approval.

  `type` (permanent|temporary) and `expectedEndDate` were dropped on 2026-08-09
  along with the borrow model: every link is now simply custody, because tools
  are issued and reassigned by the equipment desk rather than lent between
  foremen. Nothing falls due, so nothing goes overdue.
*/
export const assignment = pgTable(
  "assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => asset.id, { onDelete: "cascade" }),
    custodianId: uuid("custodian_id").notNull().references(() => employee.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    locationId: uuid("location_id").references(() => location.id, { onDelete: "set null" }),
    startDate: date("start_date").notNull(),
    status: text("status").notNull().default("active"), // active | returned | transferred | pending_approval
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("assignment_tenant_idx").on(t.tenantId),
    assetIdx: index("assignment_asset_idx").on(t.assetId),
    custodianIdx: index("assignment_custodian_idx").on(t.custodianId),
    statusIdx: index("assignment_status_idx").on(t.status),
  }),
);

// A movement request/record between two custody states. Cross-person or high-value
// hand-offs require approval (status = pending_approval).
export const transfer = pgTable(
  "transfer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => asset.id, { onDelete: "cascade" }),
    fromCustodianId: uuid("from_custodian_id").references(() => employee.id, { onDelete: "set null" }),
    toCustodianId: uuid("to_custodian_id").references(() => employee.id, { onDelete: "set null" }),
    fromLocationId: uuid("from_location_id").references(() => location.id, { onDelete: "set null" }),
    toLocationId: uuid("to_location_id").references(() => location.id, { onDelete: "set null" }),
    fromProjectId: uuid("from_project_id").references(() => project.id, { onDelete: "set null" }),
    toProjectId: uuid("to_project_id").references(() => project.id, { onDelete: "set null" }),
    reason: text("reason").notNull().default("reallocation"), // TransferReason
    status: text("status").notNull().default("pending_approval"), // pending_approval | approved | completed | cancelled
    requestedBy: uuid("requested_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("transfer_tenant_idx").on(t.tenantId),
    assetIdx: index("transfer_asset_idx").on(t.assetId),
    statusIdx: index("transfer_status_idx").on(t.status),
  }),
);
