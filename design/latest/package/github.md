repo: adds08/Urban-STInventory
branch: main
path: apps/web

## Last sync

date: 2026-08-23T06:30:05Z

### Updated in this project

- **Collapsed the whole project into one React file.** `App.jsx` replaces `System Shell v3.dc.html`, `Tools by Jobsite Blocky.dc.html`, `Project Monitor.dc.html`, `FieldChat.dc.html` and the `design_handoff_shell/` bundle — all deleted. One theme map drives light/dark, and the three surfaces (desk shell, Tools by Jobsite, Project Monitor) are components in that file. `STInventory App.dc.html` is a two-line mount so it renders in preview; it holds no design.
- **Resynced navigation on the current `nav-config.ts`.** DESK_NAV has moved on since the last sync: **`/desk` is new and sits in BOTH navs** (STI-501 — the Desk composes itself from the permission registry, so the link is deliberately ungated), `/home` is now the Dashboard, `/custody` and `/job-groups` exist, `/map` is labelled **Fleet & Small Tools Map**, and `/reports` is **Reports & Logs**. FIELD_NAV is now Desk / My Tools / Hand Off / **Alerts**. The rail carries the real four groups, labels, hrefs and `perm` values; undesigned rows render an honest placeholder naming the route.
- **`FIELD_ROLES` gained `mechanic`** (STI-304) and the file states it is the last role-name branch in the product, with STI-501 replacing it with a permission-driven registry. Recorded, not designed against.
- **The borrow model is gone.** `expected_end_date` was removed on 2026-08-09 (migration 0012) and the nav comment now reads "nothing goes overdue". Our surfaces use tool **condition** (Good / Fair / Needs service), not due dates, so no screen needed rebuilding — but any future "overdue" feed would be inventing a concept the schema no longer has.
- **Palette unchanged.** `--radius: 0.375rem`, `--primary`, `--accent` and the reserved `--ok / --warn / --crit / --idle` set are identical to the last sync in both `:root` and `.dark`.
- **Project Monitor has no upstream route.** It is marked NEW in the rail as a proposal, not a recreation.

## Screen map

| Project screen | Built from |
| --- | --- |
| `App.jsx` — rail groups, labels, hrefs, permission values | `apps/web/components/sti/nav-config.ts` (DESK_NAV / FIELD_NAV, `navFor`, `isFieldRole`), `apps/web/components/app-sidebar.tsx` (per-item `perm` filter) |
| `App.jsx` — shell frame, top bar, one scroll region | `apps/web/components/sti/app-shell.tsx`, `docs/changelogs/2026-08-07-app-shell-viewport-frame.md` |
| `App.jsx` — `Dashboard` metrics | `apps/web/app/(app)/home/page.tsx`, `docs/14-dashboard-additions.md` |
| `App.jsx` — `ToolsByJobsite` board, crew rig status | `apps/web/app/(app)/jobsites/page.tsx`, `apps/web/lib/rig.ts`, `docs/18-vehicle-tracking-and-map.md` |
| `App.jsx` — `ProjectMonitor` wall display | No upstream route — our proposal; tool/foreman shape follows `/jobsites` |
| Blocky design system (`tokens/`, `components/`, `guidelines/`, `readme.md`) | `apps/web/app/globals.css` (`:root` + `.dark`, `--radius`, `.label-xs`, `.tag-num`, reserved status tokens) |
| Wording throughout | `docs/09-vocabulary.md` (holder, Who Has What, In the yard) |

## Notes

- **The upstream dashboard now has its own implementation of docs 14+20.** Two tabs (Fleet at a Glance | Command Center), a greeting+weather bar, attention cards (overdue, clearance, awaiting approval, loans to verify), fleet map, metric tiles (including Capital on jobs, Capital in the shop, Missing serials, Idle tools), movement chart, and a latest-log ledger strip. Our Main Desk is a different exploration of the same doc-14 brief — needs-you/stuck feeds in one list with Check/Approve/Clearance marks, tools-by-project tables, and a rail with leavers/register/money. Both designs answer "what changed, what is stuck, what needs you"; they answer it differently.
- **The upstream chat page was redesigned per doc 20.** Two-pane (channels + thread), day-grouped history, message lifecycle stepper (queued → processing → proposed → executed / requested), tool cards with tag/model/holder/status on both proposed and settled messages. Our FieldChat was a separate exploration.
- **The ordering flow in PM Desk is still ahead of the codebase.** No `/vendors` route, no vendor router beyond a read-only `rental.vendors` filter list, and `asset` has no `purchasedFromVendorId` or `purchaseOrderId`. `rental_order` + `rental_line` are the only order tables.
- The desk that claims a request is any active `equipment_admin` or `warehouse` employee — requests are notified to all of them rather than assigned to one.
- `packages/design-system/tokens/*.ts` is a **stale shadcn stub** — `apps/web/app/globals.css` is the real palette. Do not theme from the tokens package.
- This project is a **visual exploration**, not a drop-in replacement — the real screens are wired to tRPC and gated by permissions.
- **`jobsites/page.tsx` has evolved significantly** since our Tools by Jobsite was built: crew assignment via `projectTeam.assign`, filter sheet (replacing inline dropdowns), collapse-all/expand-all toggle, loose-tool multi-select with "Assign to foreman…", rig-gap filters split into no_crew/no_truck/no_trailer, and per-card-type tinting (job=primary, yard=muted, not-assigned=accent).

