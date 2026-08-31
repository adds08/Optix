# Atomic custody writes: one transaction, row-locked

**Phase:** 1 — Custody trail
**Size:** 3 units
**Status:** READY
**Blocks:** STI-103
**Depends on:** nothing

---

## Why this exists

`SYSTEM_PLAN.md` §5 item 2 and invariant 3. Verified true on 2026-08-16.

`packages/api-contracts/src/custody.ts` contains **no** `db.transaction()` anywhere.
`moveCustody` (`custody.ts:59`) closes the active link with a bare `UPDATE` and opens
the new one with a bare `INSERT`, on the raw `db` handle. There is no row lock — the
plan's `tx.lock_for_update` has no counterpart in the code.

The routers repeat the pattern. `assignment.approve`
(`packages/api-contracts/src/routers/assignment.ts:156`) issues three consecutive
unwrapped writes:

- `assignment.ts:163` — update the assignment row
- `assignment.ts:168` — update the asset projection
- `assignment.ts:178` — insert the ledger event

A crash between any two leaves the register and the ledger permanently disagreeing,
and it is exactly the disagreement invariant 4 exists to detect. `transfer.approve`
(`routers/transfer.ts:239-261`) has the same shape with four writes.

This codebase already knows the idiom — `ctx.db.transaction(async (tx) => ...)` is
used in `routers/category.ts:139`, `routers/location.ts:171`, `routers/import.ts:269`
and others. Custody is the one write path that skips it.

## Acceptance criteria

1. `custody.ts` accepts a transaction handle and performs **no** writes outside one.
   Passing a raw `db` where a `tx` is required must be a type error, not a
   convention — make the signature enforce it.
2. The active assignment row is locked with `SELECT ... FOR UPDATE` before it is read
   and closed, so two concurrent moves on the same asset serialise instead of
   interleaving.
3. Every custody-affecting procedure wraps close + open + projection update + ledger
   insert in **one** transaction:
   - `assignment.create` (`routers/assignment.ts:95`)
   - `assignment.approve` (`routers/assignment.ts:156`)
   - `assignment.decline` (`routers/assignment.ts:202`)
   - `assignment.return` (`routers/assignment.ts:241`)
   - `transfer.create`, `transfer.approve` (`routers/transfer.ts:210`),
     `transfer.decline` (`routers/transfer.ts:309`)
4. **`assignment.approve` calls `closeActiveCustody`.** It currently does not
   (`.claude/rules/custody-and-ledger.md` records this as a known gap), which is how
   two active rows survive an approve. Fixing this is part of this ticket.
5. Every ledger insert on these paths carries a **complete** `toState` — status,
   custodian, project, location. The fold replaces; a partial snapshot blanks the
   rest.
6. A concurrency test: two simultaneous custody moves on one asset leave exactly one
   active assignment. This is the behaviour the ticket exists for and it must be
   pinned by a test, not by review.

## Approach

Thread `tx` through rather than opening a transaction inside `custody.ts` — the
callers already own transactions for their other writes, and nesting would either
create savepoints or silently flatten. Confirm Drizzle's nested-transaction
behaviour before choosing.

Change `CustodyMove` (`custody.ts:18`) and the two exported functions to take the
transaction handle as their first parameter with a real type, replacing the current
`db: any`. `db: any` is how a raw handle got passed in the first place.

Keep `closeActiveCustody`'s **close-by-predicate** behaviour (`custody.ts:37-39`).
The comment explains why: duplicates already exist in the wild, and closing only the
first found would strand the rest. That reasoning survives this change.

## Ordering note

This must land **before** STI-103. The moment the partial unique index exists, any
non-atomic writer that opens a second active row starts throwing a constraint
violation to the user instead of quietly corrupting data. Fix the writer first, then
add the net.

## Files

- `packages/api-contracts/src/custody.ts` — the chokepoint, whole file
- `packages/api-contracts/src/routers/assignment.ts:95,156,202,241`
- `packages/api-contracts/src/routers/transfer.ts:210,309`
- `packages/api-contracts/src/routers/category.ts:139` — the idiom done right
- `.claude/rules/custody-and-ledger.md` — update it; it cites a `homeCustodianId`
  at `custody.ts:75` that **does not exist**, and line numbers that have moved
