# Two branches generated a `0022`, and the merge lost both

CI's schema-drift step had been failing on every run: `drizzle-kit generate`
emitted a migration and the step requires that it emit nothing.

## What changed

`0022_strong_dust.sql` and `0022_shocking_baron_strucker.sql` are deleted and
their statements re-issued together as `0024_recover_orphaned_0022.sql`.
`docs/tickets/STATUS.md` now cites `0024` for `vehicle_one_truck_per_foreman_uq`.

## What was found while building it

Two branches each ran `make generate` and each produced an idx-22 migration.
The `.sql` files had different random names, so git merged them without a
conflict and kept both. `meta/_journal.json` and `meta/0022_snapshot.json` did
conflict, and the merge in `9f84d93` resolved the journal by taking the side
that had no idx-22 entry **at all**, and the snapshot by keeping the older of
the two.

Three consequences, all live until this change:

- `generate` diffs the schema against the newest snapshot, which was the half
  predating `vehicle_one_truck_per_foreman_uq`, so it re-emitted that index on
  every run and CI could never go green.
- `migrate` reads only the journal. With no idx 22, **neither** `0022` was ever
  applied to a fresh database — no vehicle index, and no `blocky` theme default
  on `user_preferences.theme_name`. CI's "migrate a fresh database" step passed
  while silently skipping both.
- Databases migrated before the merge diverged from ones migrated after.

Both statements went into a forward migration rather than restoring a
back-dated idx-22 journal entry, because drizzle's migrator applies strictly by
timestamp: a back-dated entry is skipped on any database already past `0023`.
Both are idempotent (`CREATE UNIQUE INDEX IF NOT EXISTS`, `ALTER COLUMN … SET
DEFAULT`), so a database that already ran them re-runs them harmlessly.

`meta/0022_snapshot.json` was deleted in the same commit by a concurrent
session. Harmless: `generate` diffs against the newest snapshot and `migrate`
reads only the journal, and the folder already tolerates snapshot gaps at 0009,
0020 and 0023.

## Verified

`pnpm db:generate < /dev/null` prints `No schema changes, nothing to migrate` —
the sentinel CI greps for — against a clean tree. A throwaway
`sti_migrate_check` database migrated from zero in the api container carries
`vehicle_one_truck_per_foreman_uq` in `pg_indexes` and `'blocky'::text` as the
`theme_name` default. Dropped afterwards; the local dev database was untouched.

## Deliberately not done

No CI guard for the class of failure — a `drizzle/*.sql` with no journal entry.
That is what would have caught the merge on the day it happened. The trap is
recorded in CLAUDE.md's traps table instead.

## Where it is

`b6d4517` on `feature/crew-derivation-team-ui`, swept in by a concurrent
session under the subject `# globally fixed layout`. Not deployed.
