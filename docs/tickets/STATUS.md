# STInventory Release 1 — status and how to resume

**Last updated:** 2026-08-22.
**Scope:** **Phases 1, 2, 3 and 5 are complete. Phase 4 (Foundation import) is not started
and is blocked on Urban**, who owns the interface question — that is the only phase left.

> ## Where this actually stands, 2026-08-22
>
> | Phase | State |
> |---|---|
> | 1 — Custody trail | Complete. All five invariants enforced |
> | 2 — Truck & trailer | Complete |
> | 3 — Roles, accounts, visibility | **Complete.** One login per role, the four-tier ladder applied to the query on every read path, no role-name branching in server code, RBAC matrix test |
> | 4 — Foundation load | **Not started. Blocked on Urban** (STI-401) |
> | 5 — Desk views by role | **Complete**, four panels of five — the fifth specifies a deleted concept, see below |
>
> **A warning about this directory.** Most `STI-1xx`/`STI-2xx` ticket files still say
> `Status: READY` while the work shipped weeks ago. The Status lines were not maintained;
> the code is the truth. Verify against code before believing either a ticket or this file
> — that is CLAUDE.md behaviour rule 3 and this board is not exempt from it.

### The permission matrix stopped being a blocker

Every previous version of this file, and of `SYSTEM_PLAN.md` §8.2, ended with the same
warning: six defaults are in code that Urban has never seen, and after release each becomes
a migration rather than an edit.

**That is no longer true.** `/admin/roles` lets an administrator tick permissions on and off
per role — in plain English, not dotted identifiers — and create roles of their own. Urban
changes what they disagree with, with no developer and no deploy.

What it cost is worth knowing before touching the RBAC tests: `packages/db/src/role-perms.ts`
used to **be** the matrix, and STI-308 asserted the database matched it exactly in both
directions. That cannot hold once grants are editable — the moment somebody unticks a box
the database is *supposed* to differ. `role-perms.ts` is now the **factory default**, the
test asserts a freshly seeded tenant matches it, and the live database is guarded by the
audit trail instead: `role.setPermissions` logs the delta.

The screen deliberately does **not** offer inventing permissions. A permission is only real
because a procedure names it, so one typed into a screen would gate nothing.

### An adversarial audit ran over this work, and found three things

Four read-only agents audited SYSTEM_PLAN §1–§9 and every STI-1xx/2xx ticket against the
code rather than against the Status lines. Worth recording what they caught, because two
were **overclaims in work that had just been marked done**:

1. **STI-119 was claimed done and was not.** The sweep scanned only
   `packages/api-contracts` and reported clean while four writes in `apps/api` — the photo
   upload and delete routes, the messaging worker's project lookup, the entity resolver's
   asset lookup — were untouched. *A sweep that cannot see half the writes is worse than no
   sweep, because it produces a green tick.* The test now scans both roots.
2. **STI-120 was the most severe open item and had not been looked at.** Fixed — see below.
3. Several §1/§5 claims were false rather than merely stale: "No mobile application" (there
   is one), "Vendors read-only" (there is no vendor table at all), "No error boundaries"
   (there are two). All corrected in place.

### What Phase 3 + 5 added, and the defects they exposed

- **A production data migration that had to exist.** `0020` grants the new permissions and
  roles to an EXISTING database. Without it, deploying Phase 3 shows every user in the
  company an empty register — verified by simulating Urban's live database and watching the
  yard desk see 0 of 754 tools.
- **`report.assetRegister` and `dashboard.charts` were gated on `report.read`**, so HR — who
  deliberately lacks `asset.read` — could read the whole register and the fleet's capital
  value. Found by probing all thirteen roles against the running API.
- **`notification.markRead` cleared anyone's alert by id.** Found by the router walk.
- **`messaging.dismiss` let any account empty the desk's queue.** Same walk.
- **Nothing can go overdue** — the borrow model went on 2026-08-09 — yet SYSTEM_PLAN §6.5
  still asked for an overdue panel and four other documents still described it as live.
