# DESIGNER_BRIEF — for Claude Design

> Read this before designing anything. It tells you what STInventory actually is,
> which pages are **live and working**, which pages were **removed** (do not design
> them), which components already exist (reuse, don't reinvent), and how a concept
> becomes a real screen. If a route or component is not listed here, it does not
> exist. If it is listed under "Removed", do not design for it.
>
> Companion files: `design/README.md` (the two existing concepts and their status),
> `docs/workings/SYSTEM_PLAN.md` (system truth), `docs/06-decisions.md` (ADRs).

---

## 1. What this is

STInventory is Urban Infraconstruction's **small-tools & equipment custody platform**:
who holds each serialized tool, where it is, which project paid for it. Not a rental
business, not procurement (yet). The core model is event-sourced: every movement is an
immutable transaction; current state (custodian, project, location) is *derived*.

The product surface has **two very different users**:

- **Field** (foreman, superintendent): three screens. They hold tools and hand them off.
  They never touch the desk.
- **Desk** (owner, admin, equipment_admin, warehouse, PM, engineer, mechanic): the full
  operational surface — the yard, custody, reports.

A design that shows a foreman a desk screen, or shows a desk user a field screen, is a
design for nobody.

---

## 2. Stack & design system (the rules you must not break)

| Thing | Truth |
|---|---|
| Framework | Next.js 15 App Router, Tailwind v4, shadcn **primitives only** (Radix under the hood: dialog, popover, sheet, dropdown, tabs, etc.) |
| Theme | **Light AND dark**, driven by oklch tokens in `apps/web/app/globals.css`. Both themes must work — never hard-code a single-theme hex palette |
| **Status hues are reserved** | `--ok` / `--warn` / `--crit` / `--idle` mean a tool's condition or a workflow state. **Never decorative.** Do not use them for brand accents |
| Typography | Geist Sans + Geist Mono (loaded in `apps/web/app/layout.tsx`). `label-xs` = mono uppercase tracking-widest micro-labels; `.tnum` = tabular numerals |
| Design language | **ADR-7 "Blocky" is the product's visual language** — flat, dense, 4px container radius / 3px chip radius, mono numerals for tags/counts/currency, zebra tool rows, 3px left-edge job bars. See `design/README.md` Concept 1. **Palette is the unconfirmed half**: express it in the oklch tokens, not the concept's dark-only hexes |
| Shapes | The app is an operational console, not a marketing surface. No gradients, no large hero imagery, no rounded-2xl cards, no emoji |

### Existing UI primitives (`apps/web/components/ui/`) — reuse these, do not redesign

`button` · `input` · `label` · `card` · `table` · `dialog` · `sheet` · `drawer` ·
`popover` · `dropdown-menu` · `select` · `search-select` · `tabs` · `toggle-group` ·
`badge` · `avatar` · `checkbox` · `separator` · `tooltip` · `skeleton` · `alert` ·
`breadcrumb` · `chart` (recharts) · `sidebar` · `sonner`

### App-level components (`apps/web/components/` + `components/sti/`) — read before designing

- `sti/app-shell.tsx` — the shell: sidebar rail + top bar (global search, notifications,
  theme toggle, account menu). Two nav configs in `sti/nav-config.ts`
- `sti/status.tsx` — `StatusPill`, `Tag`, `humanize` (the canonical status rendering)
- `sti/facets.tsx`, `sti/flags.tsx` — the faceted filter rail + `isHighValue` (value weight)
- `sti/data-table/` — `DataTable`, `FilterSheet`, `FilterPills` (the table + filter pattern)
- `sti/page.tsx` — `TableSkeleton`, `ErrorNote`, `EmptyState`, `PageHeader`
- `sti/row-actions.tsx`, `asset-actions.tsx`, `tool-menu.tsx` — the action menus
- `sti/asset-card.tsx` — the register card
- `jobsite-crew-card.tsx`, `jobsite-tool-table.tsx`, `rig-picker.tsx`, `crew-assign-dialog.tsx` — jobsite internals
- `jobsite-blocky-view.tsx` + `jobsite-blocky.module.css` — **the Blocky view, already implemented** as a switchable view on `/jobsites`
- `pm-desk-view.tsx` — **the PM Desk concept, already implemented** as a switchable view on `/inbox`
- `vehicle-map.tsx`, `fleet-map-view.tsx` — Leaflet map (the fleet map)
- `mention-input.tsx` — the @-mention input used by chat
- `highlight.tsx` — search-match highlighting
- `sti/construction.tsx` — the construction-language marks (HazardBand, TitleBlock, Plate, TickRule, GridPanel) from `/design/construction`

---

## 3. Live pages — design against these, they are real

### Navigation (two shapes, in `sti/nav-config.ts`)

**FIELD_NAV** (foreman, superintendent): `/my-tools`, `/chat`, `/inbox`

**DESK_NAV** (everyone else): `/home` · `/jobsites`, `/custody`, `/map` · `/reports`,
`/activity` · `/tools`, `/inbox`, `/people`, `/projects`, `/settings`

### The desk pages (the yard runs on these)

| Route | What it is | Key elements |
|---|---|---|
| `/home` | Dashboard | "Needs a person" queue (HR clearance, pending approvals), Fleet position (map embed), Fleet at a glance (status counts), movement chart, Latest log |
| `/jobsites` | **Tools by Jobsite** — the control hub | One card per job: crews (foreman + truck/trailer) + the tools working it. **Two switchable views** — `Cards` (workhorse) and `Blocky` (ADR-7 concept, done). Filter bar: search everything, facets, needs-vehicle chip |
| `/custody` | Custody | Assignments ledger (who holds what), DataTable + filters |
| `/map` | Fleet & Small Tools Map | Leaflet: trucks/trailers + tools aboard; legend, "On the map" / "No GPS fix" panels |
| `/reports` | Reports hub + 12 reports + charts + audit trail | Registry in `apps/web/app/(app)/reports/registry.ts`: asset-register, by-project, by-foreman, by-mechanic, idle, lost, needs-tag, capital-by-project, capital-by-department, capital-split (chart), fleet-status (chart), movements (chart), audit-trail |
| `/activity` | Live tool-movement feed | `JobsiteActivity`, per-job site filter |
| `/tools` | Tool Register | Faceted rail (category/status/flags with count), cards-or-table toggle, value weight, row actions |
| `/tools/[id]` | Tool detail | Full record, custody history, actions (assign/transfer/return), photos, tag plate |
| `/people` | People | Employees list; per-role; `/people/[id]` = person detail with job postings, tools held, project team |
| `/projects` | Projects / Jobs | Job list, job groups, the jobs tools charge to |
| `/inbox` | Inbox — the desk's work queue | **Two switchable views** — `Inbox` (recognized/unrecognized/completed buckets, approve/decline) and `Desk board` (PM Desk concept, done). Non-desk roles see their own alerts |
| `/job-groups` | Job groups | Group jobs for scope/permissions |
| `/settings` | Settings | Chat parser (per-tenant LLM), custody rules, notifications, appearance. `config.manage` gate |
| `/profile` | Profile | Current user |
| `/design/construction`, `/design/icons` | **Design scratch routes — not in nav, ignore for production design** | Deliberate scratch space for evaluating marks |

### The field pages (foremen — phone-first, three jobs only)

| Route | What it is |
|---|---|
| `/my-tools` | What this foreman holds right now (web mirror of the mobile My Tools tab) |
| `/chat` | Hand Off — type one sentence → proposed custody action → confirm. Two panes, @-mentions, history by day |
| `/inbox` | Alerts — things waiting on the person, not the desk |

### The login page (no shell)

`/` — construction-themed split-screen login (`auth-panel.tsx`: an animated yard→truck→job
custody route in line art). Demo accounts prefill when `NEXT_PUBLIC_SHOW_DEMO_LOGINS=1`.

---

## 4. Removed pages — do NOT design these, they are gone

These routes existed and were deleted. If a concept references them, it is stale:

- `/assets` (became `/tools`)
- `/assignments` (became `/custody`)
- `/audit` (became `/reports/audit-trail`)
- `/dashboard` (became `/home`)
- `/desk` (superseded by the current nav)
- `/foremen` (became `/people`)
- `/locations` (folded into jobsites/map)
- `/rentals` (rental model removed 2026-08-09)
- `/vehicles` (became the map + jobsites)
- `/d02/*` — the entire early "d02" prototype shell (dashboard/assignments/audit/
  foremen/tasks/vehicles/verification) — deleted, a different product shape
- Removed components: `bottom-toolbar.tsx`, `job-groups-nav.tsx`,
  `job-group-selector.tsx`, `project-switcher.tsx`, `ai-chat.tsx`, `d02-shell.tsx`,
  `ui/collapsible.tsx`

Also removed from the product model (2026-08-09): **rentals, loans, due dates,
overdue states, money figures on the dashboard** (fleet value/capital live in reports
now). Do not design a "loans" or "rental" screen.

---

## 5. Not built yet — design for the future, but label it roadmap

- Procurement (PR → PO → Receive → Tag → Assign) — no tables at all
- Maintenance & inspections module — no tables (the "Service due" flag is deliberately
  omitted from the register)
- HR clearance sign-off gate + BambooHR trigger (the queue itself is built)
- Mobile QR scanning + offline queue
- Integrations: FoundationSoft, BambooHR, HCSS
- Self-serve SaaS onboarding/billing

---

## 6. Mobile app (Expo Router, separate surface)

`apps/mobile/` — Expo shell, tabs **My Tools / Hand Off / Alerts / Desk**, plus
`/login`, `/tool/[id]`, `/action/[type]`. Thin client over the same API. Design with it
in mind but the web is the priority surface.

---

## 7. How a concept becomes a real screen (do this, it's the pattern)

The two shipped concepts both landed as **switchable views on an existing live route**,
so the client can A/B them and the old view is never destroyed:

1. Pick a **live route** from §3 — the concept must answer a real page's real question.
2. Build it as a component in `apps/web/components/` against **real tRPC data** (the same
   queries the existing view uses). No mock data, no fake rows.
3. Add a small segmented toggle at the top of the page (`Cards`/`Blocky` on `/jobsites`,
   `Inbox`/`Desk board` on `/inbox`).
4. Keep it theme-correct: oklch tokens, both light and dark, status hues reserved.
5. Where the concept mocks a field the domain doesn't hold, **adapt honestly** and say so
   in a comment block at the top of the component (see the two shipped views).

## 8. What Claude Design should deliver

- Concept files that reference **route paths from §3** (not from §4 or your memory of the
  product).
- Designs that work in **both themes** and use the token names above (write the oklch
  values in the concept like `PM Desk.dc.html` did — it lifted them from globals.css).
- If a concept needs a new page, name the route and say which live page it replaces or
  joins; the toggle pattern is the default way in.
- Mark anything that needs new backend tables as "roadmap" so nobody spends a sprint on
  a screen with no data.

## 9. Golden rules (violations get rejected)

1. Field users see field screens; desk users see desk screens. No cross-showing.
2. Both themes. Token-driven. Status hues only for status.
3. Real data. A concept that invents a table that doesn't exist must say so.
4. Reports are the moat — a report screen must be legible printed, and must reconcile
   against the ledger.
5. No rentals, no loans, no overdue states, no dashboard money figures.
6. Reuse the primitives in §2; do not propose replacing Radix behaviors (dialogs,
   comboboxes) with hand-rolled ones — that cost is weeks and loses accessibility.
7. `design/claude-design/` concepts are references, not files to port verbatim — except
   the two already implemented as views, which are done.
