# Urban's real tier structure, and the wipe that could not run

Local-only session. The goal was to get off the demo fixture and onto Urban's real
register, and to record the tier structure the client drew rather than the one the
seed had guessed.

## What changed

- **`teamRoleSpecs` (`packages/db/src/seed-data.ts`) went from three tiers to eight.**
  The client drew the real chain on 2026-09-09 and it is a **diamond, not a line**:

      director
        area in-charge
          general superintendent | PM | superintendent      (siblings)
            project engineer | field engineer | foreman     (siblings)

  The seed previously had `pm → superintendent → foreman`, which asserted that a PM
  outranks a superintendent. The client corrected that directly: they are siblings,
  both filled by the area in-charge. Project engineer and field engineer did not
  exist as tiers at all; all three of the bottom row carry tools, so all three hold
  custody.

- **The `SEED_RESET` wipe now deletes `project_access_restriction` and `assignment`
  before employees.** Both foreign keys into `employee` are `NO ACTION`/`RESTRICT`
  rather than `CASCADE`, so they blocked the delete instead of following it.

- **Repo root: 29 gitignored screenshot dumps deleted**, and the 17 lines of
  `.gitignore` that had accumulated one named rule per junk file collapsed to a
  single `/*.png`.

## What was found on the way

- **`make seed-urban` did not work on a populated database.** It failed with
  `23503` on `tbl_ops_project_access_restriction`. The table is deliberately
  `NO ACTION` — a removal is a durable access decision that outlives the posting
  it refers to (see `schema/team-access.ts`) — so it can never be reached by a
  cascade and must be deleted explicitly. The same FK blocked a manual tenant
  delete later in the session, which confirmed the fix rather than the workaround.

- **The demo fixture and the real register cannot both satisfy the test suite.**
  `rbac-matrix.test.ts` drives the permission ladder through `warehouse@`, `pm@`
  and `hr@` — synthetic accounts that Urban's real register does not contain. On
  `seed-urban` those five tests fail on missing fixtures, not on permission logic.
  Everything else passes (359/364), and typecheck is clean. This is a pre-existing
  tension between the two datasets, not a regression; closing it means having that
  suite build its own accounts instead of borrowing the seed's.

- **The BambooHR supervisor field was already wired.** An earlier reading of this
  session concluded `reportsToId` was parsed and dropped, because it grepped
  `routers/sync.ts` (the queue) rather than `apps/api/src/bamboo-sync.ts` (the
  worker). The worker resolves it in a documented second pass and writes
  `employee.reportsToEmployeeId`. Nothing needed fixing. The zero supervisor edges
  in the local database are because no live sync has run, not because the code drops
  the field.

## Docs corrected in the same change

`docs/architecture/05-features.md` and
`docs/workings/ONBOARDING_AND_ROLE_HIERARCHY.md` both described Urban's chain as
`director → area in-charge → PM and general superintendent → superintendent →
foreman`. That reads as a line and puts the superintendent under the PM. Both now
carry the diamond and name `teamRoleSpecs` as the authority.

## Not done

- The `employee-mapping` retirement discussed in this session. The screen, its
  router and `tbl_config_employee_role_mapping` are untouched, and an unrelated
  uncommitted change to that page is still in the working tree.
- `project.assign.pm`/`.superintendent`/`.foreman` are still three hard-coded
  per-tier permissions for tiers that are otherwise tenant data. A tenant adding
  `area_in_charge` gets no matching permission.
