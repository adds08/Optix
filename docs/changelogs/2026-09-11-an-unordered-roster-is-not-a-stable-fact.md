# An unordered roster is not a stable fact

`activeProjectRows` is the single source of every members array on the Crew
screens, and it carried no `ORDER BY`. Postgres was therefore free to return the
same rows in a different order on two identical reads, and it did.

That surfaced as CI red on `1cf9490`: `account-lifecycle.test.ts` compares a
project's roster before and after an onboarding reopen, found the same three
people in a different order, and failed having detected nothing wrong. The tell
was which case failed — an `it.each` over four roles running identical code, red
for `project_manager` and green for the other three. Same path, different
outcome, which is order luck rather than a regression. The same commit then went
green on `main` with no code change between the two runs.

## What changed

`packages/api-contracts/src/project-access.ts` — `activeProjectRows` now orders
by `createdAt` then `id`. That is the tie-break rule this codebase already
follows for the ledger, and for the same reason: a bulk writer inserts many rows
inside one timestamp, so the timestamp alone does not order them.

Fixed at the query rather than in the test. Sorting both sides of the assertion
would have made CI green while leaving the actual defect in place — on screen,
the identical gap let a crew list reshuffle between page loads.

## What was found while building it

- **The flaky test hid a real product bug.** Every consumer of
  `activeProjectRows` inherited the non-determinism, including the Crew list the
  client renders. A test that only compared sorted copies would have protected
  the suite and nobody else.
- **A commit that failed CI on `development` was merged to `main` anyway**, and
  `main` is the branch that deploys production. Its run then passed, because the
  failure was a coin flip, and the production deploy started. It was cancelled 33
  seconds in, before the container swap — verified afterwards: production still
  showed 51 minutes of container uptime from the previous deploy, 66 applied
  migrations with `0067` absent, and `active` as the only employment status in
  use. Nothing from that commit reached production.
- **A comment in the new suite is already stale.** `account-lifecycle.test.ts`
  says "Local also grants pm, but production does not", recorded from a
  read-only production inspection earlier the same day. Production granted `pm`
  about an hour later, through the Job Tiers screen. The test still passes
  because it sets the state it needs itself, so this is a comment that now
  misdescribes production rather than a broken test.

## Verified

- The previously failing suite: `22 passed`.
- The whole api-contracts suite in the container against the test database:
  `422 passed`, `0 skipped`, 37 files.
- `pnpm typecheck` — 13 tasks. `pnpm lint` — 0 errors, 8 pre-existing warnings.

Not verified: whether the ordering changes any on-screen order a person was
relying on. It makes the order deterministic where there was none, so a list may
settle into a different arrangement than the one it happened to show before.

## Deliberately not done

- **The stale comment above was left alone.** It is somebody else's in-flight
  work and correcting prose inside it mid-flight risks a conflict for no
  functional gain.
- **No change to what `1cf9490` does.** This commit exists to make the branch
  honest about it, not to review it.

## Where it is

Branch `development`, merged to `main`. Both deploy automatically on a passing
CI run.
