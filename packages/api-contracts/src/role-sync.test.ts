import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { employeeRouter } from "./routers/project.js";
import type { Context } from "./trpc.js";

/*
  A role lives on the PERSON, and the account inherits it (2026-08-28).

  Before this, "role" meant two different things: `employee.role` decided who
  could hold a tool and which layout they got, while `user_role` decided
  permissions. Nothing kept them in step, so a person could read as an office
  administrator on the People screen while their session still carried a
  foreman's permissions.

  `employee.roleId` is now the single source and `employee.update` is the single
  writer that keeps `user_role` — the row `resolveSession` actually reads —
  in step with it. That invariant has no database constraint behind it, exactly
  like the custody one, so it lives or dies by this file.

  Real Postgres via DATABASE_URL, throwaway tenant.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("a person's role reaches their account (role sync)", () => {
  let db: Database;
  let tenantId: string;
  let foremanRoleId: string;
  let officeRoleId: string;
  let otherTenantId: string;
  let otherTenantRoleId: string;

  const suffix = crypto.randomUUID().slice(0, 8);

  const ctx = (): Context => ({
    db,
    session: {
      userId: null as unknown as string,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>(["employee.manage"]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "role-sync-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  const caller = () => employeeRouter.createCaller(ctx());

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "role sync test", slug: `rolesync-${suffix}` })
      .returning();
    tenantId = t!.id;

    const roles = await db
      .insert(schema.role)
      .values([
        { tenantId, name: "foreman", canHoldCustody: true, usesFieldLayout: true },
        { tenantId, name: "office_admin" },
      ])
      .returning();
    foremanRoleId = roles.find((r) => r.name === "foreman")!.id;
    officeRoleId = roles.find((r) => r.name === "office_admin")!.id;

    /* A SECOND tenant, purely so the cross-tenant test below has a real
       foreign role to point at rather than a made-up uuid. A random uuid would
       pass the guard for the wrong reason — "no such row" instead of "not
       yours". */
    const [other] = await db
      .insert(schema.tenant)
      .values({ name: "role sync other", slug: `rolesync-other-${suffix}` })
      .returning();
    otherTenantId = other!.id;
    const [otherRole] = await db
      .insert(schema.role)
      .values({ tenantId: otherTenantId, name: "owner" })
      .returning();
    otherTenantRoleId = otherRole!.id;
  });

  afterAll(async () => {
    if (tenantId) await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
    if (otherTenantId) await db.delete(schema.tenant).where(eq(schema.tenant.id, otherTenantId));
  });

  async function makePerson(withAccount: boolean) {
    const [person] = await db
      .insert(schema.employee)
      .values({ tenantId, name: `Person ${crypto.randomUUID().slice(0, 6)}`, roleId: foremanRoleId })
      .returning();
    if (!withAccount) return { personId: person!.id, userId: null as string | null };

    const [account] = await db
      .insert(schema.user)
      .values({
        tenantId,
        employeeId: person!.id,
        email: `p-${crypto.randomUUID().slice(0, 8)}@rolesync.local`,
        passwordHash: "x",
        firstName: "A",
        lastName: "B",
      })
      .returning();
    await db.insert(schema.userRole).values({ userId: account!.id, roleId: foremanRoleId });
    return { personId: person!.id, userId: account!.id };
  }

  const rolesOf = async (userId: string) =>
    (await db.select({ roleId: schema.userRole.roleId }).from(schema.userRole).where(eq(schema.userRole.userId, userId)))
      .map((r) => r.roleId);

  it("moves the account's role when the person's role changes", async () => {
    const { personId, userId } = await makePerson(true);
    expect(await rolesOf(userId!)).toEqual([foremanRoleId]);

    await caller().update({ id: personId, roleId: officeRoleId });

    /* The whole point: `resolveSession` reads `user_role`, so if this did not
       move, the register would say office_admin while the session still held a
       foreman's permissions. */
    expect(await rolesOf(userId!)).toEqual([officeRoleId]);
  });

  it("REPLACES rather than accumulates — a person holds one role", async () => {
    const { personId, userId } = await makePerson(true);
    await caller().update({ id: personId, roleId: officeRoleId });
    await caller().update({ id: personId, roleId: foremanRoleId });
    const held = await rolesOf(userId!);
    expect(held).toEqual([foremanRoleId]);
    expect(held).toHaveLength(1);
  });

  it("clears the account's role when the person's is cleared", async () => {
    const { personId, userId } = await makePerson(true);
    await caller().update({ id: personId, roleId: null });
    expect(await rolesOf(userId!)).toEqual([]);
  });

  it("leaves a person with no account alone rather than failing", async () => {
    /* The normal case in a yard: most people hold tools and never sign in.
       Nothing to sync, and the update must still succeed. */
    const { personId } = await makePerson(false);
    const row = await caller().update({ id: personId, roleId: officeRoleId });
    expect(row?.roleId).toBe(officeRoleId);
  });

  it("does not touch the account when some other field changes", async () => {
    const { personId, userId } = await makePerson(true);
    await caller().update({ id: personId, name: "Renamed Person" });
    expect(await rolesOf(userId!)).toEqual([foremanRoleId]);
  });

  /*
    Cross-tenant privilege escalation, found in the audit of this change rather
    than by a test — which is why it now has one.

    `employee.update` took `roleId` as a bare uuid, and the `user_role` sync
    wrote it straight into the table `resolveSession` reads. That read has no
    tenant predicate of its own, because until the sync existed nothing could
    put a foreign role there. So anyone holding `employee.manage` could point a
    person at another tenant's `owner` role and collect its permissions on the
    next request.
  */
  it("refuses a role belonging to another tenant, on update", async () => {
    const { personId, userId } = await makePerson(true);
    await expect(caller().update({ id: personId, roleId: otherTenantRoleId })).rejects.toThrow(
      /No such role in this tenant/,
    );
    /* And nothing moved — the guard runs before the write, not after. */
    expect(await rolesOf(userId!)).toEqual([foremanRoleId]);
  });

  it("refuses a role belonging to another tenant, on create", async () => {
    await expect(
      caller().create({ name: "Intruder", roleId: otherTenantRoleId }),
    ).rejects.toThrow(/No such role in this tenant/);
  });
});
