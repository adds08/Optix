# STI-307 — Replace role-name branching with permission checks

**Phase:** 3 — Roles, accounts and organisation structure
**Size:** 2 units
**Status:** BLOCKED by STI-302
**Depends on:** STI-302 (the permissions must exist to branch on)

---

## Why this exists

`SYSTEM_PLAN.md` §9: *"Permissions are checked, role names are never branched on."*
And §2's terminology trap: *"'Admin' is ambiguous in Urban's usage and must never be
a single role in code."*

Verified 2026-08-16 — the rule is currently **false**. Every site below is a place
where adding a role silently gets the wrong behaviour.

### Server — session role, the security-relevant ones

- `packages/api-contracts/src/routers/dashboard.ts:85` —
  `ctx.session.roleName === "foreman"` gates activity scoping.
- `packages/api-contracts/src/routers/messaging.ts:61` — `const userRole =
  ctx.session.roleName;` assigned and **never used**. Dead, and the comment at `:57`
  claims role-derived channel access that was never implemented. Delete both.

### Server — `employee.role`, domain data rather than auth

Lower risk, but should be named constants:
`packages/api-contracts/src/project-assign.ts:87,89,143`,
`packages/api-contracts/src/routers/projectTeam.ts:51,53,156,243`.

### Client

- `apps/web/components/assign-form.tsx:20,23`
- `apps/web/components/bulk-move-form.tsx:38,50`
- `apps/web/components/transfer-form.tsx:14,22`
- `apps/web/components/employee-form.tsx:28,129`
- `apps/web/components/vehicle-form.tsx:30`

### The counterexample to copy

`CUSTODIAN_ROLES` (`packages/types/src/enums.ts:41`), used in `assign-form.tsx:27`,
`bulk-move-form.tsx:47`, `crew-assign-dialog.tsx:79`, `jobsites/page.tsx:139`. This
is the pattern done right — a shared named constant, not a scattered string literal.

## Acceptance criteria

1. Every server-side branch on `session.roleName` is replaced by a permission check
   via `hasPermission` / `requirePermission`.
2. `messaging.ts:57-61` — the dead assignment and the misleading comment are removed.
   Do not implement the channel access the comment describes; that is unasked-for
   scope. Report it if it looks genuinely needed.
3. Branches on `employee.role` are legitimate where the role is **domain data** — a
   foreman is a kind of person, not a permission. Keep those, but route them through
   named constants like `CUSTODIAN_ROLES`. Say in each case which category it is; the
   distinction is the substance of this ticket.
4. Client-side `role === "..."` checks become permission checks via
   `usePermissions()` / `<Can>` (`apps/web/components/use-permissions.ts:5-11`,
   `apps/web/components/can.tsx:5-9`).
5. Grep proves it: no `roleName ===` and no `role === "` in server code after the
   change, or each survivor is annotated with why it is domain data.
6. Every affected screen verified in a browser as a non-owner role. Blocked on
   STI-304 accounts existing.

## Files

See the citations above. `packages/auth/src/index.ts:119` is `hasPermission`.
