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
// Roles (RBAC). Every role here is seeded with a permission set and has at
// least one login account (STI-304) — a role nobody can log in as is a row in
// a table, not a control, and it is why no permission denial had ever been
// tested before this list was completed.
//
// `owner` IS the System Administrator of docs/workings/PERMISSION_MATRIX.md §1.
// The matrix's "cost of confirming" line asks for a fourth new role named
// `system_admin`; it is deliberately NOT added, because `owner` already holds
// every permission and a second all-permissions role is two names for one
// authority — the exact "'Admin' means three things" ambiguity SYSTEM_PLAN §2
// says must never reach the code. The matrix column maps to this role by name
// in ROLE_PERMS, which is what lets STI-308 generate its test from the table.
//
// `project_manager`, not `pm`. EMPLOYEE_ROLES in ./enums.ts uses `pm` for the
// same human because that list describes *employment*, not *authorisation*,
// and the two are separate axes — an Engineer is a `project_manager` here and
// has no employee role at all. Anything joining the two lists must map
// explicitly; see PM_EMPLOYEE_ROLE below.
// ---------------------------------------------------------------------------
export const ROLES = [
  "owner",
  /*
    THE TECHNICAL ADMINISTRATOR — Optix's own operator, not the customer's.

    The note above argues that a second all-permissions role is two names for
    one authority, and that argument still holds for anything tenant-scoped.
    This role is not that. It differs on a DIFFERENT AXIS: `role.isCrossTenant`,
    reaching every tenant rather than one. `owner` is the customer's own
    administrator and is deliberately confined to their own data; this is the
    person who supports all of them.

    Added 2026-09-07 on the client's instruction — "one tech and one admin that
    is organizational admin, and other tech admin is always accessible to all
    tenant". Multi-tenancy proper is explicitly later; what exists now is the
    role, the flag, and one seeded account, so that when the cross-tenant query
    path is built it has somewhere to land.

    NOTHING reads `isCrossTenant` yet. Today this behaves exactly like `owner`
    within its own tenant. Say so plainly rather than implying the isolation is
    already crossed — the WHERE clause is still the only isolation there is.
  */
  "tech_admin",
  "equipment_admin",
  /* Operations, accounts and general business administration. Business
     records — NOT custody, NOT platform configuration. Deliberately without
     `config.manage`: that permission also carries the LLM configuration and
     the high-value approval threshold, and "may add a user" is not the same
     authority as "may change what needs a second signature"
     (PERMISSION_MATRIX §5 decision 4, default taken). */
  "office_admin",
  "warehouse",
  "procurement",
  /*
    THE LEADERSHIP ROLES, added 2026-09-10.

    Urban's chain is director → area in-charge → PM & general superintendent →
    superintendent → foreman, and the login list stopped at `project_manager`.
    So the people the client actually wanted to invite first — three Project
    Directors, an Area Manager, an Area Superintendent — had no login role to
    receive, and inviting one produced an account holding nothing.

    They exist here because they are the only roles that may put themselves on
    a job (`role.claimTierNames`, seeded in `seed.ts`). Everybody below them is
    placed by somebody above through the "Set by" chain, so nobody else needs a
    self-claim grant and none is given one. That is the whole bootstrap: without
    a role that can claim, an empty tenant has no way to record its first roster
    row and every user lands on a dead-end wizard.

    NOT the same axis as the JOB TIER of the same name
    (`tbl_entity_team_role`). This is what an account may DO; the tier is what
    a person IS on one project, and the two are allowed to disagree — see the
    header on `apps/web/app/(app)/settings/team-roles/page.tsx`.
  */
  "director",
  "area_in_charge",
  /* Claims too, because a job may be run by a general superintendent with no
     area in-charge above them ON THAT JOB. The client's chain on 2026-09-10 put
     all three of director, area in-charge and general superintendent at the
     point where somebody picks the jobs they run. */
  "general_superintendent",
  "project_manager",
  /* Runs work on a project rather than owning it commercially. Identical to
     `project_manager` where small tools are concerned, and seeded from the
     same permission set on purpose. It exists as its own role so reporting can
     tell the two apart and so they can diverge later without a migration —
     not because they differ today. */
  "engineer",
  "superintendent",
  "foreman",
  /* Holds and uses tools like a foreman, but for repair and maintenance. The
     difference that matters is the cost target: a mechanic's custody charges
     the Equipment department, a foreman's charges the project. */
  "mechanic",
  "hr",
  "finance",
  "read_only",
] as const;
export type RoleName = (typeof ROLES)[number];

