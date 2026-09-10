# An empty tenant to sync into, and phone numbers that survive the sync

Forty-six people appeared in the People register on a database somebody believed
they had emptied. They were not leftovers and nothing had failed: they are
Urban's real seeded roster, and `make up` re-seeds silently on first boot. But
the question behind the surprise was the right one — once BambooHR is the source
of truth for who works here, a seeded person is not a convenience. It is an
invented row standing between a real sync and an honest answer to "did that
work".

So there is now a third dataset that seeds nobody, and the sync finally writes
the phone numbers it has been discarding since it was built.

## Why 46 and not 52

Worth recording because it will be asked again. The `employee` table held 52
rows; the page showed 46. Both were right: 46 belong to Urban's tenant and 6 to
two throwaway "Onboarding branches" test tenants, and `employee.list` scopes to
the session's tenant. There is no RLS — the `WHERE` clause **is** the isolation,
and this is what that looks like from the outside.

Employees are also not users: 52 people, 21 logins. Deleting accounts would not
have removed a single custodian, and should not — those people hold the 756
tools.

## What changed

### A third dataset: `SEED_DATASET=bare`

`packages/db/src/seed-data.bare.ts` is the same shape as the other two with
every array empty and one owner login. It seeds the tenant, the permission
matrix, the roles and the static vocabularies — everything a tenant cannot
function without and no sync will ever supply — and nothing else.

The login is `optix_it@optixtec.com` holding `owner` — the SAME address the
urban dataset already seeds, so the administrator has one spelling whichever
seed ran. It holds all 32 permissions including `config.manage`, which is what
lets it reach Settings -> Integrations and press Sync. `owner` rather than
`tech_admin`: their grants are identical (`[...PERMISSIONS]` both), and what
separates them is `role.is_cross_tenant`, which nothing reads yet — so the
honest choice is the role that means "the organisation's own administrator".

The design decision worth keeping: **it changes the DATA, not the program.**
Every loop in `seed.ts` runs zero times. There is no `if (bare)` anywhere in the
seed, so this cannot drift away from the path the other datasets take.

It follows the URBAN credential rule rather than the fixture's: the password
comes from `SEED_OWNER_PASSWORD` or is generated and printed once. Only the demo
fixture keeps `stinventory-demo`, because the login page's one-click accounts
depend on it.

`make seed-bare` runs it. It sits deliberately next to the pre-existing
`reset-bare`, which is a different tool — that one empties a database with SQL
and keeps the logins already in it; this one rebuilds a tenant from scratch. The
Makefile now says so, because the names are one letter apart.

### `make up` honours `SEED_DATASET`

This is the actual mechanism behind the surprise. `make up` seeds on first boot
with its output sent to `/dev/null` and its errors swallowed, and it always
loaded the DEMO FIXTURE regardless of what the machine was deliberately running.
It now forwards `SEED_DATASET`. Still idempotent — it skips when a tenant exists,
so it has never overwritten real data and still cannot.

### The sync writes phone numbers

`adaptBambooEmployee` has always built `contacts[]` from `mobilePhone` and
`workPhone`. Nothing persisted it. Both numbers reached the `raw` jsonb column
and stopped there, where no screen looks, and the only writer of
`employee_contact` in the entire repository was the seed. The table's own schema
comment says the collapse of `employee.phone` waits on "something writing these
rows" — this is that writer.

It **reconciles rather than appends**, and that is the load-bearing detail:
there is no unique index on `(employee_id, kind)`, only `one_primary_uq`, so an
appending writer looks correct on the first sync and grows a duplicate mobile on
every pass after it. It deletes the two kinds HR owns and rewrites them.

It touches **only `mobile` and `work`**. A `personal` or `home` number typed in
at the desk is not HR's to delete, and this must not become the sync quietly
discarding a number somebody added by hand.

`employee.phone` is mirrored from the primary and deliberately not dropped —
every screen still reads it, and collapsing it is its own change.

### A dashboard widget that had never once worked

`dashboard.pendingApprovals` carried a raw SQL fragment reading
`select name from employee`. The physical table is `tbl_entity_employee`, so it
threw `relation "employee" does not exist` on **every call since 2026-07-31**.
It went unnoticed because it fails closed: the dashboard renders without the
widget. Found by watching the browser console against the new empty tenant, and
fixed in the same change rather than filed — it is one word, in a file already
open, and the only instance in the repository.

## What was found while building it

- **`db.insert(x).values([])` THROWS.** It is not the no-op the call site reads
  as. Every dataset-driven insert in `seed.ts` was therefore a landmine the
  moment a dataset was legitimately empty. Six of them fired, one at a time, and
  the only way to find them was to RUN the bare seed — nothing in the types says
  this. There is now an `insertRows` helper that returns `[]` so the downstream
  `.map` and `Object.fromEntries` lookups keep working untouched.
