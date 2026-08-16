# STInventory Release 1 — status and how to resume

**Last updated:** 2026-08-16, end of session.
**Branch:** `release-1/delivery`, cut from `development`.
**Scope:** Phase 1 only (`SYSTEM_PLAN.md` §6.1). Phases 2–5 deferred — see
`README.md` in this directory.

This document is written so you can resume **cold**, without the conversation that
produced it.

---

## Start here tomorrow

```bash
cd /home/subedim/inventory
make ENV=local up          # stack: web :3100, api :4100, postgres
make ENV=local test        # expect 132 passing
```

Then read, in this order:
1. This file — where things stand.
2. `docs/tickets/EXECUTION-PLAN.md` — the wave order and *why* tickets cannot be run
   in parallel.
3. `docs/tickets/README.md` — the board.
4. The next ticket's own file.

To run a ticket end to end: **`/feature-delivery STI-103`**. That skill orchestrates
ticket → branch → implement → adversarial QA → review. It never fires on its own.

---

## Phase 1 — what is delivered

Nine tickets accepted. Each was implemented by one agent and then **independently
verified by a different agent** that re-ran everything against the live stack. Nothing
below is claimed on the strength of a code reading.

### The five core invariants

`SYSTEM_PLAN.md` §3 names five invariants the system exists to guarantee. Four now have
real controls; the fifth was deferred with Phase 2.

| # | Invariant | Before | Now |
|---|---|---|---|
| 1 | One active assignment per asset | Application code only | Asset-row `FOR UPDATE` lock serialises every custody move. **Database index still to come — STI-103.** |
| 2 | Ledger is append-only | A source comment | Postgres trigger raising `0A000` on UPDATE, DELETE **and** TRUNCATE. Cascade deletes blocked. Test-pinned. |
| 3 | Custody writes are atomic | Three unwrapped statements | One transaction per procedure. Passing a raw `db` handle is a **compile error**. |
| 4 | Projection is derivable | Untestable — the fold was a no-op | Folds cleanly. One fold, not two. Divergence sweep every 6h + at boot. |
| 5 | Assignment carries truck and trailer | Fails | **Still fails — deferred with Phase 2.** |

### Feature by feature, in Phase 1's own terms

**The desk queue is reachable.** §6.1's headline task. Six backend procedures existed
with zero UI callers, and the dashboard sent users to `/inbox`, which cannot handle
custody rows. There is now an Approval queue tab at `/custody?tab=queue` listing pending
assignments and transfers together, with working approve and decline. Permission-gated —
verified by calling the procedures directly with a `warehouse` token and getting 403 on
all four, not merely by observing hidden buttons.

**Custody writes are atomic and row-locked.** Every custody-affecting procedure wraps
close + open + projection + ledger in one transaction. `assignment.approve` now closes
the prior link, which it never did — that was how two active rows survived an approve.
QA attacked the invariant with concurrent creates, transfer-vs-assign and
return-vs-transfer races and **could not produce two active assignments**.

**The ledger is immutable at the database.** The plan proposed
`REVOKE UPDATE, DELETE`. That would have enforced nothing: there is no `app_role`, the
app connects as the table owner, and Postgres treats an owner as holding all grant
options. Shipped as a trigger instead, which fires for every role including superuser.

**The ledger can actually be folded.** Every one of the 754 ledger rows had
`to_state = NULL` — the fold returned nothing for every asset in the system, so invariant
4 was not failing, it was *unmeasurable*. Migration `0013` backfilled the history and
STI-108 fixed the seed, so a fresh database now folds to its own projection by
construction. `asset.rebuild` returns `assetsRebuilt: 754` where it used to return 0.

**Reconciliation reports instead of silently repairing.** `asset.rebuild` was listed in
the plan as the reconciliation check but overwrote the projection without reporting —
destroying the signal invariant 4 exists to raise. There is now a separate
`asset.verifyProjection` that compares and writes nothing, plus a 6-hourly sweep raising
a `custody_discrepancy` desk alert. Both call the same `foldAssetState` the tests pin;
the inline reimplementation is gone.

**The seed reaches the rules it gates.** No seeded asset had an `acquisition_cost`, so
the high-value approval path was unreachable from a clean database — it could only be
produced by hand-editing rows in psql. The seed now carries prices at **exactly** the
5000 threshold, one cent below, above, and null, plus a pending assignment and a pending
transfer so the desk queue has content on a fresh reset.

**CI catches schema drift.** The workflow *claimed* to catch drift; it only proved the
committed SQL applied. It now fails on seven distinct drift shapes including renames,
which exit 0 silently and were the hole in the first attempt.

