---
paths:
  - "packages/db/**"
---

# Schema, migrations and the seed

Every table carries `tenant_id` except **four**, and each exception is deliberate
(PR #6 review asked what `tenant_id` is for — this is the answer):

| Table | Why it has none |
|---|---|
| `tenant` | It *is* the tenant |
| `permission` | Global vocabulary. `asset.manage` must mean the same thing everywhere; tenanting it would let two tenants disagree about what a permission is |
| `role_permission` | Join table — the tenant is carried by `role.tenant_id` |
| `user_role` | Join table — the tenant is carried by both parents |

A join table does not get a fourth copy of a fact its parents already hold; that is a way
for the copies to disagree, not extra isolation. **`role` itself IS tenant-scoped**, with a
nullable `tenant_id` where null means a system role shared by all tenants.

`schema/index.ts` is the authoritative list. To re-check the claim rather than trust it:

```sql
select t.table_name from information_schema.tables t
where t.table_schema='public' and t.table_type='BASE TABLE'
  and not exists (select 1 from information_schema.columns c
                  where c.table_schema='public' and c.table_name=t.table_name
                    and c.column_name='tenant_id');
```

`tenant_id` is **not** Release 1 work and was never added by it — it is in
`0000_wooden_blacklash.sql`, from the design rule in `docs/02-saas-architecture.md`:
*build single-tenant-shaped but multi-tenant-ready from day one*. What Release 1 added is
the `WHERE` clause that uses it, plus one unique index (`user_tenant_email_uq`, `0018`).

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
- **`assignment.truck_id`/`trailer_id` are type-checked by composite FKs** (STI-202,
  migration `0016`): `(truck_id, truck_kind)` references `UNIQUE vehicle(id, vehicle_type)`
  where `truck_kind` is a generated constant `'truck'` (likewise trailer) — a plain FK cannot
  say "must be a truck" when both columns point at the same table. Consequence: deleting a
  vehicle, or flipping its `vehicle_type`, fails with an FK error while any assignment row
  — active, closed or historical — references it; the friendly guards in front of that raw
  error live in `vehicle.delete`/`vehicle.update` (STI-203). The columns themselves stay
  nullable; `NULL` skips the check (MATCH SIMPLE). The FK is also **tenant-blind** —
  `vehicle_id_type_uq` has no tenant column — so every truck/trailer lookup must carry its
  own tenant predicate (`assertVehicleContext` in `custody.ts`).
  Never read or write `truck_kind`/`trailer_kind` — they exist only so the FK can be written.
- **`assignment` carries one partial unique index**, `assignment_one_active_uq` on
  `(asset_id) WHERE status = 'active'` (STI-103, migration `0015`). It blocks a *second active*
  row and nothing else — `pending_approval` rows are uncovered, and rows written before the
  index may still carry duplicates. Closing the previous row is still application code only —
  see `.claude/rules/custody-and-ledger.md`.
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

Since STI-108 the seed emits a **complete `to_state`** (the four core keys, plus explicit
`truckId`/`trailerId` since STI-202 — `truckId` null on every source row because the sheets
carry no trucks; **two** clearly-synthetic seed trucks exist solely so the truck path is
reachable — one `company_owned`, one `personal_allowance` so the company-vs-personal
marker is reachable too; see their `vehSpecs` comments) on every ledger event,
derived from the same `assetSpecs` entry that sets `asset.current_*` — so a fresh database
folds to its own projection by construction, `asset.rebuild` actually rebuilds, and
`asset.verifyProjection` reports zero divergences. (Before STI-108 every seeded row carried
`to_state: null`, the fold was a no-op, and the boot sweep raised one `custody_discrepancy`
per asset. Migration 0013 repaired that once, but its `NOT EXISTS` guard never re-runs — the
seed is what keeps it fixed across resets.) If you add seeded events, snapshot every key
with explicit nulls — the four core keys plus `truckId`/`trailerId`; a missing core key is
not "unchanged", it is blanked on the next rebuild, and a missing truck/trailer key folds to
"not recorded" rather than "none" (see the shape-boundary rule in
`packages/domain/src/fold.ts`) — and never emit `projection_baseline`, which exists only to
compensate for pre-snapshot history.

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
