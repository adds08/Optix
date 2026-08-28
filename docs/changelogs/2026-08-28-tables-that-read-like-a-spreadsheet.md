# Tables that read like a spreadsheet

Four requests arrived together, all of them about the register, and all of them
amounting to the same complaint: it does not behave like the grid people spend
their day in. Rule every cell. Show a scrollbar when something scrolls. Put the
pager above the header, where Urban's timesheet has always had it. And put the
filter on the column heading, "like in Microsoft products or Excel tables" —
asked as a question, because the person asking assumed it was already there.

Each one replaced a decision that had a reason at the time. That is worth saying
plainly rather than quietly reversing: this is not a correction of a mistake, it
is a product call landing on top of an aesthetic one.

## What changed

### Every cell is ruled, and the rule lives on the `<table>`

`.sti-grid` in `globals.css` draws a border on all four sides of every cell,
minus the trailing edge of the last column and the underside of the last row —
the container already draws those, and doubling them reads as a heavier rule
rather than as a neater one.

It is applied by the shared `<Table>` primitive itself, so anything built on it
is ruled the day it is written, and by name on the four hand-rolled tables:
`jobsite-tool-table`, `report-table`, `import-dialog`, `project-monitor`. One CSS
rule and five class names, rather than the same pair of Tailwind borders copied
onto forty `<td>`s.

This reverses the call recorded in `jobsite-tool-table.tsx` that a table should
be sectioned "by tone rather than by lines". Alternating fills read well on the
darker palettes and dissolve on the pale ones, and a ten-column register gives
the eye no track to follow across. The banding stays: the rule says where a row
ends, the fill says which row you are on. The comment now says so instead of
arguing the opposite.

### Scrollbars that are actually there

`.sti-scroll` and `.sti-table-scroll` now draw a thin, permanently visible thumb,
coloured from `--foreground` so it holds contrast across every theme. Styling
`::-webkit-scrollbar` is what opts an element out of macOS overlay scrollbars,
which otherwise vanish when nothing is moving and take with them any hint that
the columns continue past the right edge.

### The pager moved above the column headers

`DataTablePagination` carries `border-b` instead of `border-t`, and `DataTable`
renders it inside the bordered box above the table rather than beneath it. It is
a sibling of the scrolling element, so the columns move sideways underneath it
and it stays put.

The strip also gained the only exit from a column filter — a count and a Clear —
because the menu that sets one closes behind itself, and hunting back through the
headers one at a time to find which is filtered is not a way out.

### A column menu, on the caret in the header

`column-menu.tsx`. Every column with an `accessorFn` gets a caret opening sort
ascending/descending, clear sort, hide column, and a searchable tick list of that
column's distinct values with counts. Clicking the header still sorts, exactly as
before — the caret is an addition, which is also how Excel behaves.

Three decisions inside it:

- **No filter means every box is ticked.** Unticking the first one starts from
  "all of them", so the click reads as "hide this" rather than "show only this".
  Unticking the last clears the filter rather than emptying the table.
- **A tick applies immediately.** `FilterSheet` drafts and commits on Apply for
  the opposite reason: those filters travel to the server, so a keystroke there
  is a query. This one is a pass over an array already in memory.
- **The value list is client mode only.** In server mode the browser holds one
  page; offering twenty-five values as "the values in this column" would be a
  lie. Sort and hide still work there.

The caret is always rendered and always occupies its space, never revealed on
hover. A control that appears under the pointer cannot be found by somebody who
does not already know it is there, which is precisely how its absence got
reported.

## What was found while building it

**The scrollbar styling was on an element that never scrolled.** The shared
`<Table>` primitive wraps itself in an `overflow-x-auto` container. `DataTable`
wrapped the primitive in a *second* one and put `sti-table-scroll` on the outer
box. Measured on `/tools` at 1100px: the outer box had `scrollWidth === clientWidth`
and the primitive's inner container had `scrollWidth` 1624 against `clientWidth`
714. So the box that actually scrolled was the unstyled one — and had been for as
long as both existed. Nothing fails visibly when that is wrong; the bar is simply
the browser's default, or on macOS not there at all until something moves. The
outer wrapper is gone and the class is on the primitive's container. A test walks
up from the `<table>` to the first ancestor that genuinely overflows and asserts
the class is on that one.

