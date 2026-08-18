# Dashboard redesign, chat two-pane, auth panel, reports consolidation, motion, dev tunnel

Implements `docs/built/20-dashboard-chat-auth-redesign.md` — no schema migration
(the only data change widens the `user_preferences.dashboard` jsonb shape,
validated in the router). One deploy.

## What shipped

**Shell (A):** global search in the top bar over the existing `entity.search`
resolver (kind icons, `/` shortcut, Enter jumps); collapsible sidebar
(248px ↔ 64px icon rail, persisted, tooltips); `PageHeader` gained `compact`;
the bell-over-map z-index bug fixed — Leaflet's panes were escaping their
container's stacking context, so the map wrapper is now `isolate` + `z-0` and
popovers sit at `z-[70]`.

**Dashboard (B):** two tabs — **Fleet at a Glance** (greeting + weather bar
with the star, work queue + map, metrics, ledger strip at the bottom) and
**Command Center** (the widget grid, no weather). The star sets the default
tab, persisted in `user_preferences.dashboard.defaultTab`. The page title is
gone; tabs carry the context. Widget cards stagger in on tab switch.

**Reports (C):** `/activity` deleted — the dashboard strip, the old page and
the reports all read the same ledger rows, so the audit trail became one
report (`/reports/audit-trail`, server-paginated via `report.auditTrail`
with a whitelisted sort map). The reports hub gained group chips and three
graphical report pages (capital split, fleet status, movement rate) over the
shared `dashboard.charts` aggregate. The nav group is now Reports & Logs with
an inbox badge (queue total from `dashboard.notifications`).

**Chat (D):** two panes on desk screens (channels + thread), history grouped
by day, and every message carries a quiet status line (queued → reading →
ready to confirm → recorded/with the desk) — presentational only; the action
confirm cards still execute through the shared executor. No new API.

**Auth (E):** the decorative construction panel moved to the LEFT, the form to
the right, and the panel is now animated inline-SVG line art (crate, hard hat,
hammer, crane — draw-in + float, `motion-safe:` gated for reduced motion).

**Motion (F):** a global working bar driven by TanStack's own mutation counter
(`useIsMutating` — every mutation in the app flows through one client, so a
"something is being written" line needed zero plumbing); buttons yield on
press (`active:scale`); tab content draws in.

**Dev loop (G):** `make tunnel` (cloudflared quick tunnel, free, no account)
+ a README section on pointing the dev server at `0.0.0.0`.

## Found while building

- **The z-index bug was real and exactly as diagnosed:** Leaflet's panes stack
  to ~700 *inside* their container, which escaped into the root context
  without `isolate`. The bell popover was drawing *under* the map.
- **`user_preferences.dashboard` needed no migration:** the column is jsonb;
  widening the `$type` and the router's zod input is the entire change.
- **`useIsMutating` beat a bespoke working store:** TanStack already counts
  in-flight mutations client-wide; a custom counter would have been a second
  source of truth for the same number.
- **The old login page already had a thesis panel — on the wrong side.** The
  redesign was a reorder plus the animated panel, not a from-scratch build.

## Deliberately not done

- No custom-KPI builder UI — the widget registry pattern (per-tab visibility
  in prefs) is the seam for it.
- No weather source beyond Open-Meteo; the bar degrades silently.
- The register stays client-filtered; only the audit trail went server-paged.
- Mobile dashboard parity and new chat APIs remain out of scope.

## Verification

`pnpm typecheck` 12/12, `pnpm test` 6/6 (139 tests), `pnpm lint` clean,
`next build` succeeds (audit-trail + chart report routes in the table).
