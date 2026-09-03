# Design consistency — audit, what shipped, and what remains

Written 2026-09-03. Supersedes two scratch plans; this is the single file.

## Why this exists

Reported directly: `/jobsites` drew its search and filter row inside a white card while every
other screen put the same controls on the page background — "where is the consistency". That
one screen was fixed on its own. This document is the answer to the wider question.

Three read-only audits ran across `apps/web`: colour and theme tokens, page structure across
all 32 `page.tsx` files, and shared-component usage. **Every finding below is grounded in a
grep with a file and a line.** Nothing here is a generic design-system checklist.

**Two honest framings before the detail.**

The codebase was more disciplined than the complaint implied. The native-`<select>` ban is
fully honoured. Nobody hand-rolls an `EmptyState`. All 19 `EntityField` call sites import the
right one of the two same-named components. The problems are real but they are specific, and
several of them were **introduced by the org-chart work earlier the same day** — of the five
hardcoded colour strings in the whole application, three were in files written hours before
the audit; both of the app's only two `space-y-*` page wrappers were from that work; the only
table missing the house ruled-cell style was from that work.

And the second: **`pnpm lint` was failing on `development`** because that work was verified
with `pnpm typecheck` and `pnpm test` but never lint, which CI runs. Fixed. The behaviour
rule in `CLAUDE.md` names typecheck and tests; lint is a third gate it does not name.

---

## Part 0 — What already shipped

Merged to `development` (`2881385`), typecheck 13/13, lint clean, 279 + 44 tests.

| Done | Detail |
|---|---|
| **Fleet map ignored dark mode** | `fleet-map-view.tsx` held the literal oklch values of `--ok`/`--warn`/`--idle` under a comment claiming they "ARE the design tokens". They were copies — the *light-mode* copies — so in dark mode every pill flipped and the map dots did not. |
| **Five hardcoded amber strings → tokens** | `tools/[id]:212`, `custody:192`, `org-chart:368`, `tree.tsx:61`, `tree.tsx:99`. A grep for hardcoded palette colours across `app/` and `components/` now returns **nothing**. |
| **team-roles table → shared `Table`** | It was the only table without `.sti-grid`, and being raw markup it emitted no `data-slot`, so it could not respond to compact density **at all**. |
| **org-chart tabs → ARIA** | Shipped with no `role="tablist"`, `role="tab"` or `aria-selected`. |
| **8 dead `ui/` primitives deleted** | `select` `alert` `avatar` `breadcrumb` `card` `drawer` `label` `sonner` — zero importers each. `select.tsx` mattered most: the rules ban native selects, so a stock Radix Select is exactly what gets reflexively imported next. |
| **Lint fix** | `org-chart/page.tsx:255` `no-unused-expressions`. |

**One planned change was withdrawn after reading the code.** The audit flagged
`auth-slideshow.tsx:105` for `bg-brand-yellow` on a slide indicator, since brand tokens are
logo-only. The code answers it: the comment says the dot "is the timesheet's yellow, which is
this product's yellow" — deliberate brand continuity with the product being sold alongside —
the element is `aria-hidden` and described as "indicators, not controls", and it sits inside
the `bg-brand-navy` plate on a photograph, which `globals.css` explicitly sanctions.
**A documented decision is not drift.**

---

## The reference — what "correct" means here

Verified from `app/globals.css`. This is the vocabulary to check any change against.

**Status colours — reserved, never decorative.** Each has a light *and* a dark value, so
`bg-warn-bg text-warn` needs **no `dark:` variant**:
`--ok`/`--ok-bg` · `--warn`/`--warn-bg` · `--crit`/`--crit-bg` · `--idle`/`--idle-bg`

**Surfaces:** `--background` `--card` `--popover` `--muted` `--accent` `--primary`
`--secondary` `--destructive` `--border` `--input` `--ring`

**Role, not status:** `--hat-white` `--hat-foreman` `--hat-trade` `--hat-office`

**Logo only:** `--brand-navy` `--brand-yellow` `--brand-mark`

**Shared utilities:** `.sti-grid` (ruled cells) · `.sti-scroll` / `.sti-table-scroll` ·
`.label-xs` · `.tnum` (auto-applied to every `<table>`) · `.sti-hazard` · `.sti-plate`

**Two constraints that are easy to get wrong:**

- **A palette can only override** `paper, ink, card, border, primary, onPrimary, mutedInk,
  accent, rail*`. It **cannot reach the status hues**. So a hardcoded *neutral*
  (slate/gray/zinc) is the loudest possible break — it follows no palette at all — while a
  hardcoded *status* hue breaks the light/dark flip. There are currently zero of either.
