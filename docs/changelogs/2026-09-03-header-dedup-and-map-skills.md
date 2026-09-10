# The org chart's pan and zoom stop fighting the page, and the desk stops repeating its own page titles

Follow-on to the same day's [2026-09-02-org-chart.md](2026-09-02-org-chart.md) and
[2026-09-03-team-role-register.md](2026-09-03-team-role-register.md). Both were built and
typechecked but never actually clicked through — Playwright's browser tools were not
reachable in this session, confirmed by a subagent that tried and stopped rather than
fabricate a result. What follows is what the user found by clicking through it themselves,
across several screenshots, and the fixes for each.

## What changed

### The org chart's canvas: four rounds of the same underlying fight, resolved by not having it

Reported, in order, against a running dev server: (1) search dimmed everything but gave no
way to tell WHERE the match was; (2) drag-to-pan selected the card text underneath it like a
document, and separately felt uncontrollable — a wheel tick zoomed toward the cursor on every
tiny scroll delta, so an ordinary trackpad swipe fired dozens of rapid zoom steps; (3) the
page itself kept scrolling underneath the canvas at the same time; (4) scrolling over the
canvas while trying to scroll the surrounding PAGE past it kept getting captured instead.

Each fix addressed the reported symptom and each attempt was itself proven wrong by the next
screenshot:

- Search now auto-centres the first match (via a real pan/zoom viewport driven by
  `transform: translate() scale()`, not a scroll container) and offers prev/next cycling
  with a match counter.
- Drag-to-pan gained `select-none` plus a `preventDefault` on pointerdown, stopping the
  native text selection.
- Wheel was first split (plain scroll pans, Ctrl/Cmd+scroll zooms) to stop the
  zoom-toward-cursor problem, which surfaced that React binds `onWheel` as a PASSIVE
  listener — `preventDefault()` inside it is silently ignored by the browser, so the page
  scrolled underneath the canvas regardless of what the handler tried to do. Rebuilding it
  as a native `addEventListener("wheel", handler, { passive: false })` fixed the page-scroll
  bleed-through but not the underlying complaint.
- The actual fix, once the timesheet product's own org chart (`crew_group_chart.js`, jQuery
  orgchart, `pan: true`) was checked for precedent: **no wheel handling at all.** Pan is
  drag-only; zoom is the +/- buttons only; the wheel is left alone to do whatever the
  surrounding page wants. Every wheel-based attempt before this was a variation on refereeing
  one input device for two conflicting jobs — removing the referee stopped the fight instead
  of tuning it.

Also fixed while auditing the pan logic before ever seeing it render: `centerOn` depended on
`[zoom]`, so clicking a zoom button re-triggered the effect that centres on the last search
match — the view would silently snap back to wherever you last searched, every time you
tried to zoom in on it. Caught by re-deriving the transform math by hand, not by clicking;
fixed with a ref-based stable callback and `flushSync` instead of a reactive `useEffect`
keyed on `[focusKey, collapsed, centerOn]`.

### Three native `<select>` elements, found and removed

`.claude/rules/web.md` states plainly that the sweep removing every native `<select>` from
this app is complete and `grep -rn '<select' apps/web` should return nothing. The org-chart
page shipped with three (two filters, and would have needed a third for the reports-to
picker). Replaced with `SearchSelect` (the filter-bar convention) and `EntityPicker` (the
same component the jobsite team strip already uses for exactly this kind of pick) — caught
by re-reading the rule file before finishing the page, not by a lint failure.

### `projectTeam.setReportsTo` — a second, narrower write path

Added so the By Jobsite tab could let somebody actually set a person's boss without going
through `projectTeam.assign`, which — for a custody-moving role — would call
`moveEmployeeToProject` even when only the `reportsToEmployeeId` pointer changed, closing and
reopening a real custody link to edit an unrelated column. `setReportsTo` touches exactly one
column, writes no ledger event, and shares the same permission gate and cycle guard as
assignment.

### `PageHeader` gains `hideTitle`, and five pages stop repeating themselves

