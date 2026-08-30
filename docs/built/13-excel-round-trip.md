# Getting data in and out as Excel

Urban's tool records live in Excel today — one sheet per trailer, maintained by
hand, with rows appended as tools are bought or moved. A sheet header looks like
this:

```
TE-006   ALEJANDRO CAPUCHINO            LONE STAR #22018

DATE       QTY  DESCRIPTION                    MAKE     MODEL       SERIAL #    OTHER   (unlabelled)
1/17/2024   1   HAMMER DRILL EXTREME BULL DOG  BOSCH    11255VSR    331009023   NEW
1/17/2024   1   ELECTRIC DRILL 1/2"            DEWALL   DW511       DKJM5J0     USED    RETURN 1/19/24
1/24/2024   1   LEAF BLOWER                    STIHL    BG56C       539161106   NEW     106
4/3/2024    1   Plate Compactor                WACKER   WP1550AW    10835754    USED    PC-08
7/31/2024   1   QUIKIE SAW                     STIHL    TS-420      195116602   NEW     QS-602
```

Note what `OTHER` actually contains: `NEW` and `USED`. It is the tool's
condition, not a reference number. The equipment numbers — `PC-08`, `QS-602`,
`106` — and the occasional status note like `RETURN 1/19/24` live in a ninth
column with no header at all.

Those sheets are the system of record until this replaces them, and they will
keep being produced by people who are not going to stop using Excel. So the
register has to accept them as they are, and give them back in the same shape.

Three things stand between here and that: the import spec describes different
columns, the header matching is case-sensitive and will reject `MAKE`, and there
is no export that round-trips.

This depends on `docs/built/12-model-field-split.md` — the `make`/`modelNumber`/
`description`/`otherRef` columns must exist first.

## What that sheet actually is

Worth reading the header row before designing anything: `TE-006` is a trailer,
`ALEJANDRO CAPUCHINO` is its foreman, `LONE STAR #22018` is the project and its
code. The rows are its contents.

The register already models all of this. A trailer is a `location` with
`type = 'vehicle'` and a `custodianEmployeeId`; the project is a `project` with
`externalId` holding `22018`; the foreman is an `employee` whose
`externalId` is his code. Nothing new is needed — but the export has to
reproduce that header block, or the file it emits will not be recognisable as
the same document.

## The header matching bug

`apps/web/lib/csv.ts`'s `parseCsv()` trims header cells but does not lowercase
them. `apps/web/components/import-dialog.tsx` then checks required columns with:

```ts
const missing = spec.columns
  .filter((c) => c.required && !headers.includes(c.header))
  .map((c) => c.header);
```

`headers.includes(c.header)` is exact and case-sensitive. Every spec header is
lowercase (`"tag"`, `"model"`, `"serial"`). Urban's sheets are uppercase, and
one has a space and a `#` in it.

So a real sheet fails the required-column check before a single row is parsed,
with a message naming columns the user can plainly see in their file. This is a
bug independent of everything else here, and it must be fixed or none of the
rest matters.

Normalise on both sides, plus an alias table for the headers that differ by more
than case:

```ts
/* Sheets come from people, not from our template. "SERIAL #", "Serial#" and
   "serial" are the same column, and telling somebody their file is missing a
   column they can see in front of them is not a real error message. */
const HEADER_ALIASES: Record<string, string> = {
  "serial #": "serial",
  "serial#": "serial",
  "serial number": "serial",
  "qty": "quantity",
  "purchased on": "purchased_on",
  "date": "purchased_on",
  "other": "other",
};

function normalizeHeader(h: string): string {
  const k = h.trim().toLowerCase().replace(/\s+/g, " ");
  return HEADER_ALIASES[k] ?? k;
}
```

Apply it in `parseCsv` when building the row keys, so downstream code — which
looks up `row[column.header]` — keeps working unchanged against lowercase spec
headers. Keep the raw headers alongside the normalised ones for the preview
table, so the user still sees their own column names.

`DATE` mapping to `purchased_on` is a judgment call worth stating: on the
trailer sheets the date column is when the tool arrived on that trailer, which
for a newly bought tool is its acquisition date and for a moved one is not.
Mapping it to `acquisitionDate` is right for the common case and wrong for
transfers; the alternative is to ignore the column entirely, which loses real
information. Map it, and let the desk correct the exceptions.

## Import spec

In `packages/types/src/import-specs.ts`, replace the single `model` column in
`IMPORT_SPECS.asset`:

