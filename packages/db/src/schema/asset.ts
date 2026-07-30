import { boolean, date, decimal, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant, user } from "./identity";
import { assetModel } from "./catalog";
import { project } from "./project";
import { location } from "./location";
import { employee } from "./employee";

// The asset register — small tools are the first-class entity.
// `current_*` columns are the PROJECTION (denormalized from `transactions`); never the
// source of truth. `owning_project_id` (financial capital owner) is immutable once set.
export const asset = pgTable(
  "asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    modelId: uuid("model_id").references(() => assetModel.id, { onDelete: "set null" }),
    modelName: text("model_name").notNull(), // denormalized for fast register reads
    categoryName: text("category_name"), // denormalized
    serialNumber: text("serial_number"),
    isSerialized: boolean("is_serialized").notNull().default(true),
    quantity: integer("quantity").notNull().default(1),
    acquisitionCost: decimal("acquisition_cost", { precision: 14, scale: 2 }),
    acquisitionDate: date("acquisition_date"),
    owningProjectId: uuid("owning_project_id").references(() => project.id, { onDelete: "set null" }),
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
    tagIdx: index("asset_tag_idx").on(t.tag),
    custodianIdx: index("asset_custodian_idx").on(t.currentCustodianId),
    projectIdx: index("asset_project_idx").on(t.currentProjectId),
    statusIdx: index("asset_status_idx").on(t.currentStatus),
  }),
);

// Active custody link. At most one row per serialized asset with status = active|pending_approval.
export const assignment = pgTable(
  "assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => asset.id, { onDelete: "cascade" }),
    custodianId: uuid("custodian_id").notNull().references(() => employee.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    locationId: uuid("location_id").references(() => location.id, { onDelete: "set null" }),
    type: text("type").notNull().default("permanent"), // permanent | temporary
    startDate: date("start_date").notNull(),
    expectedEndDate: date("expected_end_date"), // temporary loans require it
    status: text("status").notNull().default("active"), // active | returned | transferred | overdue | pending_approval
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
    status: text("status").notNull().default("pending_approval"), // pending_approval | approved | in_transit | completed | cancelled
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
