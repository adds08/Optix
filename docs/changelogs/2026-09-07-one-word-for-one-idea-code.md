# One word for one idea: code

The client's rule, in their words: *"external_id field is a foreign key from
somewhere else. All table related `*_code` is its code — project_code,
user_code, tool_code, equipment_code."* And: *"if more numbers and identity
exist just add them as other fields."*

Applied everywhere. Two columns broke the rule and both are renamed.

| Was | Now | Held |
|---|---|---|
| `tbl_entity_asset.tag` | `code` | `TOOL-0001` — Urban's tool code |
| `tbl_entity_project.external_id` | `code` | `22018` — Urban's job number |

Neither ever held a foreign key. `employee.code` (migration `0050`) was the
first of these; this is the rest of the same idea.

Extra identifiers stayed as their own fields, exactly as asked: `asset_number`
(the database's own sequence) and `serial_number` (the **manufacturer's**) are
untouched and now sit beside `code` rather than pretending to be it.

## Migration 0052 was hand-written, and that mattered

`drizzle-kit generate` prompts create-vs-rename only for the **first** ambiguous
column it meets. It asked about `project`, then guessed for `asset` and emitted:

```sql
ALTER TABLE "tbl_entity_asset" ADD COLUMN "code" text;
ALTER TABLE "tbl_entity_asset" DROP COLUMN IF EXISTS "tag";
```

Applied as generated that destroys the code of all 753 tools. It was replaced
with two `RENAME COLUMN` statements before anything ran, and the reasoning is
written into the migration so the next person reading it knows why it is not
generator output. Verified after applying: 753 tools in, 753 codes out.

## The silent drop happened anyway, and got caught by looking

`packages/db/src/seed.ts` still wrote `externalId: p.extId` into the project
insert. Drizzle **drops an unknown key with no error**, so the next
`make seed-urban` produced twenty projects with no code at all — no failure, no
warning, a green seed.

This is the third time in two days that spreading a stale key name into a
Drizzle insert has silently lost data, and the first time it actually landed
rather than being caught by the compiler. The three earlier ones
(`employee.create`, `employee.update`, the CSV importer) were found by reading;
this one was found by opening `/projects` and seeing a column of em-dashes.

**`tsc` cannot catch this class of bug** — a spread of a wider object into an
insert is legal TypeScript. Only a query, or a screen, will tell you.

## A mislabel the rename exposed

The tools register had its two identifiers under each other's headings: the
column labelled **"Code"** rendered `serialNumber`, while the tool's actual code
sat two columns to the right under **"Tag"**. So the register showed a Bosch
part number where People and Projects both show the company's own identifier.

Now: **Code | Ref # | Serial | Tool**, code leading, matching Employee Code and
Project Code. The serial keeps its own column and its own honest label — it is
the manufacturer's, present on 346 of 753 tools, and by the client's own rule
that makes it closer to an external id than to a code.

## What was deliberately NOT renamed

- **`eventType: "tag"`** — a ledger event type, the *act* of tagging a tool, not
  a column. The ledger is append-only; renaming an event vocabulary would orphan
  history to no purpose.
- **The CSV import header `tag`** — a contract with spreadsheets people already
  have. The spec key behind it is now `code`; the header a user types is not.
- **`project.externalId` on the tRPC wire** — the field name callers read. The
  column is what needed to be truthful.
- **A `<Tag>` component on the design page** — caught mid-sweep and reverted.
  Same word, unrelated meaning.

## Where a foreign key actually goes

Nowhere on the entity. `employee_external_ref` (migration `0050`) holds
BambooHR's key, and there is no `external_id` column left on any entity table.
A single such column holds exactly one foreign system, and this codebase already
names three — BambooHR, Mark 85, FoundationSoft.

Checked directly: no entity has an unused `external_id` sitting spare.

## Verified

- `pnpm typecheck` clean across all 14 packages — the compiler found roughly
  seventy call sites across API, web, mobile, intent and tests, and they were
  worked through until zero.
- 568 tests in 43 files, run inside the api container against the demo fixture.
- Every entity's codes intact after re-seeding the real register: 83 employees,
  20 projects, 753 tools, 88 vehicles — all fully coded.
- `/tools`, `/projects` and `/people` driven in a browser: `TOOL-0001`,
  `10001`, `URB-001`, code-first, no console errors. Tool rows show
  `22018 - Lone Star` for the job, which is the client's display format.

One incident worth noting for the next session: clearing `.next` was required
after the rename — Turbopack panicked on its stale cache with an internal error,
not a code fault.
