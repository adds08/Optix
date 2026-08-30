# STI-118 — Two more writers that split a projection from its ledger event

**Phase:** 1 — Custody trail (follow-up)
**Size:** 1 unit
**Status:** **DONE — 2026-08-22.** Both writers wrapped. `applyIntake` (the CHAT path, reachable by any foreman) now commits the asset row and its genesis ledger event together; `asset.setStatus` does the same AND moves its `before` read inside the transaction under `FOR UPDATE` — reading it outside was the identical race STI-114 fixed in `assignment.return`, and it let a second writer record a `fromState` that was never true.
**Found by:** the STI-115 implementer on 2026-08-18, running the grep that ticket's
criterion 5 required. Both confirmed by the lead.

---

## Why this exists

STI-115 made `asset.create` atomic. The grep it mandated found the same shape in two
more places, and one of them matters more than the ticket that found it.

**This corrects a claim made while closing STI-116.** It was stated then that deleting
the `/api/*` REST surface left `asset.create` as the only route to a no-evidence
asset. That was wrong — `applyIntake` is a second one, and it is the chat path.

## Defect 1 — `applyIntake` is not transactional, and it is user-reachable

`packages/api-contracts/src/apply-action.ts:465-503`.

`applyChatAction` dispatches intake at line 145 with `applyIntake(db, …)` — the **raw
`db` handle**, not a transaction. The `db.transaction` further down at line 241 belongs
to a different action branch and does not cover this path. Inside `applyIntake`:

```ts
.insert(schema.asset)        // write 1
…
.insert(schema.transaction)  // write 2 — separate, same handle, no tx
```

A failure between them leaves an asset with a projection and **zero ledger rows** — the
`no_evidence` state STI-110 reports every six hours and `rebuild` deliberately refuses
to repair. The ledger is append-only by trigger, so the missing opening snapshot can
never be added retroactively.

**This is the more serious of the two, and more serious than STI-115 was.** Intake is
how a tool gets registered *from chat* — a foreman or desk user saying "add this tool"
in the conversational layer. It is a normal, user-facing path, not an admin form.

## Defect 2 — `asset.setStatus` is not atomic

`packages/api-contracts/src/routers/asset.ts:378-419`. The projection `UPDATE` and the
ledger insert are separate awaits on `ctx.db`.

Less severe: a failure between them leaves a status change with no ledger evidence,
which is a **`stale_projection` divergence** — reported by STI-110's sweep and
repairable by `asset.rebuild`. It does not produce the unrecoverable no-evidence state.

Worth noting for STI-110's sake: `setStatus` is also the documented route for
*clearing* a no-evidence divergence, because it restates all four keys. A writer that
resolves divergences should not be able to create one.

## Acceptance criteria

1. `applyIntake` wraps its asset insert and opening ledger event in one transaction.
   Decide whether the transaction belongs inside `applyIntake` or is passed in by
   `applyChatAction`, and say why — the other branches at line 241 already open one,
   so there is a house pattern to either follow or deliberately diverge from.
2. `asset.setStatus` wraps its projection update and ledger insert in one transaction.
3. Both opening/changed events still carry a **complete** four-key `toState`. They do
   today; do not regress it while moving code. The fold replaces rather than merges.
4. `logEvent` and any other network-shaped call stays **outside** the transaction —
   `.claude/rules/custody-and-ledger.md` forbids it inside, because it pins a pool
   connection from a pool of 10. STI-115 resolved this same question the same way.
5. A test for each, proving atomicity by forcing the second write to fail and
   asserting no orphan survives. Shown RED before the fix and GREEN after —
   `packages/api-contracts/src/asset-create.test.ts` (STI-115) has the exact harness
   and a db-handle proxy to copy.
6. Re-run the grep from STI-115 criterion 5 and confirm nothing else of this shape
   remains. Report what you find.

## Related

- **STI-115** — the same defect in `asset.create`, fixed; copy its test harness.
- **STI-110** — the sweep that reports what these produce, and the reason defect 1 is
  unrecoverable while defect 2 is merely wrong.
- **STI-116** — deleted the REST surface that was the third instance.

## Files

- `packages/api-contracts/src/apply-action.ts:145, 465-503`
- `packages/api-contracts/src/routers/asset.ts:378-419`
- `packages/api-contracts/src/asset-create.test.ts` — the harness to copy
