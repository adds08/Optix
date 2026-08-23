# STI-122 — Make the browser suite block a merge

**Phase:** 1 — Custody trail (follow-up)
**Size:** 0 units (a one-line change plus the evidence to justify it)
**Status:** READY — **not before 2026-09-05**, see below
**Opened:** 2026-08-22, by STI-001
**Depends on:** STI-001 (done)

---

## Why this exists

STI-001 criterion 8 permits the browser suite to start non-blocking and
**requires** a follow-up to make it blocking, for a reason worth restating: *a
permanently non-blocking test job decays into noise.* People stop reading a red
tick that has never once stopped anything, and at that point the suite costs CI
minutes and buys nothing.

The `e2e` job in `.github/workflows/ci.yml` runs on every push and is
deliberately absent from `deploy.needs`. The comment above it says so.

## Why not immediately

A browser suite that is blocking on day one and flaky on day three gets
disabled, and a disabled suite is worse than a non-blocking one because nobody
is even looking at it. Give it a fortnight of real pushes first.

**Do not skip the evidence step.** "It passed locally" is not the question; the
question is whether it passes on CI's slower, more contended runners, where
timing assumptions that hold on a developer laptop stop holding.

## Acceptance criteria

1. At least ten CI runs on `development` or `main`, over at least a fortnight.
2. **Zero flakes** — a failure that passed on re-run with no code change is a
   flake, and one is enough to stop this ticket. Fix the cause first; do not
   raise a timeout to make it go away.
3. Add `e2e` to `deploy.needs` in `.github/workflows/ci.yml`.
4. Remove the "NOT in deploy.needs yet" comment above the job and replace it
   with what is true afterwards. A comment describing a decision that has been
   reversed is worse than no comment.
5. Update `SYSTEM_PLAN.md` §5's production-readiness row, which currently says
   the browser suite exists but does not gate a merge.

## If it IS flaky

The likely causes, in the order they are worth checking:

- **`networkidle`.** The console-error spec waits on it, and it is the least
  deterministic wait Playwright offers. A page that polls will never be idle.
- **Seeded state.** The suite is read-only *by design* (see the isolation note
  in `e2e/playwright.config.ts`) — but if somebody adds a mutating spec without
  first choosing an isolation mechanism, two workers will fight over the same
  row and the failure will look like flake rather than the design error it is.
- **The stack not being up yet.** `make up` returning is not the same as the
  web app serving. The auth setup fails with a readable message for exactly
  this, so check whether the message appeared before assuming timing.

## Files

- `.github/workflows/ci.yml` — the `e2e` job and `deploy.needs`
- `e2e/playwright.config.ts` — retries, workers, and the isolation note
