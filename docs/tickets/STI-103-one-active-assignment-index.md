# STI-103 — Partial unique index for one-active-assignment

**Phase:** 1 — Custody trail
**Size:** 2 units
**Status:** READY
**Depends on:** STI-102 (must land first)

---

## Why this exists

`SYSTEM_PLAN.md` invariant 1 and §5 item 3. Verified true on 2026-08-16: the only
indexes on `assignment` are four non-unique btrees
(`packages/db/src/schema/asset.ts:120-125`, DDL at
`packages/db/drizzle/0000_wooden_blacklash.sql:852`). There is no unique constraint
and no partial index.

"At most one active assignment per asset" is the invariant the entire custody model
rests on, and `packages/api-contracts/src/custody.ts` is the only thing holding it —
a single file, bypassed at least once already by `assignment.approve`.

Precedent exists in this schema: `project_team_member`
(`packages/db/src/schema/employee.ts:102`) already uses a partial unique index for
its active row. Follow that pattern.

## Correction to the plan

`SYSTEM_PLAN.md` §5 item 3 says "duplicates already exist in live data", and
`custody.ts:37` repeats it. **Not true in the local database on 2026-08-16:**

```
select asset_id, count(*) from assignment where status='active' group by 1 having count(*)>1;
(0 rows)
```

754 assets, 754 assignments, one active row each. The backfill risk
`SYSTEM_PLAN.md` §6.1 warns about — "a per-tool judgement made with the Equipment
department, not a script" — **does not apply locally**.

It has **not** been checked against production. Run the same query there before
applying the migration. If production has duplicates, this ticket stops and becomes
a conversation with the Equipment department. Do not write a script that picks a
survivor.

## Acceptance criteria

1. A partial unique index exists on `assignment (asset_id) WHERE status = 'active'`,
   declared in the Drizzle schema so `drizzle-kit generate` emits it — not applied
   by hand.
2. The generated SQL actually contains the `WHERE` clause. Read the emitted
   migration and confirm.
   **Use a raw `sql` literal in the predicate, never `eq()`.** drizzle-kit 0.28.1
   turns `eq(t.status, 'active')` inside a partial index into a `$1` placeholder,
   which fails at migrate time with `ERROR: there is no parameter $1`. The existing
   `employee.ts:102` index uses raw `sql` for exactly this reason. See
   `STACK-NOTES.md`.
3. The index is tenant-correct. Decide explicitly whether the key is `(asset_id)` or
   `(tenant_id, asset_id)` and record the reasoning in a comment. `asset_id` is a
   uuid and already unique across tenants, so `(asset_id)` is likely right — but say
   why rather than leaving it implicit.
4. A test proves the constraint bites: attempting to open a second active assignment
   for one asset raises a database error.
5. Duplicate check run against **production** and the result recorded in the QA
   report before the migration is applied there.
6. `custody.ts`'s header comment is updated. It currently tells the reader duplicates
   exist in the wild and that this file is the only enforcement. After this ticket
   both halves are wrong, and that comment is load-bearing documentation.

## This index will break an existing test — that is expected

`packages/api-contracts/src/custody.test.ts` (added by STI-102) contains a
close-all-duplicates test that **deliberately fabricates two active assignment rows**
for one asset, then asserts `closeActiveCustody` closes both. It exists to pin the
close-by-predicate behaviour.

The moment this partial unique index lands, that fabrication becomes a constraint
violation and the test fails at setup.

**Do not delete the test, and do not weaken the index.** The behaviour it pins is still
correct — `closeActiveCustody` must still close every active row it finds, because
production data predating the constraint may still carry duplicates, and the index only
prevents *new* ones.

Rewrite the setup so it can still create the state the test needs. Options, in order of
preference:

1. Insert the duplicate with the constraint deferred, if it can be made `DEFERRABLE`.
2. Drop and recreate the index inside the test transaction.
3. Fabricate the second row with the index temporarily disabled, the same shape STI-104
   used for the seed.

Whichever you choose, say in a comment **why** the test fabricates a state the database
now forbids — otherwise the next reader will assume the test is obsolete and delete it.

## Approach

In `packages/db/src/schema/asset.ts`, alongside the existing index declarations:

```ts
uniqueIndex("assignment_one_active_uq")
  .on(t.assetId)
  .where(sql`${t.status} = 'active'`)
```

Then `make generate`, read the emitted SQL, commit it, `make migrate`. Never
`push-dangerous`.

## Files

- `packages/db/src/schema/asset.ts:104-126` — assignment table
- `packages/db/src/schema/employee.ts:102` — the partial-unique precedent to copy
- `packages/api-contracts/src/custody.ts:4-17,37-39` — comments to correct
- `SYSTEM_PLAN.md` §5 item 3 — correct the "duplicates already exist" claim