- **Compact density reaches exactly six selectors:** `[data-slot="table-cell"]`,
  `[data-slot="table-head"]`, `.metric-card`, `.label-xs`, `.crew-row`, `.crew-row .rig-chip`.
  **Anything not using those is density-blind.** This is why a raw `<table>` is not a
  cosmetic choice.

---

# Part A — Segmented controls *(do this first)*

## The correction: these are three kinds of control, not one

The audit called this "8 hand-rolled segmented controls". That was wrong, and building one
component for all eight would be worse than leaving them alone.

| # | Where | What it actually does | Target |
|---|---|---|---|
| 1 | `custody/page.tsx:247` | Held / Moving / Approval queue — switches the whole view | **Tabs** |
| 2 | `org-chart/page.tsx:454` | Chart / By Jobsite / No reporting line | **Tabs** |
| 3 | `old-dash/page.tsx:182` | Fleet / Command Center / Blocky | **Tabs** (mislabelled `role="group"` today) |
| 4 | `reports/page.tsx:107` `GroupChip` | Filters a grid of report cards | **ToggleGroup** `type="single"` |
| 5 | `monitor-settings.tsx:64` | Wall-board pace — a setting | **ToggleGroup** `type="single"` |
| 6 | `appearance-settings.tsx:196` | Density comfortable/compact — a setting | **ToggleGroup** `type="single"` |
| 7 | `asset-form.tsx:210` | Cost target project/department — a **form field** | **ToggleGroup** `type="single"` |
| 8 | `jobsites/page.tsx:768` | "42 without a truck" — toggles ONE filter | **Not a segmented control.** A `Button` with `aria-pressed`. |

#7 is a form field and #5–6 are settings — they select a *value*, they do not switch a
*panel*, so Tabs would be semantically wrong. #8 only looked related because it sits beside
`:781`, which is **already a `Button`** — two adjacent controls in one toolbar built two ways.

## A1 — Tune `ui/tabs.tsx` to house style *before* adopting it

The stock shadcn component violates two documented house rules. Fix once, in its own commit,
and look at it before going further.

| Stock | House rule | Change |
|---|---|---|
| `rounded-lg` on `TabsList` | *"Radius is tight (6px)"* | `rounded-md` |
| `shadow-sm` on active trigger | *"Depth comes from borders, not shadows"* (`web.md`) | remove |
| `after:bg-foreground` underline | Active colour here is `primary` — both `custody` and `org-chart` use it | `after:bg-primary` |
| `flex-1` on `TabsTrigger` | Forces equal-width; today's tabs are content-width | `flex-none`, or keep only where wanted |

Do the same review on `ui/toggle-group.tsx` before A3.

## A2 — Migrate the three real tab surfaces

**Keep the diff small: use `Tabs` + `TabsList` + `TabsTrigger` and do NOT restructure page
content into `TabsContent`.** Radix's `Tabs.Root` manages the value and gives the list roving
focus and arrow-key navigation on its own; the existing conditional rendering can stay
exactly as it is.

```tsx
<Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
  <TabsList variant="line">
    <TabsTrigger value="chart"><Users className="size-4" />Chart</TabsTrigger>
  </TabsList>
</Tabs>
{tab === "chart" && <ChartView />}   {/* unchanged */}
```

- `custody` → `variant="default"` (filled, matches its current pills); keeps its counts.
- `org-chart` → `variant="line"` (underline, matches what is there).
- `old-dash` → `variant="default"` is the closer match to its joined control.

One commit per page so a regression is bisectable. This also deletes the hand-written ARIA
from all three — Radix emits it, including the roles added to `org-chart` by hand.

## A3 — The four toggle groups

`reports` `GroupChip` · `monitor-settings` pace · `appearance-settings` density ·
`asset-form` cost target → `ToggleGroup type="single"`. Each hand-writes `aria-pressed`
today; `ToggleGroupItem` provides it. **Do `asset-form` last and carefully** — it is a form
field, so confirm the value still reaches submit.

## A4 — `jobsites:768`

Replace the raw `<button>` with `<Button variant="ghost" size="sm" aria-pressed={…}>` to
match its neighbour at `:781`. Smallest and most visible fix in this document.

---

# Part B — A header on every page

## The policy

The top bar (`app-shell.tsx`) already renders the active nav label on every route but
`/home`. So the rule is **not** "put the title back" — that duplication was removed on
purpose. It is: **every page gets the same component in the same slot, carrying a one-line
description and its actions.**

