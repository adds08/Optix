# A header that says something, and a Name column that was never really there

Phase 6 of the seven-phase plan tracked in
`/Users/adds08/.claude-personal/plans/imperative-beaming-puzzle.md`: People
and Projects page headers. Small in scope, and it caught a real layout bug
that had been sitting on the People register invisibly — found only because
this phase was the first one to actually look at a screenshot rather than
check that header text existed in the DOM.

## What changed

Both pages hand-rolled their own single-line `<h1>` instead of using the
shared `PageHeader` component (`apps/web/components/sti/page.tsx`), which
already supports an icon, a description, and actions in one consistent
layout. Switched both, with one line each: People —
"Everyone who can hold a tool or sign in — foremen, mechanics, and the
account they may or may not have."; Projects — "The jobs tools and people
are assigned to, and what gets charged against them."

Removed the vestigial "Everyone" section heading on People. There was never
a second section it was distinguishing from; the register now sits directly
under the page header, matching every other screen in the app.

Reduced each page's own outer wrapper from `gap-6` to `gap-4` — scoped to
these two pages, not the shared `app-shell.tsx` content padding, which a
prior phase already declined to reopen (this repo has an explicit
"comfortable is the default" density decision on record).

## What was found while building it

**People's "Name" column was effectively invisible**, caught by looking at
an actual screenshot rather than trusting that the header text was present.
`Name` and `Primary project` had no declared width — under this table's
`table-fixed` layout, an unwidthed column gets "whatever's left over" after
every explicit-width column takes its share. With Employee Code (added in
Phase 2) plus Role, Account, Status, Tools held and Value held already
claiming roughly 56rem between them, the two unwidthed columns were squeezed
to a couple of pixels each — technically present, functionally gone. Both
now have real declared widths (14rem and 12rem), matching the convention
already used elsewhere for the column people actually read (`tools/page.tsx`'s
"Tool" column, 20rem).

This most likely predated this phase — `Primary project` had no width before
Phase 2 either, so it was already squeezed alongside the old combined
name-and-code column. Phase 2 quietly made it worse by adding a third
competing explicit-width column without anyone looking at the result. Worth
remembering: a passing header-text check proves the column exists, not that
anyone could read it.

## Verified

- `pnpm typecheck` clean for `@stinventory/web`.
- Full e2e suite: 68/68 passing, unchanged from Phase 5 — nothing in the
  committed suite exercises these two pages' headers or column widths
  directly.
- Wrote and ran (then deleted, not committed) a throwaway spec with real
  screenshots of both pages, which is what caught the Name column issue
  above and confirmed the fix. This is the first phase in this plan where a
  screenshot rather than a DOM-text assertion caught something — worth
  carrying into Phase 7, which is entirely visual layout work.

## Deliberately not done

- **No change to the global content wrapper's padding.** Only these two
  pages' own header-to-table spacing moved.

## Where it is

Branch `development`, uncommitted at the time of writing, on top of Phases
1–5's diff in the same working tree.
