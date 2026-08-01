# Splitting the model field

`asset.modelName` is one `not null` text column holding everything about what a
tool is: `"DeWalt DCH273 Rotary Hammer"`. Brand, catalogue number and
description, in one string, with no separator anybody agreed on.

Urban does not record equipment that way. The real logs — the trailer sheets
kept per foreman, exported from United Rentals and maintained by hand — have
separate columns:

```
DATE | QTY | DESCRIPTION | MAKE | MODEL | SERIAL # | OTHER | (unlabelled)
```

Until the register speaks that shape, import cannot round-trip, export cannot
reproduce a sheet anyone recognises, and no report can answer "how many Bosch
tools do we own" — because the brand is buried in the middle of a sentence.

This splits the column. It is the largest change in this sequence: roughly
a hundred call sites across thirty-seven files, in five packages and three
apps.

## The two conventions already in the codebase

Worth knowing before touching anything, because they contradict each other and
the migration has to pick one.

`packages/db/src/seed.ts` sets `asset.modelName` from a manufacturer-*less*
string — `"TE 60-ATC Rotary Hammer"` — because seed also populates
`asset_model.name` and keeps the make in the separate `manufacturer` table.

Everywhere else — the import spec's example, the LLM prompt's example, actual
usage — treats it as the full `"Make Model Description"` blob.

So there is no single existing convention to preserve. That is a reason to split
rather than to keep patching.

## What replaces it

Four nullable columns on `asset`, in `packages/db/src/schema/asset.ts`:

```ts
/* What the tool is, in the four columns Urban's own sheets use. Replaces the
   single `model_name` blob — see docs/12-model-field-split.md. */
make: text("make"),
modelNumber: text("model_number"),
description: text("description"),
/* The unlabelled trailing column on the trailer sheets: a secondary equipment
   number ("PC-08", "QS-602", "106"). Free text because the yard's numbering is
   not ours to constrain. Note this is NOT the sheets' "OTHER" column, which
   holds NEW/USED and maps to `condition` — see docs/13-excel-round-trip.md. */
otherRef: text("other_ref"),
```

All four nullable at the database level. `modelName` today is `not null`; that
constraint goes.

Requiredness moves to the router's zod schema: **at least one of `make` or
`description`**. Not all three — a tool with a brand and no catalogue number is
completely ordinary, and demanding a model number would make half the register
unenterable.

| Sheet column | Column | Notes |
|---|---|---|
| MAKE | `make` | "Bosch", "STIHL", "DeWalt" |
| MODEL | `modelNumber` | "11255VSR", "GWS10-450P". Often absent |
| DESCRIPTION | `description` | "Hammer Drill Extreme Bull Dog" |
| SERIAL # | `serialNumber` | Already exists, unchanged |
| OTHER | `condition` | Already exists. Holds NEW/USED, not a reference number |
| (unlabelled) | `otherRef` | "PC-08", "QS-602", "106" |
| QTY | `quantity` | Already exists |
| DATE | `acquisitionDate` | Already exists |

Read that table against the real sheet before trusting it. `OTHER` is the
condition column — `NEW`, `USED` — and the equipment numbers sit in a further
column with no header at all. Getting those two the wrong way round puts
`PC-08` into a condition enum and `USED` into a reference field, and neither
fails loudly.

`otherRef` is specified here rather than in the import document because it is a
column on `asset` and belongs in the same migration. Splitting it into a second
migration would touch this table twice in a row for no benefit.

That unlabelled column is doing two jobs: a secondary number (`PC-08`) and a
status note (`RETURN 1/19/24`, in red). Import both verbatim into `otherRef`. A
returned tool is really a custody event, and text in a column will never appear
in a report or trigger anything — but parsing English out of a spreadsheet cell
is worse, and the desk can clean up the few rows that need it.

## Dropping `modelName`

Drop the column. Do not keep it as a generated or computed column.

A generated column (`make || ' ' || model_number || ' ' || description`) would
let every one of those call sites keep working untouched, which sounds like
a mercy and is actually the failure mode: the split would sit half-finished
forever, with new code reading the compatibility column because it is easier.

This is a one-way door. It is acceptable here because the current asset rows are
not production data — they are seed data and experiments from a United Rentals
sheet.

### Backfill

Deliberately crude:

```sql
update asset set description = model_name where model_name is not null;
alter table asset drop column model_name;
```

Everything lands in `description`; `make` and `modelNumber` stay null. No
parsing heuristic. `"DeWalt DCH273 Rotary Hammer"` has no reliable split point —
is `DCH273` the model number or part of the description? Is `"Skill Saw"` a
brand or a description? A heuristic would be wrong on many rows and, worse,
wrong invisibly. Re-entering the handful of real rows by hand is cheaper and
verifiable.