```ts
// remove
{ key: "modelName", header: "model", type: "text", required: true,
  example: "DeWalt DCH273 Rotary Hammer" },

// add, in the order the sheets use
{ key: "description", header: "description", type: "text", required: true,
  example: "Rotary Hammer",
  hint: "What the tool is, in your own words." },
{ key: "make", header: "make", type: "text",
  example: "DeWalt", hint: "Brand only." },
{ key: "modelNumber", header: "model", type: "text",
  example: "DCH273", hint: "The manufacturer's number. Blank is fine." },
```

`OTHER` maps to the existing `condition` column, not to `otherRef`:

```ts
{ key: "condition", header: "other", type: "enum", values: ASSET_CONDITIONS,
  valueAliases: { used: "good" },
  example: "new",
  hint: "NEW or USED on the trailer sheets. USED is recorded as good." },
```

`checkCell`'s enum branch is already case-insensitive — it lowercases the cell
and matches against lowercased spec values — so `NEW` resolves to `new` today
with no change. `USED` does not: `ASSET_CONDITIONS` is `new | good | fair |
poor | damaged`, and the yard's "used" means "good".

There is no value-alias mechanism on `ImportColumn` yet, so one has to be added.
It is small: an optional field on the column type, applied in `checkCell` before
the enum match.

```ts
// packages/types/src/import-specs.ts, on ImportColumn
/** Vendor and yard vocabulary folded onto ours. Keys are lowercase. */
valueAliases?: Record<string, string>;
```

```ts
// packages/api-contracts/src/routers/import.ts, in checkCell's enum branch
case "enum": {
  const lower = col.valueAliases?.[v.toLowerCase()] ?? v.toLowerCase();
  const match = col.values?.find((o) => o.toLowerCase() === lower);
  if (!match) return { error: `must be one of: ${col.values?.join(", ")}` };
  return { value: match };
}
```

Prefer this to widening `ASSET_CONDITIONS`. The enum is what the register means
by condition; "used" is what one vendor's paperwork calls it, and those are not
the same list. Widening the enum would put "used" alongside "good" as a distinct
condition forever, and nothing downstream would know they meant the same thing.

The unlabelled ninth column is where `otherRef` comes from, and a column with no
header cannot be matched by name. Two options, and the second is better:

- Ask the yard to add an `OTHER REF` header to the sheets. Depends on people
  changing a habit, which is the thing this document exists to avoid.
- Have the parser name unlabelled trailing columns positionally —
  `column_8`, `column_9` — and let the spec alias `column_8` to `otherRef` for
  the asset entity. Ugly, and it is the only option that reads the file as it
  actually exists.

Either way `otherRef` is doing two jobs in that column: an equipment number
(`PC-08`) and a status note (`RETURN 1/19/24`). Import both verbatim. A returned
tool is a custody event, and text in a column will never trigger anything, but
parsing English out of a spreadsheet cell is worse — the desk can clean those
few rows by hand.

`description` is the required one, not `make`. A sheet row can plausibly lack a
brand — `"7-1/4\" WARM DRIVE CIRCLE SAW  SKILL SAW"` has the brand in the
description already — but a row with no description is not a tool record. This
matches the router rule in `docs/built/12-model-field-split.md`: at least one of make
or description, with description the one the importer insists on.

## The sheets have no asset tag

`IMPORT_SPECS.asset` has `tag` as `required: true`. Urban's sheets have no tag
column. Running a real sheet through the fixed header matching gets as far as:

```
required in spec         : tag, model
missing after normalising: tag
```

Every other column now resolves. `tag` cannot, because it is not in the file and
never has been — the yard identifies a tool by its serial number and, for some
categories, by the equipment number in the unlabelled column (`PC-08`).

**Resolved: tags become optional.** A tag is a physical label somebody puts on a
tool, not an identity the system assigns, so it exists in the register only once
that has happened. `docs/built/17-optional-tags.md` specifies it, including what
identifies an untagged tool on screen and how one gets tagged later.

An earlier draft of this document recommended generating a `UIC-xxxx` per row on
import. **Do not build that.** A generated number that is not written on the
tool is right in the register and absent in reality, and it makes the list of
tools still needing labels impossible to produce.

The dedupe consequence is in doc 17 and is worth reading before importing
anything twice: a row with neither a tag nor a serial cannot be matched against
an existing row at all.

## Export

`ReportTable`'s existing `exportCsv()` in
`apps/web/components/sti/report-table.tsx` is not sufficient for this:

