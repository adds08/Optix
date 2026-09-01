# docs/data — Urban's real register, and how it gets into the app

This directory turns two source files Urban handed over — an enclosed-trailer
workbook and a company vehicle PDF — into a seedable dataset, without guessing
at anything the sources don't actually say. Read this before touching any
`.py` or `.csv` file here, and before running `SEED_DATASET=urban`.

If you are looking for the demo dataset instead — the test fixture
`rbac-matrix.test.ts` and `e2e/roles.ts` depend on — it lives entirely in
`packages/db/src/seed-data.ts` and has nothing to do with this directory. See
`.claude/rules/database.md` for why the two must never be merged into one.

## The pipeline, in order

```
TOOL LIST BY NAME NEW.xlsx  ─┐
Latest update on company     ├─→  build_import.py  ─→  import/*.csv
  truck.pdf (transcribed    ─┘                          import/rejects.{json,csv}
  into build_import.py)                                        │
                                                                 ▼
                                                    build_report.py → import/data-issues.html
                                                                 │
                                                                 ▼
                                              build_seed_data.py → seed-data.urban.ts
```

1. **`build_import.py`** reads the `TE` summary sheet and every `TE-*` trailer
   sheet from `TOOL LIST BY NAME NEW.xlsx`, and carries the truck list
   transcribed verbatim from the PDF (misspellings included — correcting a
   name would invent a person). It cross-checks the two sources against each
   other and against the schema's real constraints
   (`vehicle_one_truck_per_foreman_uq`, VIN shape, plate uniqueness) and
   writes two kinds of output: `import/*.csv` for rows clean enough to load,
   and `import/rejects.json` / `rejects.csv` for every row that isn't, with a
   reason and a severity (`reject` blocks the row, `warn` loads it with a
   flagged gap, `info` is a note).
2. **`build_report.py`** renders `rejects.json` as `import/data-issues.html` —
   grouped by who can fix each item, for presenting to Urban, not for an
   agent. Re-run it after `build_import.py` to keep the page current.
3. **`build_seed_data.py`** turns `import/*.csv` into
   `packages/db/src/seed-data.urban.ts` — the file `seed.ts` actually loads
   under `SEED_DATASET=urban`. It also mints the one thing the source data
   doesn't carry: a stable `URB-NNN` employee number per person, in source
   order, so the same person keeps the same number across a regenerate.

**The old, single-file pipeline this replaced —
`generate_app_seed.py` / `generate_seed.py` — is stale in shape and must not
be run.** `generate_app_seed.py` emits a `costCenter` field `ProjectSeed` no
longer has and omits four exports (`categorySpecs`, `roleSpecs`, `uomSpecs`,
`companyRoleSpecs`) that `seed.ts` imports; running it would delete them from
the generated file.

## Loading it

```bash
SEED_DATASET=urban SEED_RESET=1 pnpm seed          # local
SEED_DATASET=urban SEED_RESET=1 SEED_ALLOW_PRODUCTION=1 pnpm seed   # a real environment
```

**`SEED_RESET=1` is destructive on ANY database it runs against**: it deletes
every tenant, employee, vehicle, asset and ledger row, disabling the ledger's
append-only trigger to do it, then reseeds from nothing. There is no partial
or additive mode. Take a backup first on anything that isn't disposable.

The urban dataset seeds exactly one login: `optix_it@optixtec.com`, password
from `SEED_OWNER_PASSWORD` if set, otherwise generated and printed to the
console **once** — capture it before scrolling on. Further accounts are made
through `/admin/users` after signing in.

## What is verified right now, and what is not

- **The pipeline runs end to end and the seed loads it.** Verified locally:
  21 projects, 83 employees, 88 vehicles (49 trucks, 39 trailers, `vin`
  populated on every truck), 753 tools, 673 custody rows, 673 ledger events —
  zero with a null `to_state`.
- **No environment has Urban's data loaded.** Both `urban.bodhitechlabs.com`
  (dev) and `urban.optixtec.com` (production) are running code that *can*
  load this dataset; neither has had `SEED_DATASET=urban` run against it. A
  deploy ships code, not data — the command above is a separate, deliberate
  step on the box itself.
