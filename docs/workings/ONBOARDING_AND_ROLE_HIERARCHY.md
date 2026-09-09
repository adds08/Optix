# Onboarding and the role reporting line

Status: **all eight items built 2026-09-05.** On `development`: the tier ladder
(migration `0044`), onboarding state and the deferral record (`0045`), roster
confirmation, project geography (`0046`), the first-run gate, the full five-step wizard,
and the progress screen at `/onboarding/progress`. Verified end to end in a real browser
against the seeded fixture — see the two 2026-09-05 changelog entries for what was found
along the way, including a design correction to step one and a real Leaflet crash that
took real debugging to find.

Two follow-ups since, both on `development`. **Skipping is recoverable** (2026-09-05):
`dismissedAt` distinguishes a skip from a finish, `onboarding.resume` reopens the wizard
at the step the person stopped on, and `SetupNotice` in the sidebar footer is the way back
in. Found while building it: `/home` redirected field roles to `/my-tools` before
`onboarding.state` resolved, so the gate never fired for a foreman, superintendent or
mechanic on a client-side sign-in — a hard reload worked, which is what hid it. **The
visual rework** (2026-09-06) collapsed the repeated header after step one, centred the
step content, dropped a duplicate progress indicator, gave the photo panel per-step copy,
and carried the same treatment to the progress screen. No router or permission changed in
either.

**Claims were withdrawn on 2026-09-06** and §5 step one is rewritten accordingly. Step one
listed every active job with a tick that wrote a `project_claim`; the tick granted nothing
and could not become a roster row, so the later steps ignored every claimed job. Step one
is now a read-only list of the jobs the caller is actually on, `project_claim` and
`setClaim` are deleted (migration `0049`), and `myClaimedProjects` reads the roster.

**The first-run gate now also requires a live roster row.** An employee record was not
enough: an equipment admin, a mechanic and the yard desk all have one and sit on zero crew
rows, and were being sent to a wizard whose every step is empty. Keyed on the roster and
never on the role name — a role list is wrong the day a tenant adds a role.

Deliberately not built, because nothing in the ask asked for it: polygon geofencing (a
point and radius only, per §3.4), an "invite request" queue for a caller who names crew
but lacks `user.manage` (the invite step tells them plainly instead — see the router
comment on `InviteStep`), and unconfirmed-row styling on the pre-existing roster screens
outside the wizard itself.

## 1. The ask

A person invited into Optix lands on a password form today and is then dropped into the
shell with no idea what they are responsible for. The request is that first sign-in
instead walks them through claiming their work:

  which jobs am I on → what is missing about those jobs → where is the job on a map →
  who is above and below me on each one → invite the ones who are not here yet.

With three properties that are not obvious from that sentence:

- A tier the person is not entitled to fill can be **deferred upward** — "my PM will name
  the superintendents" — and that deferral has to be a recorded fact, not an empty space.
- When a subordinate onboards **before** their boss, what they recorded must be waiting,
  pre-filled, when the boss onboards. The boss verifies or corrects; they do not retype.
- A boss needs a surface showing **who below them has and has not done this** — per job
  and per person, as progress rather than as a list of rows.

And one structural request underneath all of it: the company should be able to declare
that a **role reports to a role**, independently of which people currently hold them.

## 2. What already exists

This matters more than the design does. Most of the machinery is built, and the epic is
much smaller than the ask reads.

| The ask needs | Already there |
|---|---|
| Invites, tokens, mail | `authToken` (invite/reset, hashed), `user.invite`/`resend`, `packages/mail` over SMTP, `/invite/[token]` |
| A tenant-editable tier register | `tbl_entity_team_role` — director, area in-charge, and whatever the next tenant calls its tiers, added without a deploy |
| Per-job rosters with a reporting edge | `tbl_ops_project_team_member`, `reportsToEmployeeId`, one-active partial unique index |
| Who may put whom on a job | `assertCanAssign` in `projectTeam.ts`, `project.assign.*` permissions |
| Reporting-line scoping | `projectTeam.orgChart` + `visibleEmployeeIds` — already returns only the viewer's own line, server-side |
| A first-run redirect gate | `app-shell.tsx:181`, the `mustChangePassword` bounce |
| Maps | Leaflet and react-leaflet, loaded `ssr: false` — see `components/vehicle-map.tsx` |
| Motion | `lib/motion.ts` — `EASE`, `DUR`, `PANEL_SPRING` |

