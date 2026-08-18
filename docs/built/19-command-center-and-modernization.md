# Command center and modernization: DataTable, top nav, intelligent inbox, dashboard + themes, mobile motion

Status: **spec**, implemented in the same change. Five phases, one migration
(`0006`), one body of work: the desk's command center on web, and a feel-pass
on the foreman's mobile app that adds motion without adding nav.

The hard constraints that shaped everything here:

- **Field UX simplicity.** The foreman gets three tabs and a chat box. Every
  engagement feature on mobile is motion on the screens that already exist —
  no new screens, no new fields, no new nav. The dashboard widgets and theme
  engine are desk-facing.
- **ADR-2.** tRPC is the only API surface; every new read/write is a procedure.
- **The ledger stays append-only.** Nothing in this plan writes to
  `transactions` except the existing custody paths, invoked through
  `applyChatAction` exactly as chat confirm does.
- **Reports keep their dumb client table.** `ReportTable` is a print/export
  surface, not a data grid; it stays untouched.

## Phase 1 — DataTable (web)

One table component for every data-heavy page, with two modes.

### Components (`apps/web/components/sti/data-table/`)

| File | Purpose |
|---|---|
| `data-table.tsx` | Shell: columns, rows, `mode: "client" \| "server"`, toolbar, filter sheet trigger, pagination footer. Client mode uses TanStack Table in-memory (sort/search/page); server mode is controlled: `state` + `onStateChange` props, `rowCount` from the server. |
| `columns.ts` | Column-def helpers (`text`, `numeric`, `tag`, `pill`, `link`, `actions`) over `@tanstack/react-table` `ColumnDef`. |
| `pagination.tsx` | Prev/next, page numbers, **rows-per-page select** (10/25/50/100), "x of y" count. |
| `filter-sheet.tsx` | shadcn `Sheet` wrapper; accepts any filter controls as children plus Apply/Clear. Filter state is a plain object committed on Apply — no refetch per keystroke. |
| `toolbar.tsx` | Search box, filter trigger with active-count badge, column visibility dropdown, CSV export (reuses `lib/csv.ts`). |

### Backend

`packages/api-contracts/src/table-helpers.ts`:

- `pageParamsSchema` — `{ page, pageSize, sortKey, sortDir, filters }`.
- `applyPagination` + `applySort` — sort keys are whitelisted per router via a
  `sortable: Record<string, SQL column>` map; user input can never reach
  `orderBy` unguarded. Returns `{ rows, total }` using a `count()` alongside.
- `Paginated<T>` return type shared by routers.

**Routers that move to server mode** (return `{ rows, total }`; their pages are
rewired in the same change):

- `rental.onRent` — the one list that genuinely grows without bound (vendor
  CSV imports). Default sort stays the router's canonical soonest-due-first;
  the DataTable can re-sort by whitelisted columns (itemName, vendorName,
  endDate, quantity).

**Deliberately NOT moved:** `asset.list`, `assignment.list`, `transfer.list`,
`employee.list`. `HANDOFF.md` documents why the register filters client-side,
and custody's "Tools out" metric plus the overdue highlight are computed over
the *full* assignment set — server-paginating it would silently cap the
aggregates at one page. The DataTable's server mode exists and is proven on
rentals; the other pages use client mode with the same component, which is
where the filter sheet and unified UI live anyway.

## Phase 2 — Top nav (web)

The header in `app/(app)/layout.tsx` becomes: page context left, notification
center + user menu right.

### Components

| File | Purpose |
|---|---|
| `components/top-nav.tsx` | The header row; composes the pieces below. |
| `components/notification-center.tsx` | radix `Popover` bell with unread badge; grouped top-8 list (overdue, approvals, tasks, unresolved); "View all" → `/inbox`. |
| `components/user-menu.tsx` | `Avatar` + `DropdownMenu` at the far right: Settings, User Profile (`/profile`), Sign out. |
| `app/(app)/profile/page.tsx` | Minimal profile page: name, email, role, linked employee, sign-out. |

### Backend

- `dashboard.notifications` — one round-trip: unread count + top 8 across
  overdue loans, pending approvals, open tasks, unresolved messages, clearance.
  Polled by the bell at 8s; no schema change.

## Phase 3 — Intelligent inbox (web + backend)

Classification is stored on the row, resolved by one click, and the LLM is
reused — `packages/intent` already classifies; this phase moves where the
answer lives.

### Schema (migration 0006)

- `task.classification` — `recognized | completed | unrecognized` (nullable).
- `task.llmSummary` — short human sentence, nullable.

### Classification rules (deterministic, `apps/api/src/inbox-classifier.ts`)

| Item | Classification |
|---|---|
| Task with `actionType` + `pendingAction` + resolved entity ids | `recognized` |
| Task/message in a terminal state (completed, cancelled, dismissed, action_executed) | `completed` |
| Message stuck in `pending_manual`, or task with no bindable action | `unrecognized` |

`retryClassify` re-runs the existing tenant LLM parse on an `unrecognized`
item; if it binds to an action, the item moves to `recognized`.

