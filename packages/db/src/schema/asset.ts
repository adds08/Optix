import { bigint, boolean, date, decimal, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant, user } from "./identity";
import { assetModel } from "./catalog";
import { project } from "./project";
import { location, vehicle } from "./location";
import { employee } from "./employee";
import { department } from "./department";

// The asset register — small tools are the first-class entity.
// `current_*` columns are the PROJECTION (denormalized from `transactions`); never the
// source of truth. `owning_project_id` (financial capital owner) is immutable once set.
export const asset = pgTable(
  "tbl_entity_asset",
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
      the yard's own sheets. See docs/built/17-optional-tags.md.
    */
    tag: text("tag"),
    modelId: uuid("model_id").references(() => assetModel.id, { onDelete: "set null" }),
    /*
      Vestigial. Nothing reads or writes through `asset_model` / `manufacturer` /
      `asset.modelId` — only the seed populates them and no router, intent or UI
      joins back. They look like an obvious duplicate of the flat make/model
      columns below; leave the normalisation for its own change. See
      docs/built/12-model-field-split.md.
    */
    /* What the tool is, in the four columns Urban's own sheets use. Replaces the
       single `model_name` blob — see docs/built/12-model-field-split.md. */
    make: text("make"),
    modelNumber: text("model_number"),
    description: text("description"),
    /* The unlabelled trailing column on the trailer sheets: a secondary equipment
       number ("PC-08", "QS-602", "106"). Free text because the yard's numbering is
       not ours to constrain. Note this is NOT the sheets' "OTHER" column, which
       holds NEW/USED and maps to `condition` — see docs/built/13-excel-round-trip.md. */
    otherRef: text("other_ref"),
    categoryName: text("category_name"), // denormalized
    serialNumber: text("serial_number"),
    isSerialized: boolean("is_serialized").notNull().default(true),
    quantity: integer("quantity").notNull().default(1),
    acquisitionCost: decimal("acquisition_cost", { precision: 14, scale: 2 }),
    acquisitionDate: date("acquisition_date"),
    owningProjectId: uuid("owning_project_id").references(() => project.id, { onDelete: "set null" }),
    /* Which kind of thing pays for this tool. Set at registration and meant to
       stay put, like owningProjectId — see docs/built/11-department-cost-targets.md. */
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
  "tbl_ops_smalltools_custody",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => asset.id, { onDelete: "cascade" }),
    custodianId: uuid("custodian_id").notNull().references(() => employee.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    /*
      Where the tool sits — three columns, independently recordable, because
      invariant 5 says "job, truck and trailer" and a single place cannot say
      "in trailer TE-011, hitched to truck 12" (STI-201/STI-202):

      - `locationId` — a static PLACE: warehouse, yard, site container, gang
        box. Before STI-202 it also carried "in a trailer" by pointing at the
        vehicle's own location row; rows from that era still do, and stay
        valid. Shape-aware writers (STI-203+) put vehicles in the two columns
        below and use locationId for non-vehicle places only.
      - `truckId` — the truck the tool rides on. FK to `vehicle`, and the
        composite FK below insists that row IS a truck.
      - `trailerId` — likewise, and the row must be a trailer. Both set means
        the trailer is hitched to the truck with the tool aboard.

      What NULL means depends on who wrote the row. A shape-aware writer
      records NULL affirmatively — "in a truck, NO trailer" is truckId set,
      trailerId NULL. On rows that predate these columns NULL means "never
      asked". At row level those are indistinguishable; the authoritative
      record of the difference is the ledger snapshot, where a shape-aware
      writer emits the key with an explicit null and a pre-STI-202 event has
      no such key at all (see packages/domain/src/events.ts, and the
      shape-boundary rule in packages/domain/src/fold.ts).
    */
    locationId: uuid("location_id").references(() => location.id, { onDelete: "set null" }),
    truckId: uuid("truck_id"),
    trailerId: uuid("trailer_id"),
    /*
      Generated constants, not data — they exist so the composite FKs below can
      be written at all. Never read them; read truckId/trailerId. (Generated
      columns cannot take ON DELETE SET NULL, which is why the FKs are NO
      ACTION — see the FK comment.)
    */
    truckKind: text("truck_kind").generatedAlwaysAs(sql`'truck'`),
    trailerKind: text("trailer_kind").generatedAlwaysAs(sql`'trailer'`),
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
    /*
      STI-103: the physical backstop for "at most one active assignment per
      asset". Until this index, custody.ts was the only enforcement — a single
      file, bypassed at least once (assignment.approve), which is how two
      custodians for one tool shipped.

      Keyed on (asset_id) alone, not (tenant_id, asset_id): asset_id is a uuid
      already unique across tenants, so adding tenant_id would not change which
      rows conflict — an asset belongs to exactly one tenant, so both keys have
      identical uniqueness semantics. The narrower key is also the stronger
      guard: a bug that stamps the wrong tenant_id on an assignment row still
      cannot open a second active link for the asset. (Contrast ptm_one_active_uq,
      where the business key is only unique per tenant.)

      The predicate is a raw sql literal on purpose — drizzle-kit 0.28.1 turns
      eq() inside a partial-index WHERE into a $1 placeholder, which fails at
      migrate time with "there is no parameter $1". See docs/tickets/STACK-NOTES.md.
    */
    oneActiveUq: uniqueIndex("assignment_one_active_uq")
      .on(t.assetId)
      .where(sql`${t.status} = 'active'`),
    truckIdx: index("assignment_truck_idx").on(t.truckId),
    trailerIdx: index("assignment_trailer_idx").on(t.trailerId),
    /*
      STI-202 criterion 3: truckId must name a row whose vehicleType is
      'truck', trailerId a 'trailer'. A plain FK cannot say that — both point
      at `vehicle`, discriminated by a text column. This lives in the DATABASE
      rather than as a validation in custody.ts for two reasons:

      1. vehicleType is editable (vehicle.update accepts it), so an
         insert-time check goes stale the moment a referenced truck is edited
         into a trailer. The composite FK holds at both ends: the flip (and a
         delete) fails loudly while any assignment references the vehicle.
      2. App-only enforcement of a structural invariant is how two custodians
         for one tool shipped — assignment_one_active_uq above is the scar.

      The mechanism is not a simple FK: (truck_id, truck_kind) references
      UNIQUE vehicle(id, vehicle_type), with truck_kind generated as the
      constant 'truck' — so a set truck_id must exist as an (id, 'truck')
      pair. MATCH SIMPLE means a NULL truck_id skips the check entirely.
      NO ACTION (not SET NULL, which is illegal on a generated column) means
      the FK blocks a delete or type flip while ANY assignment row — active,
      closed or historical — references the vehicle. The friendly guards in
      front of that raw error live in vehicle.delete and vehicle.update
      (routers/location.ts, STI-203), which is also where every truck/trailer
      id is tenant-checked: vehicle_id_type_uq carries no tenant component,
      so this FK would accept another tenant's truck (assertVehicleContext
      in custody.ts is the gate).
    */
    truckFk: foreignKey({
      columns: [t.truckId, t.truckKind],
      foreignColumns: [vehicle.id, vehicle.vehicleType],
      name: "assignment_truck_fk",
    }),
    trailerFk: foreignKey({
      columns: [t.trailerId, t.trailerKind],
      foreignColumns: [vehicle.id, vehicle.vehicleType],
      name: "assignment_trailer_fk",
    }),
  }),
);

