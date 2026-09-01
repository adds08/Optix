/*
  Domain enums used by both the type surface and the import specs.

  These live apart from index.ts because index.ts re-exports ./import-specs,
  and import-specs needs these values at module-evaluation time. Keeping them
  here means that re-export is not a cycle — importing them from index would
  leave them in the temporal dead zone and crash on boot.
*/

export const LOCATION_TYPES = [
  "warehouse",
  "site_container",
  "gang_box",
  "vehicle",
  "project_site",
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
/*
  What a row IS, for the composite foreign keys — not what kind of equipment it
  is. `assignment.truckId`/`trailerId` reference `vehicle_id_type_uq` on
  `(id, vehicle_type)` with a generated constant, which is the only way a plain
  FK can insist that a truckId names a truck. So these two values are load-
  bearing literals: adding a third here, or retyping an existing row, breaks
  every assignment referencing it.

  The CATEGORY question — is this a vehicle, an attachment, plant? — is
  `EQUIPMENT_CLASSES` below, which nothing references and is free to grow.
*/
export const VEHICLE_TYPES = ["truck", "trailer"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/*
  What KIND of equipment a register row is, as Urban files it.

  Separate from `VEHICLE_TYPES` on purpose, and the two are easy to confuse:
  `vehicleType` answers a structural question the database enforces, this one
  answers an operational question a person answers on a form. A trailer is
  `vehicleType: 'trailer'` AND `equipmentClass: 'attachment'`, and both are
  true at once.

  `heavy` predates the rest — it was added when the register was trucks and
  trailers only, as a placeholder for plant that had not arrived yet, and
  nothing ever wrote it because no form offered it. `attachment` and `other`
  join it on 2026-09-01 with the control that finally sets them.

  Optional on the form: a yard that has not decided how it files something
  should not be blocked from registering it, so rows default to `vehicle`.
*/
export const EQUIPMENT_CLASSES = ["vehicle", "attachment", "heavy", "other"] as const;
export type EquipmentClass = (typeof EQUIPMENT_CLASSES)[number];

/* What each class is called on screen. The register draws these; don't
   hand-write the strings at call sites, or they drift apart the way three
   custodian pickers did before CUSTODIAN_ROLES existed. */
export const EQUIPMENT_CLASS_LABELS: Record<EquipmentClass, string> = {
  vehicle: "Vehicle",
  attachment: "Attachment",
  heavy: "Heavy equipment",
  other: "Other",
};
export const VEHICLE_OWNERSHIP = ["company_owned", "personal_allowance"] as const;
export type VehicleOwnership = (typeof VEHICLE_OWNERSHIP)[number];
export const EMPLOYEE_ROLES = [
  "foreman",
  "superintendent",
  "pm",
  "equipment_admin",
  "warehouse",
  "mechanic",      // NEW
  "procurement",
  "hr",
  "finance",
] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const COST_TARGETS = ["project", "department"] as const;
export type CostTarget = (typeof COST_TARGETS)[number];

/* Roles that can hold a tool. Foremen carry them to jobs; mechanics keep them
   in the shop. Every custodian picker reads this rather than testing for
   "foreman" itself — three of them had drifted apart before it existed.

   `superintendent` joined on 2026-09-01. A job is often awarded and rigged
   before its foreman is hired, and until then the superintendent running the
   crews is the person physically holding the small tools, the truck and the
   trailer. Leaving them out did not stop that happening — it stopped it being
   RECORDED, so the register showed a rigged job with nobody holding anything.
   Mirrored by `canHoldCustody` on the `superintendent` row in seed-data.ts and
   by migration 0039 for databases that were seeded before this; the flag and
   this list must agree, which is what `rbac-matrix.test.ts` checks. */
export const CUSTODIAN_ROLES = ["foreman", "superintendent", "mechanic"] as const;

/*
  Where a project-team row came from.

  Purely descriptive — nothing branches on it and nothing should. Urban's crews
  are keyed differently in the equipment department, in payroll and in whatever
  the next system turns out to be, so when two of them disagree about who is on
  a job the reconciliation needs to know which one wrote the row. That question
  is unanswerable after the fact unless the row carries the answer from the
  start, which is why this exists before there is a second writer.

  `equipment_department` is the default because the jobsite hub and the people
  screen are the only writers today. Add a value when a new writer appears;
  never repurpose one.
*/
export const TEAM_SOURCES = ["equipment_department", "payroll_import", "manual_entry", "api_sync"] as const;
export type TeamSource = (typeof TEAM_SOURCES)[number];
export const DEFAULT_TEAM_SOURCE: TeamSource = "equipment_department";
export const EMPLOYMENT_STATUSES = ["active", "terminated", "on_leave"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const PROJECT_STATUSES = [
  "not_awarded",
  "awarded",
  "in_progress",
  "completed",
  "cancelled",
  "on_hold",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
/* Mirrors the values documented on asset.condition in the db schema. */
export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

/* A tenant's presentation state for one feature key — a nav item id, or an
   in-page key like "import.ai". See packages/db/src/schema/feature.ts and
   ADR-11's generalization in docs/06-decisions.md. No row for a key means
   "enabled". */
export const FEATURE_STATES = ["enabled", "beta", "upcoming", "hidden"] as const;
export type FeatureState = (typeof FEATURE_STATES)[number];

/* How the tenant's identity block renders in the sidebar footer — see
   tenantSettings.brandingLayoutMode. */
export const BRANDING_LAYOUT_MODES = ["icon_and_text", "icon_only"] as const;
export type BrandingLayoutMode = (typeof BRANDING_LAYOUT_MODES)[number];
