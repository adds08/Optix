# STInventory Prototype

A single-file, no-build UI prototype of STInventory with sample Urban Infraconstruction
data. Demonstrates the United Rentals-style dashboard we want, plus the core screens.

## Run it

Just open `index.html` in a browser (double-click, or drag into a tab). No server, no
install. Everything is vanilla HTML/CSS/JS; sample data lives in `data.js`.

## What it shows

- **Dashboard** — KPI tiles (available / assigned / reserved / in-repair / lost / maint-due
  / fleet value), an overdue-loans panel, the HR-clearance queue for a terminated foreman,
  and the recent transaction feed.
- **Asset Register** — searchable/filterable table with a category quick-filter row (UR's
  "browse by category" pattern); note the split between *current project* (who's using it)
  and *owning project* (who was charged) on each row.
- **Custody** — filterable list of active hand-offs, one card per asset in custody: a filter
  bar (status / project / custodian / type) above a stack of cards, each showing the hand-off
  dates, parties, and the asset line item — directly adapted from United Rentals' Orders page
  layout, applied to internal custody instead of external rental orders. Includes a temporary
  loan flagged overdue, and the UIC-1012 case where custody ≠ financial ownership.
- **Foremen** — per-foreman tool holdings, value, and project spread (multi-project case).
- **Procurement / Maintenance / Audit Trail** — request pipeline, service schedule, and the
  append-only transaction log that everything else is derived from.

## Visual system

Colors are pulled from `apps/web/app/globals.css` (neutral gray scale,
near-black sidebar, purple `sidebar-primary` accent) so this prototype stays a truthful
preview of the production Next.js app rather than its own one-off palette. Only the
*layout/interaction* patterns are borrowed from United Rentals' site; the color system is
Urban's own.

### Borrowed from United Rentals

- **Persistent jobsite context bar** — pinned under the top bar (jobsite + date range),
  scoping every screen at once, the way UR pins jobsite/transport/dates across its catalog.
- **Faceted left rail with live counts** on the Asset Register. Counts are computed with
  that facet's own filter lifted, so a number always answers "how many would I get if I
  picked this" — UR's behaviour, not a naive total.
- **Card / table view toggle**, breadcrumbs, result counts in the heading, active-filter
  pills, and Quick View (the asset modal).
- **Attribute badges** — UR puts one glanceable non-status fact on each card ("Zero
  Emissions"). Ours carry operational meaning: `High value`, `Service due`,
  `Warranty ends soon` / `expired`.
- **Empty states that instruct** rather than going blank — modelled on UR's
  "Set location to see rates".

### Deliberately *not* borrowed

Rate tiers, Add to Cart, SEO prose blocks, FAQ accordions, marketing video. UR is a
marketplace merchandising to us; STInventory is an internal system of record. Those
patterns are most of what makes a UR page long, and none of them carry meaning here.

### Value hierarchy

Assets at or above `HIGH_VALUE` ($5,000 in the prototype) get a weighted left rail and
heavier cost type in every view, so a $33K total station never reads the same as a $260
drill. That threshold maps to `tenantSettings.highValueThreshold`, which already gates
custody approval server-side in `packages/api-contracts/src/routers/assignment.ts`.

### Photos

Every asset carries a `photoUrl` field (`null` throughout the sample data). Cards, table
rows, custody items, and the detail modal are all built to render a real image and fall
back to an instructive "Add photo" placeholder. Wiring this up in production needs a
`photo_url` column on `asset` plus an upload endpoint — neither exists yet.

## How it maps to production

This is a throwaway front-end over hardcoded arrays. In production those arrays become the
Postgres tables in [../docs/architecture/01-data-model.md](../docs/architecture/01-data-model.md), served by the API layer in
[../docs/02-saas-architecture.md](../docs/02-saas-architecture.md). The `tenant_id`-per-row rule and
event-sourced transaction log are already reflected conceptually here (the audit feed *is*
the log; the register is a projection of it).

## Deliberate scenarios baked into the sample data

- **Terminated foreman** (James Whitaker) still holds 3 assets, one already marked Lost →
  drives the clearance queue.
- **Overdue temporary loan** (UIC-1012, due 2026-06-25) → overdue alert.
- **Custody ≠ ownership** (UIC-1012 charged to Trinity, used on Legacy West).
- **Reserved-but-not-yet-assigned** high-value survey unit (UIC-1014).
- **In-maintenance** damaged cut-off saw (UIC-1008) pulled from Available.