**The caret cost the CATEGORY column its heading.** At `size-6` with `mr-1.5` the
header label truncated inside its 8rem column — a width it has always had.
`size-5` with `mr-1`, and the header button's right padding dropped to `pr-1`
when a menu is present, gives the label its pixels back.

**Two comments in this area were describing code that is not there.**
`globals.css` claimed `.sti-table-scroll` makes headers sticky; nothing in that
file or in `table.tsx` sets `position: sticky`, and rows are bounded by pagination
rather than by a nested scrollbox, so there is nothing for a header to stick to.
`table-resize.spec.ts` still explained the second test in terms of the
"convert every column on first drag" mechanism that was measured, found to change
nothing, and removed on 2026-08-27. Both now say what the code does.

**A test that measured the wrong thing passed for the wrong reason.** The first
version of the filter test counted `tbody tr` before and after unticking a value.
The register holds 756 tools at a page size of 25, so dropping a whole category
still leaves the page full: 25 before, 25 after, and the assertion failed while
the feature worked. It reads the pager's own total now.

## Verified

- `pnpm typecheck` — 14 tasks, all pass.
- `pnpm test` — 69 pass on the host, with 185 skipped for want of a database.
  Re-run inside the api container against Postgres: **254 pass, 24 files, none
  skipped.** No backend code was touched; this was to confirm that.
- `pnpm --filter @stinventory/web lint` — clean.
- `e2e`, full browser suite against the Docker stack: **55 pass**, including the
  five pre-existing table specs (`table-resize`, `table-overflow`,
  `table-columns-align`, `no-layout-shift`, `jobsites-pool`) that between them
  cover the structure this change rearranged.
- New spec `table-grid-and-filter.spec.ts`: cells ruled on both axes with the last
  column's trailing edge left bare; the pager's bottom above the header's top;
  a value unticked narrows the pager total and Clear filter restores it exactly;
  the header's height is unchanged with the menu open; and the element carrying
  `sti-table-scroll` is the one that overflows.
- By eye, in Chromium against the running stack: `/tools` with the menu open and
  a crew expanded on `/jobsites`.

**Not verified:** the scrollbars themselves. Playwright's headless Chromium hides
scrollbars — the probe returns `offsetWidth - clientWidth === 0` even on an
element with `scrollbar-gutter: stable`, so there is nothing to photograph and
nothing to measure. The CSS is standard `::-webkit-scrollbar` and
`scrollbar-width`/`scrollbar-color`; it wants a look in a real browser.

Also not verified: the grid on a light palette. The theme is stored per browser
and Playwright's `colorScheme: "light"` does not reach it. The lines are drawn
from `var(--border)`, which every theme defines, so they follow the palette by
construction — but "by construction" is not the same as "seen".

## Deliberately not done

- **No column menu on `jobsite-tool-table`.** It is grouped by crew and truck,
  and an Excel filter across a sectioned table filters the sections out from under
  their own headings. It got the grid lines, which is what it needed.
- **No column menu on `report-table`.** It has its own search and sort and a
  different column model; a second implementation of the menu to serve the report
  pages is not worth what it costs. Said out loud rather than left to be
  discovered as an omission.
- **The CSV export defect is still there** — `exportCsv` reads the post-pagination
  row model, so the register exports 25 of 756. Documented in `.claude/rules/web.md`
  and untouched here; it is not this change.
- **Nothing was done about the muted-text contrast** measured at 4.21:1 in light
  mode. The grid lines may well have been the whole of what "some themes make the
  table unreadable" meant, and adding contrast changes on top would make it
  impossible to tell which fixed it.

## Where it is

Branch `development`, on top of `b29bdad`. Docs updated in the same change:
`.claude/rules/web.md` gains sections on the grid, the pager position, the
scroller-identity trap and the column menu's three constraints.
