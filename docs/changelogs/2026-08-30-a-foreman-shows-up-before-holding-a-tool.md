# A foreman shows up before holding a tool, and a picker says which one

Phases 2 and 3 of the roles/project-assignment/equipment plan
(`/Users/adds08/.claude-personal/plans/imperative-beaming-puzzle.md`). Both
found the same shape of bug in different places: a screen was reading a
narrower signal than the question it was actually answering.

## What changed

### A foreman on the roster, with nothing in their hands, now has a card

`buildCrews` in `apps/web/app/(app)/jobsites/page.tsx` derived every crew
entirely from tool custody — grouping the project's tools by
`assignment.custodianId`. A foreman freshly put on a project's roster
(`project_team_member`) who hadn't yet been handed a single tool never
produced a group, so they never got a card. "On the project" and "shows up
on Tools by Jobsite" silently disagreed, which is exactly what hid a
newly-invited foreman during a client demo.

Fixed with a second pass after the tool-custody grouping: any roster row
with `role === "foreman"` whose `employeeId` isn't already in the
tool-derived map gets an empty-state `Crew` — `rigOf`'s usual empty rig,
`tools: []`. Same card, same layout, genuinely empty rather than absent.
PM/superintendent visibility needed no change — `JobsiteTeamStrip` already
reads the roster (`team.data`) directly, independent of custody.

`team.data` (`trpc.projectTeam.all`) is now a dependency of the `cards`
`useMemo`, since `buildCrews` reads it.

### Two forms still asked "which one" with only a name to answer

`transfer-form.tsx` ("To custodian" / "To project" / "To location", opened
from `ToolMenu`'s "Hand over to someone") and `bulk-move-form.tsx` (the same
three fields, bulk path) were still plain native `<select>` elements
rendering nothing but each entity's name — exactly what the client's
screenshots showed. The canonical `EntityPicker`/`EntityField`
(`apps/web/components/ui/entity-picker.tsx`, built 2026-08-28 specifically to
retire four drifted picker patterns) already has a searchable `hint` field
built for precisely this; these two forms predated that migration or were
missed by it.

Both migrated to `EntityField`, with `hint` set per entity:
- **Employee** → `externalId` (the employee code, e.g. `FM-001`).
- **Project** → `externalId` (the project code).
- **Location** → no code column exists on `location` today, so the hint is
  what actually distinguishes one from another: humanized `type`, plus its
  project or warehouse name, plus (bulk-move only) the current custodian's
  name if the location is held — reusing `humanize()` rather than a new
  formatter.

## What was found while building it

Location genuinely has no code today — this isn't an oversight to backfill,
just a fact to note: "Dallas Yard" and "Gang Box A" are distinguished by kind
and context, not an identifier, because none exists in the schema.

## Verified

- `pnpm typecheck` clean after both phases.
- Jobsites: a foreman with zero tools now renders as an ordinary crew card
  ("GABRIEL VILLAREAL · FM-015 · FOREMAN · 0 tools · $0") — confirmed via a
  Playwright screenshot, not just by reading the code.
- Transfer form: opening "Hand over to someone" on a tool now shows a
  searchable list with each person's employee code under their name
  (Alejandro Capuchino / FM-001, etc.), confirmed via screenshot.

## Deliberately not done

`assign-form.tsx`, `resolve-message.tsx` and `jobsite-team-strip.tsx`
already use `EntityPicker`/`EntityField` — confirmed, not touched.
`bulk-edit-form.tsx` and `jobsite-activity.tsx` still use the older
`ui/search-select.tsx` `SearchSelect` and were **not** migrated this
session — time-boxed to the two forms the client's own screenshots named. A
follow-up pass should retire `SearchSelect` for good.

## Where it is

Branch `development`, part of a larger multi-phase push landing as normal
commits this session — not yet on `main`; the user will PR and merge
themselves.
