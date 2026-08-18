---
paths:
  - "packages/api-contracts/**"
  - "packages/domain/**"
---

# Custody and the ledger

You are in the two packages that own the product's central invariants. Read this before
changing anything here.

## The ledger contract

`transaction` is append-only and is the system of record. `asset.current_*` is a projection.

**Every write must carry a complete `toState` snapshot.** `foldAssetState`
(`packages/domain/src/fold.ts:5-12`) walks backwards and returns the first complete snapshot
it finds — it *replaces*, it does not merge. So emitting `{status: "in_maintenance"}` alone
does not mean "status changed"; it means *custodian, project and location are now undefined*,
and a rebuild will blank them.

Since STI-202 the snapshot also carries **optional** `truckId`/`trailerId` keys. They are
optional only so pre-STI-202 history stays readable: an ABSENT key folds to "not recorded",
an explicit `null` means "affirmatively none" — two different answers, and the fold keeps
them distinct (the shape-boundary rule in `fold.ts`, pinned by the "shape boundary" tests).

Since STI-203 the writers split three ways — pick the right bucket before adding one:

- **Custody movers emit BOTH keys explicitly, `?? null`, never a `current_*` fallback**:
  `assignment.create`/`approve`/`return`, `transfer.create`/`approve`, and the
  `assign`/`transfer`/`return`/`repair` cases in `apply-action.ts`. A new custody does not
  inherit the previous holder's rig, and a return or repair means the tool is affirmatively
  out of one. `assertVehicleContext` (custody.ts) must gate every id before it is written —
  the composite FK behind the columns is **tenant-blind** and raises raw 23503s.
- **Writers that assert nothing new about vehicles carry the newest snapshot's keys
  forward VERBATIM** (`vehicleContextFromLedger`, custody.ts) — absent stays absent. Two
  members: the from=to decline writers, and `applyContainerCustody`'s `custodian_change`
  (a container hand-over moves the WHO, not the where-it-rides — the tools stay in the
  same box, and a four-key event here erased "still in TE-006" from the fold for a tool
  that never left the trailer). The asset table has no truck columns, so the ledger is
  the only source; a blind null would stamp "affirmatively no truck" over a recorded
  ride and the next rebuild would blank it. The container writer also puts the carried
  context on the link it opens, so row and event tell one story.
- **Writers that never asked stay four-key**: `lost`/`report` in apply-action,
  `requestChatAction`'s annotation, `asset.setStatus`, the `project_change` bulk writer,
  and the intake/import/create baseline events. Absent keys are how those snapshots
  honestly say "unknown".

This bug has shipped three times. `fold.test.ts:114-135` pins it. Every writer that got it
wrong carries a scar-tissue comment — grep "Same fallbacks the asset update"
(`assignment.ts` create), "What a return MEANS" (`assignment.ts` return, STI-113: the
projection kept project and location while the ledger event nulled both), "Mirrors the
asset update" (`transfer.ts`) and the rebuild comment in `routers/asset.ts`.
Add one if you fix another.

Ties break on row `id`, not just `occurred_at` — bulk writers insert many events sharing a
timestamp (`location.ts`, `project-assign.ts`).

**Since STI-106 there is one fold.** `asset.rebuild` and the reconciliation checker both call
`foldAssetState` — the inline reimplementation is gone, so the tested code and the production
code are now the same code rather than two implementations that happened to agree.

Compare and repair are **separate actions**, deliberately:

- `asset.verifyProjection` writes nothing. It reports divergence, and an **empty fold is a
  divergence** — never soften that, it is precisely what STI-101 existed to make visible.
- `asset.rebuild` repairs, and **skips** assets whose ledger carries no snapshot. `INITIAL_STATE`
  is indistinguishable from "no evidence", and blanking a live row on no evidence would turn the
  repair into the corruption.

`sweepProjectionDivergence` (`apps/api/src/index.ts`) runs the check every 6 hours and at boot,
raising a `custody_discrepancy` desk notification per divergence. It does not dedupe — a register
that disagrees with the ledger should keep nagging.

