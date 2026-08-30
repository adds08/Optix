# Equipment gets a register, and the Registry group fills its reserved slot

Phases 4 through 7 of the roles/project-assignment/equipment plan
(`/Users/adds08/.claude-personal/plans/imperative-beaming-puzzle.md`). Most of
the ground for this was already laid on 2026-08-27 — `vehicle` already had
`equipmentClass`, GPS fields and an import spec — so this was mostly wiring a
screen onto data that already existed, plus two new columns.

## What changed

### Schema: code and description, additive

`code` and `description` (both nullable `text`) on `vehicle`
(`packages/db/src/schema/location.ts`), migration `0037_tired_paper_doll.sql`
— two `ADD COLUMN` statements, nothing else. `equipmentClass`
(`vehicle | heavy`) and `canAttach`/`isAttachable` already existed and needed
no change. Seeded on the synthetic `ZZ-SEED-TRUCK` row (`code: "EQ-0001"`) so
the columns are actually exercised from a clean database, not just declared.

Exposed through `vehicleRouter` (`packages/api-contracts/src/routers/location.ts`):
added to the `list` select (along with `equipmentClass`, which was in the
schema but never selected), and to both `create` and `update` — `update`'s
`...changes` spread picks up new zod fields automatically, so nothing else
needed to change there.

### The register and its detail page

`apps/web/app/(app)/equipment/page.tsx` mirrors `projects/page.tsx`'s leaner
shape rather than `tools/page.tsx`'s heavier one — equipment has no
categories, no high-value flag, no bulk-move, so the richer pattern would
have been scope for its own sake. Columns: Code, Equipment (unit name with a
Truck/Wrench icon carrying the heavy-vs-vehicle distinction inline, the same
reasoning `ToolIcon` rides the category icon on `/tools`' name column rather
than earning its own column), Make/Model, Ownership, Project, GPS (a small
badge reusing the three-state vocabulary — "Online"/"Offline"/"Not set
up" — `fleet-map-view.tsx` already established, backed by the
`vehicleStatus()` helper `vehicleRouter.list` already computes
server-side), and a frozen Actions column.

`apps/web/app/(app)/equipment/[id]/page.tsx` mirrors `people/[id]/page.tsx`'s
leaner pattern rather than `tools/[id]`'s heavier ledger/transaction-history
one — vehicles aren't asset-ledger entities. A facts grid, plus "Small tools
aboard": `asset.list` filtered client-side by matching `locationId` to the
vehicle's own — the house convention (`.claude/rules/web.md`, "Filtering is
client-side, and that is not laziness"), since `asset.list` has no
`locationId` filter and one wasn't worth adding for a small per-vehicle list.

Both reuse the existing `VehicleForm` for create/edit rather than a new one —
added `code`/`description` fields to it.

### The Registry group fills the slot it had been holding open

`apps/web/components/sti/nav-config.ts` gets the `equipment-register` row
under Registry, alongside Small Tools — the exact slot that group's own
comment had been reserving since 2026-08-27. Updated that comment and
`.claude/rules/web.md`'s route list and Equipment section, both of which
said no Equipment screen existed.

### Import, mostly already built

`IMPORT_SPECS.vehicle` already existed in full. Added two columns, `code`
and `description`; confirmed the commit pipeline
(`packages/api-contracts/src/routers/import.ts`) builds its insert values
generically keyed off each spec column's `key`, so both flow through with no
other router change. Wired `<ImportButton entity="vehicle" />` onto the new
page — the same call every other register makes.

### People gets an Email column

Immediately after Name, reading `employee.email`, which
`employeeRouter.list` already selected. Pure UI.

## What was found while building it

Wiring the equipment page's delete action made an existing reachability-test
exemption stale: `vehicle.delete` had a `NO_UI_BY_DESIGN`-style entry saying
no screen called it, and the test (STI-121, "has no stale exemptions")
correctly failed once one did. Removed the entry rather than the test.

## Verified

- `pnpm typecheck` clean across `types`, `db`, `api-contracts`, `web` after
  every sub-phase.
- Full `api-contracts` suite, 257/257, in the api container — once catching
  the stale reachability exemption, once clean after removing it.
- Screenshots against local dev: Registry now shows Small Tools and Equipment;
  the equipment list renders with the truck icon and every column populated;
  the detail page for `TE-006` shows its facts grid and a working "Small
  tools aboard" table with the 18 real tools riding on that trailer; the
  People page shows Email as the second column.

## Deliberately not done

No data-warehouse sync — explicitly out of scope. No facet/bulk-move/
saved-filter richness on the equipment page — proportionate to what 31 rows
with no category axis actually need today, not an oversight.

## Where it is

Branch `development`, part of the same multi-phase push as the two entries
earlier today — not yet on `main`; the user will PR and merge themselves.