So this epic adds: a reporting edge between *roles*, a small amount of onboarding state,
three columns of geography, a wizard, and one oversight screen. It does not add an
invite system, a tier register, a permission model or a mapping library, and a diff that
starts building any of those has gone wrong.

## 3. The four decisions

### 3.1 The role reporting line goes on `team_role`, as data, and enforces nothing

`project_team_member.reportsToEmployeeId` carries a comment refusing "a rank on the role",
on the grounds that Optix is multi-tenant and construction firms genuinely differ in
shape. That refusal stands and this does not reverse it. What it forbids is a
**company-wide ladder asserted in code** — a `RANK` map that says a PM always outranks a
superintendent everywhere. What is proposed here is a **per-tenant, tenant-editable
default**, which is the same category of thing `team_role` itself already is.

    ALTER TABLE tbl_entity_team_role
      ADD COLUMN reports_to_team_role_id uuid REFERENCES tbl_entity_team_role(id) ON DELETE SET NULL;

Rules that keep it honest, and that the reviewer should check for:

- **Nothing about access reads it.** `assertCanAssign` keeps naming `project.assign.pm`
  and friends. If a diff makes a permission decision out of this column, that diff is the
  thing the roster comment was written to prevent.
- **It seeds, it does not bind.** Its only jobs are to tell the wizard which tiers to ask
  a given person about, and to tell the oversight screen whose progress is "below" whom.
  A per-row `reportsToEmployeeId` that disagrees with it is legal and wins.
- **Cycles are refused at the router edge**, by walking the chain on write. The column is
  self-referential and a tenant will eventually point two roles at each other.
- Null means "top of the chain, or not decided". Both are normal.

Urban's chain, which the register already anticipates in prose, becomes rows.
The client drew it on 2026-09-09 and it is a diamond, not a line:

    director
      area in-charge
        general superintendent | PM | superintendent      (siblings)
          project engineer | field engineer | foreman     (siblings)

PM does NOT sit above superintendent — an earlier version of this file and of
the seed both said it did, and the client corrected it: neither outranks the
other, which is exactly why the column records an edge and not a rank. The
authority is `teamRoleSpecs` in `packages/db/src/seed-data.ts`.

### 3.2 Progress is derived, not stored

This codebase's one idea is that state is calculated from what actually happened rather
than typed into a field, and an onboarding progress table would be the same mistake in a
new place — a number that says 80% while the roster underneath it says otherwise.

So the oversight screen computes from rows that already exist: does the project have
coordinates, does it have a row at each tier the register says it should, does each named
person have a user account, has that account ever signed in (`lastSignInAt`), is there a
live unspent invite (`authToken`), have they finished their own wizard.

Only two facts are genuinely not derivable and therefore get stored:

- **That a person finished or dismissed the wizard.** Absence of work is not the same as
  having considered it and had nothing to add.
- **That a tier was deliberately deferred upward.** An empty superintendent slot because
  nobody got to it and an empty one because the PM will fill it are different states, and
  the second must not read as an outstanding task on the foreman forever. This is the
  same distinction `role.needsLogin` was added to make on the people register.

### 3.3 Rows recorded during onboarding are real, and marked unconfirmed

The boss-verifies-later flow needs a subordinate's entries to be waiting for the boss.
The wrong build is a shadow "proposed team" table that a second writer later promotes
into the real roster — a second way to write the roster, which is the pattern this
codebase has paid for most.

Instead the wizard writes **ordinary `project_team_member` rows** through
`projectTeam.assign`, with two additions:

    ALTER TABLE tbl_ops_project_team_member
      ADD COLUMN confirmed_at timestamptz,
      ADD COLUMN confirmed_by_user_id uuid REFERENCES tbl_entity_user(id) ON DELETE SET NULL;

and `source = 'onboarding'`, a value the column already accepts. Null `confirmed_at`
means "recorded by somebody below the tier that owns this decision, not yet verified".
The boss's wizard shows those rows pre-filled with a confirm action; the oversight screen
counts them as outstanding.

