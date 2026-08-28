# The deploy did not fail — two tests I wrote did

Reported as a failed deployment after the table-rename merge. It was not one.
The CI run on `main` is red, and production is fine: the browser suite failed,
and it is deliberately not in `deploy.needs`.

Recording this because "the merge went red so the deploy broke" is a reasonable
thing to conclude from a red tick, and the CI layout invites it.

## What actually happened

`gh run view 33148412157` shows five jobs: migrate-and-boot ✓, production images
✓, typecheck·lint·test ✓, **deploy to production ✓**, browser suite ✗.

Production was verified directly rather than inferred from a green job:

- running commit `f680b46`, the rename merge itself
- api, web, caddy, postgres and minio all up and healthy
- **27 `tbl_entity_*` tables, 10 `tbl_ops_*`, and zero unrenamed** — the rename
  applied cleanly to the production database
- data intact: 20 assets, 11 people, 48 ledger rows, 20 custody rows, 5 users
- `https://urban.bodhitechlabs.com` returns 200 and `/health` is ok

So the migration that renames every table went out and worked.

## What was broken

Both failures were in specs written the night before, and both passed locally
while failing in CI — the classic shape of a test that depends on its
environment rather than on the product.

### The layout-shift test measured a scroll, not a layout

`no-layout-shift.spec.ts` asserted the register's table did not move when a row
was selected, using `getBoundingClientRect().top`. That is **viewport**-relative.
Playwright scrolls a target into view before clicking it, so the number changes
when nothing has moved. CI reported `Expected: 171, Received: 2` — a 169px
"layout shift" that never happened.

The first fix was wrong and is worth recording: adding `window.scrollY` does
nothing here, because **this shell never scrolls the window**. It scrolls an
inner `.sti-scroll` region. Measured directly: with that container scrolled 300,
the table reads `-129` while `window.scrollY` is still `0`.

The measurement now walks up to the real scrollable ancestor and adds its
`scrollTop`, which reads 171 both at rest and scrolled. Proved by injecting a
350px container scroll between the two measurements and watching the test stay
green.

### The pin-landing test asserted before the redirect could happen

`nav-pin-order.spec.ts` signs in and expects to land on the first pinned row.
The redirect cannot fire until `identity.me` resolves — that is the guard in
`app-shell.tsx`, without which the one-shot marker is spent on a render that has
no permissions yet. On a cold CI stack, sign-in plus that first round trip takes
longer than Playwright's 5s default, so the URL was still `/home` when the
assertion gave up. It failed all three retries, which is what a uniformly slow
stack looks like rather than a flake.

It now waits for the shell's own ready signal — the account button — and then
asserts. Deterministic, rather than a bigger guess.

**Its sibling was passing for the wrong reason** and was fixed too. The test that
a forbidden pin does *not* redirect asserted `/home` immediately, which a test
can satisfy simply by looking before anything would have happened. It waits for
the same ready signal first, so `/home` surviving is a real claim.

## What was found while building it

**A non-blocking job that fails still reads as "the build broke".** The browser
suite is excluded from `deploy.needs` on purpose, with a comment saying so and
STI-122 to make it blocking once it has clean history. That reasoning is sound
and is left alone. But the cost is exactly what happened here: a red run on
`main` that means "some tests failed" gets read as "the deploy failed", and
someone goes looking for a broken production that is fine.

**Three retries all failing is a signal, not noise.** A genuine flake passes
sometimes. Both of these failed every attempt, which said they were wrong rather
than unlucky — and they were.

## Verified

- Production checked over SSH: schema, row counts, container health and a live
  200 from the public URL.
- 33 browser tests green locally, including all five previously-failing cases.
- The scroll correction proved against a real 350px container scroll injected
  mid-test, not just against a page that happened not to scroll.

## Deliberately not done

**The browser suite was not made blocking.** That is STI-122, it wants a
fortnight of clean history first, and tonight's two failures are exactly the
history it needs to accumulate honestly.

**No product code changed.** Both defects were in the tests. The rename, the
role register and the pin work all stand as shipped.

## Where it is

Committed and merged to `main`. Production already runs this code; only the
specs changed, so nothing needs redeploying.
