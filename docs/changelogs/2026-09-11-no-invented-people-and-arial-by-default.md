# No invented people in the real register, and Arial by default

Two unrelated changes that shipped together, both prompted by looking at the
production register for the first time with real data in it.

## Invented people reached production

The urban dataset carried two synthetic employees — **Karen Osei**
(equipment_admin) and **Yard Desk** (warehouse), both on `@urban.local`
addresses — left over from the demo fixture's cast. They were seeded into
production alongside Urban's 81 real people.

A person who does not exist is not a harmless placeholder here. This tenant's
roster is about to be reconciled against BambooHR, and the sync matches on
external ref then name: an invented name matches nobody, so it survives every
sync forever, looking exactly like a real employee who happens never to update.

Neither held a tool, a crew row, a project posting or a login, which is what
made deleting them correct rather than a merge problem. `employeeSpecs` is now
81 rows, all real.

The stale comment above `userSpecs` claimed those accounts referenced eight
employee keys including `e-karen` and `e-yard`. They do not — both administrator
accounts carry `employeeKey: null`, because they are Optix's own and belong to
no employee. Comment corrected rather than left to mislead the next reader into
thinking the rows were load-bearing.

## Arial is the default typeface

`fontFamily` defaulted to `"system"`, which resolves to whatever the operating
system supplies — SF on a Mac, Segoe on Windows, something else on a field
tablet. The product looked materially different desk to desk and no rendering
was "the" product. Arial is present on every machine the yard uses.

Changed in **both** places that define it, because they must agree: `DEFAULT_PREFS`
in the web app (what a person sees before any preferences row exists) and the
`font_family` column default (what they get once one is created). If those two
disagreed, the type would change under a person on their second visit for no
reason they could see.

`FONT_FAMILIES.arial` takes the mono slot as well as sans, so codes, tags and
quantities render in Arial and lose the column alignment JetBrains Mono gave
them. That was the explicit choice — one uniform face over aligned numerals —
and every other option is still one click away in Settings.

Migration `0066` carries the column default **and an UPDATE**. The default alone
would only reach accounts created afterwards, so everybody already using the
product would never see the change they asked for. The UPDATE is scoped to rows
still holding `'system'`, so anyone who deliberately picked mono, serif or
verdana keeps their pick — this moves the people who never expressed one, which
is what a default is.

## What was found while building it

**A stale container mount looks exactly like a broken test suite.** The
api-contracts run failed with `ENOENT: /workspace/package.json` from a PostCSS
config lookup, immediately after `pnpm db:generate` wrote into the same mount.
The file was present when checked directly. `docker compose restart api` fixed
it and all 389 tests passed. Worth recognising before debugging the tests
themselves.

## Verified

- Seed against a fresh database: 81 employees, 0 of them non-`URB-`, and all 753
  assets, 39 trailers, 49 trucks and 673 ledger rows still land.
- Migrations replay to 66 on an empty database; `font_family` default reads
  `'arial'`.
- api-contracts 389 tests, 0 skipped. `pnpm typecheck` 13/13, `pnpm lint` 0
  errors, `pnpm db:generate` reports no drift.

**Not verified:** nothing was clicked in a browser; the font change was not
looked at rendered.

## Deliberately not done

- **The 81 `URB-nnn` people were left in place.** They are Urban's real staff
  from the workbook. The codes are placeholders minted by the seed generator
  because neither source CSV carried an employee number, and `bamboo-sync.ts`
  already says so in a comment: BambooHR's `employeeNumber` will be the first
  real badge number this system sees, which is why the sync proposes it for
  confirmation rather than swapping it in. Deleting these people before the sync
  would orphan 673 custody records and leave the sync nothing to match against.
- **No theme default change.** `blocky` already is the default.

## Where it is

Branch `development`.
