# Ticking a checkbox stops moving the page

Reported against the register on `/jobsites`: selecting a row made the block grow
vertically and flick, with the note that this must not happen anywhere.

It happened in two places, for one reason, and both were measured before and
after rather than eyeballed — a layout jump is the class of bug that gets made
smaller and called fixed.

## What changed

### The cause, in one sentence

Controls that appear on selection were **inserted into the document flow**, so the
space they need was created at the moment they arrived instead of being reserved
in advance.

### `/jobsites` — the section header, 33px to 41px

The "Waiting in the yard" header is a flex row sized by its tallest child. Empty,
that was a text line at about 16px; with a selection it became an `h-6` button at
24px. Inside `py-2` the row went from 33px to 41px on the first click, and the
table under it moved.

Fixed by reserving on the **slot**, not the row: the `ml-auto` span that holds the
actions is now `h-6` whether or not anything is in it, so the tallest child is 24px
either way.

Reserving on the row instead was tried first, and left exactly **1px**. `min-h-10`
is 40px under `border-box`, which counts the `border-b` inside that budget, while
the button state adds the border on top for 41. Sizing the element that actually
varies has no such arithmetic. The 1px is recorded because it is precisely the
residue that would have been shrugged off as "close enough".

### `/tools` — the bulk bar, 58px

Worse and differently shaped: the bulk action bar was its own block that did not
exist until the first tick, so the whole table dropped 58px under it.

Reserving 58px of permanently blank space above the register would have traded a
jump for dead space, so the bar was not reserved — it was **removed**. The bulk
actions now swap into the toolbar row that is already there, taking the place of
Import / Export / New tool / Saved, with the count reading "N tools selected"
instead of "756 tools". Same row, same `size="sm"` buttons, same height, no shift.

Both halves of that row branch on one named `selecting` flag rather than inlining
the condition twice — one half showing bulk actions while the other still counted
tools would be a worse bug than the jump it replaced.

## What was found while building it

**Only two surfaces had it.** A grep for the whole-block pattern
(`selectedIds.size > 0 ?`) returns exactly one hit, and the header case is the
other. `WorkingBar` looked like a third and is not: it is `position: fixed` and
takes no layout space.

**A `fixed` floating bar was considered and rejected**, which is worth recording
because it is the obvious answer. The route content animates on navigation, and a
transform on an ancestor makes `position: fixed` resolve against that ancestor
rather than the viewport. A floating selection bar would have worked until it
silently did not, in a way that depends on animation timing.

**`min-h-*` and `border-box` do not compose the way the reflex expects.** A
min-height budget includes the border; content-driven height adds it. Any "reserve
the row" fix on an element with a border is off by the border width.

## Verified

Measured in a real browser, before and after, on both surfaces:

| Surface | Before | After |
|---|---|---|
| `/jobsites` section header | 33px to 41px on select | 41px to 41px |
| `/tools` table top | 171px to 229px on select | 171px to 171px |

- `e2e/tests/no-layout-shift.spec.ts` asserts **equality, not a tolerance** — one
  pixel of movement is the same bug as fifty. **Checked against the un-fixed code
  first**: reverting the jobsites slot height fails it with `Expected: 33,
  Received: 41`.
- The full browser suite, now 30, green across five roles.
- `pnpm typecheck` across the workspace and `pnpm lint` clean.

## Deliberately not done

**`bulkError` can still add a line.** It appears on a failed write rather than on
every tick, so reserving a permanent blank row for a message that usually never
comes would trade a real jump for permanent dead space. Called out rather than
left as an oversight.

**No global CLS check.** The rule is documented in `.claude/rules/web.md` with both
fix shapes and the browser test covers the two surfaces that had the bug. A
whole-app layout-stability sweep is a bigger piece of work than this report asked
for.

## Where it is

Committed on `development`. Not deployed. `.claude/rules/web.md` gains a
"Nothing moves when you tick a checkbox" section carrying the principle, both fix
shapes and which applies when.
