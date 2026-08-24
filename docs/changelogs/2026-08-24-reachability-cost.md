# The reachability walk was right and unaffordable

Follow-up to the same day's `reachability-walks-the-rail`, which fixed the
assertion and then failed CI on its cost: four specs timed out at 30s.

## What changed

The walk runs once per role instead of twice. Both halves — the routes a role
must be offered and the routes it must not — assert against one traversal, and
the test is marked `test.slow()`: six navigations against a dev server that
compiles each route on first hit is not a thirty-second job, and pretending
otherwise is how a suite becomes something people re-run rather than read.

The settle condition is the account button, which `app-shell.tsx` renders only
once `identity.me` resolves — the same fact the nav filter waits on.
`auth.setup`'s `waitForURL` went from 15s to 45s.

## What was found while building it

**`networkidle` is the wrong signal for this shell.** It is a guess about the
network where a statement about the component was available. The shell polls
`dashboard.notifications` on an interval and the desk pages hold live queries,
so "quiet for 500ms" is a condition this app reaches late or not at all.

**The setup flake had a tell.** The two roles that flaked are foreman and
mechanic, which are exactly the two that land on `/my-tools` — so one of them
always paid for that route's first compile and 15s was sometimes not enough.
Read a failure there as "the redirect is wrong", not "the machine was slow".

**A `-g` filter silently skips the setup project.** A filtered run reuses stale
`.auth/*.json`, `identity.me` 401s, and the nav renders only its ungated rows —
which looks exactly like a permission bug and is not one. A round of debugging
went into that before the cause was spotted. Filter with `--project` or run the
file whole.

**Login is rate-limited to 10 attempts per 15 minutes per address**
(`apps/api/src/index.ts`, `LOGIN_LIMIT`). Each suite run signs in once per role,
so six runs in a quarter of an hour exhausts it and `auth.setup` starts failing
for whichever role goes first. The limiter is in-memory: `docker restart
stinventory-api` clears it. Worth knowing before concluding the suite is broken.

## Verified

CI is green on `main` for every job that builds or tests: typecheck · lint ·
test, migrate + boot against a real postgres, production images, and the browser
suite.

Locally the suite passes its five per-role walks but takes 24 minutes, where CI
takes under four. Pages serve in under 300ms and `identity.me` answers in 14ms
on the same machine, so the wall time is an environment artifact and **it has
not been explained**. Anyone running this locally should expect that and not
read it as a regression.

## Deliberately not done

`deploy to production` still fails, and not for any reason in this repository:
the production host runs `git fetch` against an `https://github.com` remote with
no credentials available to it —

```
fatal: could not read Username for 'https://github.com': No such device or address
```

That is fixed on the server, by pointing the checkout's remote at SSH with the
deploy key that is already being used to reach the box, or by giving it a token.
It has been failing on every run, unrelated to the browser suite it sits behind.

## Where it is

`776588d` on `main`. The deploy step means nothing new is running in production.
