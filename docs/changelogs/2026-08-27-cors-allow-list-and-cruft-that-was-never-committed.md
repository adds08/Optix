# The API stops answering every origin, and a cleanup ticket turns out to be about one laptop

Two S1 stories off the Release 2 plan, taken because they were the cheapest things
standing between the branch and a deployable sprint: STI-1601, which is the only
security item the plan front-loads, and STI-1103, which deletes three empty
directories.

Both turned out to be described slightly wrongly by their own tickets, in ways that
only showed up by running the thing rather than reading it. Neither correction changes
what was built; both are written down here and in the plan, because a ticket that
describes a mechanism incorrectly is exactly what CLAUDE.md rule 9 is about.

## What changed

### The CORS allow-list is a list

`apps/api/src/index.ts` mounted `cors({ origin: (origin) => origin ?? env.WEB_ORIGIN,
credentials: true })`. That is not an allow-list. It hands the caller's own `Origin`
header straight back as `Access-Control-Allow-Origin`, so every origin on the internet
was allowed, next to a `credentials: true` that says somebody intended cookies.

`apps/api/src/cors.ts` now holds `allowedOrigins(env)` and `corsOptions(env)`, and
`index.ts` mounts it in one line. It is a separate module for a specific reason:
`index.ts` opens a database connection and calls `serve()` at import, so no test can
load it. The AC asks for a test, and the options had to be reachable on their own for
that test to be possible at all.

The list is an **array**, not a function. hono resolves an array as
`list.includes(origin) ? origin : null`, and a `null` omits the header entirely —
which is precisely the acceptance criterion. A function would have had to remember to
return null rather than a string, which is the mistake being fixed.

### `MOBILE_ORIGIN` gets its first reader, eight months in

The ticket says to pin the origin to `WEB_ORIGIN`. Doing exactly that would have
broken Expo **web**, which is served from `:8081` and is a genuine cross-origin
caller. `MOBILE_ORIGIN` has been declared in `packages/env/src/server.ts`,
`.env.example` and `docker-compose.prod.yml` since the mobile client existed, and was
read by nothing. This is the first thing that reads it.

Empty values are filtered rather than passed through, and that is not defensive
tidying — production sets `MOBILE_ORIGIN: ${MOBILE_ORIGIN:-}`, an explicit empty
string satisfies `z.string()` and survives the schema default, and `[""].includes("")`
is **true**. An unfiltered empty entry would have matched every request that sends no
`Origin` header at all.

The Expo native build sends no `Origin` and is unaffected in either direction.

### Three empty directories, and the reason deleting them produced no diff

`apps/web/app/(app)/rentals/`, `apps/web/app/(app)/foremen/` and
`packages/notifications/` are gone from the working tree.

There is no diff for that, because git does not store empty directories and none of
the three was tracked. See below — this is the more interesting half of the story.

## What was found while building it

**The `?? env.WEB_ORIGIN` fallback was dead code, and the ticket describes it as
live.** STI-1601 says the fallback "only applies when no `Origin` was sent at all".
Measured against the old configuration before replacing it: with no `Origin` header,
the old stack sent **no** `Access-Control-Allow-Origin` at all, not `WEB_ORIGIN`. hono
hands the callback `c.req.header("origin") || ""`, so an absent header arrives as an
empty **string**, and `??` catches only `null` and `undefined`. The callback returned
`""`, which hono treats as falsy and omits the header for. `env.WEB_ORIGIN` never ran
in that expression.

Worth carrying forward for anyone writing the next `origin` callback: in hono the
absent case is `""`, never `undefined`. The plan and `cors.ts` both now say so.

**Every new test was run against the old configuration first.** A regression test that
also passes against the bug proves nothing. The reflect-any-origin case passes against
the old config (confirming the bug) and the no-`Origin` case fails against it — which
is how the dead-fallback finding above surfaced at all. It was not deduced from
reading `??`.

