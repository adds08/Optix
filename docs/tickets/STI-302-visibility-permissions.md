# STI-302 — Four-tier visibility permissions and scoping

**Phase:** 3 — Roles, accounts and organisation structure
**Size:** 4 units
**Status:** BLOCKED by STI-301
**Blocks:** STI-307, STI-308, STI-501

---

## Why this exists

`SYSTEM_PLAN.md` §6.3 specifies a four-tier visibility ladder:

```
assets.view.all      → equipment dept, sysadmin
assets.view.project  → PM
assets.view.crew     → superintendent
assets.view.own      → foreman
```

Verified 2026-08-16: **none of these four permissions exists.** Scoping today is a
**binary** global/scoped split keyed off `project.manage`
(`packages/api-contracts/src/scope.ts:28-30`). A superintendent and a foreman are
currently indistinguishable to the scoping layer.

## Acceptance criteria

1. The four permissions exist in `packages/types/src/index.ts:45-82` and are assigned
   per the STI-301 matrix.
2. `scope.ts` resolves visibility by walking the ladder in order — all, then project,
   then crew, then own — returning the first that matches, exactly as §6.3's
   pseudocode does. An actor with none sees nothing, and "nothing" must be an empty
   result, never an unscoped one.
3. **Authorisation is applied to the query, never as a post-filter on results.**
   `SYSTEM_PLAN.md` §9 and §7 both state this, and §7 calls it non-negotiable.
   Filtering after the fact leaks existence through counts, pagination and totals.
4. `assets.view.crew` resolves through `employee.reportsToEmployeeId`
   (`packages/db/src/schema/employee.ts:19`); `employee.myForemen`
   (`routers/project.ts:469-486`) already does this walk — reuse it.
5. `assets.view.project` resolves through `project_team_member`
   (`packages/db/src/schema/employee.ts:84-106`), which already exists with a partial
   unique index on the active row.
6. Every list, report, count and dashboard aggregate respects the ladder. The KPI
   dashboard currently **ignores project scoping** (`SYSTEM_PLAN.md` §5) — it is in
   scope here, and it is the easiest place to leave a leak.
7. Tenant scoping is unaffected: `eq(table.tenantId, tid)` stays on every query. The
   ladder narrows within a tenant; it never replaces the tenant predicate.
8. Tests per tier, including the negative case for each. STI-308 is the full matrix
   test; this ticket still needs its own.

## The hard part

Not the permissions — the **audit**. Every existing query must be found and brought
under the ladder, and a query that is missed fails silently and invisibly, because
returning too much data looks exactly like working correctly.

Produce a list of every read path and its tier as part of the deliverable. A reviewer
cannot verify this ticket without one.

## Files

- `packages/api-contracts/src/scope.ts:28-30` — the binary split to replace
- `packages/types/src/index.ts:45-82` — permission constants
- `packages/db/src/schema/employee.ts:19,84-106` — reporting chain, project membership
- `packages/api-contracts/src/routers/project.ts:469-486` — the crew walk to reuse
- `packages/api-contracts/src/routers/dashboard.ts`, `routers/report.ts` — the
  aggregates that currently ignore scoping
