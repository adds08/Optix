# One sort control, a pager that actually sticks, and a header that can't yet

Phase 3 of the seven-phase plan tracked in
`/Users/adds08/.claude-personal/plans/imperative-beaming-puzzle.md`: the
shared `DataTable` component. Three changes landed clean; a fourth — the
column header sticking to the browser window the same way the pager now does
— hit a real CSS architecture limit and was deliberately left for separate
work rather than guessed at. Two genuine bugs surfaced only once the changes
were checked in an actual browser, not before.

## What changed

### One sort control, not two

The header used to be a clickable button (toggling sort, with a
chevron/arrow icon showing direction) *and* the column-menu caret offered the
same two sort actions in its dropdown — a redundancy `.claude/rules/web.md`
itself had previously documented as deliberate ("Clicking the header still
sorts... exactly as in Excel"). Asked directly to remove it. The header is
now a static label; the caret is the only way to sort. Since that removed the
header's own icon — the only place sort direction showed without opening the
menu — the caret trigger now tints itself the same way it already did for an
active filter, extended to cover "this column is sorted" too.

### The actions column freezes to the right, and finally says so

A new `stickyRight` flag on a column definition (`columns.ts`, `data-table.tsx`)
— narrower than the existing leading-prefix column freeze, deliberately:
always-on, no menu item, and meant for exactly one column. The ambiguity the
prefix freeze exists to avoid ("where does a middle column sit now") doesn't
apply to a column that is always last. Wired into the actions column on
`tools/page.tsx`, `people/page.tsx` and `projects/page.tsx`, which also now
say "Actions" in the header instead of rendering blank. New CSS,
`.sti-freeze-edge-right` in `globals.css`, mirrors the existing
`.sti-freeze-edge` — the seam shadow falls on the opposite side, since
content scrolls out from under a right-frozen cell to the left.

### The pager sticks to the top of the browser window

Wrapped in its own `sticky top-0 z-30` div. The wrapper around the pager and
table changed from `overflow-hidden` to `overflow-clip` — the same fix
already used in `app-shell.tsx` for the identical reason: `hidden` makes an
element a scroll container even when nothing inside it ever scrolls, which
would have quietly made the pager stick to *that* box instead of the page.
The pager's own background changed from a translucent `bg-muted/30` to solid
`bg-muted`, since rows now scroll underneath it.

## What was found while building it

**Removing the header's sort control revealed the API dev server wasn't
picking up Phase 1's schema change.** Verifying this phase in a real browser
(see Verified) hit `/projects` returning a 500 with `column "cost_center"
does not exist` — a column dropped in Phase 1, days of container uptime ago.
`vitest` and the seed script both run as fresh subprocesses that read
current source and had both been green; the actual long-running server
(`tsx watch src/index.ts`, started before this session) apparently doesn't
reliably hot-reload changes to sibling workspace packages
(`packages/db`, `packages/api-contracts`) the way it does its own source.
`docker compose restart api` fixed it immediately. Worth carrying into the
remaining phases: restart the api container after editing a workspace
package, don't assume the watcher caught it.

**The stickyRight mechanism was built but never actually turned on.** The
column-def flag and the rendering logic existed in `data-table.tsx` and
`columns.ts` before any page set `stickyRight: true` or changed its
`header: ""` — so the feature did nothing on any of the three registers until
a real browser check caught the header text still coming back empty. Neither
`tsc` nor the existing test suite would have caught this; both are
indifferent to a prop nobody passed.

**A genuinely sticky element and a permanently-visible one look identical in
a screenshot.** An early check compared the pager's position before and
after a scroll and found it had *moved*, which read as "not sticky" — it
hadn't: it moved from its natural in-flow offset up to the top of the
scrollable region and then held there, which is exactly what sticky
positioning is supposed to do. The right check is whether it keeps moving
once scrolling continues past that point (it doesn't) — measured at three
scroll depths to confirm.

**The column header cannot stick the same way, and the reason is structural,
not a bug to fix later.** `.sti-table-scroll` (the table's own
horizontal-scroll wrapper) is already a scroll container on *both* axes: CSS
requires `overflow-y` to compute as `auto` whenever `overflow-x` is anything
but `visible`, so `overflow-x: auto` alone makes the box a vertical scroll
container even though nothing ever scrolls it vertically — a fact this
file's own CSS comment had already worked out and recorded on 2026-08-28. A
sticky header placed inside that box binds to the box's own vertical
viewport, which never scrolls, so it would sit inertly in place rather than
following the browser window. Making it work needs the header split into its
own row outside the horizontal-scroll box, with its scroll position synced
to the body's — a real restructure, not a CSS tweak, and not something to
attempt without a browser to check it in.

## Verified

- `pnpm typecheck` clean for `@stinventory/web`.
- The full committed e2e suite, run against the already-running Docker stack
  from the host (`pnpm --dir e2e exec playwright test`, using the
  already-installed Chromium) — all passing, including
  `table-freeze.spec.ts`, `table-grid-and-filter.spec.ts`,
  `table-resize.spec.ts` and `table-columns-align.spec.ts`. None needed
  changes beyond one stale comment (`table-resize.spec.ts`, referencing the
  now-removed header sort button).
- A throwaway spec (written, run, then deleted — not committed, per the
  don't-commit-verification-scripts convention) specifically exercised this
  phase and Phase 2 together in a real browser: the Code/Ref# column order,
  the Employee Code and Project Code columns, the manual-code pencil icon,
  the actions column's header text and its resistance to a 300px horizontal
  scroll, and the pager's position at three scroll depths.
- This is also where it became clear that real browser verification is
  available this session at all — `pnpm --dir e2e exec playwright test`
  against the live stack, not just `tsc` and `vitest` as assumed going into
  Phase 1. Worth remembering for the phases still ahead, several of which
  touch UI that's much harder to reason about from source alone (the
  sidebar's two candidate placements in Phase 7, especially).

## Deliberately not done

- **The column header does not stick to the browser window.** Only the
  pager does. See the CSS constraint above; tracked as follow-up work
  requiring the header/body split, not attempted blind this phase.
- **No general "freeze from the right."** `stickyRight` is deliberately not
  a rival to the leading-prefix freeze — it has no menu item, no persisted
  state, and applies to exactly the one column that's always last.

## Where it is

Branch `development`, uncommitted at the time of writing, on top of Phases 1
and 2's diff in the same working tree.