// A movement request/record between two custody states. Cross-person or high-value
// hand-offs require approval (status = pending_approval).
export const transfer = pgTable(
  "tbl_ops_transfer",
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
    /*
      STI-203: the rig the requester named, parked with the rest of the "to"
      state while a high-value hand-off waits for its second signature. NULL
      means "not recorded", same as toProjectId/toLocationId above. Without
      these, a held transfer silently dropped the pick and approve could only
      write `truckId: null` — which the ledger reads as "affirmatively no
      truck", a lie about what the requester said. Applied by transfer.approve
      as explicit values; same composite-FK + generated-kind mechanism as
      assignment (see the long comment there).
    */
    toTruckId: uuid("to_truck_id"),
    toTrailerId: uuid("to_trailer_id"),
    toTruckKind: text("to_truck_kind").generatedAlwaysAs(sql`'truck'`),
    toTrailerKind: text("to_trailer_kind").generatedAlwaysAs(sql`'trailer'`),
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
    toTruckIdx: index("transfer_to_truck_idx").on(t.toTruckId),
    toTrailerIdx: index("transfer_to_trailer_idx").on(t.toTrailerId),
    toTruckFk: foreignKey({
      columns: [t.toTruckId, t.toTruckKind],
      foreignColumns: [vehicle.id, vehicle.vehicleType],
      name: "transfer_to_truck_fk",
    }),
    toTrailerFk: foreignKey({
      columns: [t.toTrailerId, t.toTrailerKind],
      foreignColumns: [vehicle.id, vehicle.vehicleType],
      name: "transfer_to_trailer_fk",
    }),
  }),
);
