# Execution plan — Phase 1 only

> **Scope reduced again 2026-08-16: Phase 1 only.** Wave E (Phase 2 — STI-202, 203, 204)
> is **cancelled**. STI-205 already landed and stays. Waves A–D below are the whole
> remaining run.

Waves, ordered by what actually collides. Every ticket gets full adversarial QA before
the next wave starts against the files it touched.

## The real constraint

**One database, one Docker stack, one working tree.** Almost every ticket needs the
database to verify, so "parallel" is bounded by data contention far more than by file
overlap. Three specific hazards, all observed:

- A ticket that **resets or reseeds** destroys every other agent's in-flight state.
- A ticket that **adds a constraint or trigger** changes behaviour under everyone else's
  test runs.
- Two tickets touching the **same test file** produce failures neither one caused.

So: DB-shape changes run alone. Code-only tickets on disjoint files run together.

---

## Wave A — STI-108, alone

Seed emits complete `toState`, seeds acquisition costs that reach the high-value gate,
and seeds a pending assignment and transfer.

**Must run alone**: it resets the database.

**Why first**: the database is currently in the broken state it fixes — the reseed during
STI-104 erased STI-101's baseline rows, so the boot sweep is raising 754 divergences.
Every subsequent QA agent works against that noise until this lands.

## Wave B — STI-103, alone

Partial unique index on `assignment (asset_id) WHERE status = 'active'`.

**Must run alone**: it adds a constraint that changes behaviour for every concurrent
test run, and it **breaks `custody.test.ts`'s duplicate-fabrication test by design** —
see the ticket. Ordering after STI-102 is mandatory: adding the net before fixing the
writers would surface constraint violations to users instead of quiet corruption.

## Wave C — parallel, two agents

Disjoint file sets, no schema change, no reset.

| Agent | Tickets | Surface |
|---|---|---|
| 1 | **STI-109 + STI-112** | `routers/assignment.ts`, `routers/transfer.ts`, `custody.test.ts` |
| 2 | **STI-111** | `apps/web/**`, `routers/dashboard.ts`, `apps/api/src/rest-routes.ts`, `packages/types` |

**STI-109 and STI-112 are deliberately paired into one agent.** Both edit the same two
routers and the same test file — running them separately would guarantee a conflict, and
both are small. One agent, two tickets, two QA passes.

## Wave D — STI-110, alone-ish

No-evidence divergence reporting. Touches `packages/domain`, `routers/asset.ts`,
`apps/api/src/index.ts`.

**Check the premise first.** After STI-108 the seed emits complete snapshots, so a
no-evidence divergence may no longer be reachable. If it cannot occur, the right
deliverable is a clearer alert, not repair machinery for an impossible state. The ticket
says so; the implementer must confirm before building.

## Wave E — Phase 2

| Step | Ticket | Notes |
|---|---|---|
| E1 | **STI-202** | Migration adding `truckId`/`trailerId`. Alone — schema change. |
| E2 | **STI-203** | Carries truck/trailer through custody and `toState`. Depends on E1. |
| E3 | **STI-204** | Typed `TRPCError`. Disjoint from E2 — may run parallel with it. |

STI-204 touches `apply-action.ts`, `approve.ts`, `task.ts`, `location.ts`,
`messaging.ts`, `projectGroup.ts`, `trpc.ts`. STI-203 touches `custody.ts`, the two
custody routers and `apps/web`. `apply-action.ts` is the only near-miss — E3 should
avoid the custody write block E2 may be editing, or run after it.

---

## Standing rules for every wave

1. **Full adversarial QA on every ticket**, by an agent that did not write the code. No
   risk-scaled shortcut — the cheapest-looking tickets have produced real defects here.
2. QA must **try an input the implementer did not**. That is what caught the CI drift
   check passing green on renames.
3. Every dispatch names the **paths concurrently being edited**, so failures get
   attributed correctly rather than filed against the wrong ticket.
4. Docs the change made wrong, and data the seed cannot reach, are **part of the change**
   — `CLAUDE.md` behaviour rule 8.
5. A ticket is DONE only on **QA PASS with evidence**. FAIL routes back to the *same*
   implementer with what QA confirmed correct, so it does not churn working code.
6. Nothing merges. The branch stays `release-1/delivery` for human review.
