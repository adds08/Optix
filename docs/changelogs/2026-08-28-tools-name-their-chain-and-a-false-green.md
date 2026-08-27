# A tool says who is accountable for it, and the dead-code check stops lying

Two asks: make teams work with a small tool able to backtrack to its PM and
superintendent, and remove dead code.

The first turned out to be smaller than expected — teams already work — and the
second turned out to be more interesting, because the repo's own dead-code test
was being propped up by the very file it should have been flagging.

## What changed

### A tool backtracks to the people accountable for it

Teams were already built: the `projectTeam` router (`all` / `assign` / `remove`)
is wired into `/jobsites` through the team strip and the rig picker, and
`project_team_member` carries PM, superintendent and foreman rows per job with an
active-row unique index. Nothing needed rebuilding.

The gap was the join. Custody answers "who is holding this" and stopped there; on
a job the next two questions are "who is their superintendent" and "who is the
PM", and a tool could answer neither. `asset.get` now returns the current
project's active team alongside the tool, and the detail screen shows
Superintendent and Project manager beside Held by.

**Derived, never stored.** A tool follows its custodian, the custodian's project
follows them, and the team follows the project — so moving a superintendent off a
job changes what every tool on that job reports, with nothing to re-sync and no
projection to rebuild. There is no new column.

**A second query rather than two more joins**, and that is the whole reason it is
not inline in the existing select. A project can carry several superintendents —
`ptm_one_active_uq` is unique on (tenant, project, employee, role), which permits
exactly that — so joining would multiply the asset row and `[row]` would then pick
an arbitrary one. A silently arbitrary superintendent is worse than none, because
nobody re-checks a field that is usually right. The UI renders a comma-joined list
for the same reason.

### The reachability test was green because of a dead file

`packages/api-contracts/src/reachability.test.ts` walks `appRouter`, greps both
clients, and fails on any procedure no screen can reach. Its own header warns that
the grep counts `utils.x.y.invalidate()` as a caller.

`departure-form.tsx` was left parked and unreferenced on 2026-08-27 — deliberately,
to keep the departure engine while removing the offboarding gate. It was also the
**only** thing referencing `departure.preview`, `departure.reassign` and
`dashboard.clearanceQueue`. All three were therefore counted as reachable by a file
that no screen renders: a false green, of precisely the kind the test's own note
warns about.

Deleting the form is what makes the check honest, so it went. The three procedures
are now `TODO:` entries in `NO_UI_BY_DESIGN` with the reason written out, and the
TODO ceiling moved from 18 to 21 with an explanation on the line — that ceiling is
asserted specifically so it cannot drift upward silently.

**The engine is still kept, as asked.** `departure.ts` moves a leaver's tools, their
company truck and trailer and everything riding in them to a named successor in one
transaction, and its ~600 lines of tests still run. What went was the unreferenced
UI, not the capability.

### `webEnv()` deleted

Exported from `packages/env` and imported by nothing, ever. It could not have worked
where it claimed to: `NEXT_PUBLIC_*` is inlined by Next at build time, so a Zod parse
in a shared package never runs in a browser. Its last remaining field went with the
Optix rename the day before. A tombstone in the barrel says so.

## What was found while building it

**Teams did not need building — the backtrack did.** Worth recording because the
request read as "teams are broken". The roster, the assign/remove procedures, the
permission ladder for who may assign whom, and the UI all existed. What was missing
was one join from a tool to the job's team, which is a much smaller thing than a
teams feature and would have been easy to over-build.

**A dead file can hide live dead code.** This is the transferable lesson. Parking
`departure-form.tsx` looked conservative — nothing deleted, nothing on screen — and
it silently disabled the reachability check for three procedures. Any "keep it around
for later" file that still calls things has this property. The repo already knew the
grep was weak; what it had not seen was that a parked file turns the weakness into a
blind spot rather than a rounding error.

**Two blanket dead-code sweeps produced garbage before a useful one worked.** A regex
over procedure-shaped lines matched every object literal key in `settings.ts`; an
import-path heuristic flagged `ui/button.tsx` as an orphan. What actually worked was
reading the test the repo already had. Noted because the instinct to write a scanner
was wrong twice and the instinct to look for existing machinery was right once.

## Verified

- The accountability chain resolves in SQL (Lone Star → Dana Whitmore as PM, Marcus
  Whitfield as superintendent) and on the rendered screen.
- `e2e/tests/tool-accountability.spec.ts` walks the register to a real tool rather
  than deep-linking a uuid, and asserts both fields resolve to a name rather than the
  em dash. **Checked against a deliberately broken version first**: with the team
  query filtered to a role that matches nothing, it fails with `Received: "—"`. A
  regression test that also passes against the bug proves nothing.
- `make test` in the api container: every package passing, nothing skipped, including
  `reachability.test.ts` with the new entries and the raised ceiling.
- The full browser suite, now 28, green across five roles.
- `pnpm typecheck` across the workspace and `pnpm lint` clean.

## Deliberately not done

**No blanket purge of unreached procedures.** The scan surfaced roughly twenty, and
almost all are already triaged in `NO_UI_BY_DESIGN` with reasons and ticket references
from a sweep in August. Deleting them would be re-litigating decisions somebody already
made and wrote down.

**Cost codes and phases were not modelled** — explicitly deferred.

**No named-crew entity.** `project_team_member` plus `employee.reportsToEmployeeId`
already carry the crew, and the backtrack now reads them. A separate teams table would
be a second place for the same fact.

**The register list still does not show the chain**, only the detail page. Adding it to
the table means the same lookup for every visible row; worth doing off one query if it
is wanted, not by repeating this one.

## Where it is

Committed on `development`. Not deployed. No migration — this change adds no columns.
