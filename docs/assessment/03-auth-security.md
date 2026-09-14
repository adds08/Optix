# Technical Assessment — Auth & Security Layer

**Date:** 2026-09-12
**Scope:** `packages/auth` (407 lines), the auth routes in `apps/api/src/index.ts`, session transport and client-side storage
**Method:** full read of `packages/auth/src/*`, auth route read, live session-table queries
**Verdict:** **Sound, with one architectural trade-off worth stating explicitly** (finding 1). The cryptographic choices are correct and, unusually, each one is justified in a comment.


> ⚠ **DATED SNAPSHOT — 2026-09-12, not current state.** See
> [00-summary.md](00-summary.md) for the full list of what has changed since.
> Re-check against code before acting: this predates the 2026-09-14 work (the `@optix/*` rename, 23 CHECK constraints, and `packages/auth/src/secrets.ts`'s salt becoming `optix:secret:v2`).

---

## Summary table

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Bearer token in `localStorage` — XSS-readable | MEDIUM (accepted trade-off) | CONFIRMED |
| 2 | `resolveSession` issues 3 queries per request | LOW | CONFIRMED |
| 3 | No expired-session sweeper | LOW | CONFIRMED, currently harmless |
| 4 | `SESSION_SECRET` rotation silently voids stored secrets | LOW | CONFIRMED, documented in code |
| — | Password hashing, token hashing, encryption-at-rest | — | CONFIRMED CORRECT |
| — | Session revocation on logout / reset / deactivate | — | CONFIRMED CORRECT |
| — | Login rate limiting, no enumeration oracle | — | CONFIRMED CORRECT |

---

## What is verifiably correct

**Password hashing** (`packages/auth/src/index.ts:13-37`). bcrypt, with a
`needsRehash` path that upgrades the cost factor on next successful login and
leaves non-bcrypt values alone rather than guessing. The comment states the
reasoning: cost is a deliberate slowdown and hardware gets faster.

**Token hashing** (`packages/auth/src/tokens.ts:18-29`). SHA-256, **not** bcrypt,
for invite and reset tokens — and the code explains why: the token is 256 bits
of `randomBytes`, not a human-chosen password, so it is not dictionary-attackable,
and bcrypt would add cost to every consume request for no security gain. This is
the correct call and most codebases get it wrong in the other direction.

**Secret encryption at rest** (`packages/auth/src/secrets.ts`). AES-256-GCM with
a 96-bit IV, a `v1.` version prefix so the format can evolve, an auth tag for
tamper detection, and a key derived via `scryptSync`. `decryptSecret` returns
`null` on any failure — wrong key, malformed, tampered — so the failure mode is
"the key needs re-entering" rather than a crash. `secretHint` masks values of 8
characters or fewer entirely instead of revealing most of a short key.

The file states its own limits: *"Not a substitute for a real KMS. If this ever
holds something worth more than an inference key, move it."* That is an accurate
boundary.

**Session resolution** (`packages/auth/src/index.ts:198-225`). On **every**
request it re-checks:
- the session row exists and `expiresAt > now()`
- the user still exists and `isActive` is true
- permissions, loaded fresh from `user_role → role_permission`

Consequence: deactivating a user or changing their role takes effect on the very
next request. There is no stale-permission window, which is the usual failure of
token-embedded claims. Correct.

**Session revocation.** Verified at four sites:
- `packages/auth/src/index.ts:170` — logout
- `packages/api-contracts/src/routers/user.ts:784` — admin deactivate, tenant-scoped
- `packages/api-contracts/src/routers/user.ts:833` — admin password reset
- `apps/api/src/index.ts:336` — reset-token consume

Password reset revokes existing sessions, which is the behaviour that matters
after a credential compromise.

**Login hardening** (`apps/api/src/index.ts:69-79`). Rate limited at 10 attempts
per 15 minutes, keyed on `login:<ip>:<email>`, returning 429 with `Retry-After`.
Critically, the failure response does **not** reveal whether the account exists —
no enumeration oracle. Failed attempts are written to `tbl_ops_event_log` with
category `auth`, result `failure`, and the request's source.

**Live state:** 0 sessions in the table, 0 expired. Nothing accumulating.

---

## Finding 1 — Bearer token in `localStorage` (MEDIUM, accepted trade-off)

**CONFIRMED.** The session token is a 32-byte hex string transported as
`Authorization: Bearer <token>` (`apps/api/src/index.ts:396`) and stored
client-side in `localStorage` under the key `sti-session`
(`apps/web/lib/auth.ts:12-26`). There are no cookies anywhere in the API — the
grep for `httpOnly`, `sameSite`, `secure:` and `Set-Cookie` returns nothing.

**Why it is this way.** One auth mechanism serves both the Next.js web app and
the Expo mobile app. React Native has no cookie jar in the browser sense, so a
bearer token is the path of least resistance and avoids two divergent auth
implementations. That is a legitimate engineering reason.

**What it costs.** `localStorage` is readable by any JavaScript running on the
origin. An `httpOnly` cookie is not. So:

- **Any XSS becomes full session theft.** With `httpOnly`, an XSS can act as the
  user but cannot exfiltrate a token for later offline use. Here it can.
- The token is valid for **7 days** (`SESSION_TTL_MS`), so a stolen token is
  usable for up to a week unless the user logs out or an admin intervenes.
- No `SameSite` protection, though this matters less for bearer tokens than for
  cookies, since CSRF is not the exposure — bearer auth is inherently CSRF-safe.

**Assessment.** This is a **conscious trade-off, not an oversight**, and the
mitigations that matter are already in place: sessions are revocable and
revocation is immediate, `isActive` is re-checked per request, and resets kill
existing sessions. The realistic exposure is XSS, and the defence against XSS is
XSS prevention — which belongs to the web layer assessment, not here.

**Recommendation.** Do not rewrite this before launch. Record it as a known and
accepted position. If it is revisited later, the shape is: `httpOnly` +
`Secure` + `SameSite=Lax` cookie for web, bearer retained for mobile, with one
shared `resolveSession` reading from either. That is a day or two of work and it
is not the highest-value day or two currently available.

---

## Finding 2 — `resolveSession` issues 3 queries per request (LOW)

**CONFIRMED.** Every authenticated request runs:

1. `session.findFirst` — the session row
2. `user.findFirst` — the user row
3. a 3-table join across `user_role → role_permission → role` — the permission set

So the permission set is rebuilt from scratch on every single call. With 86 tRPC
procedures and a UI that fires several queries per screen, this is the hottest
path in the system.

**Consequence.** Three round-trips of fixed overhead on every request. At
Urban's scale (45 active employees, 15 users) this is invisible and not worth
touching. It is recorded because it is the first thing that will bite under
load, and because the fix is not free — any cache must be invalidated the moment
a role changes, and the current design's chief virtue is that **it cannot serve
stale permissions** (see finding above). Caching would trade that away.

**Recommendation.** No action. Revisit only if a real latency problem is
measured, and prefer a short-TTL cache with explicit invalidation on role write
over anything token-embedded.

---

## Finding 3 — No expired-session sweeper (LOW)

**CONFIRMED.** Expired sessions are never deleted in bulk. `resolveSession`
correctly refuses them (`gt(expiresAt, now())`), so an expired row is harmless —
it simply sits in the table forever.

Live count: **0 expired, 0 total.** Nothing is accumulating today.

**Consequence.** Unbounded slow growth of `tbl_entity_session` over months or
years. Not a security issue — the rows are inert — purely housekeeping.

**Recommendation.** Add a delete to the existing notification sweeper
(`apps/api/src/index.ts:570`, runs every 60s) — a one-line `DELETE FROM
tbl_entity_session WHERE expires_at < now()`. Trivial, but genuinely low
priority.

---

## Finding 4 — `SESSION_SECRET` rotation voids stored secrets (LOW)

**CONFIRMED and documented in code.** The AES key for stored third-party secrets
is derived from `SESSION_SECRET` rather than being a separate managed key
(`packages/auth/src/secrets.ts:29-32`). The comment is explicit about the trade:
one fewer secret to manage, at the cost that rotating `SESSION_SECRET` makes
every stored ciphertext unreadable.

`decryptSecret` returns `null` in that case, which surfaces as "the key needs
re-entering" rather than a crash — a good failure mode.

**Consequence.** Rotating `SESSION_SECRET` (which also invalidates all sessions,
so it already logs everyone out) additionally requires re-entering every stored
integration credential — today, the BambooHR key and the LLM key. Recoverable,
but it will be a surprise to whoever does it unless it is written down.

**Recommendation.** No code change. Add it to the operations runbook: *rotating
`SESSION_SECRET` logs everyone out AND requires re-entering integration keys in
Settings → Integrations.*

---

## Not assessed here

- **XSS surface in the web app** — belongs to the web layer assessment, but is
  the thing that determines how much finding 1 actually costs.
- **Tenant isolation on authenticated queries** — `resolveSession` returns the
  correct `tenantId`; whether every downstream query *uses* it is an API layer
  question.
- **Transport security (TLS/HSTS)** — deployment configuration, not in this
  codebase. Should be confirmed against the production reverse proxy.

---

## Recommended actions, in order

1. **Record finding 1 as an accepted position** with the mitigations listed, so
   it is a decision on file rather than an unexamined default.
2. **Confirm TLS/HSTS at the production proxy.** Bearer tokens over plain HTTP
   would make finding 1 far worse; this is a five-minute check with a large
   downside if wrong.
3. **Add the `SESSION_SECRET` rotation note to the runbook** (finding 4).
4. **Add the expired-session delete to the existing sweeper** (finding 3) when
   next touching that file.
