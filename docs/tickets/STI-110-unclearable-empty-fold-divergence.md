# STI-110 — A no-snapshot divergence is reported forever and can never be cleared

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY
**Depends on:** STI-106 (done)

---

## Why this exists

Traced empirically by QA on 2026-08-16 while verifying STI-106, and confirmed against
the running stack rather than reasoned about.

STI-106 established a deliberate and **correct** asymmetry:

- `asset.verifyProjection` treats an **empty fold as a divergence**. It must — that is
  precisely what STI-101 existed to make visible.
- `asset.rebuild` **skips** assets whose ledger carries no snapshot. It must —
  `INITIAL_STATE` is indistinguishable from "no evidence", so repairing would blank a
  live custodian on zero evidence. That would be the corruption, not the fix.

Both halves are right. The consequence is not.

**An asset that is divergent *and* has no snapshot in its ledger is reported every six
hours, forever, and `asset.rebuild` can never clear it.** QA confirmed this directly:
with two divergences present, `rebuild` returned `{"assetsRebuilt":1}` — it repaired
the one with a real snapshot, and the no-snapshot asset was still flagged afterwards.

The only exits today are a new genuine custody event through the app, or another
explicit STI-101-style backfill. Neither is discoverable from the alert.

## The part that actually hurts

Neither the notification body nor the report distinguishes the two cases:

| Case | What it means | What to do |
|---|---|---|
| A writer corrupted the projection | Real divergence | `asset.rebuild` fixes it |
| The ledger lacks a baseline | No evidence either way | Needs a backfill decision |

The operator's only clue is noticing that `folded` happens to equal the initial state.
A desk alert that recurs every six hours and cannot tell you which of two very
different problems you have is the shape of alert people learn to dismiss — and a
dismissed reconciliation alert is worse than none, because it looks like coverage.

## Acceptance criteria

1. The divergence report distinguishes **"projection disagrees with the ledger"** from
   **"the ledger has no evidence for this asset"**. Two named kinds, not one.
2. The desk notification says which kind it is, and what action each needs.
3. `asset.rebuild` keeps skipping no-evidence assets. **Do not "fix" this by letting
   repair blank the row** — that inverts STI-106's reasoning and reintroduces the
   corruption. If a fix looks like it needs that, it is the wrong fix.
4. A no-evidence divergence has **some** documented route to resolution. A backfill
   procedure, a per-asset baseline action taken by an operator with `asset.manage`, or
   an explicit acknowledge-and-suppress — decide and justify. "Wait for a custody
   event" is acceptable only if the alert says so.
5. If suppression is the chosen route, it is **per asset and recorded**, never a global
   mute. Suppressing the class would re-hide exactly what STI-101 uncovered.
6. Tests covering both kinds, and covering the rule that repair never touches the
   no-evidence kind.

## Worth checking first

On current data this set is **empty** — every asset has a complete snapshot after
STI-101, and the live check reports zero divergences. So this is a latent gap, not an
active fault, and it should be sized accordingly.

Before building, confirm whether a no-evidence divergence can even arise now that
STI-108 makes the seed emit complete snapshots. If the only way to create one is a bug
elsewhere, the right fix may be a clearer alert rather than a repair path — say so
rather than building machinery for a state that cannot occur.

## Files

- `packages/domain/src/fold.ts` — `reconcileProjections`, the two kinds
- `packages/api-contracts/src/routers/asset.ts` — `verifyProjection`, and `rebuild`'s
  skip at the no-snapshot branch
- `apps/api/src/index.ts` — `sweepProjectionDivergence` and the notification body
