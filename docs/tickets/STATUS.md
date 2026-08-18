# STInventory Release 1 — status and how to resume

**Last updated:** 2026-08-18.
**Branch:** `release-1/delivery`, cut from `development`. Draft PR #1 is open against
`development`.
**Scope:** Phase 1 only (`SYSTEM_PLAN.md` §6.1). Phases 2–5 deferred — see `README.md`
in this directory.

> ## Phase 1 is complete. All 15 tickets accepted, each verified by an agent that did not write it.
>
> Nothing in Phase 1 is outstanding. What remains below is either **deferred scope**
> (Phases 2–5), **three follow-up tickets opened from defects found during the work**, or
> **one product question for Urban**. All three categories are stated explicitly — no
> exceptions.

This document is written so you can resume **cold**, without the conversation that
produced it.

---

## Start here

```bash
cd /home/subedim/inventory
make ENV=local up          # stack: web :3100, api :4100, postgres
make ENV=local test        # expect 144 passing
```

Then read, in this order:
1. This file — where things stand.
2. `docs/tickets/README.md` — the board.
3. `docs/tickets/EXECUTION-PLAN.md` — wave order and *why* tickets collide.

To run a ticket end to end: **`/feature-delivery STI-115`**. That skill orchestrates
ticket → branch → implement → adversarial QA → review. It never fires on its own.

---

## Phase 1 — what is delivered

### The five core invariants

`SYSTEM_PLAN.md` §3 names five invariants the system exists to guarantee. Four now have
real controls; the fifth is deferred with Phase 2.

| # | Invariant | Before | Now |
|---|---|---|---|
| 1 | One active assignment per asset | Application code only | **Partial unique index `assignment_one_active_uq`** (migration `0015`) plus the asset-row `FOR UPDATE` lock. Proven under genuinely concurrent sessions. |
| 2 | Ledger is append-only | A source comment | Postgres trigger raising `0A000` on UPDATE, DELETE **and** TRUNCATE. Cascade deletes blocked. Test-pinned. |
| 3 | Custody writes are atomic | Three unwrapped statements | One transaction per procedure, anchored on the asset row. Passing a raw `db` handle is a **compile error**. |
| 4 | Projection is derivable | Untestable — the fold was a no-op | Folds cleanly. One fold, not two. Divergence sweep every 6h + at boot, reporting **two distinct kinds**. |
| 5 | Assignment carries truck and trailer | Fails | **Still fails — deferred with Phase 2.** |

### Feature by feature, in Phase 1's own terms

**The desk queue is reachable.** §6.1's headline task. Six backend procedures had zero UI
callers. There is now an Approval queue at `/custody?tab=queue` with working approve and
decline, permission-gated — verified by calling the procedures with a `warehouse` token
and getting 403, not merely by observing hidden buttons.

**One active assignment per tool is now a database guarantee.** The index rejects a second
active row; a `returned` row alongside an active one is still allowed, and two
`pending_approval` rows are still allowed (see the open product question below). QA proved
it serialises genuinely simultaneous writers: a second session blocked 3.1s on the first's
uncommitted row, then failed with the named constraint the moment it committed.

**Every custody writer now goes through the chokepoint.** `assignment.return` was the last
exception — it closed by id, with no status guard, no lock, and an asset read outside its
transaction. It routes through `closeActiveCustody` now, so `CLAUDE.md`'s non-negotiable 2
is finally true in fact rather than in intent.

**Concurrent approvals can no longer pollute the ledger.** The status guard ran *before*
the transaction took its lock, so two simultaneous approvals both passed it and both wrote
an event — permanent noise in an append-only log. All five decision procedures now
re-check status **under the asset-row lock**; the loser gets a `CONFLICT` naming the actual
status. Verified by racing real calls and counting rows.

**The ledger is immutable at the database.** The plan proposed `REVOKE UPDATE, DELETE`.
That would have enforced nothing: there is no `app_role`, the app connects as the table
owner, and Postgres treats an owner as holding all grant options. Shipped as a trigger,
which fires for every role including superuser.

**The ledger can actually be folded.** All 754 rows had `to_state = NULL` — invariant 4 was
not failing, it was *unmeasurable*. Migration `0013` backfilled history and STI-108 fixed
the seed, so a fresh database folds to its own projection by construction.

**Reconciliation reports instead of silently repairing**, and now distinguishes **"the
projection disagrees with the ledger"** (repairable — `rebuild` fixes it) from **"the
ledger has no evidence at all"** (not repairable — repairing would blank a live custodian
on zero evidence). Both use the *same* predicate, so what repair refuses to touch is
exactly what the report calls unrepairable. The alert names the kind and the action.

**Declines are recorded in the ledger.** `assignment.decline` wrote only an audit-log entry
while `transfer.decline` wrote a real event — the same job recorded two different ways. Both
now write a `status_change` with a complete four-key snapshot where `fromState = toState`,
because a desk asked to prove why a tool did *not* move needs something to show. And the
user-facing conflict message no longer renders as `This assignment is already .`

**The seed reaches the rules it gates.** No seeded asset had an `acquisition_cost`, so the
high-value approval path was unreachable from a clean database. The seed now carries prices
at **exactly** the threshold, one cent below, above, and null.

**CI catches schema drift** across seven drift shapes including renames, which exit 0
silently and were the hole in the first attempt.

**Dead `pending_verification` remnants are swept.** The `verify` outcome was removed from
the backend on 2026-08-09 but left a permanently empty "Loans to verify" card in the
product. The status stays in the enum, marked historical-only, so pre-removal rows still
render.

