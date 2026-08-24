import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { roleRouter } from "./routers/role.js";
import type { Context } from "./trpc.js";

/*
  `/admin/roles` — editing what a role may do.

  This screen exists because `PERMISSION_MATRIX.md` was never returned by
  Urban, so Phase 3 shipped on defaults the customer had not seen. Rather than
  leave six decisions sitting in code awaiting a meeting, Urban gets to change
  them. That is the right answer, and it makes this router the single most
  dangerous surface in the product: everything else in the system is gated by
  permissions, and this is the thing that sets them.

  So what is tested here is mostly the ways it must REFUSE.

  The one that matters most is self-lockout. `user.setRole` carries the same
  guard and its comment records that it was once unguarded, on the reasoning
  "another admin can put it back" — an assumption that fails in a company with
  one administrator. Here it fails worse: removing `config.manage` from your
  own role takes away this screen, the users screen and the settings screen at
  once, and the way back is somebody with database access.

  Real Postgres via DATABASE_URL, throwaway tenant.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("role administration", () => {
  let db: Database;
  let tenantId: string;
  let adminUserId: string;
  let outsiderUserId: string;
  let adminRoleId: string;
  let foremanRoleId: string;
  let otherTenantRoleId: string;

  const suffix = crypto.randomUUID().slice(0, 8);

  const ctxFor = (userId: string): Context => ({
    db,
    session: {
      userId,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>(["config.manage"]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "role-admin-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  /* The administrator IS on `adminRoleId` — that pairing is what makes the
     self-lockout test meaningful rather than a coincidence. */
  const admin = () => roleRouter.createCaller(ctxFor(adminUserId));
  /* Signed in, holds config.manage, but is NOT on the role being edited. */
  const outsider = () => roleRouter.createCaller(ctxFor(outsiderUserId));

  const grantsOf = async (roleId: string) =>
    (await db
      .select({ name: schema.rolePermission.permissionName })
      .from(schema.rolePermission)
      .where(eq(schema.rolePermission.roleId, roleId))).map((r) => r.name).sort();

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "role admin test", slug: `roleadm-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [other] = await db
      .insert(schema.tenant)
      .values({ name: "role admin other", slug: `roleadm-other-${suffix}` })
      .returning({ id: schema.tenant.id });

    await db.insert(schema.permission).values([
      { name: "config.manage" }, { name: "asset.read" }, { name: "asset.manage" },
      { name: "assignment.approve" }, { name: "assets.view.all" }, { name: "assets.view.own" },
    ]).onConflictDoNothing();

    const roles = await db
      .insert(schema.role)
      .values([
        { tenantId, name: "owner" },
        { tenantId, name: "foreman" },
        { tenantId, name: "site_lead", description: "a role somebody made here" },
        { tenantId: other!.id, name: "owner" },
      ])
      .returning({ id: schema.role.id, name: schema.role.name, tenantId: schema.role.tenantId });
    adminRoleId = roles.find((r) => r.tenantId === tenantId && r.name === "owner")!.id;
    foremanRoleId = roles.find((r) => r.tenantId === tenantId && r.name === "foreman")!.id;
    otherTenantRoleId = roles.find((r) => r.tenantId === other!.id)!.id;

    await db.insert(schema.rolePermission).values([
      { roleId: adminRoleId, permissionName: "config.manage" },
      { roleId: adminRoleId, permissionName: "asset.read" },
      { roleId: foremanRoleId, permissionName: "asset.read" },
      { roleId: foremanRoleId, permissionName: "assets.view.own" },
    ]);

    const users = await db
      .insert(schema.user)
      .values([
        { tenantId, email: `roleadm-${suffix}@test.local`, passwordHash: "x", firstName: "Role", lastName: "Admin" },
        { tenantId, email: `roleout-${suffix}@test.local`, passwordHash: "x", firstName: "Other", lastName: "Admin" },
      ])
      .returning({ id: schema.user.id });
    adminUserId = users[0]!.id;
    outsiderUserId = users[1]!.id;
    await db.insert(schema.userRole).values({ userId: adminUserId, roleId: adminRoleId });
  });

  afterAll(async () => {
    if (db && tenantId) await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
    await db?.$client.end();
  });

  describe("the lockout guard", () => {
    it("refuses to take config.manage off the caller's OWN role", async () => {
      /* The whole reason this guard exists: there is no second screen to undo
         it from. */
      await expect(admin().setPermissions({ roleId: adminRoleId, permissions: ["asset.read"] })).rejects.toThrow(
        /your own role/i,
      );
      expect(await grantsOf(adminRoleId)).toContain("config.manage");
    });

    it("allows the same edit from an administrator NOT on that role", async () => {
      /* Not paranoia-by-default: an ordinary administrative act, with somebody
         still able to reverse it. Refusing this too would make the guard a
         rule that no administrator can ever demote another. */
      await outsider().setPermissions({ roleId: adminRoleId, permissions: ["asset.read"] });
      expect(await grantsOf(adminRoleId)).toEqual(["asset.read"]);
      /* Put it back — later tests act as this administrator. */
      await outsider().setPermissions({ roleId: adminRoleId, permissions: ["config.manage", "asset.read"] });
    });

    it("still lets the caller edit a role they are not on", async () => {
      await admin().setPermissions({ roleId: foremanRoleId, permissions: ["asset.read", "assets.view.own"] });
      expect(await grantsOf(foremanRoleId)).toEqual(["asset.read", "assets.view.own"]);
    });
  });

  describe("setPermissions", () => {
    it("replaces the set rather than adding to it", async () => {
      await admin().setPermissions({ roleId: foremanRoleId, permissions: ["asset.read"] });
      expect(await grantsOf(foremanRoleId)).toEqual(["asset.read"]);
    });

    it("reports the delta, which is what the audit trail needs", async () => {
      /* "Who took approval away from the superintendents" is a question asked
         three weeks later. A snapshot of the resulting set cannot answer it. */
      const res = await admin().setPermissions({
        roleId: foremanRoleId,
        permissions: ["asset.read", "assignment.approve"],
      });
      expect(res.added).toEqual(["assignment.approve"]);
      expect(res.removed).toEqual([]);

      const back = await admin().setPermissions({ roleId: foremanRoleId, permissions: ["asset.read"] });
      expect(back.removed).toEqual(["assignment.approve"]);
    });

    it("accepts an empty set — that is how a role is retired", async () => {
      /* Deliberately allowed. An account on an empty role can still sign in
         and can do nothing, which is VISIBLE — unlike deleting the role, which
         would cascade `user_role` and silently leave the same accounts holding
         nothing with no record of why. */
      await admin().setPermissions({ roleId: foremanRoleId, permissions: [] });
      expect(await grantsOf(foremanRoleId)).toEqual([]);
      await admin().setPermissions({ roleId: foremanRoleId, permissions: ["asset.read", "assets.view.own"] });
    });

    it("refuses a role belonging to another tenant", async () => {
      await expect(
        admin().setPermissions({ roleId: otherTenantRoleId, permissions: ["asset.read"] }),
      ).rejects.toThrow(/No such role/i);
    });

    it("refuses a permission that does not exist", async () => {
      /* Zod stops this at the edge. It matters because a permission nothing
         checks is a checkbox that grants a feeling — and the `permission`
         table's FK would reject it anyway, as a raw 23503 nobody can read. */
      await expect(
        // @ts-expect-error — deliberately outside the enum
        admin().setPermissions({ roleId: foremanRoleId, permissions: ["asset.invent"] }),
      ).rejects.toThrow();
    });
  });

  describe("create and delete", () => {
    it("copies an existing role's permissions when asked", async () => {
      /* The realistic way a role gets made: "a superintendent, but without
         approval". Starting blank means ticking thirty boxes from memory. */
      const created = await admin().create({ name: `copy_of_foreman_${suffix}`, copyFromRoleId: foremanRoleId });
      expect(await grantsOf(created.id)).toEqual(await grantsOf(foremanRoleId));
      await admin().delete({ id: created.id });
    });

    it("refuses a duplicate name", async () => {
      await expect(admin().create({ name: "foreman" })).rejects.toThrow(/already a role/i);
    });

    it("refuses a name no seed or test could ever write", async () => {
      /* ROLES is a list of lowercase snake_case identifiers and everything
         that joins against it assumes that shape. "Site Manager" would create
         a role the seed can never reproduce. */
      await expect(admin().create({ name: "Site Manager" })).rejects.toThrow();
    });

    it("refuses to delete a BUILT-IN role", async () => {
      /* Not because the row is special: `role-perms.ts` and the seed both name
         it, so the next SEED_RESET would recreate it and the RBAC test would
         assert against something that is not there. */
      await expect(admin().delete({ id: foremanRoleId })).rejects.toThrow(/built-in/i);
    });

    it("refuses to delete a role somebody is still on, and says how many", async () => {
      const created = await admin().create({ name: `staffed_${suffix}` });
      const [u] = await db
        .insert(schema.user)
        .values({ tenantId, email: `staffed-${suffix}@test.local`, passwordHash: "x", firstName: "S", lastName: "T" })
        .returning({ id: schema.user.id });
      await db.insert(schema.userRole).values({ userId: u!.id, roleId: created.id });

      /* Deleting cascades `user_role`, so that account would keep working and
         silently hold nothing — a permission change nobody made and nobody can
         see. */
      await expect(admin().delete({ id: created.id })).rejects.toThrow(/1 account is still/i);

      await db.delete(schema.userRole).where(and(eq(schema.userRole.userId, u!.id), eq(schema.userRole.roleId, created.id)));
      await admin().delete({ id: created.id });
    });
  });

  describe("list", () => {
    it("says how many accounts each role would affect", async () => {
      /* An administrator about to untick something needs to know whether that
         is one person or forty. */
      const rows = await admin().list();
      const owner = rows.find((r) => r.name === "owner");
      expect(owner!.userCount).toBe(1);
    });

    it("marks the built-in roles, so the screen can explain why one cannot be deleted", async () => {
      const rows = await admin().list();
      expect(rows.find((r) => r.name === "foreman")!.isBuiltIn).toBe(true);
      expect(rows.find((r) => r.name === "site_lead")!.isBuiltIn).toBe(false);
    });

    it("does not leak another tenant's roles", async () => {
      const rows = await admin().list();
      expect(rows.some((r) => r.id === otherTenantRoleId)).toBe(false);
    });
  });
});
