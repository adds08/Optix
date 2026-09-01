# The sheet stops scrolling sideways, and search shows its work

Direct feedback on the jobsites card view, minutes after it shipped: the tool
table inside the right sheet had its own horizontal scrollbar, "which feels
very weird," and searching in Cards mode gave no clue which tool matched until
a sheet was opened. Both are UX defects in the feature that just landed, not
new scope — fixed in the same session.

## What changed

### The sheet's tables stop needing a second scrollbar

`ToolTable`'s fixed columns — Tag, Tool, Category, Status, Condition, and
Where on the loose-tool table — add up to roughly 32rem before the flexible
name column gets anything, which does not fit a 36rem sheet. The table's own
`.sti-table-scroll` wrapper was doing exactly what it is built to do, just in
a place nothing wanted it: a horizontal scrollbar nested inside the sheet's
vertical one. Two scroll containers stacked inside one panel is the same
shape `web.md` already documents as a trap for the shell wrapper itself, one
level down.

`ToolTable` gains a `compact` prop. In compact mode there is no `<table>` at
all — each tool is a flexible row (`role="listitem"`) with the tag and name
on one line and a subtext line folding in category, condition and location,
wrapping instead of demanding a column. Sort state, the highlight rule, the
five-row fold and `ToolMenu` are all shared with the table branch; only the
layout differs, so nothing about search or actions behaves differently
between the two. `jobsite-card-view.tsx` is the only caller that passes
`compact` — the full table is untouched everywhere else it's used.

### Search shows where the match is, before you open anything

Searching in Cards mode previously narrowed which cards appeared but told you
nothing about *why* until you opened a sheet. A card face now shows up to
three of its actually-matching tools — tag and name, marked the same way the
list view marks a hit — between the card's name and its tool-count line, with
"+N more matches" if there are more. The match rule is the exact one
`<Highlight>` already uses (four characters or longer, case-insensitive
substring), computed against the same tag/serial/model text a person reads,
so a card is never shown previewing a "match" that nothing on the page would
actually mark.

## What was found while building it

**My own new spec broke on my own next change**, which is the discipline
working as intended rather than a mistake to hide. The spec written for the
card view asserted `sheet.locator("table")` — true when it was written,
false the moment `compact` removed the `<table>` entirely. Running the suite
surfaced it immediately; the fix was updating the assertion to the new
markup (`getByRole("listitem")`), not weakening it.

## Verified

- `pnpm typecheck` and lint clean.
- The updated `jobsites-card-view.spec.ts` passes, and — the standard this
  session has held to throughout — was proven able to fail: stashing just
  the two feature files (keeping the updated spec) turns both new
  assertions red; restoring them turns the suite green again.
- The four e2e specs that measure `/jobsites` pass identically to before
  this fix.
- `turbo run test` green across all eight packages.

**Not verified in a browser.** Two consecutive browser-QA passes hit an
account spend limit before returning a result. Committed on code-level
verification alone: this is a presentational-only change with no ledger,
custody, permission or query surface, and the mechanical proof above (a spec
demonstrated to fail without the fix and pass with it) is the strongest
non-visual evidence available. The one thing that genuinely needs an eye on a
screen — does the compact row actually read well, does the "+N more" wrap
cleanly on a narrow card — is flagged as an open follow-up rather than
asserted.

## Deliberately not done

- **No change to the demoted table's own columns.** The full desktop table
  (`/tools`, the list view's crew cards) is untouched; only the sheet's
  presentation changed.
- **No relevance-based card sort.** Matching cards are not reordered to the
  front — the preview shows where a match is on the cards already present,
  without touching the sort control the summary line already offers.

## Where it is

Committed on `development`, immediately following the card-view feature it
corrects. Not yet browser-verified — see above.