| Page kind | `PageHeader` props | Why |
|---|---|---|
| **List / hub** (`/tools`, `/custody`, `/jobsites`, …) | `hideTitle` + `description` + `actions` | Title is in the top bar; the description orients; actions get a consistent home |
| **Detail** (`/tools/[id]`, `/people/[id]`, `/equipment/[id]`) | full `title` + `eyebrow` + `description` + `actions` | The title is the *record's* name, which the top bar cannot show. Already correct today |
| **Wall board** (`/home`) | none | `fullBleed`; a header breaks the `h-full` chain it needs |
| **Internal** (`/design/*`) | leave as-is | Scratch pages, not product surface |

**Every page gets a description.** That one line is what makes this worth doing rather than
cosmetic, and it is the only new *content* the work needs.

## What changes

**Already correct — no change:** `equipment`, `equipment/[id]`, `people`, `people/[id]`,
`projects`, `tools/[id]`, `settings/team-roles`.

**Hand-rolled headings to replace** (5): `activity` · `admin/roles` · `account/password` ·
`design/construction` · `design/icons`. The last two copy `PageHeader`'s `border-b pb-5`
markup almost verbatim; lowest priority, internal pages.

**No header — add one** (19): `tools` · `custody` · `chat` · `inbox` · `jobsites` · `map` ·
`my-tools` · `old-dash` · `org-chart` · `profile` · `reports` · `reports/[slug]` ·
`reports/audit-trail` · `reports/charts/[slug]` · `settings` · `settings/ai` ·
`settings/appearance` · `settings/modules` · `desk`

## Special cases — each needs judgement, not the rule

- **`/tools` — actions MUST stay in the toolbar.** Its Import/Export/New group
  (`tools/page.tsx:593-605`) is the same row the bulk-action bar swaps into. That is a
  documented decision and **`e2e/tests/no-layout-shift.spec.ts:53` asserts pixel equality on
  it**; moving the actions up reintroduces the exact 58px jump the spec exists to prevent.
  Give `/tools` `hideTitle` + `description` and **no `actions`**, and leave a comment there
  pointing at the spec.
- **`/old-dash`** — its own comment calls the tabs "the page's only header". After A2 the
  header and the tab row must coexist: header above, tabs below.
- **`/custody`, `/org-chart`** — same shape.
- **`/reports/*`** — currently a back-link only. That is navigation, not a header; it can sit
  above `PageHeader` or become the `eyebrow`.
- **`/settings/*`** — content is already carded `<section>`s with `<h2>`s. Check a
  `PageHeader` does not read as a third heading level.

## Root wrapper, folded into the same pass

`flex flex-col gap-6` ×18 · `gap-4` ×7 · `space-y-4` ×2. **Use `gap-6`** — already the
majority, and the `gap-4` pages will look crowded once a description is added. The two
`space-y-4` pages are wrong either way.

---

# Part C — Still open, not yet planned in detail

- **Status pills.** `StatusPill` (`components/sti/status.tsx`) has ~25 call sites and is
  bypassed in ~10 places: `equipment/page.tsx:32-44` duplicates a tone table for three values
  **already in** `ASSET_TONE`; the same warn pill appears at three sizes
  (`jobsite-tool-table:188`, `:328`, `jobsites:984`); the PM/SUP chip is copy-pasted between
  `jobsite-team-strip:81` and `jobsite-card-view:231`, and neither uses `PersonChip`.
- **Five pages silently swallow query errors** — `old-dash`, `reports`, `audit-trail`, `map`,
  `profile`. A failed fetch renders as "no data". `reports/charts/[slug]` uses a plain `<p>`.
- **`.sti-grid` sets `border-collapse: separate`** but `jobsite-tool-table:221`,
  `report-table:129` and `project-monitor:401` also pass Tailwind's `border-collapse`,
  fighting it. `import-dialog` does not. Four callers, two behaviours.
- **Three live dashboards.** `dashboard-widgets.tsx`, `desk/panel-registry.tsx` (whose comment
  says it *replaced* the former) and `blocky-dashboard-view.tsx`. The replaced one was never
  removed. `web.md` documents two of the three and omits `/desk`.
- **Row-action strips.** `custody:226` renders Approve/Decline in a cell, which the rules
  forbid — but approve/decline *is* that screen's purpose, so this may be a deliberate
  exception worth writing down rather than fixing. Same for `inbox:131,174`.
- **Guardrails.** `packages/config-eslint/next.mjs` is currently just `base + globals`. A
  `no-restricted-syntax` rule could fail the build on hardcoded palette classes and on
  `<select`. Worth writing **last**, so it encodes the policy actually chosen.