**Error boundaries recover properly.** Both boundaries used Next's `reset`, which only
clears client state, so a server-render failure replayed the same cached error. They use
`retry` now, which re-fetches.

---

## What is NOT delivered — no exceptions

State these to Urban as deferrals, not discoveries.

### Remaining in Phase 1 — five tickets

| Ticket | What it is | Size |
|---|---|---|
| [STI-103](STI-103-one-active-assignment-index.md) | Partial unique index for one-active-assignment | 2 |
| [STI-109](STI-109-double-approve-duplicate-ledger-event.md) | Concurrent double-approve writes a duplicate ledger event | 1 |
| [STI-110](STI-110-unclearable-empty-fold-divergence.md) | A no-evidence divergence can never be cleared | 1 |
| [STI-111](STI-111-remove-dead-verify-remnants.md) | Dead `pending_verification` remnants; a permanently empty card | 1 |
| [STI-112](STI-112-decline-path-defects.md) | Broken decline message; missing ledger event on decline | 1 |
| [STI-114](STI-114-return-bypasses-custody-chokepoint.md) | `assignment.return` still bypasses the custody chokepoint | 1 |

**Invariant 1 has no database constraint yet.** STI-103 is the highest-value remaining
ticket: today `custody.ts` plus the asset-row lock is the only thing preventing duplicate
active assignments.

### Deferred with Phases 2–5

- **Invariant 5 fails.** `assignment` carries a single `locationId`, so a tool cannot
  record both a truck and a trailer — one of the five core invariants, and one of the
  questions the system exists to answer.
- **No user administration of any kind.** Creating a user still means editing
  `seed-data.ts` and reseeding. Three accounts exist.
- **Login is tenant-blind.** Credential lookup is by email with no tenant predicate, and
  `user.email` is not unique. Post-login isolation holds; only the lookup is affected.
  Latent while there is one tenant.
- No four-tier visibility ladder — a superintendent and a foreman are indistinguishable
  to the scoping layer, and the KPI dashboard ignores project scope.
- No Foundation load, no departure reassignment, no permission-driven desk panels.
- **No E2E harness.** Everything above was verified once, by hand. Nothing automated
  will catch it if a later change makes the desk queue unreachable again — which is
  exactly how it became unreachable the first time. `STI-001`/`STI-002` are written and
  ready if you want that protection.

---

## Known-good environment state

After `make ENV=local reset`:

| Check | Expected |
|---|---|
| Ledger rows with complete four-key `to_state` | 754 / 754 |
| `asset.verifyProjection` divergences | 0 |
| Boot sweep | `754 assets checked against 754 events, 0 divergences` |
| Append-only triggers | both `tgenabled = 'O'` |
| Desk queue | 1 pending assignment + 1 pending transfer |
| Tests | 132 passing |

If the boot sweep reports ~754 divergences, the seed has regressed — run
`make ENV=local test`; `seeded-ledger-fold.test.ts` is the gate for exactly that.

---

## Rules that cost time when broken

1. **One implementer at a time.** One database, one Docker stack, one working tree.
   Concurrent agents contaminate each other's evidence — this produced a false defect
   report twice today. `EXECUTION-PLAN.md` explains which tickets collide and why.
2. **Serialise anything that changes DB shape or resets.** Migrations collide on
   numbering; triggers and constraints change behaviour under everyone else's tests.
3. **Full adversarial QA on every ticket, by an agent that did not write the code.**
   Three of eleven implementations failed QA today; every one had evidence from its
   implementer that looked sound. The differentiator was a second agent trying an input
   the first had not.
4. **Docs and seed data are part of the change** — `CLAUDE.md` behaviour rule 8. A stale
   file in `.claude/rules/` loads automatically and misleads every future change; one
   caused a ticket to specify a control for a state deleted months earlier.
5. **Never `git add -A`.** The tree carries root-owned `node_modules/` and `.turbo/` from
   container-run make targets. Stage by name.

---

## Where things live

| | |
|---|---|
| Board and all tickets | `docs/tickets/` |
| Wave order and collision rules | `docs/tickets/EXECUTION-PLAN.md` |
| Pinned versions that differ from public docs | `docs/tickets/STACK-NOTES.md` |
| Delivery workflow | `.claude/skills/feature-delivery/SKILL.md` |
| Workflow tunables and off switch | `.claude/workflow.config.json` |
| Agent definitions | `.claude/agents/` |
| Per-feature archive convention | `docs/features/README.md` |
