# First-run setup, and the tier nobody claimed

An invited person used to land on a password form and then be dropped into the shell
knowing nothing about what they were responsible for. Everything the system held about them
had been typed in by an administrator, and whatever that administrator did not know stayed
unknown. This adds the first-run wizard, the state behind it, and the two records that make
a half-finished organisation legible.

Built on top of the tier ladder from earlier the same day.

## The one decision that shaped everything

The wizard writes nothing the person could not write themselves.

That sounds obvious and it was not the original plan. The plan had a foreman naming their
crew, and the permission table says a foreman holds `project.team.read` and nothing else —
they cannot assign a foreman, cannot assign a superintendent, and therefore could not even
claim their own job. Three ways out were considered: give the wizard elevated authority
during first run, add a permission, or accept the existing model.

The third is what shipped, on the user's call: *"when a superintendent adds his foreman to
project, the reportsTo later does the onboarding, he can see what super did anyway."* Which
is right, and much simpler. Every roster write goes through `projectTeam.assign` under the
caller's own permissions. A superintendent puts their foremen on. A foreman does not,
because a foreman never could, and what a foreman gets instead is the confirmation step —
their superintendent already recorded them, and they see it.

No elevated path, no new permission, and no second way to write the roster.

## What was built

- **`tbl_ops_user_onboarding`** — one row per user, created lazily on first sign-in rather
  than with the account, so "has not started" and "does not exist" stay distinguishable.
  Holds a resume point and a completion stamp, and deliberately no progress: what the
  wizard produced is readable from the rows it wrote.
- **`tbl_ops_project_role_deferral`** — "my PM names the superintendents", as a fact.
  Absence cannot distinguish a tier nobody got to from one deliberately left upward, and
  without the distinction the first nags a foreman forever while the second never reaches
  the PM. A partial unique index keeps it one open row per job and tier, because two
  foremen deferring the same slot is one outstanding decision. Closed by
  `projectTeam.assign`, stamped rather than deleted.
- **`project_team_member.confirmed_at` / `confirmed_by_user_id`**, and
  `projectTeam.confirm` gated by `assertCanAssign` on the row's own tier — verifying a
  placement costs what making it costs. Confirmation changes what the progress screen
  counts as outstanding and **nothing about custody**: the row has been live since it was
  written, and a foreman's roster row moves their tools on write.
- **The first-run gate**, beside the `mustChangePassword` bounce it is modelled on, and
  enabled only once that one is satisfied so the two cannot race. `shouldPrompt` is computed
  server-side so its exemptions are one edit, not two.
- **`/onboarding`** — the step rail, horizontal step travel, resume, skip, step one
  (claiming jobs) and a placeholder step two. Motion comes from `lib/motion.ts` with no new
  curves: `EASE.out` arriving, shorter `EASE.in` leaving, and `prefers-reduced-motion` drops
  travel to a fade rather than to nothing.
- Migration `0045_crazy_cardiac`, and seeded examples of every new state.

## Found while building

**Step one was specified in a way that could not work, and would have failed silently.**
The plan said the candidate job list came from existing scoping. But `visibleProjectScope`
derives visibility *from* roster rows and postings, and a newly invited person has neither —
those are what the wizard creates. Reusing it returns an empty list for exactly the person
being onboarded, and the only accounts that would see anything are the all-projects tier who
least need a wizard. `onboarding.candidateProjects` is therefore deliberately wider than
normal visibility: active jobs, names and codes only, no tools or people or costs, and
claiming one grants no access. A test asserts a foreman with no roster rows still sees jobs.

**Two guardrail tests caught the new procedures, correctly.** `rbac-matrix` flagged four
mutations with no permission, and `reachability` flagged two procedures no screen calls.
Both were real. Three of the four are genuinely open by design and now say why beside
`user.changePassword`, which has the same shape — gating a person's own onboarding would
mean the accounts sent to the wizard are the ones that cannot leave it. The two unreachable
ones belong to the unbuilt crew step and carry `TODO:` entries, which is the convention for
ticketed work rather than a permanent exemption.

**The seed block was written in the wrong place and no-opped in silence.** It edits roster
rows and needs a `user.id` to attribute confirmations to, and the login accounts are created
further down `seed.ts` than the roster is. The guarded lookups all returned nothing, the
seed reported success, and three of the four new states were simply absent. Moved, with a
note saying why it cannot sit beside the table it edits.

**`AuditCategory` has no `user`.** Account-lifecycle events log under `auth`, which is
where `user.create` and `user.invite` already are. Used that rather than widening the union
for one call site.

## Deliberately not done

The map step, the crew step, the invite step and the progress screen. Project geography has
no columns yet. `projectTeam.confirm` and `onboarding.defer` are built, tested and gated but
have no screen — the crew step is their caller.

Unconfirmed roster rows are also not yet *shown* anywhere. The flag is written and read by
tests, and no existing roster screen styles it. That is a real gap rather than a decision,
and the crew step is where it lands.

## Verified

`pnpm typecheck`, `pnpm lint`, and `pnpm test` in the api container so the database suites
actually ran. Twenty-two new tests in `onboarding.test.ts` covering lazy creation, the
no-employee exemption, resume, the candidate-list regression, the deferral lifecycle
including its close, and confirmation refusing somebody who could not have assigned the row.

Driven in a browser on the seeded fixture. A foreman is bounced to `/onboarding`, is offered
ten jobs despite holding no roster rows, travels forward and back between steps, and after
skipping reaches `/tools` without being bounced again. The owner account, which has no
employee record, lands on `/home` and is never trapped.

Local only. Not deployed.
