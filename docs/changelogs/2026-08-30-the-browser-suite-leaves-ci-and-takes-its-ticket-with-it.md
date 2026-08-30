# The browser suite leaves CI, and takes its own prediction with it

The `e2e` job went red on `development` with three nav specs failing and CI exited 1.
The job has been removed from `.github/workflows/ci.yml`. Nothing else about the
pipeline changed, and the suite itself is still here.

Worth being precise about what the red tick was and was not. The `e2e` job was
**already outside `deploy.needs`** — `deploy` gates on `check`, `build` and `smoke`,
and did before this change and does after. So the failing job never blocked a merge
or a deploy; it was a red tick with no teeth. That is exactly the state STI-001
criterion 8 warned about when it permitted the job to start non-blocking and required
a follow-up to make it blocking: *a permanently non-blocking test job decays into
noise.* STI-122 was opened on 2026-08-22 to close that window within a fortnight. It
took eight days for the noise to be removed instead of the cause.

## What changed

### The `e2e` job is gone from `.github/workflows/ci.yml`

Deleted whole, comments included. `check`, `build`, `smoke` and `deploy` are
untouched, and `deploy.needs` still reads `[check, build, smoke]` — the same list as
before, because the removed job was never in it.

### The suite is not deleted, only unwired

`e2e/` is still a workspace package, still in `pnpm-workspace.yaml`, still reachable
through `make ENV=local e2e` and the root `pnpm e2e` script. The Makefile targets and
the Playwright config are untouched. Removing the specs would have cost the local
harness, the `sti-e2e-qa` agent's whole job, and every doc that teaches someone to run
it — for no gain against the actual complaint, which was about CI.

### STI-122 is reopened and rewritten around what is now true

It used to say "add `e2e` to `deploy.needs`", which cannot be done to a job that does
not exist. It now asks for the red specs to be fixed first, the job restored, and only
then made blocking. It names the three failing specs and where the cause probably is,
and it points at git history for the removed job rather than inviting a rewrite — that
job had already paid for a `/health` poll instead of a sleep, a 20-minute ceiling,
Chromium only, and a `docker compose logs --tail` that does not follow. Those were each
bought with a failure and should not be re-derived.

### Docs that asserted the job exists

`SYSTEM_PLAN.md` §5's production-readiness row, the E2E note in
`docs/tickets/STATUS.md`, and both browser-suite passages in
`docs/HANDOFF-RELEASE-1.md` all said the suite runs non-blocking in CI. They now say
it runs locally and why. `STI-001`'s status line gets a dated note that its CI job was
later removed — the ticket shipped correctly and its criterion 8 was met, so the
history is annotated rather than rewritten.

## What was found while building it

**Two of the three failures are not flake, and they point at the previous commit.**
`nav-pin-order.spec.ts` ("moving a pin up changes the order and persists it") and
`nav-pins.spec.ts` ("a pin naming a forbidden route does not render it") both seed the
`sti-pins` storage key with the module ids `custody` and `tool-register`. The commit
immediately before the failing run was *"Fix frozen-column shadow, center
checkbox/menu, scope pins to their module."* Scoping pins to their module is precisely
the kind of change that invalidates a flat list of module ids in storage. The suite was
doing its job when it went red.

The third, `nav-feature-flags.spec.ts`, failed and then passed on retry — a genuine
flake, and the first one, which under STI-122's own zero-flake criterion would already
have stopped that ticket.

So the removal is a deliberate trade: CI stops reporting a real regression in exchange
for a green pipeline. That is a legitimate call to make and a bad thing to make
silently, which is why STI-122 now carries the diagnosis instead of the run log.

**`docs/tickets/STI-107` cites `ci.yml:97-101`.** Those line numbers survive — the
deletion starts at what was line 201, so everything in the `check` job keeps its
position.

## Verified

- `.github/workflows/ci.yml` parses and its top-level job keys are `check`, `build`,
  `smoke`, `deploy`. No `e2e`, `playwright` or `browser suite` string remains in the
  file. No tabs introduced.
- `deploy.needs` reads `[check, build, smoke]`, unchanged.
- Grepped the tree for `STI-122`, `e2e job`, `CI job`, `non-blocking` and
  `deploy.needs` to find every doc that described the job. Changelogs and
  `docs/workings/` sprint plans were left alone deliberately — they are dated records
  and were correct when written.

Not verified: nothing was pushed, and CI has not been run against the edited workflow.
The three failing specs were not run locally and their cause is diagnosed from the
failure output and the commit history, not from a debugging session — STI-122 owns
that work.

## Deliberately not done

- **The failing specs were not fixed.** Removing the job was the request; the fix is
  STI-122, which now names the two specs and the suspected commit.
- **`e2e/` was not deleted** — see above.
- **`continue-on-error: true` was not used instead.** It would have kept a suite
  running on every push whose result nobody is required to read, which is the decay
  STI-001 named, at CI-minute cost.
- **`SYSTEM_PLAN.md`'s "27 browser specs" was left alone.** It is a stale count and
  against the repo's own convention, but it predates this change and correcting it here
  would widen the diff past what was asked.

## Where it is

Uncommitted on `development`. Not pushed, not deployed. Note that `70fcfa2` ("Give
Urban's tenant its legal name…") landed mid-session from another hand and is unrelated
to this work.
