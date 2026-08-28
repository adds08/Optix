# Columns resize, and the table scrolls

The register carries eleven columns and does not fit a laptop. Widening the two
worst offenders helped, but the real answer to "more columns than screen" is to
let the reader decide which ones deserve the space.

Drag the right edge of any header cell. The wrapper already scrolled sideways;
now the columns are the reader's to set.

## What changed

`DataTable` keeps a `widths` map of columns the reader has dragged. Empty until
somebody drags, so a table nobody has touched behaves exactly as before and every
screen keeps the `meta.width` it declared.

`storageKey` persists them per browser under `sti-colwidths:<key>`. The register
passes one; it is the table people live in. Omit it and resizing still works, it
just does not survive a reload — right for a table nobody asked to keep.

Stored values are validated on read. Storage is editable by whoever holds the
browser, so anything that is not a finite number above the minimum is dropped
rather than trusted into a style — the same rule the pins follow.

Double-clicking a grip gives that column its declared width back. It undoes
exactly what the gesture created, which a "reset columns" button somewhere else
would not.

## What was found while building it

**The clever half of the implementation did nothing, and the comment explaining
it was wrong.**

The first version captured *every* column's rendered pixel width on the first
drag. The reasoning was plausible and written up at length: `table-fixed` shares
a fixed table width among its columns, so widening one column while the others
are still expressed in rem should steal the pixels from a neighbour rather than
grow the table. Converting all of them at once, and sizing the table to their
sum, was supposed to be what made the wrapper scroll instead.

Then the check that was supposed to prove it kept passing with the logic broken.
Measuring column by column, with the seeding disabled and then enabled, gave
**identical results both times**: Category 128 → 248, table 1620 → 1740, every
other column unmoved. A `table-fixed` table already grows to fit explicit column
widths. The extra state, the summed table width and the header ref were all
buying nothing.

All three came out. What is left is: store the dragged column, measure its
current width off the DOM, apply it. The comment now records what was measured
rather than what was assumed — a comment asserting a mechanism that does not
exist is worse than no comment, and this file is full of comments that future
work is meant to trust.

**A test can pass because the page has not settled.** The first two resize tests
failed while an identical drag later in the same file passed. The register
re-renders as its queries land, so a grip measured mid-render is measured at the
wrong x and the drag begins in empty space. The helper waits now.

## Verified

- Dragging Category +120px: the column goes 128 → 248 and **the table goes 1620
  → 1740**, so the wrapper scrolls and no neighbour changes width. Measured for
  every column, not just the dragged one.
- Widths survive a reload; a double-click restores the declared width and
  removes the entry from storage.
- The header does not change height during a resize — the grip is absolutely
  positioned, per the no-layout-shift rule.
- A resize does not sort the column, which it would without `stopPropagation`.
- 51 browser tests, `pnpm typecheck` and `pnpm lint` clean.

## Deliberately not done

**No minimum-width-per-column beyond a flat 56px**, and no maximum. A reader who
drags a column to nothing can drag it back, and inventing per-column limits is a
rule for a problem nobody has had.

**Only the register persists.** Every other table resizes for the session. They
can opt in with one prop when somebody wants it.

## Where it is

Committed and merged to `main`. `.claude/rules/web.md` carries the behaviour and
the measured note about why only the dragged column is stored.
