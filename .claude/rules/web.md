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
- **There is no 401 interceptor.** Auth failure is handled in the shell: if `identity.me`
  errors, `AppShell` clears the session and redirects to `/`
  (`components/sti/app-shell.tsx:96-101`). Don't add a second mechanism.

## Navigation is role-split

`components/sti/nav-config.ts` defines two disjoint sets: `FIELD_NAV` (My Tools, Hand Off,
Alerts) for `foreman`/`superintendent`/`mechanic`, and `DESK_NAV` for everyone else. Items
carry an optional permission, filtered against `me.permissions` in
`components/sti/app-shell.tsx` — ONCE, into the array both the rail and the sidebar draw
from, so a rail glyph and the pane it opens can never disagree about what a group contains.
`app-sidebar.tsx` does no filtering of its own; give it a group it should not show and it
will show it. Add a route → add it here, with its permission.

**A group is a MODULE, not a screen list.** This shell is the frame the rest of the product
gets built into, so a function lives with the other functions and a record with the other
records: Operations holds Custody/jobsites/map, Equipment holds the register, Organization
holds people and projects. `Equipment` once named the group holding Custody and the map
while the register sat under `Entity`, which meant a new module had nowhere obvious to land.

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

## House style

The palette comment states the intent: *"Neutrals carry a slight cool bias toward the accent so
they read as chosen, not inherited. Radius is tight (6px) — this is a yard tool, not a consumer
app."* Match that. Depth comes from borders, not shadows.

Before touching `tools/page.tsx`, `facets.tsx`, `flags.tsx` or `asset-card.tsx`, read
`HANDOFF.md` — it covers the Tool Register redesign and what is still unverified.
