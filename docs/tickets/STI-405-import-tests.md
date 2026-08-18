# STI-405 — Tests for the spreadsheet import

**Phase:** 4 — Foundation entity load
**Size:** 1 unit
**Status:** READY
**Depends on:** nothing

---

## Why this exists

`SYSTEM_PLAN.md` §5 calls the import *"genuinely good: typed validation, dedup,
preview, transactional commit"* — and then **"No tests."** Verified 2026-08-16: true.
There is no `import*.test.ts` anywhere.

This is the best-built untested code in the repo, and it is about to become
load-bearing: STI-403's Foundation loader reuses its transactional pattern, and the
one-time entity load runs through this class of code. Tests here are worth more now
than they were when it was written.

## What exists

- `packages/api-contracts/src/routers/import.ts` (389 lines) — `preview` and `commit`,
  all-or-nothing transaction, rationale at `:16-30`, entities at `:32` (asset,
  employee, project, location, vehicle)
- `packages/types/src/import-specs.ts` (219 lines) — column specs
- `apps/web/components/import-dialog.tsx` (320 lines) — the UI

## Acceptance criteria

1. Tests for the **validation layer** in `packages/types` — it is pure and needs no
   fixtures, so there is no excuse. Cover each column spec: required, type coercion,
   and rejection.
2. Tests for **dedup**: the same row twice within one file, and a row matching an
   existing record.
3. Tests for **preview equals commit** — the preview must predict exactly what commit
   does. A preview that lies is worse than no preview, and nothing currently pins the
   two together.
4. A test that a **failed row rolls back the whole commit**. This is the property
   `:16-30` explains and the one most likely to break under later change.
5. At least one test per entity at `:32`.
6. Real fixture files, kept small. Do **not** commit seeded-data fixtures or one-off
   verification scripts — `CLAUDE.md` says they rot; use `scratch/` for anything
   exploratory and commit only what the tests need.
7. Runs in `pnpm test` and gates CI.

## Note

`packages/api-contracts` has a `test` script and one existing test file
(`apply-action.test.ts`). Router-level tests may need a database. If so, that is an
integration-test decision — see `STACK-NOTES.md` on Vitest 2.1.5, `isolate: true`,
and a database per worker. Prefer pushing as much as possible into the pure
`packages/types` layer, which needs none of that.

## Files

- `packages/types/src/import-specs.ts` — the pure layer, test first
- `packages/api-contracts/src/routers/import.ts:16-30,32,269`