- **A chat retry appended permanent duplicate ledger events** (STI-120). `applyChatAction`
  writes one asset per transaction, so a multi-asset action failing partway left some
  applied; the caller un-claimed the message and the Confirm button worked again, and
  pressing it re-applied the ones that had landed. **No crash required.** The ledger is
  append-only, so the duplicates could not be removed, and the fold is last-snapshot-wins so
  the projection still looked right — the history was wrong and nothing reported it. Fixed
  by migration `0021`: the ledger now records the message that CAUSED an event separately
  from the row it is about.

> ## Phases 1 and 2 are complete. All five core invariants are enforced.
>
> Invariant 5 — "every assignment carries job, truck and trailer, independently recordable"
> — was the last one failing. It is delivered: the columns exist, every custody writer fills
> them, the ledger records them, and the screens show them.
>
> Every ticket was verified by an agent that did not write it. **Four failed QA and were
> reworked**; two of those failures were caused by instructions I got wrong.
>
> What remains is stated explicitly below — no exceptions: **six follow-up tickets** opened
> from questions this work raised, **one product question for Urban**, and **one query a
> human must run before production**.

This document is written so you can resume **cold**, without the conversation that
produced it.

---

## Start here

```bash
cd /home/subedim/inventory
make ENV=local up          # stack: web :3100, api :4100, postgres
make ENV=local test        # expect 267 passing
```

Then read, in this order:
1. This file — where things stand.
2. `docs/tickets/README.md` — the board.
3. `docs/tickets/EXECUTION-PLAN.md` — wave order and *why* tickets collide.

To run a ticket end to end: **`/feature-delivery STI-207`**. That skill orchestrates
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
| 5 | Assignment carries truck and trailer | Fails | **Delivered (STI-202 + STI-203).** Composite FK enforces vehicle type at the database; every custody writer fills both keys; held transfers keep the pick through approval (`0017`); jobsites and tool detail show it. |

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

**STI-115, STI-116 and STI-117 are all now DONE.** The three below replaced them, found by
the greps and probes those tickets required.

| Ticket | What | Why it matters |
|---|---|---|
| [STI-118](STI-118-intake-and-setstatus-not-atomic.md) | `applyIntake` and `asset.setStatus` split a projection from its ledger event | `applyIntake` is the **chat** path, so this is the remaining route to a no-evidence asset a user can actually reach |
| [STI-119](STI-119-untenanted-predicate-sweep.md) | Queries without a tenant predicate | None exploitable today; the value is a rule with no exceptions to reason about. Includes one **legitimate** exception (login) that needs documenting, not fixing |
| [STI-120](STI-120-confirm-claim-crash-recovery.md) | Chat sign-off can duplicate events and strand requests | **A partial multi-asset apply re-applies the successful part on retry — no crash needed.** Also: a stranded task has no sweeper at all |

**STI-120 is the one to look at first**, and it grew during the work: it was opened as a
narrow crash-window ticket and QA then showed a duplicate-write reachable by an ordinary
retry, with no crash involved. Re-size it before starting.

### Phase 2 follow-ups — ALL THREE NOW CLOSED (2026-08-19)

| Ticket | Outcome |
|---|---|
| [STI-206](STI-206-approval-queue-hides-the-rig.md) | **DONE.** The queue shows the rig. Nothing recorded renders as an empty cell, never a dash — after the three-state rule an absent vehicle is an absence, not a claim of "no truck" |
| [STI-207](STI-207-container-membership-is-still-location-based.md) | **DONE.** The active assignment is the truth for a vehicle, by **precedence** not union: a tool with no active assignment is aboard by its location row, because an unheld tool has no `trailerId` to be aboard of |
| [STI-208](STI-208-hitching-a-trailer-could-assert-the-new-truck.md) | **CLOSED — the answer was "no."** Hitching keeps carrying the recorded truck forward. Reasoning recorded at the call site and in the rules, so it is not re-raised |

**Two defects in STI-207's first cut were caught by adversarial review before they shipped**,
and both are now pinned by tests confirmed to fail when the fix is reverted:

- The writer stamped the **container's location** onto the link and the ledger snapshot while
  `applyContainerCustody` never updates `currentLocationId`. Harmless only while the contents
  query *was* `currentLocationId = locationId`; selecting by assignment removed that identity,
  so every moved tool would have diverged — a `stale_projection` raised every six hours
  forever, and an `asset.rebuild` that silently relocates the tool.
