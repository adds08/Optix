# STI-308 — RBAC matrix test across every role

**Phase:** 3 — Roles, accounts and organisation structure
**Size:** 1 unit
**Status:** **DONE — 2026-08-22.** `packages/api-contracts/src/rbac-matrix.test.ts`, 33 tests. The matrix lives in `packages/db/src/role-perms.ts` and the test reads it. **Found two real holes** — see below.

---

## Why this exists

`SYSTEM_PLAN.md` §6.3 final task. Verified 2026-08-16: **there is no test covering
roles or permissions anywhere.** The 8 test files are `parse`, `catalog`, `mentions`,
`gps`, `apply-action`, `fold`, `rules`, `secrets` — none touches RBAC.

So every claim about who can do what is currently unguarded. That includes the
role-name branches STI-307 removes and the visibility ladder STI-302 builds: without
this test, a regression in either is invisible until a user sees data they should not.

## Acceptance criteria

1. A table-driven test over **every role × every permission**, asserting the granted
   set matches the STI-301 matrix exactly. Assert both directions — a role must not
   hold a permission the matrix does not grant. One-directional assertions are how
   over-granting survives.
2. A test per visibility tier that a lower tier **cannot** see a higher tier's data,
   exercised through the real query path, not by calling `hasPermission` directly.
   Testing the helper proves the helper works; it proves nothing about the routers.
3. A test that every mutating procedure carries a permission. Enumerate the router
   tree and fail on any mutation without one — this catches the next one added, which
   is the point.
4. The matrix lives in one place and the test reads it. If the test hard-codes its
   own copy, the two drift and the test starts asserting history.
5. Runs in `pnpm test` and gates CI.

## Note on scope

This is 1 unit only because STI-301 and STI-302 will have done the thinking. If the
matrix is still ambiguous when this is picked up, that ambiguity is the finding —
report it rather than resolving it in a test file.

## Files

- `packages/types/src/index.ts:32-42,45-82` — roles and permissions
- `packages/db/src/seed.ts:51-118` — the seeded grants
- `packages/auth/src/index.ts:119` — `hasPermission`
- `packages/api-contracts/src/trpc.ts:37-43` — `requirePermission`
- `packages/api-contracts/src/scope.ts` — the ladder from STI-302
