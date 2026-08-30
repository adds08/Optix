# Freezing on both axes, and a row menu that answers two questions

Asked for directly: column freezing in the table, row freezing from the
three-dot menu, and the row menu separated into table options and entity
actions — "smartly please! do not keep unnecessary division just neat
divisions!"

## What changed

### Columns freeze as a prefix

"Freeze up to here", from the column menu. `DataTable` holds a count, persists it
under `sti-frozen:<storageKey>` beside the column widths, and makes the leading
columns `position: sticky` at measured offsets.

A prefix, exactly as in a spreadsheet, and not an arbitrary subset. Pinning a
middle column on its own raises "and where does it sit now" — before its
neighbours, after them, in a third group of its own — and every answer to that is
worse than not offering it. The menu offers the item on the column that would
*become* the boundary and on the one that already is; on any other column it
would either repeat the current setting or ask for something this does not do.

The `left` offsets are measured off the live header row in an effect, never
summed from `meta.width`. Those are rem strings, the app has a font scale, and
any column may have been dragged wider — the rendered width is the only honest
number.

### Rows freeze individually

From the three-dot menu, under a Table heading. TanStack owns this one:
`enableRowPinning` plus `keepPinnedRows`, which is what makes a frozen row
survive a page change — the entire reason to freeze one. Frozen rows render above
the rest and carry a tint, because a row lifted out of the sort with no
explanation reads as a sorting bug.

Session-only, deliberately. A pinned row is a working note about the tools in
front of you, not a preference to carry to another browser.

### The row menu splits once

`RowActions` and `ToolMenu` now group under two headings: **Actions**, for what
you do to the thing, and **Table**, for how you look at the table it is in.
Freezing a row changes nothing about the person or the tool and everything about
the view, which is the line the split follows.

And only once. Sub-grouping the entity actions further — custody, account,
danger — was considered and is not here; a menu that fits on screen without
scrolling does not need a table of contents. `ToolMenu` had already accumulated
three separators in a six-item menu that way, and the rule fencing "Change
status" off on its own is gone. The one division that has ever carried meaning
inside the group is the one before the destructive pair, and that stays.

Freezing reaches those menus through a context (`data-table/row-context.tsx`),
not through props. `RowActions` is built by each page — the page is what knows
what "delete" means for a person versus a project — so `DataTable` publishes the
row's pin state and callback and the menus pick it up. Null by default, which is
the interface rather than an omission: `jobsite-tool-table` renders `RowActions`
too, does not pin, and gets no Table group instead of a dead control. No register
page changed.

## What was found while building it

**`border-collapse: collapse` and `position: sticky` do not get along, and the
symptom does not look like a bug.** With the grid lines added yesterday, freezing
a column produced thin vertical marks streaking across the frozen cells — at the
same x in every row, which is the tell. Collapsed borders belong to the *table*,
not to the cells, so they are not clipped by a sticky cell: the vertical rules of
the columns scrolling underneath were painting straight over the frozen ones. The
computed styles on the frozen cells were all correct — sticky, right offsets,
opaque background, z-index above — which is what made it worth probing rather
than guessing.

`.sti-grid` is now `border-collapse: separate` with zero spacing and borders on
the right and bottom of each cell. Same picture, no doubling, because no two
cells ever draw the same line.

**That has a consequence worth carrying forward: under `separate`, a border
declared on a `<tr>` does not paint at all.** `jobsite-tool-table`'s deliberate
double rule under its header band was on the row and silently became a single
rule; it is now `[&>th]:border-b-2`. Written into `.claude/rules/web.md`, because
nothing warns you.

**And it left a test passing for the wrong reason.** `table-grid-and-filter.spec.ts`
asserted `border-bottom-width > 0` on each `<tr>`. `TableRow` still carries
Tailwind's `border-b`, so that computes to 1px whether or not a line is drawn —
the assertion would have passed forever while the rule vanished. It measures the
cells now, where the line actually lives.

**The tools register does not use `RowActions`.** It uses `ToolMenu`, which is why
the first run of the menu test found no Table group on `/tools` at all. Both
menus are wired, and both now carry the same two headings — a row in the register
and a row in People answer the same gesture the same way, which is the standing
rule for those two components.

## Verified

- `pnpm typecheck` — 14 tasks, all pass. `pnpm --filter @stinventory/web lint` — clean.
- Browser suite: **64 pass** after the border-model change, including every
  pre-existing table spec.
- New `table-freeze.spec.ts`, four tests: an unfrozen column travels with the
  table and a frozen one holds its screen position through a 400px scroll; the
  freeze survives a reload and unfreezing releases it; the row menu shows exactly
  the two headings; and a row frozen from the middle of the page is lifted to the
  top and is *still there after a page change*.
- By eye at 1150px on `/tools`: frozen columns with the seam shadow and no
  streaking, a frozen row at the top, the grouped menu, and the crew table on
  `/jobsites` still ruled on both axes after the border change.

**Not verified:** freezing on a touch device, and freezing combined with a column
drag-resize on a frozen column (the offsets recompute on a width change, but the
gesture was not exercised).

## Deliberately not done

- **No freezing from the right.** `column.pin("right")` exists in TanStack and
  nobody asked; the actions column is already the last thing on every register.
- **No frozen-row persistence.** See above — it is a working note, not a setting.
- **No freezing on the hand-rolled tables.** `jobsite-tool-table` is grouped by
  crew and sectioned; a frozen row inside a section that collapses has nowhere to
  be. It gets the grid and the row menu, without the Table group.
- **A third menu group.** Named here so it is not re-proposed as an oversight.

## Where it is

Branch `development`, on top of `26facb7`. `.claude/rules/web.md` gains the
border-model warning, a Freezing section and a "two groups and no more" section.
