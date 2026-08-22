# STI-302 — Four-tier visibility permissions and scoping

**Phase:** 3 — Roles, accounts and organisation structure
**Size:** 4 units
**Status:** **DONE — 2026-08-22.** Four permissions in `packages/types`, ladder in `packages/api-contracts/src/scope.ts`, applied to the query on every read path. The audit AC 8 asks for is below.
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

---

## The audit — every read path and its tier

STI-302's own text: *"A reviewer cannot verify this ticket without one."* Produced by
enumerating every query procedure in `packages/api-contracts/src/routers/`, not by grep.

**Scoped by the asset ladder** (`assetScopeWhere` — narrows on `asset.current_*`):

| Procedure | Was | Now |
|---|---|---|
| `asset.list` | bare `protectedProcedure`, whole tenant | `asset.read` + ladder |
| `asset.get` | bare, by id, whole tenant | `asset.read` + ladder; out of scope returns **null**, not FORBIDDEN |
| `transaction.list` | bare, whole ledger | `asset.read` + ladder |
| `dashboard.kpis` | bare, unscoped counts | `asset.read` + ladder |
| `dashboard.charts` | bare, unscoped **sum of acquisition cost** | `asset.read` + ladder |
| `dashboard.recentActivity` | **branched on `roleName === "foreman"`** | `asset.read` + ladder (STI-307) |
| `dashboard.clearanceQueue` | bare, whole tenant | `asset.read` + ladder |
| `dashboard.pendingApprovals` | bare, whole desk queue | `assignment.read` + ladder, through the asset |
| `dashboard.notifications` | bare; queue counts tenant-wide | `notification.read` + ladder on the counts |
| `report.assetRegister` | bare — the whole register | **`asset.read`** + ladder |
| `report.byProject` / `byForeman` / `byMechanic` | bare aggregates | `report.read` + ladder **in the JOIN** |
| `report.capitalByProject` / `capitalByDepartment` | bare capital totals | `report.read` + ladder in the JOIN |
| `report.idle` / `lost` / `needsTag` | bare | `report.read` + ladder |
| `report.auditTrail` | bare | `audit.read` + ladder |
| `transfer.list` | bare | `transfer.read` + ladder, through the asset |

**Scoped by the assignment's own keys** (`assignmentScopeWhere` — history must not be
re-scoped by where the tool sits today):

| `assignment.list` | bare | `assignment.read` + ladder on the assignment's custodian/project |
|---|---|---|

**Scoped by project** (`visibleProjectScope`, now derived from the same ladder):

| Procedure | Note |
|---|---|
| `project.list`, `projectTeam.all` | Already scoped; the *input* changed from `project.manage` to the ladder |
| `location.list` | `location.read` + project scope. Project-less locations (the yard, warehouses) stay visible — the tools inside them are scoped by the ladder |
| `vehicle.list` | `vehicle.read` + project scope, same null rule |

**Deliberately NOT scoped, with the reason:**

| Procedure | Why |
|---|---|
| `dashboard.awaitingDesk` | Already self-scoped to `session.employeeId`, and narrower than any tier |
| `notification.list` | Scoped to the recipient, which is narrower than any tier |
| `user.list`, `user.roles` | `config.manage`. Administering accounts is not an asset read |
| `settings.get` | `config.manage` |
| `preferences.get` | The caller's own row |
| `category.list`, `department.list` | Reference data — a category name discloses nothing about custody |
| `employee.list` | **Left open, and this is the known gap.** Every custodian picker reads it, and narrowing it needs a decision about whether a foreman may see the company directory. Out of scope here; see below |
| `project.list` | Narrowed by `visibleProjectScope` but **not gated on `project.read`**, deliberately. The matrix denies HR `project.read`, yet HR holds `employee.manage` and the employee form's "Primary project" dropdown is fed by this procedure — gating it would break the one screen HR exists to use. The matrix row is the thing that looks wrong; CLAUDE.md rule 3 says the shipped behaviour wins until Urban says otherwise. Job names are also the least sensitive thing on the register |

### Two holes this work found, both fixed

1. **`report.assetRegister` and `dashboard.charts` were gated on `report.read`.** HR holds
   `report.read` and deliberately *not* `asset.read` — so HR could read the entire asset
   register by name, serial and value, and the total capital value of the fleet, off two
   procedures that are asset data wearing a report's name. Both now require `asset.read`.
   Found by probing all thirteen roles against the running API; no reading of the matrix
   would have caught it, because the matrix does not notice that two of its rows describe
   the same data.

2. **`notification.markRead` matched on `(id, tenantId)` alone**, so any signed-in account
   could mark any other account's alert read by id. Now also matched on
   `recipientEmployeeId`. Found by STI-308's router walk.

### Known gap, stated rather than hidden

`employee.list` is not narrowed. A foreman can still enumerate the employee register. It is
the input to every custodian picker, `employee.read` is granted to nine of thirteen roles in
the matrix, and narrowing it is a product decision about whether a foreman may see the
company directory — not one to take on a default in a ticket about asset visibility. **The
tools are scoped; the list of people is not.**
