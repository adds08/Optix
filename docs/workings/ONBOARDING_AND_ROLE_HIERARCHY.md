# Onboarding and the role reporting line

Status: **items 1, 2, 4 and half of 5 built 2026-09-05.** On `development`: the tier
ladder (migration `0044`), onboarding state and the deferral record (`0045`), roster
confirmation, the first-run gate, and the wizard shell with its first two steps.

Still proposed: project geography, the map step, the crew step, the invite step, and the
progress screen. The two procedures the crew step will call — `projectTeam.confirm` and
`onboarding.defer` — are built and tested but have no screen yet, and carry `TODO:` entries
in `reachability.test.ts` saying so.

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

Urban's chain, which the register already anticipates in prose, becomes rows:
director → area in-charge → PM and general superintendent → superintendent → foreman.

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
"Onboarding", sitting with the wizard at `/onboarding` rather than in the dashboards group.

## 4. The wizard

Route `/onboarding`, outside the normal page chrome, gated the way
`mustChangePassword` already is at `app-shell.tsx:181` — an account whose onboarding is
unfinished bounces here. Skippable and resumable: it stores the current step, and a
person who abandons it lands back on the step they left. Never blocks sign-in.

Steps, in order, each one skippable except the first:

1. **Your jobs.** "What are you working on."

   **Corrected 2026-09-05, during the build.** This step originally said the candidate
   list came from existing scoping, "no new visibility rule". That does not work, and the
   failure is silent: `visibleProjectScope` derives visibility FROM roster rows and
   postings, and a newly invited person has neither — those are what the wizard exists to
   create. Reusing it returns an empty list for exactly the person being onboarded.

   So `onboarding.candidateProjects` is deliberately WIDER than the caller's normal
   visibility: active jobs in the tenant, names and codes only, no tools, people or costs.
   Claiming one grants no access — access still comes from the roster row, written by
   `projectTeam.assign` under the caller's own permissions, which may refuse them. The
   test that guards the regression is "a foreman with no roster rows still sees jobs".

   It also does NOT write the viewer's own roster row, as originally specified. A foreman
   cannot assign a foreman, so that write would fail for the primary user. What the tick
   records is intent; who is actually on the job stays with whoever runs it.
2. **Fill the gaps.** Only the fields that are actually missing on the jobs just claimed,
   never a full edit form: code, dates, status, site address. A job with nothing missing
   is shown as complete and not asked about.
3. **Put it on the map.** Search or drop a pin, drag the radius. "Use my location" for
   somebody standing on the site. Skippable, and skipped is a normal end state.
4. **Who is above and below you.** Driven by the role reporting line: for each claimed
   job, the tiers above and below the viewer's own, each either pre-filled with what a
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
3. **Project geography.** The three columns, the migration, a `project.setLocation`
   procedure, the Leaflet pin-and-radius control. About a day.
4. ~~**Roster confirmation.**~~ **MOSTLY DONE 2026-09-05.** The two columns and
   `projectTeam.confirm`, gated by `assertCanAssign` on the row's own tier. Unconfirmed
   styling on the existing roster screens is NOT done — the flag is written and read by
   tests, and no screen shows it yet.
5. **The wizard shell and its first two steps.** Shell DONE 2026-09-05: `/onboarding`,
   the step rail, horizontal step travel honouring `prefers-reduced-motion`, resume, skip.
   Step one (claiming jobs) reads `onboarding.candidateProjects`; step two (filling gaps)
   is a placeholder pending the project-detail form.
6. **The remaining wizard steps.** The map step, the crew step with its defer toggles and
   pre-filled confirmations, the invite-and-finish step. About two days.
7. **The oversight screen.** The derived progress query, both views, reporting-line
   scoping. About two days.
8. **Seed and docs.** Half a day, and part of this work rather than after it.

That last one is not housekeeping, for the reason CLAUDE.md gives at length: the seed
carries no half-onboarded tenant today, so every state introduced here — a deferred tier,
an unconfirmed roster row, an invited account that never signed in, a job with no
coordinates — is a state nobody can exercise without hand-editing rows. Seed the edges,
not just the happy path.

## 7. Open questions

1. **Who sees the oversight screen.** It could reuse `project.team.read`, which every
   foreman already holds, and lean entirely on reporting-line scoping so a foreman simply
   sees an empty screen. Or it could carry a new permission. Reusing is smaller and
   consistent with how `orgChart` was built; a new permission is more explicit. Leaning
   toward reuse.
2. **Whether onboarding is mandatory.** The gate can bounce an unfinished account to the
   wizard the way `mustChangePassword` does, or the wizard can be an invitation on `/home`
   that never blocks. Mandatory gets the data in; it also stands between a foreman and the
   tool he needs to check out right now. Leaning toward bouncing once, then never again.
3. **Crew below foreman.** The wizard's crew step names people at tiers in the register.
   Labourers mostly have no login and `role.needsLogin` already says so — so the invite
   step must quietly skip them rather than nagging. Confirm that reading is right.