**Confirmation must not gate custody.** A foreman's roster row physically moves their
tools and truck the moment it is written — that is what `projectTeam.assign` does and
what Tools by Jobsite is built on. An unconfirmed row is a row with a note on it, not a
row that has not taken effect. A diff that makes custody wait for confirmation has
changed the custody model and needs to say so out loud.

### 3.4 Geography is a point and a radius, and it is not the Desk

    ALTER TABLE tbl_entity_project
      ADD COLUMN latitude numeric(9,6),
      ADD COLUMN longitude numeric(9,6),
      ADD COLUMN geofence_radius_m integer;

No PostGIS, no polygon table. `TIMESHEET_PORT.md` puts Leaflet polygon geofencing in its
operational-modules phase and names it explicitly as a de-scope lever, so building the
polygon model here would be guessing at a shape that product has not settled. A point and
a radius answer "where is this job and roughly how big is it", which is what the wizard
step is for, and a polygon column can be added beside them later without migrating these.

The map control reuses the `vehicle-map.tsx` pattern: Leaflet, `dynamic(..., { ssr: false })`.

**On the oversight screen and `/desk`.** `/desk` and `/old-dash` were deleted on
2026-09-03, escalated by the user from a doc fix to a full removal and confirmed twice.
This screen is not a revival of that: the Desk was a general command surface with a panel
registry, and this answers one question — who below me has stood up their jobs and their
crews. It ships as its own route with its own nav id so nothing about it can be mistaken
for the panel dashboard coming back. Proposed route `/onboarding/progress`, nav label
"Onboarding", in the People group rather than the dashboards one. (The wizard itself moved
to `/welcome` during the build — see §4.)

## 4. The wizard

Route **`/welcome`**, and the route's LOCATION is the design. It sits outside the `(app)`
route group, so it inherits no shell at all — the first version lived inside it and was
framed by a sidebar, a project switcher and a notification bell, which asked somebody who
has never seen the product to parse the furniture before the question, and offered them
three links out of the one screen meant to hold them. It is deliberately the same shape as
the sign-in page next door (a jobsite photograph, the lockup, the task), because those two
screens are one sequence and should not feel like two products.

`/onboarding/progress` is the opposite case and stays inside the shell: it is a boss's
oversight screen reached from the nav, not a first-contact surface.

Gated the way
`mustChangePassword` already is at `app-shell.tsx:181` — an account whose onboarding is
unfinished bounces here. Skippable and resumable: it stores the current step, and a
person who abandons it lands back on the step they left. Never blocks sign-in.

Steps, in order, each one skippable except the first:

1. **Your jobs.** "What are you working on."

   **Rewritten 2026-09-06, after the claim design was withdrawn.** Two earlier versions
   of this step are recorded below because both failures are instructive.

   The spec originally said the candidate list came from existing scoping, "no new
   visibility rule". That does not work, and the failure is silent: `visibleProjectScope`
   derives visibility FROM roster rows, and a newly invited person has none. So the list
   was widened to every active job in the tenant, with a tick that wrote a
   `project_claim` — "I say I work here".

   **That was the wrong answer to a real problem.** A claim granted nothing and could not
   become a roster row (`assertCanAssign` refuses a superintendent their own tier and a PM
   everything), so steps two through four ignored every claimed job. A person ticked five
   and four did nothing, and the wizard was left explaining its own bookkeeping.

   The step is now READ-ONLY and lists the jobs the caller holds a live roster row on,
   with their tier on each. `project_claim` and `setClaim` are deleted (migration `0049`).
   The rule the product states plainly: **you are on a job when whoever runs it puts you
   on it.** A person who thinks a job is missing takes it up with whoever runs that job —
   the same conversation the claim was standing in for.

   The invariant this buys, and the one the tests pin: the set step one shows is exactly
   the set `fillDetails` and `setLocation` accept, so the wizard cannot offer an action
   the server will refuse.

2. **Fill the gaps.** Only the fields that are actually missing on the caller's jobs,
   never a full edit form: code, dates, status, site address. A job with nothing missing
   is shown as complete and not asked about.
3. **Put it on the map.** Search or drop a pin, drag the radius. "Use my location" for
   somebody standing on the site. Skippable, and skipped is a normal end state.
