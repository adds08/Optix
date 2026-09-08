# A tenant's own tier gains real assign authority, and the BambooHR read-only claim gets a test that would catch a violation

Follow-on to [2026-09-08-the-ladder-stops-being-three-names.md](2026-09-08-the-ladder-stops-being-three-names.md)
and the gap `docs/workings/HIERARCHY_FLEXIBILITY.md` recorded the same day: a Director or
Area In-charge could be drawn on `/my-crew` with `canAssign: false` and no way to ever become
`true`, because `Permission` is fixed code and a settings screen cannot mint a new one. The
client's own description of the flow this was blocking, given directly in this session:
"top down set their crew, and that's setting crew into project" — a superintendent (or a
tenant's own Director tier) should be able to build a crew themselves, and building the crew
already means putting people on the job.

## What changed

### "Set by" (STI-503): a second, additive path to assign authority

`team_role_assigner` (`packages/db/src/schema/reference.ts`, migration `0056`) is a join
table: `teamRoleId` may be filled by `assignerTeamRoleId`, held by the caller **on the same
project**. `teamRole.assignableByEveryone` is the wildcard a join table cannot express on its
own. Edited on `/settings/team-roles`'s new "Set by" column — a Popover checklist, the same
shape `column-menu.tsx`'s filter already uses elsewhere, not a new pattern.

The combination lives in one pure function, `packages/domain/src/team-role-authority.ts`'s
`canAssignIntoTier` — tested with no database (`team-role-authority.test.ts`, 7 cases, one per
path and one per edge). Three ways to be allowed, tried in this order:

1. An admin-shaped permission — `project.team.assign`, or for the built-in three, their own
   `project.assign.pm`/`.superintendent`/`.foreman`. Exactly as before this shipped.
2. The target tier is `assignableByEveryone`.
3. The caller holds one of the target's registered "Set by" tiers, **on that same project.**

`projectTeam.assertCanAssign` (the real gate, all four call sites — `assign`, `remove`,
`setReportsTo`, `confirm`) and the `canAssign` HINT on `/my-crew` and the onboarding crew step
now call the same function, closing the drift the code's own comment on `BUILT_IN_PERM` had
warned about since these three existed. Real-Postgres coverage in
`packages/api-contracts/src/team-role-set-by.test.ts` (7 cases): a grant working, the same
grant refusing on a different project, holding the granted tier on the wrong project not
counting, the wildcard admitting a caller with no tier at all, and — the two that matter most
— the built-in three's existing permission path still succeeding with an EMPTY Set-by list,
and holding the target tier itself granting nothing by default.

**Deliberately additive, not a replacement.** `pm`/`superintendent`/`foreman`'s existing
permission-based path is untouched and still tenant-wide. Only a tenant's own tier — which had
no path at all before this — gains one, and it is a narrower one on purpose: tier-on-that-job,
not a login role held everywhere. Both paths are checked; the first to say yes wins.

### The Team Roles screen: what "Built in" actually meant, corrected

The Source column (`Built in` / `Added by your organization`) was asked about directly this
session and found to be overstating the restriction — the only thing "Built in" ever meant was
"cannot be deleted"; renaming, re-pointing the ladder and (now) Set by are all editable
regardless. The column is gone; the delete button is now always rendered, disabled with the
server's own refusal text as its tooltip for the three that cannot be deleted, rather than
vanishing and reading as unfinished.

### `bg-card` restored on the Team Roles table

Reported directly: "why is this table's content body not white". The `Table` primitive sets
no background of its own; every other table wrapper in the app carries `bg-card` and this
screen's did not, so the page ground showed through the rows. One class.

### The BambooHR read-only claim gets a test

`bamboo-sync.ts`'s header has said since it was written that a test would catch a verb being
added to the sync. It did not exist. `apps/api/src/bamboo-sync.test.ts` is a source scan
(no database, no credentials, always runs): exactly one `fetch` in the file, that call sends
`GET` and nothing else, `bambooGet` takes no method parameter a caller could override, and no
other file in `apps/api` reaches `bamboohr.com`. Verified by deliberately breaking each
assertion (changed the verb, added a method parameter) and confirming it failed, then
restoring the file with `git checkout`.

Also added: `fetchBambooJobTitleOptions`, which asks BambooHR's field metadata for whether
Job Title is a managed list — read-only, going through the same audited `bambooGet`.

### The seating path that did not exist — "Put on a job…" on the People screen

Found by clicking through the product after the roster was cleared, and it is the
reason "Set by" alone did not make the flow work: **no screen could put a person on a
job in a tier the code does not hardcode.** Five paths write a roster row and every one
of them was blocked:

| Path | Tiers it could seat |
|---|---|
| `/jobsites` team strip (`jobsite-team-strip.tsx`) | `pm`, `superintendent` — the member type literally is `"pm" \| "superintendent"` |
| `/jobsites` crew rows (`rig-picker.tsx`) | `foreman`, hardcoded |
| `/people` → Move project (`employee.assignToProject`) | those three, **inferred** from `TEAM_ROLE_FROM_EMPLOYEE`; for any other tier `teamRole` falls to `undefined` and the insert is skipped — **no row, no error** |
| `/my-crew` | any tier, but only on a job the caller is ALREADY on |
| onboarding crew step | same constraint |

So a Director could be created on the Team Roles screen, granted authority by "Set by",
and still never be given to a person on a job. The two flexible paths need you seated
already; the three admin paths know three names. `PutOnJobForm`
(`apps/web/components/put-on-job-form.tsx`, People row menu, gated `project.team.assign`)
is the missing one: a job picker, a tier picker reading the tenant's own register, and
`projectTeam.assign` underneath — so `assertCanAssign` still gates it and a custody-holding
tier still moves its tools through `moveEmployeeToProject`. It adds the ability to SAY
which tier and nothing else.

### The onboarding crew step's picker was unusable, which is why nobody could find it

Reported from a screenshot: the tier label read "Area In-charge · your in-c…" and the
Foreman row's picker was squeezed to the width of "Ad…" with its own submit button pushed
outside the card. Two causes, both layout:

- The label and its relation shared one `w-40 truncate` box. Now stacked, two lines, no
  truncation at any font scale.
- The picker sat inside a `flex-wrap` row with `flex-1`, competing for space with the name
  chips and "Confirm all" — and `flex-1` inside a wrapping parent does not move an item to
  its own line, it makes it fight for the current one. It now has a sibling row of its own,
  so its width no longer depends on how many people are already named.

The submit button also gained words: `Add to <job name>` rather than a bare person-plus
icon. The client's question was "how do I assign crew to project?" while looking directly
at that button.

## What was found while building it

**BambooHR's authority model does not match the target model, and reconciling that was the
real design question.** Grepping `role-perms.ts` before writing anything: `project_manager`
and `engineer` (via `PM_PERMS`) hold `project.assign.superintendent` and `.foreman`
tenant-wide today — a PM can assign a superintendent onto a project they are not rostered on
at all. `office_admin` deliberately does NOT hold `project.assign.superintendent` or
`.foreman` — its own comment says placing a super or foreman "is the job of whoever runs the
work", not an administrative act. Narrowing the built-in three to tier-on-that-job would have
been a real, silent capability change for existing accounts; keeping their path untouched and
adding a second, narrower one for tenant tiers avoided that call entirely.

**The schema already forbids the obvious design.** `teamRole.reportsToTeamRoleId`'s own
comment: "Nothing about ACCESS may read this... a permission decision made out of this column
is exactly the drift the roster comment was written to prevent." `HIERARCHY_FLEXIBILITY.md`
had proposed deriving assign authority from that same column the day before. A separate table
was built instead, for the reason the schema comment already gave.

**The API key cannot see whether Job Title is a managed list — BambooHR's own Add Employee
form settled it instead.** `/meta/lists` returns 403 for this tenant's key (employee read
access, not metadata access). The user captured the real dropdown contents by inspecting
BambooHR's UI directly and pasted them in; saved at `docs/data/bamboohr/lists.json` (131 job
titles, 12 departments, 6 divisions) so the next session does not have to ask BambooHR support
or re-derive it. `fetchBambooJobTitleOptions` is kept anyway — harmless if the key's access
ever widens, and it degrades to "could not check" rather than failing the sync.

