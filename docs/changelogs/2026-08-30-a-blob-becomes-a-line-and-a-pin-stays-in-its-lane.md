# A blob becomes a line, and a pin stays in its lane

Four small fixes, found by actually looking at the register and the sidebar
with a client demo an hour away, then shipped straight to production ahead
of that call. This entry is git catching up to what has been live since —
the code and the deployed artifact were already in sync before this commit
existed.

## What changed

### The frozen-column shadow was a stack of blobs, not a line

`.sti-freeze-edge`/`.sti-freeze-edge-right` (`apps/web/app/globals.css`) used
an `8px` blur with a `-6px` spread. The spread insets the shadow 6px above
and below *every cell* before the blur softens what's left — on a column of
many short table rows, that reads as a chain of soft rounded pills instead
of one continuous seam. Shrunk to a `3px` blur / `-2px` spread so each cell's
shadow is close enough to its own height that adjacent rows' shadows meet at
the shared border and read as one line.

### Checkbox and row-menu trigger were flush left in their cells

Neither the row-selection checkbox nor the actions-column ellipsis trigger
had any alignment applied, so both sat against the cell's left padding
instead of centred under their header. `data-table.tsx` now flags a cell as
`centerContent` when its column id is `"__select"` or its `meta.stickyRight`
is set, and wraps that cell's rendered content in a
`flex items-center justify-center` div; the header's own select-all checkbox
gets the matching `justify-center` treatment.

### A pin surfaced outside its own module

`app-sidebar.tsx` resolved the Pinned section against every nav group
(`pinnedItems(groups, order)`), on the reasoning that the screens you live
in should be reachable regardless of which module the rail is pointed at. In
practice that meant the Pinned section's contents changed unpredictably as
you moved the rail — a worse surprise than the shortcut it bought. Scoped to
`pinnedItems([active], order)` so a pinned row only appears while its own
group is the one selected.

### Three columns came off the People register

Client's explicit ask: "Tools held" and "Value held" were reading real,
correct custody data (`trpc.report.byForeman`), but the client doesn't track
per-employee value there and didn't want a tool count on what's meant to be
an employee list — removed both columns, the now-unused query and its `held`
map, and the `money`/`idName` imports that only those columns used.
"Primary project" was removed on the same ask ("not necessary to show").

## What was found while building it

The shadow bug was invisible in the CSS itself — the box-shadow values
looked like reasonable seam-highlighting numbers on paper. It only showed up
in a zoomed screenshot of the actual register, which is the reason this
session moved to screenshot-first verification for anything table-visual
rather than trusting a typecheck pass.

## Verified

- `pnpm typecheck` clean.
- Before/after screenshots of the actions-column area on `/tools`, zoomed,
  confirmed the shadow reads as a single line post-fix.
- Deployed to production ahead of this commit (see below); `/`, `/health`
  and `/tools` all returned 200 after the redeploy.

Not verified this session: the Playwright regression suite wasn't re-run
against these four files before the production push, given the time
constraint ahead of the demo. Worth running before the next change touches
any of them.

## Deliberately not done

Nothing scoped out — all four were complete, contained fixes.

## Where it is

Branch `development`. **Already deployed to production** — pushed directly
via `scp` of the four changed files plus a `web`-only container rebuild,
with explicit approval at each step given the production incident earlier
the same day. This commit is the paper trail landing on git after the fact,
not before.
