# STI-122 — Put the browser suite back in CI, then make it block a merge

**Phase:** 1 — Custody trail (follow-up)
**Size:** 1 unit (fix the red specs; the CI wiring itself is a few lines)
**Status:** BLOCKED — the specs are red; see below
**Opened:** 2026-08-22, by STI-001
**Reopened:** 2026-08-30, when the CI job was removed
**Depends on:** STI-001 (done)

---

## Why this exists

STI-001 criterion 8 permits the browser suite to start non-blocking and
**requires** a follow-up to make it blocking, for a reason worth restating: *a
permanently non-blocking test job decays into noise.* People stop reading a red
tick that has never once stopped anything, and at that point the suite costs CI
minutes and buys nothing.

That is exactly what happened. The `e2e` job ran non-blocking from 2026-08-22,
went red on the nav specs, and was **removed from `.github/workflows/ci.yml` on
2026-08-30** rather than fixed. The prediction in this ticket's original text
came true in eight days.

The suite itself was not deleted. `e2e/` is still a workspace package and still
runs locally against the Docker stack:

```
make ENV=local e2e-install   # once
make ENV=local e2e           # needs the stack up
```

## What was red when it was removed

Three specs, from the run on `development` on 2026-08-30:

- `nav-pin-order.spec.ts` — "moving a pin up changes the order and persists it"
- `nav-pins.spec.ts` — "a pin naming a forbidden route does not render it"
- `nav-feature-flags.spec.ts` — flaky: failed, then passed on retry

The first two are **not flake**. They both drive the `sti-pins` storage key with
the module ids `custody` and `tool-register`, and the commit immediately before
that run was *"Fix frozen-column shadow, center checkbox/menu, scope pins to
their module"*. Start there: either the specs were not updated for the new
scoping, or the scoping broke pin rendering. Read the code before touching the
specs — a spec changed to match a bug is worse than no spec.

The third is the flake criterion below failing on day one, and needs its own
diagnosis rather than a raised timeout.

## Acceptance criteria

1. The three specs above pass locally against a freshly seeded stack, with the
   cause understood and named in the changelog — not worked around.
2. Re-add the `e2e` job to `.github/workflows/ci.yml`. The removed version is in
   git history (`git log -p -- .github/workflows/ci.yml`) and was sound: it
   polled `/health` rather than sleeping, capped itself at 20 minutes, ran
   Chromium only, uploaded the Playwright report on failure, and used
   `docker compose logs --tail` rather than the following `make logs` target.
   Do not re-derive those; they were each paid for once.
3. At least ten CI runs on `development` or `main`, over at least a fortnight.
4. **Zero flakes** — a failure that passed on re-run with no code change is a
   flake, and one is enough to stop this ticket. Fix the cause first; do not
   raise a timeout to make it go away.
5. Add `e2e` to `deploy.needs`.
6. Remove the "NOT in deploy.needs yet" comment and replace it with what is true
   afterwards. A comment describing a decision that has been reversed is worse
   than no comment.
7. Update `SYSTEM_PLAN.md` §5's production-readiness row and the E2E note in
   `docs/tickets/STATUS.md`, both of which currently say the suite does not run
   in CI.

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
- `e2e/tests/nav-pins.spec.ts`, `e2e/tests/nav-pin-order.spec.ts` — the red ones
- `e2e/playwright.config.ts` — retries, workers, and the isolation note