`seed.ts` must be rewritten to set `make`/`modelNumber`/`description` directly
rather than synthesising one string through `assetModel`.

## What stays untouched

`asset_model`, `manufacturer` and the `asset.modelId` FK stay exactly as they
are. They are already dead weight — nothing in any router, the intent package,
the import path or any UI reads or writes through them; only `seed.ts` populates
them, and nothing joins back.

After this split they will look like an obvious duplicate of the new flat
columns, which invites a "let us normalise this properly while we are here"
detour mid-migration. Do not take it. Add a comment on `asset.ts` marking them
vestigial and superseded, and leave the cleanup to its own change.

## The shared display helper

Fifteen or so places currently render `modelName` directly. They should not each
invent their own join.

It goes in `packages/types` — specifically a new
`packages/types/src/format.ts`, re-exported from `index.ts`.

Not `packages/frontend-shared`, despite the name. That package is dead: nothing
declares it as a dependency and nothing imports it anywhere in the repo. Both
`apps/web` and `apps/mobile` depend on exactly two workspace packages,
`@stinventory/types` and `@stinventory/api-contracts`, so a helper placed in
`frontend-shared` would be unreachable without first wiring up a new dependency.
Its `types.ts` row types are likewise unused and are not the shared contract
they look like — do not update them as part of this work, and do not trust them
as a description of what the apps render.

```ts
/* One place that decides how the four columns read as a single line, so a
   register row, a chat card, a report and an overdue email cannot disagree
   about what a tool is called. */
export function formatAssetModel(a: {
  make?: string | null;
  modelNumber?: string | null;
  description?: string | null;
}): string {
  return [a.make, a.modelNumber, a.description].filter(Boolean).join(" ");
}
```

Most display sites become `formatAssetModel(row)`. `apps/api` can import it too
— it already depends on `@stinventory/types` — so `notifications.ts` and
`rest-routes.ts` use the same function rather than their own join.

The row shapes the apps actually render come from `@stinventory/api-contracts`
via tRPC inference, not from a hand-written type, so they follow the routers
automatically once the selects change. There is no separate row-type file to
update.

## The two places needing real logic, not renames

Everything else is a type change and a rename. These two are behaviour.

### Chat entity resolution

`apps/api/src/entity-resolve.ts` is how "the rotary hammer" in a message becomes
asset UIC-1012. It does one `ilike` against `modelName`, and builds a label from
it.

```
// before
where: and(eq(asset.tenantId, tid), ilike(asset.modelName, `%${token}%`))
label: `${a.tag} (${a.modelName})`

// after
where: and(
  eq(asset.tenantId, tid),
  or(
    ilike(asset.make, `%${token}%`),
    ilike(asset.modelNumber, `%${token}%`),
    ilike(asset.description, `%${token}%`),
  ),
)
label: `${a.tag} (${formatAssetModel(a)})`
```

Match precision loosens slightly — a token can now hit three columns instead of
one. That is acceptable: the existing match is already a loose substring `ilike`,
and a foreman saying "the Bosch" should match on brand, which today it cannot.

The same file's `resolveCustodian` also needs the `CUSTODIAN_ROLES` widening from
`docs/11-department-cost-targets.md`. Both changes are in one function's
neighbourhood; do them together.

### The intake gate

`apps/api/src/messaging-worker.ts` decides whether a chat-driven registration is
complete enough to offer as a confirmable card, or whether it goes to manual
entry. Today:

```ts
if (engineResp.intent === "intake" && !(engineResp.draft?.tag && engineResp.draft?.modelName)) {
  await markPendingManual();
  return;
}
```

The comment above it explains the reasoning: small models routinely catch the tag
and drop the model name, and a card that can only fail on confirm is worse than
no card.

Post-split, requiring all three new fields would push almost every chat intake
into manual entry and kill the feature. The gate becomes:

```ts
const d = engineResp.draft;
if (engineResp.intent === "intake" && !(d?.tag && (d?.make || d?.description))) {
  await markPendingManual();
  return;
}
```

A tag plus something descriptive. Mirror the same rule in `applyIntake`'s
validation in `packages/api-contracts/src/apply-action.ts`, which currently
throws `"A new tool needs a model name before it can be registered"` — the two
must agree, or a card that passes the gate can still fail on confirm, which is
exactly what the gate exists to prevent.

The same file's `request_purchase` draft construction and its draft pass-through
block both build `{ modelName }` shapes and need rewriting to the three fields.

## The LLM prompt

`packages/intent/src/prompt.ts` currently says:

