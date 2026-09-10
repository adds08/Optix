# A wall of zeros learns to say why, and a test stops leaving tenants behind

Two unrelated defects found while reviewing the uncommitted onboarding work, both
invisible in source and both obvious the moment the thing was actually run.

The first: `/onboarding/progress` renders one card per crewed job, and on a tenant
where nobody has finished setup that is eleven identical rows of `0/N confirmed`
above eleven identical `Not on the map` badges. Reported by the user in the plainest
possible terms — the page does not give much information to admins. It was not
wrong; every number on it was correct. It simply never answered the question an
administrator opens it with, and never named the reason every figure was zero.

The second was found by accident while getting a trustworthy test count: the local
database held three tenants where it should have held one, and two of them were
named `role admin other`.

## What changed

### The onboarding progress screen states the whole-tenant answer, and the blocker

`SetupSummary` in `apps/web/app/(app)/onboarding/progress/page.tsx` folds the two
arrays `onboarding.progress` already returns into three figures — crewed jobs
pinned, crew who can sign in, crew who finished setup — and, when anybody lacks an
account, one sentence saying what that costs and linking to the screen that fixes
it.

It is computed in the browser from rows already fetched. No new procedure, no second
query, and deliberately no stored total, for the same reason the file header gives
about percentages: a number that can disagree with the rows beneath it is worse than
no number. A fold over exactly those rows cannot.

The blocker sentence is the point of the component rather than a decoration on it.
`0/5 confirmed` is a symptom; nobody can confirm a crew they cannot sign in to see.
Stating the cause once, with the remedy a click away, is the difference between a
report and a next action.

Only the account figure carries the amber rail. `Metric`'s own comment is explicit
that a coloured rail is the exception, and putting one on `Crew finished setup` would
point the eye at a consequence instead of its cause.

### The labels say "crewed", because the denominators are not the tenant's totals

The first cut labelled the tiles `Jobs on the map` and `Can sign in`, which read as
the whole register and are not. `onboarding.progress` derives every row from live
crew membership, so a job with nobody on it and a person on no job are both absent by
construction. An admin reading `0/11` as the job register would have been wrong by
nine jobs.

Fixed by naming the population in the label and adding one line under the tiles
saying that a job with nobody assigned does not appear. The tenant totals are
deliberately not fetched to sit beside these — see below.

### `role-admin.test.ts` deletes both tenants it creates

Its `beforeAll` creates two, `roleadm-${suffix}` and `roleadm-other-${suffix}`, to
prove that a role in one tenant cannot be edited from another. Its `afterAll` deleted
only the first. The second was a `const` local to the setup block and only the ROLE
id was hoisted to suite scope, so the teardown had no reference to the tenant and
left it behind — one orphan per run, in the same database the dev stack and the
browser point at. `otherTenantId` is now suite-scoped and deleted alongside the
first; the role rows go with it, since the tenant FK is `ON DELETE cascade`.

## What was found while building it

- **Eighty-one of the eighty-three employee codes are invented.**
  `docs/data/build_seed_data.py` says so in a comment: neither source carries an
  employee number and `EmployeeSeed.extId` is not nullable, so `URB-001`..`URB-081`
  are minted positionally. They are not Urban's badge numbers. Anything that treats
  `employee.code` as immutable — including a future BambooHR sync — would freeze a
  counter the seed made up.
- **Only two of eighty-three employees have an email address**, and both are the
  synthetic desk pair the generator appends. None of the eighty-one real people has
  one, which is the actual reason the tenant has two login accounts and zero
  completed setups. `employees.csv` carries four columns — name, positions, jobs,
  sources.
- **Both existing accounts have `employee_id = NULL`**, so `hasEmployee` is false for
  each and neither can reach `/welcome` at all. The invite-to-onboarding loop being
  "proven for two roles" is proven on accounts the gate exempts.
- **The test suite's tenant leak is masked by `SEED_RESET=1`.** A reseed wipes the
  orphans, so they only accumulate between resets — which is precisely during a long
  manual verification session, when the database is least expected to move.
- **`vitest` exits 1 on failure, and a pipeline hides it.** An early run here
  reported success on a red suite because the command was piped through `tail` and
  the shell reported `tail`'s status. The suite is fine; the measurement was not.
- **The employee table has no `department_id`.** `BAMBOOHR_PEOPLE_SYNC.md` maps
  `departmentName` to it, `tbl_entity_department` exists and `asset.owningDepartmentId`
  references it, but migration `0050` added `division_id` only. That mapping has no
  column to land in yet.
- **`BAMBOOHR_COMPANY_DOMAIN` and `BAMBOOHR_API_KEY` are absent from the Zod env
  schema**, so `serverEnv()` strips them today. Present in `.env.example` and nowhere
  in `apps/api/src` or `packages/`.

## Verified

Run inside the api container, which is the only place the database suites actually
execute rather than skip:

- `pnpm typecheck` — exit 0, thirteen tasks, after each of the two changes.
- `pnpm vitest run` after `make seed-demo` — 43 files, 568 tests, all passing,
  exit 0. Against Urban's real register the same suite is 563 passed / 5 failed,
  every failure `rbac-matrix.test.ts` reporting a missing fixture account. That is
  the documented and intended behaviour, not a regression.
- The tenant leak, measured rather than reasoned about: tenant count went 3 to 4
  across one suite run before the fix, and holds at 1 across a full run after it.
- `/onboarding/progress` driven in a real browser signed in as
  `optix_it@optixtec.com`. The band renders `0/11`, `0/44`, `0/44` with the blocker
  line and the People link; console clean, zero errors and zero warnings. The
  eleven-versus-twenty scope problem was caught here and nowhere else — it type-checked
  and read correctly in source.
- Database totals behind those figures, by query: twenty jobs of which eleven have a
  crew, eighty-three people of which forty-four are on one, zero jobs pinned, two
  accounts, zero completed setups.

Not verified: the `byPerson` tab was not driven in the browser, only `byJob`. No
mobile client check. Nothing was run against production and no call of any kind was
made to BambooHR.

## Deliberately not done

- **No tenant totals beside the tiles.** Showing `11 of 20 jobs` needs a second query
  for a figure this screen was not asked to answer, and the file header is explicit
  that growing it toward everything a boss might want is a stop-and-ask. The scope
  caption solves the misreading without the fetch.
- **No sorting, filtering or `DataTable` conversion**, for the same reason. The page
  is a hand-rolled list and therefore cannot sort by least-complete, which is a real
  gap and a deliberate one.
- **`hasEmail` was not added to `onboarding.progress`.** Naming the count of people
  with no email address on file would be sharper than "without an account", but it is
  a contract change in another agent's claimed area and the account figure already
  carries the point.
- The `people` onboarding kind still has no distinct wizard, and `onboardingKind` and
  `onAnyJob` are still returned by `onboarding.state` and read by no client.

## Where it is

Branch `development`, uncommitted, on top of `176ebc5`. The progress page is part of
the untracked `apps/web/app/(app)/onboarding/progress/` directory, so it does not
appear in `git diff` — only `role-admin.test.ts` does. Not committed, not deployed.
