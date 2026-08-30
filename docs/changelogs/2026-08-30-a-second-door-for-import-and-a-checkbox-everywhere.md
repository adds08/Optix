# A second door for import, and a checkbox on every register

Phase 4 of the seven-phase plan tracked in
`/Users/adds08/.claude-personal/plans/imperative-beaming-puzzle.md`. Two
changes, both mechanical repetitions of patterns that already existed and
were proven on one register — the point of this phase was making every other
register agree with the one that got there first.

## What changed

### Import has two doors now, one open and one named

`ImportButton` was a single click straight into the CSV/Excel flow. It's now
a dropdown: "Import from CSV" opens the exact same template → preview →
commit dialog, unchanged; a second item, "AI Import", is disabled and
carries a "Coming soon" badge. Named in the UI now rather than invented
later — the tenant feature-flag work planned for the next phase needs a real
place to switch this on (`import.ai`, as an `upcoming` tenant feature), and
building that switch is more honest with a real target already sitting in
the interface than with a button that appears out of nowhere once the flag
system exists.

### Every register gets a checkbox, not just tools

`enableSelection` — the checkbox column, proven and already in daily use on
the tools register — is now on by default across the app: `people/page.tsx`,
`projects/page.tsx`, all three tables on `custody/page.tsx` (held tools,
transfers, the approval queue), both tables on `people/[id]/page.tsx` (held
tools, posting history), and `reports/audit-trail/page.tsx`. No bulk action
reads any of this selection yet on the newly-enabled tables — each page just
holds local state the same shape `tools/page.tsx` already did, ready for
whichever bulk action arrives first to read it.

## What was found while building it

**One Phase 2 rename had missed a table.** `people/[id]/page.tsx`'s posting
history — where somebody has worked, job by job — still called
`project.externalId` "Cost code", the pre-Phase-2 label everywhere else was
renamed away from. Fixed to "Project Code" to match.

## Verified

- `pnpm typecheck` clean for `@stinventory/web`.
- The full existing e2e suite (`pnpm --dir e2e exec playwright test`, host
  against the live Docker stack): all passing, including
  `table-columns-align.spec.ts`, which checks that a table's header and body
  carry the same column count — the exact thing `enableSelection` could get
  wrong if the checkbox column were added to only one of them.
- A throwaway spec (written, run, then deleted — not committed) confirmed in
  a real browser: the import dropdown opens with both items, "Import from
  CSV" opens the real dialog, "AI Import" renders `data-disabled`; and that
  every touched register now shows a checkbox per row plus a select-all in
  the header.
- One assertion in that same throwaway spec — navigating to a person's
  detail page via "click the first link in the first row" — was flaky on a
  full-suite re-run after passing in isolation. Not chased further: it was
  the throwaway test's own brittle navigation at fault, not the feature,
  which the isolated run had already confirmed working, and the file is
  deleted either way.

## Deliberately not done

- **No bulk action anywhere yet.** The selection state exists and is wired;
  nothing reads it. That's the explicit ask for this phase — the checkbox
  first, the action whenever one is asked for.
- **AI Import stays a static disabled item**, not yet backed by the tenant
  feature-flag system — that's the next phase, and this is the placeholder
  it will replace.

## Where it is

Branch `development`, uncommitted at the time of writing, on top of Phases
1–3's diff in the same working tree.
