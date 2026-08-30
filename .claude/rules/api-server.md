---
paths:
  - "apps/api/**"
---

# The API process

Hono + tRPC on Node 22, port 4100. **One process is also all three background workers** —
there is no separate scheduler service.

## Boot order matters

`src/index.ts`: env (Zod, throws on invalid) → logger → db → mail fallback resolved from
`SMTP_*` → Hono → `honoLogger` → `cors` → `/health` → `/auth/login` →
`/auth/forgot-password` → `/auth/tokens/:token` (+ `/consume`) → photo routes →
`/auth/logout` → `/trpc/*` → `serve` → three `setInterval` loops.

There is no `mountRestRoutes` and no `/api/*` surface — removed 2026-08-18 (STI-116), see
the "traps" table in the root CLAUDE.md and the comment left in its place in `src/index.ts`.
If a doc anywhere still describes it as live, that doc is wrong; the code is the truth. tRPC
resolves its own session in `createContext` and always did — there is only one auth check
per request now, not two.

`/auth/forgot-password` and `/auth/tokens/:token[/consume]` (added with the invite/reset
work) are unauthenticated for the same reason `/auth/login` is: reachability, not
cryptography, is the point of a password-recovery flow. They sit next to login rather than
behind tRPC's `publicProcedure` because they need the same per-IP `rateLimit()` login
already uses, and because the token consume endpoint needs to hand back a session the same
shape login's does.

## The three workers

| Worker | Interval | Does |
|---|---|---|
| notification scheduler | 60s | delivers pending notifications by email (real send now — the invite/reset build, see `apps/api/src/notifications.ts`), bounded to `MAX_DELIVERY_ATTEMPTS` retries with the failure recorded on the row. ~~overdue loans~~ — Removed 2026-08-09 with the borrow model: `assignment.expected_end_date` was DROPPED in migration `0012`, `isOverdueLoan` was deleted from `packages/domain`, and no `dashboard.overdueLoans` procedure exists. **Nothing falls due, so nothing goes overdue.** Verified 2026-08-22. |
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
  `X-Forwarded-For`. Single-instance only, and trivially rotated around. `/auth/forgot-password`
  (5/15min per IP+email) and `/auth/tokens/:token/consume` (20/15min per IP+token-prefix) reuse
  the same `rateLimit()` helper with their own numbers — see the comment above them for why
  Redis is deliberately not the fix here (there is no `deploy:`/`replicas:` in
  `docker-compose.prod.yml`; the API cannot be scaled past one instance today).
- CORS reflects whatever `Origin` the caller sends, with `credentials: true` — `WEB_ORIGIN` is
  only the fallback for origin-less requests. Don't rely on it as an origin restriction.

## Env

`packages/env/src/server.ts` parses once, freezes, and runs `assertProductionSafe` (refuses to
boot production with the example secret, a low-variety secret, or a plain-http non-localhost
`WEB_ORIGIN`).

**`SMTP_*` is real now (the invite/reset build, 2026-08-24) — this section used to say
"read by nothing", and that was true until then.** All five vars are read, resolved once
into a `MailConfig | null` (`mailFallback` in `src/index.ts`) and passed into the tRPC
context and the auth endpoints the same way `sessionSecret` is. `mailConfigFor`
(`packages/api-contracts/src/mail-config.ts`) prefers a tenant's own `tenant_settings` SMTP
row over this fallback, outright — no per-field merge. `sendMail` (`@stinventory/mail`)
still logs to console rather than sending when the resolved config is `null`, which is now
the "nobody has configured mail yet" case rather than the only case. `TWILIO_*` is still
read by nothing — SMS stays a placeholder toggle, deliberately, until it is actually built.
`MOBILE_ORIGIN` is still unread. `LOG_LEVEL` is still read directly by the logger and is
still absent from the schema.