- Selecting **purely** by active assignment made the return leg a trapdoor: handing a
  container back closes every link and reopens none, so the manifest emptied permanently and
  the next hand-over moved zero tools while nineteen sat in the trailer.

### ~~Deferred with Phases 3–5~~ — all delivered 2026-08-22

Everything in this section was true when written and is not any more. Kept struck through
rather than deleted, because the *before* is what makes the change legible.

- ~~**No user administration of any kind.** Creating a user means editing `seed-data.ts` and
  reseeding. Three accounts exist.~~ **Fourteen accounts, one per role**, created through
  `/admin/users`.
- ~~**Login is tenant-blind.**~~ STI-305: `user_tenant_email_uq` (`0018`) plus a `login()`
  that **refuses** an ambiguous address rather than picking a row.
- ~~No four-tier visibility ladder — a superintendent and a foreman are indistinguishable to
  the scoping layer, and the KPI dashboard ignores project scope.~~ STI-302: the ladder is
  applied to the QUERY on every read path, dashboard aggregates included — those were the
  widest leak, because a total over rows you may not read is a read of those rows.
- ~~No Foundation load, no departure reassignment, no permission-driven desk panels.~~
  Departure reassignment shipped (STI-306); the Desk is at `/desk`, composed from the panel
  registry by permission (STI-501/502). **Foundation load remains — it is Phase 4 and is
  blocked on Urban**, who owns the interface question.
- **No E2E harness — still true, and now the largest single gap.** Everything above was
  verified by agents driving the real stack and by a per-role sweep against the running API,
  but nothing automated will catch it if a later change makes the desk queue unreachable
  again — which is exactly how it became unreachable the first time. `STI-001`/`STI-002` are
  written and ready.

### Reachability: a set of procedures still have no UI caller

`SYSTEM_PLAN.md` §9 makes "reachable through the UI by a user with the right permission"
the acceptance standard. A sweep of `appRouter` against both clients on 2026-08-22 found
22 procedures nothing calls. **Recompute it rather than trusting this number** — map
`appRouter`'s keys to each router's procedure names and grep `apps/web` + `apps/mobile` for
`.<key>.<proc>`; the count moves whenever a screen is added. Two were dealt with:

- `messaging.pendingVerification` — **deleted.** It was the removed `verify` queue: dead
  code with a live permission, the same class STI-111 swept.
- `user.changePassword` — **now reachable** at `/account/password`. STI-303 set
  `must_change_password` on every created and reset account and nothing read it, so users
  were told to change a password they had no way to change. The shell now redirects them.

The rest are mostly operations and integration procedures — `asset.rebuild`,
`asset.verifyProjection`, `vehicle.updateGps`, `location.updateGps`, the `task.*` CRUD,
`category.rename`/`delete`/`adoptInUse`, `department.create`/`update`, `asset.delete`,
`vehicle.delete`, `assignment.return`, `projectTeam.remove`, `notification.all`,
`messaging.feed`.

**None has been confirmed as legitimately UI-less.** Several look like real product holes
rather than ops tools — `assignment.return` and `projectTeam.remove` in particular are
ordinary desk actions with no button. That is a ticket somebody should open, not a
conclusion this note is entitled to draw, and it is the single biggest piece of §9 still
outstanding.

### One thing a human must do before production

**The production duplicate check for STI-103 has not been run.** No agent has production
access and none sought it. Before migration `0015` is applied to production, run:

```bash
make prod-shell
./scripts/sti-103-production-preflight.sh
```

That script is the check. It is read-only, safe to re-run, and exits **0** when the
database is clean, **1** with the offending tools and every custodian claimed for each, and
**2** if it could not reach the database (which is *not* a pass). Both paths were tested by
fabricating a real duplicate locally and restoring afterwards.

Local returned zero duplicates on 2026-08-16 and again on 2026-08-18. **If production
returns rows, stop** — that is a per-tool conversation with the Equipment department, not a
script that picks a survivor.

---

## Known-good environment state

After `make ENV=local reset`:

