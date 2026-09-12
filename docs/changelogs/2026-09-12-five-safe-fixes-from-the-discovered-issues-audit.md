# Five of thirteen audited issues fixed; the other eight need a decision or their own pass

The user asked for a source-verified audit of the codebase (`stinventory-discovered-issues.md`,
built by four parallel Explore agents checking specific claims against specific files, not
generated from a prior planning doc). All thirteen claims held up against the source. Asked to
"fix it all," this session triaged the thirteen by size and risk rather than doing all of them
at once — three needed a product decision this session could not supply (the end state of
`employee.role`, the maintenance workflow's day-one scope, and an unstated "requirement" the
audit referenced but never located), and two more turned out bigger mid-flight than they first
looked. What's below is the five that were genuinely safe to fix without more input.

## What changed

### "Role" becomes "Access Role" everywhere it names the access-role register

`apps/web/app/(app)/people/page.tsx`, `apps/web/components/employee-form.tsx`, and
`apps/web/app/(app)/profile/page.tsx` (found by grepping for the same bare label after the
first two were fixed): the People table's column header, the employee form's picker label, and
the profile page's own read-only field all become "Access Role". The People table version sat
next to "Job Title" saying nothing about which of application access, HR title, or project
responsibility it meant — the distinction the code comments already understood but the label
didn't carry; the profile page version sat directly above a "Permissions" count it's actually
driving, which makes the precision more relevant there, not less.

### A fresh preferences row and a fresh browser now agree on the default font

`packages/api-contracts/src/routers/preferences.ts`: `preferences.get`'s no-row default
was `fontFamily: "system"`; the web client's own `DEFAULT_PREFS` (`apps/web/lib/themes/themes.ts`)
says `"arial"`, a deliberate 2026-09-11 client request. Which one a person with no stored
preference actually saw depended on whether the API request or the client fallback path
answered first. The server default now matches the client's.

### The truck a foreman's rig picks is no longer heap order

`packages/api-contracts/src/routers/location.ts`: `vehicleRouter.list` had no `ORDER BY`.
`rigOf()` (`apps/web/lib/rig.ts`) picks the first matching truck with a bare `.find()`, and the
schema comment on `vehicle_one_truck_per_foreman_uq` already named the consequence: a foreman
legitimately holding both a personal-allowance and a company truck (STI-306's departure
pairing) could have either one win depending on row order, which `rigOf()` has no way to
influence. Added a deterministic `ORDER BY` — company-owned first, then `createdAt` — so the
company truck wins when one exists, matching the unique index's own company-owned-only scope,
and the runner-up order is stable rather than incidental.

### A schema comment moved to the field it actually describes

`packages/db/src/schema/location.ts`: the "mirrors `location.custodianEmployeeId`, kept in
sync" comment sat directly under `payeeEmployeeId` (who is *paid* an allowance) but was
describing `foremanEmployeeId` (who *holds* the vehicle) — confirmed against the matching
comment in `routers/location.ts`, which names `foremanEmployeeId` explicitly. Moved the
comment down to the field it's actually about.

### The Jobsites page's own top comment stopped contradicting its code

`apps/web/app/(app)/jobsites/page.tsx`: the file-level comment said `crew = (project,
custodian) pair derived from asset.list` — true once, before `buildCrews` was extended to add
roster foremen (`projectTeam.all`) holding no tools yet, specifically so a foreman freshly
assigned to a job would show up on it before anyone hands them a tool. The comment now says so,
instead of describing the tool-only version of the screen that a future refactor could easily
believe and regress.

## What the audit pass found afterward

Asked to audit this diff, `/code-review` found two real gaps, both fixed in the same change:

- **A third hardcoded font default.** `apps/web/components/appearance-settings.tsx`
  initialized `fontFamily` to the literal `"system"` rather than `DEFAULT_PREFS.fontFamily` —
  the exact disagreement this diff exists to remove, missed because the fix started from the
  two places that disagreed with each other (`preferences.ts`, `themes.ts`) rather than
  grepping for every place that hardcodes a font default. If a user opened Settings →
  Appearance and hit Save without touching the font control — plausible, since `themeName` and
  `radius` on the same screen already correctly read from `DEFAULT_PREFS` and look identical —
  it would have persisted `"system"` back onto their row. Fixed to read
  `DEFAULT_PREFS.fontFamily` like its neighbors.
