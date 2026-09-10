# A job code identifies a job

The job picker offered two rows both reading **Equipment Yard** — one with no
code, one as 24002 — and no way to tell which was which without opening both.

Two separate problems sat behind that, and only one of them was data.

## What was actually wrong

**`tbl_entity_project` had no uniqueness of any kind beyond its primary key.**
Not on code, not on name, not per tenant. `project.create` inserted whatever it
was given with no check at all, so any number of jobs could share a code — the
one value every screen leans on to tell jobs apart. `projectLabel` puts the code
in front of the name for exactly this reason, and the code was not guaranteed to
mean anything.

**The second row was not a duplicate yard.** It is job **24002**, a real job
carrying a foreman (Jobani Abarca) and tool location TE-007, that had been given
the name "Equipment Yard" and the `yard` kind. The seed cannot produce this —
`kind` defaults to `project` and is only ever set through the project form — and
there is no audit-log entry, so it was set directly on the dev database.

## What changed

### The code is unique, and enforced twice

`assertCodeFree` in `routers/project.ts` runs on create and on update, and
refuses with the name of the job already holding the code — "Job code 24002 is
already used by Equipment Yard" beats a constraint-violation stack trace. It
trims before comparing and before storing, because a trailing space is invisible
in a list and would otherwise read as a different job.

Migration `0065` adds `project_code_per_tenant_uq`, a partial unique index on
`(tenant_id, lower(code)) WHERE code IS NOT NULL`. The check gives the message;
the index makes the rule true when a future writer forgets to call the check —
the same relationship `assignment_one_active_uq` has with `custody.ts`.

Two deliberate non-rules:

- **Names are not unique.** "Phase 2" is a reasonable name on two different
  sites. The code is the discriminator.
- **Any number of jobs may have no code.** Plenty do. An index that rejected the
  second code-less row would be a worse bug than the one being fixed, so the
  index is partial and the check returns early on an empty code.

### `create` bounds its code the way `update` already did

`externalId` was `z.string().optional()` on create and `z.string().max(60)` on
update, so a job could be BORN with a code no edit form would accept.

## What was found while building it

**Production is 26 migrations behind dev** — 39 of 65 applied, at commit
`ce4188c`. Its `tbl_entity_project` still has `external_id` and no `code` or
`kind` column at all, because migration 0052 (the rename) has not reached it.
Checked for duplicate codes there before writing the index: there are none, so
0065 will apply cleanly when production catches up. Worth knowing before the
next production deploy — that is a large batch of migrations to land at once.

**The unique index would have failed to create against dirty data.** Checked all
three databases first; local, local-test and dev were all free of duplicate
codes, which is why the index could be added without a data-repair migration in
front of it.

## Verified

- 8 new tests in `project-code-unique.test.ts`: the readable conflict, case
  insensitivity, trailing-space trimming, multiple code-less jobs, cross-tenant
  independence, a job keeping its own code on edit, an edit that steals another
  job's code, and the database backstop rejecting a write that goes straight
  past the router.
- api-contracts: 389 tests, 0 skipped, against `stinventory_test`.
- Migration replays onto an empty database; the index blocks a differently-cased
  duplicate and accepts two code-less rows, proven in a transaction.
- `pnpm typecheck` 13/13, `pnpm lint` 0 errors, `pnpm db:generate` reports no
  drift.
- Dev: the empty duplicate row was deleted after re-confirming zero references
  across all ten tables that point at a project. The picker now lists one yard.

**Not verified:** nothing was clicked in a browser; the picker was read back
through `project.list`.

## Deliberately not done

- **Job 24002 was left named "Equipment Yard".** It has a foreman and a tool
  location on it, and renaming somebody's job is the user's call, not a cleanup
  to slip into a data fix. Flagged for a decision instead.
- **No uniqueness on project NAME.** See above — it would be wrong.
- **No backfill migration.** No environment has duplicate codes, so there is
  nothing to repair; adding a repair step nobody needs is how a migration set
  grows statements that never run.

## Where it is

Branch `development`. The dev database has had the empty duplicate removed.
Production is untouched and still 26 migrations behind.
