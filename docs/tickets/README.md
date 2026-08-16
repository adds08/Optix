# Release 1 delivery board

Target: **23 August 2026**. Branch: `release-1/delivery`, cut from `development`.

> ## Scope reduced 2026-08-16 — Phase 1 only
>
> `SYSTEM_PLAN.md` §6 defines five phases. **We are finishing Phase 1 and stopping.**
>
> | Phase | Status |
> |---|---|
> | 1 — Custody trail | **IN SCOPE** — the only phase being delivered |
> | 2 — Assignment detail | out of scope (STI-205 already landed and stays) |
> | 3 — Roles, accounts, org structure | out of scope — also blocked on Urban (STI-301) |
> | 4 — Foundation entity load | out of scope — also blocked on Urban (STI-401) |
> | 5 — Desk views by role | out of scope |
>
> All out-of-scope tickets stay written. They are researched, verified against the code
> with `file:line` citations, and ready to pick up — no work is lost by stopping here.
>
> **What Phase 1 alone delivers:** a custody trail that is trustworthy and reachable.
> Atomic, row-locked custody writes; one active assignment enforced by the database; an
> append-only ledger enforced by a trigger; a projection provably derivable from the
> ledger, with divergence alerting; and a desk queue that can actually be worked.
>
> **What is deferred, stated plainly so Urban hears it as a deferral and not a
> surprise:**
> - **Invariant 5 still fails.** `assignment` carries a single `locationId`, so a tool
>   cannot record both a truck and a trailer. Phase 2 was that fix.
> - No four-tier visibility ladder — a superintendent and a foreman remain
>   indistinguishable to the scoping layer, and the KPI dashboard still ignores project
>   scope.
> - No user administration of any kind, and login is still tenant-blind.
> - No Foundation load, no departure reassignment, no permission-driven desk.
>
> None of that is new breakage. It is Release 1 scope now deferred rather than
> delivered.

This board is the working ticket list. One file per ticket. `SYSTEM_PLAN.md` stays
the contract; this directory is how it gets executed.

---

## How a ticket moves

```
BLOCKED ──(decision taken)──▶ READY ──▶ IN PROGRESS ──▶ IN QA ──▶ DONE
                                            │              │
                                            └──── FAIL ◀───┘
```

A ticket is **DONE** only when a `sti-qa` agent that did not write the code has
returned **PASS** with evidence. Not when the developer says so.

**Every ticket gets full adversarial QA, including the small ones.** No risk-scaled
shortcut. The cheapest-looking tickets have produced real defects here — a broken
user-facing message survived only because nothing called the procedure, and a CI check
passed green on an entire class of schema change while its author's evidence looked
sound. Quality is the constraint being optimised; agent time is not.

Deep multi-agent review (`/code-review ultra`) sits outside this board — the user runs
it once, manually, after all the work is finished.

Status lives in the `Status:` field of each ticket file. Update it in place.

## The team

| Agent | File | Does | Never does |
|---|---|---|---|
| **Team lead** | the main session | Sequencing, decisions, dependency management, final integration | Writes production code unsupervised |
| **`sti-dev`** | `.claude/agents/sti-dev.md` | Implements exactly one ticket | Plans, reviews its own work, fixes adjacent bugs |
| **`sti-qa`** | `.claude/agents/sti-qa.md` | Adversarially verifies one ticket | Fixes what it finds — that destroys the evidence |
| **`sti-e2e-qa`** | `.claude/agents/sti-e2e-qa.md` | One end-to-end pass over a whole phase, in a browser | Unit-level review |

Every agent is required to invoke the **`minimal-change`** skill before producing a
diff, and **`systematic-debugging`** before proposing any fix. These are project
skills in `.claude/` and are tuned to this repo — prefer them over the generic
`superpowers` equivalents.

**Read [STACK-NOTES.md](STACK-NOTES.md) before working any ticket.** It records the
pinned versions and the four places where this repo differs from what the public docs
assume — postgres.js rather than node-postgres, Next 16.3 rather than 15, drizzle-kit
0.28.1, Vitest 2.1.5. Building from the wrong assumption is the cheapest mistake to
make here and the most expensive to unpick.

## Definition of done — every ticket

1. `make ENV=local typecheck` passes. Real output pasted, not asserted.
2. `make ENV=local test` passes.
3. Tests exist for the behaviour that changed. `packages/domain` and
   `packages/types` are pure and need no fixtures — there is no excuse there.
