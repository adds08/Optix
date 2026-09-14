# Repair the drizzle snapshot gap (0070–0080)

**Filed:** 2026-09-14. **Blocks:** re-enabling "Check for uncommitted schema
drift" in `.github/workflows/ci.yml` (currently `if: false`, with a comment
pointing here).

## What's wrong

`packages/db/drizzle/meta/` has no snapshot past `0069_snapshot.json`. 80
migrations are committed and applied — `0070` through `0080` were written and
verified by hand (each carries a long rationale comment and was checked
against a live database before being committed), but `drizzle-kit generate`
was never run to produce the matching snapshot for any of them.

Confirmed nowhere in git history — `git log --all --oneline -- 'drizzle/meta/007*_snapshot.json' 'drizzle/meta/008*_snapshot.json'`
returns nothing on any branch. This is not something that regressed; it never
existed.

## Why this matters beyond CI

`drizzle-kit generate` diffs `schema.ts` against the *last snapshot*, not
against a live database. With the snapshot 11 migrations behind, it can no
longer tell a real rename from a drop-and-recreate, because the last shape it
knows for `tbl_entity_asset`/`tbl_entity_vehicle` predates several of the
column changes those tables have since had.

**Confirmed dangerous, not just wrong.** Running `pnpm generate` and
answering "renamed from asset" at the interactive prompt still produced:

```sql
ALTER TABLE "tbl_entity_asset" DISABLE ROW LEVEL SECURITY;
DROP TABLE "tbl_entity_asset" CASCADE;
```

`CASCADE` on that table reaches `tbl_ops_transaction` — the **append-only
ledger**, the system of record for every custody move in the product — plus
`tbl_ops_transfer`, `tbl_ops_smalltools_custody` and `tbl_ops_task`. Applied
anywhere, this migration destroys the ledger's FK chain and every row in the
small-tools register. It was generated locally, inspected, and deleted
without being committed or applied. **Do not run `pnpm generate` /
`make generate` against this repo until this gap is closed** — it will
reproduce the same file.

## What the real fix looks like

Someone who knows the exact intent of each migration needs to hand-author (or
very carefully drive the interactive wizard, verifying every prompt against
the migration SQL first) the missing snapshots `0070_snapshot.json` through
`0080_snapshot.json`, so that:

- `tbl_entity_vehicle → tbl_entity_equipment` (0075) and
  `tbl_entity_asset → tbl_entity_small_tool` (0076) are recorded as renames,
  not drop+create.
- Every subsequent column add/drop (0070, 0071, 0077, 0079) is layered on
  top of the correct post-rename table identity.
- The CHECK constraints added in 0072/0073/0074 and the unique indexes added
  in 0078/0080 are reflected.

Ground truth for what each migration actually did is in the migration files
themselves (`packages/db/drizzle/0070*.sql` through `0080*.sql`) — each one
carries a rationale comment written at the time, which is what let this
investigation determine that **no column was ever renamed** across this
range; every structural change was a table rename, a column add, or a column
drop. That fact should make hand-authoring the snapshots tractable, but it
still needs care: the wizard's "create" default for a same-named column that
was in fact untouched is only safe because nothing in 0070–0080 renamed one.

## Once repaired

1. Run `pnpm db:generate` locally against a clean checkout and confirm it
   reports "No schema changes, nothing to migrate" with zero files touched.
2. Flip `if: false` back to nothing (remove the line) on the
   "Check for uncommitted schema drift" step in `.github/workflows/ci.yml`.
3. Delete this file.
