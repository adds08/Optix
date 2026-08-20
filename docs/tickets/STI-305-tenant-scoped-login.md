# STI-305 — Tenant-scoped login and per-tenant unique email

**Phase:** 3 — Roles, accounts and organisation structure
**Size:** 2 units
**Status:** **DONE** — 2026-08-19. Unique index `user_tenant_email_uq` (migration `0018`);
`login()` takes an optional `tenantSlug` and **refuses** an address that is ambiguous across
tenants rather than picking a row, failing closed as `invalid_credentials` so the ambiguous
case leaks nothing. Decision recorded in `.claude/rules/api-server.md`. Production duplicate
check: `scripts/sti-305-production-preflight.sh` — **not yet run against production**, both
exit paths tested locally.
**Depends on:** nothing (coordinate with STI-303)

---

## Why this exists

`SYSTEM_PLAN.md` §6.3 lists "tenant-scoped login" as a Phase 3 task. Verified
2026-08-16 — it is worse than not-yet-built, because two defects compound.

**1. The credential lookup is tenant-blind.**
`packages/auth/src/index.ts:45`:

```ts
db.query.user.findFirst({ where: eq(schema.user.email, email) })
```

No tenant predicate. The tenant is *read off* whichever user matched (`:74`). The
HTTP route passes only `{email, password}` (`apps/api/src/index.ts:56-70`), and the
web form posts the same (`apps/web/app/page.tsx:45`).

**2. `user.email` is not unique.**
`packages/db/src/schema/identity.ts:35` — a plain index, not unique, and not unique
per tenant.

Together: the same email in two tenants resolves to **whichever row Postgres happens
to return first**. A user could authenticate into the wrong tenant, and which one is
not deterministic.

## The mitigating fact, stated honestly

Sessions do carry `tenantId` (`identity.ts:43`), and every router scopes its queries
by `ctx.session.tenantId`. So post-login isolation holds. **Only the credential
lookup is tenant-blind** — and today there is exactly one tenant, so this is a latent
defect rather than an active breach.

That is why it is 2 units and not an emergency. It is also why it must be fixed
before a second tenant exists, not after.

## Acceptance criteria

1. A unique index on `(tenant_id, email)` on `user`, declared in the Drizzle schema
   so `drizzle-kit generate` emits it.
2. **Check for existing duplicates before applying**, in local *and* production:
   `select tenant_id, email, count(*) from "user" group by 1,2 having count(*)>1`
   and `select email, count(*) from "user" group by 1 having count(*)>1`.
   If any exist, stop and escalate — do not pick a survivor in a script.
3. The credential lookup carries a tenant predicate.
4. A decision, recorded with reasoning, on **how the tenant is determined at login**.
   The realistic options are subdomain, an explicit field on the form, or an email→
   tenant lookup table. This is the actual design content of the ticket; the index is
   the easy half. Note that adding a visible tenant field to the login form is a
   product change and should be confirmed rather than assumed.
5. A failed login does not reveal whether the email exists in another tenant.
6. Tests: same email in two tenants authenticates deterministically into the correct
   one, and the wrong password fails in both.
7. The three seeded accounts still log in — `packages/db/src/seed-data.ts:2485`.
   Verify in a browser, not only in tests.

## Files

- `packages/auth/src/index.ts:45,74` — the lookup
- `packages/db/src/schema/identity.ts:35,43` — the email index and the session
- `apps/api/src/index.ts:56-70` — the login route
- `apps/web/app/page.tsx:45` — the login form
