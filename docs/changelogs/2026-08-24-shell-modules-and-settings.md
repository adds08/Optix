# The rail describes modules, and Settings stops being an entity

The shell is the frame the rest of the product gets built into — scheduling,
documents, procurement — so its groups have to answer "which part of the
business is this", not "which screen".

## What changed

### Groups are modules

`Equipment` used to name the group holding Custody and the map, which are things
you **do**, while the register — the thing you **keep** — sat three groups away
under `Entity`. A new module had nowhere obvious to land. The desk nav is now
Overview · Operations · Equipment · Organization · Insight, with the functions
in Operations and the records in Equipment and Organization.

### Configuration is not a module

Settings is pinned to the rail's foot beneath the assistant, and User Accounts,
Roles & Permissions, Appearance and AI & API are rows inside it rather than
top-level entries. `/settings` split into three routes over a shared
`components/settings/tenant-settings.tsx`.

Inbox left the desk nav entirely — it is a queue, not a record, and the bell in
the top bar already carries its count.

### `NavGroup` gained `icon` and `placement`

The rail borrowed `items[0].icon`, so reordering a group's rows silently moved
the glyph somebody had learned to aim at. `placement: "foot"` makes pinning a
group a config field rather than a branch in the rail — which is what lets a
future module choose the foot without touching `app-rail.tsx`.

## What was found while building it

**Every nav consumer had a latent prefix bug.** All three matched a pathname
with `pathname === href || pathname.startsWith(href + "/")` against the list in
declaration order and took the first hit. That is correct only while no nav
href is a prefix of another — true until Settings gained sub-pages. On
`/settings/ai`, `/settings` matched first: wrong row lit, wrong group resolved.
`matchItem` in `nav-config.ts` returns the longest match and all three use it.

**The Settings group must not be gated as a whole.** Appearance saves through
`preferences.set`, which writes the caller's own row and needs no permission.
Gating the group would put a foreman's font size behind `config.manage` — the
regression the old combined page defended against with its `personal` escape
hatch. Per-row `perm` plus the shell's existing drop-empty-groups rule gets the
same outcome structurally, so the hatch is gone.

**Splitting the page nearly duplicated a fixed bug.** The hydrate-once ref
exists because react-query refetches on window focus, and every refetch re-ran
the effect and stamped saved values over half-typed input — which is what
happens when you switch to a terminal to copy an API key. `useHydrateOnce` in
`tenant-settings.tsx` is the one copy, with the reason attached.

## Verified

`pnpm typecheck` (13 tasks) and `pnpm test` pass; web lint is error-free.
`/settings`, `/settings/ai`, `/settings/appearance` and `/tools` serve 200
against the running dev container with a clean `docker logs stinventory-web`.

**The rendered rail has not been looked at in a browser.** Compilation is not
layout. Note also that `pnpm test` skipped 178 of 245 tests for want of a
database, so it proves less than its exit code suggests.

## Deliberately not done

`/inbox` stays in the FIELD nav as "Alerts". A foreman's whole job on that
layout is the alerts list, and a bell on a phone is a worse place to bury it
than a nav row.

The spreadsheet-style table work — per-column header menus, pinning, manual
resizing, pagination above the header, and the CSV export that currently writes
only the visible page — is specified and approved in shape but unstarted.

## Where it is

`04d84fb` on `feature/crew-derivation-team-ui`, pushed. Not deployed. The branch
had been tracking `origin/main`; its upstream now points at its own remote
branch.
