# A tier and its login role stop having to share a name

The "Can claim a job" toggle on the Job Tiers screen resolves the tier a person is
looking at to the login role the grant actually lands on, and it did that by name
alone. Seven of the eight seeded tiers match exactly. The eighth does not: the tier
register abbreviates it to `pm` while the role register spells out
`project_manager`. So Project Manager was the one tier that could never be made
claimable, on any environment, and the screen refused it with *"There is no access
role called Project Manager"* — which is false. The role exists; only the spelling
differs.

That mattered today because Project Manager and Superintendent are both meant to be
able to take on a job unaided at first login, and the toggle is how that is granted.
The one that could not be ticked was the one blocking the launch.

## What changed

### `setClaimable` matches on the tier's label as well as its name

`packages/api-contracts/src/routers/projectTeam.ts`. The tier's label *is* the
role's name with the underscores turned back into spaces — `"Project Manager"` →
`project_manager` — which is the same normalisation `humanizeRole` performs for
display, running in the other direction. The lookup now accepts either key.

Deliberately not a rename. Renaming the tier to `project_manager` would rewrite
`team_role.name` on every tenant, and that value is stored text in `setBy`, in
`claimTierNames`, and in every roster row's `role` column. A two-key read is the
smaller change by a wide margin.

The grant written is still the **tier's** name, not the role's. `claimOptions`
resolves a role's `claimTierNames` against `team_role`, so a grant reading
`project_manager` would match no tier and hand the user an empty take-on form —
the same dead screen an unseeded tier register produces, reached by a different
route.

### Three tests that go red without it

`packages/api-contracts/src/tier-claimable.test.ts` gains the `pm` tier and a
`project_manager` login role as fixtures, and pins the label route, the
tier-name-not-role-name half of the write, and switching the grant back off. The
suite already had the mismatch's mirror image — a tier with no login role at all —
which still refuses honestly, so the new key has not widened what the control can
reach.

## What was found while building it

- **The fix appeared broken and was not.** Clicking the toggle returned a 500 with
  `ReferenceError: or is not defined`, pointing at the new line — while both the
  host file and the container's mounted copy plainly carried `or` in the import. The
  running API was serving a stale module; `docker compose restart api` cleared it.
  This is the trap already in CLAUDE.md's table under a different symptom
  (`ENOENT: /workspace/package.json` after `db:generate`), and it is worth knowing
  that it also presents as a `ReferenceError` naming a symbol that is demonstrably
  imported. Nothing in the source explains it, so the reflex to "fix" the import is
  wrong and costs time.
- **The claim grants reached parity through the screen, not the seed.** Local held
  three claiming roles where production holds four. The earlier instinct — recorded
  in the handoff notes for this work — was to add Superintendent and Project Manager
  to `roleSpecs.claimTierNames` and move the baseline test's expectation to match.
  That is the opposite of what this morning's baseline commit decided: the seeded
  baseline is what every environment *starts* as, and the Team Roles screen exists
  so a tenant can change its own chain. Granting these through the screen leaves
  that decision intact and `team-role-baseline.test.ts` untouched.
- **One ambiguity the new key introduces, unreachable in seeded data.** If a tenant
  ever creates a login role literally named `pm` on the Access Roles screen, both
  keys match and the `[role]` destructure takes whichever row the planner returns
  first. No seeded dataset contains a role named `pm` (`legacyEmployeeRoleToRole`
  maps the old `pm` onto `project_manager`), so the state is not reachable today.
  Recorded rather than guarded, because a defensive branch for an unreachable state
  is not safety.

## Verified

- `pnpm typecheck` — 13 tasks, all successful.
- `pnpm lint` — 0 errors, 8 pre-existing warnings, which is the documented baseline.
- The api-contracts suite in the container against the test database —
  `400 passed`, `0 skipped`, 36 files. Before this change the same command printed
  397, which is the 389 the handoff notes recorded plus the eight baseline tests
  added this morning.
- The three new tests were run with the label key removed and each failed with the
  exact refusal the screen used to show. A test that passes either way pins nothing.
- In a real browser on local, signed in as the owner account: both Superintendent
  and Project Manager were ticked on `/settings/team-roles` and the write confirmed
  in Postgres, which now shows claim grants for `area_in_charge`, `director`,
  `general_superintendent`, `project_manager` (`["pm"]`) and `superintendent`.

Not verified: anything on dev or production. Neither database is reachable from a
workstation — both sit behind their environment's VPC — and at the time of writing
this change is committed, not deployed.

## Deliberately not done

- **The invite path's role writer.** `user.invite` writes `user_role` and never
  `employee.roleId`, which is why the People screen shows no role for anybody. It is
  a display and data-integrity bug, not an access bug — permissions are correct for
  every invited account — and it is unrelated to claiming a job. Still open.
- **No change to the seeded claim grants**, per the reasoning above.
- **The `pm`-named-login-role ambiguity**, per the reasoning above.
- **Seeing a pre-existing crew assignment on the onboarding screen, and limiting a
  claimer to editing tiers below their own.** Requested alongside this work and
  deferred by the product owner to after the launch.

## Where it is

Branch `development`. Committed with the test in the same change. `development`
deploys to dev and `main` to production, both automatically on a passing CI run;
neither had been pushed when this entry was written.

Concurrent, unrelated and not part of this commit: `docs/workings/
RELEASE_2_SPRINT_PLAN.md` gained a "Pending user acceptance and data work" section
in the working tree while this change was being made.
