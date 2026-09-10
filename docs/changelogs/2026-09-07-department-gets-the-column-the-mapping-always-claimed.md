# Department gets the column the mapping always claimed

`BAMBOOHR_PEOPLE_SYNC.md` §4 has mapped BambooHR's `departmentName` to
`employee.department_id` since 2026-09-06. That column did not exist. Migration
`0050` created `division_id` and `tbl_entity_employee_external_ref` and stopped there,
so one row of the field-mapping table pointed at nothing — and because the mapping
table reads as settled, the gap was rediscovered twice in two days before anybody
closed it. The user's response on being told a third time was the correct one: add it
then.

`tbl_entity_department` is not new and was not created for this. `asset.owning_department_id`
has referenced it for cost targets since long before any HR sync was contemplated. So
this is one nullable column on `employee`, not a table and a column — the vocabulary
already existed, and a second departments table would have been the duplication this
codebase has paid for most.

## What changed

### `employee.department_id`, flat beside `division_id`

`packages/db/src/schema/employee.ts` gains `departmentId`, referencing
`tbl_entity_department` with `ON DELETE set null` — matching `divisionId`, and for the
same reason: retiring a department is an org change and must neither be blocked by the
people in it nor cascade into them. Nullable, because most of the register predates the
column and a department is not needed to hold a tool.

The pair stays FLAT. BambooHR ships `divisionName` and `departmentName` as two
independent fields on one record and models no relationship between them; nesting was
proposed and rejected by the client on 2026-09-06, and nothing here reopens that. The
comment on `divisionId` already described "these two columns" — it now names two that
both exist.

### Migration `0053_simple_thunderbolt.sql`

Generated, read before applying, and purely additive: one `ADD COLUMN` and one
`ADD CONSTRAINT` inside the house `DO $$ ... EXCEPTION WHEN duplicate_object` block. No
`DROP COLUMN` and no rename ambiguity, which is the specific thing that has to be
checked here — the generator emitted `ADD COLUMN` plus `DROP COLUMN` for `asset.tag`
two days earlier and would have destroyed every tool code.

### The seed reaches all four combinations

`packages/db/src/seed.ts` sets `departmentId` round-robin across the three seeded
departments, leaving every fifth person null — deliberately `% 5` where `divisionId`
uses `% 4`. Reusing `% 4` would have made the two columns move together, so a screen
reading the wrong one of the pair, or conflating them, would have looked correct on
every row. With the offset, a clean database contains people with both set, division
only, department only, and neither.

## What was found while building it

- **The credentials are on disk but not in the typed accessor.**
  `BAMBOOHR_COMPANY_DOMAIN` and `BAMBOOHR_API_KEY` are present and non-empty in the
  gitignored `.env.local`, and are absent from `serverSchema` in
  `packages/env/src/server.ts`. That schema is a bare `z.object({...})` parsed with
  `.safeParse(process.env)`, and Zod strips unknown keys by default, so `serverEnv()`
  returns an object carrying neither. Raw `process.env` still has them. Whoever writes
  the client adds two lines there rather than debugging an undefined value.
- **The endpoint is contested.** §3 of the sync plan records a settled decision to use
  `list-employees` only, and rejects `/v1/employees/directory` on two grounds: it has
  no `status` field and excludes former employees entirely, and it gives the manager as
  a display-name string rather than `reportsToId`. The user has since named
  `/api/v1/employees/directory?onlyCurrent=true` as the API. Unresolved, and recorded
  rather than decided — see the open item added to the plan document.

## Verified

- `make generate` produced `0053_simple_thunderbolt.sql`; the SQL was read in full
  before `make migrate` ran.
- `pnpm typecheck` in the api container — exit 0.
- Column and constraint, by query: `department_id` is `uuid`, nullable, and
  `pg_constraint.confdeltype` for the new FK is `n`, which is `SET NULL`.
- Roster intact across the migration: 83 employees, 83 with a code.
- The seed's write actually persists, checked by query rather than inferred from a green
  typecheck — the Drizzle stale-key trap loses a key silently and `tsc` cannot see it.
  After `make seed-urban`: 63 people with a division, 67 with a department, and the four
  combinations present as 4 neither, 12 division only, 16 department only.

Not verified: no screen reads or writes `department_id` yet, so nothing was checked in a
browser. No call of any kind was made to BambooHR.

## Deliberately not done

- **No department picker, no form control, and no router field.** The column has no
  writer. `equipment_class` sat unreachable in the schema for weeks because it was added
  without the control that writes it, so this is worth naming: until the sync or a form
  populates it, `department_id` is only reachable through the seed.
- **No `department` on the BambooHR adapter yet** — the adapter is unbuilt, paused
  before any code pending the endpoint question above.
- **No hierarchy between division and department.** Settled 2026-09-06; not revisited.

## Where it is

Branch `development`, uncommitted, on top of `176ebc5`. Migration `0053` is applied to
the local database only. Not committed, not deployed.
