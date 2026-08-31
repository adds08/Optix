# `assignment.return` is the last custody writer bypassing the chokepoint

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY
**Depends on:** STI-113 (in QA)

---

## Why this exists

Reported by the STI-113 implementer, which was told to assess and not fix. Assessed
again here: it is worth fixing, because it is a stated invariant currently being
violated.

`CLAUDE.md` non-negotiable 2 and `.claude/rules/custody-and-ledger.md` both say it
plainly: **all custody writes go through `packages/api-contracts/src/custody.ts`. No
exceptions. Never insert or update an `assignment` row directly.**

After STI-102 brought `create`, `approve`, `decline` and all three transfer paths
through the chokepoint, **`assignment.return` is the only writer left outside it.** It:

- closes **by id** rather than by predicate
- has **no `status === "active"` guard**
- takes **no asset-row `FOR UPDATE` lock**
- reads the asset row **outside** its transaction

## What is and is not at risk

Be precise, because STI-113 already fixed the serious half.

**Not at risk:** ledger/projection divergence. STI-113 builds one `next` object and
feeds it to both the projection update and the `toState`, so under a race the two can
be *wrong together* but never *divergent*. Invariant 4 holds.

**Still at risk:**

- A concurrent assign committing inside the race window is silently overwritten —
  consistently, but overwritten.
- A double return on a stale id rewrites the asset and appends a **duplicate return
  event** to an append-only ledger that can never be pruned. Same class as STI-109.
- Duplicate active rows, if any exist from before STI-103, are not closed — close-by-id
  strands the rest, which is precisely the reasoning behind `closeActiveCustody`'s
  close-by-predicate behaviour.

## The fix looks pre-built

`closeActiveCustody(tx, tenantId, assetId, closeAs)` already accepts
`closeAs: "returned"` and sets `returnedAt`. That parameter exists for exactly this
migration and currently has no caller using it — a strong hint the original author
intended `return` to route through here.

## Acceptance criteria

1. `assignment.return` routes through `closeActiveCustody` with `closeAs: "returned"`.
2. The asset read moves **inside** the transaction, after the lock.
3. A `status === "active"` guard, so a double return raises rather than writing a second
   return event. Coordinate with STI-109, which adds the same re-check-under-lock shape
   to the approve paths — they should look alike.
4. STI-113's guarantee is preserved: the ledger `toState` and the projection are built
   from one object and cannot diverge. **Its test must stay green**, along with
   `custody.test.ts`, `ledger-append-only.test.ts` and `seeded-ledger-fold.test.ts`.
5. A concurrency test: two simultaneous returns on one asset produce exactly one
   `returned` row and exactly one ledger event. That is the behaviour this ticket buys.
6. `returnedAt` is still set — verify, since responsibility for it moves into the helper.
7. Update `.claude/rules/custody-and-ledger.md`: it currently states the chokepoint rule
   absolutely while `return` is an exception. Once fixed, the rule is finally true —
   say so.

## Files

- `packages/api-contracts/src/routers/assignment.ts` — the `return` procedure
- `packages/api-contracts/src/custody.ts` — `closeActiveCustody`, already supports this
- `packages/api-contracts/src/custody.test.ts` — where the concurrency test belongs
