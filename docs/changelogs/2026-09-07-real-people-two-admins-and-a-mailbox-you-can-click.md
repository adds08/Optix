# Real people, two admins, and a mailbox you can click

The local database now holds Urban's actual register — 83 people, 753 tools, 20
jobs — instead of the demo fixture's invented ones. Two administrators exist
rather than one. An invite sent from the product produces a real link on this
machine that signs somebody up and drops them into the right onboarding.

The brief is `docs/workings/REAL_DATA_AND_INVITE_FLOW.md`.

## "Pull the actual data" versus "never call BambooHR"

Both were asked for in the same message, and they conflict for the BambooHR
people specifically: the payloads pasted earlier were lost to a context
compaction and never written to disk, so the only way to get them was the one
call that is forbidden.

**Resolved without the call.** Urban's real register was already in the repo —
`docs/data/import/*.csv`, generated into `seed-data.urban.ts`, selected with
`SEED_DATASET=urban`. It is real, it is 81 real names with real job numbers, and
it needs no network. When BambooHR is eventually imported it will *match onto*
these people through `employee_external_ref` (migration `0050`) rather than
replacing them, which is what that table was built for.

Nothing in this change contacts BambooHR. The read-only rule is now written at
the top of `BAMBOOHR_PEOPLE_SYNC.md` as a standing constraint.

## Two administrators, differing on an axis that is not permissions

`owner` was already all-permissions and is the **organisational** administrator:
the customer's own, confined to their tenant like every other account.

`tech_admin` is new. The existing comment on `ROLES` argues — correctly — that a
second all-permissions role is two names for one authority. This role escapes
that argument by differing somewhere else: `role.isCrossTenant`, reaching every
tenant rather than one.

**Nothing reads that flag.** Today `tech_admin` behaves exactly like `owner`
inside its own tenant. Multi-tenancy proper is explicitly later, and a flag that
silently widened every query the moment it was added would be the worst possible
way to ship it — there is no RLS here, the `WHERE` clause *is* the isolation. The
role, the column and the seeded account exist so the real change has somewhere
to land, and the schema comment says so in those words.

## Onboarding is chosen by the role, not by its name

`role.onboardingKind` — `equipment | people | none`:

- **`equipment`** — the chain the product is actually for: director, area
  in-charge, PM, superintendent, foreman, crew. The wizard that exists today.
- **`people`** — HR. Every project's people, no tools.
- **`none`** — technical admins, finance, read-only. Never prompted.

This makes the gate's third condition. `shouldPrompt` is now *not finished* AND
*role wants a wizard* AND *has an employee record* AND *is on a job* — three
facts, all of them data, none of them a role-name branch. That last part is the
point: a role-name list is wrong the day a tenant adds a role, which is why the
other two conditions were keyed on the roster in the first place.

The default is `equipment`, deliberately. A wizard shown to somebody who did not
need it is one click to skip; setup silently skipped for somebody who *did* need
it is invisible. Fail toward the recoverable side.

## A mailbox on localhost

`sendMail` already had a console fallback, so mail was never lost — but a line in
a log is not a link anybody can click, and the invite → signup → onboarding loop
is only testable end to end if the invite arrives somewhere you can open it.

Mailpit now runs on the compose network: a real SMTP server that accepts
everything, **delivers nothing**, and serves the inbox at `http://localhost:8025`.
The only wiring needed was `SMTP_HOST=mailpit` in `.env.local` — `mailConfigFor`
and its env fallback already had exactly the right shape. `.env.example`
documents it and stays empty, because empty means "log, don't send", which is the
right default for anything deployed.

## Verified end to end, twice, on purpose

An invite sent as `owner` from the running product:

- to a **foreman** who is really on job 23009 — arrived in Mailpit, the link
  signed him up, and he landed on the wizard showing that job;
- to an **HR** role — same mechanism, same database, landed on `/home`.

Same flow, same data, one difference: `onboardingKind`. That is the evidence the
flag is what decides, rather than the absence of jobs doing it quietly.

## `externalId` may be null, and already says so

Checked rather than assumed, by nulling a real person's code and driving
`/people` in a browser: the register renders an em-dash, entity search `OR`s past
the null instead of dropping the row, and the pickers omit the hint. No code
change was needed. The finding is the deliverable — the null path is exercised,
not merely tolerated.

## Two things found on the way

**`SEED_RESET=1 make seed` had been silently doing nothing.** `docker compose
exec` does not inherit the caller's environment, so the seed saw no variable,
found a tenant already present, and skipped — while printing enough output to
look like it had worked. The make target now forwards `SEED_RESET`,
`SEED_DATASET` and `SEED_OWNER_PASSWORD` explicitly, and `make seed-urban` /
`make seed-demo` name the two datasets so nobody has to remember the incantation.

**The seed's closing message claimed "ONE account, the system owner"** after a
second was added. Now it prints both and explains how they differ, including
that the cross-tenant flag is not yet read.

## Migration 0051

Two columns, plus the part the seed cannot do: the seed only ever runs against a
fresh database, so live ones get the `onboarding_kind` values, the `tech_admin`
role and its grants as explicit statements. `.claude/rules/database.md` records
three migrations that exist purely to repair that gap — this is the fourth
avoided. The grant is written as a `SELECT` over `tbl_entity_permission` so it
says the same thing `role-perms.ts`'s spread says, rather than that day's list.

## The demo-account list follows the dataset

The sign-in page's one-click account panel is a demo-FIXTURE affordance, which
its flag name (`NEXT_PUBLIC_SHOW_DEMO_LOGINS`) does not say. With the real
register loaded the database holds two administrators and no `*.local` address
at all — so all thirteen buttons named accounts that were not there and failed
on click.

`.env.local` now ships it **off**, both make targets print which way to set it,
and the page comment records that the flag is dataset-specific and not merely
environment-specific. The real path onto that screen is an invite, which sets
the role as it sends and lands in Mailpit.

## The demo fixture stays

"Remove all demo data" was applied to the local **database**, not to
`seed-data.ts`. `rbac-matrix.test.ts` drives the visibility ladder through those
synthetic accounts, and replacing the fixture with real data was tried on
2026-09-01 and made five security tests unrunnable. A security test that cannot
run is worse than one that fails.

Consequence, stated plainly rather than worked around: **run `make seed-demo`
before the test suite.** Against the real register `rbac-matrix` fails with
"seeded account missing: hr@stinventory.local", and that is the test being right
about the database it was handed.

## Verified

- `pnpm typecheck` clean across all 14 packages.
- 568 tests in 43 files (4 new), run inside the api container against the demo
  fixture so the database suites execute rather than skip.
- The real register loaded and both administrators' logins exercised against the
  running API.
- The invite loop driven in a browser, twice, as described above.
