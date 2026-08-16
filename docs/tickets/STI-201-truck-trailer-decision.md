# STI-201 — Decision: truck and trailer modelling

**Phase:** 2 — Assignment detail
**Size:** 0 units (decision record)
**Status:** RESOLVED — 2026-08-16
**Unblocks:** STI-202, STI-203

---

## The question

`SYSTEM_PLAN.md` §8.2 left this open: *"Truck and trailer — two columns, or
`location.parentLocationId` hierarchy? How the yard actually thinks about it. The
hierarchy would make Phase 2 smaller."*

Invariant 5 — "every assignment carries full context: job, truck and trailer, all
three independently nullable but independently recordable" — currently fails.
`assignment` has a single `locationId` (`packages/db/src/schema/asset.ts:112`), which
cannot represent a truck *and* a trailer at the same time.

## What the code actually does today

Verified 2026-08-16:

- There is **no `trailer` table.** Truck versus trailer is a discriminator column,
  `vehicle.vehicleType` = `truck | trailer`
  (`packages/db/src/schema/location.ts:54`).
- A `vehicle` table exists (`location.ts:48-79`) with
  `ownershipType` = `company_owned | personal_allowance` (`location.ts:58`) — a plain
  text column, **not** a pg enum, and not the `'company' | 'personal'` values the plan
  assumes.
- Trucks and trailers are **also** `location` rows: `location.type` includes
  `vehicle` (`location.ts:27`) and `vehicle.locationId` is a NOT NULL 1:1 link
  (`location.ts:53`).
- Hitching a trailer to a truck is already expressed by pointing the trailer's
  location at the truck's location — with **no FK column**
  (`packages/api-contracts/src/routers/location.ts:403-406, 468-488`).
  `attachedToVehicleId` is a derived join field only.

So the hierarchy option is not hypothetical; a weak form of it already exists.

## Decision

**Two explicit columns: `truckId` and `trailerId` on `assignment`,** both nullable
FKs to `vehicle`. Matches the plan's §6.2 shape.

## Why

- Invariant 5 says the three must be **independently recordable**. Under the
  hierarchy, "which trailer" is only answerable by walking a parent chain that has no
  FK behind it, and "tool in a truck with no trailer" is not distinguishable from
  "tool in a truck whose trailer link was never set".
- The ownership distinction drives the Phase 3 departure path — personal vehicles are
  never reassigned because they are not Urban property (`SYSTEM_PLAN.md` §2). That
  logic needs to read the truck off the assignment directly, not infer it.
- The hierarchy is cheaper to build and more expensive to query, and this system's
  whole purpose is answering *where is this tool and who is accountable*. Optimise
  the question, not the migration.

## Accepted cost

The migration touches every reader of `assignment.locationId` and both the old and
new ledger snapshot shapes. Snapshots are historical and **must not be rewritten** —
the fold has to handle both. That constraint carries into STI-202 and STI-203.

## Caveat to revisit with Urban

This was decided on the engineering merits. `SYSTEM_PLAN.md` says the real tiebreaker
is *how the yard actually thinks about it*. If the yard's mental model turns out to
be "the trailer is part of the truck", the hierarchy becomes the better long-term
model and this decision should be re-opened before Release 2 — not after more code
depends on it.
