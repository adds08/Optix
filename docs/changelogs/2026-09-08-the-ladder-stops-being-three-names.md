# The ladder stops being three names

The client asked a direct question — *"can you verify that this system will have the flexibility for all users as we talked about"* — and the honest answer needed measuring rather than asserting.

**The empirical half passed.** A tier that had never existed (`Apprentice`, reporting to Foreman, `canHoldCustody: true`) was inserted straight into `tbl_entity_team_role`, taking the register six levels deep. With no code change, `/my-crew` rendered it at the right distance ("3 below you") and the skip warning read *"This skips Superintendent, Foreman"* — both names, in order, correct plural. Depth, labels, distances and copy are all derived. The tier was removed afterwards; the register is back to the six tiers the client configured.

**The audit half did not.** A sweep for hardcoded role names found twelve places where a tenant-added tier gets no behaviour or is invisible. This change closes the two that were silently wrong about data, and one that made an administrator-facing toggle a lie.

## What changed

### `crewOf` reads the register instead of assuming superintendent → foreman

`scope.ts` hardcoded both ends of the crew edge, on the recorded grounds that *"Urban's structure is PM -> superintendent -> foreman"* and that a deeper chain would be handled when it became real. It became real — the seed itself now ships `director → area_in_charge → {pm, general_superintendent} → superintendent → foreman` — and against that ladder an **Area In-charge or General Superintendent holding `assets.view.crew` resolved to `[self]`**. They saw their own tools, nothing else, no error, nothing on screen to explain it. A silent empty result is the worst available failure for a visibility rule.

The rule itself is unchanged, only generalised. What was decided at planning — *"all supers on a job see that job's foremen"* — is really *your crew is the people in a tier below yours, on the jobs you are on*. Both halves now come from data: which tiers are below you from `tiersAtOrBelow`, which jobs are yours from your own roster rows. For a superintendent the answer is byte-for-byte what it was, because the tiers below `superintendent` are exactly `{foreman}`.

Resolved **per project**, which the old code did not do: a person can be superintendent on one job and foreman on another, and their crew on the second is correctly empty. Pooling the projects first — as before — leaked the first job's foremen into the second job's answer for anyone holding two different tiers.

### `employee.myForemen` now calls that same function

It was a second hand-written copy of the same walk, with a comment on each side asking whoever edited one to remember the other. That is not a rule anyone keeps: the ladder went five deep and only one copy would ever have been updated. There is now one answer.

### `usesFieldLayout` reaches the client, and `FIELD_ROLES` is gone

`tbl_entity_role.uses_field_layout` existed, was editable at `/admin/roles`, and was written by `role.update` — and was never sent to any client. The web app kept `FIELD_ROLES = new Set(["foreman","superintendent","mechanic"])` and branched on the role **name** instead.

So the toggle an administrator flipped **did nothing at all**, and a role a tenant created could never get the field layout however it was configured. `identity.me` now returns the flag, `usePermissions` exposes it, and `navFor`/`allItems` take a boolean. The flag's current values are exactly `foreman`, `superintendent`, `mechanic` — so this changes no existing behaviour and only makes the switch real.

## What was found while doing it

**The audit's recommended fix for one finding was wrong, and applying it would have caused a regression.** It flagged `project-assign.ts:188`'s `teamRole === "foreman"` exclusivity rule and said *"the right predicate is already loaded (`canHoldCustody`) and simply is not threaded in."*

It is not the right predicate. `canHoldCustody` is `true` for `superintendent` and `general_superintendent`, and both legitimately run several jobs at once — so threading it in would close a superintendent's roster rows on every other job the moment they got a posting. That is exactly the outcome the existing comment warns against.

The predicate the code needs is *"does this tier work one job at a time"*, and **no column expresses it**. `canHoldCustody` answers "can be handed tools", which is a different question. For this client's ladder the foreman-only literal is very likely correct as it stands, since a General Superintendent does span jobs. Left alone deliberately, and recorded here as needing a tier flag rather than a substitution.

**`CUSTODIAN_ROLES` is a hardcoded mirror of a tenant-editable boolean.** A tenant who ticks `canHoldCustody` on a role they created gets `true` in the database, no entry in the array, and therefore appears in no custodian picker at all. Not fixed here; the array is pinned in both directions by `rbac-matrix.test.ts`, so retiring it is its own change.

## Verified

- `pnpm typecheck` — 14/14 tasks. 242 tests across 11 files still passing.
- `uses_field_layout` in the database is true for exactly `foreman`, `superintendent`, `mechanic` — identical to the set it replaced, so no role changes layout.
- No `isFieldRole`/`FIELD_ROLES` reference remains in code; the only matches left are comments describing the change, including three schema comments that predicted this fix and are now true rather than aspirational.
- Driven in a browser: the owner still gets the desk navigation (`/people`, `/projects`, `/org-chart`, `/my-crew`, `/onboarding/progress`).

**Not verified.** No test covers `crewEmployeeIds` against a deep ladder — the pure tier walks it depends on are covered, the database-backed function is not, and the suites that would exercise it need `make seed-demo`, which would destroy the dataset in use. The visibility change is reasoned and typechecked, not proven by test. That is the weakest part of this change and the first thing to shore up.

## Deliberately not done

- `project-assign.ts`'s foreman-only exclusivity rule — see above; needs a new tier flag, not a substitution.
- `CUSTODIAN_ROLES` retirement.
- The remaining nine audit findings: the jobsite hub's two-tier team strip and foreman-only crew rows, `vehicle-form` and `rig-picker` pickers, `report.byForeman`, the departure successor ladder, and the tool detail page's two accountability rows.
- Granular assign permissions for tenant-added tiers. `Permission` is a fixed code union, so a PM or superintendent sees a tenant tier with `canAssign: false` and only admins can fill it. The client's decision was to leave this to admins for now.

## Where it is

Committed to `development` and pushed. Not deployed — only `main` auto-deploys.
