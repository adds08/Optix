# The seed must emit complete `toState` snapshots, and reach the rules it gates

**Phase:** 1 — Custody trail
**Size:** 2 units *(was 1; acquisition costs added)*
**Status:** READY
**Depends on:** STI-101 (done)
**Blocks:** STI-001 in practice — see below

---

## Why this exists

Found by the STI-101 developer while backfilling, and confirmed by the resulting
data. Not in `SYSTEM_PLAN.md`.

STI-101 backfilled the 754 existing ledger rows so every asset folds to a complete
state. But **the seed itself still writes `to_state = null`**, and migration 0013
will not re-run. So:

```
make ENV=local reset   →  fresh seed  →  null to_state again  →  the fold is a no-op
```

The environment returns to exactly the broken state STI-101 was written to fix, and
migration 0013's `NOT EXISTS` guard means it will not repair it.

This is the trap already recorded in `CLAUDE.md`: *"`asset.rebuild` reports nothing
rebuilt — seeded rows carry no `to_state`."* STI-101 fixed the symptom in one
database. This ticket fixes the cause.

## Why it blocks the E2E harness in practice

STI-001 needs deterministic database state between runs, and the leading candidate
mechanism is a reseed or a template database built from the seed. If the seed
produces a ledger that cannot be folded, then every E2E assertion about projection
correctness — STI-002 criterion 6 in particular — is asserting against data that is
broken by construction. The tests would pass or fail for reasons unrelated to the
code under test.

## Acceptance criteria

1. The seed writes a **complete** four-key `to_state` on every ledger event it
   creates: `status`, `custodianId`, `projectId`, `locationId`, with explicit `null`
   where genuinely unknown. A missing key is not the same as null — the fold replaces
   rather than merges.
2. After `make ENV=local reset`, **zero** assets lack a complete snapshot. Prove it
   with the same queries STI-101 used, pasted into the report.
3. After `make ENV=local reset`, `foldAssetState` reproduces `asset.current_*` for
   every asset — verified through the **TypeScript fold**, not a SQL reimplementation
   of it.
4. The seed does **not** emit `projection_baseline` events. That event type exists
   only to compensate for history written before complete snapshots
   (`packages/types/src/index.ts`); a seed writing it would be asserting a baseline
   for data it is creating fresh, which is a lie in the ledger. Emit the real event
   type for what the seed is actually doing.
5. `make ENV=local reset` still completes, and the three seeded logins still work.
6. If STI-104's append-only trigger has landed, the seed works with it — which per
   that ticket means wrapping the seed in `ALTER TABLE ... DISABLE TRIGGER`. Confirm
   the interaction rather than discovering it in CI.

## Second gap — the seed cannot reach the high-value gate

Found while building STI-105 on 2026-08-16. **No seeded asset has an
`acquisition_cost` at all.** `custodyOutcome` (`packages/domain/src/rules.ts`) returns
`approve` only at or above the tenant's threshold, so on seeded data that branch is
unreachable: every custody move takes the `auto` path.

The consequence is not cosmetic. The STI-105 developer had to `UPDATE` two rows in
`psql` to produce a single pending approval — meaning the approval queue, the desk
notification, and the entire second-signature path had **never been exercisable from a
clean seed**. A path nobody can reach from a fresh database is a path nobody tests.

7. Seeded assets carry realistic `acquisition_cost` values, **including some at or
   above the tenant's `highValueThreshold`** so the `approve` branch is reachable from
   a clean `make ENV=local reset`.
8. Seed at least one **pending assignment** and one **pending transfer**, so the desk
   queue has something in it on a fresh database and cannot regress to
   permanently-empty unnoticed.
9. Cover the **edge**, not just the happy path: `>=` is the rule, so seed an asset
   priced exactly *at* the threshold. `rules.test.ts` pins `>=` over `>`; the seed
   should be able to demonstrate it.
10. A null `acquisition_cost` remains represented too — imported rows routinely have no
    price, and null counts as 0 rather than "needs approval".

Per `CLAUDE.md` behaviour rule 8: when you add a threshold, status, role or state, seed
something that reaches it. This ticket is that rule applied to the gate that already
shipped without it.

## Files

- `packages/db/src/seed.ts` — the writer
- `packages/db/src/seed-data.ts` — the fixture data
- `packages/db/drizzle/0013_backfill_ledger_tostate.sql` — the shape to match
- `packages/domain/src/fold.ts:5` — what has to work afterwards
- `CLAUDE.md`, Traps table — remove the trap entry once this closes, since the
  underlying cause is gone