## The custody chokepoint

**All custody writes go through `packages/api-contracts/src/custody.ts`. No exceptions.**
Never insert or update an `assignment` row directly.

Since STI-103 there **is** a database constraint — the partial unique index
`assignment_one_active_uq` on `assignment (asset_id) WHERE status = 'active'` (migration
`0015`). It is a backstop, not a replacement: it makes a second active row throw, but it
cannot *close* the previous link, and it does not cover `pending_approval` rows (two pending
approvals for one asset are still possible — see the re-check-under-lock rule below). So
`custody.ts` is still the only thing that makes custody correct; the index only guarantees
that getting it wrong fails loudly. It exists because `assignment.create`, `transfer.create` and
`transfer.approve` each opened custody without closing the previous link, so the register
showed the new holder while the custody screen showed the old one, and every downstream reader
(offboarding, capital-per-foreman, tools-follow-the-foreman) named someone who had given the
tool away weeks earlier. Read the header comment at the top of `custody.ts`.

- **Since STI-114 the "no exceptions" above is finally true in fact, not just in
  intent.** `assignment.return` was the last writer outside the chokepoint — it closed
  by id with no status guard, no lock, and an asset read outside its transaction. It
  now routes through `closeActiveCustody(tx, tid, assetId, "returned")`, which also
  owns stamping `returnedAt`.

  Be precise about what "no exceptions" means, because the obvious reading is wrong:
  **closing** an active link is the chokepoint's job and must never be done directly.
  **Opening** a new link is still a direct `insert` in `assignment.create`,
  `assignment.approve` and `apply-action.ts` — that is the intended STI-102 shape, and
  those writers count as going *through* the chokepoint because they call
  `closeActiveCustody` first, inside the same transaction. So: a direct write that closes
  or supersedes an active link is a regression; a direct insert that opens one after
  closing through the helper is not.
- **Decision procedures re-check status under the lock (STI-109).** The outside
  `status !== "pending_approval"` guard alone is not enough: two simultaneous approves
  both read "pending" before either commits, and the loser appended a duplicate event
  to the append-only ledger. Every approve/decline/return now takes the asset-row
  `FOR UPDATE` (the same anchor `custody.ts` locks, so all decisions on one tool
  serialise with each other), re-reads the row, and raises `CONFLICT` — naming the
  actual status — if the work is already done. Follow that shape if you add another
  decision path.

  One deliberate exception to the shape (STI-117): the two chat sign-off paths
  in `approve.ts` (`approveTaskAction`, `confirmMessageAction`) use
  **claim-then-act**, not a held lock. One conditional `UPDATE … WHERE status
  still confirmable` is the claim — racing claims serialise on the row lock
  inside the statement, the loser matches nothing and raises `CONFLICT` — and
  `applyChatAction` then runs **outside any transaction**. Two reasons: a
  `pendingAction` can name several assets or (intake) none, so no asset row can
  anchor the re-check; and `applyChatAction` opens its own transaction on the
  raw handle, so holding any transaction — and its pool connection — across it
  wedges the pool at pool-size concurrent approves. That wedge is client-side
  starvation (`max: 10`, `packages/db/src/index.ts`) which Postgres's deadlock
  detector cannot see; QA reproduced it before this shape replaced a held-lock
  first attempt. **Never hold a `db.transaction` open across
  `applyChatAction`.** The claim writes the terminal state before the apply;
  the trade-offs (stranded-claimed on crash, and the un-claim on a failed
  apply) are named on the claim comments in `approve.ts`.
- **Declines are custody-affecting (STI-112).** Both `assignment.decline` and
  `transfer.decline` write a `status_change` event with `from_state = to_state` — the
  complete snapshot, read under the lock so it is the state at commit time: four base
  keys off the asset row, vehicle keys carried forward from the newest ledger snapshot
  (STI-203, see the writer buckets above). "Considered, and refused" belongs in the
  tool's history; the reasoning lives on the ledger insert in `assignment.decline`.
