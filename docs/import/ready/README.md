# Import files — what to build, and in what order

**For the data engineer.** Everything here is checked against the live importer,
not described from memory. Three files, and the order matters.

## Download the template first

In the app: **/projects**, **/equipment** or **/tools** → Import → **Download
template**. That file carries three guide rows under the header:

```
code,type,vin,description,plate,make_model,ownership,project,foreman
# REQUIRED?,required,required,,,,,,
# TYPE,text,enum: truck | trailer,text,…
# NOTES,must be unique where given,,must be unique where given…
TRK-012,truck,1FTEW1KP6RKD12345,2023 F-250,…
```

**Fill in underneath and upload the file unchanged.** Rows whose first cell
starts with `#` are stripped on read, so the guide rows never import.

## Order — forced by references

| # | File | Entity | Needs |
|---|---|---|---|
| 1 | `projects.csv` | projects | nothing |
| 2 | `equipment.csv` | trucks & trailers | projects |
| 3 | `small-tools.csv` | small tools | nothing (leave `location` blank) |

A **`ref`** column holds a **name**, not a UUID, matched case-insensitively
against rows already in the tenant. **An unmatched name rejects the whole
file**, which is why order is not advice.

`foreman` on equipment is a ref to an employee, and **employees do not exist
yet** — they arrive from the BambooHR sync. Leave it blank on every row and set
rigs in the app afterwards.

## Per file

### 1. `projects.csv`
```
name,project_code,description,status,site_address,start_date,end_date
```
`name` and `start_date` required. `status` ∈ `not_awarded | awarded |
in_progress | completed | cancelled | on_hold`. Dates `YYYY-MM-DD`.
`project_code` must be unique.

### 2. `equipment.csv`
```
code,type,vin,description,plate,make_model,ownership,project,foreman
```
- `code` and `type` required. **`type` is `truck` or `trailer`, nothing else.**
- `code` is the unit number painted on it — `TRK-034`, `TE-006`. **Unique.**
- **`vin` is unique but nullable.** Urban's VINs arrive over time, so blank is
  expected and correct. No format or length check — a real VIN in this fleet is
  sixteen characters where seventeen is standard, and refusing it would lose the
  vehicle. But **two vehicles cannot share one**: a VIN is the manufacturer's
  permanent identity, and a duplicate means one of them is wrong.
- `ownership` ∈ `company_owned | personal_allowance`. Defaults to
  `company_owned` if blank. It matters at offboarding: a personal vehicle
  leaves with the person, a company one is reassigned.
- `project` matches an existing project by name.

### 3. `small-tools.csv`
```
code,description,make,model,category,serial,quantity,cost,purchased_on,warranty_expires,location,owning_project
```
- **`description` is the only required field.**
- **Leave `code` blank** and the system generates `TOOL-00001`, `TOOL-00002`…
  numbered per tenant. Fill it only where a tool already carries a code.
- **`serial` is unique but nullable**, the same shape as `vin`. Blank is fine —
  many tools never had one or it has worn off. A REPEAT is refused, so:
  - do not write `N`, `n`, `none` or `N/A` — **leave the cell empty**
  - if two rows genuinely share a serial, blank one and note it
- `quantity` is a loose signifier for items nobody tracks individually. Leave
  it at 1 unless you know otherwise; custody ignores it.

## Rules for all three

- **Invent nothing.** A blank cell is correct where the source has no value.
  Data that is approximately right is worse than absent — a previous seed did
  exactly that and had to be deleted.
- Quote any cell containing a comma or a quote: `"4-1/2"" ANGLE GRINDER"`.
- UTF-8 without BOM, `\n` line endings. A BOM is stripped on read, but do not
  rely on it.
- The header row must match the template exactly. Common spreadsheet spellings
  are aliased (`SERIAL #`, `Qty`, `Purchase Date`), but do not count on it.

## Before you commit anything

The Import dialog **previews** first, computed by the same code as the commit,
so it cannot lie about what will happen. It reports per row and per column. A
file with any bad row should be fixed rather than partially imported.

## What is NOT importable, and where it goes instead

`condition` and `other_ref` were dropped from the tool spec — both were 0%
populated in the source. **The columns still exist** on the table and are
editable in the app, so nothing is lost; if a real source appears, the spec
takes one line and no migration.

Custody has **no importer**, deliberately: opening a custody link writes a
ledger event, and the ledger is the system of record. Tools land in the yard and
custody is recorded in the app, or through a one-off script that goes via
`moveCustody`.
