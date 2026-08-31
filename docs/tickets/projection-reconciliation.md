# Reconciliation check that reports divergence

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY
**Depends on:** STI-101 (meaningless before the backfill)

---

## Why this exists

`SYSTEM_PLAN.md` invariant 4 — "folding the ledger from the beginning must reproduce
the current register exactly. A scheduled check proves it."

`asset.rebuild` (`packages/api-contracts/src/routers/asset.ts:443-482`) is listed in
§6.1's task list as the reconciliation check. It is not one. Verified 2026-08-16:

- **It overwrites instead of comparing.** There is no divergence list, no report, no
  assertion of emptiness. A silent corruption gets repaired without ever being
  surfaced — the signal invariant 4 exists to raise is destroyed rather than raised.
- **It reimplements the fold inline** (`asset.ts:459-462`:
  `for (const e of list) if (e.toState) latest = e`) instead of calling
  `foldAssetState` from `packages/domain/src/fold.ts:5`. The domain fold is imported
  by nothing outside its own test file, so the tested implementation and the
  production one merely happen to agree today.
- **It is not scheduled** — no cron or worker reference — and has **no UI caller**.

## Acceptance criteria

1. A `verify_projection` equivalent exists that **compares and reports**, and writes
   nothing. Repair stays a separate, explicit action.
2. Its output for each divergent asset names the asset, the folded state, and the
   projected state — enough to make a judgement without opening psql.
3. It calls `foldAssetState` from `packages/domain`. The production path and the
   tested path become the same code. Delete the inline fold at `asset.ts:459-462`.
4. `asset.rebuild` keeps working as the explicit repair action, but also routes
   through `foldAssetState`.
5. It runs on a schedule. `apps/api/src/index.ts:261` already schedules
   `deliverPendingNotifications` every 60s — follow that pattern, at a much lower
   frequency.
6. A divergence is **visible to a human**, not only in a log line. A desk alert
   through `notifyDeskPending`'s mechanism, or a report row — decide and justify.
7. Against the current database, after STI-101, the check reports **zero
   divergences**. Paste the real output. If it reports non-zero, that is a finding to
   escalate, not a number to tune away.
8. A test in `packages/domain` covering a known-divergent pair.

## Note on ordering

Before STI-101 lands this check is meaningless: all 754 ledger rows have a null
`to_state`, so the fold returns nothing for every asset and the checker would report
either 754 divergences or 754 empty folds. Both are noise. Do not build this first,
and do not "fix" the noise by making the checker tolerant of empty folds — an empty
fold *is* a divergence and must stay one.

## Files

- `packages/api-contracts/src/routers/asset.ts:443-482` — the blind repair to fix
- `packages/domain/src/fold.ts:5` — the fold to actually use
- `packages/domain/src/fold.test.ts` — extend
- `apps/api/src/index.ts:261` — the scheduling pattern
- `.claude/rules/custody-and-ledger.md` — remove the "known gap" note once closed