Reported directly, with a screenshot: `/org-chart`'s page-content title was a second
"Organization Chart" a few pixels under the top bar's own, which already renders the active
nav item's label (`app-shell.tsx`, `current.label`) for every route but `/home`. Checked
against every `PageHeader` consumer before touching any of them:

- `/org-chart` and `/settings/team-roles` had no genuine use for the header beyond the
  duplicate title — `PageHeader` removed entirely from both. (An earlier pass wrongly
  believed team-roles had nothing else there either; it has an "Add a role" button living in
  `actions`, caught before deleting it — corrected to the `hideTitle` treatment below instead
  of a blind removal.)
- `/projects`, `/people`, `/equipment` use `PageHeader` for a real description sentence and
  real action buttons (Add, Export), not just the title — a blind removal would have
  orphaned those. `PageHeader` gained a `hideTitle` prop that drops the icon box and the
  `<h1>` while leaving `description` and `actions` exactly where they were.
- Detail pages (`/people/[id]`, `/tools/[id]`) were left untouched: their title is the
  specific record's own name, which the top bar cannot show — not a duplicate.

### Three skills, prefixed `optix-*`

`explain-before-deciding` (added earlier the same day, after being asked to decide on
`canRunAJob` and `SEED_RESET=1` with neither explained) renamed to
`optix-explain-before-deciding` — the user's stated convention going forward: every
STInventory-specific skill carries the `optix-*` prefix, distinct from the generic ones this
project inherited (`minimal-change`, `changelog`, and the rest already in CLAUDE.md's table).

Two new skills: `optix-map-evaluate` builds `.claude/optix-screen-map.yaml`, one entry per
screen, synthesized from `nav-config.ts`, the actual page source, `docs/architecture/`,
`docs/changelogs/`, and the assistant's own persistent memory of this project — deliberately
NOT placed under `docs/architecture/`, whose own README states its charter as "derived from
the code rather than from memory," which this map explicitly is not. `optix-map-update` is
the fast counterpart: a code-only re-walk that flags new routes `needs_full_evaluation` and
flags vanished ones `stale` rather than silently deleting either, and never touches the
narrative fields only a full evaluation is allowed to write.

## What was found while building it

**Playwright was unreachable this session, and that was said plainly rather than worked
around.** A subagent given explicit browser-driving instructions checked every deferred-tool
search it could and reported back that the MCP tools were not connected — no `browser_navigate`,
no snapshot, nothing. Every fix in this entry was verified by typecheck and by re-deriving the
transform math by hand, not by clicking through it; the user's own screenshots were the actual
verification, iteration by iteration.

**A date was fabricated and caught before committing.** A code comment on `PageHeader` was
written claiming "Added 2026-09-04" without checking — `date +%Y-%m-%d` on the actual machine
said 2026-09-03. Fixed before this entry was written, and worth naming so it doesn't happen
quietly again: a date in a comment is a factual claim, not decoration, and deserves the same
scrutiny as any other assertion in a diff.

## Verified

- `pnpm typecheck` across the workspace: 13 of 13 tasks pass, after every change in this entry.
- `grep -rn '<select' apps/web` returns nothing outside this entry's own explanatory comments.
- The wheel-listener fix and the `centerOn`/`zoom` dependency bug were both confirmed by
  reading the code's actual data flow, not by running it — noted here rather than claimed as
  browser-verified.

**Not verified.** None of this has been clicked through by the assistant. The user's own
screenshots are the only real-browser evidence behind any of it, and the fixes made in
response to the LAST screenshot (page-scroll-while-hovering, and the header dedup) have not
yet had a screenshot of their own.

## Deliberately not done

- The screen map itself (`optix-map-evaluate`'s actual output) had not been generated as of
  this entry — the skill existed, unrun.
- `/projects`, `/people`, `/equipment`'s outer page padding (shared shell chrome,
  `px-4 py-6 lg:px-8 lg:py-8` in `app-shell.tsx`) was flagged as the same category of
  question as the header duplication but left untouched — it is shell-wide, not specific to
  any one page, and changing it is a design decision for every screen at once.

## Where it is

Still `feature/org-chart`, being split into logical commits in the same session this entry
describes. Not pushed, not deployed.
