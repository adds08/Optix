---
paths:
  - "apps/web/**"
---

# The web app

Next.js 15 App Router, shadcn/new-york, TanStack Query via tRPC.

## Routes — there is no `/d02`

The README says routes live under `/d02`. They do not, and never do now. Real tree, all under
the `(app)` route group:

`/home` (the project monitor — the wall board, see below) · `/old-dash` (the widget dashboard
`/home` used to be, kept until the monitor has been lived with) ·
`/tools` + `/tools/[id]` · `/custody` · `/jobsites` · `/map` ·
`/reports` + `/reports/[slug]` + `/reports/charts/[slug]` + `/reports/audit-trail` ·
`/activity` · `/inbox` · `/chat` · `/people` + `/people/[id]` · `/projects` · `/job-groups` ·
`/my-tools` · `/profile` · `/settings` + `/settings/ai` + `/settings/appearance` · `/design/*`

The product is **Optix** (Optix Technologies) as of 2026-08-27 — it was STInventory, which
survives as the repo name, the package scope (`@stinventory/*`), the seeded email domain and
the `sti-*` localStorage keys. Nothing user-facing says STInventory any more; the mark is
`components/optix-mark.tsx` (`OptixGlyph` / `OptixLockup`) and it is the ONE definition,
shared by the rail, the auth pages and the boot splash. Don't add a second copy.

**The sign-in panel's subject is the OPERATION, not the toolbox.**
`components/auth-panel.tsx` drew one tool's journey out of a gang box until
2026-08-27 — three stations reading Yard → Truck → Job Site, a strip of five hand tools,
and a ledger of tool transfers only. That was correct for STInventory and precisely wrong
for the front door of a product being sold to run a construction operation. The route now
runs between two JOBS, the strip draws ADR-9's top-level resources (crew, plant, small
tools, materials, hours) and the ledger mixes them. Don't narrow it back. The strip is
deliberately unlabelled and the copy names no screen: Labour, Materials and Purchasing are
accepted architecture, not shipped surfaces, and a captioned tile would advertise a module
that does not exist.

Login is at `/`, not `/login`. Three more routes sit OUTSIDE `(app)`, unauthenticated by
construction, added with the invite/reset work: `/forgot-password`, `/invite/[token]` and
`/reset/[token]` (the last two share `AuthTokenForm`,
`apps/web/components/auth-token-form.tsx`). They call `apps/api`'s auth endpoints directly
via `lib/auth.ts`, the same way the login form does — not tRPC, because there is no session
yet for a `protectedProcedure` to check.

## Data flow

- One `httpBatchLink` at `${NEXT_PUBLIC_API_URL}/trpc`, `superjson` transformer
  (`lib/trpc.ts:16-18`). One `QueryClient`, `staleTime: 10s` (`lib/providers.tsx`).
- The bearer token is read per-request from `localStorage["sti-session"]` and is
  window-guarded, so SSR sends no header (`lib/trpc.ts:19-22`).
- **There is no 401 interceptor.** Auth failure is handled in the shell, and **only an
  `UNAUTHORIZED` counts as auth failure**: `AppShell` reads
  `me.error.data?.code === "UNAUTHORIZED"` and only then clears the session and redirects
  to `/`. Any other failure — unreachable API, 500, timeout — retries, then renders a
  "cannot reach the server" wall with the credential left intact. The two were conflated
  under a bare `me.isError` with `retry: false`, which signed people out because one
  request lost the network and made them retype a password to fix a problem that was
  never about their password. Don't add a second mechanism, and don't widen this one back
  to "any error".
- **The QueryClient is built in the ROOT layout, so it outlives sign-out.** It spans both
  `/` and the `(app)` group, which means a cached *error* survives a failed sign-in. That
  made login a loop: `identity.me` reported `isError` from cache on the next mount, before
  any request went out; the shell's error effect ran `clearSession()` and deleted the token
  the login form had just stored; the batch then dispatched with no `Authorization` header
  and came back 401. **A new session must therefore start by clearing the cache** — both
  places that call `setSession` (`app/page.tsx` and `components/auth-token-form.tsx`) call
  `queryClient.clear()` immediately after. Keep that when adding a third sign-in path; it
  is also what stops one person's cached rows reaching the next person on the same browser.

## Navigation is role-split