**The reachability test caught the mechanism landing with no caller** — `setAssigners` had no
UI the moment it was written, and `reachability.test.ts` refused a green build until the
Popover checklist above gave it one. Working as designed: STI-121 exists precisely so a
backend procedure cannot go unreachable unnoticed.

**"Set by" was necessary and not sufficient, and that was not caught before calling it
done.** The mechanism was built, tested and reported complete while the tiers it exists
for could not be given to anybody. Both halves shipped the same day only because the
client cleared the roster and asked how to assign a crew — which emptied the wizard and
made the gap unmissable. A feature reachable only by a tier nothing can seat is not
reachable, and `reachability.test.ts` cannot see that class of gap: it checks that a
screen calls a procedure, not that a human can get into the state the screen needs.

## Verified

- `pnpm typecheck` — all 13 packages, clean.
- `pnpm test` (`make ENV=local test`) — 362 of 365 passing, and all three failures are
  environmental or pre-existing rather than this change:
  - `onboarding.undefer` bare of a permission check — confirmed present on unmodified
    `development` (`git stash` and re-run). Untouched here.
  - two visibility-ladder cases in `rbac-matrix.test.ts` fail **because the roster was
    deliberately cleared** at the client's request during this session ("unlink all
    project, people relation"). Their own assertion messages say so: *"pm sees nothing —
    the seed can no longer exercise this tier"*. The ladder is proved by a PM seeing
    fewer tools than the desk; with zero roster rows everybody sees none, so there is
    nothing to measure. `make ENV=local seed-demo` restores both — and re-seeds the
    roster, so it undoes the clearing. Exactly the trap `.claude/rules/database.md`
    describes: the fixture's roster IS the apparatus.
  - Before the roster was cleared, the same suite ran 364 of 365.