- **The compact-card jobsites view and the equipment-type/VIN work were
  verified against the demo dataset**, not this one. Nothing suggests they'd
  behave differently against Urban's real data, but that specific combination
  hasn't been driven in a browser.

## Decisions already made, and why

Human rulings on identity collisions live in a `DECISIONS` block at the top of
`build_import.py`, not scattered through the code, because every one of them
decides whether two rows are one person — get it wrong and the register hands
one man another man's tools. In short:

- **Juan Martinez**: two people. `JUAN MARTINEZ` (TE-028, NEX #22017) and
  `Juan Martinez (1975)` (TRK-044, same job) are one man — the `(1975)` exists
  precisely because a second Juan Martinez does. `Juan Carlos Martinez`
  (TRK-032, job 25001) is that second man.
- **Five other near-matches are kept separate on purpose** (LOZA SR., Abarca,
  Medina, Almaguer, Capuchino) — reversing an earlier pass at this data that
  merged two of them. A wrong split leaves two duplicates a human can merge
  from the register in seconds; a wrong merge silently hands one man's tools
  to someone else. The reversible mistake is the one made.
- **The Equipment Yard carries no job number**; job `24002` is a separate real
  project — it has a superintendent, a surveyor, a traffic-control foreman and
  a field engineer, which is a job crew, not yard staff. This is also why the
  live database briefly carried two "Equipment Yard" project rows before this
  work: TE-007 had typed the yard against 24002.
- **One company truck per foreman, enforced by the database**
  (`vehicle_one_truck_per_foreman_uq`, migration `0030`). Two people in the
  source hold two company trucks each; the second truck loads with no
  custodian rather than aborting the whole import.

## What is still open — a human, not an agent, has to close these

Re-run `build_import.py` and read `import/data-issues.html` for the current
count; as of this writing it reports **4 reject, 43 warn, 17 info**. The kind
worth naming specifically:

- **`TE-027`'s foreman was removed on a mistaken reading.** Felipe Portillo
  holding both TE-017 and TE-027 was flagged as an anomaly and resolved by
  clearing TE-027's custodian (`NO_CUSTODIAN_TRAILERS` in `build_import.py`).
  That was wrong: `packages/db/src/schema/location.ts` (the `vehicle` table
  comment, near `oneTruckPerForemanUq`) already documents that one Urban
  foreman genuinely runs two loaded trailers, and names these two by id as
  the reason the uniqueness index is trucks-only. Emptying
  `NO_CUSTODIAN_TRAILERS` and re-running restores him and reassigns TE-027's
  tools.
- **Job 24002's real name isn't in either source.** It loads as the
  placeholder `"Job 24002"` and needs renaming once Urban says what it's
  actually called.
- **The Excel import spec has no column for `vin` or `equipmentClass`.**
  `packages/types/src/import-specs.ts`'s vehicle spec only knows
  `vehicleType`; a spreadsheet round-trip can't set either new field yet.
- **A duplicate licence plate and a 16-character VIN** are recorded as
  `reject`s rather than corrected — Urban's call, not a default to invent.

## Files in this directory

| File | What it is |
|---|---|
| `TOOL LIST BY NAME NEW.xlsx` | Source: the enclosed-trailer workbook, current |
| `TOOL LIST BY NAME.xlsx` | Superseded — kept for the diff, not the pipeline |
| `build_import.py` | Source → `import/*.csv` + `rejects.{json,csv}`. The `DECISIONS` block is here |
| `build_report.py` | `rejects.json` → `import/data-issues.html`, for presenting to Urban |
| `build_seed_data.py` | `import/*.csv` → `packages/db/src/seed-data.urban.ts` |
| `import/` | Generated. Re-run the pipeline rather than hand-editing anything in it |
| `generate_app_seed.py`, `generate_seed.py`, `seed_from_tools_list.json`, `reconciliation_report.json` | The **old** pipeline. Stale in shape — do not run |