/* The one sanctioned crossing between the login-role list above and
   EMPLOYEE_ROLES in ./enums.ts. `pm` and `project_manager` name the same human
   in two vocabularies, and every previous join between the lists was a string
   literal written from memory — STI-301 recorded the mismatch as a latent bug
   before it became a real one. Import this instead of writing either literal. */
export const PM_EMPLOYEE_ROLE = "pm" as const;
export const PM_LOGIN_ROLE = "project_manager" as const;

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
  /* Who may be placed on a project's team.

     `project.assign.pm`, `.superintendent` and `.foreman` were removed on
     2026-09-10. They named three specific tiers in a system where tiers are
     tenant DATA — Urban's own `area_in_charge` and `general_superintendent`
     had no permission of their own and fell through to
     `project.team.assign`, so the hierarchy they encoded was already only
     half the register's shape. What they expressed — that a PM may place a
     superintendent but not another PM — is exactly what
     `team_role_assigner` records per tier, for every tier, without a deploy.

     `project.team.assign` is now the single tenant-wide grant, and the
     per-tier question is answered by `canAssignIntoTier`. */
  "project.team.read",
  /* Assigns a TENANT-ADDED team role — one with no dedicated permission of its
     own because it did not exist when this list was written (director, area
     in-charge, ...). `pm`/`superintendent`/`foreman` keep their own permissions
     above; this is the fallback `assertCanAssign` reaches for everything else,
     so a new tier is usable the moment an admin creates it in the team-role
     register, with no new Permission string required. */
  "project.team.assign",
  "project.team.manage",
  "employee.read",
  "employee.manage",
  "assignment.read",
  "assignment.create",
  "assignment.approve",
  "transfer.read",
  "transfer.create",
  "transfer.approve",
  /* Departure reassignment (STI-306). Deliberately NOT `assignment.approve`:
     approving one proposed hand-off and stripping every tool a leaver holds in
     one irreversible transaction are different powers, and the second needs its
     own grant so it can be given to fewer people. */
  "custody.reassign",
  "report.read",
  /* ---- The visibility ladder (STI-302) ------------------------------------
     A grant says *may see*; a scope says *how much*. `asset.read` answers the
     first question, these four answer the second, and every read path resolves
     them in the order written here — all, then project, then crew, then own,
     first match wins. A role holding two gets the wider one.

     They are permissions rather than a column on the role because the rule
     SYSTEM_PLAN §9 states is "permissions are checked, role names are never
     branched on" — before these existed, scoping keyed off `project.manage`,
     which made a superintendent and a foreman indistinguishable to the
     scoping layer and gave a foreman the desk's view the day anyone granted
     them `project.manage` for an unrelated reason.

     An actor holding NONE of the four sees nothing. That is the secure
     default and it must stay an empty result, never an unscoped one. */
  "assets.view.all",
  "assets.view.project",
  "assets.view.crew",
  "assets.view.own",
  /* Rented equipment. Separate from asset.* because the people who decide what
     Urban buys are not always the people who can call a pump off rent, and the
     cost of getting the second one wrong is a daily invoice. */
  "notification.read",
  "notification.manage",
  /*
    Login accounts — create, deactivate, reset a password, assign a role.
    Split out of `config.manage` for the invite work: that permission also
    gates the chat model and the high-value approval threshold, and "may add a
    user" was never the same authority as "may change what needs a second
    signature". `role-perms.ts` used to grant `office_admin` the accounts screen
    by lending it `config.manage` outright — see the comment there and in
    `routers/user.ts` for why that was a placeholder rather than the design.
  */
  "user.manage",
  "config.manage",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/* The ladder, in resolution order. Widest first: the first tier the actor
   holds is the one that applies, which is how a role granted two scopes gets
   the wider rather than the narrower. Both `scope.ts` and the RBAC matrix test
   read THIS array — the order is the rule, so it must not be written down
   twice. */