**STI-1103 was about one laptop, not the repository.** All three directories were
untracked. `rentals/` and `foremen/` were real routes whose `page.tsx` files are still
in `git log`, deleted months ago; the empty folders are what a working tree keeps after
git stops tracking what was inside them. `packages/notifications/` has **no git history
at all** — a bare `node_modules/` pnpm created, never a workspace member, never in
`pnpm-lock.yaml` despite matching the `packages/*` glob.

So a fresh clone never had the problem, and nothing stops the folders reappearing in
the next working tree that deletes a route. `git status` cannot see this class of
cruft and neither can a reviewer, which is why the ticket read as a repository problem.

**CORS does not stop the request — it stops the attacker's page reading the answer.**
A `POST /auth/login` from `evil.example.com` still returns 200 server-side; it is
harmless only because the attacker has no credentials to send. That distinction is
recorded against STI-1602, because the moment the session becomes a cookie the browser
attaches it automatically and this allow-list becomes the whole defence.

## Verified

Against the running Docker stack, not deduced from source.

- The web origin and the mobile origin are echoed back in
  `Access-Control-Allow-Origin`. `https://evil.example.com` gets
  `Access-Control-Allow-Credentials` and no `Access-Control-Allow-Origin`, on a plain
  GET and on a preflight carrying `Access-Control-Request-Method`. A request with no
  `Origin` header gets none either.
- A real `POST /auth/login` from `http://localhost:3100` returns 200 with the header,
  so the change is not merely refusing everything.
- `apps/api/src/cors.test.ts` passes. It mounts the real `corsOptions` on a throwaway
  Hono app rather than asserting on the returned object, so what is checked is the
  header hono emits. It needs no database, so unlike `request-worker.test.ts` it runs
  everywhere, including a laptop with no `DATABASE_URL`.
- `make test` in the api container: every package passing and **nothing skipped** —
  `request-worker.test.ts` ran rather than silently skipping, which is the failure mode
  that hid the database suites before STI-1102.
- The full browser suite, five roles authenticating through a real browser against the
  API, unchanged and green. That is the "the web app still works" half of the AC, and
  the only check that exercises the real cross-origin path end to end.
- `pnpm typecheck` across the workspace and `pnpm lint` in `apps/api`, both clean —
  the first version of `cors.ts` added a `consistent-type-imports` warning, fixed
  rather than left, since `7dc2ca1` cleared the lint backlog only days ago.
- No grep hits for the removed directories outside this plan and the 2026-08-24
  changelog that first reported them.

Not verified: production. Nothing here has been deployed, and `MOBILE_ORIGIN` is empty
on the droplet, so Expo web against production would be refused — correctly, since
nothing serves it there.

## Deliberately not done

**No `Vary: Origin` on non-preflight responses.** hono sets `Vary` only on `OPTIONS`
when the origin is not `*`. With more than one allowed origin, a shared cache in front
of the API could in principle serve one origin's `Access-Control-Allow-Origin` to
another. Not fixed, because it would mean working around the middleware for a cache
that does not exist — Caddy fronts this stack without caching API responses. Worth
revisiting if that changes.

**`webEnv()` was left in place.** It is exported from `packages/env` and imported by
nothing, so `NEXT_PUBLIC_API_URL` is now its only field and also has no reader. That is
a deletion belonging to E15, not something to slip into a security fix.

**STI-1602 and STI-1603 were not started.** They are S2, and 1602 changes the mobile
client's auth path — the story itself says to scope that before starting.

## Where it is

Uncommitted on `development` on top of `402f571` at the time of writing, which is the
Optix/pins commit from earlier the same day. Not deployed.
`docs/workings/RELEASE_2_SPRINT_PLAN.md` marks both stories done, carries the
dead-fallback correction against STI-1601's mechanism, records why STI-1103 produced
no diff, and updates the epic and sprint tables. `.claude/rules/` needed no change:
neither story touches an area it covers.
