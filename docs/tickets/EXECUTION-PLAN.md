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

## Wave E — Phase 2 (revised 2026-08-18)

> **The original ordering here was wrong and would have caused a collision.** It said
> E3 (STI-204) "may run parallel with" E2 (STI-203), naming `apply-action.ts` as the
> only near-miss. A file-level check on 2026-08-18 found **two** overlaps, not one:
>
> - `apply-action.ts` calls `closeActiveCustody` at four sites and writes ledger
>   events, so STI-203 must edit it (its criterion 2 requires both new keys in every
>   custody `toState`) — and STI-204 rewrites thirteen `throw new Error` calls in the
>   same file.
> - `location.ts:111` calls `moveCustody`, so STI-203 needs it — and STI-204 needs
>   `location.ts:505`.
>
> They cannot run together. Revised waves below.

| Step | Ticket | Runs | Notes |
|---|---|---|---|
| E1 | **STI-202** + **STI-204** | parallel | Disjoint: E1a is schema/migration/domain, E1b is the router error surface. |
| E2 | **STI-203** | alone | Depends on both. |

### E1a — STI-202, schema and fold

Owns `packages/db/src/schema/**`, the migration, `packages/domain/**`, and the
`CustodyMove` **type** in `custody.ts`.

**Add `truckId`/`trailerId` to `CustodyMove` as OPTIONAL**, or every existing caller
(`location.ts`, `transfer.ts` ×2, and the four `closeActiveCustody` sites in
`apply-action.ts`) becomes a compile error the moment the type lands — which would
collide with E1b mid-run. STI-203 makes them real in E2.

The migration is the easy half. **The hard half is the fold across the shape
boundary** (STI-202 criterion 5): every existing snapshot was written without these
keys, and the fold *replaces* rather than merges, so choosing wrongly blanks truck and
trailer across all history on the next rebuild.

### E1b — STI-204, typed errors

Owns `apply-action.ts`, `approve.ts`, `task.ts`, `location.ts`, `messaging.ts`,
`projectGroup.ts`, `trpc.ts`, `apply-action.test.ts`.

**Must not start until STI-117 lands** — that ticket is editing `approve.ts`.

### E2 — STI-203, alone

Owns `custody.ts`, `routers/assignment.ts`, `routers/transfer.ts`, `apply-action.ts`,
`routers/location.ts`, and the `apps/web` forms and screens.

Running it *after* STI-204 is not merely a collision workaround — it is better
ordering. STI-203's criterion 6 requires rejecting a wrong vehicle type "with a typed
error the UI can render", which is exactly what STI-204 builds.

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