```ts
function exportCsv() {
  downloadCsv(`${filename}-...`, [
    cols.map((c) => c.header),
    ...sorted.map((r) => cols.map((c) => raw(r, c))),
  ]);
}
```

It emits whatever display columns a report screen happens to define — pretty
headers like "Charged to", money-formatted costs, joined names instead of
references, and no `warranty_expires` or `quantity` at all. Fine as a
human-readable dump, useless as something to re-import.

Build a separate export driven by the import spec itself, so the two share one
source of truth rather than two column lists that drift:

```
function exportAssetsToSpec(rows: AssetRow[]): string[][] {
  const cols = IMPORT_SPECS.asset.columns;
  return [
    cols.map(c => c.header),
    ...rows.map(row => cols.map(c => {
      const v = row[c.key];
      if (v == null) return "";
      if (c.type === "ref") return refName(row, c.ref);   // the NAME, never the uuid
      if (c.type === "decimal") return String(v);         // raw, not money-formatted
      return String(v);
    })),
  ];
}
```

Two rules that make it round-trip, and both are easy to get wrong:

- `ref` columns must emit the human name — `"Dallas Yard"`, not a uuid — because
  that is what the importer resolves. The spec's own comment says so.
- numeric columns must be raw. `"$489.00"` will not re-import as `489.00`.

Wire it as a button on the Tool Register page,
`apps/web/app/(app)/tools/page.tsx`, next to the existing import button. Not
inside `ReportTable` — that component's export serves a different purpose and
should keep doing it.

### The per-trailer export

Separately, an export that reproduces the sheet above: pick a location of type
`vehicle`, emit its header block (trailer name, custodian name, project name and
code), then its tools in the sheet's column order. This is the artefact a foreman
recognises, and it is what makes the system credible to people who currently
keep the sheet by hand.

Same column set as the spec-driven export, so it re-imports; only the header
block differs. Put it on the location detail screen rather than the register.

## Reading .xlsx

The pipeline is CSV-only today. `apps/web/lib/csv.ts` hand-rolls a quote-aware
parser and `import-dialog.tsx` reads the file as text. The sheets are `.xlsx`
workbooks, and asking the yard to "save as CSV" first is the kind of instruction
that quietly kills adoption.

Add `xlsx` (SheetJS) as a dependency of `apps/web`. The change is confined to
the file-reading step:

```
onFile(file):
  if file name ends .xlsx or .xls:
      buf   = await file.arrayBuffer()
      wb    = XLSX.read(buf, { type: "array" })
      sheet = wb.Sheets[wb.SheetNames[0]]
      rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" })
              // -> string[][], the same shape parseCsvRows already returns
      feed rows into the existing header-normalising path
  else:
      existing parseCsv(text) path
```

Nothing else changes — not the spec, not the router, not validation. Two details
worth pinning: `raw: false` so dates come back as the displayed strings rather
than Excel serial numbers, and `header: 1` so the result is positional arrays
matching the CSV path exactly.

The trailer sheets have a title block above the header row, so the parser needs
to find the header row rather than assuming row 0 — scan the first few rows for
one containing a recognised header after normalisation, and treat everything
above it as preamble.

## Order of work

1. `apps/web/lib/csv.ts` — `normalizeHeader`, aliases, applied in `parseCsv`
2. `apps/web/components/import-dialog.tsx` — match on normalised headers, keep
   raw ones for display; header-row detection for files with a title block
3. `packages/types/src/import-specs.ts` — the four column changes
4. `packages/api-contracts/src/routers/import.ts` — verify the `prepare`/
   `checkCell` path needs no change (it reads `row[column.header]`, so
   normalising at parse time should be sufficient — confirm rather than assume)
5. Spec-driven export helper plus the button on `tools/page.tsx`
6. `xlsx` dependency and the reader branch
7. Per-trailer export on the location detail screen

## Verification

The test that matters is a round-trip:

- Take a real trailer sheet, unmodified, uppercase headers and all. Import it.
  It should be accepted, not rejected for missing columns.
- Check the preview shows the user's own header names, and that `SERIAL #`
  values land in the serial column.
- Commit the import. Confirm make, model number and description are separate in
  the register, not one string.
- Export the register. Re-import the exported file. No new rows should be
  created — the dedupe on `tag`/`serialNumber` should recognise every one as
  existing. That is the round-trip proof.
- Export a trailer and confirm the header block names the trailer, the foreman
  and the project code.
