# Claims were a detour

2026-09-06

Step one used to list every active job in the tenant with a tick box. Ticking
one wrote a `project_claim` — "I say I work here" — which granted nothing. The
user's verdict on the flow it produced: *"What even is this claim? I think you
made things too complex."* They were right, and the table is gone.

## What was wrong with it

A claim could not become a roster row, because `assertCanAssign` refuses a
superintendent their own tier and refuses a PM everything. So claiming was a
dead end by construction: a person ticked five jobs and steps two through four
ignored four of them, since editing a job needs a roster row. The wizard then
explained its own bookkeeping to somebody who had ticked a box thirty seconds
earlier and reasonably thought it meant something.

Yesterday's fix made that message politer. That was treating the symptom — the
defect was upstream, in a step that offered choices that could not matter.

## The rule now

**You are on a job when whoever runs it puts you on it.** Step one reports the
roster and nothing else: read-only, no tick, no write, with the caller's tier
shown per job. Every later step operates on exactly that set, which is the same
set `fillDetails` and `setLocation` enforce — so the wizard can no longer offer
an action the server will refuse.

`project_claim`, `setClaim` and the union read are deleted (migration `0049`
drops the table). `myClaimedProjects` keeps its name and now reads the roster.

What the claim was reaching for is already built, in step four: a boss sees the
people below them **already filled in from the roster**, marked unconfirmed,
and confirms them. Verified with Urban's real ladder — Marcus, a
superintendent, opens the crew step and finds his PM above him on both jobs and
his eight Lone Star foremen below, none of it typed by him. That is the whole
of what the claim was standing in for, minus a table.

## Roles that should never see this

Reported alongside: *"there might be some roles, especially technical admins,
super admins, that might not even require this onboarding screen."* Correct, and
the gate was too loose — it only excluded accounts with no employee record.
Three seeded roles have an employee record and zero crew rows (equipment admin,
mechanic, the yard desk), because they serve every job rather than working on
any. They were being sent to a wizard whose every step is empty.

`shouldPrompt` now also requires a live roster row. Keyed on the **roster, not
the role name**: a role list is wrong the day a tenant adds a role, and
`nav-config`'s role-name branch is already the last one in the product for
exactly that reason. A mechanic genuinely put on a job gets the wizard; an
office-bound PM does not. `needsSetup` gets the same condition, or the sidebar
would nag a mechanic forever about a wizard with nothing to ask.

Verified per role against the seeded data:

| Account | Crew rows | Lands on |
|---|---|---|
| `super@` | 2 | `/welcome` |
| `pm@` | 1 | `/welcome` |
| `foreman@` | 1 | `/welcome` |
| `mechanic@` | 0 | `/my-tools` |
| `admin@` (equipment) | 0 | `/home` |
| `warehouse@` | 0 | `/home` |

## Tests

Seven failed on the first run and every one was legitimate — they asserted the
behaviour deliberately removed. The RBAC matrix caught the now-stale `setClaim`
exemption; the candidate-projects block asserted the old wide list. Rewritten to
pin the replacement invariant: step one's set equals the set the mutations
accept. `asStranger` is a new fixture — an employee on no jobs, the mechanic
case — so the gate has a test and not just a screenshot.

350 tests pass. `pnpm typecheck` and `pnpm lint` clean. The superintendent's
full five-step run completes and records, and confirming a foreman writes
`confirmed_at` (checked in `psql`, not just on screen).

## The browser suite was already broken, in two different ways

Running `npx playwright test` — which had not been done while this feature was
built — turned up five failures. One was mine and four were not.

**Mine, and it broke everything:** `auth.setup.ts` waits for each role's
declared `landsOn` before saving a session, and an un-onboarded `foreman@` was
being sent to `/welcome` instead of `/my-tools`. Every spec in the suite failed
at the door. The gate was right; the fixture was stale. `foreman@` is now seeded
as already onboarded, `super@` is deliberately left unfinished, and `roles.ts`
records that `landsOn` depends on that seed so the next person to see a
`/welcome` redirect checks the seed before "fixing" the route.

`e2e/tests/onboarding-gate.spec.ts` is new and covers what nothing did: who is
sent to the wizard and who never is, across five accounts, plus the
skip-and-resume journey. It signs in fresh rather than reusing a stored session,
because a saved `storageState` lands you past the redirect being tested.

**Not mine, and left alone** — four failures that predate this work and belong
to the shell rebuild in `2ee29dc` ("no rail, full-width bar, launcher-led
modules") and the native-select sweep:

- `nav-pins.spec.ts` › a pin naming a forbidden route does not render it
- `nav-pin-order.spec.ts` › moving a pin up changes the order and persists it
- `icon-scale.spec.ts` › the setting is offered on Settings and previews live
- `reachability.spec.ts` › the register outnumbers a foreman's holdings

The first two look for a "Pinned" sidebar group on `/home`; the rebuilt shell
shows only the active module's rows, so HR on the dashboard correctly sees just
Dashboard. The third does `selectOption` on `#app-icon-scale`, which is no
longer a native `<select>` — the sweep in `.claude/rules/web.md` replaced every
one of them. These are real regressions in the specs, not in the product, but
they are somebody else's change to fix and guessing at the intended behaviour
would be worse than reporting them.
