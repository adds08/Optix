# Frontend architecture

**Derived from `apps/web/*`.** Routes below were enumerated from the file system.
The operational rules for editing this area are `.claude/rules/web.md` — that file
is read before every change and is the one that must never go stale; this document
is the map, not the rulebook.

## Two clients, and they stay separate

| Client | Who | Where |
|---|---|---|
| `apps/web` | The desk — equipment admin, PMs, office, HR | Next.js 15 App Router, a PWA |
| `apps/mobile` | The field — foremen, mechanics | Expo |

They share the tRPC *type*, and nothing else. Two shared frontend packages —
`design-system` and `frontend-shared` — were both deleted after going unimported
by either client. **Do not recreate one without proving a second consumer first.**
Web theming lives in `apps/web/lib/themes`.

## Routing

Everything behind a login is in the `(app)` route group, which supplies the shell.

| Area | Routes |
|---|---|
| Entry | `/`, `/forgot-password`, `/invite/[token]`, `/reset/[token]` |
| Dashboard | `/home`, `/old-dash` |
| Registry | `/tools`, `/tools/[id]`, `/equipment`, `/equipment/[id]` |
| Operations | `/jobsites`, `/custody`, `/map`, `/desk`, `/inbox` |
| Organization | `/people`, `/people/[id]`, `/projects`, `/org-chart` |
| Field | `/my-tools`, `/chat` |
| Reporting | `/reports`, `/reports/[slug]`, `/reports/audit-trail`, `/reports/charts/[slug]` |
| Admin | `/admin/roles`, `/settings`, `/settings/ai`, `/settings/appearance`, `/settings/modules`, `/settings/team-roles`, `/activity` |
| Self | `/profile`, `/account/password` |
| Design references | `/design/construction`, `/design/icons` |

`/` is not a landing page — it decides where you actually go. If the user has
pinned navigation rows, the first pin wins over `/home`; field roles are redirected
to `/my-tools` by the shell regardless.

## The shell is a module frame

`components/sti/app-shell.tsx`, with `app-rail.tsx` and `app-sidebar.tsx`. The rail
names modules; the sidebar names the rows inside the active module;
`nav-config.ts` is the single declaration of both.

**Every `NavItem` carries a stable `id`**, never derived from its route, because
pins are stored against ids and a renamed route must not silently unpin somebody.
When "Tool Register" became "Small Tools", the id stayed `tool-register` for
exactly that reason.

Navigation is permission-filtered against `me.permissions` centrally — the sidebar
does no filtering of its own. **A pin is not a permission**: a pinned id naming a
route the actor may not open resolves to nothing rather than rendering it.

### Layout stability is a hard rule

Nothing may change height or position in response to hovering, selecting or
opening. Controls that appear on interaction occupy their space permanently and
change only their opacity; bulk-action bars swap into an existing toolbar row
rather than inserting a new one. `e2e/tests/no-layout-shift.spec.ts` measures it,
and it measures scroll-adjusted position because the shell scrolls an inner
region rather than the window.

## Theming

**A theme is a colour palette and nothing else.** The design language — radii, the
Inter Tight + JetBrains Mono pairing, the two-pane shell, the reserved status hues
— is global by construction and no palette can reach it.

Palettes are enumerated in `lib/themes/themes.ts` and applied as inline CSS custom
properties on `<html>` by `lib/themes/apply-theme.ts`. A boot script in
`app/layout.tsx` replays the cached choice synchronously before first paint;
without it every reload rendered the default and swapped a moment later, which
read as "the theme did not apply".

Three per-user knobs beyond the palette: font family, font scale, and **icon scale**
— separate from font scale, because everything is rem-based so icons already track
the type; what the icon knob changes is the *ratio* of a glyph to the word beside
it.

## Tables

`components/sti/data-table/` is the one table component for the data-heavy pages,
in two modes: client (sort, filter and page in memory) and server (the page owns
the state and it round-trips to a paginated procedure).

What it does, and the reason each exists:

- **Ruled cells on both axes** (`.sti-grid`), `border-collapse: separate` — which
  is load-bearing, not cosmetic, because collapsed borders are not clipped by a
  sticky cell and streak across frozen columns.
- **The pager sits above the header**, where Urban's timesheet has always put it.
- **A column menu on every column that holds a value** — sort, hide, freeze, and a
  searchable tick list of that column's distinct values.
- **Resizable columns**, persisted per browser.
- **Freezing**: columns as a prefix ("freeze up to here"), rows individually
  through TanStack row pinning, so a frozen row survives a page change.
- **Visible scrollbars**, because macOS overlay scrollbars vanish and take with
  them any sign that the columns continue.

Some tables are hand-rolled on purpose — `jobsite-tool-table.tsx` carries
selection, grouping by crew and a per-row menu, and swapping it for `DataTable`
would be a rewrite rather than a simplification. They share the CSS, not the
component.

**Row menus split once**: Actions, for what you do to the thing, and Table, for how
you look at it. Not twice.

## State

- **Server state** is TanStack Query through tRPC. There is no client cache of
  domain data beyond it.
- **Session state** is the `identity.me` query. `perms` is `[]` until it resolves,
  which has caused a real bug — anything gated on permissions must wait for
  `me.data` rather than reading an empty array as "denied".
- **Preferences** persist server-side per user and are mirrored to
  `localStorage` under `sti-*` keys purely so the boot script can repaint before
  React mounts.
- **Per-table view state** — column widths, frozen count — is browser-local under
  `sti-colwidths:*` and `sti-frozen:*`, and is validated on read, because storage
  belongs to whoever holds the browser.

## Permissions in the UI

`components/can.tsx` and `components/use-permissions.ts`. A hidden control is a courtesy,
never a control: every gate that matters is on the procedure. The client filter on
job scope is the clearest case — **a client-side filter is not access control**.

## Testing

`e2e/` drives a real browser against the Docker stack. Every spec is **read-only**
by design — it signs in, navigates and asserts — which is why the suite needs no
database isolation. The first mutating spec needs an isolation mechanism *first*,
and that decision is written into the config rather than left to be discovered.

`reachability.spec.ts` asserts each seeded role lands on the right screen and is
offered exactly the navigation its permissions imply — including the half that
catches a widening, because an extra link is a leak nobody reports.