### Backend

- `routers/inbox.ts`:
  - `inbox.classified` — `{ recognized, completed, unrecognized }`, each a
    paginated list of `{ id, kind: "task" | "message", summary, suggestedAction, createdAt }`.
  - `inbox.resolve` — one endpoint, two paths: a `task` replays its
    `pendingAction` through `applyChatAction` (the same executor `task.approve`
    uses, charging the desk's permissions); a `message` goes through
    `messaging.confirmAction`. Returns the transaction ids.
  - `inbox.retryClassify` — LLM re-parse for unrecognized items.
  - `inbox.dismiss` — terminal-state an unrecognized item with a reason.
- The request worker classifies on sweep (idempotent: skip already-classified).

### Frontend

`app/(app)/inbox/page.tsx` rewritten into three sections — **Recognized**
(primary; each row has "Do it" → `inbox.resolve` and "Review" → existing
`ResolveMessage`), **Completed** (collapsed history), **Unrecognized**
(resolve-or-dismiss). Reuses `StatusPill` with new `recognized`/`unrecognized`
tones.

## Phase 4 — Dashboard + theme engine (web)

### Schema (migration 0006)

- `user_preferences` — `tenant_id`, `user_id` (unique), `theme_name`,
  `font_family`, `font_scale`, `density`, `dashboard` (jsonb: widget
  visibility/order), `created_at`, `updated_at`.

### Backend

- `routers/preferences.ts` — `preferences.get`, `preferences.set` (upsert).
- `dashboard.charts` — static aggregates for the widgets:
  `statusDistribution` (by status), `capitalSplit` (project vs department),
  `movementsByWeek` (date_trunc on `transaction.occurred_at`). No LLM.

### Theme engine

- `lib/themes/themes.ts` — named themes (`drafting-ink` = current palette,
  `field-amber`, `concrete`); each carries light and dark overrides for the
  accent-ish tokens (primary, accent, ok/warn/crit, radius).
- `lib/themes/apply-theme.ts` — applies `[data-theme]` + inline CSS variables
  on `:root`/`.dark`; light/dark stays the existing `.dark` class toggle.
- `lib/themes/store.ts` — Zustand store mirroring the active preferences for
  instant feedback; persistence through `preferences.set`; hydration from
  `preferences.get` on boot.
- `settings/page.tsx` gains **Appearance**: theme cards with preview, font
  family select, font size slider (`--font-scale`), density toggle.
- `globals.css` — tokens stay in `:root`/`.dark`; theme overrides are applied
  at runtime, so default rendering is byte-identical until a user picks a theme.

### Dashboard

- `components/dashboard/widgets/` — `inbox-status` (counts from
  `inbox.classified`, live), `fleet-map` (existing `FleetMapView`),
  `charts/*` (recharts: capital split donut, status bars, movements area),
  `greeting` (time-of-day + first name), `weather` (Open-Meteo, no API key;
  defaults to the yard city, degrades silently).
- `home/page.tsx` keeps the 60/40 work-queue + map row, then a widget grid
  below (charts + greeting/weather), then the audit feed. A "Customize"
  dropdown toggles widget visibility, persisted in `user_preferences.dashboard`.
- **Weather is deliberately soft:** Open-Meteo (free, no key) is acceptable;
  no geolocation prompt — city comes from a constant defaulting to Dallas.

## Phase 5 — Mobile motion (Expo)

No new screens, no new nav. reanimated 4.5 is already a dependency.

### Files

| File | Purpose |
|---|---|
| `components/theme.ts` | Token objects (colors, radii, spacing, type scale) mirroring the web palette; `ui.tsx` components consume them. |
| `components/motion.tsx` | `PressableScale` (spring press feedback), `ScreenFade` (fade+slide entrance), `AnimatedCard`/`AnimatedRow` (reanimated `Layout` for enter/exit). |
| `app/(tabs)/index.tsx`, `handoff.tsx`, `alerts.tsx`, `app/tool/[id].tsx` | Wrap screens in `ScreenFade`; rows in `AnimatedRow`; confirm/dismiss animate rows out instead of popping. |

### State

No new state management on mobile — reanimated shared values carry the motion;
tRPC + React Query unchanged.

## Execution order

1. Migration 0006 (task columns + user_preferences) — generated, not hand-written.
2. Phase 1 deps (`@tanstack/react-table`, recharts, zustand) and DataTable.
3. Phase 1 router changes (assignment/transfer/employee pagination) + page refactors.
4. Phase 2 (top nav, notification center, profile).
5. Phase 3 (classifier, inbox router, inbox page).
6. Phase 4 (preferences router, themes, settings, dashboard widgets).
7. Phase 5 (mobile motion).
8. Fresh-DB migrate + seed, typecheck 12/12, tests, lint, next build.

## What is deliberately not in scope

- Reports (`ReportTable`) stay client-side and export-focused.
- Mobile offline queue and QR scanning — separate roadmap items.
- Drag-and-drop widget reordering (visibility toggles only, persisted).
- A weather provider requiring API keys; Open-Meteo only.
