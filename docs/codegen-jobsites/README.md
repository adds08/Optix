# Tools by Jobsite — crew-shaped rebuild

Frontend-only. Every procedure this needs already exists.

## The model it makes visible

```
foreman ── has ──▶ 1 truck ── hitched ──▶ 1 trailer ── holds ──▶ small tools
   │
   └── works on ──▶ job(s)          a crew = (job × foreman)
```

The rig belongs to the **foreman**, not the job — the truck goes where they go,
the trailer follows the truck, the tools ride in the trailer. So a job with
three foremen is **one job card with three crew rows**, not three names crammed
into one header. That is the "same job repeating per foreman", made legible.

The backend already says exactly this and needs no change:

| Fact | Where it lives |
|---|---|
| who holds a truck/trailer | `location.custodianEmployeeId` (mirrored on `vehicle.foremanEmployeeId`) |
| trailer hitched to a truck | `location.parentLocationId` → the truck's location (`vehicle.list` exposes `attachedToVehicleId` / `attachedToUnit`) |
| tools aboard | `asset.currentLocationId` = the trailer's location |
| hand a rig over | `location.setCustodian` — takes the hitched trailer **and every tool aboard** with it (`applyContainerCustody` in `routers/location.ts`) |
| hitch / unhitch | `vehicle.update { attachedToVehicleId }` — attaching to a truck that has a foreman moves custody on the spot |
| rig follows a job change | `vehicle.update { projectId }`; `routers/project.ts` already does the "foreman's trucks and their trailers go to the new job" walk on reassignment |

## Files in this zip

| Action | Path |
|---|---|
| replace | `apps/web/app/(app)/jobsites/page.tsx` |
| add | `apps/web/components/jobsite-crew-card.tsx` |
| add | `apps/web/components/rig-picker.tsx` |

`components/jobsite-activity.tsx` is unchanged — the page just wraps it with a
hide/show toggle.

## What changed on the screen

- **Crew rows.** Each reads `[hard hat] Dwayne Ellis → UIC-T12 → UIC-TR04 · 4 aboard | 2 tools $1,470`, expandable to that crew's tools.
- **Inline + menu affordances.** Empty rig slots are dashed "Truck" / "Trailer" buttons; the pencil on a chip changes it; the crew ⋮ has change truck / hitch trailer / move crew / show tools; the job ⋮ and header "Add crew" open the foreman picker.
- **Constraints in the UI, not just the API.** No trailer button until there is a truck ("Trailer needs a truck"); picker rows say "With Sofia — assigning moves it" before you move anything.
- **One filter bar** — search across job, foreman, truck, trailer, serial and tool name, plus Job / Foreman / Status selects and a "Needs a rig" toggle, a result count and Clear filters. Cards that filter to nothing drop out.
- **Tool table** is Serial / ID · Tool name · Status · Value. No "rides on" column — the row already sits under its rig.
- **Activity rail** is hideable (eye-off), with a "Show activity" button in the filter bar.

Tailwind v4 numeric utilities used: `h-6.5`, `size-4.5`. Swap for `h-[26px]` / `size-[18px]` if your build rejects them.

## Prompt for your local coding agent

> In the STInventory monorepo (`apps/web`, Next.js 15 App Router, Tailwind v4, shadcn/ui, tRPC), rebuild the **Tools by Jobsite** page around crews. Frontend only — do not touch the API, DB or schema. The relevant procedures already exist: `asset.list`, `project.list`, `employee.list`, `vehicle.list`, `location.setCustodian`, `vehicle.update`.
>
> Model to make visible: a **foreman has exactly one truck**, that truck has **at most one trailer hitched to it** (`vehicle.attachedToVehicleId`, backed by `location.parentLocationId`), and the small tools ride in the trailer/truck. The rig belongs to the foreman, not the job. A **crew** is one foreman on one job, derived as a `(currentProjectId, currentCustodianId)` grouping of `asset.list`. A job worked by three foremen renders as one job card containing three crew rows.
>
> 1. Rewrite `app/(app)/jobsites/page.tsx`:
>    - Keep the four `Metric` tiles but change them to: Crews on jobs, Tools out, Fleet value out, Crews without a truck (warn tone when non-zero).
>    - One filter bar in a bordered card: a search input that matches job name/code, foreman name, truck unit, trailer unit, serial/tag and tool name; `<select>` filters for Job, Foreman and Status; a "Needs a rig" toggle; below them a result line ("N tools · N crews · N cards") and a "Clear filters" button. Tint an active select. Hide cards that filter down to nothing, and show an `EmptyState` when everything is filtered out.
>    - One card per project (respecting `useJobScope()`), plus an "Equipment Yard" card for tools with no `currentProjectId` (no crews, no rig actions — it is not a job). Card header: pin, name, `externalId` chip, crew count, an amber `TriangleAlert` badge for "no crew" / "N crews without a truck", tool count + value, "Add crew", a ⋮ menu and an expand chevron.
>    - Inside an expanded card: the crew rows, then a "On site, nobody holding" (or "Waiting in the yard") table for unheld tools.
> 2. Add `components/jobsite-crew-card.tsx` rendering the chain `foreman → truck → trailer · N aboard` with per-chip pencil buttons, dashed "Truck"/"Trailer" add buttons when empty, a disabled "Trailer needs a truck" note when there is no truck, tool count + value, a ⋮ menu (change truck / hitch trailer / move crew to another job / show tools) and an expandable tool table.
> 3. Add `components/rig-picker.tsx`: one searchable `Dialog` handling four requests — add crew, truck, trailer, move crew. Wire them to `location.setCustodian { locationId, custodianEmployeeId, moveContents: true }` for handing a truck over, `vehicle.update { attachedToVehicleId }` for hitching, and `vehicle.update { projectId }` for putting a rig on a job. Every row must state the current holder ("With Sofia Ramirez — assigning moves it", "Hitched to UIC-T08 — assigning re-hitches it", "In the yard, free"). Invalidate `vehicle.list` and `asset.list` after a mutation.
> 4. Tool tables show **Serial / ID · Tool name · Status · Value** using `StatusPill` and `money()`. No "rides on" column. For unheld tools show `locationName` as a second line under the name.
> 5. Wrap the existing `<JobsiteActivity />` so it can be hidden (eye-off button) and restored from a "Show activity" button in the filter bar.
>
> Follow repo conventions: `"use client"`, `cn()`, lucide icons, semantic tokens only (no raw hex), a short comment block at the top of each file explaining why the shape is what it is. Run `pnpm typecheck` and `pnpm lint`.