- **Since STI-102, custody writes are transactional and row-locked.** `closeActiveCustody`
  and `moveCustody` take a `Transaction` (exported by `@stinventory/db`) as their first
  parameter — a raw `db` handle is a **compile error**, which is the enforcement: the old
  `db: any` signatures are how bare unwrapped writes shipped. The caller owns the
  transaction, because its projection update and ledger insert must commit or vanish with
  the close+open; `custody.ts` never opens one of its own. Nesting on postgres.js produces
  real savepoints, so threading the outer `tx` explicitly is the convention.
- `closeActiveCustody` first takes `SELECT … FOR UPDATE` on the **asset row** — the
  serialisation anchor, because it exists even when no assignment does — then locks the
  active links. Two concurrent moves on one asset queue instead of both opening a link.
  `src/custody.test.ts` pins this with a real race (it needs `DATABASE_URL`, which
  `turbo.json` passes through to the `test` task; the tests skip without it).
- **Never await anything network-shaped inside `db.transaction`** — postgres.js pins one
  pool connection (`max: 10`) for the life of the transaction. Notifications, audit
  `logEvent` and every LLM call stay outside; in `applyChatAction` the LLM parse has
  already happened in the worker before the transaction opens.
- `closeActiveCustody` updates **by predicate, not by id** — deliberate, because duplicate
  active rows already exist in real data and closing only the first would strand the rest.
  Also pinned by `custody.test.ts`.
- `projectForCustodian` (bottom of `custody.ts`) defaults the project to the **recipient's**
  primary project. A form that lets project be chosen independently of person is how a tool
  gets booked to a job its holder never worked. It is read-only, so it alone accepts either
  handle.
- `assignment.approve` closes the prior link inside its transaction. `create` deliberately
  skips the close while a row is `pending_approval` (nothing has taken effect yet), so
  approval is the moment the previous holder's link closes — until STI-102 nothing closed
  it, which left two active rows.

## The custody gate

`custodyOutcome` (`packages/domain/src/rules.ts`) asks **one** question — value:

| Cost | Outcome | Effect |
|---|---|---|
| ≥ threshold | `approve` | **Nothing written** until a second signature. |
| < threshold, or threshold null | `auto` | Applied as a permanent change. |

A null threshold **disables the gate**: a tenant that has not said what "high value" means has
not asked for one.

> **There is no `verify` outcome, and no borrow.** Both were removed on 2026-08-09, along with
> the second input ("does the actor hold the approve permission"). They modelled a foreman
> handing a tool to another foreman — the tool moving immediately while ownership did not, with
> the desk confirming afterwards. **Urban does not work that way**: tools are moved by the
> equipment desk, and a foreman does not reassign one. Foremen no longer hold
> `assignment.create` or `transfer.create` at all (`packages/db/src/seed.ts` — "read-only on
> custody by design"), so no actor can reach this function without already holding the approve
> permission, and the question had one answer.
>
> This stale three-outcome table misled ticket STI-105 into specifying a "borrow vs held"
> control for a state that cannot occur. If you find a doc describing `verify`, `pending_verification`
> or borrows as live behaviour, it is wrong — fix it. The 24-line rationale at the top of
> `rules.ts` is the real documentation.

`>=` not `>` is pinned (`rules.test.ts`). Null cost counts as 0, not "needs approval" —
imported rows routinely have no price. Since STI-108 the seed carries an asset priced at
exactly the threshold, so the boundary is exercisable from a clean database.

Callers currently disagree on two details: which permission means "can approve"
(`assignment.approve` vs `transfer.approve`) and the threshold fallback (`?? null` in the
routers vs `?? DEFAULT_HIGH_VALUE_THRESHOLD` in `apply-action.ts`). Chat and the forms are
supposed to agree exactly — if you touch this, make them.

## Non-negotiables here

- Tenant-scope every query: `eq(table.tenantId, tid)`. There is no RLS.
- Permission on every mutating procedure — `requirePermission(...)` or a documented
  `canApplyAction` check.
- Tests. `domain` is pure with no fixtures; there is no excuse.
