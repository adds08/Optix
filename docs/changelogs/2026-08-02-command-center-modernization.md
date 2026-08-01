# Command center and modernization: DataTable, top nav, intelligent inbox, dashboard + themes, mobile motion

Implements `docs/19-command-center-and-modernization.md` in one migration
(`0006`) and one deploy. Five phases, all shipped together because they share
one surface (the desk) and one migration.

## Phase 1 — DataTable

- `components/sti/data-table/` — `data-table.tsx` (client + server modes over
  TanStack Table), `columns.ts` (column-def helpers), `pagination.tsx`
  (rows-per-page select, page stepping, "x–y of z"), `filter-sheet.tsx`
  (shadcn Sheet: filters drafted, committed on Apply), and the toolbar
  (search, filter trigger with active-count badge, column visibility, CSV).
- `packages/api-contracts/src/table-helpers.ts` — `pageParamsSchema`,
  `sortSql` with a per-router whitelist, `Paginated<T>`.
- **Server mode is wired end-to-end on `rental.onRent`** — the one list that
  genuinely grows (vendor imports). Sort, page and search round-trip to the
  router, which computes overdue/days-to-off-rent server-side and returns one
  page with the true total.
- The Tool Register's facet rail moved into the filter sheet; the table view
  is now the DataTable in client mode (search, column visibility, sort),
  while the cards view keeps the same facet state. The register deliberately
  stays client-filtered — see the deviation note.
- `DropdownMenuCheckboxItem` added to the ui dropdown-menu (it did not exist).

**Deviation from the spec, deliberate:** `assignment.list`, `transfer.list`
and `employee.list` were NOT moved to server mode. Custody's "Tools out"
metric and the overdue highlight are computed over the FULL assignment set —
server-paginating the same procedure would silently cap those aggregates at
one page, and this dataset is hundreds of rows, not tens of thousands. The
DataTable's server mode exists, is proven on rentals, and the other pages use
the identical component in client mode. Doc 19 was amended to say so.

## Phase 2 — Top nav

- `components/notification-center.tsx` — bell (radix popover) with a badge
  that counts EXACTLY what the inbox counts (unread alerts + every desk
  queue, via the new `dashboard.notifications` procedure), the user's unread
  alerts, queue counts, and a jump to `/inbox`. Polls at the inbox cadence.
- `components/user-menu.tsx` — avatar dropdown at the far right: User profile,
  Settings, Sign out. The sidebar footer is now identity-only.
- `app/(app)/profile/page.tsx` — read-only profile (name, email, role,
  permission count, sign out).

## Phase 3 — Intelligent inbox

- `task.classification` + `task.llm_summary` columns (migration 0006).
- `packages/api-contracts/src/approve.ts` — the two "sign it off" paths
  extracted so `task.approve`, `messaging.confirmAction` and the new
  `inbox.resolve` are literally the same code. Three surfaces used to settle
  the same kind of thing in three ways; now they cannot drift.
- `routers/inbox.ts` — `classified` (recognized / completed / unrecognized
  buckets, tasks + messages), `resolve` (one click, replays through the
  shared executor), `dismiss` (terminal with a reason, history kept), and
  `retryClassify` (re-queues an unrecognized message for the tenant's LLM).
- `inbox/page.tsx` rewritten: Recognized ("Do it" / "Decline"), Unrecognized
  ("Try again" / "Dismiss"), Completed (collapsed history). Non-desk roles
  see their own alerts list, unchanged.

## Phase 4 — Dashboard + theme engine

- `user_preferences` table (migration 0006) + `preferences.get/set` router
  validating against the theme catalog.
- `lib/themes/` — `themes.ts` (three named themes, each with light and dark
  palettes; `drafting-ink` is the original palette with empty overrides, so
  a user with no preference gets byte-identical rendering), `store.ts`
  (Zustand mirror for instant preview), `apply-theme.ts` (inline CSS
  variables, root font-size/family, `data-density`).
- Settings gained **Appearance**: theme cards with light/dark swatches, font
  family, font size (root rem scale), density (compact tightens table cells
  and metric tiles via globals.css). Saved per account.
- Dashboard gained the **Command center** widget grid: Inbox status, Capital
  split (donut), Fleet by status (bars), Movement rate (area) from the new
  `dashboard.charts` aggregate, plus Greeting and Weather (Open-Meteo, no API
  key, degrades silently, yard city default Dallas). A Customize menu toggles
  widget visibility, persisted in `user_preferences.dashboard`.
- The theme toggle now lives in the store; the shell hydrates preferences on
  boot.

## Phase 5 — Mobile motion

- `components/motion.tsx` — `PressableScale` (spring press feedback),
  `ScreenFade` (tab-entrance fade+rise), `AnimatedRow` (rows animate in and
  out). All reanimated 4 on the new architecture.
- The shared `Button` presses with a spring; My Tools rows animate; Hand Off,
  Alerts, tool detail and the action screens fade in. Nothing new on the
  foreman's three-tab nav — the constraint held.

## Found while building

- **The `task.approve` body and `messaging.confirmAction` had diverged into
  three surfaces** (approve button, chat confirm, and now the inbox). The
  extraction into `approve.ts` was the highest-risk change in the batch —
  it is the reason `inbox.resolve` is one click instead of a form.
- **tRPC rc's decorated `utils.preferences.set.mutate` fails to typecheck**
  with `z.record` in the input; `utils.client.preferences.set.mutate` works
  and is used instead. The `useMutation` surface typechecks fine.
- **The mobile app's package name is `mobile`, not `@stinventory/mobile`** —
  filter by `pnpm --filter mobile`.
- **The old settings page save button would have silently overwritten the
  theme** if Appearance shared it; Appearance persists through its own
  `preferences.set`, with a comment saying why.

## Deliberately not done

- No drag-and-drop widget reordering — visibility toggles only, persisted.
- No weather provider with API keys — Open-Meteo only, and the widget hides
  itself on failure.
- Reports keep their dumb client table (print/export surface).
- Mobile offline queue and QR remain roadmap items.
- The register stays client-filtered (HANDOFF.md rationale), server mode
  proven on rentals.

## Verification

Fresh Postgres 16: `migrate` (7 migrations) + `seed` clean. `pnpm typecheck`
12/12, `pnpm test` 6/6 (139 tests), `pnpm lint` clean, `next build` succeeds
with the new /home, /inbox and /settings bundles.
