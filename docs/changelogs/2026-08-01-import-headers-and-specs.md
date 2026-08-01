# Import headers match by meaning; specs written and audited

Commits `0bd343e`, `eee611d`, `72e6412`. **Committed, not deployed** — the
droplet is still running the previous build.

## The bug

A sheet with `MAKE` and `SERIAL #` was rejected for missing columns the user
could see in front of them.

Import specs declare lowercase headers. The required-column check in
`import-dialog.tsx` was `headers.includes(c.header)` — exact and case-sensitive.
The sheets are kept by people, not generated from our template.

`parseCsv` now folds each header on the way in: case and whitespace by rule, and
a short alias table for names differing by more than that, so `SERIAL #`,
`Serial#` and `serial` are one column. Raw headers are kept alongside and quoted
back in the error, because the useful question when this fails is what the
parser actually saw.

Verified against the real TE-006 header row, not a fixture:

```
raw headers : DATE | QTY | DESCRIPTION | MAKE | MODEL | SERIAL # | OTHER
normalised  : purchased_on | quantity | description | make | model | serial | other
row 1 serial: "331009023"
row 2 desc  : "4- 1/2\" ANGEL GRAINDER"
```

`MODEL ` with its trailing space resolves; the quoted field's embedded quote
survives.

## Specs written

`docs/11` through `docs/15`, covering department cost targets, the `modelName`
split, the Excel round-trip, dashboard additions, and a vendors/orders roadmap.
Plus `docs/16-handoff-brief.md` as the orientation for whoever implements them.

## Found while auditing the specs

The audit was worth more than the writing. Six things were wrong or unknown:

**Urban's sheets have no asset tag column, and `tag` is required *and* unique.**
So no real sheet imports even with the header fix. This is not a code bug — it
is a gap between what the register demands and what the yard records.

Resolved the same day: tags become optional, and generating them was rejected. A
tag is a physical label somebody puts on a tool, not an id the system assigns —
a generated number that is not written on the tool is right in the register and
absent in reality. Specified in `docs/17-optional-tags.md`.

**`OTHER` is the condition column** — `NEW`/`USED` — not a reference number. The
equipment numbers (`PC-08`, `QS-602`, `106`) sit in a further column with **no
header at all**, which cannot be matched by name. Two specs had these reversed,
which would have put `PC-08` into a condition enum and `USED` into a reference
field. Neither fails loudly.

**`checkCell`'s enum branch is already case-insensitive**, so `NEW` resolves to
`new` today. Only `USED` fails, and there is no value-alias mechanism for it —
the spec originally said to put it in the header alias table, which maps column
names, not values. Specified the small addition it needs instead.

**`packages/frontend-shared` is dead.** Nothing depends on it, nothing imports
it. A spec had placed the shared display helper there claiming both apps already
imported it; they depend on exactly `@stinventory/types` and
`@stinventory/api-contracts`. Its row types are not the shared contract they
look like.

**`ROLE_PERMS` gives `owner` and `equipment_admin` `[...PERMISSIONS]`**, so new
permissions reach both with no seed edit. A spec said to grant them by hand.

**The dashboard `attention` count already includes borrows**, so the warning
about it was backwards — the trap is rewiring it to the filtered list, not
leaving it alone.

The `modelName` split is 105 call sites across 37 files, not the ~90/30
originally estimated.

## Also

Dropped an unused `sql` import in `apps/api/src/notifications.ts` so the handoff
starts with `pnpm lint` clean. Typecheck 12/12, 130 tests passing.
