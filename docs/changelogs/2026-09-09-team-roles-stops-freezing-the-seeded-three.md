# Team Roles stops freezing the seeded three, and a new tenant starts smaller

Reported directly, from a screenshot of `/settings/team-roles`: General Superintendent
had a live "Holds tools & a truck" checkbox and an enabled delete button, while Foreman,
Project Manager and Superintendent showed plain "Yes"/"No" text and a disabled bin —
the same screen treating six rows in the same table as two different kinds of thing. The
ask, repeated across earlier sessions and not previously acted on: stop special-casing
those three by name, and seed a new tenant with exactly the three of them rather than six.

## What changed

### `tbl_entity_team_role.is_system` is gone

The column (`packages/db/src/schema/reference.ts`), its seed value
(`packages/db/src/seed-data.ts`, `seed.ts`), and every read of it in
`packages/api-contracts/src/routers/projectTeam.ts` — `requireTeamRole`'s select,
`roles.list`'s select and sort, the two synthetic-row fallbacks, and the guard in
`roles.delete` that refused to remove a row where it was `true` — are all removed.
Migration `0058` drops the column; existing rows in every tenant, Urban included, are
untouched, so nothing about who is seated on a job or what a tier is called changed.

`pm`, `superintendent` and `foreman` are still the three tiers a fresh tenant starts
with, still carry a dedicated `project.assign.*` permission (`BUILT_IN_PERM`,
untouched — a different mechanism, see below), and their `name` is still effectively
fixed (`roles.update` never accepted one). Past that, they are ordinary rows: the
custody checkbox and the delete button on `/settings/team-roles` now render the same
way for every tier, and the only reason left to refuse a delete is a tier something is
currently using — a rule that applies to all six, not three of them by name.

### A new tenant seeds three roles, not six

`teamRoleSpecs` (`seed-data.ts`) now lists only `pm` → `superintendent` → `foreman`.
Director, Area In-charge and General Superintendent were Urban's own additions, made
through this same screen — not a second starting tier the product ships. The next
customer gets the three and builds their own ladder from there, the way Urban did.
This only affects a tenant seeded from here forward; it does not touch Urban's or any
other existing tenant's already-seeded rows.

### Left alone, on purpose

`BUILT_IN_PERM` (`projectTeam.ts`) — the name→permission map that gives `pm`,
`superintendent` and `foreman` their tenant-wide assign authority through
`project.assign.pm`/`.superintendent`/`.foreman` — is a separate mechanism from
`is_system` and was not touched. Removing it would take away a capability existing
accounts hold today (assigning into those three tiers without a "Set by" grant), which
is a materially bigger change than the one asked for here. It does mean "Set by" is
still a no-op for those three rows for anyone holding the built-in permission — the
control is live, it just loses to the permission check first. Flagged, not fixed.

## What was found while building it

**The comment justifying the frozen checkbox cited a construct that no longer
exists.** `page.tsx` blamed `TOOLS_FOLLOW`, a hardcoded custodian array that was
retired when `canHoldCustody` became a real per-role column — `grep -rn
"TOOLS_FOLLOW"` across the repo now turns up only that comment and two others,
never a live array. The freeze had outlived its own reason.

**There are two unrelated `is_system` columns.** `tbl_entity_role` (the LOGIN role —
owner, equipment_admin, and so on) has its own `is_system`, protecting a completely
different set of rows for a completely different reason (`role-perms.ts` naming them by
permission). Only `tbl_entity_team_role`'s copy — the job-function tier — was in scope
here; the login-role one was not touched.

## Verified

- `pnpm typecheck` — clean except one pre-existing, unrelated error in
  `onboarding-project-teams.test.ts:17` (a `string | undefined` destructure), present
  before this change and not touched by it.
- `pnpm test` — 362 of 364 in `api-contracts`, same two pre-existing `rbac-matrix.test.ts`
  failures as before this change (the demo roster is currently cleared; unrelated). Every
  test file this change edited (`onboarding.test.ts`, `onboarding-geo-and-crew.test.ts`,
  `project-team-move.test.ts`, `team-role-ladder.test.ts`, `team-role-set-by.test.ts`)
  passes.
- Migration `0058` applied locally: `\d tbl_entity_team_role` no longer lists
  `is_system`, and all 29 existing rows across every local tenant (Urban's real one
  included) survived with their names, labels and ladder edges intact.
- `docker compose restart api web` after the change, per the standing gotcha that the
  dev process does not pick up an edited router or schema package on its own.

**Not verified in a live browser this session** — no confirmed login for the Urban
tenant's real owner account was available. The fix was checked at the database (column
gone, rows intact) and the code (uniform render path, no `isSystem` branch left) rather
than by clicking through `/settings/team-roles` itself. Worth a Playwright pass once a
login is available.

## Deliberately not done

- `BUILT_IN_PERM` and the assign-authority short-circuit it causes for "Set by" on the
  seeded three — separate concern, see above.
- No change to Urban's already-seeded register: the six tiers it has today (including
  Director, Area In-charge, General Superintendent) are untouched; only a *fresh* seed
  now produces three instead of six.

## Where it is

Uncommitted in the working tree, on `development`. Migration `0058` applied to the
local dev database only — not deployed.