| Check | Expected |
|---|---|
| Assets / ledger rows / rows with complete four-key `to_state` | 756 / 754 / 754 |
| `asset.verifyProjection` divergences | **2 — see the open defect below** |
| Boot sweep | `2 divergent asset(s)`, both `kind: "no_evidence"` |
| Append-only triggers | both `tgenabled = 'O'` |
| `assignment_one_active_uq` | present |
| `vehicle_one_truck_per_foreman_uq` | present (migration `0022`, STI-502) |
| Project statuses reachable | all four — Richardson `closing`, Mesquite `complete`, City of Kemp `awarded` |
| Categories | 8 seeded; 414 of 756 tools filed, 342 unfiled |
| Desk queue | 1 pending assignment (carries the personal-allowance truck) + 1 pending transfer (trailer only) |
| Tests | 390 passing (228 in `api-contracts`) |
| Typecheck | 12/12 |

If the boot sweep reports ~754 divergences, the seed has regressed — run
`make ENV=local test`; `seeded-ledger-fold.test.ts` is the gate for exactly that.

> ### ⚠️ Open defect: two seeded assets have NO ledger evidence
>
> **This is a regression on `main`, found 2026-08-23 and NOT fixed here.** The boot
> sweep and the 6-hourly reconciliation both report 2 divergent assets, kind
> `no_evidence` — the unrepairable class, which `asset.rebuild` deliberately refuses to
> touch because blanking a live row on zero evidence would *be* the corruption.
>
> Cause: commit `b3c0526` (UI-68/69) added two untagged tools to `assetSpecs` —
> `1/2" IMPACT WRENCH (UNLABELLED)` and `4-1/2" ANGLE GRINDER (UNLABELLED)` — so the
> "Needs a Tag" report would have rows. They were added **without the opening `tag`
> ledger event every other creation path writes**, so 756 assets fold from 754 events.
>
> It is left alone deliberately: it is a different ticket's concern from the six this
> branch delivers, and folding it in would put an unrelated seed change in the same
> review. The fix is small — give those two rows the same baseline event the other 754
> get in `seed.ts` — but it wants its own ticket, because the interesting question is
> *how a seeded asset got created without one* and whether anything else can.
>
> Until then the ERROR on every boot is expected, and "0 divergences" is no longer the
> health signal. **2, both `no_evidence`, is.** Anything else is new.

---

## Rules that cost time when broken

1. **Parallel implementers need disjoint file ownership, and must not touch the database.**
   Four ran concurrently on 2026-08-18 with named file ownership and a ban on
   `reset`/`seed`/`migrate`/`test`; nothing collided. Earlier, agents sharing the database
   produced two false defect reports. Reads parallelise, writes do not.
2. **Serialise anything that changes DB shape — I broke this rule and it cost a round.**
   Running a schema ticket in parallel with another implementer put a `truckId` column in
   the tree with its migration unapplied, so every assignment write failed and the running
   API was broken until I applied `0016`. The other agent stopped and escalated rather than
   working around it, which was correct. Migrations collide on numbering; constraints change
   behaviour under everyone else's tests.
3. **Full adversarial QA on every ticket, by an agent that did not write the code.** Four of
   ten implementations failed QA on 2026-08-18. Two were incomplete doc sweeps that would
   have shipped a document actively lying; one had wedged the connection pool under
   concurrency while passing its own tests; one had fixed a function the user never touches.
   The differentiator every time is a second agent trying an input the first did not.
   **Ask implementers directly whether a branch is tested.** Asked plainly, one said "no"
   and added the tests — that honesty is worth more than any report that claims coverage.
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
| Production preflight for migration 0015 | `scripts/sti-103-production-preflight.sh` |
| Workflow tunables and off switch | `.claude/workflow.config.json` |
| Agent definitions | `.claude/agents/` |
| Per-feature archive convention | `docs/features/README.md` |

> **Note, 2026-08-18:** `minimal-change`, `systematic-debugging` and `visual-explainer` were
> moved from `.claude/` to `.claude/skills/`. They had never been in a location the `Skill`
> tool could load, so every agent instructed to invoke them silently failed and fell back to
> applying the discipline from memory. If a skill stops resolving, check the path first.
