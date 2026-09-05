import { decimal, index, integer, date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";

export const project = pgTable(
  "tbl_entity_project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    /* The project code shown to users — see `.claude/rules/database.md`. Also the
       FoundationSoft / Mark 85 map (seam for future sync). */
    externalId: text("external_id"),
    name: text("name").notNull(),
    description: text("description"),
    // not_awarded | awarded | in_progress | completed | cancelled | on_hold — see PROJECT_STATUSES
    status: text("status").notNull().default("not_awarded"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    siteAddress: text("site_address"), // where the job physically is
    /*
      A point and a radius, not a polygon. `docs/workings/TIMESHEET_PORT.md` puts
      Leaflet polygon geofencing in a later operational-modules phase and names it
      explicitly as a de-scope lever — building a polygon model here would be
      guessing at a shape that product has not settled. This answers "where is
      the job and roughly how big is it", which is what the onboarding map step
      needs, and a polygon column can be added beside these later without
      migrating them.

      Same precision as `vehicle.gpsLat`/`gpsLng` (`location.ts`) — one convention
      for a coordinate pair in this schema, not two.
    */
    latitude: decimal("latitude", { precision: 10, scale: 6 }),
    longitude: decimal("longitude", { precision: 11, scale: 6 }),
    /* Metres. Null alongside a set lat/lng means "pinned, no radius drawn yet" —
       a legal, normal state, not a validation failure. */
    geofenceRadiusM: integer("geofence_radius_m"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("project_tenant_idx").on(t.tenantId),
  }),
);

/*
  There was a `project_phase` table here. It was migrated to every database and
  never held a row: no router read it, no screen wrote it, the seed ignored it.

  Phases are real in the business — a project has them, a project without them
  still counts as having one ("No Phase" is phase zero) — and each carries cost
  codes. None of that reaches small-tools custody, which needs to know the job a
  tool is booked to and nothing finer. FoundationSoft is the system of record for
  cost codes, so modelling phases here before that shape is settled would mean
  migrating twice to arrive at somebody else's schema.

  Dropped rather than kept as a seam: an empty table is not a head start, it is
  a guess that looks like a decision. Rebuild it from what FoundationSoft
  actually exposes, if tools ever need to be booked below job level.
*/
