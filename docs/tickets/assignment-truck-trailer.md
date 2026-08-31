# Truck and trailer as first-class assignment fields

**Phase:** 2 — Assignment detail
**Size:** 3 units
**Status:** READY (unblocked by STI-201)
**Blocks:** STI-203
**Depends on:** STI-201 (decided), STI-102 (custody should be atomic first)

---

## Why this exists

`SYSTEM_PLAN.md` invariant 5 and §6.2. Invariant 5 currently fails: `assignment`
holds a single `locationId` (`packages/db/src/schema/asset.ts:112`), which cannot
represent a truck *and* a trailer simultaneously.

Per STI-201 the decision is **two explicit nullable FK columns**, `truckId` and
`trailerId`, both referencing `vehicle`.

## Acceptance criteria

1. `assignment` gains `truckId` and `trailerId`, nullable, FK to `vehicle`, with
   indexes matching the existing convention (`asset.ts:120-125`).
2. Both are **independently nullable and independently recordable**. A tool in a
   truck with no trailer must be distinguishable from a tool whose trailer was never
   recorded. State in a comment how the two cases differ.
3. A check that `truckId` references a row with `vehicleType = 'truck'` and
   `trailerId` one with `vehicleType = 'trailer'`. Decide whether this is a DB
   constraint or a validation in `custody.ts`, and justify the choice — the FK alone
   cannot express it because both point at the same table.
4. `locationId` is **retained**, not dropped. It still carries yard and warehouse
   locations, which are not vehicles. Say explicitly in a comment what each of the
   three columns now means, or the next developer will guess wrong.
5. **The fold handles both old and new snapshot shapes.** Snapshots are historical
   and must never be rewritten. An old event with no `truckId` key means *unknown*,
   not *null* — and given the fold replaces rather than merges, getting this wrong
   silently blanks truck and trailer across all history.
6. A test in `packages/domain` covering a fold across the shape boundary: old events
   then new events for the same asset.
7. Migration generated with `make generate`, SQL read and committed, applied with
   `make ENV=local migrate`.

## The hard part

This is not the migration — it is item 5. Every existing `transaction.to_state` was
written under the old shape. After STI-101 there is a baseline event per asset in the
old shape too.

Decide and document one rule: does a missing `truckId` key in a historical snapshot
fold to `null`, or to "not recorded"? Both are defensible; only one can be
implemented, and the fold's replace-not-merge semantics mean the choice is visible in
every rebuild. Write it in `packages/domain/src/fold.ts` next to the code, not in a
ticket that will be archived.

## Files

- `packages/db/src/schema/asset.ts:104-126` — the assignment table
- `packages/db/src/schema/location.ts:48-79` — `vehicle`, incl. `vehicleType:54` and
  `ownershipType:58`
- `packages/domain/src/fold.ts:5` — must tolerate both shapes
- `packages/domain/src/fold.test.ts:114` — where the partial-snapshot rule is pinned
- `packages/api-contracts/src/custody.ts` — `CustodyMove` gains the two fields
  (STI-203 carries them through)