4. **Who is above and below you.** Driven by the role reporting line: for each of the
   caller's jobs, the tiers above and below the viewer's own, each either pre-filled with what a
   subordinate already recorded (with a confirm action) or empty with a person picker.
   Every tier the viewer may not assign carries the **defer toggle** — "my PM will do
   this" — which records the deferral rather than leaving a hole. Tiers the viewer may
   assign are gated by the existing `project.assign.*` checks, unchanged.
5. **Bring them in.** Everyone named across the previous step who has no account,
   listed with their email, each one togglable, and one button that issues invites through
   the existing `user.invite`. This is the finish action.

Motion uses `lib/motion.ts` and adds no curves. Steps travel horizontally — `EASE.out` at
`DUR.route` arriving, `EASE.in` shorter leaving — a progress rail across the top that
fills between steps, and content within a step staggering in at `DUR.base`. The house
brief in `lib/motion.ts` is "a yard tool, not a consumer app": nothing overshoots and
nothing bounces. `prefers-reduced-motion` drops every travel to a cross-fade, the way the
assistant panel already handles it.

## 5. The oversight screen

`/onboarding/progress`. Scoped by the viewer's reporting line, server-side, reusing
`visibleEmployeeIds` rather than adding a second idea of "below me".

Two views over the same derived data:

- **By job** — for each project in the viewer's line: geography set, a row at each tier
  the register expects, unconfirmed rows outstanding, crew named. A bar per job.
- **By person** — for each person below the viewer: invited, account exists, ever signed
  in, wizard finished, what they left deferred. This is where "did they log in and
  configure, or are they still pending" gets answered.

Deferrals show as **assigned to the viewer**, not as somebody else's incomplete work.
That is the whole point of recording them: a foreman's deferred superintendent slot is the
PM's task, and it should appear on the PM's screen as one.

## 6. Order of work

No ticket numbers. These are slices, sized only to say which are a day and which are a
week, and the order is a real dependency order rather than a preference.

The wizard cannot ask a person about the tiers above and below them until the company has
declared what those tiers are, so the reporting line comes first. The oversight screen
cannot show progress until the wizard has produced some, so it comes last but one.

1. ~~**The tier reporting line.**~~ **DONE 2026-09-05.**
   `team_role.reports_to_team_role_id`, migration `0044_short_stick`, `findTierCycle` and
   `adjacentTiers` in `packages/domain`, `projectTeam.roles.setReportsTo` behind
   `project.team.manage`, a "reports to" column on the Team Roles screen, and Urban's
   five tiers seeded as a real chain. Cycle refusal and cross-tenant refusal are both
   tested, in `team-role-ladder.test.ts` and `org-chart.test.ts`.
2. ~~**Onboarding state.**~~ **DONE 2026-09-05.** `tbl_ops_user_onboarding` (lazy, one
   row per user), `tbl_ops_project_role_deferral` with a partial unique index on open
   rows, the `onboarding.*` router, and the `app-shell` gate beside the password bounce.
3. ~~**Project geography.**~~ **DONE 2026-09-05.** Migration `0046`: `latitude`,
   `longitude`, `geofenceRadiusM` on `project`. `onboarding.fillDetails` and
   `onboarding.setLocation` — deliberately NOT `project.update`, which needs
   `project.manage`; these are scoped in-body to the caller's own live roster row instead,
   the same shape `assertCanAssign` could not give them. The Leaflet pin-and-radius
   control (`pin-picker-map.tsx`) drags a marker and resizes a radius by distance from
   centre, computed imperatively outside React state — see the crash story below.
4. ~~**Roster confirmation.**~~ **DONE 2026-09-05.** The two columns and
   `projectTeam.confirm`, gated by `assertCanAssign` on the row's own tier, now with a
   real caller: `CrewStep` shows a Confirm button on every unconfirmed row the viewer
   could have assigned. Unconfirmed styling on the PRE-EXISTING roster screens (Tools by
   Jobsite, the org chart) outside the wizard is still not done — nobody asked for it and
   the wizard itself is where confirmation actually happens.
