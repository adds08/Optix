# A tier can be set by everyone above it

A Director opened **Add a person** on a job she runs and found two tiers on
offer — Area In-charge and General Superintendent. Foreman was simply not there,
with no explanation, which reads as a broken dropdown. It was a rule, and the
rule was too narrow.

## The rule, and what was wrong with it

`team_role_assigner` — the "Set by" column on Settings → Job Tiers — names the
tiers that may fill a slot. Foreman's list is Superintendent, PM and General
Superintendent. A Director is not on it, so the tier was withheld from the one
person every tier between her and it answers to.

Authority did not flow DOWN the chain. "Set by" says who is immediately
competent to fill a slot; it has never said anything about the ladder.

## What changed

### A fourth path in `canAssignIntoTier`

The pure gate (`packages/domain/src/team-role-authority.ts`) was a three-way OR
whose header predicted "a future fourth path… a one-line addition rather than a
re-read of the whole thing". This is that path: the caller holds a tier ABOVE the
target on `team_role.reportsToTeamRoleId`, on the same project.

It stays last, so the three cheaper checks short-circuit first, and the input is
optional — an absent ancestor set behaves exactly as before, which is what let
the four call sites be wired one at a time without a flag day.

### A UNION with "Set by", never a replacement

This is the part worth keeping. Ancestry alone would have been WORSE than what
was there:

- **Nothing reports to General Superintendent** on Urban's ladder, so it is
  nobody's ancestor. Under ancestry alone a GSuper could have set nothing at
  all, losing the PM/Superintendent/Foreman authority "Set by" gives them.
- Foreman's ancestors are Superintendent → Area In-charge → Director, which omits
  PM and General Superintendent — both of whom legitimately staff foremen.

Each edge answers a question the other cannot, so the gate asks both. The result
on Urban's live register:

| Tier | May set it |
|---|---|
| Area In-charge | Director |
| General Superintendent | Director, Area In-charge |
| Project Manager / Superintendent | Director, Area In-charge, GSuper |
| Foreman, Field Eng, Project Eng | + PM, Superintendent |

A Superintendent still cannot set a PM — neither above it on the ladder nor in
its "Set by". That property is what keeps this a hierarchy rather than a
free-for-all, and it has its own test.

### One resolver, four call sites

`ancestorTierNamesFor` (`routers/projectTeam.ts`) is the database side;
`projectTeams.workspace` computes the same thing once from the register it
already holds in memory. Both call `tiersAbove`
(`packages/domain/src/org-chart.ts`) rather than each deciding what "above"
means — a second walker is how two answers to "who is above whom" start
disagreeing.

Wired at all four sites that share this gate: `assertCanAssign` (the real
refusal), `projectTeams.workspace` (the `assignable` list the picker renders),
and the `canAssign` hints in `myCrew` and `onboarding.progress`.

### A tier you cannot set is shown, disabled, with the reason

`project-teams-panel.tsx` filtered the list to `assignable`, so an unavailable
tier vanished. `EntityField` already supported `disabled` and a searchable
`hint` per option, so nothing new was needed: every tier now renders, and the
ones you cannot set carry "Set by Superintendent, Project Manager…". The reason
names who CAN, which is the actionable half — "ask a Superintendent" is
something a person can act on.

`workspace` returns that `setBy` list built from the SAME union the gate uses,
so the sentence on screen cannot claim a rule the write does not follow.

## What was found while building it

- **"Reports to" has nothing to do with which tiers are offered**, and it looks
  like it should. Traced exhaustively: `parentId` is never read by the tier
  options expression, and `canAssignIntoTier` has no manager input at all.
  Choosing the Area In-charge as somebody's manager does not widen what may be
  assigned — authority is the CALLER's. Recorded here because it is the obvious
  wrong answer to this bug.
- **The test suite was wiping the working database.** `rbac-matrix.test.ts`
  needs the demo fixture, so every run meant `make seed-demo`, which passes
  `SEED_RESET=1` and deletes every user, roster row and project. That is why
  logins kept disappearing between changes. Tests now run against a separate
  `stinventory_test` database; a full run was confirmed to leave 1,851 people,
  20 projects and the accounts untouched.

## Verified

- **Domain**: six new cases on the pure gate — a Director may set a Foreman by
  ancestry; a Superintendent may not set a PM; a GSuper keeps its "Set by"
  authority despite having no ladder descendants; a tier cannot set itself; and
  an absent ancestor set is a no-op.
- **The gate, not just the hint**: a database-backed suite builds a ladder and
  asserts BOTH that the write succeeds and that `assignable` offers the same
  tier — they are computed by different code and can drift. Confirmed to FAIL on
  both counts with path 4 disabled, so neither is vacuous.
- **In the browser as a real Director** on a job she claimed: the picker offers
  Foreman, Director shows disabled with its reason, and adding a real foreman
  (Alberto Mendez, "Foreman - Flatworks") succeeded.
- `pnpm typecheck` clean; **684 tests pass** inside the api container, up from
  673.

## Deliberately not done

- **No behaviour driven by "Reports to".** Picking a manager still does not widen
  the tier list.
- **No `rank` column.** The ladder is edges, and `tiersAbove` derives order from
  them — a rank cannot express two tiers sharing a boss.
- **`assertBranchTarget` untouched.** It tests branch MEMBERSHIP of the chosen
  manager, a separate and still-correct rule.

## Where it is

Uncommitted on `development`. New:
`packages/api-contracts/src/tier-ladder-authority.test.ts`. Modified: the domain
gate and its tests, `routers/projectTeam.ts`, `routers/projectTeams.ts`,
`routers/onboarding.ts`, `project-teams-panel.tsx` and the Job Tiers screen's
description. Not deployed; `main` is what deploys.
