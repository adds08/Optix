# Dashboard, chat and auth redesign — technical plan

Status: **spec**. A redesign + refactor pass over the desk surface: dashboard
architecture, nav, reports consolidation, chat, auth, motion, and the dev
loop. Grounded in what exists — `entity.search`, the messaging router, the
theme engine, `user_preferences`, and the report registry are all reused,
never rebuilt.

## Current state that shapes this plan

| Fact | Consequence |
|---|---|
| `entity.search` already resolves tools/people/jobs/places/trucks (the @-mention picker) | The global nav search is a UI shell over an existing procedure, zero new backend |
| Dashboard home has PageHeader (title+description), 60/40 work-queue+map, metrics, command widgets, activity feed | Titles get removed; the feed becomes a nav item with a badge; tabs split the space |
| `/activity` (audit.read) and the dashboard's "Latest movements" both render `transaction` rows | One source of truth (the ledger); one page; the other surfaces become badges |
| `messaging.*` (send/list/confirmAction/retryClassify) already performs LLM actions with confirm cards | The web chat redesign is presentational + history grouping; actions already execute through `applyChatAction` |
| `user_preferences.dashboard` jsonb exists with widget visibility | The star/default-tab and per-tab layouts persist here — no schema change |
| Leaflet panes (z-index up to 700 inside its container) vs the radix popover (z-50) | The bell-over-map overlap is a real stacking-context bug; the map container needs a bounded z-index |
| Login is a single centered card at `/` | Split layout + construction-themed left panel |
| Nav is a fixed 248px rail in `app-shell.tsx` | Collapsible to an icon rail, state persisted |

## Phase A — Shell & navigation

### A1. Global nav search
- `components/global-search.tsx` in the top bar (desk layout only): radix `Popover` + input; `useDebouncedValue` → `entity.search` (`{ q, limit: 6 }`); results grouped with kind icons (Wrench/HardHat/MapPin/Truck), subtitle + status line already returned by the procedure. `Enter`/click → navigate to `/tools/[id]`, `/people/[id]`, `/projects/[id]`, `/locations`, `/map?unit=`.
- Keyboard: `/` focuses search, `Esc` closes. No new backend.

### A2. Collapsible sidebar
- `app-shell.tsx` aside: expanded (248px) ↔ icon rail (64px, icons + tooltips via the existing `Tooltip` ui). Collapse button at the rail's foot; state in `localStorage` (`sti-sidebar`) — desktop-only state, not a preference-row concern.

### A3. Page titles
- Remove `PageHeader` title+description from `/home` (the tabs carry context). Other pages keep a **compact** header (eyebrow only, or title at 16px — one line, no paragraph). `PageHeader` gains a `compact` prop rather than being deleted, so `/tools`, `/reports` etc. stay navigable.

### A4. Z-index fix (the map/bell bug)
- The Leaflet container in `fleet-map-view.tsx` gets `isolate` + `z-0` on its wrapper; the notification popover content raises to `z-[70]`; the sticky header stays `z-20`. The bug is the map's internal panes escaping its container's stacking context.

## Phase B — Dashboard rebuild (`/home`)

### B1. Tabs
- Two tabs, shadcn-style segmented control: **Fleet at a Glance** | **Command Center**.
- **Default tab**: `user_preferences.dashboard.defaultTab` (no schema change — extend the jsonb shape; router validates). The star sets it; the starred tab renders first on load.

### B2. Fleet at a Glance (default)
1. **Greeting + weather bar** (compact, space-efficient): one gradient bar (~56px) — "Hello {firstName}" + current condition icon (Open-Meteo, no key, yard city default) + temp + feels-like + wind + humidity, subtle horizontal gradient (theme-aware via CSS vars). A **star** button on the bar sets this view as the default. Weather lives ONLY here — never in Command Center.
2. The 60/40 work-queue + fleet-map row stays (it is the answer to "what needs a person").
3. Metric tiles ("Fleet at a glance" — already a glance) stay.
4. **Tasks & logs at the bottom**: the activity feed is replaced by a compact "Latest log" strip (last 8 `transaction` rows) with "View full audit trail" → `/reports/audit-trail`. Card sizes normalize to one visual unit (h fixed on metric tiles, consistent radii) so the fold reads as intentional.

### B3. Command Center tab
- The existing widget grid (Inbox status, Capital split, Fleet by status, Movement rate) — **no weather, no greeting**. Customize menu persists per-tab visibility into `user_preferences.dashboard.widgets[tab]`.

### B4. Widget registry (future-proofing)
- `components/dashboard/widgets/registry.ts`: `{ id, title, tab, defaultVisible, component }`. Custom KPIs, analytics cards, and data cards later = add a registry row + a persisted flag. No switch statements in the page.

