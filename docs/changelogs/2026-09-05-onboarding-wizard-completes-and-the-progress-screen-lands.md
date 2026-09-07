# The onboarding wizard completes, and the progress screen lands

The two earlier entries today built the tier reporting line and the first-run gate with
its opening two steps. This entry finishes the epic: project geography, the map step, the
crew step, the invite step, and `/onboarding/progress` — the last of the eight items in
`docs/workings/ONBOARDING_AND_ROLE_HIERARCHY.md`. All eight are now built.

## What was built

- **Project geography.** Migration `0046`: `latitude`, `longitude`, `geofenceRadiusM` on
  `project`, matching the precision `vehicle.gpsLat`/`gpsLng` already uses. Two new
  procedures, `onboarding.fillDetails` and `onboarding.setLocation` — deliberately not
  `project.update`, which needs `project.manage`. The primary onboarding user (a foreman,
  a superintendent) does not hold that permission, so both are scoped in-body instead: the
  caller must hold a live roster row on the exact job they are editing. `fillDetails`
  fills gaps and never overwrites a value that is already set; `setLocation` overwrites,
  because repinning a wrong location is the normal use of a map, not a conflict.
- **The map step.** `pin-picker-map.tsx`: click to drop a pin, drag it, drag the circle's
  edge to resize the radius, or use the browser's own geolocation. Reuses the OpenStreetMap
  tile source and the `relative z-0 isolate` stacking fix from `fleet-map-view.tsx`.
- **The crew step.** Reads the new `onboarding.crewStatus`, which computes — per claimed
  job — the tiers directly above and below the caller's own, per the ladder, each shown
  filled-and-confirmable, deferred, or open with a person picker depending on what
  `assertCanAssign` would actually allow. Every write goes through `projectTeam.assign`
  and `projectTeam.confirm` under the caller's own permissions.
- **The invite step.** Gathers everyone named in the crew step with no account, filtered
  by `roleNeedsLogin` so labourers are never nagged about. The send action is real for a
  caller holding `user.manage`; everyone else sees the identical list, marked plainly as
  pending an office administrator.
- **The progress screen**, `/onboarding/progress`, gated on `project.team.read` — the
  plan's own lean, taken. A new domain helper, `descendantsOf`, walks crew below the
  viewer only, deliberately distinct from `visibleEmployeeIds`, which also returns the
  chain above and would put a PM's own director on the PM's screen. Two views: by job
  (roster count, confirmed count, geography, open deferrals) and by person (account,
  sign-in, wizard completion).
- Added to both navs — `/settings/team-roles`'s neighbours in the desk's People group, and
  a "My Crew's Setup" row in the field nav, since a superintendent's own crew is exactly
  who this screen is for and superintendents get the field layout.

## The design question the crew and invite steps both had to answer

A foreman holds `project.team.read` and nothing else; a superintendent holds
`project.assign.foreman` alone. Neither can assign a PM or a superintendent, and nobody
but an office administrator holds `user.manage`. Two steps in this wizard ask a person to
do exactly those things, and both answer it the same way, on the user's own instruction
mid-session: *"when a superintendent adds his foreman to project, the reportsTo later does
the onboarding, he can see what super did anyway."*

So neither step invents authority. The crew step's picker calls `projectTeam.assign` under
the caller's real permissions and is refused exactly where the product already refuses it;
what a foreman gets instead is the confirmation action on what their superintendent
already recorded. The invite step's send button is real only for a caller who holds
`user.manage`; everyone else is told plainly, not silently dropped and not faked.

## Found only by driving it in a real browser

Two defects that no amount of reading the source, the type system, or the test suite would
have caught, both because Leaflet's failure modes are specifically about DOM and timing:

**The location step crashed on every single mount**, reproducibly, with `Cannot read
properties of undefined (reading '_leaflet_events')`. The real cause was one layer up:
Leaflet's default marker icon references image paths baked into its own bundled CSS,
which do not survive this app's build, so the marker silently failed to construct
(`iconUrl not set in Icon options`) and Leaflet's own cleanup then crashed trying to
remove an icon that never existed. A static `import` of the marker PNGs hit the identical
failure — worth knowing before reaching for it again. Fixed by copying the three PNGs into
`public/leaflet/` and referencing them by a plain absolute path, which needs no bundler
resolution and therefore has nothing left to resolve incorrectly.

**The radius-resize control corrupted Leaflet's own state on drag.** Its first version
called back into React on every `mousemove`, which fed a new `radius` prop into
`react-leaflet`'s `Circle`, which called `setRadius` on the underlying layer synchronously
— from inside a callback Leaflet itself was still dispatching for that same event. The
reentrant mutation was the actual crash trigger during a drag. `RadiusEditor` now mutates
the Leaflet circle imperatively for the whole drag and commits to React exactly once, on
mouseup — the same category of fix as keeping a `db.transaction` from awaiting anything
network-shaped, applied to a different kind of reentrancy.

A third, smaller one: a Turbopack dev-server cache directory got corrupted mid-session
(`Failed to restore data for task TaskId 2`) after a container restart unrelated to this
code; clearing `.next/dev/cache` and restarting resolved it. Noted in case it recurs — it
is an infrastructure flake, not a defect in anything built here.

## Two test-file lessons worth keeping

**A shared, mutating fixture across `describe` blocks made a real bug look like several
different bugs.** The `progress` tests were first written against `jobA`/`jobB`, reused
from five earlier blocks in the same file. A foreman reassigned to a second job during an
earlier block's test correctly closed his first job's roster row — `moveEmployeeToProject`
working exactly as designed — which then made an unrelated `progress` assertion written
against the old row count fail for a reason that had nothing to do with `progress` itself.
`describe("progress", ...)` now gets its own tenant, its own employees and its own two
jobs, so every assertion is true by construction rather than true by coincidence of
execution order.

**The two guardrail tests, `rbac-matrix` and `reachability`, did exactly their job.**
Adding `onboarding.progress` failed `reachability` until its screen existed; adding
`fillDetails` and `setLocation` failed `rbac-matrix` until their in-body scoping was
recorded with a reason. Both are the tests working, not tests to work around.

## Deliberately not done

Unconfirmed-row styling on the pre-existing roster screens (Tools by Jobsite, the org
chart) outside the wizard itself — nobody asked for it, and confirmation's real home is
the crew step. An invite-request queue that would let a caller without `user.manage`
"send" an invite anyway — considered and rejected; see the design-question section above.
Polygon geofencing, per the plan's original scope decision.

## Verified

`pnpm typecheck`, `pnpm lint`, `pnpm test` run inside the api container — 340
`api-contracts` tests (28 new for geography, crew status and progress; 6 new domain tests
for `descendantsOf`), 63 domain tests, all passing. Both guardrail tests
(`rbac-matrix.test.ts`, `reachability.test.ts`) pass with every new procedure honestly
accounted for, none exempted as unbuilt.

Driven in a real browser against the seeded fixture end to end: a superintendent walks all
five steps without a console error, drops and drags a map pin, sees confirm buttons only
on tiers they could have assigned, and reaches an honest empty invite list. A PM's progress
screen shows real roster counts and progress bars for both their jobs; a foreman with crew
of their own sees them too; the by-person view correctly distinguishes a crew member who
has signed in from nine who have not.

Local only. Not deployed.