## Sync history

### 2026-08-17T15:19:51Z

### Updated in this project

- **Consolidated to one shell.** Deleted the superseded explorations — System Shell + v2, Main Desk, PM Desk, PM Desk in Shell, STInventory + v2 + v3 + Redesign, and the four earlier Tools by Jobsite variants. `System Shell v3.dc.html` is the single frame; it imports `Tools by Jobsite Blocky` and `FieldChat`. The screen map below is rewritten to match what still exists.

- **Reseated System Shell v3's navigation on the real RBAC model.** The shell shipped with invented apps (Extensions/Marketplace, Timesheet, Procurement, Vendors, Departments) and an invented role switcher. Upstream has neither: `nav-config.ts` ships exactly **FIELD_NAV** and **DESK_NAV**, `navFor(role)` picks one, and `app-sidebar.tsx` then drops any row whose `perm` is not in the session's permission set. The shell now carries those two shapes verbatim — DESK_NAV's four groups (Overview, Equipment, Insight, Entity) on the 48px rail, their real rows and `href`s in the sidebar — and filters per row the same way.
- **Removed the role switcher.** Role and permissions come from the session (`identity.me`) and are administered through RBAC by admins; there is no in-product control that changes them. They are `role` / `permissions` props on the shell so a designer can preview a seat, and the file says so.
- Picked up the shell's real layout contract from `docs/changelogs/2026-08-07-app-shell-viewport-frame.md`: the frame is exactly one viewport and does not scroll, the only scroll region is the page area under the top bar, and the rail header and top bar are both `h-14` so their borders meet as one rule. Also noted the rail is **17rem** (not shadcn's 16) and the `inset` variant is gone.
- **Global search is hidden for field roles**, matching `app-shell.tsx` (`{!field ? <GlobalSearch /> : null}`).
- Made **Tools by Jobsite Blocky** embeddable — an `embedded` prop drops its `100vh` root, its own H1 (the shell top bar owns page title), and narrows the 44px page gutters to 20px. Standalone rendering is unchanged.
- Palette tokens in `globals.css` (`:root` + `.dark`) are **unchanged** since the last sync; `nav-config.ts` is unchanged; `packages/types/src/index.ts` still ships 10 `ROLES` and 28 `PERMISSIONS` with the MVP-active five.
- Noted new in `globals.css` since the last sync's inventory: `.sti-hazard-edge`, `.sti-scroll`, `.sti-table-scroll`, and the `html[data-density="compact"]` variant (docs/19) — plus `sti-draw-in`, `sti-spin`, `sti-bubble`, `sti-tape-blade`, `sti-tape-hook` keyframes and the `.sti-token` offset-path. None are used by our screens yet.

### 2026-08-15T19:00:57Z

- No screen rebuilds. Base palette tokens (`:root` and `.dark` in `globals.css`) unchanged; `nav-config.ts` structure unchanged; `docs/14-dashboard-additions.md` unchanged; `task.ts` schema unchanged.
- Noted **docs/20-dashboard-chat-auth-redesign.md** as already implemented upstream: dashboard tabs (Fleet at a Glance | Command Center), greeting+weather bar, command-center widgets, construction-themed auth panel, and the redesigned two-pane chat page.
- Noted construction vocabulary in `globals.css` (`.sti-hazard`, `.sti-grid-paper`, `.sti-plate`, `.sti-tick-rule`) and the auth panel's custody-route keyframes.
- Noted schema additions `employeeProjectAssignment`, `projectTeamMember`, and `location.custodianEmployeeId`.

### 2026-08-15T17:29:20Z

