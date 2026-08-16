---
paths:
  - "packages/db/**"
---

# Schema, migrations and the seed

Every table is tenant-scoped except `permission` and `role_permission`, which are global.
`schema/index.ts` is the authoritative list.

## Migrations, never push

```bash
make generate    # drizzle-kit generate → writes SQL into packages/db/drizzle/
# review and COMMIT the generated .sql
make migrate     # apply
```

The API container migrates on boot and refuses to serve if it fails. `push` is deliberately
named **`push-dangerous`** — it diffs a live database and applies with no review and no
record. Do not reach for it because a migration is inconvenient.

## The database enforces less than you think

- **One exception — the ledger is append-only by trigger.** `0014_append_only_ledger.sql`
  (STI-104) blocks UPDATE, DELETE and TRUNCATE on `transaction` with SQLSTATE `0A000`.
  Corrections are compensating INSERTs. It is a correctness guard, not a security
  boundary — the owner can `DISABLE TRIGGER`, which is exactly what the seed's
  `SEED_RESET` wipe does around its deletes.
- **Enums are not Postgres enums.** Every status/type column is plain `text`; the vocabularies
  live in `packages/types`. The database will *not* stop you writing a value you forgot to
  add. Validate at the router edge with Zod, and use `z.enum(...)` rather than `z.string()`.
- **`assignment` has no unique constraint.** "One active assignment per asset" is application
  code only — see `.claude/rules/custody-and-ledger.md`.
- **No RLS, no policies, no session tenant context.** Multi-tenancy is the correctness of
  every individual `WHERE` clause.
- **No `relations()` are defined anywhere.** `db.query.X.findFirst` works because the schema
  map is passed to `drizzle()`, but `with:` eager loading is unavailable — every join is a
  hand-written `leftJoin`/`innerJoin`.
- Missing unique constraints worth knowing about: `user.email`, `asset.tag`,
  `asset.serial_number`, `channel.slug`, `rental_order.external_number`, `vehicle.location_id`,
  `tenant_settings.tenant_id`.

## The seed

`SEED_RESET=1` wipes first. The seed refuses to run with `NODE_ENV=production`.

Since STI-108 the seed emits a **complete four-key `to_state`** on every ledger event,
derived from the same `assetSpecs` entry that sets `asset.current_*` — so a fresh database
folds to its own projection by construction, `asset.rebuild` actually rebuilds, and
`asset.verifyProjection` reports zero divergences. (Before STI-108 every seeded row carried
`to_state: null`, the fold was a no-op, and the boot sweep raised one `custody_discrepancy`
per asset. Migration 0013 repaired that once, but its `NOT EXISTS` guard never re-runs — the
seed is what keeps it fixed across resets.) If you add seeded events, snapshot all four keys
with explicit nulls — a missing key is not "unchanged", it is blanked on the next rebuild —
and never emit `projection_baseline`, which exists only to compensate for pre-snapshot
history.

The seed also has to **reach the rules it gates** (CLAUDE.md behaviour rule 8): some assets
carry an `acquisition_cost` at, just below, and above the tenant's `highValueThreshold`
(including one at exactly the threshold, because the rule is `>=`), most stay null (imported
rows routinely have no price; null counts as 0), and one pending assignment plus one pending
transfer keep the desk approval queue non-empty on a clean reset. See `SEED_COSTS` and the
desk-queue block in `src/seed.ts`.

## Conventions

- Physical names are snake_case singular; Drizzle exports are camelCase.
- `asset_model` / `manufacturer` / `asset.model_id` are **vestigial** — nothing reads or
  writes them (see the comment at `schema/asset.ts:24-30`). Don't build on them.
- `asset.tag` is nullable by design — a tag is a physical label, not a system id.
- `photo_key` stores an object key, never a URL, so the storage host isn't baked into rows.
- A new workspace dependency may need a line in `docker/Dockerfile.dev`'s COPY list *and* an
  anonymous volume in `docker-compose.yml`.
