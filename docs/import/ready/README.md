# Importable files

Generated 2026-09-14 from the working files one level up. **These validate
clean against the real importer** (`validateRows`/`checkCell` in
`packages/api-contracts/src/routers/import.ts`) — 0 bad rows on every file.

Import through **Settings → Import**. Preview first; it uses the same code as
the commit, so it cannot lie about what will happen.

## Order

| # | File | Entity | Rows | Depends on |
|---|------|--------|------|-----------|
| 1 | `01-projects.csv` | Projects | 20 | nothing |
| 2 | `02-equipment-no-foreman.csv` | Vehicles | 88 | projects |
| — | *BambooHR sync* | People | — | — |
| 3 | `04-tools.csv` | Tools | 753 | nothing (locations blank) |

`02-equipment.csv` is the same 88 rows **with** the foreman column filled. Use
it only if all 70 foremen already exist with exactly matching names; otherwise
use the no-foreman variant and re-apply `02-equipment-foreman-map.csv` after
the sync. Import is all-or-nothing: one unmatched name rejects the file.

## What changed from the source files

**Projects** — kept the original 20 rows and codes. 9 got their real names from
`project-extraction/projects.csv` (7 were `Job NNNNN`); those renames were
applied to the equipment file in lockstep, because vehicles reference projects
**by name**. `site_address` filled with the city where known — the extraction
has no street addresses, so nothing was invented. `end_date` cleared rather
than asserting the placeholder 2030-12-31. `start_date` is required by the
spec, so the 2025-01-06 placeholder stays; it is still a placeholder.

**Equipment** — headers already matched; whitespace trimmed and project names
remapped. 16 of 88 rows have no foreman, as in the source. VIN is still not in
the import spec, so the 49 real VINs in the seed are not carried by this file.

**Tools** — 753 rows, all preserved.
- 15 rows had `N`/`n` as a serial. That is "no serial", not a serial; cleared.
- 11 serials were claimed by 2+ rows (25 rows). Serial is unique, and picking a
  winner would be a guess, so all copies are null and the original value is
  kept in `column_8` as `DUP SERIAL <value>` for the yard to re-check.
- 306 rows keep a real serial; a blank serial is a normal state.
- `category` filled by keyword-matching `description` against the 8 seeded
  categories. 527 matched, 226 left blank rather than guessed.
- `location` blank on every row: no locations exist yet, and a bad ref would
  fail the row.

## Not included

Employees (BambooHR) and custody (`05-custody-MANUAL.csv`) — untouched, as
asked. There is no custody importer; custody has to go through `moveCustody`.