4. **It is reachable.** A correct procedure with no UI caller is not delivered
   (`SYSTEM_PLAN.md` §9). QA greps `apps/web` for a real call site.
5. Migrations generated, committed, and applied — `make generate` → commit SQL →
   `make migrate`. Never `push-dangerous`.
6. Stale references swept: docs, `.claude/rules/`, renamed symbols.
7. **Docs the change made wrong are fixed, and data the change needs is seeded** — both
   in the same change, never deferred. A stale `.claude/rules/` file misleads every
   future change because it loads automatically; behaviour the seed cannot reach is
   behaviour nobody tests. See `CLAUDE.md` behaviour rule 8.

## The five invariants that outrank convenience

If minimalism conflicts with any of these, they win, and the diff says so out loud.

1. Every ledger write carries a **complete** `toState`. The fold replaces; it does
   not merge.
2. All custody writes go through `packages/api-contracts/src/custody.ts`.
3. Every query carries `eq(table.tenantId, tid)`. There is no RLS.
4. Every mutating procedure carries a permission.
5. Tests for the behaviour changed.

---

## Board

Sizes are in *units*, matching `SYSTEM_PLAN.md` §6 (1 unit ≈ half a developer-day).

### Phase 1 — Custody trail (13 units)

| ID | Title | Size | Status |
|---|---|---|---|
| [STI-101](STI-101-ledger-tostate-backfill.md) | Backfill `to_state` on the existing ledger | 2 | ✅ DONE — QA PASS |
| [STI-108](STI-108-seed-emits-complete-snapshots.md) | Seed emits complete snapshots + reaches the gates | 2 | ✅ DONE — QA PASS (round 2) |
| [STI-113](STI-113-assignment-return-blanks-project-location.md) | `assignment.return` writes a partial `toState` | 1 | ✅ DONE — QA PASS |
| [STI-114](STI-114-return-bypasses-custody-chokepoint.md) | `assignment.return` bypasses the custody chokepoint | 1 | READY |
| [STI-102](STI-102-atomic-custody-writes.md) | Atomic custody writes — one transaction, row-locked | 3 | ✅ DONE — QA PASS |
| [STI-109](STI-109-double-approve-duplicate-ledger-event.md) | Concurrent double-approve duplicates a ledger event | 1 | READY |
| [STI-103](STI-103-one-active-assignment-index.md) | Partial unique index for one-active-assignment | 2 | READY |
| [STI-104](STI-104-ledger-append-only.md) | Enforce ledger append-only at the database | 1 | ✅ DONE — QA PASS (round 2) |
| [STI-105](STI-105-desk-queue-ui.md) | Desk queue screen — approve / decline | 3 | ✅ DONE — QA PASS |
| [STI-111](STI-111-remove-dead-verify-remnants.md) | Remove dead `pending_verification` remnants | 1 | READY |
| [STI-112](STI-112-decline-path-defects.md) | Decline path: broken message, missing ledger event | 1 | READY |
| [STI-106](STI-106-projection-reconciliation.md) | Reconciliation check that reports divergence | 1 | ✅ DONE — QA PASS |
| [STI-110](STI-110-unclearable-empty-fold-divergence.md) | No-snapshot divergence can never be cleared | 1 | READY |
| [STI-107](STI-107-ci-migration-drift.md) | Real migration drift detection in CI | 1 | ✅ DONE — QA PASS (round 2) |

### Phase 2 — Assignment detail (7 units)

| ID | Title | Size | Status |
|---|---|---|---|
| [STI-201](STI-201-truck-trailer-decision.md) | **Decision:** two columns vs location hierarchy | 0 | RESOLVED — two columns |
| [STI-202](STI-202-assignment-truck-trailer.md) | Truck and trailer as first-class assignment fields | 3 | READY |
| [STI-203](STI-203-custody-context-writers.md) | Carry truck/trailer through custody + `toState` | 2 | BLOCKED by STI-202 |
| [STI-204](STI-204-typed-trpc-errors.md) | Typed `TRPCError` across the chat/action path | 2 | READY |
| [STI-205](STI-205-error-boundary-retry-prop.md) | Error boundaries recover without re-fetching | 1 | ✅ DONE — QA PASS |

### Phase 3 — Roles, accounts and organisation structure (18 units)

