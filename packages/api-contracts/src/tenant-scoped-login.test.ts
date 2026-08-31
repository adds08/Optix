import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type Database } from "@stinventory/db";
import * as schema from "@stinventory/db/schema";
import { hashPassword, login } from "@stinventory/auth";

/*
  STI-305 — the credential lookup used to be `where email = ?` with NO tenant
  predicate, and the session's tenant was read off whichever row matched. With
  `user.email` only a plain index, the same address could exist more than once
  and Postgres returned whichever row it liked: a user could authenticate into
  the WRONG tenant, non-deterministically.

  These tests live here rather than in `packages/auth` because they need a real
  database, and `api-contracts` is where `turbo.json` passes `DATABASE_URL`
  through. `@stinventory/auth` is already a dependency of this package.
*/
const url = process.env.DATABASE_URL;
const maybe = url ? describe : describe.skip;

maybe("tenant-scoped login (STI-305)", () => {
  let db: Database;
  let tenantA: string;
  let tenantB: string;
  let slugA: string;
  let slugB: string;
  const shared = `shared-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const soloEmail = `solo-${crypto.randomUUID().slice(0, 8)}@test.local`;

  beforeAll(async () => {
    db = createDb(url!);
    slugA = `sti305a-${crypto.randomUUID().slice(0, 8)}`;
    slugB = `sti305b-${crypto.randomUUID().slice(0, 8)}`;
    const [a] = await db
      .insert(schema.tenant)
      .values({ name: "STI-305 Tenant A", slug: slugA })
      .returning({ id: schema.tenant.id });
    const [b] = await db
      .insert(schema.tenant)
      .values({ name: "STI-305 Tenant B", slug: slugB })
      .returning({ id: schema.tenant.id });
    tenantA = a!.id;
    tenantB = b!.id;

    /* The SAME address in two tenants, with DIFFERENT passwords — so a test
       that authenticated into the wrong tenant would also have to accept the
       wrong password to pass, which it cannot. */
    await db.insert(schema.user).values([
      {
        tenantId: tenantA,
        email: shared,
        passwordHash: await hashPassword("password-for-A"),
        firstName: "A",
        lastName: "User",
      },
      {
        tenantId: tenantB,
        email: shared,
        passwordHash: await hashPassword("password-for-B"),
        firstName: "B",
        lastName: "User",
      },
      {
        tenantId: tenantA,
        email: soloEmail,
        passwordHash: await hashPassword("password-solo"),
        firstName: "Solo",
        lastName: "User",
      },
    ]);
  });

  afterAll(async () => {
    for (const t of [tenantA, tenantB]) {
      if (t) await db.delete(schema.tenant).where(eq(schema.tenant.id, t));
    }
  });

  it("the database refuses a duplicate email WITHIN one tenant", async () => {
    /* The half an index can close. Before `user_tenant_email_uq` this insert
       succeeded and the login below became a coin toss. */
    await expect(
      db.insert(schema.user).values({
        tenantId: tenantA,
        email: shared,
        passwordHash: await hashPassword("another"),
        firstName: "Dup",
        lastName: "User",
      }),
    ).rejects.toThrow(/user_tenant_email_uq/);
  });

  it("with a tenant hint, authenticates into THAT tenant and no other", async () => {
    const a = await login(db, shared, "password-for-A", slugA);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.tenantId).toBe(tenantA);

    const b = await login(db, shared, "password-for-B", slugB);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.tenantId).toBe(tenantB);
  });

  it("rejects the OTHER tenant's password, so the hint really scopes the lookup", async () => {
    /* If the lookup ignored the slug and fell back to any matching row, one of
       these would succeed. */
    expect((await login(db, shared, "password-for-B", slugA)).ok).toBe(false);
    expect((await login(db, shared, "password-for-A", slugB)).ok).toBe(false);
  });

  it("REFUSES an ambiguous address rather than picking a tenant", async () => {
    /* The defect this ticket exists for. With the address in two tenants and no
       hint, the old code returned whichever row Postgres gave it — with the
       correct password for that row, this SUCCEEDED into an arbitrary tenant. */
    const r = await login(db, shared, "password-for-A");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      /* Indistinguishable from an unknown address: a caller must not be able to
         learn that this email exists in some other tenant (criterion 5). */
      expect(r.reason).toBe("invalid_credentials");
    }
  });

  it("an unambiguous address still logs in with no hint at all", async () => {
    /* The three seeded accounts depend on this: one tenant, no hint sent by any
       client today. */
    const r = await login(db, soloEmail, "password-solo");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tenantId).toBe(tenantA);
  });

  it("a wrong password fails in both tenants", async () => {
    expect((await login(db, shared, "nope", slugA)).ok).toBe(false);
    expect((await login(db, shared, "nope", slugB)).ok).toBe(false);
    expect((await login(db, soloEmail, "nope")).ok).toBe(false);
  });

  it("a deactivated account is refused even when unambiguous", async () => {
    await db
      .update(schema.user)
      .set({ isActive: false })
      .where(and(eq(schema.user.tenantId, tenantA), eq(schema.user.email, soloEmail)));
    const r = await login(db, soloEmail, "password-solo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("inactive");
    await db
      .update(schema.user)
      .set({ isActive: true })
      .where(and(eq(schema.user.tenantId, tenantA), eq(schema.user.email, soloEmail)));
  });

  /*
    KNOWN-ISSUES 5 — the lookup compared the address verbatim.

    `Alice@x.com` did not find a stored `alice@x.com`. What made it confusing
    rather than merely strict is that the rate-limit key in apps/api DOES
    lowercase the address, so the two halves of one request disagreed about
    what the user's email was: a person typing the wrong case was throttled
    under a key that matched while being told their credentials were wrong.

    Both directions are asserted, because the fix has to lower the COLUMN and
    not just the input — normalising the input alone would still miss a row
    stored with capitals, which is the case that actually locks somebody out.
  */
  it("finds the account whatever case the address is typed in", async () => {
    expect((await login(db, soloEmail.toUpperCase(), "password-solo")).ok).toBe(true);
    expect((await login(db, mixedCase(soloEmail), "password-solo")).ok).toBe(true);
    /* Surrounding space is trimmed too — it is what a paste from an email
       client routinely carries. */
    expect((await login(db, `  ${soloEmail}  `, "password-solo")).ok).toBe(true);
  });

  it("still refuses the wrong password however the address is cased", async () => {
    /* The guard must widen the LOOKUP and nothing else. */
    expect((await login(db, soloEmail.toUpperCase(), "nope")).ok).toBe(false);
  });

  it("keeps the tenant hint working when the case differs", async () => {
    const r = await login(db, shared.toUpperCase(), "password-for-A", slugA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tenantId).toBe(tenantA);
  });

  it("still refuses an ambiguous address typed in another case", async () => {
    /* Case-insensitivity must not become a way around STI-305's refusal. */
    const r = await login(db, shared.toUpperCase(), "password-for-A");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_credentials");
  });
});

/* Alternating case — a real paste from a phone keyboard looks more like this
   than a clean upper-casing does. */
function mixedCase(s: string): string {
  return [...s].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join("");
}
