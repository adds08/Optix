# Accounts get invited by email now, and email actually sends

STInventory could not send a single email. `apps/api/src/notifications.ts` read
`// Real SMTP would go here. For dev we log.`, and the only way anyone got an account was an
administrator typing or generating a password and reading it out loud — there was no invite,
no self-service reset, and `office_admin` could not touch accounts at all because the only
gate available, `config.manage`, also carried the LLM configuration and the high-value
approval threshold. This closes all three, plus the delivery loop that was marking every
notification "delivered" whether or not anything actually went out.

## What changed

### A real mail transport, as its own package

`packages/mail` (`transport.ts`, `templates.ts`) wraps `nodemailer` with the same
console-fallback shape `llmConfigFor` already established for the AI settings: no config
resolves to `sendMail` printing the message instead of sending it, so every environment
that has never touched SMTP keeps working exactly as before. Four templates —
invite, password reset, password-changed notice — ship as HTML and plain text together, with
every interpolated string run through an `esc()` HTML-escaper. Templates live in code, not a
database table: four emails that change twice a year do not earn a tenant-editable store, a
preview screen and an HTML-injection review.

It is its own package because it has real consumers on both sides of the process boundary —
`packages/api-contracts` (the invite/resend mutations, the SMTP test-send) and `apps/api`
(the unauthenticated auth endpoints, the notification delivery loop) — the same reason
`packages/intent` is a package and not folded into either caller.

### Tenant-configurable SMTP, with an env fallback

`tenant_settings` gained `smtp_host/port/user/pass_enc/pass_hint/from` plus
`smtp_last_check_{at,ok,error}` — same shape as the existing `llm_*` columns, same encryption
(AES-256-GCM via `encryptSecret`, never returned to a browser). `mailConfigFor`
(`packages/api-contracts/src/mail-config.ts`) resolves a tenant's own row if it has a host set,
outright — no per-field merge with the environment — and falls back to the `SMTP_*` env vars
(resolved once at boot in `apps/api/src/index.ts` as `mailFallback`, threaded through the tRPC
`Context` the same way `sessionSecret` already is) otherwise. Settings → Notifications is a
real page now: host/port/from/user/password fields, and a **Send test email** button
(`settings.testEmail`) that sends to a real inbox and records whether it worked — the same
"pasting a value and being told 'saved' proves nothing" reasoning `testLlm` was already built
on.

### Invite and self-service reset

`auth_token` (migration `0025`) stores a SHA-256 hash of a 256-bit random token, never the
plaintext, with a `kind` (`invite` | `reset`), an expiry and a `consumedAt`. Token generation
and hashing live in `packages/auth/src/tokens.ts`; `createSession` was extracted out of
`login()` so the consume endpoint signs the caller in the identical way a fresh login does.

- `user.invite` (tRPC, `user.manage`) creates the account `isActive: false` with an unusable
  random password hash, mails an invite link, and returns whether the email actually sent.
  `isActive: false` costs nothing new — `login()`'s existing "inactive" refusal already stops
  anyone signing into a dormant row, so no new gate was needed, only a state this codebase
  could already represent.
- `user.resendInvite` supersedes every earlier unconsumed invite for that user before issuing
  a fresh one, so a forwarded or stale link stops working the moment a new one is sent.
- Three unauthenticated Hono routes sit next to `/auth/login`, not behind tRPC's
  `publicProcedure`, because they need the same per-IP `rateLimit()` login already uses and
  the consume endpoint needs to hand back a session in login's exact shape:
  `POST /auth/forgot-password` (always answers `{ ok: true }`, matching STI-305's
  enumeration-refusal reasoning — an existing account, a nonexistent one and an ambiguous one
  are indistinguishable to the caller), `GET /auth/tokens/:token` (what the accept/reset pages
  show before asking for a password), `POST /auth/tokens/:token/consume` (sets the password,
  activates an invite, revokes old sessions, signs the caller in).
- Three new pages outside `(app)`: `/forgot-password`, `/invite/[token]`, `/reset/[token]`
  (the latter two share `AuthTokenForm`, `apps/web/components/auth-token-form.tsx`). They call
  `apps/api` directly through `lib/auth.ts`, the same way the login form does — there is no
  session yet for a `protectedProcedure` to check. A "Forgot password?" link was added next to
  the password field on `/`.
- `UserForm` (the "New user" dialog on `/admin/users`) now calls `user.invite` instead of
  `user.create` — there is no direct signup in this product, so the only screen that creates
  an account only ever sends a link. `user.create` itself was NOT deleted: `user-admin.test.ts`
  still uses it as a fast, no-email way to seed a fully active test account, and it is the
  fallback when SMTP is not configured on a server at all. It is exempted from the reachability
  test with that reasoning rather than deleted.

### `user.manage`, split from `config.manage`

New permission, granted to `owner`/`equipment_admin` (already implied by their
`[...PERMISSIONS]` spread) and explicitly to `office_admin` — the split
`docs/workings/PERMISSION_MATRIX.md` §5 decision 4 had been waiting on since 2026-08-22.
Every administrative procedure in `routers/user.ts` (`list`, `roles`, `create`, `invite`,
`resendInvite`, `setRole`, `setActive`, `resetPassword`) moved off `config.manage` onto it;
`config.manage` kept the LLM/SMTP configuration and the high-value threshold, exactly as the
matrix's reasoning said it should stay separate. Migration `0025` also back-grants
`user.manage` to the three roles on an existing database — without it, deploying this drops
every current administrator, owner included, out of `/admin/users` the moment the API
restarts, the same failure shape migration `0020`'s header comment describes for the
visibility ladder. `/admin/users`'s nav entry and permission check moved to `user.manage`;
`/admin/roles` and general/AI Settings stay on `config.manage`.