/*
  What each permission means, in the words of somebody who runs a tool yard.

  The role editor (`/admin/roles`) renders these. Without them the screen is a
  list of dotted identifiers, and an administrator ticking `asset.manage`
  because it sounds harmless is worse than no screen at all — this is the
  surface where a wrong guess hands somebody the register.

  Grouped because thirty checkboxes in one column cannot be reasoned about.
  The group is presentational; the permission strings are the contract.
*/
export const PERMISSION_GROUPS = [
  {
    label: "Seeing the register",
    hint: "Whether they can open the tool list at all, and how much of it.",
    permissions: [
      ["asset.read", "See tools in the register"],
      ["assets.view.all", "Scope: every tool in the company"],
      ["assets.view.project", "Scope: tools on the jobs they are on the team of"],
      ["assets.view.crew", "Scope: tools held by the foremen reporting to them"],
      ["assets.view.own", "Scope: only tools in their own hands"],
    ],
  },
  {
    label: "Custody",
    hint: "Issuing tools, moving them between people, and signing those moves off.",
    permissions: [
      ["assignment.read", "See who is holding what"],
      ["assignment.create", "Issue a tool to somebody"],
      ["assignment.approve", "Sign off an issue that needs a second signature"],
      ["transfer.read", "See hand-offs"],
      ["transfer.create", "Hand a tool from one person to another"],
      ["transfer.approve", "Sign off a hand-off"],
      ["custody.reassign", "Move EVERYTHING a leaver holds, in one action"],
    ],
  },
  {
    label: "The register itself",
    hint: "Adding tools, and the places and vehicles they live in.",
    permissions: [
      ["asset.manage", "Add, edit and write off tools"],
      ["location.read", "See yards, gang boxes and containers"],
      ["location.manage", "Add and edit them"],
      ["vehicle.read", "See trucks and trailers"],
      ["vehicle.manage", "Add and edit them"],
      ["department.read", "See departments"],
      ["department.manage", "Add and edit them"],
    ],
  },
  {
    label: "Jobs and people",
    hint: "Who works where. Note these are EMPLOYEE records, not login accounts.",
    permissions: [
      ["project.read", "See the list of jobs"],
      ["project.manage", "Add and edit jobs. Also widens what the job selector offers"],
      ["project.team.read", "See who is on a job"],
      ["project.team.assign", "Put anyone in any team tier, on any job. Without it, who you may place is decided per tier on the Job Tiers screen"],
      ["project.team.manage", "Add or edit the team-role register (Director, Area In-charge, ...)"],
      ["employee.read", "See the people register — everyone, not just their crew"],
      ["employee.manage", "Add and edit people"],
    ],
  },
  {
    label: "Reporting",
    permissions: [
      ["report.read", "Open the reports. Each is still narrowed by the scope above"],
      ["audit.read", "Read the full audit trail"],
      ["notification.read", "Receive alerts"],
      ["notification.manage", "Manage the desk's alert queue"],
    ],
  },
  {
    label: "Administration",
    hint: "The powerful ones. `config.manage` is also what lets somebody reach this screen.",
    permissions: [
      ["user.manage", "Invite and manage login accounts, reset passwords, assign roles"],
      ["config.manage", "Manage roles, the chat model, SMTP and the approval threshold"],
    ],
  },
] as const satisfies readonly {
  label: string;
  hint?: string;
  permissions: readonly (readonly [Permission, string])[];
}[];

/* Flattened lookup for the places that want one permission's wording. */
export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map(([p, label]) => [p, label])),
);

export const VIEW_SCOPES = [
  "assets.view.all",
  "assets.view.project",
  "assets.view.crew",
  "assets.view.own",
] as const satisfies readonly Permission[];
export type ViewScope = (typeof VIEW_SCOPES)[number];

export const isViewScope = (p: string): p is ViewScope =>
  (VIEW_SCOPES as readonly string[]).includes(p);

/**
 * Compare two tiers on the ladder. `true` when `actor` is AT LEAST as wide as
 * `needed` — so `all` satisfies a `project` requirement, and `own` does not.
 *
 * Lives here rather than in either caller because "wider than" is a property
 * of the ORDER of `VIEW_SCOPES`, and that order is already the rule two
 * separate places depend on: `scope.ts` resolves the actor's tier by
 * first-match, and the Desk's panel registry decides whether a panel applies.
 * Both were about to compare array indices by hand. One implementation, one
 * test, and `apps/web` needs no test runner of its own to have this pinned.
 */
export function tierAtLeast(actor: ViewScope, needed: ViewScope): boolean {
  /* Widest first, so a LOWER index is wider. */
  return VIEW_SCOPES.indexOf(actor) <= VIEW_SCOPES.indexOf(needed);
}

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
  /* Synthesized opening snapshot, not a physical movement. Written once per asset
     by migration 0013 (STI-101) because every ledger row before it carried a null
     to_state, leaving foldAssetState nothing to fold. Timelines render it like any
     other event; no writer should emit it at runtime. */
  "projection_baseline",
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
  /* HISTORICAL ONLY — no writer may produce this. The borrow/verify flow was
     removed on 2026-08-09 (packages/domain/src/rules.ts: Urban's desk moves
     tools; foremen do not reassign). The entry stays solely so a pre-removal
     transfer row still carrying it renders in history. */
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
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/* `auth_token.kind` — see the schema comment in packages/db/src/schema/identity.ts.
   One table, two lifetimes: an invite is what creates an account, a reset only
   replaces a credential on one that already exists. */
export const AUTH_TOKEN_KINDS = ["invite", "reset"] as const;
export type AuthTokenKind = (typeof AUTH_TOKEN_KINDS)[number];

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
