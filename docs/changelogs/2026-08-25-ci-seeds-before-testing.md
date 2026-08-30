# CI seeds before it tests, and one retry policy for every query

Two things, both discovered by asking why production was four commits behind
`main` with the invite migrations unapplied.

The answer to that question is not about migrations. **The migrations are fine.
The deploy never ran**, because `deploy` needs `check`, and `check` had been red
since the commit that made the tests actually execute.

## What changed

### CI seeds the database between migrating and testing

`.github/workflows/ci.yml` gains a `Seed` step. The chain that made it necessary:

1. `rbac-matrix.test.ts` reads the **seeded** `urban` tenant, deliberately. Its
   own header says why: a permission matrix asserted against the test's own
   fixtures only proves the fixtures agree with themselves, so it has to run
   against the database people actually log into.
2. Every DB-backed suite guards itself with
   `describe.skipIf(!process.env.DATABASE_URL)`. Before `b367c1f` (STI-1102) CI
   had no database, so all of them skipped silently and the job went green with
   178 tests never running.
3. `b367c1f` gave CI a postgres service, a `DATABASE_URL` and a `Migrate` step —
   but no seed. So the first CI run in which this suite ever executed was also
   the first in which it failed.
4. It failed as a *suite*, in `beforeAll`, on `tenantId = t!.id` against a
   tenant that was never created. The non-null assertion turns a missing fixture
   into `TypeError: Cannot read properties of undefined (reading 'id')`, which
   reads like a broken test rather than a missing row.
5. `deploy` needs `[check, build, smoke]`. `build` and `smoke` both passed; only
   `check` was red, and that was enough. Production stayed on `43fe1f0` for a
   day while `main` looked merged and healthy.

The stale comment above `Migrate` — "the suites create their own throwaway
tenants" — is corrected in the same change. It was true when written and is
exactly the assumption that made the seed look unnecessary.

### One retry policy, in one place

`retryUnlessUnauthorized` in `apps/web/lib/trpc.ts` replaces the four separate
`retry: false` settings in `app-shell.tsx`, `job-scope.tsx` (twice) and
`project-switcher.tsx`. Never retry an `UNAUTHORIZED` — the credential is dead
and retrying only delays the redirect; retry anything else twice.

`retry: false` was the habit across the app and it is wrong the same way
everywhere: it treats "the session is gone" and "one request lost the network"
as the same event and gives up permanently on both. On a phone in a yard the
second is routine.

The `job-scope.tsx` pair mattered most after the shell. Those two queries are
what the saved job selection is validated against, so giving up on the first
failure left both lists empty, no stored group or project matched anything, and
the session fell back to Show All — every page unfiltered because one request
was dropped. Not a security question (the server scopes every read
independently), but a surprising and invisible one.

Four call sites is what justified extracting a helper rather than a fifth copy.

## What was found while building it

- **A green CI job had been proving nothing for as long as the DB suites
  existed.** The skip guard is the right pattern, but combined with a missing
  `DATABASE_URL` it is indistinguishable from success. `db-suites-run.test.ts`
  exists to catch exactly that and is what made `b367c1f` possible; the gap it
  did not cover was "database present, fixtures absent".

- **Migrating is not the same as being ready to test.** The `Migrate` comment
  encoded an assumption about every suite that one suite had never matched. A
  seeded fixture is part of the harness here, which is the same point CLAUDE.md
  rule 9 makes from the other direction: data the seed cannot produce is
  behaviour nobody tests.

- **A comment written in good faith became the reason the bug was invisible.**
  Nobody adding a database to CI would think to seed it, having read a line
  saying the suites make their own tenants.

## Verified

Reproduced and fixed against a real database rather than argued from the log:

- Created a fresh `sti_citest` database and ran `pnpm db:migrate` alone — CI's
  exact state. `rbac-matrix.test.ts` failed with the identical error, same file,
  same line 64, same `TypeError`.
- Ran `pnpm db:seed` against that same database and re-ran the suite —
  **34 passed**.
- Ran the **whole** suite against that fresh migrate+seed database, which is
  precisely what CI will now do: 247 passed in `api-contracts` with 0 skipped,
  and green across `domain`, `types`, `intent`, `auth`, `mail` and `api`.
- `pnpm typecheck` — 14 tasks successful; this is what confirms
  `TRPCClientErrorLike` types the shared retry helper at all four call sites.
- `gh workflow view CI` parses the amended file, and the `check` job's steps are
  in the intended order: Typecheck → Migrate → Seed → Test → Lint.
- The scratch database was dropped afterwards.

**Not verified: the amended workflow has not run on GitHub.** Whether the seed
step behaves the same on a CI runner as against the local postgres container is
unproven until it does. The retry changes have not been exercised in a browser,
like the shell change before them.

## Deliberately not done

- **`t!.id` is left as it is.** A missing seed should arguably fail with a
  sentence rather than a `TypeError`, but the fixture is now guaranteed by the
  harness, and changing an assertion to explain a state that can no longer occur
  is the defensive branch this repo's own review rules say to drop.
- **`apps/web` still has no test harness.** Unchanged from the two entries
  before this one, and now the third change in a row that a component test would
  have covered.
- **The deprecated Node 20 action warnings in CI are untouched** — noise, not
  this change.

## Where it is

Committed on `development`, following `8e2f249`. **Not pushed, so production is
still on `43fe1f0` and still has no `auth_token` table.** Shipping requires this
on `main`: the CI fix has to merge before any deploy can go green, and it
unblocks `d79c4cd`, `b367c1f`, `0018cec` and `b9c5932` behind it.
