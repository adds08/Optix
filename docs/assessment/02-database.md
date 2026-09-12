# Technical Assessment — Database Layer

**Date:** 2026-09-12
**Scope:** `packages/db` (10,037 lines) — schema, migrations, seed, live dev database
**Method:** schema read, live queries against the running `stinventory` database (Urban dataset), `drizzle-kit check`
**Verdict:** **Sound.** The custody machinery is verified correct against live data. The problems are in *data completeness*, not schema design.

Every finding below is marked CONFIRMED (verified by query or file read) or NOTED (observation, no defect proven).

---

## Summary table

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Org hierarchy is 100% empty in Urban's real data | **HIGH** | CONFIRMED |
| 2 | 17 project-team rows have no `reports_to` | MEDIUM | CONFIRMED |
| 3 | No `pgEnum` / no CHECK constraints — all enums are `text()` | MEDIUM | CONFIRMED |
| 4 | 4 of 762 assets have no ledger evidence | LOW | CONFIRMED |
| 5 | 10 migrations lack meta snapshots | LOW | CONFIRMED, no current harm |
| 6 | 2 tables lack a leading `tenant_id` index | LOW | CONFIRMED, justifiable |
| — | Custody invariant holds; projection == ledger | — | CONFIRMED CLEAN |

---

## What is verifiably correct

Run against the live dev database carrying Urban's real register (762 assets):

```
duplicate active custody rows per asset ................ 0
assets w/ custodian but no active custody link ......... 0
active custody w/ asset showing no custodian ........... 0
active custody where custodian differs from projection . 0
employees w/ primary_project pointing nowhere .......... 0
```

This matters more than any single finding. `asset.current_custodian_id` is a
denormalised cache of the custody ledger, and the two agree **exactly**. The
chokepoint design in `packages/api-contracts/src/custody.ts` — one writer,
`SELECT ... FOR UPDATE` on the asset row, partial unique index
`assignment_one_active_uq` as a backstop — is working as documented.

The bug the code comments describe (two custodians for one tool) is not present
in this database.

**Indexing:** 101 indexes across 46 tables. Only `tbl_entity_session` and
`tbl_entity_tenant_settings` lack a leading `tenant_id` index, and both are
low-cardinality lookup tables where it does not matter (finding 6).

**FK discipline:** 120 of 121 foreign keys declare an explicit `onDelete`
policy (69 cascade, 51 set null, 3 restrict). One defaults to NO ACTION. This
is unusually disciplined.

**Migration integrity:** `drizzle-kit check` reports no drift.

---

## Finding 1 — Org hierarchy is empty in Urban's real data (HIGH)

**CONFIRMED at source and in the database.**

Live query:

```
active employees ............................ 45
  ... with no reports_to_employee_id ........ 43   (96%)
  ... with no primary_project_id ............ 16
```

At the source, `packages/db/src/seed-data.urban.ts` lines 76–159:

```
employees in Urban's spec ................... 81
  ... with reportsTo: null .................. 81   (100%)
```

Every one of Urban's 81 real employee records carries `reportsTo: null`. The
seed's write path (`packages/db/src/seed.ts:641-649`) is a correct two-pass
update and is not at fault — **the data was never captured**. The 2 employees
who do have a manager come from elsewhere.

**Why this is the top finding.** `employee.reportsToEmployeeId` is what the org
chart, the crew scoping, the departure/successor logic and the tier ladder all
read. With it empty:

- the org chart has no edges to draw
- "who is under whom" cannot be answered by the system at all
- `packages/api-contracts/src/departure.ts` cannot suggest a successor
- any approval that walks upward has nowhere to walk

This is the database-layer expression of the requirement stated directly:
*"We need a way to make who is under or reportsTo whom."* It is not a missing
feature — the column, the FK, the index and the reading code all exist. **It is
missing data.**

**Origin.** Consistent with the stated data provenance: BambooHR (users/roles),
a screenshot (projects), and two Excel files (trucks, tools). None of those
sources carried a reporting line, and ambiguous rows were dropped during
extraction.

