# Every table says which half of the business it belongs to

`tbl_entity_*` for registers, `tbl_ops_*` for things that happen to them. All 37
tables, 99 foreign keys and 2 composite primary keys, renamed in place with the
data untouched.

The convention was asked for directly. I argued against the `tbl_` prefix — it is
Hungarian notation, and Postgres schemas are the native mechanism for the split —
and was overruled, which is the right of whoever owns the database. What follows
is the execution, and the two traps found on the way.

## What changed

**Entity** — a thing the business keeps a record of: `tenant`, `user`, `role`,
`permission`, `role_permission`, `user_role`, `session`, `auth_token`,
`user_preferences`, `tenant_settings`, `employee`, `employee_contact`,
`company_role`, `department`, `project`, `project_group` (+ its two join
tables), `asset`, `asset_model`, `manufacturer`, `category`, `location`,
`warehouse`, `vehicle`, `unit_of_measure`, `uom_category`.

**Ops** — something that happens to one: `transfer`, `transaction`, `event_log`,
`employee_project_assignment`, `project_team_member`, `task`, `notification`,
`message`, `channel`, and `assignment`, which became
**`tbl_ops_smalltools_custody`** — the one table given a new base name rather
than just a prefix, because that was the example in the request and `assignment`
alone never said what was being assigned.

Base names are otherwise unchanged. The prefix is one change; renaming
`vehicle` to `equipment` or `asset` to `smalltools` is a second, and mixing them
would make a mechanical diff into a judgement call on 37 rows at once.

## What was found while building it

**`drizzle-kit generate` cannot do a rename unattended, and fails dangerously.**
It prompts — "is this table created, or renamed from X?" — and with no terminal
answering it simply hangs. Left to time out in a script it would have emitted
DROP + CREATE for every table, which on a database holding 756 tools and a
754-row append-only ledger is not a migration, it is a deletion. Both the
migration and its snapshot are hand-written for that reason, and the file says so.

**Drizzle diffs foreign keys on their NAME, which is derived from the table
name.** Verified rather than assumed, with a one-table trial: leaving the old
constraint names in place made `generate` want to drop and recreate every FK,
forever. So the constraints had to move too — 99 of them. Four are explicitly
named in the schema (`assignment_truck_fk` and friends) and were left alone,
because an explicit name is not derived and does not drift.

**22 of the new constraint names exceed Postgres's 63-byte identifier limit.**
This is the trap the prefix creates and it is worth stating plainly: an FK name
is `{from}_{cols}_{to}_{cols}_fk`, so prefixing puts the prefix in *twice*. The
longest here needs 80 bytes. Postgres does not error — it truncates and emits a
NOTICE, which is exactly the kind of silence that produces a database and a
schema file that quietly disagree forever.

It was checked instead of hoped:

- truncation is consistent, and later DDL naming the long form resolves to the
  same identifier — tested directly with a throwaway table
- **no two of the 22 truncate to the same 63 bytes**, so nothing collides
- `drizzle-kit generate` now reports "No schema changes, nothing to migrate",
  which is the real proof that schema, snapshot and database agree

**Index predicates carry the table name too.** The four partial unique indexes
qualify their `WHERE` with it, and one unique constraint name is derived from a
column `.unique()`. Those became migration 0030, drop-and-recreate because an
index predicate cannot be altered in place. One of them is
`assignment_one_active_uq`, the backstop against a tool having two custodians —
it is dropped and recreated inside the same migration, so there is no window.

**A test flaked once, and was hardened rather than re-run until green.**
`tool-accountability.spec.ts` failed on the first full pass after a reseed and
passed alone and on every pass since — a cold API exceeding the 5s default. It
now waits on the shell's ready signal first, like the older specs already did.

## Verified

- Row counts identical across the rename: **756 assets, 45 people, 754 ledger
  rows, 755 custody rows, 19 roles** — before and after.
- `pg_dump` taken before touching anything.
- `drizzle-kit generate`: no diff.
- `make test` in the api container: 433 tests, nothing skipped.
- A full `SEED_RESET=1` reseed from empty, which is what actually proves nothing
  still names an old table.
- 33 browser tests across five roles.
- The triggers on the ledger (`transaction_no_update_delete`,
  `transaction_no_truncate`) and all three partial unique indexes survived and
  sit on the renamed tables — checked in `pg_catalog`, not assumed.
- 32 raw `ALTER TABLE "transaction"` statements across 13 test files, updated.

## Deliberately not done

**Constraint names were not shortened to fit.** Fixing the 63-byte overflow
properly means naming all 103 foreign keys explicitly in the schema, converting
every inline `.references()` to a `foreignKey()` builder. That is a far larger
and more error-prone diff than the rename itself, and truncation is provably safe
here. If a future table name pushes two constraints into the same 63 bytes, this
is the note that explains why it happened and what the fix is.

**`vehicle` and `asset` keep their base names** — see above.

**Postgres schemas were not used.** They are the native mechanism for this split
and remain the upgrade path if the boundary should ever be enforced rather than
merely described.

## Where it is

Migrations `0029_table_naming_convention.sql` and
`0030_rename_index_predicates.sql`, both applied locally. Not deployed — and
worth saying out loud: **this migration renames every table in the database**, so
the API and web images must be deployed together with it, not before.
