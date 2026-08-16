# STI-304 — Login accounts for the roles that have none

**Phase:** 3 — Roles, accounts and organisation structure
**Size:** 2 units
**Status:** BLOCKED by STI-301
**Depends on:** STI-301 (which roles), STI-303 (the mechanism to create them)

---

## Why this exists

`SYSTEM_PLAN.md` §5 says "5 of 7+ roles can log in". Verified 2026-08-16 — **it is
3 of 10**, and the plan's task list understates the gap.

Only three accounts exist (`packages/db/src/seed-data.ts:2485-2489`):
`owner@stinventory.local`, `admin@stinventory.local` (equipment_admin),
`warehouse@stinventory.local`.

All 10 roles are seeded with permission sets (`packages/db/src/seed.ts:51-118`) — but
**`project_manager`, `superintendent` and `foreman` have no accounts either**, and the
plan does not mention them. Those three are the roles the product is for.

Additionally: `mechanic` exists only as an *employee* role
(`packages/types/src/enums.ts:22-33`) with no login role at all, and the plan's
*System Administrator*, *Office Administrator* and *Engineer* exist nowhere.

## Consequence beyond this ticket

**No permission-denial test can be written.** Every journey is currently exercised as
`owner`, which has everything. STI-002 criterion 7 and STI-308 are both blocked on
this. A permission system that has only ever been tested by a superuser is untested.

## Acceptance criteria

1. A login account per role in the STI-301 matrix that Urban says needs one.
2. Created through STI-303's user administration, not by hand-editing the seed —
   using the feature is how it gets tested.
3. Seeded accounts exist for local development and E2E, with credentials documented
   in `docs/SETUP.md`. Development passwords only — never a production credential in
   the repo (`CLAUDE.md`, Constraints).
4. Each account logs in and lands on a working screen. A role that logs in to a
   crash or an empty dashboard is not delivered.
5. The `pm` versus `project_manager` mismatch (`enums.ts:22-33` versus
   `index.ts:32-42`) is resolved, not worked around.
6. Verified in a browser for every new role.

## Files

- `packages/db/src/seed-data.ts:2485-2489`, `packages/db/src/seed.ts:279-297`
- `packages/types/src/index.ts:32-42`, `packages/types/src/enums.ts:22-33`
- `docs/SETUP.md`