### Notification delivery gets a failure record and a bounded retry

`notification` gained `delivery_attempts`, `delivery_error`, `last_attempt_at` (migration
`0026`). `deliverPendingNotifications` now actually calls `sendMail` through `mailConfigFor`
for a recipient with an email on file and `emailEnabled` set, instead of unconditionally
stamping every row `deliveredAt` regardless of whether anything was sent. Failures increment
`delivery_attempts` and record the provider's own error text; a channel that is off, or a
recipient with no email, is marked delivered immediately rather than retried, because retrying
something that can never succeed is pure noise. Capped at five attempts so a relay that is
down forever does not retry forever. `deliveredAt` is read by no router or screen — verified —
so none of this can make an in-app alert disappear from the desk; it only changes whether the
email copy goes anywhere.

## What was found while building it

- **Two `.claude/rules/api-server.md` claims had already gone stale before this work started.**
  It still described `mountRestRoutes` running before the tRPC handler and intercepting every
  request — that surface was deleted 2026-08-18 (STI-116) and the comment explaining its
  removal is sitting right there in `src/index.ts`. It also said `SMTP_PORT/USER/PASS/FROM`
  were "read by nothing." Both corrected in place along with the login-rate-limit note, which
  now names the two new endpoints' limits.
- **The tenant-predicate scanner is a naive text scan, and a semicolon inside a code comment
  broke it.** `tenant-predicate.test.ts` flagged the token-consume endpoint's `user` update as
  missing a tenant predicate even after one was added — the scanner reads from a matched
  `.update(...)` to the next literal `;`, and a rationale comment two lines up ("...know the old
  mailbox; reactivating is...") ended the scan early. Rewording the comment to avoid the
  semicolon was the fix, not touching the test.
- **`user.manage` had already been drafted and explicitly rejected once.**
  `docs/workings/PERMISSION_MATRIX.md` proposed this exact split in its original table, then
  a footnote said it "does not exist in the codebase" and recorded the default as *not*
  splitting it. That footnote and the corresponding row in the answer sheet are now updated to
  say what shipped and why it went the other way from the recorded default.
- **`packages/auth` cannot import `packages/db`'s seed helpers and vice versa** — `auth`
  already depends on `db` for schema types, so having `seed.ts` import `generateAuthToken`/
  `hashAuthToken` from `@stinventory/auth` would be circular. The seed reproduces the token
  hash inline (four lines) rather than restructuring either package for one caller.

## Verified

- `pnpm typecheck` clean on `packages/mail`, `packages/auth`, `packages/types`, `packages/db`,
  `packages/api-contracts`, `apps/api`, `apps/web`.
- `pnpm test` — 245/245 in `packages/api-contracts` (including the tenant-predicate scan and
  the reachability sweep), all green in `packages/mail`, `packages/auth`, `apps/api`.
- Migrations `0025`/`0026` applied to the dev database; confirmed `auth_token`'s shape and the
  `user.manage` grants to `owner`/`equipment_admin`/`office_admin` by direct query.
- Full manual run against the live API: seeded invite token → `GET /auth/tokens/:token` →
  `POST .../consume` → login with the new password succeeds → re-consuming the same token is
  refused as `invalid_or_expired`. Same sequence for `/auth/forgot-password` → reset consume →
  password-changed notice fires. Both nonexistent and existing addresses get the identical
  `{ ok: true }` from forgot-password. Console-fallback transport prints a fully rendered
  email (subject, HTML markers stripped in the text version, correct link) when no SMTP is
  configured, confirming the no-op path a fresh stack relies on.
- Reseeded (`SEED_RESET=1`) after manual testing to restore clean demo data — the manual run
  above had activated the seeded pending-invite account and changed the seeded foreman's
  password.

Not verified: an actual SMTP relay (only the console fallback was exercised — no server in
this environment has real credentials to test against), and the mobile app (the invite/reset
work is web + API only; nothing in `apps/mobile` calls any of it).

## Deliberately not done

- **SMS stays a placeholder.** `tenantSettings.smsEnabled` still toggles nothing; no Twilio
  integration was added. Explicit product decision, not an oversight.
- **Redis for the new endpoints' rate limits.** The in-memory limiter is a real, stated
  weakness, but the production compose file has no `deploy:`/`replicas:` — the API cannot be
  scaled past one instance today, so there is nothing for Redis to fix yet. `/auth/forgot-password`
  and `/auth/tokens/:token/consume` reuse the existing `rateLimit()` helper with their own
  numbers instead.
- **Phase 4 (Foundation entity load) remains parked**, per prior agreement — untouched by this
  work.
- **Invite/reset email templates are not tenant-editable.** Four emails that change twice a
  year do not justify a database-backed template store and its own injection-review surface.

## Where it is

Uncommitted in the working tree at the time of writing — not yet on a branch or pushed.
