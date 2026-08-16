# STI-104 — Enforce ledger append-only at the database

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY
**Depends on:** nothing — run in parallel with STI-102

---

## Why this exists

`SYSTEM_PLAN.md` invariant 2 and §5 item 4. Verified true on 2026-08-16: grepping
all 13 files in `packages/db/drizzle/` for `REVOKE`, `CREATE TRIGGER`, `CREATE RULE`,
`BEFORE UPDATE` and `BEFORE DELETE` returns **zero matches**. Confirmed against the
live database — `select tgname from pg_trigger where tgrelid='transaction'::regclass
and not tgisinternal` returns no rows.

The only thing asserting immutability is a source comment at
`packages/db/src/schema/event.ts:6-7`. The ledger is the system of record for a
custody chain that has to stand up as evidence when a tool goes missing. A comment
is not a control.

## Why a trigger, not `REVOKE`

`SYSTEM_PLAN.md` §6.1 proposes:

```sql
REVOKE UPDATE, DELETE ON ledger_event FROM app_role;
```

Two problems, both verified:

1. There is no `app_role` in this system. The application connects as `postgres`
   (`Makefile:107` — `psql -U postgres`), which is the **table owner**.
2. **A table owner bypasses `REVOKE` on its own table.** Postgres grants owners
   implicit privileges; revoking from the owner does not stop the owner. The
   statement would apply cleanly, appear to work, and enforce nothing.

A `BEFORE UPDATE OR DELETE` trigger raising an exception applies to the owner too,
and to superusers. Use the trigger. Introducing a separate least-privilege app role
is the more correct long-term answer, but it is a deployment change well outside
this ticket — note it as follow-up, do not do it here.

## Acceptance criteria

1. `UPDATE transaction SET note = 'x'` raises an error. Prove it with real psql
   output in the QA report.
2. `DELETE FROM transaction` raises an error. Same.
3. `INSERT INTO transaction` still succeeds — the app must keep working. Run the
   full test suite and exercise a custody move in the browser.
4. The error message names the invariant, so the next developer who hits it
   understands immediately rather than assuming a bug.
5. Shipped via `drizzle-kit generate --custom --name=append_only_ledger`, which
   creates the `.sql` **and** its `_journal.json` entry. Never hand-edit the journal.
6. `TRUNCATE` is considered. A `BEFORE` row trigger does not fire on `TRUNCATE`;
   either add a statement-level truncate trigger or state in a comment why the risk
   is accepted.
7. **`make ENV=local reset` and the seed still work.** This is the acceptance
   criterion most likely to be missed — see below.

## Approach

```sql
create or replace function transaction_append_only() returns trigger as $$
begin
  raise exception
    'transaction is append-only: % blocked. The ledger is the system of record; corrections are compensating events.',
    tg_op;
end;
$$ language plpgsql;

create trigger transaction_no_update_delete
  before update or delete on "transaction"
  for each row execute function transaction_append_only();
```

`transaction` is a reserved word — quote it consistently. Set
`USING ERRCODE = '0A000'` so callers can classify the failure instead of matching on
message text.

## This will break seeding — budget for it

The seed and `make ENV=local reset` paths delete and rewrite ledger rows. The moment
this trigger lands they start failing. The fix is to wrap the seed in
`ALTER TABLE "transaction" DISABLE TRIGGER transaction_no_update_delete` / `ENABLE`,
not to weaken the trigger.

This is part of the ticket, not a follow-up: a change that makes the standard local
reset fail is not done.

## Honest limit

A table owner can `ALTER TABLE ... DISABLE TRIGGER`. This is a correctness guard
against accidental writes, **not** a security boundary against a determined actor.
Neither is `REVOKE`. A real boundary needs a separate non-owner application role,
which is a deployment change outside Release 1 — record it as follow-up and say so
in the migration comment rather than implying more protection than exists.

## Interaction with STI-101

STI-101 backfills by **inserting** compensating rows, never by updating, so the two
are compatible in either order. If STI-104 lands first, STI-101's migration must not
contain an `UPDATE transaction`; that is already its stated design, and this trigger
becomes the thing that enforces it.

## Files

- `packages/db/src/schema/event.ts:6-7` — the comment this replaces with a control
- `packages/db/drizzle/` — new hand-written migration
- `packages/db/drizzle/meta/_journal.json` — must stay consistent
