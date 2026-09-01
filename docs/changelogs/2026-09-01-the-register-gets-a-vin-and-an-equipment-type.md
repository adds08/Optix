# The register gets a VIN, and an equipment type somebody can actually set

Two questions asked of the equipment register on the day Urban's fleet was
imported: where does a VIN go, and why does adding an "attachment" category
need schema work. The first turned out to be a silent data loss. The second
turned out to need much less than had been claimed, and the claim is worth
correcting because it was made in this repo's own notes.

## What changed

### VIN has a column, and had been going nowhere

`docs/data/import/vehicles.csv` carries a VIN for every truck in the company
vehicle list. Nothing consumed it. There was no `vin` column on `vehicle`, no
field in the create or update input, and no input on the form — so the import
read forty-nine VINs, loaded forty-nine trucks, and dropped every VIN on the
floor while reporting success. That is the expensive kind of missing field: the
register looked complete.

Migration `0040` adds `vin text` — nullable, no unique index, no length check.
That is deliberate and the reason is in the column comment: the real data has
neither property. `TRK-10001`'s VIN is sixteen characters where seventeen is
standard, and five trucks share an improbable `1FTEW1KP6RKD` prefix that reads
as hand-typed. A unique index or a CHECK would abort the whole import over one
typo rather than let the row land and be corrected. Format is checked by
`build_import.py` and reported in `rejects.json`, never enforced at the write.

### `equipment_class` needed a vocabulary and a control, not a schema change

The register has carried `equipment_class` since it was split from small tools,
and it is plain `text` with no constraint — so the database would have accepted
new values all along. What was missing was that **no form ever wrote the
column**, which is why `heavy` had been unreachable since the day it was added:
every row in every database held the default.

`EQUIPMENT_CLASSES` in `packages/types` now reads `vehicle | attachment | heavy
| other`, with `EQUIPMENT_CLASS_LABELS` beside it so the strings are not
hand-written at call sites. `vehicle-form.tsx` gains an "Equipment type" picker
that defaults to the obvious answer for the structural type — a trailer offers
`attachment` — and stops following the type once the row exists or the person
has chosen something else.

`0040` also backfills existing trailers to `attachment`, keyed off
`vehicle_type` rather than a list of units, and skips any row already carrying a
non-default class. Without it the new category would have been true of nothing
until forty rows were edited by hand.

### The two "type" columns answer different questions

Worth stating plainly, because conflating them is the trap here:

| Column | Question | Changeable |
|---|---|---|
| `vehicle_type` | truck or trailer — structural | **No.** `assignment.truck_id`/`trailer_id` reference `vehicle_id_type_uq` on `(id, vehicle_type)` through composite FKs with a generated constant. Retyping a row to `attachment` orphans every assignment naming it. |
| `equipment_class` | how the yard files it | Yes. Nothing references it. |

A trailer is `vehicle_type: 'trailer'` AND `equipment_class: 'attachment'`, and
both are true at once. Putting the category on `vehicle_type` would have been
the obvious move and would have broken custody.

## What was found while building it

**"Needs schema work" was wrong, and it was written down.** The previous
changelog and the session notes said the equipment taxonomy needed a migration.
It needed a migration for the *backfill* only; the column already existed and
already had no constraint. The real blocker was that nothing in the UI could
write it — a missing control reading as a missing column.

**Both equipment pages carried the same inline conditional.**
`equipmentClass === "heavy" ? Wrench : Truck` appeared in the register list and
the detail page. Correct for two values; silently wrong for four, since an
attachment would draw a truck on both pages and nothing would fail. Moved to
`apps/web/lib/equipment-icon.ts` as one definition, falling back rather than
throwing on an unknown value because the column has no database constraint and a
register that renders beats one that is certain. This is the same drift that
produced three disagreeing custodian pickers before `CUSTODIAN_ROLES` existed.

**The seed hardcoded `equipmentClass: "vehicle"`** for every row, so even after
the vocabulary existed the seeded register would have filed all its trailers
wrong. It now takes the value from the dataset and falls back on the structural
type.

## Verified

- `pnpm typecheck` and `pnpm lint` clean; `turbo run test` green across every
  package inside the api container.
- Migration journal checked for the defect `0024` documents — forty entries, no
  duplicates, every SQL file referenced and every entry backed by a file.
- After `SEED_DATASET=urban`, `select equipment_class, vehicle_type, count(*),
  count(vin)` returns trailers filed as `attachment` with no VIN and trucks as
  `vehicle` with a VIN on every one; `code` is populated from the unit number.
- The demo dataset files itself the same way through the seed's fallback.
- The backfill statement was re-run against already-migrated data to confirm it
  is idempotent.

**Not verified:** no browser was opened. The Equipment type picker and the VIN
input were typechecked and linted, not clicked, so how they sit in the form's
two-column grid is unconfirmed.

## Deliberately not done

- **`import-specs.ts` was not extended.** The Excel vehicle import still offers
  neither `vin` nor `equipmentClass` as columns, so a spreadsheet round-trip
  cannot set them yet. That is its own change with its own header-matching
  rules.
- **No constraint on `vin`.** Argued above; revisit only with data clean enough
  to survive it.
- **`heavy` was not given a `vehicle_type` of its own.** The schema comment
  proposes plant types living in `vehicle_type` for `equipment_class: 'heavy'`
  rows. Nothing needs it until a real excavator is registered, and the composite
  FKs make that a considered change rather than an additive one.

## Where it is

Commit `646c98d` on `development`. Migration `0040_bumpy_sersi.sql` applies on
API boot, so any environment picks it up on its next deploy — including the
backfill, which runs once per database.