---

## What is NOT delivered — no exceptions

State these to Urban as deferrals, not discoveries.

### One product question that needs Urban, not engineering

**Two pending approvals for the same tool are both approvable.** The index covers *active*
rows only, so two proposals can sit in the queue for one tool. Approving both is safe —
custody stays correct, exactly one active link survives, one ledger event per approval, no
divergence — and the second approval simply supersedes the first as a reassignment.

Whether the desk *should* be able to approve a proposal for a tool that has since been
assigned elsewhere is a policy question about how Urban's desk works. It is not a defect,
and it is not guessed at in code.

### Three tickets opened from defects found during Phase 1

Found by implementers and QA who were instructed to report adjacent problems rather than
fix them. None is Phase 1 scope; none blocks anything delivered above.

| Ticket | What | Why it matters |
|---|---|---|
| [STI-115](STI-115-asset-create-not-transactional.md) | `asset.create` is not transactional | A failure between its two writes leaves an asset with a projection and no ledger — the no-evidence state, from a legitimate path |
| [STI-116](STI-116-rest-asset-create-mass-assign.md) | `/api/*` writes assets and custody outside every control | `POST /api/assets` mass-assigns the request body onto `current_*` columns; `POST /api/assignment/:id/approve` sets `status='active'` with no chokepoint, no ledger event, no permission check |
| [STI-117](STI-117-stale-reads-and-chat-approve-race.md) | Three reads that escaped the lock discipline | Incl. a query with no tenant predicate, and the chat approve surface carrying the same duplicate-event race STI-109 fixed |

**STI-116 is the one to look at first.** QA reached the no-evidence state with a single
authenticated HTTP call. The surface is already sentenced to deletion in
`.claude/rules/api-server.md`; the right fix is almost certainly to delete it.

### Deferred with Phases 2–5

- **Invariant 5 fails.** `assignment` carries a single `locationId`, so a tool cannot record
  both a truck and a trailer — one of the five core invariants, and one of the questions the
  system exists to answer.
- **No user administration of any kind.** Creating a user means editing `seed-data.ts` and
  reseeding. Three accounts exist.
- **Login is tenant-blind.** Credential lookup is by email with no tenant predicate, and
  `user.email` is not unique. Post-login isolation holds; only the lookup is affected.
  Latent while there is one tenant.
- No four-tier visibility ladder — a superintendent and a foreman are indistinguishable to
  the scoping layer, and the KPI dashboard ignores project scope.
- No Foundation load, no departure reassignment, no permission-driven desk panels.
- **No E2E harness.** Everything above was verified by agents driving the real stack, but
  nothing automated will catch it if a later change makes the desk queue unreachable again —
  which is exactly how it became unreachable the first time. `STI-001`/`STI-002` are written
  and ready if you want that protection.

### One thing a human must do before production

**The production duplicate check for STI-103 has not been run.** No agent has production
access and none sought it. Before migration `0015` is applied to production, run:

```sql
select asset_id, count(*) from assignment where status='active' group by 1 having count(*)>1;
```

Local returned zero rows on 2026-08-16 and again on 2026-08-18. **If production returns
rows, stop** — per the ticket, that is a per-tool conversation with the Equipment
department, not a script that picks a survivor.

---

## Known-good environment state

After `make ENV=local reset`:

| Check | Expected |
|---|---|
| Assets / ledger rows / rows with complete four-key `to_state` | 754 / 754 / 754 |
| `asset.verifyProjection` divergences | 0 |
| Boot sweep | `754 assets checked against 754 events, 0 divergences` |
| Append-only triggers | both `tgenabled = 'O'` |
| `assignment_one_active_uq` | present |
| Desk queue | 1 pending assignment + 1 pending transfer |
| Tests | 144 passing |
| Typecheck | 12/12 |

If the boot sweep reports ~754 divergences, the seed has regressed — run
`make ENV=local test`; `seeded-ledger-fold.test.ts` is the gate for exactly that.

---

## Rules that cost time when broken

1. **Parallel implementers need disjoint file ownership, and must not touch the database.**
   Four ran concurrently on 2026-08-18 with named file ownership and a ban on
   `reset`/`seed`/`migrate`/`test`; nothing collided. Earlier, agents sharing the database
   produced two false defect reports. Reads parallelise, writes do not.
2. **Serialise anything that changes DB shape.** Migrations collide on numbering; triggers
   and constraints change behaviour under everyone else's tests.
3. **Full adversarial QA on every ticket, by an agent that did not write the code.** Two of
   six implementations failed QA on 2026-08-18, both on incomplete doc sweeps rather than
   broken code — and both would have shipped a document that actively lied. The
   differentiator every time is a second agent trying an input the first did not.
4. **Docs and seed data are part of the change** — `CLAUDE.md` behaviour rule 8. A stale file
   in `.claude/rules/` loads automatically and misleads every future change.
5. **Never `git add -A`.** The tree carries root-owned `node_modules/` and `.turbo/` from
   container-run make targets. Stage by name — and remember new migrations arrive as
   *untracked* files.

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

> **Note, 2026-08-18:** `minimal-change`, `systematic-debugging` and `visual-explainer` were
> moved from `.claude/` to `.claude/skills/`. They had never been in a location the `Skill`
> tool could load, so every agent instructed to invoke them silently failed and fell back to
> applying the discipline from memory. If a skill stops resolving, check the path first.
