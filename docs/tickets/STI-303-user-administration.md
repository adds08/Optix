# STI-303 — User administration: create, assign role, deactivate, reset password

**Phase:** 3 — Roles, accounts and organisation structure
**Size:** 4 units
**Status:** **DONE** — 2026-08-19. `user` router (create / setRole / setActive / resetPassword /
changePassword) gated on `config.manage`, screen at `/admin/users`, reachable from the Entity
nav group. Deactivate never deletes and never moves custody. `user.must_change_password`
(migration `0019`) is set on create and reset, cleared when the user sets their own password,
and reported by `login()` — **reported, not enforced as a refusal**, because a user who cannot
log in also cannot change their password. Failed QA once (9 defects) and was reworked.
**Outstanding:** no client screen yet reads `mustChangePassword`, so the flag is set and
ignored by the UI.
**Depends on:** nothing

---

## Why this exists

`SYSTEM_PLAN.md` §5: **"No user administration exists at all."** Verified true on
2026-08-16, and it is the most complete absence on the board.

- `appRouter` (`packages/api-contracts/src/index.ts:26-51`) has **no** user, admin or
  account router.
- No `insert(schema.user)` anywhere outside the seed.
- No role-assignment mutation, no `isActive` toggle, no password reset or change
  procedure. Grepping the API for `password` finds only the login path
  (`apps/api/src/index.ts:56-101`) and the hashing helpers
  (`packages/auth/src/index.ts:22-38`).
- No admin route under `apps/web/app`.

Today the only way to create a user is to edit `packages/db/src/seed-data.ts` and
reseed. There are three accounts in existence.

## The distinction that must not be blurred

**Employees are not users.** `people/` is the *employee* register, backed by
`employeeRouter` (`routers/project.ts:181,362,427`), and `employee.manage` creates
domain people with **no login**. `user.employeeId`
(`packages/db/src/schema/identity.ts:25`) is a plain uuid with **no foreign key**.

A foreman who holds tools does not necessarily have an account, and must not be
forced to have one. Keep the two concepts separate in both the router and the UI, and
make the link explicit rather than implied.

## Acceptance criteria

1. A `user` router with: create, assign role, deactivate/reactivate, reset password.
   Every procedure carries a permission — `config.manage` is the closest existing fit
   unless STI-301 introduces a better one.
2. An admin screen under `apps/web/app/(app)/` that reaches all four. Reachability is
   the acceptance standard (`SYSTEM_PLAN.md` §9).
3. **Deactivate, never delete.** A deactivated user's history must remain intact and
   attributable — they are the actor on ledger events that can never be rewritten.
4. Deactivating a user does **not** move custody. That is STI-306, and conflating the
   two is how tools silently vanish from the register. If the user holds tools, the
   UI says so and links to departure reassignment.
5. Password reset sets a credential the user must change on next login, or issues a
   one-time link. Decide which and justify it. **Never** return or log a password
   hash, and never add a procedure that returns `llmApiKeyEnc` or any secret
   (`CLAUDE.md`, Constraints).
6. Creating a user optionally links to an existing employee. The link is nullable
   both ways.
7. Every query carries `eq(table.tenantId, tid)`. There is no RLS.
8. Tests for the permission gate on all four procedures — a mutating procedure
   without a permission is the failure mode this ticket most easily introduces.
9. Verified in a browser: create a user, log in as them, deactivate, confirm login is
   refused.

## Interaction with STI-305

STI-305 makes login tenant-scoped and adds a per-tenant unique email. If STI-305 has
not landed, user creation must **not** allow a duplicate email — it would produce
exactly the non-deterministic login STI-305 exists to fix. Whichever lands second
must handle the collision case.

## Files

- `packages/api-contracts/src/index.ts:26-51` — router registration
- `packages/db/src/schema/identity.ts:25,35,43` — `user`, `employeeId`, email index
- `packages/auth/src/index.ts:22-38` — hashing
- `packages/db/src/seed.ts:176-186`, `seed-data.ts:2485` — how the three accounts and
  their roles are currently made
- `apps/web/app/(app)/` — new admin route
