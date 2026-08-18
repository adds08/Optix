# STI-109 — Concurrent double-approve writes a duplicate ledger event

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY
**Depends on:** STI-102 (done)

---

## Why this exists

Found by the STI-102 developer, disclosed rather than fixed, and then **independently
reproduced by QA** on 2026-08-16.

Two simultaneous `assignment.approve` calls on the same pending row both return
`ok: true` and both write an "Assignment approved" ledger event — two rows sharing a
`ref_id` and an identical complete `toState`.

The custody invariant itself **holds**: the asset-row lock introduced by STI-102 means
exactly one active assignment survives, and because the duplicate events are
content-identical the fold is unaffected. This is not corruption.

It is, however, **audit pollution in an append-only ledger** — and the ledger is the
thing that has to stand up as evidence when a tool goes missing. Two approvals recorded
for one approval is a defect in exactly the artifact this system exists to make
trustworthy, and it can never be deleted.

## Root cause

The status guard runs **before** the transaction takes its lock:

```
check status === 'pending_approval'     ← both callers pass here
  ↓
BEGIN; SELECT ... FOR UPDATE            ← serialises from here on
  ↓
write ledger event                      ← both write
```

Both callers read `pending_approval` before either has committed, so both proceed. The
lock serialises the *writes* but never re-asks whether the work is still needed.

## Acceptance criteria

1. Re-check the row's status **inside** the transaction, after the lock is taken. The
   second caller must find the row no longer `pending_approval` and stop.
2. The loser gets a clear `CONFLICT` error, not a silent no-op. A caller that believes
   it approved something that it did not is worse than an error.
3. Exactly **one** ledger event per approval under concurrent double-approve. Prove it
   with a test that races two approves and counts the rows — the developer's disclosure
   and QA's reproduction both used a live race, so this is reproducible.
4. Apply the same check to `transfer.approve`, which has the identical shape. Do not
   fix one and leave the other — divergence between the two approve paths is already a
   known irritant here.
5. `assignment.decline` reviewed for the same pattern. Fix if present; say so if not.
6. Existing STI-102 tests continue to pass. The asset-row lock and close-by-predicate
   behaviour must not change — they were verified working and are not in scope.

## Scope

Small and surgical: a re-check inside an existing transaction. Do **not** restructure
the approve paths, and do not take the opportunity to reconcile the two approve
procedures' other differences — that is STI-110's business, not this ticket's.

## Files

- `packages/api-contracts/src/routers/assignment.ts` — `approve`, and check `decline`
- `packages/api-contracts/src/routers/transfer.ts` — `approve`
- `packages/api-contracts/src/custody.test.ts` — where the race tests already live
