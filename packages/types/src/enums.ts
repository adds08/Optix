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
export const VEHICLE_TYPES = ["truck", "trailer"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
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
