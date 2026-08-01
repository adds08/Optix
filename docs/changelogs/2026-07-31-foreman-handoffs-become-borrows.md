# Foreman hand-offs become borrows the desk verifies

Commit `4ccea20`. Deployed to `urban.bodhitechlabs.com` 2026-07-31, verified in
the running bundle.

## What was wrong

Miguel Torres (foreman) moved UIC-090 to Dwayne Ellis from his own login, via
chat. Nothing asked the equipment desk, and the tool did not change hands — it
changed owners.

Two halves of one omission:

`requiresCustodyApproval` in `packages/domain/src/rules.ts` decided on value
alone. It accepted `fromCustodianId` and `toCustodianId` as arguments and
ignored both, and never saw who was acting. UIC-090 cost $90 against a $5,000
threshold, so the hand-off approved itself.

`transfer.create` then called `moveCustody` with no `type`, which defaults to
`permanent`. A borrow rewrote ownership.

The role split it needed was already in the database — `foreman` holds
`transfer.create`, `equipment_admin` holds `transfer.create` and
`transfer.approve`. The rule never read it.

Introduced by commit `20c8fda`, which removed a cross-person gate deliberately
(a $40 hand tool should not cost the desk what a $12k compactor does) but
replaced it with a value-only rule that has no concept of an actor.

## What it does now

`custodyOutcome()` returns `auto | verify | approve`, consulting the actor
first:

| Actor | Outcome | Effect |
|---|---|---|
| Foreman | `verify` | Applies now as a temporary borrow. Ownership untouched. Enters the desk queue. |
| Desk, at/over threshold | `approve` | Nothing moves until a second admin signs. |
| Desk, under | `auto` | Applies as permanent, as before. |

Permanent ownership is derived from history by `homeCustodianId()` — the most
recent `permanent` assignment — so no schema change and no migration.

`transfer.verify` is new, with `makePermanent` off by default. `transfer.decline`
on a borrow walks the tool back to its **home** custodian, not to
`fromCustodianId`, because it may have been lent on twice before anyone looked.

The chat executor got the same rule. It had to — chat is the surface foremen
actually use, and UIC-090 moved through it.

## Found while building

The value gate is deliberately asymmetric: it parks the desk's own moves but
never a foreman's. That looks inverted until you see that a foreman's move
cannot change ownership and is already in the desk's queue, so there is nothing
a value gate would protect. Blocking instead rebuilds the unattended queue that
`20c8fda` existed to escape.

The activity feed rendered every row as `transfer · UIC-090 · via transfer`. The
custodian ids live inside the `fromState`/`toState` jsonb as raw uuids and were
never resolved; `actorName` was selected and never displayed. Fixed in the same
pass — it now reads `Miguel Torres → Dwayne Ellis · recorded by Miguel`.

Chat messages carried only ids, so a bubble could say "Hand over · 1 tool" and
no more. They are now cards resolving tags, models, live status and holder in
two queries for the whole page, rendered on settled messages too.

## Deliberately not done

Expected return date is optional. Requiring one would put a form field between a
foreman and telling us where his tool went.

`assignment` did not get a `pending_verification` status. A foreman's
`assignment.create` is forced to `temporary` instead, which closes the ownership
hole without inventing a second queue.

## Data fix

UIC-090 was corrected in place on 2026-08-01 rather than deleted: the erroneous
`permanent | active` row became `temporary` with `approved_by` cleared, and a
`pending_verification` transfer was inserted so the desk sees it. UIC-1001 and
UIC-1002 were raised by `admin@` and are legitimately permanent.