> **Before restructuring anything here, read ADR-9, ADR-10 and ADR-11 in
> `docs/06-decisions.md`.** The rule for where a new module goes is now decided and written
> down: groups are named after the **resource** (Small Tools, Equipment, Labour), never after
> a department; a nav row is a **route plus a preset**, so two resources sharing a record
> type share one route; and what an organisation *uses* is a tenant setting while what a
> person *may* use stays a permission.
>
> **Built as of 2026-08-27: stable ids and pinned rows.** Still NOT built, and still
> specified in `docs/workings/RELEASE_2_SPRINT_PLAN.md` E12: the **third level**
> (`children` on a `NavItem`, Operations holding Small Tools / Equipment / Purchasing as
> collapsible sub-categories, STI-1201–1202) and **module visibility**
> (`tenant_settings.disabled_modules`, STI-1204). The shell below is two levels and two
> hard-coded arrays, and that is current. Do not describe the third level here before it
> lands.

`components/sti/nav-config.ts` defines two disjoint sets: `FIELD_NAV` (My Tools, Hand Off,
Alerts) for `foreman`/`superintendent`/`mechanic`, and `DESK_NAV` for everyone else. Items
carry an optional permission, filtered against `me.permissions` in
`components/sti/app-shell.tsx` — ONCE, into the array both the rail and the sidebar draw
from, so a rail glyph and the pane it opens can never disagree about what a group contains.
`app-sidebar.tsx` does no filtering of its own; give it a group it should not show and it
will show it. Add a route → add it here, with its permission.

**A group is a MODULE, not a screen list.** This shell is the frame the rest of the product
gets built into, so a function lives with the other functions and a record with the other
records: Operations holds Custody/jobsites/map, **Registry** holds the entity registers, and
Organization holds people and projects. `Equipment` once named the group holding Custody and
the map while the register sat under `Entity`, which meant a new module had nowhere obvious
to land.

**The Registry group was called `Equipment` until 2026-08-27, and the rename matters.** Its
one row is the SMALL TOOLS register: `asset` holds drills, saws, generators, grinders,
survey gear and compaction plant, and no excavator, loader, backhoe, dozer, skid steer,
forklift or crane. The menu was advertising a resource the product does not have and hiding
the one it does. Equipment is a real and separate entity — **trucks and trailers are
equipment, small tools are not** — and it gets its own Registry row when it is built.

The equipment register already exists as the table named `vehicle`, now carrying
`equipment_class` (`vehicle` | `heavy`) plus `can_attach` / `is_attachable`. Those two are
CAPABILITY (a truck can tow, a trailer can be towed), never current state — what is hitched
to what lives in `assignment.truckId`/`trailerId` and stays ledger-derived. Do not add an
`attached_to_id` column; that is a second way to write custody. The table keeps the wrong
name on purpose: renaming it reaches `assignment`'s composite foreign keys, `transfer`,
every router and the seed, and that is its own change.

**Every `NavItem` carries a stable `id`.** It is never derived from the route, and it is
what a pin stores — see below. Renaming a route must leave every pin where it was, so
`id` is the one field on a `NavItem` you may not change. Labels, hrefs and permissions are
all free to move.

Three rules that are load-bearing:

- **A group carries its own `icon`.** The rail used to borrow `items[0].icon`, so reordering
  a group's rows silently moved the glyph somebody had learned to aim at.
- **`placement: "foot"` pins a group under the assistant** — Settings uses it. Pinning is a
  config field so a future module can choose the foot without a branch in `app-rail.tsx`.
- **Never gate a whole group.** Settings mixes `config.manage` rows with Appearance, which
  writes the caller's own row through `preferences.set` and needs no permission at all.
  Gating the group would put a foreman's font size behind an admin permission — the
  regression the old combined settings page defended against with a `personal` escape hatch.
  Per-row `perm` plus the shell's drop-empty-groups rule reproduces that structurally.

**Match a pathname with `matchItem`, never with `startsWith` over the list.** All three
consumers used to take the first prefix hit in declaration order, which is correct only
while no nav href is a prefix of another. The moment Settings gained sub-pages, `/settings`
claimed `/settings/ai`: wrong row lit, wrong group resolved. `matchItem` returns the longest
match.

Inbox is deliberately absent from `DESK_NAV` — a queue, not a record, reached from the bell,
which carries the same count. It stays in `FIELD_NAV` as "Alerts", where it is the job.

> **This split still branches on the role NAME**, which STI-307 removed everywhere else.
> It was left alone deliberately — deciding which *navigation* a role sees is a layout
> question, not an access control, and every item is separately permission-filtered. But it
> is now the only role-name branch left in the product, and with `engineer`, `mechanic` and
> `office_admin` added by STI-304 it is **already wrong for three roles**: a mechanic gets
> the desk navigation. Fixing it is STI-501's registry (`DESK_NAV`/`FIELD_NAV` chosen by
> permission), not a patch here.

