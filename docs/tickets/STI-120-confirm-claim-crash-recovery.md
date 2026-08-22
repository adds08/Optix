# STI-120 — Chat sign-off can duplicate ledger events, and can strand requests

**Phase:** 1 — Custody trail (follow-up)
**Size:** 1 unit
**Status:** **DONE — 2026-08-22.** All six criteria. Gap 2a (a retry duplicating ledger events, no crash needed) closed by migration `0021`'s `transaction.ref_message_id` — an event has a subject and a cause, and overloading `refType`/`refId` to carry both is what lost the cause. Gap 1 (permanent stranding at the attempts ceiling) closed by splitting `unstickProcessing` on `proposedAction`: **`attempts` counts PARSE attempts and only gates parsing**, so a stalled CONFIRM is re-armed with no ceiling — raising the ceiling to five would have moved the cliff, not removed it. Gap 2b closed by the same idempotency guard. Gap 3 documented at the claim site with the reason a sweeper was NOT built: it would fix chat-raised tasks and silently re-apply form-raised ones in full, and half a recovery that corrupts the rest is worse than a documented manual one. `apps/api/src/request-worker.test.ts` is the first test in that package.
**Size note:** opened at 1 unit as a crash-window ticket. **Gap 2a changes that** — it is
a duplicate-write reachable by an ordinary user retry with no crash at all. Re-size before
starting; this is probably 2.
**Found by:** the STI-117 implementer on 2026-08-18 (gaps 1 and 2b, by *reading*
`request-worker.ts` instead of inferring recovery from the name `unstickProcessing`), and
STI-117's round-2 QA (gaps 2a and 3, by trying a partial multi-asset apply). STI-117 closed
the races on these paths; none of these are races.

---

## Background

STI-117 replaced a held transaction with **claim-then-act** on both chat sign-off paths.
`confirmMessageAction` claims by setting `message.processingStatus = 'processing'`, runs
`applyChatAction` outside any transaction, then writes the real outcome. A thrown apply
is caught and un-claims back to `action_proposed`.

Crash recovery relies on `unstickProcessing` (`apps/api/src/request-worker.ts:93-115`,
called by `sweepRequests` every 60s from `apps/api/src/index.ts:317-327`), which
re-queues rows:

```sql
WHERE processing_status = 'processing'
  AND updated_at < now() - interval '5 minutes'
  AND attempts < 4
```

That works in the normal case: the claim stamps `updatedAt`, and a message that ever
reached `action_proposed` already carries `attempts >= 1` from the parse claim
(`messaging-worker.ts:52`), while the confirm-claim adds none.

## Gap 1 — the `attempts < 4` ceiling can strand a message forever

A message that burned exactly `MAX_PARSE_ATTEMPTS = 4` on parsing — three failures then
a success — sits at `attempts = 4`. If the process crashes mid-apply after the
confirm-claim, that row fails the `attempts < 4` predicate and **`unstickProcessing`
will never re-queue it.** It stays `processing` permanently, and the Confirm button is
gone because the card no longer renders as actionable.

Narrow: it needs three parser outages, then a success, then a crash inside a
millisecond-scale window. But the failure is silent and permanent, which is the part
that matters — the user sees a request that simply stopped existing.

**The fix is a decision, not a patch.** `attempts` currently means "parse attempts", and
the sweep reuses it as a general give-up counter. Either the confirm-claim needs its own
recovery path that does not consult a parse counter, or `attempts` needs to mean
something coherent for both. Pick one and say why; do not just raise the ceiling to 5,
which moves the cliff rather than removing it.

## Gap 2a — a PARTIAL apply duplicates on retry, with no crash involved

**Found by STI-117 round-2 QA on 2026-08-18, and it corrects this ticket.** The original
version of gap 2 below claimed the crash window was the *only* remaining duplicate-write
path. That was wrong, and the proposed fix does not cover this case.

`applyChatAction` commits **per asset** (documented at `apply-action.ts:126-128`). So a
multi-asset action can apply some assets and then throw partway through — for example a
transfer naming a cheap asset and a high-value one with no custodian, where the cheap
asset auto-applies and the high-value one hits the gate's "names nobody" throw at
`apply-action.ts:182-186`.

The catch then **un-claims**, returning the message to `action_proposed` and re-arming the
Confirm button — after an error the user will naturally retry. Each retry re-applies every
asset that already succeeded. QA demonstrated it:

