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
});
