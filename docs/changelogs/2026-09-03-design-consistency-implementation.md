# Tabs and toggles become components, every page gets a header, and the Desk is gone

The design-consistency audit (`docs/workings/DESIGN_CONSISTENCY_PLAN.md`) produced its own
plan, executed here in full. Three read-only audits had already shipped (`Part 0`); this is
Parts A, B and most of C. Branch `fix/ui-inconsistency`, **not** on `main`.

## Part A — hand-rolled segmented controls became the components that existed for them

`ui/tabs.tsx` and `ui/toggle-group.tsx` had zero importers — they were the intended landing
place for the eight hand-rolled segmented controls, which is exactly where they went.

- **A1 — primitives tuned first** (`tabs.tsx`, `toggle-group.tsx`, `toggle.tsx`): radius
  down to `rounded-md`, active-state depth comes from borders not `shadow-sm`, the line
  variant's underline is `after:bg-primary`, triggers are content-width (`flex-none`) not
  stretched. The odd `gap-[--spacing(var(--gap))]` compiles to `calc(var(--spacing) *
  var(--gap))` under Tailwind v4, so `spacing=0` stays a joined segmented control and
  `spacing>0` makes real separated chips.
- **A2 — three whole-view tab surfaces to Radix `Tabs`**: `/custody` (variant default,
  counts in the triggers), `/org-chart` (variant line, the underline look it already had),
  `/old-dash`. Radix brings `role=tablist`, `aria-selected` and arrow-key roving focus —
  none of the hand-rolled versions had any of it.
- **A3 — four real segmented controls to `ToggleGroup` type=single**: the reports group
  chips, the project-monitor pace setting, the appearance density setting, and the
  asset-form cost-target toggle (done last and carefully: it is a form field whose chosen
  value reaches the submit payload).
- **A4 — the `/jobsites` "N without a truck" chip became a `Button`**, matching its
  neighbour, with the warn tint and pressed state kept.

## Part B — the same header component on every page

`PageHeader` gained `hideTitle` for exactly this: the shell top bar already names every
route, so a second copy of the word was duplication. List/hub pages now carry `hideTitle` +
a one-line description (the description is the deliverable); five hand-rolled heading blocks
(activity, admin/roles, account/password, design/construction, design/icons) were swapped
for the shared component; page wrappers unified on `flex flex-col gap-6`.

Special cases held: `/tools` deliberately has no `actions` in the header (Import/Export/New
live in the toolbar row the bulk-action bar swaps into — the 58px jump
`no-layout-shift.spec.ts` asserts never comes back); reports back-links stay above the
header; settings pages are `hideTitle` so the header never reads as a third heading level
above their carded `<h2>`s; `reports/[slug]` kept its `TitleBlock` (a document-of-record
header with Group/Rows/Generated fields that `PageHeader` has no slot for).

`/org-chart` and `/settings/appearance` carried stale "no page header" comments from before
`hideTitle` existed; both were replaced by the real thing.

## Part C — the big one: `/desk` and `/old-dash` are removed

The C4 audit item was framed as a documentation decision ("`web.md`'s route list omits
`/desk`"). Asked, the user chose **full removal of both routes** — twice, including after
being shown the blast radius. The project monitor on `/home` has been lived with since
2026-08-23; the widget dashboard it replaced and the `/desk` command surface are gone.

- Deleted: the two routes, `components/desk/` (Desk, `PANEL_REGISTRY`, its panels),
  `components/sti/dashboard/` (blocky-dashboard-view and its ai-briefing/attention-feed/
  metric-grid), `greeting-bar.tsx`, `movement-chart.tsx`.
- `dashboard-widgets.tsx` **survives** — `/reports/charts/*` and `/reports/audit-trail`
  still use its three chart widgets — but lost the old-dash-only exports (`WIDGET_DEFS`,
  `widgetVisibility`, `InboxStatusWidget`).
- `dashboard.briefing` was deleted rather than exempted: its only caller was the Blocky tab,
  and `reachability.test.ts` (STI-121) says delete the procedure, don't bless it.
- The seed's `old-dashboard` hidden feature row went with the module, and the two
  `nav-feature-flags.spec.ts` hidden-module tests went with the row (user chose "delete the
  hidden tests"); the Settings-can't-be-hidden and beta-badge tests remain.
- e2e `roles.ts` expectations, `reachability.spec.ts` (the ladder test now reads the
  register vs My Tools), `nav-config.ts`, `web.md`, the architecture docs, the screen map
  and the RELEASE_2 plan's STI-1402 (marked done) were all reconciled.

## Part C — the rest

- **C2** — the pages that swallowed query errors and rendered "no data" now say so:
  `ErrorNote` added to the reports hub, `reports/charts/[slug]` and the audit trail.
  (`/profile` was already correct; `/old-dash` was deleted.)
- **C3** — three `.sti-grid` tables carried Tailwind's `border-collapse` utility, fighting
  `.sti-grid`'s `border-collapse: separate`. The utility is gone from all three.
- **C5** — `web.md` now names the Inbox's Recognized rows alongside Custody as the
  deliberate row-action-strip exception (approve/decline is the row's whole purpose).
- **C6 (half)** — `config-eslint/next.mjs` now fails the build on a native `<select>`
  element, turning web.md's prose ban into an enforced rule. Zero current violations.

**Deliberately outstanding.** C1 (status-pill consolidation — the equipment GPS tone table,
three warn-pill sizes, PM/SUP chip copies) and the palette-class half of C6 need the browser
pass / a product decision, and were not forced through blind.

## Found while building

**Web typecheck was failing at the base commit for an environmental reason**: the lockfile
never recorded `@stinventory/domain` as a workspace link, so a fresh `apps/web/node_modules`
had no `@stinventory/domain` and every `@stinventory/domain/org-chart` import failed until a
`pnpm install` re-derived the tree. The missing link is now in `pnpm-lock.yaml`.

**`nav-pins.spec.ts` "a pin is not a permission" is red at the base commit too** — verified
by checking out `125c2d6` and running it. The e2e job was removed from CI on 2026-08-30 and
the skill records `nav-pins.spec.ts` as red/flaky since; this work did not cause it.

## Verified

- `pnpm typecheck` 14/14, `pnpm lint` clean, `pnpm test` green (api-contracts 279 tests,
  domain 44, types 81, intent 40, auth 8, mail 5).
- `no-layout-shift.spec.ts` 7/7 after the `/tools` and `/jobsites` changes.
- Browser DOM/keyboard checks on the migrated tab surfaces: Radix tablists with working
  arrow keys on `/custody`, `/org-chart`, `/old-dash`; the custody header above the tabs.
- `table-grid-and-filter.spec.ts` green; `nav-pins.spec.ts` red at base as well as here.

**Not verified in a browser.** Screenshots of `/custody`, `/org-chart`, `/old-dash` and
`/reports` were captured but this model cannot view images; a human should look at the
touched pages in light + dark on two palettes before this merges.
