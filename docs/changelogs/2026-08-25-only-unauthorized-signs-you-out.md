# Only an UNAUTHORIZED signs you out

`AppShell` treated every `identity.me` failure as proof that the session was
gone: `me.isError` → `clearSession()` → back to `/`. The query was declared
`retry: false`, so exactly one failed request was enough. A dropped wifi hop, a
500, a request that timed out on site — any of these deleted a perfectly valid
credential and sent someone to the login form to fix a problem that had nothing
to do with their password.

This was found while fixing the cached-error login loop
(`2026-08-25-login-loop-cached-error.md`) and deliberately left out of that
change, because it is a behaviour change on every route inside the shell rather
than part of the loop. It is not what caused the loop.

## What changed

### The failure modes are separated

`identity.me` now distinguishes two things the old code conflated:

- **`UNAUTHORIZED`** — the session really is gone: expired, revoked, or the
  user deactivated mid-session. Retrying cannot help. This, and only this,
  clears stored credentials and redirects to `/`.
- **Everything else** — unreachable API, 500, timeout. The credential is fine
  and is left untouched.

The distinction is `me.error.data?.code === "UNAUTHORIZED"`, verified against a
real response rather than assumed: the API returns
`{"error":{"json":{"data":{"code":"UNAUTHORIZED","httpStatus":401,…}}}}` from the
`protectedProcedure` gate in `packages/api-contracts/src/trpc.ts`. A network
failure has no response body and therefore no `data`, so it cannot be mistaken
for one — that is structural, not a heuristic.

### Retry policy follows from that

`retry: false` is replaced by a predicate: never retry an `UNAUTHORIZED`,
because it will not get better; retry anything else a couple of times, because
it might. A brief blip now recovers without the user seeing anything.

### A wall instead of a sign-out

When the retries are spent and the failure was not an auth failure, the shell
renders a "cannot reach the server" panel with a Try again button, saying
plainly that the caller is still signed in. It borrows the visual language of
`(app)/error.tsx` on purpose — to the person looking at it this is the same kind
of event, and it should not look like a different product.

The shell cannot render behind that panel: without `me.data` there are no
permissions, so the navigation would come out empty and every panel inside it
would be failing too. A frame with no navigation is a worse answer than an
honest wall.

## What was found while building it

- **The first design would have been wrong.** The plan was to gate on the tRPC
  error code, which is right — but the *loop* bug's 401 was a genuine
  `UNAUTHORIZED`, so this gate would not have fixed it. The two problems needed
  two different fixes, and treating them as one would have shipped a change that
  looked like a fix and left the loop running. They are separate commits for
  that reason.

- **There was no existing idiom for reading a tRPC error code in `apps/web`.**
  Nothing in the app inspected `error.data?.code` anywhere; every query either
  ignored failure or set `retry: false`. This establishes the pattern, which is
  why the rule in `.claude/rules/web.md` now states it explicitly rather than
  leaving the next person to invent a second one.

- **`retry: false` appears on other queries too** — `project-switcher.tsx` and
  `job-scope.tsx`. Those do not destroy credentials, so they are not urgent, but
  they will each swallow a transient failure permanently. Not touched here.

## Verified

- `pnpm typecheck` — 14 tasks successful. This is what confirms
  `error.data?.code` is genuinely typed on the query's error rather than an
  `any` that happens to work.
- `make ENV=local test` — 247 passed in `api-contracts` with **0 skipped**, and
  green across `domain`, `types`, `intent`, `auth`, `mail`, `api`. Run in the
  container: `pnpm test` on the host silently skips the DB-backed suites.
- The `UNAUTHORIZED` envelope was read off the running API with a dead bearer
  token, and matches the string the new branch compares against.
- `/` and `/home` both compile and serve 200.

**Not verified: neither branch has been exercised through a browser.** Nothing
here has been seen to render — not the redirect, not the wall. Confirming the
wall means signing in, stopping the API, and reloading; confirming the redirect
means deleting the session row and reloading. No browser tooling was available
in the session that wrote this.

Unrelated to the change: the local `.next` turbopack cache corrupted when the
containers were torn down by the test target and had to be deleted before the
web container would serve. If a route 000s locally after a `make test`, that is
the cause.

## Deliberately not done

- **No regression test.** `apps/web` still has no test harness at all — the same
  gap the previous entry records. Both branches of this change are exactly what
  a component test should cover, which strengthens the case for adding one.
- **`retry: false` left in place elsewhere** (`project-switcher.tsx`,
  `job-scope.tsx`). Same class of defect, no credential consequences, separate
  change.
- **The wall does not distinguish "offline" from "server is down".**
  `navigator.onLine` would let it say which, and it is not worth a branch until
  someone asks.

## Where it is

Committed on `development`, following `40a396a`. Not pushed and not deployed —
and production remains four commits behind `main` independently of this.
