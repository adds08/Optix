# Identity and naming — `code`, `external_id`, and everything else

Settled with the client 2026-09-07. Migrations `0050`, `0051`, `0052`.

## The rule, in one line

> A **`code`** is the COMPANY's own identifier. An **`external_id`** is a
> FOREIGN system's primary key. Extra numbers are their own fields.

In the client's words: *"external_id field is a foreign key from somewhere else.
All table related `*_code` is its code — project_code, user_code, tool_code,
equipment_code. If more numbers and identity exist just add them as other
fields."*

### Why the distinction is load-bearing

A code is stable across every system Urban runs, because Urban assigns it. A
foreign id means nothing outside the system that minted it. Storing them in one
column means a sync eventually overwrites the first with the second — which is
exactly what `employee.external_id` (holding badge numbers) and
`project.external_id` (holding job numbers) were set up to do before this change.

## Where the code lives on each entity

| Entity | Table | Code | Example |
|---|---|---|---|
| Person | `tbl_entity_employee` | `code` | `URB-001` |
| Job | `tbl_entity_project` | `code` | `22018` |
| Tool | `tbl_entity_asset` | `code` | `TOOL-0001` |
| Vehicle | `tbl_entity_vehicle` | `code` | trailer/truck unit |
| Department, Division, Company role, UoM category | — | `code` | `OPS`, `CARP` |

**`asset` is the tools table** — hammer drills, grinders, saws. The word is
internal; every screen says Tools.

Reference tables whose `name` IS the identity (`category`, `manufacturer`,
`location`, `warehouse`, `team_role`, `unit_of_measure`, `role`, `tenant`) carry
no code, deliberately. A code on a row nobody quotes by number is a column to
keep in step for nothing.

## Where a foreign id lives

**Never on the entity.** There is no `external_id` column on any entity table —
verified, count zero. Foreign keys go in an external-ref child table:

```
tbl_entity_employee_external_ref
  employee_id, system, external_id, last_synced_at, restricted_fields, raw
  UNIQUE (tenant_id, system, external_id)
  UNIQUE (tenant_id, employee_id, system)
```

`system` is `bamboohr | mark85 | foundationsoft`. A child table rather than a
column because one column holds exactly one far system and this codebase already
names three; the unique indexes are what make a re-sync idempotent instead of
duplicating the register.

Nothing reads this table yet and no importer exists. It is also **never exposed
to the frontend** — no router selects from it.

## The three identifiers on a tool, and why all three exist

| Column | Whose | Always present? |
|---|---|---|
| `code` | **Urban's** — the value read off the tool | No — null until labelled |
| `asset_number` | The database's own generated sequence | Yes, always |
| `serial_number` | The **MANUFACTURER's** | 346 of 753 |

Only `code` is the tool's code. `serial_number` is a foreign identifier by the
rule above — it is the manufacturer's, not Urban's — and keeps its own column
and its own honest label rather than standing in for a code. `asset_number` is
the one value guaranteed never blank, which is what a report points at when a
tool has not been labelled.

Until 2026-09-07 the register showed `serial_number` under the heading "Code"
and the real code under "Tag" — a Bosch part number where every other screen
shows Urban's own identifier.

## Display

Code before name, everywhere:

```
<code> - <name>                 22018 - Lone Star
                                URB-001 - Alejandro Capuchino
```

Small tools additionally show the serial, which is frequently absent:

```
<code> - <name>
<serial_number> or "(empty)"
```

A null code renders `—`, never a blank cell. Null is a normal state — a tool
nobody has labelled, a person hired before codes were issued — and an empty cell
reads as broken data instead of as "not yet".

## Naming history, so it is not rediscovered

| Was | Now | Migration |
|---|---|---|
| `employee.external_id` | `employee.code` | `0050` |
| `asset.tag` | `asset.code` | `0052` |
| `project.external_id` | `project.code` | `0052` |

`asset.tag` was never a different fact — "tag" was the column heading on the
spreadsheet the data arrived in. `project.external_id`'s own comment claimed
both jobs at once: "the project code shown to users" AND "the FoundationSoft /
Mark 85 map".

## Two traps this rename left behind

**1. A stale key in a Drizzle insert loses data silently.** Drizzle drops an
unknown key with no error, and `tsc` cannot see it — a spread of a wider object
into an insert is legal TypeScript. Four writers were bitten in two days; the
seed's `externalId: p.extId` survived long enough to actually run and produced
twenty projects with no code, on a green seed. **Renaming a column means
grepping every write.** Only a query or a screen will tell you.

**2. `drizzle-kit generate` guesses after the first rename.** It prompts
create-vs-rename for the first ambiguous column and guesses for the rest — it
emitted `ADD COLUMN code` + `DROP COLUMN tag`, which would have destroyed all
753 tool codes. **Read the generated SQL before applying it.** Migration `0052`
is hand-written for this reason.

## What is deliberately not renamed

- **`eventType: "tag"`** — a ledger event type, the *act* of tagging a tool, not
  a column. The ledger is append-only; renaming the vocabulary orphans history.
- **The CSV import header `tag`** — a contract with spreadsheets people already
  have. The spec key behind it is `code`.
- **`externalId` on the tRPC wire** for employee and project — the field name
  callers read. The column is what needed to be truthful; renaming the contract
  would touch ~40 web files for no behavioural gain.