### Pinned rows (STI-1203)

A star on any sidebar row lifts it into a **Pinned** section at the head of the pane.
`components/sti/nav-pins.ts` owns it: a `Set<id>` in `localStorage` under `sti-pins`, plus
one pure function, `pinnedItems(groups, pins)`.

Two rules, and they are the entire feature:

- **Store the `id`, never the href.** A route rename would otherwise strand every pin that
  named it, silently — the row just stops appearing and nobody connects that to a rename
  three weeks earlier.
- **Resolve pins by intersecting with the ALREADY-PERMISSION-FILTERED groups** — the same
  array the shell hands the rail. Never render straight out of storage. Storage is
  editable by the person holding the browser, so a pin that could conjure its own link
  would make the sidebar forgeable; this is the same class as the job-scope rule below.
  `pinnedItems` is the only place the intersection happens, and
  `e2e/tests/nav-pins.spec.ts` holds it in place with an HR account whose seeded pins name
  `/tools` and `/custody` and which must render neither.

Consequences worth knowing: an unknown id renders nothing rather than erroring; a pinned
row that is also in the active group renders in **both** places, which is correct — Pinned
is a shortcut, not a move; and `useNavPins` starts empty and fills in an effect, because
reading storage during render would not match the server HTML. Pinning needs no permission
and is offered to every role.

Per-browser was the explicit ask. `user_preferences.dashboard` is still there as a jsonb
column if pins should ever follow a person between devices.

## The two-pane shell, and the offset that has to be right

`app-rail.tsx` is the 48px primary rail — one glyph per nav GROUP, near-black in both themes
because it is chassis, not page. `app-sidebar.tsx` is the secondary pane and shows **only the
active group's rows**. The rail answers "which part of the product"; the sidebar answers
"which screen".

The shadcn `Sidebar` renders a `position: fixed; left: 0` column, so it has to be pushed right
of the rail. That offset lives in `globals.css` and **must target
`[data-slot="sidebar-container"]`**. `[data-slot="sidebar"]` is the outer `md:block` wrapper
holding the layout gap; it is statically positioned, so `left` on it is silently inert. That
exact mistake shipped on 2026-08-23: the rail rendered on every page and the sidebar painted
over all 48px of it, which read as "the two-pane shell was never built" and got the
active-group-only sidebar reverted as collateral damage. If the rail is invisible, check this
selector before you touch a component.

**The wrapper is `relative` and `overflow-clip`, and both are load-bearing.**
`app-shell.tsx` puts them on `SidebarProvider`. `relative` makes the wrapper the containing
block for the assistant panel's `absolute`; without it the panel resolved against the
viewport and its 400px enter animation put ~200px of horizontal overflow on the document.
`overflow-clip` rather than `overflow-hidden` clips identically but does **not** make the
wrapper a scroll container — `overflow: hidden` is still scrollable programmatically, and
one `scrollIntoView()` inside the assistant was enough to scroll the whole shell sideways
by up to 120px while the `position: fixed` sidebar stayed behind. That was the "everything
jumps left when I open the assistant" report, and it was never the animation. Related:
scroll a specific element by setting its `scrollTop`; `scrollIntoView` asks every ancestor
to move and is almost never what a panel wants.

`fullBleed` on a `NavItem` drops the shell's centred max-width box and its scroll region for
that route. Wall surfaces need it: the content box is auto-height, so a `h-full` board inside
it resolves to nothing and its bottom band lands below the fold.

## Visibility: the ladder, client-side

`useViewTier()` (`components/use-permissions.ts`) resolves the four `assets.view.*`
permissions widest-first, exactly as `scope.ts` does on the server, reading the same
`VIEW_SCOPES` array. Use it — never `role === "superintendent"` — when a picker needs
narrowing. Three forms did that and got it wrong for every role added after them.

It narrows a *picker*, nothing more. The server refuses out-of-scope writes on its own.

## The job-scope selector is not a security boundary

`components/job-scope.tsx` holds three levels — Show All / a group / one project — persisted
to localStorage and exposed as `projectIds: Set<string> | null`. **Pages filter client-side on
this set**, and a client-side filter is never access control.

