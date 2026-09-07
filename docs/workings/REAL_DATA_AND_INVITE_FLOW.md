# Real data, two admin roles, and a local invite loop

Status: **BUILT 2026-09-07**, except where noted. Written from the client's brief.

The brief, restated so it survives a compaction:

1. Load Urban's **real** register into the local database; drop the demo people.
2. Two roles that hold every permission: one **organisational admin** scoped to
   the tenant, one **technical admin** that reaches every tenant.
3. Logins for Urban's crew, eventually sourced from BambooHR.
4. An invite → email → signup → onboarding loop that works **locally**, with a
   fake mailbox instead of real delivery, so the client can click a real link.
5. Role and permissions set **at invite time**, as a rule.
6. A flag on the role saying **what kind of onboarding** that role needs — HR
   sees people and no tools; the equipment chain sees jobs and tools.
7. `entity.externalId` may be null, and the UI must say so rather than blank.

## The hard constraint

**Never call the BambooHR API.** Stated twice by the client, emphatically, about
their production HR system. No fetch, no adapter, no "just once to check". The
credentials in `.env.local` are not to be used.

### What this means for "pull the actual data"

The BambooHR payloads the client pasted earlier are **not on disk** — they were
lost to a context compaction and never saved. So there is no BambooHR data on
this machine to load, and getting it would require the one call that is
forbidden.

**Resolved by using the register that is already here.** `docs/data/import/*.csv`
holds Urban's real people, jobs, tools and vehicles, generated into
`packages/db/src/seed-data.urban.ts` and selected with `SEED_DATASET=urban`:

| File | Rows |
|---|---|
| `employees.csv` | 81 real people |
| `projects.csv` | 20 real jobs |
| `tools.csv` | 753 real tools |
| `vehicles.csv` | 88 real vehicles |

That is the actual data, it is real, and loading it needs no network. When
BambooHR is eventually imported it will **match onto these people** by name and
badge number rather than replacing them — which is what `employee_external_ref`
(migration `0050`) was built for.

## Two admin roles

`owner` already holds `[...PERMISSIONS]` and is the **organisational admin** —
tenant-scoped, the customer's own administrator.

The **technical admin** is new and different in kind: it reaches every tenant.
That is not a bigger permission set, it is an escape from the tenant predicate
that every query in this codebase carries, so it must be a deliberate, narrow,
auditable mechanism and not a role that happens to be granted a lot.

Multi-tenancy proper is later, by the client's own instruction. What ships now
is the role and the flag it keys off, with a single seeded account.

## The demo dataset is NOT deleted

The client asked to "remove all demo data". Applied to the **local database**,
which is what they are looking at. **Not** applied to `seed-data.ts` the file:
`rbac-matrix.test.ts` drives the visibility ladder through those synthetic
accounts, and replacing the fixture with real data was tried on 2026-09-01 and
made five security tests unrunnable (`.claude/rules/database.md`). A security
test that cannot run is worse than one that fails.

So: `SEED_DATASET=urban` becomes the local default; the fixture stays on disk for
CI.

## Onboarding kind, on the role

A new column on `tbl_entity_role` saying which wizard a person gets. The
vocabulary follows the client's own division of the company:

- `equipment` — director, area in-charge, PM, superintendent, foreman, crew.
  Jobs, crew, tools, pins. The wizard that exists today.
- `people` — HR. Sees every project's *people* and no tools at all.
- `none` — technical admins, and anyone whose job the wizard cannot help with.

Keyed off the role, not off a role NAME list in code — `.claude/rules/web.md`
already records that a role-name branch is wrong the day a tenant adds a role.

## The local invite loop

Invites, tokens and mail already ship (`packages/mail`, the invite tables). What
is missing locally is somewhere for the mail to land.

Plan: a development mail sink — messages written to a local store and served on
a page — so an invite produces a **real, clickable link** on this machine with
no external delivery. Signup then runs the real token flow, and the new account
lands in the onboarding its role declares.

Nothing here may become a production delivery path.

## What was built

1. **`externalId` null handling** — checked, already correct everywhere. The
   register renders `—`, the search `OR`s past a null rather than dropping the
   row, and the pickers omit the hint. Verified by nulling a real person's code
   and driving `/people` in a browser. No code change was needed; the finding is
   the deliverable.
2. **`role.onboardingKind`** (`equipment | people | none`) and
   **`role.isCrossTenant`** — migration `0051`, which also backfills live
   databases and grants the new role, because the seed only ever runs on fresh
   ones.
3. **`tech_admin`** — in `ROLES`, in `ROLE_PERMS` (all permissions), seeded per
   tenant, with `isCrossTenant` set. **Nothing reads that flag yet**; it records
   the intent so the cross-tenant query path has somewhere to land.
4. **Mailpit** on the compose network — a real SMTP server with a web inbox at
   `http://localhost:8025` that accepts everything and delivers nothing.
   `SMTP_HOST=mailpit` in `.env.local` was the only wiring needed; `sendMail`
   and `mailConfigFor` already had the shape.
5. **The real register**, via `make seed-urban`.
6. Four tests on the new gate condition, docs, changelog.

### The gate now has three conditions, not two

`shouldPrompt` = not finished AND **role wants a wizard** AND has an employee
record AND is on a job. The middle one is new. All three are data — a roster
row, an employee row, a column on the role — and none is a role-name branch.

## Verified end to end

An invite sent as `owner` to a **foreman** on a real job produced a link in
Mailpit, which signed up and landed on the wizard showing job 23009 Little Elm.
The same flow for an **HR** role landed on `/home` instead. Same mechanism, same
database; the only difference was `onboardingKind`.

## Left undone, deliberately

- **`isCrossTenant` is inert.** Multi-tenancy proper is the client's own "later".
- **BambooHR is not called.** Still forbidden, still unbuilt.
- **`make seed-demo` before the test suite.** `rbac-matrix.test.ts` needs the
  fixture's synthetic accounts and fails against real data — by design, and
  documented rather than worked around.
