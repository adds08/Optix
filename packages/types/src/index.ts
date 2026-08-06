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
  "department.read",
  "department.manage",
  "location.read",
  "location.manage",
  "vehicle.read",
  "vehicle.manage",
  "project.read",
  "project.manage",
  /* Who may be placed on a project's team, by target role. The hierarchy is
     enforced server-side in project.team.assign: pm needs the pm permission,
     superintendent the pm-or-superintendent tier, foreman any of them (plus
     the equipment department). Keep the matrix here so the seed and the
     router agree. */
  "project.team.read",
  "project.assign.pm",
  "project.assign.superintendent",
  "project.assign.foreman",
  "employee.read",
  "employee.manage",
  "assignment.read",
  "assignment.create",
  "assignment.approve",
  "transfer.read",
  "transfer.create",
  "transfer.approve",
  "report.read",
  /* Rented equipment. Separate from asset.* because the people who decide what
     Urban buys are not always the people who can call a pump off rent, and the
     cost of getting the second one wrong is a daily invoice. */
  "rental.read",
  "rental.manage",
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

export const ASSIGNMENT_STATUSES = [
  "active",
  "returned",
  "transferred",
  "overdue",
  "pending_approval",
  /* Put up for approval and refused. Kept rather than deleted so the register
     can answer why a tool never went out. */
  "cancelled",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const TRANSFER_REASONS = [
  "project_complete",
  /* No "phase_change": phases are a project-accounting concept that small-tools
     custody does not carry, so the option could only ever record a reason that
     referred to nothing. See the note in packages/db/src/schema/project.ts. */
  "reallocation",
  "hr_offboarding",
  "repair",
  "handoff",
] as const;
export type TransferReason = (typeof TRANSFER_REASONS)[number];

export const TRANSFER_STATUSES = [
  "pending_approval",
  /* Recorded and applied, but as a borrow: a foreman told the desk where his
     tool went. Distinct from `pending_approval`, where nothing moved at all —
     the desk is confirming a fact here, not permitting a change. */
  "pending_verification",
  "approved",
  "in_transit",
  "completed",
  "cancelled",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const CHANNEL_KINDS = ["department", "role_group"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const NOTIFICATION_TYPES = [
  "overdue",
  "maintenance_due",
  "clearance_required",
  "approval_pending",
  "missing",
  "custody_discrepancy",
  /* A rented line past its end date and still on rent. Unlike an overdue owned
     tool, this one is costing money every day it stays open. */
  "rental_overdue",
  "rental_due_soon",
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
  // Confirmed by someone who lacked the permission the action costs: captured
  // as a task for the owning desk, with the register left untouched.
  "action_requested",
  "error",
  // Closed by the desk without touching the register — chatter, a duplicate, a
  // mistake. A terminal state, so every message can leave the queue.
  "dismissed",
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

/*
  The intent list lives in @stinventory/intent, not here.

  There was a `MESSAGE_INTENTS` const at this spot with nothing importing it, and
  it had already drifted — no `intake`, which shipped months ago. That is the
  failure the catalog consolidation was for: a copy nobody reads is a copy nobody
  updates, and the next person to add an intent would have found two lists and
  guessed which one mattered.
*/

export * from "./enums";
export * from "./format";
export * from "./gps";
export * from "./import-specs";
export * from "./mentions";