Since STI-302 the server scopes independently on **every** read path — the register, the
ledger feed, every report, every dashboard tile and chart — through the visibility ladder in
`packages/api-contracts/src/scope.ts`. (This rule used to say "only two read paths", which
was true when it was written and is the reason the dashboard totals leaked.) The selector can
only narrow what the API already returned; it cannot widen it.

## Row actions: one menu, one trigger

**Anything you can do to a row lives behind `ActionMenuTrigger`
(`components/sti/action-menu.tsx`), not in a strip of buttons in the cell.**

A strip does not fit and cannot be made to. The actions column ends up sized for
the widest row's worst case, the trailing control is clipped by the cell, and
widening is not a fix that converges — People went `9rem` → `14rem` and the
delete bin was still unreachable. A trigger is one width no matter how many
actions hang off it.

The trigger is shared because it had already forked four ways: `ToolMenu` and
`RowActions` drew a horizontal `Ellipsis` from hand-written classes, while
`JobsiteCrewCard` and the jobsites page drew `EllipsisVertical` from `Button`,
at two sizes. **Vertical is the house glyph** — `MoreHorizontal` already means
"there are hidden items here" in `ui/breadcrumb.tsx`, so the horizontal one is
spoken for.

Two components consume it, and which you want depends on the row:

- `RowActions` (`components/sti/row-actions.tsx`) — register rows. Takes
  `actions: RowAction[]`, **not** JSX. It used to take a `ReactNode` and each
  page passed its own styled `<Button>` wrapped in its own `<Can>`, which is
  precisely why the strip could not be moved into a menu without editing every
  caller. Pass `{ label, icon, onSelect, perm? }` and let the component render
  and gate it.
- `ToolMenu` (`components/tool-menu.tsx`) — tools specifically, because which
  actions apply depends on where the tool is.

Both arm destructive items in place: the first select calls `preventDefault()`
and swaps the row for "Really delete X?", and `onOpenChange` disarms on close so
a menu can never reopen already armed. Keep that if you add a destructive item.

**Not everything is a row action.** Custody's Approve/Decline stays as two
buttons — it is an approval queue, and its primary action should not cost a
click to reach. Panel headers (`admin/roles`, `job-groups`) keep their buttons
too; a primary Save behind an ellipsis is a regression, not consistency.

## Nothing moves when you tick a checkbox

**Space for a control that comes and goes is RESERVED, never created on arrival.**
Both selectable surfaces broke this and both were measured before and after, because a
layout jump is the class of bug that gets made smaller and called fixed:

- `/jobsites` — the "Waiting in the yard" header was sized by a text line when empty and
  by an `h-6` button when something was ticked. **33px to 41px on the first click.**
- `/tools` — the bulk action bar was its own block that did not exist until the first
  tick, so the table dropped **58px** under it.

Two fixes, one principle, and which one applies depends on where the control lives:

- **A control inside a row that is always there** — reserve on the SLOT, not on the row.
  `<span className="ml-auto flex h-6 …">` sizes the tallest child whether or not anything
  is in it. Reserving on the row instead (`min-h-10`) was tried and left exactly 1px:
  `border-box` counts a `border-b` inside a `min-h-*`, while the button state adds it on
  top. Sizing the slot has no such arithmetic.
- **A control that is a whole new block** — do not insert it. Swap it into a row that
  already exists. `/tools` puts the bulk actions where Import/Export/New live, keyed on
  one `selecting` flag that both halves of the row read, so the two can never disagree.
  This costs no vertical space and puts the actions where the eye already is.

`e2e/tests/no-layout-shift.spec.ts` asserts **equality**, not a tolerance — one pixel of
movement is the same bug as fifty. It was checked against the un-fixed code first and
fails there with `Expected: 33, Received: 41`.

What is still allowed to change height: a genuine error message (`bulkError`). It appears
on a failed write rather than on every tick, so reserving a permanent blank row for a
message that usually never comes would trade a real jump for permanent dead space.

## DataTable

`components/sti/data-table/data-table.tsx` is dual-mode. Default is client-side
sorting/filtering/pagination; passing `server` flips on `manualPagination`/`manualSorting`/
`manualFiltering` and the parent owns `{page, pageSize, sortKey, sortDir, search}`. Row
selection operates over **all filtered rows**, not just the visible page — keep that, it is
the right behaviour for "select everything this foreman holds".

**CSV export does not, and that is a defect, not a design.** `exportCsv` reads
`table.getRowModel()`, which in client mode is the model *after* pagination, so the tools
register hands back 25 rows out of 754. It also writes column **ids** rather than header
labels and emits an empty column for any cell rendered without an `accessorFn`.
`getPrePaginationRowModel()` is the fix. `report-table.tsx` gets all three right, which is
the reference. `xlsx` is a dependency but is used only by `import-dialog.tsx`; there is no
Excel or PDF export path anywhere.