| ID | Title | Size | Status |
|---|---|---|---|
| [STI-301](STI-301-permission-matrix.md) | **Decision:** permission matrix, incl. what an Engineer may do | 0 | BLOCKED on Urban |
| [STI-302](STI-302-visibility-permissions.md) | Four-tier visibility permissions and scoping | 4 | BLOCKED by STI-301 |
| [STI-303](STI-303-user-administration.md) | User administration — create, role, deactivate, reset | 4 | READY |
| [STI-304](STI-304-missing-login-roles.md) | Login accounts for the roles that have none | 2 | BLOCKED by STI-301 |
| [STI-305](STI-305-tenant-scoped-login.md) | Tenant-scoped login and per-tenant unique email | 2 | READY |
| [STI-306](STI-306-departure-reassignment.md) | Departure reassignment in one auditable action | 3 | READY |
| [STI-307](STI-307-remove-role-branching.md) | Replace role-name branching with permission checks | 2 | BLOCKED by STI-302 |
| [STI-308](STI-308-rbac-matrix-test.md) | RBAC matrix test across every role | 1 | BLOCKED by STI-302 |

### Phase 4 — Foundation entity load (6 units)

| ID | Title | Size | Status |
|---|---|---|---|
| [STI-401](STI-401-foundation-interface-decision.md) | **Decision:** Foundation interface, and whether `phase` returns | 0 | BLOCKED on Urban |
| [STI-402](STI-402-external-ref-identity.md) | `external_ref`, `source`, `last_synced_at` identity columns | 2 | BLOCKED by STI-401 |
| [STI-403](STI-403-foundation-loader.md) | Idempotent loader with adopt-by-natural-key | 2 | BLOCKED by STI-402 |
| [STI-404](STI-404-foundation-owned-fields-readonly.md) | Foundation-owned fields read-only in the UI | 1 | BLOCKED by STI-402 |
| [STI-405](STI-405-import-tests.md) | Tests for the spreadsheet import | 1 | READY |

### Phase 5 — Desk views by role (4 units)

| ID | Title | Size | Status |
|---|---|---|---|
| [STI-501](STI-501-panel-registry.md) | Permission-driven panel registry | 2 | BLOCKED by STI-302 |
| [STI-502](STI-502-desk-panels.md) | The five Release 1 panels | 2 | BLOCKED by STI-501 |

### Cross-cutting — test infrastructure

| ID | Title | Size | Status |
|---|---|---|---|
| [STI-001](STI-001-playwright-harness.md) | Playwright E2E harness against the Docker stack | 2 | DEFERRED — out of scope |
| [STI-002](STI-002-e2e-critical-paths.md) | E2E specs for the custody critical paths | 2 | DEFERRED — out of scope |

Deferred with the 2026-08-16 scope reduction: neither is Phase 1 or 2, and §6 never
budgeted for them.

**The tradeoff, so it is a decision and not an oversight:** the desk queue, the atomic
custody writes and the reconciliation check have all been verified *once*, by hand,
against a live stack. Nothing automated will catch it if a later change makes the queue
unreachable again — which is exactly how it became unreachable the first time. The
per-ticket QA gate substitutes for this while the work is active; it does not
substitute for it afterwards.

---

## Totals

### In-scope remaining — Phase 1 only

| | Units |
|---|---|
| Accepted (incl. STI-205, a Phase 2 ticket already landed) | 8 |
| Remaining — STI-104 (in QA), 108, 103, 109, 110, 111, 112 | 9 |
| **Total remaining** | **9** |

Deferred: 33 units across Phases 2–5, of which 21 were blocked on an Urban decision
anyway.

### Whole-board totals, for reference

The overrun is STI-101 (a blocker the plan did not know about), STI-205 (an active
defect found during stack research) and STI-001/002 — the Playwright harness, which
§6 does not budget for but Release 1 cannot be verified without.

**Schedule reality.** 53 units is roughly 26 developer-days against a target seven
days out. Phases 1, 2 and 5 are achievable. Phase 3 at 18 units is not, and it is
also the phase blocked on the decision nobody has taken yet. Say this to Urban early
rather than discovering it on the 22nd.

## Sequencing

Phase 1 is strictly first — it is the only phase that makes the history
trustworthy, and every later phase writes to that history.

```
STI-101 ──▶ STI-106            (backfill before reconciliation can mean anything)
STI-102 ──▶ STI-103            (atomicity before the constraint, or writes start failing)
STI-104, STI-107, STI-001      (independent, run in parallel)
STI-105 ──▶ STI-002            (the queue must exist before it can be E2E tested)
```

STI-301 gates 11 units across Phases 3 and 5. It is the single highest-leverage
decision on the board and needs Urban by **working day 2**.