> Fill `draft` with what the message actually states: `tag`, `modelName`, and
> `serialNumber`, `categoryName`, `acquisitionCost` if given.

It needs to say what each of the three fields means, or the model will put the
whole phrase in one of them:

```
Fill `draft` with what the message actually states:
  - `make`: the brand only, if named. "Bosch", "DeWalt", "STIHL".
  - `modelNumber`: the manufacturer's catalogue number, if stated.
    "11255VSR", "DCH273". Leave null when the message does not give one —
    most messages do not.
  - `description`: what the thing is, in the speaker's own words.
    "rotary hammer", "14 inch quikie saw".
  - `tag`, `serialNumber`, `categoryName`, `acquisitionCost` if given.

"a DeWalt DCH273 rotary hammer" is make "DeWalt", modelNumber "DCH273",
description "rotary hammer". "the big grinder" is description only.
```

`AssetDraft` in `packages/intent/src/parse.ts` grows the three fields;
`normalizeDraft` gets three `draftField()` calls instead of one. The existing
`NOT_STATED` flattening applies unchanged to each — small models emit `""`,
`"N/A"` and `"unknown"` in every field, not just one.

`packages/intent/src/parse.test.ts` asserts a single-string round-trip and needs
rewriting for three fields, including a case where only `description` is filled.

## Order of work

Follow this order. The type errors from each step point at the next.

1. **Schema** — four columns, drop `modelName`, migration with the crude
   backfill, rewrite `seed.ts`
2. **`packages/types/src/format.ts`** (new) — `formatAssetModel()`, re-exported
   from `packages/types/src/index.ts`
3. **Intent** — `prompt.ts` guidance, `parse.ts` `AssetDraft` and
   `normalizeDraft`, `parse.test.ts`
4. **`apply-action.ts`** — `AssetDraft` type, `applyIntake` validation and
   insert, the draft label line
5. **Routers** — `asset.ts` (select, search `ilike` across three columns,
   create, update), `entity.ts` (typeahead label and search), then the
   display-only selects in `report.ts`, `messaging.ts`, `transfer.ts`,
   `transaction.ts`, `assignment.ts`, `dashboard.ts`
6. **`apps/api`** — `entity-resolve.ts` and `messaging-worker.ts` per above,
   then `notifications.ts` and `rest-routes.ts` which are plain swaps to
   `formatAssetModel`
7. **`apps/web`** — `asset-form.tsx` becomes three inputs; then the display
   sites: `assign-form.tsx`, `sti/asset-card.tsx`, `tools/page.tsx`,
   `tools/[id]/page.tsx`, `activity/page.tsx`, `people/page.tsx`,
   `people/[id]/page.tsx`, `my-tools/page.tsx`, `custody/page.tsx`,
   `reports/[slug]/page.tsx`; and `chat/page.tsx`'s `DraftFields`
8. **`apps/mobile`** — four display sites: `(tabs)/index.tsx`,
   `(tabs)/alerts.tsx`, `tool/[id].tsx`, `action/[type].tsx`
9. **`packages/types/src/import-specs.ts`** — see
   `docs/13-excel-round-trip.md`
10. Full `pnpm typecheck` and `pnpm test`

### Notes on specific sites

`apps/web/app/(app)/reports/[slug]/page.tsx` has three report column
definitions using `modelName`. Use one `formatAssetModel` column in the on-screen
table — three separate columns crowd it — but expose all three raw fields in the
CSV export, which is what makes the export re-importable.

`apps/web/app/(app)/chat/page.tsx`'s `DraftFields` is the highest-visibility
change in this phase. It is the confirmation card a foreman sees before
registering a new tool, and it goes from one field to three. Keep it scannable:
the whole point of that card is that a wrong serial is cheaper to catch there
than after it is in the register.

`packages/api-contracts/src/routers/asset.ts`'s search currently does one `ilike`
on `modelName` alongside tag and serial. It must search all three new columns or
the register's search box quietly stops finding things by brand.

## Verification

- `pnpm typecheck` clean. Ninety call sites means the compiler is the primary
  instrument here; a clean typecheck is most of the proof.
- `pnpm test` — `parse.test.ts` rewritten and passing.
- Register a tool from the web form with all three fields, and one with only
  make and description. Both should save.
- In chat: "register a DeWalt DCH273 rotary hammer, tag UIC-1099, serial 4471X"
  should produce a card with make, model number and description filled
  separately. "put in a new grinder, tag UIC-1100" should also produce a card,
  not drop to manual review — that is the relaxed intake gate.
- Search the register for "Bosch" and confirm it returns Bosch tools. That is
  the thing which could not work before this change.
