# Delete the three per-tier assign permissions

`project.assign.pm`, `.superintendent` and `.foreman` are gone, along with
`BUILT_IN_PERM`, the map from tier name to permission that three call sites had
to keep agreeing on. `project.team.assign` is now the only tenant-wide grant.

## Why they could not stay

They named three specific tiers in `tbl_entity_team_role` — a register a tenant
edits on the Job Tiers screen. The `Permission` union is fixed code, so a tier a
tenant invents can never have one. Urban had already proved the point: their own
`area_in_charge` and `general_superintendent` had no dedicated permission and
fell through to `project.team.assign`, which means the hierarchy those three
permissions claimed to enforce was only ever part of the register's real shape.

What they expressed is worth keeping — a PM may place a superintendent but not
another PM. `team_role_assigner` ("Set by") records exactly that, per tier, for
every tier, and needs no deploy to add one. `canAssignIntoTier` already had the
branch; only the inputs changed.

## Two behavioural consequences, stated plainly

- **Emptying a tier's Set-by list now genuinely revokes the ability to fill
  it.** While the dedicated permissions existed, one of them could still be
  standing behind an empty list, which made that screen quieter than it looked.

- **Authority is now the tier held ON THAT JOB**, where the permissions were
  tenant-wide. A PM rostered on no jobs can no longer staff a job they are not
  on. That is the intended narrowing — authority over a job belongs to the
  people on it — and `project.team.assign` remains the deliberate exception for
  the desk and the equipment department.

## What was found on the way

- **The seed wrote no `team_role_assigner` rows at all.** It did not need to
  while the permissions covered the seeded tiers. Without them, a freshly
  seeded tenant now has a register that only `project.team.assign` can staff —
  the exact "data the seed cannot produce is behaviour nobody tests" trap
  CLAUDE.md's seed rule names. `TeamRoleSeed` gained a `setBy` list and the
  seed writes the rows in a second pass, the same way it wires the ladder.

- **`setBy` and `reportsTo` are not the same list, and assuming they were broke
  a test.** A foreman answers to a superintendent and is normally filled by
  one — but on a job with no superintendent, where the foreman reports straight
  to the PM (legal, and described in `projectTeamMember.reportsToEmployeeId`'s
  own comment), a superintendent-only Set-by list grants nobody anything. The
  deleted `project.assign.foreman` covered that case tenant-wide and silently.
  Both onboarding fixtures and the seed now name the PM explicitly.

- **The type system found every stale grant.** Removing the three from the
  `Permission` union failed the build in six test files, each one a caller
  being handed a permission that no longer existed. None of them were rewritten
  to pass — each fixture gained the Set-by rows carrying what it used to assert.

- **One regression test was guarding a feature that is now deleted.**
  `team-role-set-by.test.ts` asserted "an existing dedicated permission still
  works with an EMPTY Set-by list". Its real claim — a tier nobody is
  registered to fill is reachable only by the tenant-wide grant — survives with
  an unrelated permission standing in for the deleted one.

## Verified

`pnpm typecheck` clean across 14 packages. **364/364 tests pass** in the api
container against the demo fixture, which is what CI seeds. A fresh
`seed-urban` produces the six expected Set-by rows; `reset-bare` leaves 32
permissions where there were 35.
