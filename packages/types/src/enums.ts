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
  "procurement",
  "hr",
  "finance",
] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];
export const EMPLOYMENT_STATUSES = ["active", "terminated", "on_leave"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const PROJECT_STATUSES = ["awarded", "active", "closing", "complete"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
/* Mirrors the values documented on asset.condition in the db schema. */
export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

/*
  Rented equipment, which is a different animal from an owned asset.

  The order types are United Rentals' own vocabulary because that is what
  arrives in their export — a quote that was never taken up, a contract still
  running, a contract closed out. Mapping them to invented names would only
  make reconciling against the vendor's paperwork harder.
*/
export const RENTAL_ORDER_TYPES = ["quote", "open_contract", "closed_contract"] as const;
export type RentalOrderType = (typeof RENTAL_ORDER_TYPES)[number];

export const RENTAL_ORDER_STATUSES = ["quoted", "on_rent", "closed", "cancelled"] as const;
export type RentalOrderStatus = (typeof RENTAL_ORDER_STATUSES)[number];

/* A line is `on_rent` until somebody calls it off. `overdue` is derived, never
   stored — see isRentalOverdue in @stinventory/domain. */
export const RENTAL_LINE_STATUSES = ["quoted", "on_rent", "returned", "cancelled"] as const;
export type RentalLineStatus = (typeof RENTAL_LINE_STATUSES)[number];

export const RATE_UNITS = ["day", "week", "month"] as const;
export type RateUnit = (typeof RATE_UNITS)[number];