## Theming

**A theme is a colour palette and nothing else.** The design language — 3/4/6px radii, the
Inter Tight + JetBrains Mono pairing, the two-pane shell, `label-xs`, the primitives, the
reserved status hues — is global by construction and no palette can reach it. If a change
would let a theme alter structure, it belongs in `globals.css` instead.

Base tokens are in `app/globals.css` (`:root` / `.dark`) — that pair *is* the Blocky palette,
which is why `blocky` carries **empty overrides** in `themes.ts` and is labelled "Default".
Selecting it clears every override rather than adding a layer. It was the other way round
until 2026-08-23 (base = Drafting Ink, blocky = an override layer switched on by the default
preference), which meant the product's own look was a theme you could accidentally leave and
any token a palette forgot fell through to a different design. `drafting-ink` is now an
ordinary palette carrying the old values.

Palettes are enumerated in `lib/themes/themes.ts` and applied as **inline CSS custom
properties on `<html>`** (not class swaps) by `lib/themes/apply-theme.ts`, with a boot script in
`app/layout.tsx` replaying the cached choice to avoid a flash.

**The shell must not repaint until it can improve on that boot script.** `app-shell.tsx`
gates its `applyTheme` effect on `appearanceSettled` — the light/dark preference has been
read AND the preferences row has reached the store. It used to run unconditionally on
mount, with `dark` still at its initial `false` and no prefs yet, so
`applyTheme(DEFAULT_PREFS, false)` stripped every variable the boot script had just set and
dropped the `dark` class. **The flash on reload was not a theme arriving late; it was the
right theme being actively wiped and restored a few hundred ms later.** `AppSplash`
(`components/sti/app-splash.tsx`, `data-slot="app-splash"`) covers the remaining wait and
paints from `--background`, so it is already in the user's palette on the first frame. A
failed `preferences.get` still settles — to `DEFAULT_PREFS` — or the splash would never
lift.

`apply-theme` clears the **union** of all theme keys before setting the active ones; keep that
or switching themes will leak variables from the previous one. The same rule and the same
reasoning apply to `ALL_FONT_KEYS`.

The font family is applied by overriding `--font-sans` at `:root`, NOT by setting
`style.fontFamily`. next/font declares that variable inside the class it generates, so that
class lives on `<html>` — move it to `<body>` and every font choice in Settings silently
renders the default again. Never name the house fonts literally: next/font's family name is a
build hash, and `'Inter Tight'` resolves to `system-ui`.

> There is no `packages/design-system` — it was deleted after going unimported. Theming lives
> here, in `apps/web/lib/themes` + `globals.css`. Don't recreate a shared token package
> without a second consumer to justify it.

## Motion

`motion` (Framer Motion) is a dependency of `apps/web` as of 2026-08-27. The curves and
durations live in **`lib/motion.ts`** — `EASE`, `DUR`, `PANEL_SPRING` — so a transition is
a decision made once rather than a bezier typed into whichever component needed it. Import
from there; do not inline a new cubic-bezier without adding it.

The brief is the palette comment's: *this is a yard tool, not a consumer app.* Nothing
overshoots and nothing bounces — `PANEL_SPRING` is damped hard on purpose, because the
assistant panel butts against the shell's edge and a bounce there reads as a miss.
`DUR.route` sits in front of **every** navigation in the product and is the one value
capable of making the whole thing feel slow; leave it short.

Wall surfaces (`fullBleed`) are deliberately NOT transitioned: the monitor is a board left
running on a screen across the room, and it needs its `h-full` chain unbroken by a wrapper.

The pre-existing CSS keyframes in `globals.css` (`sti-ink`, `sti-travel`, `sti-slide`, the
auth panel's whole line-art system) stay as they are. They are declarative, gated on
`prefers-reduced-motion`, and rewriting them in JS would buy nothing.

## House style

The palette comment states the intent: *"Neutrals carry a slight cool bias toward the accent so
they read as chosen, not inherited. Radius is tight (6px) — this is a yard tool, not a consumer
app."* Match that. Depth comes from borders, not shadows.

Before touching `tools/page.tsx`, `facets.tsx`, `flags.tsx` or `asset-card.tsx`, read
`HANDOFF.md` — it covers the Tool Register redesign and what is still unverified.
