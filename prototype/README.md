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
- **Asset Register** — searchable/filterable table; note the split between *current
  project* (who's using it) and *owning project* (who was charged) on each row.
- **Assignments** — active custody incl. a temporary loan flagged overdue, and the
  UIC-1012 case where custody ≠ financial ownership.
- **Foremen** — per-foreman tool holdings, value, and project spread (multi-project case).
- **Procurement / Maintenance / Audit Trail** — request pipeline, service schedule, and the
  append-only transaction log that everything else is derived from.

## How it maps to production

This is a throwaway front-end over hardcoded arrays. In production those arrays become the
Postgres tables in [../DATA_MODEL.md](../DATA_MODEL.md), served by the API layer in
[../SAAS_ARCHITECTURE.md](../SAAS_ARCHITECTURE.md). The `tenant_id`-per-row rule and
event-sourced transaction log are already reflected conceptually here (the audit feed *is*
the log; the register is a projection of it).

## Deliberate scenarios baked into the sample data

- **Terminated foreman** (James Whitaker) still holds 3 assets, one already marked Lost →
  drives the clearance queue.
- **Overdue temporary loan** (UIC-1012, due 2026-06-25) → overdue alert.
- **Custody ≠ ownership** (UIC-1012 charged to Trinity, used on Legacy West).
- **Reserved-but-not-yet-assigned** high-value survey unit (UIC-1014).
- **In-maintenance** damaged cut-off saw (UIC-1008) pulled from Available.
