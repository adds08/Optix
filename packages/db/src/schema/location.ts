import { boolean, decimal, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./identity";
import { employee } from "./employee";
import { project } from "./project";

export const warehouse = pgTable(
  "tbl_entity_warehouse",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    region: text("region"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("warehouse_tenant_idx").on(t.tenantId),
  }),
);

// Polymorphic "place an asset can be." A vehicle is a location that can itself move.
export const location = pgTable(
  "tbl_entity_location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // warehouse | site_container | gang_box | vehicle | project_site
    name: text("name").notNull(),
    warehouseId: uuid("warehouse_id").references(() => warehouse.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    parentLocationId: uuid("parent_location_id").references((): any => location.id, { onDelete: "set null" }),
    // Who holds this container. Nobody checks out forty tools one at a time —
    // they take a trailer or a gang box, and the contents follow. Null for
    // places nobody carries (a warehouse, a project site).
    custodianEmployeeId: uuid("custodian_employee_id").references(() => employee.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("location_tenant_idx").on(t.tenantId),
    parentIdx: index("location_parent_idx").on(t.parentLocationId),
    custodianIdx: index("location_custodian_idx").on(t.custodianEmployeeId),
  }),
);

/*
  EQUIPMENT — the register of things the company owns that are not small tools.

  Still called `vehicle` because trucks and trailers were the only kind when it
  was written, and renaming it reaches `assignment`'s composite foreign keys
  (`truck_id, truck_kind` and `trailer_id, trailer_kind` both point at
  `vehicle(id, vehicle_type)`), `transfer`, every router and the seed. The name
  is wrong and the shape is right; rename it in its own change when Equipment
  gets a screen, not in the middle of widening it.

  Small tools are NOT here and are not equipment. `asset` is the small-tools
  register — drills, saws, generators, grinders, survey gear — and holds no
  plant at all. The two are separate entities that happen to both be owned.

  1:1 with a `location`, and that stays true for heavy equipment: `location` is
  "a place an asset can be", and an excavator parked at a yard is exactly that.
  It is also what makes "tools riding on it" expressible without a second
  mechanism.
*/
export const vehicle = pgTable(
  "tbl_entity_vehicle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull().references(() => location.id, { onDelete: "cascade" }),
    /*
      Which half of the register this row is: a road vehicle, or plant.

      Defaulted to 'vehicle' so every existing truck and trailer keeps its
      meaning without a backfill. `vehicleType` below stays the truck|trailer
      discriminator the composite FKs depend on — a heavy row can never be
      referenced in a truck or trailer slot, which is correct: you do not tow a
      gang box with an excavator.
    */
    equipmentClass: text("equipment_class").notNull().default("vehicle"), // vehicle | heavy
    vehicleType: text("vehicle_type").notNull(), // truck | trailer (class 'vehicle'); plant type for 'heavy'
    /*
      CAPABILITY, not state. `canAttach` means this thing can tow or carry
      another piece of equipment; `isAttachable` means it can be towed or
      carried. A truck is the first, a trailer the second, and some plant is
      either or both — which is why these are two booleans rather than one enum.

      What is actually attached to what RIGHT NOW is deliberately not here. That
      is `assignment.truckId` + `assignment.trailerId`, which is ledger-derived
      like every other piece of "where is it" in this system. A current
      `attached_to_id` column would be a second way to write custody, and this
      codebase has paid for that pattern more than once — see
      `packages/api-contracts/src/custody.ts`.
    */
    canAttach: boolean("can_attach").notNull().default(false),
    isAttachable: boolean("is_attachable").notNull().default(false),
    unit: text("unit").notNull(),
    plate: text("plate"),
    makeModel: text("make_model"),
    ownershipType: text("ownership_type").notNull().default("company_owned"), // company_owned | personal_allowance
    payeeEmployeeId: uuid("payee_employee_id").references(() => employee.id, { onDelete: "set null" }),
    // NOTE: mirrors location.custodianEmployeeId on this vehicle's location row.
    // The location column is authoritative; this one is kept in sync because the
    // locations page, vehicle form and import spec already read it. Collapse the
    // two once those move over.
    allowanceRate: decimal("allowance_rate", { precision: 10, scale: 2 }),
    allowanceFrequency: text("allowance_frequency"), // weekly | monthly
    gpsLat: decimal("gps_lat", { precision: 10, scale: 6 }),
    gpsLng: decimal("gps_lng", { precision: 11, scale: 6 }),
    gpsAt: timestamp("gps_at", { withTimezone: true }),
    gpsSource: text("gps_source"),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    foremanEmployeeId: uuid("foreman_employee_id").references(() => employee.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_tenant_idx").on(t.tenantId),
    locationIdx: index("vehicle_location_idx").on(t.locationId),
    /*
      STI-202: `id` is the PK, so this pair is trivially unique — it exists
      only as the referenceable target for assignment's composite FKs
      (assignment_truck_fk / assignment_trailer_fk), which is how the database
      can insist that a truckId names a truck. See the comment on those FKs
      in schema/asset.ts.
    */
    idTypeUq: unique("vehicle_id_type_uq").on(t.id, t.vehicleType),
    /*
      One COMPANY truck per foreman, enforced at the database (STI-502).

      A rig is one truck, one trailer, one foreman. The rule was stated in the
      plan and in three documents and enforced nowhere, so nothing stopped a
      second truck being stamped onto the same person — at which point
      `rigOf()` picks whichever row the query happens to return first and two
      screens can disagree about what a crew drives.

      Three deliberate narrowings, each one a case that would otherwise be
      broken by this index:

      PARTIAL on `foreman_employee_id IS NOT NULL` — a yard full of unheld
      trucks is the normal resting state, and NULLs must not collide.

      COMPANY-OWNED ONLY. A foreman may draw a personal-allowance truck AND
      drive a company one; that pair is the entire premise of STI-306, where a
      departure reassigns the company vehicle and the personal one leaves with
      the person. Constraining across both would forbid the arrangement the
      departure logic exists to handle — caught by departure.test.ts, whose
      fixture builds exactly that foreman. A vehicle somebody owns is also
      simply not the rig, and not this system's to ration.

      TRUCKS ONLY. The same index for trailers would be wrong on Urban's real
      data: FELIPE PORTILLO holds TE-017 (22 tools) and TE-027 (30 tools),
      both imported from the tools list, and the seed carries his posting note
      "Assigned with trailer TE-017, TE-027". One foreman really does run two
      loaded trailers, so a unique index there would fail the migration on
      correct production data rather than prevent a defect. See STI-502.
    */
    oneTruckPerForemanUq: uniqueIndex("vehicle_one_truck_per_foreman_uq")
      .on(t.tenantId, t.foremanEmployeeId)
      .where(
        sql`${t.vehicleType} = 'truck' AND ${t.foremanEmployeeId} IS NOT NULL AND ${t.ownershipType} = 'company_owned'`,
      ),
  }),
);
