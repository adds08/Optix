# Decision: the Foundation interface, and whether `phase` returns

**Phase:** 4 — Foundation entity load
**Size:** 0 units (decision record)
**Status:** BLOCKED on Urban
**Unblocks:** STI-402, STI-403, STI-404 — **5 units**

---

## Why this exists

`SYSTEM_PLAN.md` §8.2: *"What interface does Foundation expose? Urban / Foundation
Software. Determines whether ongoing sync is days or weeks."*

Phase 4 is a **one-time load** of users, jobs, cost codes and phases, but §6.4 is
explicit that the mechanism must be built so later loads, hand-entered records and
future automated sync all share the same identity rules. That means the interface
answer shapes the design even for the one-time load.

## Verified starting position — Phase 4 is essentially unbuilt

Checked 2026-08-16:

- **No `external_ref`, `source` or `last_synced_at` columns anywhere.** Repo-wide grep
  over `packages/db/src/` returns zero hits for each.
- What exists instead: a plain nullable `external_id` text column on `employee`
  (`packages/db/src/schema/employee.ts:13`) and `project`
  (`packages/db/src/schema/project.ts:9`). **Not unique**, and with no system or type
  qualifier — so it cannot express `external_ref(foundation, type, native_id)`.
- **No `cost_code` table.** Cost codes are currently conflated with
  `project.externalId` — see `apps/web/app/(app)/projects/page.tsx:22`: *"externalId
  is the cost code FoundationSoft knows a project by"*.
- **No Foundation code at all.** `grep -rni foundation` finds only docs and three
  comments.

## The conflict Urban must resolve

`SYSTEM_PLAN.md` §6.4 says Phase 4 loads *"users, jobs, cost codes and **phases**"*.

But `packages/db/src/schema/project.ts:24-38` records that `project_phase` existed,
was migrated everywhere, **never held a row, and was deliberately dropped** — with
the reasoning: *"Dropped rather than kept as a seam: an empty table is not a head
start, it is a guess that looks like a decision."*

So the plan asks Phase 4 to load into a table the schema deliberately removed. One of
the two is wrong. Per `CLAUDE.md` the code wins by default — but this is a scope
question about what Urban actually needs, not a documentation drift, so it needs an
answer rather than a default.

## Questions to settle

1. **Does Foundation expose a nightly CSV drop, or a live API?** Days versus weeks.
2. **Do phases come back?** If yes, `project_phase` is reinstated and §6.4's estimate
   holds. If no, `SYSTEM_PLAN.md` §6.4 is corrected in the same change.
3. **Are cost codes their own entity**, or is `project.externalId` genuinely the cost
   code? The current UI comment asserts the latter; §6.4 assumes the former.
4. **Which fields does Foundation own?** §6.4 requires Foundation-owned fields to be
   read-only in the UI once an `external_ref` exists — that list has to be explicit.

## Acceptance criteria

1. Each of the four questions above has a recorded answer.
2. `SYSTEM_PLAN.md` §6.4 is corrected wherever it disagrees with the outcome.
3. STI-402 is unblocked with a concrete entity list.