**Fix direction.** Not a schema change. Either an import that derives the chain
from a source that has it, or an in-product flow where each supervisor confirms
their own reports. `tbl_ops_project_role_deferral` already implements exactly
this pattern for tiers ("a tier somebody deliberately left for their boss to
fill") and is the model to follow.

---

## Finding 2 — 17 project-team rows have no `reports_to` (MEDIUM)

**CONFIRMED.** Of 31 rows in `tbl_ops_project_team_member`, 17 have
`reports_to_employee_id IS NULL`.

This is the *per-job* reporting line, deliberately distinct from the company
one (schema comment, `employee.ts:238-242`). The column is nullable by design —
the schema notes a tier "may not have been decided yet". So a null is legal.

But 55% null means the on-job chain is mostly undefined, and the same
consequences as finding 1 apply within a project's scope. Same root cause, same
fix direction. Lower severity only because the column is legitimately optional.

---

## Finding 3 — No `pgEnum`, no CHECK constraints (MEDIUM)

**CONFIRMED.** Across all 46 tables:

```
pgEnum declarations ......... 0
CHECK constraints ........... 0
```

Every enumerated value is `text()` with the permitted values written in a
trailing comment. Examples:

- `asset.ts:173` — `status: text("status").notNull().default("active")` → `// active | returned | transferred | pending_approval`
- `asset.ts:275` — `status` → `// pending_approval | approved | completed | cancelled`
- `location.ts:28` — `type` → `// warehouse | site_container | gang_box | vehicle | project_site`
- `employee.ts:59` — `role` → `// EmployeeRole`
- `project.ts:34`, `task.ts:15`, `sync.ts:48`, `messaging.ts:13`, `identity.ts:403`

**Consequence.** The database will accept `status = 'activ'`, `'ACTIVE'`, or any
other string. The only thing preventing it is Zod at the tRPC edge. That
protects the application path but **not** migrations, seeds, manual SQL fixes,
or any future writer. Given that this system's whole premise is that the
register is trustworthy, a typo'd status that silently excludes a tool from
every filtered query is a realistic failure.

The system compensates for this well in the one place it matters most — custody
correctness is enforced by a partial unique index, not by convention. The
argument for enums is to extend that same rigour to the other state columns.

**Trade-off, stated honestly.** Postgres enums are awkward to alter (adding a
value is fine; removing or reordering is not). CHECK constraints are the lighter
option and get most of the benefit. Recommend CHECK constraints on the handful
of status/type columns that drive filtering — `asset.status`, `assignment.status`,
`transfer.status`, `project.status`, `location.type` — rather than a wholesale
pgEnum conversion.

---

## Finding 4 — 4 assets have no ledger evidence (LOW)

**CONFIRMED.** 4 of 762 assets have no row in `tbl_ops_transaction` carrying a
`to_state`.

These are the `no_evidence` case that `reconcileProjections` already names and
handles deliberately (`packages/domain/src/fold.ts`): the fold answers
`INITIAL_STATE` with nothing behind it, and `asset.rebuild` **skips** them on
purpose, because blanking a live row on zero evidence would be the corruption
rather than the fix.

So this is a known, designed-for state, not a defect. It is listed because it
is a small number that can be driven to zero: the documented exit is a genuine
custody event recorded through the app, which writes a complete snapshot and
becomes the asset's baseline. Worth clearing so the reconciler's alert surface
is empty and any future alert is real.

---

## Finding 5 — 10 migrations lack meta snapshots (LOW)

**CONFIRMED, but no current harm.** 69 journal entries, 59 snapshot files.
Missing: `0009`, `0020`, `0023`, `0038`, `0060`, `0061`, `0062`, `0063`, `0065`,
`0067`.

Nine of the ten are hand-written **data-only** migrations (backfills, permission
grants, cascade fixes) with no DDL, so no snapshot is expected. That is normal
and fine.

The exception is **`0065_one_job_code_per_tenant.sql`**, which contains DDL:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "project_code_per_tenant_uq"
```

A DDL migration with no snapshot is how `drizzle-kit generate` starts emitting
duplicate statements — and commit `0dd5998` ("Catch the migration snapshot up
to 0062, and stop generate looping") shows this has already bitten once.

`drizzle-kit check` currently reports **"Everything's fine"**, so nothing is
broken today. Flagged as a latent trap, not an active defect.

---

## Finding 6 — 2 tables lack a leading `tenant_id` index (LOW)

**CONFIRMED.** `tbl_entity_session` and `tbl_entity_tenant_settings`.

Both are justifiable: sessions are looked up by token (which has its own index),
and tenant settings is one row per tenant. No action recommended; recorded for
completeness so a future reviewer does not re-derive it.

---

## What this layer does NOT tell us

Two things this assessment deliberately cannot answer:

1. **Whether production matches dev.** Every query above ran against the local
   dev database. The custody comment in `custody.ts` notes explicitly that
   "production has not been checked" for pre-index duplicate rows. The same
   queries should be run against production before any claim is made about it.

2. **Whether the register is *complete*.** The integrity checks prove internal
   consistency — the ledger and the projection agree. They cannot prove that
   762 assets is the right number, or that the rows dropped as ambiguous during
   extraction were not real tools. That requires reconciliation against Urban's
   source files, which is a separate exercise.

---

## Recommended actions, in order

1. **Run these same queries against production.** One script, and it answers the
   one question nobody can currently answer. Blocking for any claim about
   production data quality.
2. **Decide how the reporting chain gets filled** (finding 1). Schema is ready;
   this is a data-capture and product-flow decision.
3. **Add CHECK constraints to the filtering status columns** (finding 3). Small,
   mechanical, closes a real hole.
4. **Clear the 4 no-evidence assets** (finding 4) so the reconciler's alert
   surface is genuinely empty.
5. **Add the missing snapshot for `0065`** (finding 5). Latent, cheap.