- `team-role-authority.test.ts` (7) and `team-role-set-by.test.ts` (7, real Postgres) both
  green; `bamboo-sync.test.ts` (4) green.
- The domain function's three paths were each broken in turn (commented out one `if`,
  re-ran the real-Postgres suite, saw the expected two tests fail and no others) and restored,
  to confirm the tests exercise the actual code path rather than passing by construction.
- Migration `0056` reviewed before applying: one `CREATE TABLE`, one `ADD COLUMN`, two `ADD
  CONSTRAINT` — no destructive statement. Applied to the local dev database with
  `make ENV=local migrate`; only NOTICE-level identifier-truncation output, no error.

**Driven end to end in a real browser** (Playwright against the running stack), because
the previous report of this work was "typechecks and tests pass" and that turned out not
to mean it was usable:

1. As `office@`, People → row menu → **Put on a job…** → the tier picker offered all six
   tiers including Director and Area In-charge. Seated Marcus Whitfield as **Area
   In-charge on DART**; confirmed in Postgres (`source: manual_entry`).
2. Signed in as Marcus (`super@`) — **landed on `/welcome` automatically**, because being
   on a job is what `shouldPrompt` waits for. The gate had nothing to fire on before.
3. Crew step, before any grant: every tier read "Not yours to name." Correct — Area
   In-charge holds no `project.assign.*` and "Set by" ships empty.
4. Granted Area In-charge over PM / General Superintendent / Superintendent. **The three
   flipped to real pickers**; Director stayed refused with the defer control, which is
   right — nobody appoints their own boss.
5. Picked ZELVIN PEREZ, pressed **Add to DART** → roster row written with
   `source: onboarding`; confirmed in Postgres.
6. Layout measured on that page rather than eyeballed: no truncated text nodes anywhere,
   every picker a full 317px, worst-case child sitting 13px INSIDE its card, and no
   horizontal scroll on the document.

**The API container had to be restarted** for the router change to take effect
(`docker compose restart api`) — the dev process did not pick up the edited
`packages/api-contracts` on its own, and the first pass through step 4 above showed the
old behaviour because of it. Worth knowing before concluding a permission change "did not
work".

