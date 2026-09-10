# Claiming a crew downward, and warning instead of refusing

The client asked a question the product could not answer: *"lets say there are
no PM and supers, and a director or area incharge holds foreman directly, since
this role is below him, can they do it?"*

Reading the code, the answer turned out to be **yes, already, silently**.
`assertCanAssign` gates on the target tier's own permission and nothing else —
it never reads the reporting ladder from Settings → Team Roles, never looks at
what other tiers the person being assigned already holds, and never counts
levels. The only structural check anywhere is `findCycle`, which blocks a
reporting *loop* and says nothing about a skip. So tier-skipping was fully
permitted, with no signal that anything unusual had happened.

What was missing was not permission. It was a screen that made the downward view
visible, and a warning that said what a skip meant.

## What changed

### `/my-crew` — the downward view

A superior sees, per job they hold a team role on, every tier at or below their
own, and claims people into them. Nothing above is shown.

The direction is the whole point, and it is what separates this from
`/onboarding` step four. That asks a person being onboarded to name their boss
and their own crew — one tier each way, which is right for the question it asks.
This is the other shape: the client's words were *"a director saying this is my
PM, these are my superintendents would also mean a foreman saying i am working
under this director"*.

**No reverse edge was needed for that second half.**
`project_team_member.reportsToEmployeeId` is one directed edge, and the
foreman's own view of it is the same column read the other way — which is
exactly what the org chart already does. Nothing new is stored.

**The top-down primitive already existed too.** `projectTeam.assign` is called
BY the superior, and they set `reportsToEmployeeId`; a subordinate never
self-declares it. This screen adds no mutation and no elevated path — claiming
goes through the same `assign`/`confirm` the jobsite hub and the wizard use,
under the caller's own permission.

### `tiersAtOrBelow` and `tiersAbove`

Two pure functions in `packages/domain/src/org-chart.ts`, beside
`adjacentTiers` rather than replacing it — the wizard still wants one level each
way.

`tiersAtOrBelow` is breadth-first over the whole subtree and returns, per tier,
the true shortest `hops` and the tiers stepped over to reach it. **Hops 0 is the
claimer's own tier**, included deliberately: *"show all the roles under them and
with them, just not above them"*. A superintendent standing in for another
superintendent is a real arrangement on a short-handed job. Both walks are
cycle-safe, because `findTierCycle` exists precisely because tenants close loops
in that register by hand.

### The skip warning warns, and does not refuse

`hops > 1` names the skipped tiers. Claiming a foreman as a PM reads: *"This
skips Superintendent. They'll answer straight to you instead of through that
tier. That's allowed — carry on if it's how the job actually runs."* The button
relabels to **Add anyway** and stays enabled. Settled with the client: *"they
will get a warning but they can do it"*.

It fires only once somebody is actually picked. A permanent banner on every
distant tier would be noise on a screen whose entire job is to show distant
tiers.

### Who is not offered

The candidate picker excludes anybody holding a tier **above** the claimer,
tenant-wide rather than per-job — a superintendent on another job is still a
superintendent, and offering them into a foreman slot because they happen not to
be on this one is how a picker suggests naming your own boss's boss into a crew.
It also excludes leavers a sync has flagged (`employee.hrFlaggedInactiveAt`),
not just people marked terminated: somebody BambooHR says has gone is not
somebody to put on a crew, even while `employment_status` still reads active
because clearing that is an admin's decision.

## What was found while building it

**Two bugs that typechecked, looked right in the diff, and were caught only by
clicking through and reading the row back.**

The first was the claim itself. The page sent `reportsToEmployeeId: null` under
a comment asserting it meant "they answer to me". Null is a legal value meaning
*no boss recorded* — the exact opposite of what a claim asserts. The row wrote,
the screen showed the person in the tier, and the edge the entire feature exists
to record was absent. `myCrew` now returns the caller's own `myEmployeeId` and
the page sends that. The visible symptom, in hindsight, was that the "yours"
marker never appeared on anybody claimed through the screen.

The second: the picker key was built from `teamRoleId` while the mutation echoes
back the role *name*, so the post-success clear never matched and a completed
add left its selection and its skip warning sitting on screen.

Both are the same shape as the legacy-role defect earlier the same day — a write
that succeeds while the thing depending on it is looking somewhere else. Neither
was reachable by typecheck, and both were obvious within seconds of driving the
screen.

**`tsx watch` does not pick up a change in a linked workspace package.** The new
procedure returned 404 until the api container was restarted, which reads
exactly like a routing bug and is not one.

## Verified

- `pnpm typecheck` — 14/14 tasks
- 242 tests across 11 files (`domain`, `types`, `intent`, plus
  `reachability.test.ts`, which is what would have caught an unreachable
  procedure). 14 of those are new, over `tiersAtOrBelow` and `tiersAbove`:
  peer inclusion, nothing-above, the full-depth walk, a director reaching
  foreman four hops down naming all three skipped tiers, hops 1 skipping
  nothing, two children at equal distance, the bottom of the chain, an unplaced
  tier, an unknown id, and termination on a looped register
- Driven end to end in a browser as a PM on job 22017 NEX: the peer tier renders
  as "(same tier)", Superintendent as "1 below you", Foreman as "2 below you",
  no tier above appears, and the existing crew shows with the "yours" marker on
  the person reporting to the caller. Claiming a foreman raised the skip warning,
  the button relabelled to "Add anyway", the write landed, and the row read back
  from the database as `Alex Garcia | foreman | NEX | reports_to Aryana Jimenez`.
  After success the picker cleared and the warning went.

**Not verified.** The database-backed suites were not run — `make seed-demo`
carries `SEED_RESET=1` and would have destroyed the dataset the screen was being
demonstrated against. No test covers `myCrew` itself; the pure tier walks are
covered and the procedure is not.

## Deliberately not done

- `assertCanAssign` was **not** changed. It still gates on the target tier's
  permission alone and still ignores the ladder. Making the hierarchy
  authoritative for authorisation is a different product decision than showing
  it, and this change deliberately does not make it.
- `adjacentTiers` and `onboarding.crewStatus` are untouched — the wizard's
  one-level question is right for the wizard.
- No `reportsToEmployeeId` editor on an existing row from this screen.
  `projectTeam.setReportsTo` already exists for that.

## Where it is

Committed to `development` and pushed. Not deployed — only `main` auto-deploys.

**To see it locally**, the signed-in account must hold a team role: the two
seeded administrators have no employee record at all, so `myCrew` correctly
returns nothing for them. `optix_it@optixtec.com` is currently linked to the
seeded PM Aryana Jimenez (one `UPDATE` on `tbl_entity_user.employee_id`) purely
so the screen has something to show.