---

## Sequencing

1. **A1** — tune the two primitives. Own commit; look at it before continuing.
2. **A4** — one line, immediate visible win.
3. **A2** — three tab surfaces, one commit each.
4. **A3** — four toggle groups; `asset-form` last.
5. **B** — headers. After A, because `custody`/`org-chart`/`old-dash` gain a header *and*
   change their tabs, and doing both at once makes the diff unreadable.
6. Root-wrapper `gap-6`, folded into B page by page.
7. Part C, in whatever order you rank it.

## Verification

- `pnpm typecheck`, **`pnpm lint`** and `pnpm test` after each step. Lint is the gate that
  was skipped and it is what turned `development` red.
- **`pnpm --dir e2e exec playwright test no-layout-shift` is mandatory after any `/tools` or
  `/jobsites` change** — it asserts pixel equality, not a tolerance.
- `table-grid-and-filter.spec.ts` and `nav-pins.spec.ts` after the header work.
- **In a browser** — outstanding for everything in Part 0 as well: each migrated tab surface
  driven by **keyboard alone** (arrow keys should move between tabs; that is what Radix buys
  and no hand-rolled version had it), and every touched page in light + dark on two palettes.
  Flip density to compact on `/settings/team-roles` and confirm the table tightens — it
  provably could not before Part 0.

## Risks

- **`ui/tabs.tsx` styling is the whole risk in Part A.** Tuned wrong it changes three screens
  at once. A1 as its own commit, reviewed, before A2.
- **Part B adds vertical space to 19 pages** — exactly the cost objected to on `/org-chart`.
  **Do `/custody` first and look at it** before committing to all nineteen.
- `settings/*` may end up with three heading levels.

---

## Status — A, B and most of C landed 2026-09-03

Implemented and committed on branch `fix/ui-inconsistency` (this file's A/B/C
plan superseded by that execution; the doc above remains the audit record).

### Landed

- **A1** — tuned `ui/tabs.tsx`, `ui/toggle-group.tsx`, `ui/toggle.tsx` (radius,
  no shadow depth, `after:bg-primary`, content-width triggers; verified
  `spacing=0` joined vs `spacing>0` separated under Tailwind v4).
- **A4** — `/jobsites` "without a truck" filter chip is a real `Button`; the
  mandatory `no-layout-shift` spec is green (7/7).
- **A2** — `/custody`, `/org-chart`, `/old-dash` (since deleted) hand-rolled
  tabs → Radix `Tabs`. Keyboard (arrow-key) navigation verified in a browser.
- **A3** — the four real segmented controls → `ToggleGroup` type=single:
  reports group chips, monitor pace, appearance density, asset-form cost
  target (last, form-value semantics preserved).
- **B** — shared `PageHeader` (hideTitle + one-line description) on every list
  page; five hand-rolled headings swapped for it; page wrappers unified on
  `flex flex-col gap-6`. Pilot `/custody` reviewed before the rest.
- **C2** — the three remaining pages that swallowed query errors (reports hub,
  reports charts, audit trail) now render an `ErrorNote`. `/profile` was
  already correct; `/old-dash` was deleted.
- **C3** — the redundant Tailwind `border-collapse` utility removed from the
  three `.sti-grid` tables that fought the class.
- **C4** — **the `/desk` and `/old-dash` surfaces were fully removed at the
  user's direction** (see the C4 heading below), reversing this plan's own
  "keep all three" lean. Routes, components, the orphaned `dashboard.briefing`
  procedure, the seed's hidden-module row, e2e role expectations and the
  nav-feature-flags hidden tests went with them. `dashboard-widgets.tsx`
  survives with only the three chart widgets `/reports/*` uses.
- **C5** — web.md now names the Inbox Recognized rows beside Custody as the
  deliberate row-action-strip exception (approve/decline is the row's purpose).
- **C6 (half)** — `config-eslint/next` now fails the build on a native
  `<select>` element, encoding web.md's ban. Zero current violations.

### Outstanding (needs a browser / product decision, not a refactor)

- **C1 status pills** — the equipment GPS badge tone table, the three warn-pill
  sizes and the PM/SUP chip copies are visual consolidations that want the
  browser pass; none was forced through blind.
- **C6 palette-class guardrail** — the `<select>` half is in; the hardcoded
  colour half should encode the C1 policy once that is chosen.
- Browser review outstanding for everything above (keyboard + light/dark, two
  palettes), per the Verification section.
