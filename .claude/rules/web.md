---
paths:
  - "apps/web/**"
---

# The web app

Next.js 15 App Router, shadcn/new-york, TanStack Query via tRPC.

## Routes — there is no `/d02`

The README says routes live under `/d02`. They do not, and never do now. Real tree, all under
the `(app)` route group:

`/home` (dashboard) · `/tools` + `/tools/[id]` · `/custody` · `/jobsites` · `/map` ·
`/reports` + `/reports/[slug]` + `/reports/charts/[slug]` + `/reports/audit-trail` ·
`/activity` · `/inbox` · `/chat` · `/people` + `/people/[id]` · `/projects` · `/job-groups` ·
`/my-tools` · `/profile` · `/settings` · `/design/*`

Login is at `/`, not `/login`.

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
Alerts) for `foreman`/`superintendent`, and `DESK_NAV` for everyone else. Items carry an
optional permission, filtered against `me.permissions` in `components/app-sidebar.tsx`.
Add a route → add it here, with its permission.

> **This split still branches on the role NAME**, which STI-307 removed everywhere else.
> It was left alone deliberately — deciding which *navigation* a role sees is a layout
> question, not an access control, and every item is separately permission-filtered. But it
> is now the only role-name branch left in the product, and with `engineer`, `mechanic` and
> `office_admin` added by STI-304 it is **already wrong for three roles**: a mechanic gets
> the desk navigation. Fixing it is STI-501's registry (`DESK_NAV`/`FIELD_NAV` chosen by
> permission), not a patch here.

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
selection and CSV export operate over **all filtered rows**, not just the visible page — keep
that, it is the right behaviour for "select everything this foreman holds".

## Theming

Named themes are enumerated in `lib/themes/themes.ts`, applied as **inline CSS custom
properties on `<html>`** (not class swaps) by `lib/themes/apply-theme.ts`, with a boot script in
`app/layout.tsx` replaying the cached choice to avoid a flash. Base tokens are in
`app/globals.css` (`:root` / `.dark`) — that pair *is* the default `drafting-ink` theme.

`apply-theme` clears the **union** of all theme keys before setting the active ones; keep that
or switching themes will leak variables from the previous one.

> There is no `packages/design-system` — it was deleted after going unimported. Theming lives
> here, in `apps/web/lib/themes` + `globals.css`. Don't recreate a shared token package
> without a second consumer to justify it.

## House style

The palette comment states the intent: *"Neutrals carry a slight cool bias toward the accent so
they read as chosen, not inherited. Radius is tight (6px) — this is a yard tool, not a consumer
app."* Match that. Depth comes from borders, not shadows.

Before touching `tools/page.tsx`, `facets.tsx`, `flags.tsx` or `asset-card.tsx`, read
`HANDOFF.md` — it covers the Tool Register redesign and what is still unverified.