## Phase C — Reports consolidation & redundancy

### C1. One activity/log source
- The ledger is the single source of truth: the dashboard strip, the old `/activity` page, and the reports all read `transaction`. **Delete `/activity`**; its content becomes a report: `/reports/audit-trail` — a filterable, paginated transaction table (DataTable server mode against a new `report.auditTrail` procedure with `pageParamsSchema` + filters) plus a movement-rate chart.
- **Sidebar badge**: the nav "Inbox" item and the Reports item show unread/action counts from the existing `dashboard.notifications` aggregate — the badge replaces the redundant feed, satisfying "don't duplicate; badge instead".

### C2. Reports page classification + graphs
- The registry already groups reports (Operations / Utilization / Exceptions / Finance). The index gains group chips (visual classification) and each report card shows a mini sparkline.
- New **graphical report pages** reusing `dashboard.charts` aggregates: Capital split donut, Fleet by status bars, Movements by week area — as `reports/capital-split`, `reports/fleet-status`, `reports/movements` (three thin pages over one query).
- Rename the nav group "Insight" → "Reports & Logs" (or "Insight" stays — decision below).

### C3. What "remove insights" means here
There is no separate Insights page — only the nav group label "Insight" holding Reports + Activity. Action: delete `/activity` (folded into reports), keep one nav item per surface, and badge them.

## Phase D — Chat & LLM interface (`/chat`)

- **Two-pane (lg+)**: conversation list (channels, last message, unread dot) + thread. On mobile the thread fills.
- **History**: group messages by day (`Today / Yesterday / {date}`); infinite scroll via the existing `messaging.feed` pagination.
- **Message lifecycle states** rendered as a quiet stepper: queued → parsed → proposed → applied / requested / borrowed — using `processingStatus`, which already encodes all of these.
- **Action cards** (proposed actions): Confirm / Edit via the existing `messaging.confirmAction` and `action.submit`; @-mention picker stays. Optimistic send (the message appears immediately as "sending", then reconciles on the worker's poll — the inbox already polls at 15s; the chat uses the same cadence).
- **No new API.** Everything executes through the existing `applyChatAction` chain.

## Phase E — Auth page redesign (`/`)

- Split layout: left panel (construction-themed, decorative), right form.
- **Left**: animated lightweight SVG line-art — a hard hat, a hammer, a crane silhouette, a tool crate — with slow CSS transforms (float/draw), `prefers-reduced-motion` respected. No canvas, no WebGL, no deps: 3–4 inline SVG components.
- **Right**: the existing form + demo logins, unchanged behavior.
- **Construction iconography across the app**: lucide already ships HardHat, Wrench, Hammer, Drill, Cone, Truck, Warehouse, Factory, Fuel, Crane — a consistent icon pass replaces generic icons on the surfaces that touch equipment (zero new dependencies).

## Phase F — Motion & async feedback

- **Micro-interactions**: web `PressableScale` (port of the mobile primitive), tab-switch fade (reuse `ScreenFade` pattern via CSS), widget enter stagger (CSS animation-delay), card hover lift.
- **Async states**: a global top progress bar for mutations (thin, brand-colored, driven by a tiny Zustand `working` counter incremented by a shared mutation wrapper in `lib/trpc.ts`), consistent `Busy` buttons, skeletons stay as-is, and the chat stepper above covers the long-running parse path.

## Phase G — Dev environment (remote localhost)

- `make tunnel` — a `cloudflared tunnel --url http://localhost:3100` quick tunnel (free, no account) printing the public URL; docs/README section on pointing `NEXT_PUBLIC_API_URL` at the tunneled API (or the `-f` flag on the web dev server via `HOSTNAME=0.0.0.0`) so a phone on the yard WiFi can hit the local build. `.env.local.example` documents both paths.

## Execution order

1. A (shell: search, collapsible rail, compact headers, z-index) — standalone, low risk.
2. C1 (delete /activity, audit-trail report, sidebar badges) — kills the redundancy first.
3. B (dashboard tabs, weather bar + star, bottom logs, widget registry) — builds on 2's badge.
4. D (chat redesign) — independent, can overlap 2–3.
5. E (auth + icons) — independent.
6. F (motion/async) — a polish pass over 1–5.
7. G (dev tunnel) — infra, anytime.

## Deliberately out of scope

- New chat APIs (the executor is reused as-is).
- Custom KPI authoring UI (the registry is the seam; the builder is a later phase).
- Moving the weather source off Open-Meteo or adding geolocation prompts.
- Mobile dashboard parity (the foreman's three tabs stay).
- Any schema change beyond extending the `user_preferences.dashboard` jsonb (validated in the router).