- **The `vehicle.list` ordering fix had no test.** Added one to `rig-uniqueness.test.ts`. The
  first attempt at this test passed even with the `ORDER BY` removed, because the fixture
  happened to insert the company truck before the personal one, and Postgres returned small
  fresh inserts in that same incidental order regardless of any explicit ordering — a vacuous
  pin. Rewrote it to insert personal-then-company (reversed from what insertion order would
  coincidentally produce) so the assertion can only pass because of the `ORDER BY`. Verified
  by hand: reverted the `ORDER BY`, ran the suite 4 times (failed all 4, for the right reason —
  it received the personal truck's id where the company truck's was expected), restored the
  fix, ran it 3 more times (passed all 3).

## What was found while building it

`project.ts`'s own comment on `employeeRouter.create` says the `externalId` wire name was kept
deliberately after the `employee.code`/`project.code` schema rename ("because every caller
still says so") — not an oversight. Renaming it now would touch both routers, both client
forms, and possibly the mobile app and the import CSV mapping, none of which this session
checked. `database.md` separately documents this exact class of bug — a stale key name in a
Drizzle insert drops data silently, and has already bitten four writers in two days. That
combination moved the `externalId`→`code` wire rename (audit item #3) out of this pass and into
its own, with a full grep across both clients first.

The reconciliation-screen gap (audit item #13 — `asset.verifyProjection`/`asset.rebuild` and
`department.update` have no operator page) also moved out: it's a new screen, not a fix to an
existing one, and needs its own scope decision about what an operator can actually do from it.

## Verified

- `pnpm typecheck` — clean across all 14 packages, both before and after the audit-pass fixes.
- `make test` against the live dev database (containers were already up) — `custody.test.ts`,
  `custody-concurrency.test.ts` and `rig-uniqueness.test.ts` (38 tests) all pass with the new
  `vehicle.list` ordering in place, confirming the STI-502 one-truck-per-foreman behavior and
  the custody chokepoint are unaffected.
- `rbac-matrix.test.ts` fails with 5 pre-existing failures (`seeded account missing:
  hr@stinventory.local` etc.) — confirmed unrelated to this change: the running dev database
  has zero `@stinventory.local` demo-fixture accounts (only `@test.local` rows from other
  tests), which is exactly the "wrong seed dataset" condition `.claude/rules/database.md`
  documents. Did not reseed to clear the signal — that wipes the database and wasn't this
  session's call to make.
- Did **not** verify the two label changes or the Jobsites comment in a real browser — the
  Playwright MCP wasn't connected in this session. The label changes are plain JSX text with a
  clean typecheck; the Jobsites change is comment-only.

## Deliberately not done

- **`employee.role`/`roleId`/`companyRoleId`/`user_role` consolidation** (audit item #1) — no
  target end state given.
- **A maintenance/service-case workflow** (audit item #8) — no day-one scope given; this is a
  new feature, not a fix.
- **Decoupling project-team moves from tool/rig moves** (audit item #11) — the audit doc
  references "a newly stated requirement" this session couldn't locate anywhere in the repo or
  the conversation.
- **`externalId` → `code` on the wire** (audit item #3) — bigger and riskier than it looked;
  see above.
- **A reconciliation/department-update admin screen** (audit item #13) — new screen, needs its
  own scope.
- **Vestigial `asset_model`/`manufacturer`/`asset.model_id`** (audit item #7) — already
  correctly documented as a deliberate, deferred cleanup in three places (the schema comment,
  `database.md`, and the audit itself); nothing here asked for it to be collapsed now, and doing
  so as a side effect of this pass would be exactly the "in the middle of widening it" pattern
  this repo's own conventions warn against.
- **Jobsites' unbounded list fan-in and the reachability gap being non-urgent** (audit items #9,
  #12) — accepted as-is; see the audit's own severity notes.

## Where it is

Uncommitted in the working tree, on `development`. Not deployed.