- **Two more silently-required fixtures.** The company truck used a bare
  `vehicleRows[findIndex(...)]!.id`, which is `undefined[-1]` on a dataset with
  no trucks — the *exact* bug that had already been found and guarded for the
  personal-allowance truck right below it, left unfixed on its sibling. The
  messages-and-tasks block needed a specific foreman and a specific tool. Both
  now skip.
- **A seed log line was lying.** It printed "+ 2 synthetic trucks"
  unconditionally, on a dataset that seeded no vehicles at all. Same class of
  problem as the `created: 0` scar in the Bamboo sync: a report that misinforms
  the person who ran it is worse than a crash. It counts now.
- **The BambooHR field mapping table was checked row by row against the code and
  is accurate**, including the subtle ones — `photoUrl` is never even requested
  rather than fetched-and-dropped, and `locationName` IS requested purely so
  `raw` can answer where HR says somebody sits without a second call. The one
  gap it flagged, phones, is the one this change closes.

## Verified

- All three datasets seed clean: bare (0 people, 0 assets, 8 categories, 32
  permissions, 15 roles, 1 owner), demo (756 assets), urban (753 assets). The
  populated paths were re-run specifically to prove `insertRows` changed nothing
  for them.
- **The full suite inside the api container: 642 passing**, up from 637 — the
  293 database-backed tests that skip silently on the host all ran. `rbac-matrix`
  fails against the bare dataset exactly as documented and passes against the
  fixture, which is the test being right about the database it was handed.
- The five new contact tests were confirmed to FAIL with the writer disabled and
  pass with it, so they are not vacuous.
- Every register screen driven in a browser against the empty tenant: each
  renders its proper empty state, `/people` reading "Add people one at a time,
  import a spreadsheet, or sync from BambooHR". No console errors remain;
  `pendingApprovals` returns `[]` instead of a 500.
- `pnpm typecheck` passes.
- **A real BambooHR preview ran end to end** against the live API from the
  seeded owner account: 1,851 people would be created and 1,579 flagged
  inactive. It wrote nothing, which is preview's contract and was confirmed
  afterwards — 0 employees, 0 contacts, 1 user. The sync screen was reached in a
  browser as that account and rendered, so the permission path is real rather
  than inferred from the grants table.

Not verified: an `apply` run. The contact writer is exercised through
`applySyncPlan` against adapted records and by the preview's plan, but no live
apply has been performed — that is the user's call to make, not a test's.

## The local database afterwards, and why the seed was not used for it

Recorded because the next person will reach for `make seed-urban` and should
not.

After the bare seed, an `apply` sync loaded **1,851 real people** from BambooHR.
The 20 real jobs were then wanted alongside them — and every seed target passes
`SEED_RESET=1`, which **deletes every employee** before it writes anything. Using
the seed would have destroyed the roster that had just been synced, to add
twenty rows.

So the jobs went in through `project.create`, the ordinary tRPC procedure, as
the owner account: purely additive, one audit event per job exactly as a
hand-created one gets, employees untouched. The source was
`docs/data/import/projects.csv`, which is the same twenty jobs
`seed-data.urban.ts` carries.

Two details worth keeping:

- **`10001 Equipment Yard` was created as `kind: "yard"`.** The column exists
  for that distinction and the urban dataset does not set it, taking the
  `project` default for all twenty — including the one that is a yard.
- **The CSV is CRLF.** The trailing `\r` reached the status field and
  `project.create`'s enum rejected `"in_progress\r"` — the validation doing its
  job, and worth knowing before anything else reads those files directly.

**A seed is not the only way to get data in, and it is the wrong way once the
database holds anything real.** The register procedures are additive and
audited; the seed replaces.

## Deliberately not done

- **The demo fixture and Urban's register are untouched.** Neither replaces the
  other and neither is replaced by this — `rbac-matrix.test.ts`'s apparatus IS
  the fixture's synthetic accounts.
- **`employee.phone` was not collapsed into `employee_contact`.** Its schema
  comment names that as its own change, and doing it here would blank every
  existing reader while the new table fills.
- **`employment_status` and `terminated_at` still are not written by the sync.**
  A departure remains a flag an admin actions, exactly as before.

## Where it is

Uncommitted on `development`. New: `packages/db/src/seed-data.bare.ts`,
`apps/api/src/bamboo-sync-contacts.test.ts`. Modified: `seed.ts`,
`bamboo-sync.ts`, `routers/dashboard.ts`, `Makefile`, plus the docs each change
made wrong — `.claude/rules/database.md`, `docs/SETUP.md` and
`docs/workings/BAMBOOHR_PEOPLE_SYNC.md`. Not deployed; `main` is what deploys.

The local database is left on the bare dataset plus what was loaded into it
afterwards: 1,851 people from a real BambooHR apply, and the 20 real jobs added
through `project.create`. Its owner password was set to the demo one via
`SEED_OWNER_PASSWORD` for this machine only. No assets — the tools register is
still empty.
