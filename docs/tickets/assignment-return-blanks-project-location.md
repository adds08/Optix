# `assignment.return` writes a partial `toState` that blanks project and location

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY — **highest priority of the remaining tickets**
**Depends on:** nothing

---

## Why this exists

Confirmed live in current code by QA on 2026-08-16, while verifying STI-108. It was
suspected in `STINVENTORY-EXPLAINER.md:540` and had never been re-verified after
`routers/assignment.ts` changed on this branch. It is still real.

`packages/api-contracts/src/routers/assignment.ts:288-290` — `assignment.return` keeps
`currentProjectId` and `currentLocationId` on the asset, while the ledger event written
four lines later carries:

```
toState: { …, projectId: null, locationId: null }
```

The projection says the tool has a project and a location. The ledger says it has
neither. **They disagree from the moment a return happens.**

## Why this is the most serious remaining defect

This is the exact bug class `CLAUDE.md` names as having shipped **twice**, and the one
`.claude/rules/custody-and-ledger.md` opens with: *the fold replaces, it does not merge.*
A snapshot that omits — or nulls — project and location does not mean "unchanged". It
means they are now null, and a rebuild makes that permanent.

The consequences compound with work that just landed:

- **It manufactures divergence.** STI-106's sweep runs every 6 hours and raises a
  `custody_discrepancy` desk alert per divergent asset. Every return creates one. The
  reconciliation check will start crying wolf about a bug in a *writer* — which is
  correct behaviour, and exactly why STI-106 was built to report rather than silently
  repair.
- **`asset.rebuild` now actually rebuilds.** Before STI-108 it was a no-op on seeded
  data, so this defect was invisible. It is not any more: a rebuild after a return will
  blank project and location for real.
- It is currently **latent, not active** — the seed contains no returns, so
  `verifyProjection` reports zero divergences today. The first real return in production
  starts the damage.

## Acceptance criteria

1. `assignment.return` writes a **complete** four-key `toState` — `status`,
   `custodianId`, `projectId`, `locationId` — that **matches the projection it writes**.
2. Decide deliberately what a return *means* for project and location, and record it in
   a comment:
   - If a returned tool genuinely has no project (it is back in the yard), then the
     **projection must be nulled too**, not just the ledger.
   - If it keeps them, the **ledger must carry them**, not null.
   Either is defensible. What is not defensible is the two disagreeing.
3. A test proving fold-equals-projection **after a return**. This is the specific case
   nothing covers today.
4. `asset.verifyProjection` reports zero divergences after a return is exercised.
   Verify by performing a real return, not by reasoning.
5. While in `assignment.return`: it closes by id and takes no asset-row lock, unlike the
   other custody paths after STI-102. QA flagged this earlier as a latent
   stale-overwrite hazard that cannot create a second active link. **Report whether it
   should route through `closeActiveCustody`; do not fix it in this ticket** unless it is
   required to satisfy criterion 1.
6. Update `STINVENTORY-EXPLAINER.md:540`, which describes this as an unverified
   suspicion. It is verified now, and it is fixed by this ticket.

## Files

- `packages/api-contracts/src/routers/assignment.ts:288-290` — the defect
- `packages/api-contracts/src/routers/transfer.ts` — compare; it writes complete
  snapshots correctly
- `packages/domain/src/fold.ts` — the semantics being violated
- `packages/api-contracts/src/custody.test.ts` — where the test belongs
- `.claude/rules/custody-and-ledger.md` — add a scar-tissue note naming this writer, per
  the convention that every writer which got this wrong carries one
