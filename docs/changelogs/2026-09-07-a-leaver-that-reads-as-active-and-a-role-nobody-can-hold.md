# A leaver that reads as active, and a role nobody could hold

The first real BambooHR apply ran against Urban's live tenant and created 1851
people, flagging 1578 of them as former employees. Both halves of that sentence
turned out to be less true than they looked in the register, and finding out why
took three separate fixes.

The client's question was much smaller than what it uncovered: *"where is the
job title?"* The answer was that job title, division and department had synced
correctly all along — 914 of 1851 rows carried them — and `/people` simply had
no column pointing at any of the three. What that led to was worse.

## What changed

### Job title, division and department are on the register

`employee.list` (`routers/project.ts`) joins `company_role`, `division` and
`department`; `/people` draws three new columns. No new procedure — the data was
already in the table.

The client's confusion was well founded and worth recording, because three
different things in this product are called a "role" and two of them are on this
one screen. **Job title** is the HR fact (`company_role_id`, BambooHR's
`jobTitleName`). **Role** is the RBAC login tier (`role_id`, `/admin/roles`).
**Team role** is the per-job hierarchy (`tbl_entity_team_role`,
`/settings/team-roles`). The Role column read blank for all 1851 because the sync
deliberately never sets `role_id` — correctly, since a login tier is not
something an HR system has an opinion about.

### `hr_flagged_inactive_at`, so a leaver stops reading as active (migration `0055`)

A departure is a flag an admin acts on, never a write the sync performs — settled
with the client earlier the same day. That decision had no column to live in.
`flaggedInactive` was computed in `bamboo-sync.ts`, counted into
`sync_run.flagged_count`, and listed in `sync_run.detail` — which caps at 500
people. So 1578 flagged leavers sat in the register with
`employment_status: active` and nothing on the row to distinguish them from
somebody still on payroll.

The new column is written by the sync on both the create and update paths, and
was backfilled for the current 1578 out of `employee_external_ref.raw` — no
second call to BambooHR, which is exactly the case the `raw` column was added
for. It surfaces on `/people` as its own **HR Flag** column, not folded into
Status, because a source system and Optix are allowed to disagree and that
disagreement is the point.

`employment_status` and `terminated_at` are both deliberately untouched — see
§6 of `docs/workings/BAMBOOHR_PEOPLE_SYNC.md` for why each would have been
wrong.

### Two new RBAC roles, and 257 people mapped to one by job title

`estimator` and `survey` had no home in the existing fifteen roles — between
them they cover ~30 people across seven job titles. Both were created with the
same read-only grant set `read_only` carries.

The mapping itself was built from the 86 distinct job titles held by the 273
people BambooHR has **not** flagged as gone, not the full 122 across all 1851 —
the leaver tail was carrying almost every one-off title and most of the
ambiguity with it. `Foreman - Flatworks`, `Foreman - Structures`,
`Foreman - Dirt`, `Paving Foreman` and the rest all collapse to `foreman`, which
was the client's own worked example.

Five titles were left with no role on purpose: Chief Executive Officer, COO,
Executive Vice President of Human Resources, Sr. Vice President of Finance and
one reading `Mantis IT`. Auto-granting the highest-privilege roles in the system
off a string match is the guess that goes wrong quietly; those five are a
handful of people an admin assigns by hand.

### The legacy `role` column, which is why the mapping did not work at first

Setting `role_id` for 257 people appeared to finish the job and did not. Five
live surfaces still read the deprecated `employee.role` text column, which the
sync writes as `crew` for everybody:

- `jobsites/page.tsx` and `crew-assign-dialog.tsx` — both filter on
  `CUSTODIAN_ROLES` (`foreman`, `superintendent`, `mechanic`)
- `vehicle-form.tsx` — the truck's foreman list
- `employee-form.tsx` — the reports-to picker
- `rig-picker.tsx`

So **52 people who had just been made foremen, superintendents and mechanics
could not be picked as tool custodians**, in a product whose entire purpose is
custody. 78 rows were patched using the mapping the codebase already documents
and already implements — `legacyRoleFor()` in `employee-form.tsx`, where
`project_manager` becomes `pm`, eight names carry through unchanged, and `crew`,
`engineer`, `estimator`, `survey`, `office_admin` and `read_only` have no legacy
equivalent and are correctly left alone.

## What was found while building it

**A settled decision with nowhere to store its result is not settled.** The
leaver-flag policy was agreed, documented in §5, implemented in the planner, and
reported in the run summary — and still produced a register where no leaver was
identifiable. Every layer was individually correct.

**Writing the new column is not the same as the app reading it.** The role
mapping was verified twice — dry-run counts matching the apply exactly, 257/257 —
and was still functionally inert for the 52 people who mattered most, because
verification stopped at the column that was written instead of following through
to the columns the screens actually read. `.claude/rules/database.md` already
warns that a stale key name loses data silently; this is the same failure one
layer up, where the write succeeds and the reader is looking elsewhere.

**BambooHR's leaver tail hides the real shape of the data.** 122 distinct job
titles across 1851 people, but only 86 across the 273 who are current — and the
long tail of single-person C-suite and one-off titles is almost entirely former
employees. Any analysis that does not filter to current staff first is mostly
reading history.

**`_restrictedFields` was empty and the API key is broad.** Every one of the 1851
records came back with `_restrictedFields: []`, so the fallback-to-directory
caveat in §3 never had to be exercised.

## Verified

- `pnpm typecheck` — 14/14 tasks
- `vitest` on `packages/domain`, `packages/types`, `packages/intent` — 223 tests,
  10 files, all passing
- Migration `0055` journaled at idx 55 with its SQL and snapshot present, 55
  applied in the database, column present and nullable
- Data invariants after every write: **0** leavers holding a role, **0** rows
  with `employment_status` changed, **0** with `terminated_at` set, 2 logins
  untouched, 1578 flagged, 257 roled
- Both bulk writes were dry-run first inside a rolled-back transaction and the
  counts matched the apply exactly (257 and 78)
- Driven in a real browser at `/people`: all four columns render real values, the
  HR Flag column reads "Reported left Sep 7, 2026" on leavers and `—` on current
  staff, the Role column resolves, and the Account column correctly separates "No
  login needed" (`crew`, `needsLogin: false`) from "No account". No console
  errors.

**Not verified.** The custodian picker itself could not be clicked: the database
holds 1851 people and **0 jobs, 0 tools, 0 vehicles** — `make reset-bare` emptied
the register and the sync only creates people. The 52-person fix is confirmed in
the data and unexercised in the UI. The database-backed test suites were not run
either, because `make seed-demo` carries `SEED_RESET=1` and would have destroyed
the dataset under examination.

## Deliberately not done

- `employment_status` and `terminated_at` left untouched for all 1578 flagged
  people — both are the admin's decision, not the sync's.
- The five leadership titles left with no `role_id`.
- The five deprecated-column readers were **not** migrated to `role_id`. Patching
  the column unblocks them today; retiring it is its own change, and two of the
  five are custody-adjacent.
- No external-id columns on `company_role` / `division` / `department`, so a
  rename in BambooHR still forks the row rather than updating it — recorded in §4
  of the plan document rather than fixed here.
- `applySyncPlan`'s `existingById` parameter still defaults to an empty Map; a
  caller who omits it silently loses the un-flag-on-rehire behaviour. One caller,
  passing it correctly.

## Where it is

Committed to `development` and pushed. Not deployed — only `main` auto-deploys.
