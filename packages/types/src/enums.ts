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
   "foreman" itself — three of them had drifted apart before it existed. */
export const CUSTODIAN_ROLES = ["foreman", "mechanic"] as const;
export const EMPLOYMENT_STATUSES = ["active", "terminated", "on_leave"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const PROJECT_STATUSES = ["awarded", "active", "closing", "complete"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
/* Mirrors the values documented on asset.condition in the db schema. */
export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];