5. ~~**The wizard shell and its first two steps.**~~ **DONE 2026-09-05.**
6. ~~**The remaining wizard steps.**~~ **DONE 2026-09-05.** The map step
   (`location-step.tsx`), the crew step with defer toggles and pre-filled confirmations
   (`crew-step.tsx`), and the invite step (`invite-step.tsx`). The invite step's own
   authority question — sending mail needs `user.manage`, which the primary onboarding
   user does not hold — is answered the same way the crew step answers "who may assign
   whom": the button is real for a caller who holds it, and everyone else sees the same
   list marked plainly as pending an office administrator. No invented authority, no
   invite-request queue.
7. ~~**The oversight screen.**~~ **DONE 2026-09-05.** `/onboarding/progress`, gated on
   `project.team.read` — the plan's §7.1 lean, taken rather than left open. Scoped by a
   new domain helper, `descendantsOf`, which is deliberately NOT `visibleEmployeeIds`:
   the org chart's helper also returns the chain ABOVE the viewer, which would put a PM's
   own director on the PM's progress screen. Both views render; deferrals appear on
   whichever caller's tier the deferred tier reports to per the ladder, matching the
   plan's "assigned to the viewer, not somebody else's incomplete work."
8. ~~**Seed and docs.**~~ **DONE for this slice.** Every state from the earlier ladder
   work seeds already (2026-09-05 seed additions); project geography and onboarding
   completion states did not need new seed rows to be exercisable, since the demo
   fixture's existing crew already produces unconfirmed rows and pending accounts once
   the ladder and onboarding tables exist.

That reasoning is CLAUDE.md's, at length: the seed carries no half-onboarded tenant by
accident, so every state a feature introduces has to be reachable from a clean database or
nobody ever really exercises it. Seed the edges, not just the happy path.

## 8. What a live browser found that reading the code did not

Two real defects surfaced only by driving the wizard in a real browser, both fixed:

- **The Leaflet crash.** The location step crashed on every single mount with
  `Cannot read properties of undefined (reading '_leaflet_events')`. Root cause turned
  out to be upstream of that message: Leaflet's default marker icon references image
  paths baked into its own bundled CSS, which do not survive this app's build — the icon
  silently failed to construct (`iconUrl not set in Icon options`), and Leaflet's own
  cleanup path then crashed trying to remove an icon that was never created. Fixed by
  copying the three marker PNGs into `public/leaflet/` and referencing them by a plain
  absolute path — no bundler resolution involved, so there is nothing left to resolve
  incorrectly. A static `import` of the same PNGs was tried first and hit the identical
  failure, which is worth knowing before reaching for that fix again.
- **Reentrant Leaflet mutation during drag.** The radius-resize control's first version
  called back into React state on every `mousemove` while dragging, which fed a new
  `radius` prop back into `react-leaflet`'s `Circle`, which called the underlying Leaflet
  layer's `setRadius` synchronously — from inside a callback Leaflet itself was still
  dispatching for that same mouse event. `RadiusEditor` in `pin-picker-map.tsx` now
  mutates the Leaflet circle directly during drag and commits to React exactly once, on
  mouseup.

Neither was visible from the source, the type system, or the test suite. Both needed a
real browser and a real drag.

## 7. Questions the plan raised, and how they were actually settled

1. **Who sees the oversight screen — decided: reuse `project.team.read`.** Built that
   way. A foreman with nobody below them sees an empty screen, which is the honest answer
   rather than a hidden nav row.
2. **Whether onboarding is mandatory — decided: bounce once, then never again.** Built
   that way. `userOnboarding.completedAt` is set by finishing OR dismissing, and the
   `app-shell` gate reads `onboarding.state.shouldPrompt`, which is false the moment
   either happens.
3. **Crew below foreman — decided: quietly skip, matching `role.needsLogin`.** Built
   that way in `InviteStep`: `needsAccount` filters out anyone whose `roleNeedsLogin` is
   `false` before the list is ever rendered, so a labourer never appears as an outstanding
   invite.

None of these are open any more. What IS still open, because nobody has asked for it yet:
whether unconfirmed rows should carry visible styling on the pre-existing roster screens
outside the wizard (Tools by Jobsite, the org chart), and whether the invite step's
"pending an office administrator" message should also surface as a notification to an
actual office admin rather than only appearing when a boss happens to open their own
progress screen.
