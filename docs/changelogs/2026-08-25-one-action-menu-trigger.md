# One trigger for every row menu

An audit of the rest of the app after the People/Projects fix, asked for
directly: are the components actually being reused?

Mostly yes, with one clear exception — the control the previous change had just
added another copy of.

## What changed

### `ActionMenuTrigger`, used by all four menus

There were four "actions for this row" menus and three different controls:

| Where | Glyph | Built from | Size |
|---|---|---|---|
| `tool-menu.tsx` | `Ellipsis` (horizontal) | hand-written classes | `size-7` |
| `row-actions.tsx` | `Ellipsis` | the same classes, copied | `size-7` |
| `jobsite-crew-card.tsx` | `EllipsisVertical` | `Button size="icon"` | `size-7` |
| `jobsites/page.tsx` | `EllipsisVertical` | `Button size="icon"` | `size-8` |

Same gesture, same meaning, two glyphs and two mechanisms. All four now use
`components/sti/action-menu.tsx`.

**Vertical won, and not only on taste:** `MoreHorizontal` already means "there
are hidden items here" in `ui/breadcrumb.tsx`, so reserving the horizontal glyph
for truncation leaves the vertical one free to mean "act on this thing". It is
also what "three dot menu" refers to everywhere else.

**Built on `Button` rather than styling `DropdownMenuTrigger` directly**, so the
focus ring, disabled state and press animation come from the same primitive as
every other control in the app. The one thing added on top is
`data-[state=open]`, which keeps the trigger lit while its menu is open — the
bare `Button` has no way to know that.

### A local `ErrorNote` renamed

The previous change introduced a cell-sized `ErrorNote` inside `row-actions.tsx`
while `sti/page.tsx` already exports a page-level `ErrorNote` — and `people/page.tsx`
imports both. They are genuinely different things (a full-width "this screen
failed" banner versus the server refusing one delete in a table cell), so the
local one is now `RefusalNote`, named for what it carries.

## What was found while building it

- **The previous change made the problem it was fixing slightly worse.** Copying
  `ToolMenu`'s hand-written trigger classes into `RowActions` was the fastest way
  to match the house style, and it produced a third hand-written copy of a
  control that should have been extracted the moment there was a second. Copying
  the classes was easier than extracting them, which is exactly how four
  variants happen.

- **Reuse elsewhere is in good shape.** Checked and found genuinely shared:
  `StatusPill`/`Tag`/`humanize`, `EmptyState`, `TableSkeleton`, `PageHeader`,
  `Metric`, `DataTable`, `Highlight`, `PersonChip`, `money`/`idName`. The
  `rounded-full`/`bg-*` hits that looked like hand-rolled status pills are one-off
  visual elements — a live ping dot, a notification count, an avatar circle — not
  duplicated pills.

- **`ui/table` is not dead**, despite three files hand-rolling `<table>`. It is
  used by `DataTable` and `admin/users`.

- **Every actions column was enumerated rather than assumed.** `grep 'id:
  "actions"'` returns exactly four: tools (already `ToolMenu`), projects and
  people (fixed previously), custody (left alone, below). No other table cell
  renders more than one button.

## Verified

- `pnpm typecheck` — 14 tasks successful.
- `npx eslint` over all seven touched files: clean, no new warnings.
- `pnpm lint` across the repo: 0 errors.
- `make ENV=local test` — 8 tasks successful, suites green.
- `/people`, `/projects`, `/tools` and `/jobsites` all compile and serve 200,
  with no compile errors in the web container.

**Not verified: still nothing has been seen rendered.** Four menus changed glyph
and two changed the mechanism their trigger is built from; whether the vertical
ellipsis sits correctly in a crew-card header and in a `size-8` jobsite header
is exactly the kind of thing only a look will tell you. The tables are behind
authentication and no browser tooling was available.

## Deliberately not done

- **Three files still hand-roll `<table>`** — `jobsite-tool-table.tsx` (a
  collapsible mini-table nested in a crew card, with its own "show N more"),
  `import-dialog.tsx` (a preview grid) and `sti/monitor/project-monitor.tsx`
  (the wall board, deliberately bespoke). `DataTable` is a full register with
  pagination, filtering and selection; none of the three wants that, and
  `jobsite-tool-table` already reuses the components that carry meaning
  (`ToolMenu`, `Highlight`, `humanize`, `formatAssetModel`). Only the table
  chrome is local. Converting them is a large change with no defect behind it.
- **Custody's Approve/Decline stays two buttons**, and panel headers
  (`admin/roles`, `job-groups`) keep theirs. Both are argued in the rule file
  now so the next pass does not "fix" them.
- **No test**, same as the entries before: `apps/web` has no harness.

## Where it is

Committed on `development`, following `bc1df81`. Not pushed, not deployed.
