# STI-101 — Backfill `to_state` on the existing ledger

**Phase:** 1 — Custody trail
**Size:** 2 units
**Status:** DONE — QA PASS 2026-08-16, commit `4edd043`
**Blocks:** STI-106
**Depends on:** nothing

---

## QA outcome

PASS. Verified independently by running the real `foldAssetState` from
`packages/domain` over all 1508 exported transactions — not a SQL reimplementation
of the fold — giving 754 assets folded, **0 divergent, 0 missing keys**.

The implementation deviated from this ticket's SQL sketch, and QA proved the
deviation was **mandatory**: all 754 assets have `created_at` strictly *after* their
earliest event, and every baseline `id` (755–1508) exceeds every historical row's
(1–754). The sketch's `coalesce(created_at, now())` would have sorted the baseline
last, where the id tiebreak makes it win the fold — masking all history on every
asset. The migration uses `min(occurred_at) - interval '1 second'` instead.

### Two cosmetic findings, deliberately not fixed

Migration `0013` is already applied, and drizzle records a hash per migration file.
Editing an applied migration risks a hash mismatch on future `migrate` runs, so
neither is worth the change:

1. The migration comment says that on an `occurred_at` tie "this new row always
   loses". Inverted — a higher `id` would make the baseline *win*. The behaviour is
   correct regardless, because the strict `-1 second` means no tie ever occurs. The
   test comment at `fold.test.ts:188-191` states the rule correctly.
2. The idempotency guard is `to_state IS NOT NULL`, marginally weaker than the
   comment's "complete snapshot" — an asset carrying only a *partial* snapshot would
   be skipped. Equivalent on this data (zero partial snapshots exist anywhere), and
   runtime writers emit complete snapshots.

**If a future migration touches this area, fix the comment there rather than
editing `0013`.**

---

## Why this exists

This ticket is not in `SYSTEM_PLAN.md`. It was found by querying the live local
database on 2026-08-16:

```
select count(*) total, count(to_state) with_to_state from transaction;
 total | with_to_state
-------+---------------
   754 |             0
```

**Every ledger row has a null `to_state`.** `foldAssetState`
(`packages/domain/src/fold.ts:5`) walks backwards looking for the first complete
snapshot; with none present it returns nothing for every asset in the system.

The consequences are larger than they look:

- Invariant 4 ("the projection is derivable") cannot pass, and cannot even be
  *measured*. STI-106 would report 754 divergences or 754 empty folds — either way,
  noise rather than signal.
- `asset.rebuild` (`routers/asset.ts:443`) is a no-op on all existing data. This is
  already documented as a known trap in `CLAUDE.md`, but it was recorded as a
  seed-data quirk rather than as the blocker it is.
- Every Phase 1 guarantee is built on a fold that currently has nothing to fold.

The ledger is append-only, so this is a **compensating write**, not an `UPDATE` of
history — see Approach.

## Acceptance criteria

1. Every asset has at least one ledger row carrying a **complete** `to_state`:
   `status`, `custodianId`, `projectId`, `locationId` — all four keys present, with
   explicit `null` where genuinely unknown. A missing key is not the same as null.
2. `foldAssetState` over the ledger reproduces `asset.current_*` for **every** asset.
   Prove it with the STI-106 checker, or with a query pasted into the QA report if
   STI-106 has not landed yet.
3. The backfill is **idempotent** — running it twice does not double-write and does
   not change the result.
4. The backfill does not `UPDATE` or `DELETE` any existing `transaction` row.
5. A test in `packages/domain` covers the shape of the snapshot the backfill emits,
   including the "explicit null, not missing key" rule.

## Approach

Write a single opening/synthesis event per asset rather than mutating history.
Something of this shape — decide the real event type against the existing
`event_type` values in the table:

```sql
insert into transaction (tenant_id, asset_id, event_type, actor_id, to_state, note, occurred_at)
select a.tenant_id, a.id, 'projection_baseline', null,
       jsonb_build_object(
         'status',       a.current_status,
         'custodianId',  a.current_custodian_id,
         'projectId',    a.current_project_id,
         'locationId',   a.current_location_id
       ),
       'STI-101 baseline: ledger predates complete snapshots',
       coalesce(a.created_at, now())
from asset a
where not exists (
  select 1 from transaction t
  where t.asset_id = a.id and t.to_state is not null
);
```

Confirm the real `asset.current_*` column names against
`packages/db/src/schema/asset.ts` before writing this — the names above are
inferred and **must be verified**.

`occurred_at` must sort **before** any real event for that asset, or the baseline
will win the fold and mask genuine history. Ties break on row `id`, not just
`occurred_at` (`.claude/rules/custody-and-ledger.md`) — check that the baseline's
`id` is lower, or set `occurred_at` strictly earlier.

Ship it as a hand-written migration, generated with
`drizzle-kit generate --custom --name=backfill_ledger_tostate`. That creates the
empty `.sql` **and** its `_journal.json` entry — never hand-edit the journal.
Precedent: `0009_backfill_team_rows.sql`. See `STACK-NOTES.md`.

## Risk

The backfill asserts that the *current projection is correct*. If a projection is
already wrong — which is the whole reason invariant 4 exists — this bakes the wrong
value into the ledger and makes the error permanent and provable-looking.

Before writing, report how many assets have a `current_custodian_id` that disagrees
with their newest active `assignment` row. If that count is non-zero, **stop and
escalate**; that set needs a per-tool judgement with the Equipment department, not a
script. This is the same class of risk `SYSTEM_PLAN.md` §6.1 flags for the duplicate
backfill.

## Files

- `packages/db/src/schema/event.ts:8` — ledger table
- `packages/db/src/schema/asset.ts` — projection columns
- `packages/domain/src/fold.ts:5` — the fold this exists to feed
- `packages/domain/src/fold.test.ts:114` — pins the partial-snapshot bug
- `packages/db/drizzle/` — new hand-written migration
