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

## The tenant predicate: the rule, and its two exceptions (STI-119)

CLAUDE.md non-negotiable 3 — *every query carries `eq(table.tenantId, tid)`* — is now a
rule you can check rather than one you have to reason about.
`packages/api-contracts/src/tenant-predicate.test.ts` scans **both** `packages/api-contracts/src`
and `apps/api/src` and fails the build on a write to a tenant-scoped table with no tenant
predicate.

It found nineteen in the routers and four in `apps/api`. **None was exploitable** — each sat
behind a tenant-scoped check-then-act, a `findFirst` that threw NOT_FOUND before the write.
That is safe, and it is not the same as checkable: it means a reader has to trace back to a
guard several lines up to know that `DELETE ... WHERE id = $1` is not a cross-tenant delete.
All twenty-three now carry the predicate.

**Write the predicate even when an upstream check already makes it redundant.** The
redundancy is the point — it is what makes the rule greppable, and a grep is what catches
the twenty-fourth.

### The two exceptions, and why they are not arbitrary

**1. Background workers** (`messaging-worker.ts`, `request-worker.ts`, `notifications.ts`).
A worker has no session and therefore no tenant. It claims rows off a tenant-agnostic queue
across every tenant, then writes back to the ids it just claimed. There is nothing to put in
`eq(message.tenantId, ???)`, and a worker filtered to one tenant would stop serving the
others. Safe because the worker never takes an id from a user, and the row carries its own
`tenantId` into everything downstream. Exempted **per file** in the test, with the reason,
because it is a property of the file — it is a worker — not of any one statement.

**If a worker ever grows a route or procedure that takes a caller-supplied id, that
reasoning stops applying** and its exemption must be narrowed rather than inherited.

**2. The login user lookup** (`apps/api/src/index.ts`). Login is where the tenant is
*decided*, so there is no tenant in scope to scope by: `result.tenantId` is an output of the
credential check, not an input to it. Scoping there would be asking the row whether it is
the row we just got it from. Isolation happens inside `login()`, which since STI-305 either
scopes by `tenantSlug` or **refuses** an ambiguous address rather than picking a row. It is
a read, so the scan never reaches it; the reason is written at the call site.

**Nothing under `routers/` may ever be exempt** — a router has a session, so it can always
scope. The test asserts that too.

## Migrations, never push

```bash
make generate    # drizzle-kit generate → writes SQL into packages/db/drizzle/
# review and COMMIT the generated .sql
make migrate     # apply
```

The API container migrates on boot and refuses to serve if it fails. `push` is deliberately
named **`push-dangerous`** — it diffs a live database and applies with no review and no
record. Do not reach for it because a migration is inconvenient.

### Seed data needs migrations too — this has now cost three tickets

`permission`, `role` and `role_permission` are written by the **seed**, and the seed only
ever runs against a fresh database. So every edit to `PERMISSIONS` (`packages/types`) or to
`role-perms.ts` reaches every dev machine and **no live one**. `role-perms.ts` grants
`owner` and `equipment_admin` `[...PERMISSIONS]`, and a spread is evaluated at seed time —
it does not mean "always everything", it means "everything as of the day this database was
created".

Urban's production database was seeded on 2026-07-28. Three separate migrations exist only
to repair what that gap left behind:

- `0020` — the four `assets.view.*` scopes. Without it every user saw an empty register,
  because `viewTierOf` resolves an actor holding no scope to "none", which is empty and not
  unscoped.
- `0025` — `user.manage`. Without it `/admin/users` was gated on a permission nobody held,
  the owner account included.
- `0038` — the four project-team permissions, still ungranted because 0020's own
  owner/equipment_admin backfill covered only the `assets.view.*` scopes; **and** the
  retired `rental.*` grants, which deadlocked `/admin/roles` outright (`role.list` returned
  a name `permissionEnum` no longer accepts, so every Save failed with a Zod error the
  formatter renders as a generic message).

**So: adding a permission means a migration granting it. Retiring one means a migration
deleting its rows.** Neither is optional, and the tests will not catch you —
`rbac-matrix.test.ts` asserts a **freshly seeded** tenant matches `role-perms.ts`, which is
exactly the database that was never broken. Write the grant as a
`SELECT ... FROM tbl_entity_permission` where the source of truth is a spread, so the
statement says the same thing the code says instead of naming that day's list.

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
- Missing unique constraints worth knowing about: `user.email`, `asset.code`,
  `asset.serial_number`, `channel.slug`, `vehicle.location_id`,
  `tenant_settings.tenant_id`.

## Provisioning (there is no seed)

