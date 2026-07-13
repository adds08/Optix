// Branded ID types — keep IDs from being mutually assignable across domains.

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;
export type RoleId = Brand<string, "RoleId">;
export type PermissionId = Brand<string, "PermissionId">;
export type AssetId = Brand<string, "AssetId">;
export type AssetModelId = Brand<string, "AssetModelId">;
export type CategoryId = Brand<string, "CategoryId">;
export type ManufacturerId = Brand<string, "ManufacturerId">;
export type ProjectId = Brand<string, "ProjectId">;
export type ProjectPhaseId = Brand<string, "ProjectPhaseId">;
export type EmployeeId = Brand<string, "EmployeeId">;
export type WarehouseId = Brand<string, "WarehouseId">;
export type LocationId = Brand<string, "LocationId">;
export type VehicleId = Brand<string, "VehicleId">;
export type AssignmentId = Brand<string, "AssignmentId">;
export type TransferId = Brand<string, "TransferId">;
export type TransactionId = Brand<string, "TransactionId">;
export type NotificationId = Brand<string, "NotificationId">;
export type ChannelId = Brand<string, "ChannelId">;
export type MessageId = Brand<string, "MessageId">;

export const asId = <T extends string>(s: string) => s as T;

// ---------------------------------------------------------------------------
// Roles (RBAC). MVP-active: owner, equipment_admin, warehouse, foreman,
// read_only. Others are retained for future phases but not seeded.
// ---------------------------------------------------------------------------
export const ROLES = [
  "owner",
  "equipment_admin",
  "warehouse",
  "procurement",
  "project_manager",
  "superintendent",
  "foreman",
  "hr",
  "finance",
  "read_only",
] as const;
export type RoleName = (typeof ROLES)[number];

export const PERMISSIONS = [
  "asset.read",
  "asset.manage",
  "location.read",
  "location.manage",
  "vehicle.read",
  "vehicle.manage",
  "project.read",
  "project.manage",
  "employee.read",
  "employee.manage",
  "assignment.read",
  "assignment.create",
  "assignment.approve",
  "transfer.read",
  "transfer.create",
  "transfer.approve",
  "report.read",
  "notification.read",
  "notification.manage",
  "config.manage",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// ---------------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------------

// Asset lifecycle statuses. Full set retained; MVP uses the operational subset.
export const ASSET_STATUSES = [
  "requested",
  "approved",
  "on_order",
  "received",
  "available",
  "reserved",
  "assigned",
  "in_transit",
  "in_maintenance",
  "lost",
  "disposed",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

// Transaction (event) types — append-only system of record.
export const EVENT_TYPES = [
  "purchase",
  "receive",
  "tag",
  "assign",
  "transfer",
  "return",
  "reserve",
  "repair_start",
  "repair_complete",
  "inspection",
  "lost",
  "found",
  "dispose",
  "custodian_change",
  "project_change",
  "location_change",
  "status_change",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ASSIGNMENT_TYPES = ["permanent", "temporary"] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const ASSIGNMENT_STATUSES = ["active", "returned", "transferred", "overdue", "pending_approval"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const TRANSFER_REASONS = [
  "project_complete",
  "phase_change",
  "reallocation",
  "hr_offboarding",
  "repair",
  "handoff",
] as const;
export type TransferReason = (typeof TRANSFER_REASONS)[number];

export const TRANSFER_STATUSES = [
  "pending_approval",
  "approved",
  "in_transit",
  "completed",
  "cancelled",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

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

export const CHANNEL_KINDS = ["department", "role_group"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const NOTIFICATION_TYPES = [
  "overdue",
  "maintenance_due",
  "clearance_required",
  "approval_pending",
  "missing",
  "custody_discrepancy",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ---------------------------------------------------------------------------
// SLA / tenant config keys (tenant-scoped, not code).
// ---------------------------------------------------------------------------
export const DEFAULT_HIGH_VALUE_THRESHOLD = 5000;

export const PROCESSING_STATUSES = [
  "queued",
  "processing",
  "parsed",
  "pending_manual",
  "action_proposed",
  "action_executed",
  "error",
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const MESSAGE_INTENTS = [
  "transfer",
  "assign",
  "return",
  "lost",
  "repair",
  "request_purchase",
  "report",
  "none",
] as const;
export type MessageIntent = (typeof MESSAGE_INTENTS)[number];