```
E6 confirm#1: error="...names nobody..." msgStatus=action_proposed cheapEvents=1
E6 confirm#2: error="...names nobody..." msgStatus=action_proposed cheapEvents=2 (transfer,transfer)
E6 transfer rows on cheap asset: 2 (completed,completed)
```

Permanent duplicates in an append-only ledger, from an ordinary retry. **No crash
required**, which makes it far more reachable than gap 2.

**Not a STI-117 regression** — pre-STI-117 a partial failure also left the message
`action_proposed` and retryable. STI-117 neither caused nor closed it.

**And it defeats the fix proposed for gap 2.** Checking `executedTransactionIds` cannot
help here: when `applyChatAction` throws, the ids of the partially-applied assets are
lost — the catch at `approve.ts:287-296` never learns them. Any idempotency design must
record what was applied **as it is applied**, not on success.

This is the strongest argument for criterion 3 below, and it should be settled before the
crash window, because it needs no crash.

## Gap 2b — a crash after the apply commits can still duplicate it

If the crash lands **after** `applyChatAction` committed its ledger event but **before**
the final status write, the sweep re-queues the message → the parser re-proposes it → a
re-confirm applies it a second time. A duplicate event in an append-only ledger.

**Be precise about what changed here: nothing.** Pre-STI-117 the same crash left the
message at `action_proposed` and directly re-confirmable, so the exposure is identical.
Claim-then-act neither introduced this nor closed it.

The honest fix is idempotency rather than more locking: `applyChatAction` already writes
`executedTransactionIds` onto the message, so a re-confirm could detect that the work is
already done and return the existing ids instead of re-applying. Consider that before
reaching for another lock.

## Gap 3 — a stranded TASK has no sweeper at all

Also from STI-117 round-2 QA. The completed-before-applied window is real and wide: while
approving a 30-asset request, **175 of 178 samples** showed `task.status = 'completed'`
with fewer than 30 events applied, including samples at zero. A desk user refreshing the
list sees "completed" for work that has not happened.

The claim comment at `approve.ts:98-104` argues this trade-off and the reasoning is sound
— leaving it `pending` invites the duplicate-writing retry above, which is permanent,
while this is transient. **But the two paths are not symmetric:**

| Path | Crash mid-apply | Recovery |
|---|---|---|
| message (`confirmMessageAction`) | stuck `processing` | `unstickProcessing` re-queues after 5 min (subject to gap 1) |
| **task** (`approveTaskAction`) | stuck `completed`, unapplied | **none — a human must re-raise the request** |

Nothing sweeps tasks. That asymmetry is undocumented, and it means the task path's window
is not merely wider but unrecoverable.

## Acceptance criteria

1. A decision, recorded in a comment, on what `attempts` means and which counter governs
   confirm-claim recovery. Gap 1 cannot strand a message permanently afterwards.
2. A test proving a message claimed at `attempts = 4` is still recoverable.
3. **Gap 2a is settled first**, because it needs no crash. Either the retry becomes
   idempotent per asset, or a partial failure stops being retryable. Any design must
   record what applied **as it applies**, since a throw loses the partial ids.
4. A test proving a retry after a partial failure writes **no** second ledger event for
   the assets that already succeeded. QA's repro — a transfer naming a cheap asset and a
   high-value one with no custodian — is the case to copy.
5. A decision on gap 2b — idempotent re-confirm, or an accepted-and-documented risk. If
   accepted, the acceptance is written where the next reader will find it.
6. A decision on gap 3: either tasks get a sweeper, or the asymmetry is documented at the
   claim site so the next reader knows a stranded task needs a human.
7. The STI-117 suites stay green — `custody-concurrency.test.ts` (8 tests, including the
   two un-claim tests and the pool regression), `decline.test.ts`, `custody.test.ts`,
   `ledger-append-only.test.ts`, `seeded-ledger-fold.test.ts`.

## Related

- **STI-117** — introduced claim-then-act and closed both races on these paths.
- **STI-109** — the original duplicate-ledger-event race this family descends from.

## Files

- `apps/api/src/request-worker.ts:93-115` — `unstickProcessing` and its predicate
- `apps/api/src/messaging-worker.ts:52` — where `attempts` is incremented on parse claim
- `packages/api-contracts/src/approve.ts` — `confirmMessageAction`, the claim and un-claim
- `packages/api-contracts/src/custody-concurrency.test.ts` — the harness to extend
