# A new session starts with an empty query cache

Signing in on production put people back on the sign-in screen. The report was
"the app is not logging in", and every layer said it was fine: `POST /auth/login`
answered `200`, the session rows were in the database, unexpired, belonging to
active users. The login endpoint was never the problem. The session was being
destroyed about a second after it was created, by the app itself.

## What changed

### `queryClient.clear()` at the two points a session begins

`apps/web/app/page.tsx` (the login form) and
`apps/web/components/auth-token-form.tsx` (invite accept and password reset) now
clear the React Query cache immediately after `setSession()`, before navigating
to `/home`.

`Providers` builds the QueryClient in the **root** layout, so it spans both the
unauthenticated `/` and the `(app)` group and survives the client-side
navigation between them. It therefore also survives a failed sign-in, holding
React Query's cached **error** for `identity.me` under that query key.

That made sign-in self-defeating. Once `identity.me` had failed once:

1. `AppShell` remounts on the next sign-in and mounts `identity.me` against the
   same QueryClient, which reports `isError: true` straight from cache on the
   first render — before any request is dispatched.
2. The error effect in `app-shell.tsx` runs and calls `clearSession()`,
   deleting the token the login form had just stored.
3. The tRPC batch then dispatches. `headers()` reads an empty `localStorage`,
   so the request goes out with **no `Authorization` header at all**.
4. `protectedProcedure` rejects it, the effect fires again, and the user is
   returned to `/` to repeat the whole thing.

Clearing the cache when a session begins also stops one person's cached rows
being served to the next person who signs in on the same browser.

## What was found while building it

- **The decisive evidence was a response time, not an error message.** The
  rejected batches came back `401` in **26 microseconds**. `resolveSession`
  returns `null` on its first line when the token is absent, so a 401 that fast
  proves no database lookup ran — the request carried no token. A merely
  *invalid* token would have cost a query. Nothing but a `clearSession()` that
  had already run explains an absent header moments after a successful
  `setSession()`.

- **The first fix considered would not have worked.** The intended change was to
  gate the error effect on a tRPC `UNAUTHORIZED` code rather than on any error.
  That 401 *is* a genuine `UNAUTHORIZED`, so the gate would have changed
  nothing. Reading the code before writing it is what caught this.

- **The loop is self-sustaining but not permanent.** A hard reload builds a
  fresh QueryClient with an empty cache, so the next sign-in succeeds. That is
  why it presented as intermittent, and why "clear site data and try once" was a
  working workaround. Production shows twelve consecutive failed cycles at
  14:47–14:48 UTC on 2026-08-24 and a clean success at 16:59 after the tab had
  been left alone.

- **`app-shell.tsx` still calls `clearSession()` on any `identity.me` error**,
  including a network blip or a 500. That destroys a valid credential for a
  reason that has nothing to do with the credential. It is not what caused this
  bug and it is not fixed here — see below.

- **Production is behind `main`.** The droplet is at `43fe1f0`; `origin/main` is
  at `b9c5932`. Migrations `0025`/`0026` have not run there, so production has
  no `auth_token` table and nobody holds the `user.manage` grant — the invite
  flow is not live. The containers restarted about sixteen hours before this was
  written, so a deploy did run and landed on the older commit. Worth checking
  why CI did not carry the newer ones.

## Verified

- `pnpm typecheck` — 14 tasks successful.
- `make ENV=local test` — **247 passed, 0 skipped**, including the DB-backed
  auth suites (`tenant-scoped-login`, `user-admin`). Run in the api container
  deliberately: `pnpm test` on the host reports green while skipping 178 tests
  that need a database, which hides exactly the suites nearest this change.
- The login page compiles and renders (form fields present, no compile errors in
  the web container).

**Not verified: the fix has not been exercised through a browser.** The failure
is a React render-ordering bug, and reproducing or confirming it needs devtools
against a running app; no browser tooling was available in the session that wrote
this. The reasoning is grounded in the production request log and the source, not
in a reproduction. Confirm by signing in, forcing an `identity.me` failure, then
signing in again in the same tab without reloading.

## Deliberately not done

- **`apps/web` has no test harness** — no test script, no testing-library, no
  test files anywhere in the app. Adding one to cover this would mean
  introducing vitest, jsdom and testing-library to the package, plus the
  `docker/Dockerfile.dev` COPY line and the anonymous volume in
  `docker-compose.yml` that every new dependency here needs. That is its own
  change with its own review, so this fix ships without a regression test. The
  gap is real and this behaviour is now the argument for closing it.
- **The unconditional `clearSession()` in `app-shell.tsx` is left alone.**
  Fixing it is correct and separate: it wants the error effect to distinguish
  "this session is dead" from "one request failed", which is a behaviour change
  to every route in the shell.
- **Nothing was deployed.** No migration, no schema change, no contract change —
  this is client-side React only.

## Where it is

Uncommitted on `development`, in `apps/web/app/page.tsx` and
`apps/web/components/auth-token-form.tsx`. Not committed, not pushed, not
deployed — and production is four commits behind `main` independently of this.
