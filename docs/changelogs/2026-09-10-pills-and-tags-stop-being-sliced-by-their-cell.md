# Pills and tags stop being sliced by the cell they sit in

A status pill in a register table was being cut through the middle — the right
edge, the corner radius and the tone border simply stopping mid-shape, so
`PENDING APPROVAL` rendered as a box with no right-hand side. Asset codes were
losing their last character to an ellipsis on the custody screens. Both were
reported together as "the label thing is still getting cut off", the "still"
being the important word: the tools register had already been widened once for
this, and the same defect was live on the screens nobody re-measured.

## The mechanism, which is why widening columns had not fixed it

`TableCell` carries `truncate` — `overflow: hidden` plus `text-overflow:
ellipsis`. That is right for text: a long custodian name ellipsizes at the
column edge instead of wrapping and making every row tall, which is what the
comment on that cell has always said.

It is wrong for a **box**. `StatusPill` and `Tag` are bordered, tinted,
rounded elements, and `overflow: hidden` on the parent does not ellipsize a
child box — it slices it. Nothing in the pill bounded itself to the cell, so a
pill wider than its column overflowed and was clipped flat. The result reads as
a rendering fault rather than as "there is more text here", which is exactly how
it was reported.

That distinction is what makes this a component fix rather than another column
width. Widening a column raises the threshold at which the slicing starts; it
never removes it. Every column narrower than its own worst-case label — which is
most of them, deliberately, because sizing `Status` to `Pending Verification`
would waste that space on every screen showing `Active` — remained one long
status away from the same bug.

## What changed

### `StatusPill` and `Tag` bound themselves to their container

`max-w-full` on the pill, with the label in a `min-w-0 truncate` span inside it.
The pill now keeps its whole outline at any width and the LABEL ellipsizes
within it, so a squeezed Status column degrades to a complete pill reading
`PENDING APPR…` instead of half a box. `title` carries the full value, so what
the ellipsis takes is still reachable on hover.

`Tag` gets the same treatment (`inline-block max-w-full truncate`) for the same
reason — a code tag is a tinted box, and a clipped box reads as a bug.

This is where the fix belongs: the two components are used across the app, so
every table, present and future, inherits the behaviour without each column
having to be sized against its worst case.

### Two columns that measurement proved were genuinely too narrow

The component fix stops the slicing; it does not conjure room that was never
there. Two columns were short of their real content and were sized against it:

- **Custody `Code`, `6rem` → `7rem`** — all three tables on that screen (held,
  transfers, queue). Every asset code in the register is nine characters and a
  tag adds its own padding: 80px of content in 79px of cell, so the last
  character sat under the ellipsis on every row.
- **Projects `Status`, `7rem` → `8.5rem`** — `In Progress` needed 116px in a
  95px cell. This column also passes `className="text-xs"`, which overrides the
  pill's own smaller type and is why this screen overran hardest.

## What was found while building it

- **The tools register was already correct.** It had been widened in earlier
  work, which is why the bug looked fixed to anyone checking there. The defect
  survived on custody and projects. Per-page width tuning is what let this
  regress; that is the argument for the component-level fix above.
- **Font scale was not the cause, and it was worth ruling out.** The appearance
  preference sets the root font size and column widths are `rem`, so they scale
  together — measured at 1.0, 1.2 and 1.4 with no clipping on a correctly sized
  column. The widths were simply guessed rather than measured when written.
- **The widest label the pill can hold is `Pending Verification`** at 194px,
  from a status the backend can no longer write — the verify flow was removed
  2026-08-09 and the tone is kept only so historical transfer rows render. Worth
  knowing before anyone sizes a status column to its theoretical maximum.

## Verified

Driven in a real browser against the local stack with the Urban dataset (756
assets), measuring each cell's available width against its content's rendered
width:

- Before: custody `Code` short by 1px, projects `Status` short by 21px.
- After: both fit, and every other column on custody, projects, people and
  equipment measured clear.
- **Squeeze test** — the projects `Status` column forced to 70px: the pill stays
  inside the cell with its 1px right border and 7px corner radius intact,
  ellipsizing to `IN…`, and carries `title="In Progress"`. This is the case that
  was previously sliced, and it is the one that proves the fix is structural
  rather than a wider column.
- `pnpm typecheck` passes; `pnpm test` passes.

Not verified: the mobile client, which does not use these components; and the
database-backed suites, which skip outside the api container — this change
touches no query, router or contract, only two presentational components.

## Deliberately not done

- **No minimum-width floor in `col()`.** It was considered — a column that
  cannot be declared narrower than its content is a stronger guarantee. It needs
  the content's width at declaration time, which the helper does not have, and
  the component fix already removes the failure mode this would have guarded.
- **Status columns were not sized to `Pending Verification`.** Sizing every one
  to a 194px label no writer can produce would cost real space on screens that
  only ever show `Active`.
- **Other columns' widths were left alone.** The flexible no-width columns
  (`Model`, `Site`) ellipsize text, which is the intended behaviour.

## Where it is

Uncommitted on `development`, in `apps/web/components/sti/status.tsx` and the
custody and projects register pages. Not deployed — `main` is what deploys.
Note that the working tree also carries unrelated concurrent changes, including
a staged removal of `e2e/`; none of that is part of this work.
