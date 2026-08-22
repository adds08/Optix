---
paths:
  - "apps/api/**"
---

# The API process

Hono + tRPC on Node 22, port 4100. **One process is also all three background workers** —
there is no separate scheduler service.

## Boot order matters

`src/index.ts`: env (Zod, throws on invalid) → logger → db → Hono → `honoLogger` → `cors` →
`/health` → `/auth/login` → photo routes → `/auth/logout` → `mountRestRoutes` → `/trpc/*` →
`serve` → three `setInterval` loops.

`mountRestRoutes` is registered **before** the tRPC handler and installs a blanket
`use("*")` bearer-auth middleware, so it also intercepts `/trpc/*`. Verified: an
unauthenticated tRPC call returns a bare `{"error":"Unauthorized"}` rather than a tRPC
`UNAUTHORIZED` envelope, and every authenticated call resolves the session twice. Keep the
ordering in mind before moving these lines.

## The three workers

| Worker | Interval | Does |
|---|---|---|
| notification scheduler | 60s | overdue loans, rentals due, "delivery" |
| messaging worker | 4s | claims ≤5 queued chat messages, parses, proposes |
| request sweeper | 60s | requeues failed, unsticks `processing` >5min, escalates |

**All three are single-instance by construction.** The message worker claims with a `SELECT`
then a separate `UPDATE` — no `FOR UPDATE SKIP LOCKED`, so two instances double-claim. All
three callbacks are `async` with no in-flight flag, so a scan slower than its interval
overlaps itself. If you scale past one instance, this is the first thing that breaks.

## Auth facts

- **No cookies anywhere.** Login returns a 64-hex random session id as plain JSON; clients
  send it as `Authorization: Bearer`. 7-day TTL, DB lookup per request, dies immediately if
  the user is deactivated.
- `SESSION_SECRET` does **not** sign sessions. It derives (scrypt) the AES-256-GCM key that
  encrypts tenant LLM keys. Changing it makes every stored key undecryptable.
- bcrypt cost 12 with transparent rehash on login.
- **The credential lookup is tenant-scoped, and refuses to guess (STI-305).** It used to be
  `where email = ?` with no tenant predicate, and the session's tenant was read off whichever
  row matched; `user.email` was a plain index, so the same address could exist twice and
  Postgres returned whichever row it liked — a user could authenticate into the **wrong
  tenant, non-deterministically**. Two things changed:
  - `user_tenant_email_uq` on `(tenant_id, email)` (migration `0018`) closes the
    within-tenant half at the database.
  - `login()` takes an **optional** `tenantSlug`. Given, it scopes the lookup. Omitted, the
    address must identify exactly ONE account across all tenants; matching more than one is
    **refused**, not resolved. It fails closed as `invalid_credentials`, identical to an
    unknown address, so the ambiguous case cannot be used to discover that an email exists
    in another tenant.

  Nothing sends `tenantSlug` today — one tenant, and a visible tenant field on the login
  form is a product change nobody has approved. It is the hook a subdomain or a form field
  would use. **Do not "helpfully" make an ambiguous login pick the first row.** That is the
  defect, not a convenience.
- Login rate limit is 10/15min per IP+email, **in memory**, keyed off a client-supplied
  `X-Forwarded-For`. Single-instance only, and trivially rotated around. It is the only rate
  limit in the system.
- CORS reflects whatever `Origin` the caller sends, with `credentials: true` — `WEB_ORIGIN` is
  only the fallback for origin-less requests. Don't rely on it as an origin restriction.

## `src/rest-routes.ts` is dead code — do not extend it

A parallel set of routes under `/api/*` duplicating tRPC procedures. Per ADR-2 the tRPC
routers win.

It authenticates and then stops: **no permission checks at all**. Verified live — a
`warehouse` user holding only `employee.read` gets `403` from tRPC `employee.create` and `200`
from `POST /api/employees`. It also mass-assigns (`{...body}` spread into the insert, so
client-chosen `id` and arbitrary columns land), bypasses `custody.ts`, writes no `transaction`
rows, and emits a transfer status that is not in `TRANSFER_STATUSES`.

Its only client was `packages/frontend-shared`, since deleted, and `docker/Caddyfile`
does not route `/api/*` in production. **The correct change is deletion, not repair.** If you
must keep it, it needs `requirePerm` on every route and Zod on every body.

## Env

`packages/env/src/server.ts` parses once, freezes, and runs `assertProductionSafe` (refuses to
boot production with the example secret, a low-variety secret, or a plain-http non-localhost
`WEB_ORIGIN`).

Declared but **read by nothing**: `SMTP_PORT/USER/PASS/FROM`, all three `TWILIO_*`,
`MOBILE_ORIGIN`. Only `SMTP_HOST` is read, and only to choose a `console.log` prefix — the
notification "providers" are two log lines and every notification is marked delivered
regardless. `LOG_LEVEL` is read directly by the logger and is absent from the schema.
