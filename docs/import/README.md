# Importing Urban's Real Data

**Created:** 2026-09-12
**State:** local register is EMPTY. Logins, roles, permissions, tiers and
categories survive; every employee, tool, job, vehicle and custody row is gone.

This folder holds the working files for rebuilding it from real sources. The
files here are **starting points recovered from `seed-data.urban.ts`**, not
finished data — every one needs a pass from somebody who knows the yard.

---

## Order — forced by dependencies

| # | Entity | File | Source of truth | Owner |
|---|---|---|---|---|
| 1 | **Projects** | `01-projects.csv` | screenshot (weak) | **you to confirm** |
| 2 | **Vehicles** | `02-vehicles.csv` | truck/trailer Excel | **you to confirm** |
| 3 | **People** | BambooHR sync | **BambooHR (live)** | automated |
| 4 | **Locations** | not yet written | — | **decision needed** |
| 5 | **Tools** | `04-tools.csv` | tools spreadsheet | **you to confirm** |
| 6 | **Custody** | `05-custody-MANUAL.csv` | tools/trailer/person sheet | **you to confirm** |
| 7 | **Roster** | in-app, manual | — | manual, by design |

Custody is last because a row references asset, employee, project, vehicle and
location all at once.

Import through **Settings → Import** in the app: it previews before it commits,
and the preview is computed by the same code as the commit, so it cannot lie
about what will happen.

---

## 1. Projects — `01-projects.csv` (20 rows)

Recovered from the seed, which came from a screenshot carrying code, name and
bid valuation. **This is the weakest dataset in the system and has no system of
record.**

```
name,project_code,description,status,site_address,start_date,end_date
Equipment Yard,10001,,in_progress,,2025-01-06,2030-12-31
Lone Star,22018,,in_progress,,2025-01-06,2030-12-31
Job 24002,24002,,in_progress,,2025-01-06,2030-12-31
```

**What needs fixing before import:**

- **8 of 20 are named `Job NNNNN`** — the screenshot had a code but no name.
  Somebody at Urban knows what these jobs are called.
- **Every `start_date` is `2025-01-06` and every `end_date` is `2030-12-31`.**
  These are seed placeholders, not real dates.
- **No site addresses.** The field feeds the map and "what a driver types into
  a phone".
- **Every status is `in_progress`.** Some of these are certainly closed.

Note `Equipment Yard` (10001) is not a job — it is the yard, and the register
treats it as a project so tools can be charged somewhere while in the shop.

---

## 2. Vehicles — `02-vehicles.csv` (88 rows: 49 trucks, 39 trailers)

**This file is the most important find of the audit.**

The live database held **2 trucks and 29 trailers**. The seed file contains
**49 trucks and 39 trailers**, with real VINs, real plates and foreman links.
So the earlier finding — "2 trucks cannot serve 28 foremen" — was not missing
source data. **The seed silently dropped 57 vehicles.** Importing this file
fixes a gap that looked like a data-collection problem and was actually a
loading problem.

```
unit,type,code,description,plate,make_model,ownership,project,foreman
SUV-001,truck,SUV-001,ROGUE,TWV0162,ROGUE,company_owned,Equipment Yard,Anup Tamrakar
```

- 49 of 88 carry a plate (all the trucks; trailers have none, which is normal)
- 72 of 88 name a foreman
- **VIN is not in the import spec** but IS in the seed — 49 real VINs will be
  lost unless the spec gains the column. Worth deciding.

`make_model` was filled from the seed's `make`, which actually holds the model
("ROGUE", "F-350", "RAM 3500"). Fine for now; a real Excel would separate them.

---

## 3. People — BambooHR, not a CSV

`03-employees-FALLBACK.csv` exists **only as a fallback** and should not be
used if the sync works. It has **81 people and zero email addresses**, which
means no invitations and no notifications.

BambooHR has, verified by read-only probe on 2026-09-12:

```
278 active (1580 terminated, all with a terminationDate)
919/1859 with a supervisor (reportsToId)
isManager fully populated — 64 true, 1795 false, 0 unknown
123 distinct job titles
```

**Everyone lands as `crew` with no login.** Job-title→role mapping is a manual
admin action; the ~15 people who need access get invited by hand.

---

## 4. Locations — needs a decision first

Not generated, because the old data only ever had **1 warehouse + 31 vehicle
mirrors**, and vehicle locations are created by the vehicle import itself.

The schema supports `warehouse | site_container | gang_box | project_site`, and
**none of those were ever used**. Before writing this file: does Urban have
gang boxes, site containers or a second yard that tools sit in? If tools only
ever live in a trailer or the yard, this file is one row.

---

## 5. Tools — `04-tools.csv` (753 rows)

```
tag,description,make,model,category,serial,quantity,cost,purchased_on,warranty_expires,other,column_8,location
```

- **`tag` is deliberately EMPTY on every row.** The seed's `TOOL-0001` values
  were invented at seed time — `schema/asset.ts` says so outright: Urban's own
  sheets carry no tool-ID column. Leaving them blank is honest; an untagged
  tool is a normal state.
- **346 of 753 have a serial** (46%). 14 serials appeared twice in the old
  data — worth checking whether those are genuinely two identical tools.
- **565 of 753 have a make.** `description` is present on all of them and is
  the required field.
- **`category` is empty on every row.** The register has 8 categories (Hand
  Tools, Saws, Drills & Drivers, Grinders, Compaction, Generators & Power,
  Blowers & Yard, Survey & Layout) and 46% of assets previously had none.
  Filling this column is high-value and can be largely done by matching
  keywords in `description`.
- `cost`, `purchased_on`, `warranty_expires` are empty — absent from the source.

---

## 6. Custody — `05-custody-MANUAL.csv` (753 rows)

**There is no custody importer.** This file is a worksheet, not an import.

```
serial,description,custodian,project,trailer_or_truck_unit
```

- 673 of 753 name a custodian
- 753 of 753 name a vehicle

Custody has to be created through the app (assign / hand over), because opening
a custody link writes a ledger event and the ledger is the system of record.
A bulk path would have to go through `moveCustody`, the single writer — see
`packages/api-contracts/src/custody.ts`.

**Options, needs a decision:**
1. Record custody by hand in the app for the tools that matter most
2. Write a one-off script that drives `moveCustody` properly for all 753
3. Import tools with a location only, and let custody build up naturally

Option 2 is the right one if all 753 need to be right on day one.

---

## What is still blocking

1. **Project names and dates** (#1) — 8 unnamed jobs, all placeholder dates.
2. **Does the vehicle spec need a VIN column?** 49 real VINs otherwise lost.
3. **Location model** (#4) — are gang boxes and site containers real for Urban?
4. **Custody approach** (#6) — hand-entry, script, or let it build up.
5. **Tool categories** (#5) — fill from description keywords, or leave null.

---

## Rebuilding these files

All five were recovered from `seed-data.urban.ts` at commit `bd98798`:

```
git show bd98798:packages/db/src/seed-data.urban.ts
```

The generation is throwaway Python, not committed — these CSVs are now the
working copies and are meant to be edited by hand.
