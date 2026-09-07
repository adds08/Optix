# A foreman and his trailer, on one page

`/people/[id]` answered "what tools does this person hold" and never asked the
same question about trucks and trailers — even though `/equipment` already
named the person as custodian for 72 vehicles in Urban's real register. The page
simply never queried `vehicle`.

## What changed

The stray "Tag" header on the tools table (found while checking this page) is
fixed — Code leads, matching every other register, renders `—` for a tool
nobody has labelled. That was the last one; `grep -rn 'header: "Tag"'` across
`apps/web` now returns nothing.

A new **Equipment** tab sits beside **Tools** under "In their custody", each
carrying its own count badge — the same tab pattern `/custody` already uses for
Held / Moving / Approval queue, so this isn't a new interaction to learn.
Columns: Code, Unit, Description, On project, Status. The stat panel above
gained a fifth field, **Equipment held**.

The default tab picks itself once both queries have answered: a foreman with
tools but no truck opens on Tools, someone hauling a trailer but holding no
tools opens on Equipment. Neither queue holding anything shows the tools tab's
empty state, since that's the more common shape.

## Why this needed its own query, not a bigger `asset.list`

Tools and equipment are genuinely different tables with different custody
fields — `asset.currentCustodianId` versus `vehicle.foremanEmployeeId`, which
mirrors `location.custodianEmployeeId` on the vehicle's own location row (see
that column's comment). `vehicle.list` has no per-custodian filter server-side;
it scopes by project visibility, so the page pulls the visible fleet and
narrows it client-side — the same pattern the tools register itself uses for
its own filters (`.claude/rules/web.md`, "Filtering is client-side, and that is
not laziness").

## Verified

- `pnpm typecheck` clean.
- 568 tests, run inside the api container against the demo fixture.
- Driven live against a real custodian (Zelvin Perez — 21 tools, 2 vehicles):
  tab badges read `Tools 21` / `Equipment 2`; switching tabs swaps to
  `CODE | UNIT | DESCRIPTION | ON PROJECT | STATUS` and shows `TRK-042` (an
  F-250) and `TE-016` (an enclosed trailer), both `NO SIGNAL` from real GPS
  data. No console errors.