**Not verified:** the same flow on mobile widths, and `/my-crew`'s copy of these controls
(the hint computation is shared and tested, the screen was not clicked through).

## The order it actually happened in, and what went wrong at each step

Recorded because the sequence is the argument: nearly every step was corrected by the
step after it, and a reader who sees only the final diff will not know which parts were
load-bearing.

1. **Blast radius first, per `minimal-change`.** Grepping `BUILT_IN_PERM` and
   `assertCanAssign` found four enforcement sites, two UI hint computations, three client
   screens and a security test that names the gate per procedure. Cheap, and it is what
   surfaced step 2.
2. **The obvious design was already forbidden.** The plan of record
   (`HIERARCHY_FLEXIBILITY.md`) proposed deriving authority from `reportsToTeamRoleId`.
   That column's own schema comment says *"nothing about ACCESS may read this"*. Two
   documents in the same repo disagreeing, on a permission boundary — surfaced to the
   client rather than picked quietly, and the separate-table design came out of that.
3. **The narrowing nearly shipped unnoticed.** Reading `role-perms.ts` showed the built-in
   three's authority is a LOGIN-role permission held tenant-wide: a `project_manager`
   account can assign a superintendent onto a job it is not on. Making everything
   tier-on-that-job would have silently reduced existing accounts. Hence two paths side by
   side rather than a replacement — and `office_admin` deliberately *not* holding
   `project.assign.superintendent` (its own comment: placing supers "is the job of whoever
   runs the work") is what proved the distinction was intentional and not an oversight.
4. **First implementation was wrong in a way TypeScript caught.** `canAssignTier` was
   defined above the `.map` while closing over `mine.role`, a variable declared inside it.
   Moved inside the loop; the comment there now says why the tempting shape is wrong.
5. **`confirm`'s fallback row had no `id`.** It synthesises a `TeamRoleRow` when the tier
   named on an old roster row has since been deleted, via `as TeamRoleRow` past three
   missing fields — which would have passed `undefined` into the assigner lookup. Given an
   explicit empty `id` and a guard, which is also the honest answer (cascade delete removes
   those rows anyway).
6. **The reachability test refused the build.** `setAssigners` had no caller the moment it
   was written. Working as designed — STI-121 exists so a procedure cannot go unreachable
   unnoticed — and it forced the Team Roles column to be built rather than deferred.
7. **Tests passed before they were trustworthy.** All seven went green first try, which is
   not evidence. Each of the three authority paths was then disabled in turn: exactly the
   two cases depending on paths 2 and 3 failed, and the admin-permission regression case
   stayed green, which is the result that proves the suite measures the right thing.
   Two fixture faults surfaced here too — a non-UUID actor id, then a real FK into
   `tbl_entity_user` needing an actual row.
8. **Then it was reported done, and it was not usable.** Clicking through the product
   after the client cleared the roster showed no screen could seat a Director at all. The
   seating path and the crew-step layout fixes above came out of that, and the browser
   run in "Verified" is the standard this work should have been held to first time.
9. **The API container had to be restarted** before step 8's grants took effect. The first
   pass showed old behaviour and was nearly read as the feature not working.

## Deliberately not done

- **No backfill of "Set by" rows for real tenant tiers.** The mechanism ships empty
  (admins-only, same as before) for any tier a tenant has already added; populating Director →
  Area In-charge and similar for Urban's real ladder is a data decision for whoever is at the
  keyboard on `/settings/team-roles`, not something to guess into a migration.
- **`onboarding.undefer`'s missing permission check** — pre-existing, confirmed unrelated,
  left for its own change.
- **The stale-skill cleanup started earlier this session** (`feature-delivery`,
  `optix-map-evaluate` removed; `.claude/workflow.config.json` and `docs/features/` still
  present; `docs/tickets/STATUS.md` and `optix-map-update` still naming the deleted skill) is
  a separate, still-open body of work and is not this entry's subject.

## Where it is

Uncommitted in the working tree as of 2026-09-09, on `development`. Migration `0056` has been
applied to the local dev database only.