The seed was **deleted on 2026-09-13**. It invented business data and that data
became the thing everyone reasoned from: tool codes Urban never had (their
sheets carry no tool-ID column, so every `TOOL-0001` was minted at seed time),
31 of 88 vehicles loaded with the other 57 dropped silently, and a project list
with eight jobs called "Job 24002". Data that is approximately right is worse
than an empty register, because nothing on screen says which rows to trust.

**`make provision` replaces it, and is not the same kind of thing.** It writes
the authority model and nothing else:

| Writes | From |
|---|---|
| tenant | `TENANT_NAME` / `TENANT_SLUG`, defaulting to Urban |
| permissions | `PERMISSIONS` (`packages/types`) |
| roles + grants | `roleSpecs` + `ROLE_PERMS` |
| job tiers + "Set by" edges | `teamRoleSpecs` |
| categories, UoM, departments | `tenant-config.ts` |
| two logins | `tech@optixtec.com` (tech_admin), `optix_it@optixtec.com` (owner) |

No employees, jobs, tools, vehicles or custody. Those come from the importers
(`docs/import/README.md`) and the BambooHR sync.

Idempotent: every write is `onConflictDoNothing` or an existence check, it never
deletes, and it never changes an existing account's password. `make reset` runs
it after migrating, so a wiped database is immediately usable.

`packages/db/src/tenant-config.ts` is the input — the vocabularies and the
authority model, which is configuration rather than data. The Urban tier ladder
in it came from the client on 2026-09-09; **the 18 roles did not** — they were
assumed by the seed's author and are a candidate for redefinition with the
client.

### Permission changes still need a migration

Unchanged by any of the above, and it has cost three tickets. `permission`,
`role` and `role_permission` are written by provisioning, which only fills gaps —
so an edit to `PERMISSIONS` or `role-perms.ts` reaches a fresh database and **no
live one**. `role-perms.ts` grants `owner` and `equipment_admin`
`[...PERMISSIONS]`, and a spread is evaluated when it runs: it does not mean
"always everything", it means "everything as of the day this database was
provisioned".

Migrations `0020`, `0025` and `0038` exist only to repair that gap on Urban's
production database. **Adding a permission means a migration granting it;
retiring one means a migration deleting its rows.** The tests will not catch
you — `rbac-matrix.test.ts` builds its own tenant from the current constants,
which is exactly the database that was never broken. Write the grant as a
`SELECT ... FROM tbl_entity_permission` so the statement says what the code says
rather than naming that day's list.

### The ledger trigger

`0014_append_only_ledger.sql` blocks UPDATE/DELETE/TRUNCATE on `transaction`
with SQLSTATE `0A000`. `packages/db/sql/empty-register.sql` disables it around
its deletes and re-arms it — that is the one sanctioned exception, and the
script is the only thing that does it now the seed's wipe is gone.

## Conventions

- **`code` vs `external_id` — one word for one idea.** A **`code`** is the
  COMPANY's own identifier: Urban assigns it, and the same value means the same
  thing in every system they run (`employee.code` = `URB-001`,
  `project.code` = `22018`, `asset.code` = `TOOL-0001`, `vehicle.code`). An
  **`external_id`** is a FOREIGN system's primary key — BambooHR's `4471` — and
  it never lives on the entity: it goes in an external-ref child table
  (`tbl_entity_employee_external_ref`), because one column holds exactly one far
  system and this codebase already names three. Extra identifiers are their own
  fields, not overloads of either: `asset.asset_number` is the database's own
  sequence, `asset.serial_number` is the MANUFACTURER's. Display puts the code
  before the name (`22018 - Lone Star`). Settled with the client 2026-09-07;
  `asset.tag` and `project.external_id` were the last two violations and were
  renamed in migration `0052`.
- **A stale key name in a Drizzle insert loses data SILENTLY.** Drizzle drops an
  unknown key with no error and `tsc` cannot see it — a spread of a wider object
  into an insert is legal TypeScript. Renaming a column therefore means grepping
  every write, not trusting the compiler: after migration `0052` the seed still
  said `externalId: p.extId` and produced twenty projects with no code, on a
  green run. Four separate writers have now been bitten by this in two days.
- Physical names are snake_case singular; Drizzle exports are camelCase.
- `asset_model` / `manufacturer` / `asset.model_id` are **vestigial** — nothing reads or
  writes them (see the comment at `schema/asset.ts:24-30`). Don't build on them.
- `asset.code` is nullable by design — the code is a physical label somebody sticks
  on the tool, not an id the system mints. `asset_number` is the always-present one.
- `photo_key` stores an object key, never a URL, so the storage host isn't baked into rows.
- A new workspace dependency may need a line in `docker/Dockerfile.dev`'s COPY list *and* an
  anonymous volume in `docker-compose.yml`.
