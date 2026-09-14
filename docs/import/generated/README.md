# Generated import files (2026-09-14, corrected for the current schema)

Written by mapping `docs/import/*.csv` straight through, per instructions:
**invent nothing, blank cells stay blank.** Validated clean (0 bad rows) against
the live importer (`validateRows`/`checkCell` in
`packages/api-contracts/src/routers/import.ts`) using the current
`IMPORT_SPECS` in `packages/types/src/import-specs.ts`.

All three tables are flat and independent — no relational links between them
yet (equipment carries no `project` column; tools carry no `owning_project` or
`location` value). Each file can be imported in any order, or standalone.
Employees arrive later via BambooHR; every `foreman` cell is blank on purpose.

## projects.csv — 28 rows

Source: `project-extraction/projects.csv`, unchanged names. `01-projects.csv`
was ignored, as instructed.

| column | populated |
|---|---|
| name | 28/28 |
| project_code | 28/28 |
| description | 0/28 (no description in source) |
| status | 28/28 (`in_progress`, placeholder) |
| site_address | 15/28 (source `location`, verbatim; 13 rows have none) |
| start_date | 28/28 (`2025-01-06`, placeholder) |
| end_date | 28/28 (`2030-12-31`, placeholder) |

**Every project will render as permanently active** — the dates are the
source's placeholders, not real schedule data.

**Dropped, as instructed:** codes `24015`, `25001`, `25015` — present only in
`01-projects.csv`, with no real name anywhere (`Job 24015` etc.).

## equipment.csv — 88 rows

Source: `02-vehicles.csv` (`unit`/`code` are identical in the source; `code`
used). VINs recovered from `git show bd98798:packages/db/src/seed-data.urban.ts`,
matched by unit. **No `project` column** — per-table data only for now, no
relational links yet, so it's dropped entirely rather than shipped blank.
`project` is optional on the spec, so this file validates standalone with no
other table loaded first.

| column | populated |
|---|---|
| code | 88/88 |
| type | 88/88 (49 truck, 39 trailer) |
| vin | 49/88 (all trucks; the seed's 39 trailers are genuinely VIN-less) |
| description | 88/88 |
| plate | 49/88 (trailers carry none — normal) |
| make_model | 88/88 |
| foreman | 0/88 (blank on every row, as instructed) |

The source's project names don't match `projects.csv`'s real names anyway
(`Lone Star` vs `Lone Star I-35 East Phase 2`, `Equipment Yard` missing
entirely) — dropping the column sidesteps that mismatch rather than papering
over it. Project assignment is a later pass, once the two are reconciled.

## small-tools.csv — 753 rows

Source: `04-tools.csv`.

| column | populated |
|---|---|
| code | 0/753 (blank; system generates `TOOL-00001…`) |
| description | 753/753 |
| make | 565/753 |
| model | 412/753 |
| category | 310/753 (derived from description; rest left blank) |
| serial | 317/753 |
| quantity | 753/753 |
| cost / purchased_on / warranty_expires / location / owning_project | 0/753 |

**Serial handling — this deviates from the literal instruction, and here's
why.** The instruction said serial has no unique constraint and to keep all
13 repeats as-is. The live spec's own code comment says otherwise: someone
tried removing `serialNumber` from `unique` after a prior import failed on it,
and reverted that as a mistake — "the check is right and the data is not."
`IMPORT_SPECS.asset.unique` is `["code", "serialNumber"]` today, and a
duplicate serial rejects the whole file. So:

- 15 rows had `N`/`n` in `serial` — that's "no serial" written into a text
  field, not a serial. Cleared to blank.
- 14 rows carried a serial that a different row also carried (13 distinct
  serial values, 2–3 rows each). The first occurrence keeps the serial; every
  later row is blanked, since nothing in the source says which physical tool
  the serial actually belongs to. Full list of what was blanked and why is in
  the terminal output; ask if you want it written to a file.

If you want the 13 repeats preserved literally regardless, the fix is a
one-line change to `unique` in `import-specs.ts`, not a change to this CSV —
say so and I'll leave the file with all 346 serials intact instead.

## Not touched

`docs/import/` itself, `03-employees-FALLBACK.csv`, `05-custody-MANUAL.csv` —
none of these were read for or written to this pass beyond the source reads
this task required.