- Built **Main Desk** — the equipment desk's home screen, shaped by `docs/14-dashboard-additions.md`: not stock levels, but what changed, what is stuck, and what needs you. Scoped All projects / Job group / One project off the real `project_group` tables.
- Doc 14's central split is honoured in one list, marked per row: **Check** ("this already happened, is the record right") versus **Approve** ("may this happen"). Mixing them makes the desk read every row twice.
- Small tools are grouped by the project they are charged to, with holder, where it is, condition and last-touched. Untagged tools render as `no tag` in italic, not as an error — `asset.tag` is nullable on purpose (docs/17).
- Rail carries doc 14's four asks: money sitting in the yard, capital on jobs vs in the shop, in-the-yard count, and **tagged-but-no-serial** as a consequence ("cannot be identified if stolen"), gated on `isSerialized` so bulk items are not counted as a gap.
- **Course-corrected mid-planning.** Earlier drafts of this screen had a repair/shop module, a service-due page, and Vendors + POs. All three were wrong: maintenance is Phase B in `docs/00`, and `docs/16-handoff-brief.md` states plainly that doc 15 is a roadmap and must not be implemented. Also dropped the word "Fleet" — `docs/09-vocabulary.md` already rejected it, since trucks and trailers are locations that move.

### 2026-08-13T00:00:00Z

- Picked up the **intelligent inbox classification** upstream (`task.classification`, `task.llmSummary`, docs/19): each PM Desk request detail now shows a **READING** row — Recognized (an `actionType` + `pendingAction` the desk can replay on approval) or Unrecognized in `--warn` (nothing bound, a human must resolve it). Work items and Project-team routes read as unrecognized, which is what the parser actually does with prose.
- Re-verified against upstream `main`: `nav-config.ts` still ships exactly FIELD_NAV and DESK_NAV (no PROJECT shape merged), `globals.css` tokens and `--radius` unchanged, and `docs/15-vendors-and-orders.md` is still roadmap — **Urban-issued PO numbers still do not exist**. No screen rebuild needed for those.
- Noted but not surfaced: the request worker now also chases **stale `action_proposed` messages** (author first, desk as backup, same widening interval, max 4). That is a FieldChat hand-off concern, not a PM Desk request concern, so the board was left alone.

### 2026-08-11T10:09:38Z

- Rebuilt **PM Desk** routing on the real request model: requests are `task` rows raised **unassigned** — the desk claims them. Nothing auto-approves (ADR-4, `request-worker.ts`).
- Replaced invented desks with the real `task.department` values — **Equipment Yard, Maintenance, Procurement** — plus a clearly-marked "Project team" route for permits and safety, which are not equipment desks.
- Added the escalation clock the worker actually runs: chased after 1h, then daily, max 4 chases, priority raised to high after the second — surfaced as CHASED in each request's detail.
- Status vocabulary now reads Pending / Claimed / Ordered / Blocked / In shop, and the vendor path is labelled honestly: **Urban-issued PO numbers (`UIC-PO-00042`) do not exist yet** — they are roadmap in `docs/15-vendors-and-orders.md`.
- Re-seated the **entire PM Desk palette on `globals.css`** — `:root` and `.dark` oklch tokens verbatim (background, card, muted, border, primary, accent) instead of the hand-picked hexes it shipped with. No raw hex remains in the component.
- Status colour is now the reserved `--ok / --warn / --crit / --idle` set only. The decorative purple invented for the vendor chip is gone — vendors read as an `--accent` tint, since globals.css states status hues are never reused decoratively.
- Pinned radius to the repo's `--radius: 0.375rem` scale (6px surfaces, 4px controls) and matched `.label-xs` (mono 11px uppercase, tracking .14em) and tabular numerals on the metric tiles.
- Added **PM Desk in Shell** — the same board inside a navigation proposal. `nav-config.ts` ships exactly two shapes (FIELD_NAV, DESK_NAV) and says so deliberately; a PM currently falls through to DESK_NAV and gets the yard admin's surface. The file proposes a third **PROJECT** shape and shows the desk as its Overview entry.

### 2026-08-09T19:39:06Z

- Rebuilt **Tools by Jobsite** against the real domain model: a foreman has one truck, the trailer hitches to that truck, and the rig follows the person rather than the job.
- Added Equipment Yard, "Not assigned to any project", and "On site, nobody holding" blocks with multi-select and assign-to-foreman.
- Matched the real tool table and the rig-gap filters; both substrates driven by the `globals.css` oklch palette.
