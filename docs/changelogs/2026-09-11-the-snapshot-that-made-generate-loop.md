# The snapshot that made `generate` loop, and the CI gate that caught it

Two pushes to `development` failed CI, and the deploy to
`urban.bodhitechlabs.com` never ran because `deploy-dev` needs `check`, `build`
and `smoke` to pass first. The site was serving an older build the whole time —
not down, just stale, which is the harder version to notice.

Both failures were introduced by those same pushes, and neither was caught
locally because neither `pnpm typecheck` nor `pnpm test` runs `pnpm lint`, and
the drift check exists only in CI.

## What changed

### Two lint errors that only CI was running

`no-unused-expressions` rejected a ternary used as a statement to choose between
`Set.delete` and `Set.add` in the crew tree's collapse toggle; it is an if/else
now, saying the same thing. The job group modal carried an
`eslint-disable-next-line react-hooks/exhaustive-deps`, and that rule is not
registered in this config — an unknown rule named in a disable comment is
itself an error. The reason the dependency is omitted is now a comment that
explains it, which is what the disable was standing in for anyway.

Also cleared the two unused symbols those pushes left behind: a mutation
callback argument and a drizzle import whose last caller had gone.

### The migration snapshot was three migrations behind

`0060`–`0063` were hand-written, so `drizzle-kit` never regenerated `meta/`, and
the newest snapshot on disk was `0059_snapshot.json`. That snapshot still
described the three `project_access_restriction` foreign keys as
`ON DELETE NO ACTION` — the state **before** `0062` changed them to `CASCADE`.

`drizzle-kit generate` diffs `schema.ts` against the newest snapshot, not
against the database. So it re-emitted the same cascade block on every single
run, forever, and CI's drift check failed with "schema has changed without a
generated migration". The check was right; the snapshot was the stale thing.

`0064` is the regenerated migration. Its SQL is what `0062` already applied, so
it changes nothing in effect — committing the snapshot beside it is the part
that actually breaks the loop. `pnpm db:generate` now reports "No schema
changes, nothing to migrate".

## What was found while building it

**Every one of these constraint names is silently truncated by Postgres.** The
three FK identifiers are written at 68, 70 and 72 characters against a 63-char
limit, and `0062` used the untruncated names in `DROP CONSTRAINT IF EXISTS`.
That could have been a silent no-op — `IF EXISTS` matching nothing and
succeeding, leaving the cascades unapplied. It is not, because Postgres
truncates the identifier in the DROP too, so it matches the row it created.
Verified directly rather than assumed: cascades land on all three FKs on a
fresh database and on one migrated to `0061` first, and `created_by_user_id`
stays `NO ACTION` exactly as the schema declares. **42 constraints across 20
tables are truncated this way**; only this table drifted, because only this
table's snapshot disagreed with the schema.

**The idx-22 gap in `_journal.json` is a healed scar, not a hole.** Two branches
both generated an `0022` and the merge dropped the journal entry — the exact
trap CLAUDE.md names. It was already diagnosed and repaired by
`0024_recover_orphaned_0022.sql` with idempotent statements. Every `.sql` file
maps to a journal entry and every entry to a file; the sequence is otherwise
contiguous and the `when` timestamps are monotonic.

**`pnpm test` at the repo root is not evidence.** The DB-backed suites gate on
`DATABASE_URL` and skip without it, so the root command reports success while
310 of 381 api-contracts tests never run.

## Verified

- All 64 migrations replay onto an empty database, and onto a database migrated
  to `0061` first, with cascades correct in both.
- Applying `0064` twice leaves the constraints unchanged.
- `pnpm db:generate` reports no schema changes — the loop is broken.
- `pnpm lint` across the workspace: 3 tasks, 0 errors.
- `pnpm typecheck`: 13 tasks. Domain 147, api-contracts 381 (0 skipped, run in
  the api container against `stinventory_test`), api 22.
- CI green on `development`, and `deploy-dev` ran for the first time.
- `urban.bodhitechlabs.com` verified live: `/health` 200, sign-in page renders,
  `POST /auth/login` returns a session for the demo admin, an authenticated
  `project.list` returns real rows, and `onboarding.unclaimProject` answers with
  its own guard message — proving this session's code is the code running.

**Not verified:** nothing was clicked in a browser on the dev site; every check
above was an HTTP request.

## Deliberately not done

- **The 42 truncated constraint names are left alone.** Renaming them would be a
  large migration touching 20 tables to fix something that is cosmetic today —
  Postgres truncates consistently on both sides, so DROP and ADD agree. Worth
  knowing about; not worth doing under a deploy.
- **`NEXT_PUBLIC_APP_NAME=STInventory` in the dev env is left alone.** Nothing
  reads the variable — the page title already renders "Optix" — so it is a stale
  line, not a visible regression.

## Where it is

Branch `development`, commits `b276b03` (lint) and `0dd5998` (snapshot).
Deployed to dev and healthy. Not on `main`, so not in production.
