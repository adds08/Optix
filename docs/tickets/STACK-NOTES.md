# Stack notes — verified facts that change how Release 1 tickets are built

Researched 2026-08-16 against the pinned versions in this repo, not against general
knowledge. Every agent working a ticket should read this first.

## The versions are not what the docs assume

| Commonly assumed | Actual in this repo |
|---|---|
| node-postgres (`pg`) | **postgres.js** — `packages/db/src/index.ts` uses `drizzle-orm/postgres-js`. No `pg` dependency exists. |
| Next.js 15 | **Next 16.3**, React 19.2 (`apps/web/package.json`) |
| current drizzle | **drizzle-orm 0.36.4 / drizzle-kit 0.28.1**, journal `version: 7` |
| Vitest 3 | **Vitest 2.1.5** — `test.projects` does not exist in v2 |
| Playwright present | **not installed** — no config, no dependency |

Consequences: drizzle docs showing `drizzle/<ts>_name/migration.sql` folders describe
a layout this repo does not use — it produces flat `drizzle/0012_name.sql` plus
`drizzle/meta/`. Ignore those examples.

## Transactions — postgres.js specifics

- Callback form; the return value propagates and any throw rolls back.
  `tx.rollback()` throws by design — do not swallow it in a `try`.
- `.for('update')` exists but is **undocumented** on the pg docs page. Signature:
  `for(strength, config?)` with `strength: 'update' | 'no key update' | 'share' | 'key share'`.
  `noWait` and `skipLocked` are mutually exclusive at the type level.
- Nested `tx.transaction(...)` produces **real savepoints** on postgres.js — so
  threading `tx` into `custody.ts` is safe either way, but explicit threading stays
  the clearer choice.
- For a ledger + projection write, `'read committed'` plus `FOR UPDATE` on the asset
  row is the correct cheap option. `'serializable'` obliges you to handle 40001
  retries.
- **postgres.js pins one pool connection per transaction (`max: 10`).** Never await
  an LLM call inside `db.transaction` — the chat/intent path makes this a live risk.

## Partial unique indexes — the pattern already works here

`uniqueIndex(...).on(...).where(sql\`...\`)` is emitted correctly by drizzle-kit
0.28.1. Proven in this repo: `packages/db/src/schema/employee.ts:102` generates
`packages/db/drizzle/0008_spotty_mandrill.sql:43` with an intact `WHERE` clause.

**The gotcha is `eq()`, not `.where()`.** Using `eq(t.col, true)` inside a partial
index predicate makes drizzle-kit emit a `$1` placeholder, producing
`ERROR: there is no parameter $1` at migrate time. Use raw `sql` with a literal —
which is exactly what the existing schema does. Copy that pattern.

## Hand-written migrations

Use `drizzle-kit generate --custom --name=<name>`. It creates an empty `.sql` **and**
the matching `_journal.json` entry. Never hand-edit `_journal.json`; never rename a
`.sql` after generating.

Precedent in this repo: `0005_department_model_split.sql` and
`0009_backfill_team_rows.sql`.

Custom migrations do not touch the snapshot, so triggers and grants are invisible to
the differ and will never be dropped by a later `generate`. That is correct — and it
is another reason `push-dangerous` stays dangerous.

## Ledger immutability — trigger, not REVOKE

Postgres treats an owner as holding all grant options, and a superuser executes
GRANT/REVOKE *as* the owner. This app connects as the table owner on a single
`DATABASE_URL`, so `REVOKE UPDATE, DELETE` is decoration. A `BEFORE UPDATE OR DELETE
... FOR EACH ROW` trigger raising an exception fires for every role including
superuser, and is the only mechanism that does.

Use `ERRCODE = '0A000'` so the failure is classifiable rather than generic.

**Budget for this breaking the seed and reset scripts the moment it lands.** Seeding
will need `ALTER TABLE ... DISABLE TRIGGER` around it. `TRUNCATE` is only blocked if
you add a separate `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger.

Honest limit: the owner can `ALTER TABLE ... DISABLE TRIGGER`. This is a correctness
guard, not a security boundary. A real boundary needs a separate non-owner app role,
which is a deployment change outside Release 1.

## tRPC errors

`errorFormatter` runs once at `initTRPC.create()`, and whatever it puts in `data` is
inferred on **both** clients — that is the mechanism for typed domain errors. Always
preserve `cause`; never re-throw a bare `Error` out of a domain package.

Remember the `/api/*` REST surface bypasses this entirely — no formatter, and no
permissions.

## Next.js error boundaries — resolved (STI-205)

Verified against the installed `next@16.3.0`
(`node_modules/next/dist/client/components/error-boundary.d.ts`): `error.tsx` and
`global-error.tsx` receive `{ error, reset, retry }` — **both** props exist.
`reset()` only clears boundary state (`setState({ error: null })`), so a failure
that came from the server render throws again immediately; `retry()` wraps a
`router.refresh()` plus the reset in a transition, so Server Components re-fetch.
Both boundaries now destructure `retry`.

What the boundaries do **not** catch, in any version: event handlers, async callbacks
after render, and Route Handler errors — the last are returned as a bare `500` and
never reach a boundary.

## Playwright

- Drive the **external Docker stack**; do not let `webServer` boot a competing dev
  server. Mixing the two is the usual source of flake.
- Auth via a `setup` project plus `storageState`, one file per role, not
  `globalSetup`. Project dependencies give retries and traces.
- **Database determinism is constrained by the append-only trigger.** Per-test
  transaction rollback is unavailable across the HTTP boundary, and truncating
  `transaction` requires disabling the trigger. Use a template-database restore
  (`CREATE DATABASE ... TEMPLATE stinventory_seed`) with a database per worker.
  *This recommendation is not from Playwright's docs — treat it as a design proposal
  to validate, not received wisdom.*
- `retries: CI ? 2 : 0`, `trace: 'on-first-retry'`, `forbidOnly: !!CI`.

## Vitest / Turbo

- On 2.1.5 use a root `vitest.workspace.ts`. `test.projects` needs Vitest 3 —
  worth upgrading **before** adding DB-integration tests.
- Five packages declare `"test": "vitest run"` with no config file at all. `apps/*`
  and `packages/db` declare no test script, so nothing there gates a merge.
- Integration tests need `isolate: true` and either `singleThread` or a database per
  worker. Parallel workers against one Postgres is the classic flake.
- For affected-only CI use `turbo run test --filter=...[origin/main]`, **not**
  `--affected`. Only the filter form pulls in dependents, and `packages/domain` feeds
  `api-contracts` which feeds both apps.
