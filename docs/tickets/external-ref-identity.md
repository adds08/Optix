# `external_ref`, `source` and `last_synced_at` identity columns

**Phase:** 4 — Foundation entity load
**Size:** 2 units
**Status:** BLOCKED by STI-401
**Blocks:** STI-403, STI-404

---

## Why this exists

`SYSTEM_PLAN.md` §6.4's redundancy strategy: three entry paths must converge on one
record. Every entity therefore carries `external_ref` (nullable, **unique per
system+type**), `source` (`foundation | import | manual`), and `last_synced_at`.

| Path | Identity rule |
|---|---|
| Synced from Foundation | `external_ref(foundation, type, native_id)` — authoritative |
| Imported from spreadsheet | matched on natural key, given an `external_ref` if one appears later |
| Added by hand | no `external_ref` until a sync adopts it, by natural-key match |

None of this exists. The nearest thing is a **plain, non-unique** `external_id` text
column on `employee` (`packages/db/src/schema/employee.ts:13`) and `project`
(`packages/db/src/schema/project.ts:9`), with no system or type qualifier — it cannot
express the rule, and its non-uniqueness means it cannot even prevent duplicates.

## Acceptance criteria

1. The three columns on every entity STI-401 confirms is in scope.
2. **`external_ref` unique per (system, type)** — enforced by a database index, not by
   application code. Idempotency is the whole point of Phase 4; without the
   constraint, a re-run duplicates and only a code review would catch it.
3. `source` constrained to `foundation | import | manual`, defaulting to `manual`.
4. A migration path for the existing `external_id` columns: adopted into the new
   scheme or dropped. Do not leave both — two identity columns is worse than none,
   because a reader cannot tell which is authoritative.
5. Existing rows get a truthful `source`. Seeded and imported rows are **not**
   `foundation`, and marking them so would make the loader skip them forever.
6. The three-path table above is written as a comment next to the columns. This is a
   rule future writers must follow and it will not survive in a ticket file.
7. Migration generated with `make generate`, SQL read and committed.

## Watch for

`employee.externalId` is commented as a "seam for future sync" and
`project.externalId` is described in the UI as the **cost code**
(`apps/web/app/(app)/projects/page.tsx:22`). Those are two different meanings for the
same column shape. Resolve which per STI-401 question 3 before migrating either — a
wrong adoption here silently destroys the cost code.

## Files

- `packages/db/src/schema/employee.ts:13`, `packages/db/src/schema/project.ts:9`
- `apps/web/app/(app)/projects/page.tsx:22` — the cost-code claim
