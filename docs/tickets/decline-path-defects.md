# Decline path: broken message, and a missing ledger event

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY
**Depends on:** STI-102 (done), STI-105 (done)

---

## Why this exists

Both found by QA while verifying STI-105 on 2026-08-16, in code belonging to STI-102.
Neither blocked that ticket; both are now user-visible because STI-105 gave the decline
path its first UI caller.

## Defect 1 — a broken error message, user-facing

`packages/api-contracts/src/routers/assignment.ts:236` has a broken interpolation. The
CONFLICT message renders as:

```
This assignment is already .
```

The status is missing. This is the message a desk operator sees when they approve or
decline a row that was actioned elsewhere — precisely the moment they most need to know
*what* happened. QA hit it live while forcing a concurrent-action failure.

Trivial to fix; it only survived because nothing called the procedure until STI-105.

## Defect 2 — `assignment.decline` writes no ledger event

`assignment.decline` writes an audit-log entry only. `transfer.decline` writes a real
ledger event with `from_state = to_state`. Two procedures doing the same job for the two
custody kinds, recording it differently.

`SYSTEM_PLAN.md` §9 is unambiguous: *"Every custody-affecting change writes a ledger
event. No exceptions, including administrative corrections."*

**Decide, do not guess.** Is a decline custody-affecting? A defensible case exists both
ways, and the answer should be recorded in a comment either way:

- **Yes** — a refusal is a decision about custody. The tool was proposed to move and
  someone with authority said no. `transfer.decline` already takes this view, and a
  `from_state = to_state` event is exactly how you record "considered, and nothing
  changed". A desk asked to prove why a tool did *not* move has nothing to show
  otherwise.
- **No** — nothing moved, so the ledger has nothing to record, and a
  no-op event on every rejected request adds noise to an append-only log that can never
  be pruned.

Whichever is chosen, **both procedures must agree**. The current state — where the
answer depends on which kind of row you declined — is the one option that is definitely
wrong.

## Acceptance criteria

1. The CONFLICT message names the actual status. Verify by rendering it, not by reading
   the diff — the bug is in the interpolation, which is exactly what a reading misses.
2. A decision recorded in a comment on whether decline is custody-affecting, with the
   reasoning.
3. `assignment.decline` and `transfer.decline` treat the ledger **the same way**.
4. If declines do write ledger events, the event carries a **complete** four-key
   `toState` — same contract as every other writer. The fold replaces rather than
   merges.
5. Declining still leaves custody genuinely unchanged. STI-105's QA proved this
   currently holds for both kinds; it must not regress. Re-verify with a database query,
   not by inspection.
6. Tests covering both decline paths and whichever ledger behaviour is chosen.

## Files

- `packages/api-contracts/src/routers/assignment.ts:236` — the broken message, and
  `decline`
- `packages/api-contracts/src/routers/transfer.ts` — `decline`, the other behaviour
- `packages/api-contracts/src/custody.test.ts` — where the tests belong
