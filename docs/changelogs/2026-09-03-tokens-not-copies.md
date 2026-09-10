# A copied token is not a token, and eight primitives nobody imported

Reported as "the search and filters are like a white card where all the other pages have
blank canvas background — where is the consistency". That specific complaint was one screen
and was fixed on its own. This is the audit behind it: three read-only passes over
`apps/web` covering colour tokens, page structure across all 32 `page.tsx` files, and shared
component usage. The full plan lives outside the repo; this entry records what was executed.

**The audit's honest headline is that the codebase was more disciplined than the complaint
implied, and most of the NEW inconsistency was introduced by this same session's org-chart
work.** Of the five hardcoded colour strings in the entire application, three were in files
written hours earlier. Both of the app's only two `space-y-*` page wrappers were from that
work. The only table in the app missing the house ruled-cell style was from that work.

## What changed

### The fleet map ignored dark mode entirely

`components/fleet-map-view.tsx` held the literal oklch values of `--ok`/`--warn`/`--idle`
under a comment claiming "the status colours ARE the design tokens … so the map and the
pills cannot drift apart". They were copies, and specifically the LIGHT-mode copies. Every
status token has a second value under `.dark`, so in dark mode every pill flipped and the
map dots did not. A copied token is not a token.

Fixing it needs two mechanisms, because SVG forces it. `VEHICLE_STATUS_VAR` (`var(--ok)`)
serves anything set through a CSS property — the legend swatches' inline `backgroundColor`.
Leaflet cannot use it: it writes `fillColor` onto the SVG `fill` **presentation attribute**,
which is parsed as SVG syntax rather than CSS, so `fill="var(--ok)"` resolves in no current
browser. That path gets `useVehicleStatusColors()`, which reads the computed custom property
and re-reads it when `dark` or `themeName` changes — the two things `apply-theme` writes to
the root, so they are the correct dependencies. Light-mode literals survive only as the
first-paint fallback.

### Five hardcoded amber strings became tokens

`tools/[id]:212`, `custody:192`, `org-chart:368`, `tree.tsx:61`, `tree.tsx:99`. Four of the
five hand-wrote `dark:` pairs doing by hand what the token does automatically. The two chips
became `bg-warn-bg text-warn`; the org-chart banner took the existing in-repo idiom from
`tools/[id]:244`; the focus ring became `ring-ring` (amber reads as "this person has a
problem"); the "also on N other jobs" chip became `bg-accent text-accent-foreground`,
because it is a highlight and not a warning. No new token was needed for any of them.
`grep` for hardcoded palette colours across `app/` and `components/` now returns nothing.

### The team-roles table joined the rest of the app

`settings/team-roles` used a raw table element — the only one in the app without
`.sti-grid`, and therefore the only one with no vertical column rules. More than cosmetic:
compact density targets `[data-slot="table-cell"]` and `[data-slot="table-head"]`, which a
raw table never emits, so that screen could not respond to the density preference at all.
Now built on the shared `Table` primitive.

### org-chart tabs got their accessibility roles

They shipped with no `role="tablist"`, no `role="tab"` and no `aria-selected` — three
unlabelled buttons to a screen reader, with no indication which view was showing.
`/custody` had it right and was the reference.

### Eight shadcn primitives with zero importers, deleted

`select` · `alert` · `avatar` · `breadcrumb` · `card` · `drawer` · `label` · `sonner`.

`select.tsx` is the one that mattered: `.claude/rules/web.md` bans native selects and the
sweep removing them is complete, so a stock Radix Select sitting in `ui/` was precisely what
the next contributor or agent reflexively imports. `sonner` was doubly dead — no `Toaster`
mounted anywhere and no `toast()` call in the codebase. `tabs.tsx` and `toggle-group.tsx`
were deliberately KEPT despite also having no importers; they are the intended landing place
for the eight hand-rolled segmented controls, which is the next piece of work.

`components/sti/action-menu.tsx` justified its vertical-ellipsis choice by citing
`ui/breadcrumb.tsx` as the in-repo example of the horizontal glyph meaning truncation.
Deleting breadcrumb would have left that rationale dangling, so the comment was rewritten to
stand on the convention itself and to record where the example went.

## What was found while building it

**`pnpm lint` was failing on `development`, and it was mine.** `app/(app)/org-chart/page.tsx:255`
had `next.has(key) ? next.delete(key) : next.add(key)` — a `no-unused-expressions` error.
It was pushed to `development` earlier the same day because that work was verified with
`pnpm typecheck` and `pnpm test` but never `pnpm lint`, which CI runs
(`.github/workflows/ci.yml`). Fixed here to an `if`/`else`. The lesson is the cheap one:
the repo's own behaviour rule says run typecheck and tests before committing, and lint is a
third gate that CI enforces and that rule does not name.

**One planned change was withdrawn after reading the code.** The audit flagged
`components/auth-slideshow.tsx:105` for using `bg-brand-yellow` on a slide indicator, since
brand tokens are reserved for the logo. The code answers this directly: the comment above it
says the active dot "is the timesheet's yellow, which is this product's yellow" — deliberate
brand continuity with the product being sold alongside — the element is `aria-hidden` and
described as "indicators, not controls", and it sits inside the `bg-brand-navy` plate on a
photograph, which `globals.css` explicitly sanctions. A documented decision is not drift.
Left alone.

## Verified

- `pnpm typecheck` 13/13, `pnpm lint` clean across the workspace (it was not, before this).
- `packages/api-contracts` 279 tests across 27 files; `packages/domain` 44 tests.
- `grep -rnoE '(bg|text|border|ring)-(red|amber|…)-[0-9]+' app components` returns nothing.

**Not verified.** Nothing here has been looked at in a browser. The Playwright MCP has been
unreachable for this entire session. The theme work in particular WANTS a browser: the real
test is walking `/map`, `/org-chart`, `/custody`, `/tools/[id]` and `/settings/team-roles` in
light and dark on two palettes, plus flipping density to compact and confirming the
team-roles table now tightens — which it demonstrably could not before.

## Deliberately not done

- The eight hand-rolled segmented controls are untouched; that is the next tier and the
  largest single source of visual drift.
- Status-pill consolidation, the five pages that silently swallow query errors, and the
  page-header policy all remain open — the last needs a product decision, not a refactor.
- No lint rule was added to catch hardcoded colours. It is the obvious guardrail and it
  should encode whatever policy is settled, not be written first.

## Where it is

Branch `feature/design-consistency`, merged to `development`. Not on `main`.
