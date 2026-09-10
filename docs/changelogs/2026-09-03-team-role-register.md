# Team roles become data, and the chart gets its first real hierarchy

Follows [2026-09-02-org-chart.md](2026-09-02-org-chart.md), which built the
`reports_to_employee_id` edge and the chart but left `TEAM_ROLES` as the same
hardcoded three-string array the seed comment already flagged as the thing
`canRunAJob` should have replaced. The user asked directly: "we need a way to
add roles as well right, and their permission, then make the hierarchy right?"

## What was corrected before it was built

The plan going in was to add a `canRunAJob` flag to `tbl_entity_role` — the
table behind `/admin/roles` — since it already carries the exact pattern
(`canHoldCustody`, `usesFieldLayout`) this needed. That was wrong, and caught
before the column shipped rather than after: `tbl_entity_role` is the
**login/permission** role (`owner`, `project_manager`, `engineer`...) and
`project_team_member.role` validates against a **different**, unrelated
vocabulary (`pm`, `superintendent`, `foreman`). The seed proves they diverge on
purpose — one person's login role is `engineer` while their team role is `pm` —
so a flag on the wrong table would have needed a name-to-name lookup between
the two, which is exactly the two-lists-drift failure `tbl_entity_role`'s own
header comment says it was built to end.

The correct home was a new table, because neither existing one fit:
`tbl_entity_role` is the wrong vocabulary (above), and `tbl_entity_company_role`
(the HR job-title register) has no router or admin screen at all and mixes
non-team titles — Carpenter, Labourer, Yard Hand — that were never candidates
for a project-team role.

## What changed

### `tbl_entity_team_role` — a new register, seeded and admin-editable

Migration `0042_team_role_register`. Tenant-scoped, one row per tier:
`name` (what gets written into `project_team_member.role`), `label`,
`canHoldCustody`, `isSystem`. `pm`, `superintendent` and `foreman` ship seeded
and `isSystem` — they keep their existing dedicated permissions and cannot be
deleted. Anything a tenant adds has no dedicated permission and is gated by the
new `project.team.assign` instead.

### `TEAM_ROLES`, `PERM_FOR_ROLE` and `TOOLS_FOLLOW` — deleted

`routers/projectTeam.ts` now resolves the target role against the register at
request time (`requireTeamRole`) rather than validating a static `z.enum`.
`toolsFollow(role)` became `roleRow.canHoldCustody`, read from the same row.
The three built-in roles keep their own permission strings unchanged
(`BUILT_IN_PERM`); anything else falls to `project.team.assign`. `TeamRole` as
a closed type is gone from this file and from `moveEmployeeToProject`'s
signature, which now takes `role?: string | "auto"`.

### Two new permissions

`project.team.assign` (put a person in a tier with no dedicated permission —
granted today to owner, equipment_admin, office_admin) and
`project.team.manage` (add/edit/delete a tier itself — same three). Split for
the same reason `config.manage` and `project.assign.*` are already split:
adding a TIER to the vocabulary is a different act from putting one PERSON in
an existing tier.

### `/settings/team-roles` — the screen that makes this real

List, add and (for tenant-added rows only) toggle `canHoldCustody`. Built-in
rows are read-only here — the assignment hierarchy and the seed name them
directly. Deliberately not folded into `/admin/roles`: that screen edits the
login role, this edits the job-function tier, and they answer different
questions about the same person.

### The seed grows a `teamRoleSpecs` fixture, and `SEED_RESET=1` ran

Three rows (`pm`, `superintendent`, `foreman`), inserted as a shared
vocabulary alongside `roleSpecs`/`companyRoleSpecs` — not per-dataset, since
both the demo fixture and Urban's real data validate against the same three
built-in tiers. The user approved running `SEED_RESET=1` against the local
Docker database (not production) to load last session's `reports_to` rows,
which had been sitting unloaded since the seed script skips an existing
tenant by default.

## What was found while building it

**The bare-mutation and reachability checks both did their job.** The new
`roles.create`/`update`/`delete` mutations initially used an in-body
permission check (`ctx.session.permissions.has(...)`), which
`rbac-matrix.test.ts` correctly flagged as needing a `BARE_BY_DESIGN` entry —
and then, on reflection, was simply the wrong choice: `role.create` and
similar procedures already use `requirePermission("config.manage")` directly
for exactly this shape (a flat, non-input-dependent permission), so the three
mutations were rewritten to match and the check disappeared as a special case
rather than being justified as one. Separately, `reachability.test.ts` refused
to let `roles.list`/`create`/`update`/`delete` merge with no screen reaching
them — which is why `/settings/team-roles` has both an add control and an
inline edit toggle, not just a read-only list.

**A real Postgres test fixture broke, correctly.** `project-team-move.test.ts`
runs against real Postgres with a throwaway tenant that had no `team_role`
rows, so every `projectTeam.assign` call in it started failing the moment
`requireTeamRole` was added — the fixture was exercising a precondition that
no longer existed for free. Fixed by seeding the three built-in rows for that
tenant in the same `beforeAll` that creates it.

## Verified

- `pnpm typecheck` across the workspace: 13 of 13 tasks pass.
- `packages/api-contracts` vitest: all 27 test files, 279 tests pass —
  including `rbac-matrix.test.ts` and `reachability.test.ts`, both of which
  failed at least once during this change and were fixed rather than
  suppressed.
- `packages/domain` vitest: 44 tests pass, unchanged by this round.
- Migration `0042` applied against the local database; `tbl_entity_team_role`
  confirmed present with `\d`.
- `SEED_RESET=1` run against the local Docker Postgres container. Verified
  with a direct query that the reporting chain now has real data: Ruth
  Calloway (director, no roster row of her own) above Priya Raman and Dana
  Whitmore (PMs, each with `reports_to` pointing at her), above Marcus
  Whitfield (superintendent on both DART and Lone Star, correctly parented to
  the PM of whichever job the row is on), above the foremen on Lone Star and
  DART.
- `/org-chart` and `/settings/team-roles` both serve HTTP 200 from the running
  dev stack after the reset.

**Not verified.** Neither page has been driven in a browser — no click, no
screenshot. The chart has still never been visually inspected; HTTP 200 proves
the data reaches the page, not that the tree renders correctly. `TeamRolesPage`
has not been exercised end to end (create a role, tick its custody flag, delete
it, hit the "in use" refusal).

## Deliberately not done

- **Delegated assignment is still unbuilt.** A tenant-added tier is gated by
  the flat `project.team.assign` permission, not by "you may assign anyone who
  will report to you" — the rule designed on 2026-09-02. `office_admin` holds
  the flat permission; nobody else can assign a director-tier role yet, even
  if they are one.
- **Departures still do not re-point orphans** when a PM's row closes.
- **The jobsite team strip still has no `reportsToEmployeeId` picker.** The
  edge can be set by the seed and, now, in principle by any caller of
  `projectTeam.assign`, but no UI control writes it from the Tools by Jobsite
  card.

## Where it is

Still `feature/org-chart`, uncommitted. Not pushed, not deployed.
