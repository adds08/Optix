# STI-115 — `asset.create` is not transactional

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** READY
**Found by:** the STI-110 implementer on 2026-08-18, while establishing whether a
no-evidence divergence can arise. Independently confirmed by the lead by reading
`packages/api-contracts/src/routers/asset.ts:206-227`.

---

## Why this exists

`asset.create` writes the asset row and its opening `tag` ledger event as **two separate
awaits on `ctx.db`**, with no `db.transaction` around them:

```ts
const [row] = await ctx.db.insert(schema.asset).values({ … }).returning();
if (row) {
  await ctx.db.insert(schema.transaction).values({ … eventType: "tag" … });
```

A failure between those two statements leaves an asset that **exists with a projection
but has zero ledger rows** — the "no evidence" state STI-110 describes, produced by a
legitimate application path rather than by an out-of-band edit.

This matters more than it looks, because the ledger is append-only by trigger (STI-104).
The asset cannot acquire its missing opening snapshot retroactively. The only exits are a
new genuine custody event or an STI-101-style backfill, and STI-110's sweep will report
the asset as `no_evidence` every six hours until then.

## The fix is already the house pattern

The importer does this correctly — `packages/db/src/import.ts:318` inserts the asset and
its opening event inside the same `tx`. STI-102 did the same for every custody procedure.
`asset.create` is the straggler.

## Acceptance criteria

1. `asset.create` wraps the asset insert and the opening `tag` event in one
   `db.transaction`, so either both land or neither does.
2. The audit-log write is considered too — decide whether it belongs inside the
   transaction and say why. (An audit entry for an asset that does not exist is its own
   small lie, but audit logging failing must not roll back a legitimate create.)
3. The opening `tag` event still carries a **complete** four-key `toState`. It does today;
   do not regress it while moving code.
4. A test proving the two writes are atomic — force the ledger insert to fail and assert
   no orphan asset row survives. It must be shown to fail before the fix (red), then pass.
5. Check the same shape elsewhere: grep for other procedures doing `insert(schema.asset)`
   or a projection write followed by a separate ledger insert on `ctx.db`. Report what you
   find; fix only what this ticket names.

## Related

- **STI-116** — the REST `POST /api/assets` writes an asset with no ledger event at all,
  which is the same class of defect but larger.
- **STI-110** — the divergence sweep that reports the resulting asset forever.

## Files

- `packages/api-contracts/src/routers/asset.ts:206-227` — the create procedure
- `packages/db/src/import.ts:318` — the correct pattern to copy
