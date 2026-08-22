import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import { hashPassword, login } from "@stinventory/auth";
import type { Permission } from "@stinventory/types";
import { userRouter } from "./routers/user.js";
import type { Context } from "./trpc.js";

/*
  STI-303 — user administration.

  Two things this suite exists to stop, in order of how expensive they are:

    1. **A mutating procedure with no permission.** Before this ticket there was
       no user router at all, so the first version of one is exactly where a
       bare `protectedProcedure` slips in — and a bare one here means any signed
       in account can mint an owner. Every procedure is asserted against a
       session that holds a permission but not `config.manage`.
    2. **Deactivating an account moving custody.** It must not. Tools follow the
       employee, not the login; STI-306 moves them. The test asserts the
       register and the assignment table are byte-for-byte untouched across a
       deactivate.

  Plus the two collisions STI-305 made possible to get wrong, which have
  different answers on purpose:

    - the same address twice inside ONE tenant is refused with text a person
      can read, not a raw 23505 naming `user_tenant_email_uq`;
    - the same address in a DIFFERENT tenant is also refused — see
      `takenElsewhere` in `routers/user.ts`. The index permits it, but `login()`
      refuses to guess between two matching rows and no client sends a tenant
      hint, so allowing it locks the EXISTING account out of the tenant it was
      already working in. Both of those tests go through `create()`; asserting
      against `db.insert` would pin the shape of an index rather than any
      behaviour of the code under test, and would pass with `create()` deleted.

  And the two halves of the forced password change: `create` and
  `resetPassword` SET `mustChangePassword`, `changePassword` CLEARS it. A flag
  with no way to clear it is a lockout, not a control, so the pair is tested
  together.

  Same harness rules as the other database tests here: real Postgres via
  DATABASE_URL (skipped without it), throwaway tenants. Nothing in this file
  writes ledger rows, so no trigger-disable dance is needed on cleanup.
*/
const url = process.env.DATABASE_URL;

/* The stored bcrypt prefix. Any response containing it has leaked a hash. */
const BCRYPT_PREFIX = "$2";

describe.skipIf(!url)("user administration (STI-303)", () => {
  let db: Database;
  let tenantId: string;
  let otherTenantId: string;
  let adminUserId: string;
  let outsiderUserId: string;
  let outsiderSessionId: string;
  let outsiderHash: string;
  let foremanRoleId: string;
  let ownerRoleId: string;
  let deskRoleId: string;
  let otherTenantRoleId: string;
  let employeeId: string;
  let otherTenantEmployeeId: string;
  let assetId: string;

  const OUTSIDER_PASSWORD = "outsider-password-1";

  const suffix = crypto.randomUUID().slice(0, 8);
  const emailFor = (who: string) => `sti303-${who}-${suffix}@test.local`;

  const makeCtx = (permissions: Permission[], userId?: string, tid?: string): Context => ({
    db,
    session: {
      userId: userId ?? adminUserId,
      tenantId: tid ?? tenantId,
      employeeId: null,
      permissions: new Set<Permission>(permissions),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "sti303-test-secret",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  const admin = () => userRouter.createCaller(makeCtx(["config.manage"]));
  /* An administrator of the OTHER tenant — the party the cross-tenant tests
     act as. Same permission, different `session.tenantId`. */
  const otherAdmin = () =>
    userRouter.createCaller(makeCtx(["config.manage"], outsiderUserId, otherTenantId));
  /* An ordinary signed-in account with no administrative permission at all.
     `changePassword` must be reachable from exactly this. */
  const self = (userId: string) => userRouter.createCaller(makeCtx([], userId));

  const readUser = async (id: string) => {
    const [row] = await db
      .select({
        isActive: schema.user.isActive,
        passwordHash: schema.user.passwordHash,
        mustChangePassword: schema.user.mustChangePassword,
      })
      .from(schema.user)
      .where(eq(schema.user.id, id));
    return row!;
  };
  const rolesOf = async (userId: string) =>
    (await db
      .select({ roleId: schema.userRole.roleId })
      .from(schema.userRole)
      .where(eq(schema.userRole.userId, userId))).map((r) => r.roleId);

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-303 admin test", slug: `sti303-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [o] = await db
      .insert(schema.tenant)
      .values({ name: "STI-303 other tenant", slug: `sti303-other-${suffix}` })
      .returning({ id: schema.tenant.id });
    otherTenantId = o!.id;

    const roles = await db
      .insert(schema.role)
      .values([
        { tenantId, name: "foreman" },
        { tenantId, name: "owner" },
        { tenantId, name: "equipment_admin" },
        { tenantId: otherTenantId, name: "owner" },
      ])
      .returning({ id: schema.role.id, tenantId: schema.role.tenantId, name: schema.role.name });
    foremanRoleId = roles.find((r) => r.tenantId === tenantId && r.name === "foreman")!.id;
    ownerRoleId = roles.find((r) => r.tenantId === tenantId && r.name === "owner")!.id;
    deskRoleId = roles.find((r) => r.tenantId === tenantId && r.name === "equipment_admin")!.id;
    otherTenantRoleId = roles.find((r) => r.tenantId === otherTenantId)!.id;

    /* `permission` is a global table the seed already fills; this only makes the
       suite independent of whether it has been. The two roles below are what
       makes the self-demotion guard testable at all — it asks whether the NEW
       role still grants `config.manage`, so a role that grants it and a role
       that does not are both needed. `foreman` deliberately gets neither. */
    await db.insert(schema.permission).values({ name: "config.manage" }).onConflictDoNothing();
    await db
      .insert(schema.rolePermission)
      .values([
        { roleId: ownerRoleId, permissionName: "config.manage" },
        { roleId: deskRoleId, permissionName: "config.manage" },
      ])
      .onConflictDoNothing();

    const [u] = await db
      .insert(schema.user)
      .values({
        tenantId,
        email: emailFor("admin"),
        passwordHash: "not-a-real-hash",
        firstName: "Desk",
        lastName: "Admin",
      })
      .returning({ id: schema.user.id });
    adminUserId = u!.id;
    /* The acting administrator really holds the administrator role, so the
       self-demotion tests can assert the row is still there afterwards. */
    await db.insert(schema.userRole).values({ userId: adminUserId, roleId: ownerRoleId });

    /* A REAL account in the other tenant, with a real credential and a live
       session. Every "another tenant's userId" test below asserts all three are
       untouched, which is what makes the tenant predicate inside `requireUser`
       load-bearing rather than decorative. */
    const [ou] = await db
      .insert(schema.user)
      .values({
        tenantId: otherTenantId,
        email: emailFor("outsider"),
        passwordHash: await hashPassword(OUTSIDER_PASSWORD),
        firstName: "Other",
        lastName: "Tenant",
      })
      .returning({ id: schema.user.id, passwordHash: schema.user.passwordHash });
    outsiderUserId = ou!.id;
    outsiderHash = ou!.passwordHash;
    await db.insert(schema.userRole).values({ userId: outsiderUserId, roleId: otherTenantRoleId });
    const outsiderLogin = await login(db, emailFor("outsider"), OUTSIDER_PASSWORD);
    outsiderSessionId = outsiderLogin.ok ? outsiderLogin.sessionId : "";

    const [e] = await db
      .insert(schema.employee)
      .values({ tenantId, name: "STI-303 Foreman", role: "foreman" })
      .returning({ id: schema.employee.id });
    employeeId = e!.id;
    const [oe] = await db
      .insert(schema.employee)
      .values({ tenantId: otherTenantId, name: "STI-303 Outsider", role: "foreman" })
      .returning({ id: schema.employee.id });
    otherTenantEmployeeId = oe!.id;

    /* The register's answer to "who is holding this" — the projection the
       deactivate test asserts is untouched. */
    const [a] = await db
      .insert(schema.asset)
      .values({ tenantId, description: "STI-303 held grinder", currentCustodianId: employeeId })
      .returning({ id: schema.asset.id });
    assetId = a!.id;
  });

  afterAll(async () => {
    for (const t of [tenantId, otherTenantId]) {
      if (t) await db.delete(schema.tenant).where(eq(schema.tenant.id, t));
    }
    await db?.$client.end();
  });

  /*
    Criterion 8, and the reason this file leads with it. `config.manage` is the
    gate; a session holding a different permission is the realistic attacker
    here — every signed in account has some permission.
  */
  it("every procedure refuses a session that lacks config.manage", async () => {
    const caller = userRouter.createCaller(makeCtx(["asset.read"]));
    const calls: Array<[string, () => Promise<unknown>]> = [
      ["create", () => caller.create({ email: emailFor("nope"), firstName: "N", lastName: "O", password: "not-allowed-1" })],
      ["setRole", () => caller.setRole({ userId: adminUserId, roleId: foremanRoleId })],
      ["setActive", () => caller.setActive({ userId: adminUserId, isActive: false })],
      ["resetPassword", () => caller.resetPassword({ userId: adminUserId })],
      /* Reads too: the account list is the list of who can get in. */
      ["list", () => caller.list()],
      ["roles", () => caller.roles()],
    ];
    /* `changePassword` is deliberately absent from this list — it is
       `protectedProcedure` scoped to the caller's own `session.userId`, because
       a person changing their own password is not performing an act of
       administration and gating it here would make `mustChangePassword`
       unsatisfiable for every ordinary account. Its scope, which is what stands
       in for the permission, is pinned in the mustChangePassword block below. */
    for (const [name, run] of calls) {
      await expect(run(), `${name} must be permission-gated`).rejects.toThrow(/missing permission: config.manage/);
    }

    /* And nothing landed: a FORBIDDEN that still wrote would be worse than no
       gate, because it would look safe. */
    const [row] = await db
      .select({ isActive: schema.user.isActive })
      .from(schema.user)
      .where(eq(schema.user.id, adminUserId));
    expect(row!.isActive).toBe(true);
  });

  it("creates an account, hands back the generated credential once, and never a hash", async () => {
    const email = emailFor("created");
    const res = await admin().create({ email, firstName: "New", lastName: "Hire", roleId: foremanRoleId });

    expect(res.user.email).toBe(email);
    expect(res.user.isActive).toBe(true);
    /* No password given, so one was generated and returned exactly here. */
    expect(res.temporaryPassword).toBeTruthy();
    expect(JSON.stringify(res)).not.toContain(BCRYPT_PREFIX);
    expect(Object.keys(res.user)).not.toContain("passwordHash");

    /* The credential works, which is the only proof that the hash written is
       the hash of what was handed over. */
    const ok = await login(db, email, res.temporaryPassword!);
    expect(ok.ok).toBe(true);

    const roles = await db
      .select({ roleId: schema.userRole.roleId })
      .from(schema.userRole)
      .where(eq(schema.userRole.userId, res.user.id));
    expect(roles.map((r) => r.roleId)).toEqual([foremanRoleId]);
  });

  it("refuses a duplicate email inside the tenant, in words a person can read", async () => {
    const email = emailFor("dupe");
    await admin().create({ email, firstName: "First", lastName: "Claim", password: "first-claim-pw" });

    const err = await admin()
      .create({ email, firstName: "Second", lastName: "Claim", password: "second-claim-pw" })
      .then(() => null, (e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    /* The failure mode this asserts against is the raw driver error: STI-305's
       index makes the insert throw a 23505 whose message names the index, and
       tRPC would deliver that as an INTERNAL_SERVER_ERROR the formatter
       redacts to "Something went wrong on our side." */
    expect(err!.message).toMatch(/already has an account/i);
    expect(err!.message).not.toMatch(/user_tenant_email_uq|23505/);
  });

  it("refuses the same address in ANOTHER tenant, through the router, and writes nothing", async () => {
    /* Claimed by the previous test, in `tenantId`. */
    const email = emailFor("dupe");

    /* `user_tenant_email_uq` would happily allow this row; the refusal has to
       come from `create()` itself, which is why this goes through the router
       rather than `db.insert`. The harm it prevents lands on the OTHER tenant:
       `login()` with no tenant hint requires the address to match exactly one
       account and refuses when it matches two, so the account created above
       would stop working the moment this one existed. */
    const err = await otherAdmin()
      .create({ email, firstName: "Cross", lastName: "Tenant", password: "cross-tenant-pw" })
      .then(() => null, (e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/another organisation/i);
    expect(err!.message).not.toMatch(/user_tenant_email_uq|23505/);

    /* Nothing landed in the other tenant... */
    const rows = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.email, email), eq(schema.user.tenantId, otherTenantId)));
    expect(rows).toHaveLength(0);

    /* ...and the account that already held the address still signs in, which is
       the whole point of refusing. */
    const still = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    expect(still).toHaveLength(1);
  });

  it("links an employee only inside the tenant, and the link is optional", async () => {
    const linked = await admin().create({
      email: emailFor("linked"), firstName: "Linked", lastName: "Foreman",
      password: "linked-foreman-pw", employeeId,
    });
    expect(linked.user.employeeId).toBe(employeeId);

    /* Employees are not users: an account with no person attached is normal
       (the office), and so is a person with no account (the yard). */
    const unlinked = await admin().create({
      email: emailFor("office"), firstName: "Office", lastName: "Only", password: "office-only-pw",
    });
    expect(unlinked.user.employeeId).toBeNull();

    /* `user.employeeId` has NO foreign key, so only the router's own tenant
       predicate stops this. */
    await expect(
      admin().create({
        email: emailFor("crosslink"), firstName: "Cross", lastName: "Tenant",
        password: "cross-tenant-pw", employeeId: otherTenantEmployeeId,
      }),
    ).rejects.toThrow(/No such person in this tenant/);
  });

  it("assigns a role by replacing, never by adding a second one", async () => {
    const { user } = await admin().create({
      email: emailFor("promoted"), firstName: "Pro", lastName: "Moted",
      password: "promoted-user-pw", roleId: foremanRoleId,
    });

    await admin().setRole({ userId: user.id, roleId: ownerRoleId });
    const after = await db
      .select({ roleId: schema.userRole.roleId })
      .from(schema.userRole)
      .where(eq(schema.userRole.userId, user.id));
    /* Two rows here would make `resolveSession`'s roleName — and every screen
       that branches on it — depend on row order. */
    expect(after.map((r) => r.roleId)).toEqual([ownerRoleId]);

    await admin().setRole({ userId: user.id, roleId: null });
    const cleared = await db
      .select({ roleId: schema.userRole.roleId })
      .from(schema.userRole)
      .where(eq(schema.userRole.userId, user.id));
    expect(cleared).toHaveLength(0);

    /* A role uuid from another tenant would hand its permissions across the
       boundary. `user_role` has no tenant column of its own to stop it. */
    await expect(
      admin().setRole({ userId: user.id, roleId: otherTenantRoleId }),
    ).rejects.toThrow(/No such role in this tenant/);
  });

  it("deactivates and reactivates, and login follows in both directions", async () => {
    const email = emailFor("leaver");
    const password = "leaver-password-1";
    const { user } = await admin().create({ email, firstName: "Leaver", lastName: "Person", password });
    expect((await login(db, email, password)).ok).toBe(true);

    const off = await admin().setActive({ userId: user.id, isActive: false });
    expect(off.isActive).toBe(false);
    const refused = await login(db, email, password);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("inactive");

    /* Never delete: the row is still there, still attributable, because this
       account is the actor on history that cannot be rewritten. */
    const [still] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, user.id));
    expect(still).toBeDefined();

    const on = await admin().setActive({ userId: user.id, isActive: true });
    expect(on.isActive).toBe(true);
    expect((await login(db, email, password)).ok).toBe(true);
  });

  it("deactivating an account does NOT move custody", async () => {
    const { user } = await admin().create({
      email: emailFor("holder"), firstName: "Tool", lastName: "Holder",
      password: "tool-holder-pw", employeeId,
    });

    /* The screen is allowed to SAY they hold tools — that is this count — but
       nothing may act on it. */
    const before = (await admin().list()).find((u) => u.id === user.id)!;
    expect(before.heldToolCount).toBe(1);

    await admin().setActive({ userId: user.id, isActive: false });

    const [asset] = await db
      .select({ custodianId: schema.asset.currentCustodianId })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId));
    /* If deactivation ever grows a "return their tools" step, this is the line
       that fails — and it should, because the tool would have moved with no
       ledger event and no custody link explaining it. */
    expect(asset!.custodianId).toBe(employeeId);

    const links = await db
      .select({ id: schema.assignment.id })
      .from(schema.assignment)
      .where(and(eq(schema.assignment.tenantId, tenantId), eq(schema.assignment.assetId, assetId)));
    expect(links).toHaveLength(0);

    const events = await db
      .select({ id: schema.transaction.id })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)));
    expect(events).toHaveLength(0);

    /* Still reported as holding, now that the account is dark — the count is a
       fact about the employee, not about the login. */
    const after = (await admin().list()).find((u) => u.id === user.id)!;
    expect(after.heldToolCount).toBe(1);
    expect(after.isActive).toBe(false);
  });

  it("refuses to let an admin deactivate their own account", async () => {
    /* Not recoverable from this screen: the next request resolves no session,
       so nobody is left signed in who can undo it. */
    await expect(
      admin().setActive({ userId: adminUserId, isActive: false }),
    ).rejects.toThrow(/cannot deactivate your own account/i);
  });

  /*
    Defect: the tenant predicate inside `requireUser` was untested — deleting
    `eq(schema.user.tenantId, tid)` from it left the whole suite green. Since
    `user_role` and `session` carry no tenant column of their own, that one
    predicate is the SOLE isolation for every write that goes through it, so
    each of these asserts BOTH the refusal and that nothing was written. A
    refusal that still wrote would be the worse bug, because it would look safe.
  */
  describe("the tenant predicate in requireUser is the only isolation these writes have", () => {
    it("setRole refuses another tenant's userId and leaves their role alone", async () => {
      await expect(
        admin().setRole({ userId: outsiderUserId, roleId: foremanRoleId }),
      ).rejects.toThrow(/No such account in this tenant/);
      /* Without the predicate this would be `[foremanRoleId]` — a role from
         tenant A silently attached to an account in tenant B. */
      expect(await rolesOf(outsiderUserId)).toEqual([otherTenantRoleId]);
    });

    it("setRole refuses to CLEAR another tenant's role", async () => {
      /* The delete runs before the insert and is keyed on `userId` alone, so
         `roleId: null` is the call that strips permissions with no replacement
         — the destructive direction, tested separately for that reason. */
      await expect(
        admin().setRole({ userId: outsiderUserId, roleId: null }),
      ).rejects.toThrow(/No such account in this tenant/);
      expect(await rolesOf(outsiderUserId)).toEqual([otherTenantRoleId]);
    });

    it("setActive refuses another tenant's userId and leaves them signed in", async () => {
      await expect(
        admin().setActive({ userId: outsiderUserId, isActive: false }),
      ).rejects.toThrow(/No such account in this tenant/);
      expect((await readUser(outsiderUserId)).isActive).toBe(true);
      expect((await login(db, emailFor("outsider"), OUTSIDER_PASSWORD)).ok).toBe(true);
    });

    it("resetPassword refuses another tenant's userId and changes neither hash nor session", async () => {
      await expect(
        admin().resetPassword({ userId: outsiderUserId }),
      ).rejects.toThrow(/No such account in this tenant/);

      const row = await readUser(outsiderUserId);
      expect(row.passwordHash).toBe(outsiderHash);
      expect(row.mustChangePassword).toBe(false);
      /* The revocation half of a reset deletes sessions by userId. It would run
         against an account in a tenant this administrator cannot see. */
      const [alive] = await db
        .select({ id: schema.session.id })
        .from(schema.session)
        .where(eq(schema.session.id, outsiderSessionId));
      expect(alive).toBeDefined();
    });
  });

  /*
    Defect: `setActive(self, false)` was guarded and `setRole(self, null)` was
    not, from a dropdown that mutated on change with no confirmation. Both are
    the same hazard — the last administrator locking the tenant out — and the
    only recovery from the unguarded one was an UPDATE in psql.
  */
  describe("an administrator cannot take config.manage off themselves", () => {
    it("refuses to clear their own role, and the role survives", async () => {
      await expect(
        admin().setRole({ userId: adminUserId, roleId: null }),
      ).rejects.toThrow(/cannot remove your own administrator role/i);
      expect(await rolesOf(adminUserId)).toEqual([ownerRoleId]);
    });

    it("refuses a role that does not carry config.manage", async () => {
      await expect(
        admin().setRole({ userId: adminUserId, roleId: foremanRoleId }),
      ).rejects.toThrow(/cannot remove your own administrator role/i);
      expect(await rolesOf(adminUserId)).toEqual([ownerRoleId]);
    });

    it("allows a self role change that KEEPS config.manage", async () => {
      /* The guard is about the permission, not about self-service. Swapping
         owner for equipment_admin locks nobody out, so refusing it would be a
         guard that had stopped reading what it is guarding. */
      await admin().setRole({ userId: adminUserId, roleId: deskRoleId });
      expect(await rolesOf(adminUserId)).toEqual([deskRoleId]);
      await admin().setRole({ userId: adminUserId, roleId: ownerRoleId });
      expect(await rolesOf(adminUserId)).toEqual([ownerRoleId]);
    });

    it("still lets an administrator clear SOMEBODY ELSE's role", async () => {
      const { user } = await admin().create({
        email: emailFor("demoted"), firstName: "De", lastName: "Moted",
        password: "demoted-user-pw", roleId: ownerRoleId,
      });
      await admin().setRole({ userId: user.id, roleId: null });
      expect(await rolesOf(user.id)).toEqual([]);
    });
  });

  /*
    Criterion 5, both halves. The flag is set by the two procedures that hand a
    credential to somebody other than its owner, and cleared by the only
    procedure the owner can reach. Tested as a pair on purpose: a flag that
    `changePassword` did not clear would send the user back to the forced-change
    screen on every login forever, and a flag no ordinary account could clear
    would be a lockout wearing a security control's clothes.
  */
  describe("mustChangePassword — set on issue, cleared only by the owner", () => {
    it("is set by create, even when the administrator chose the password", async () => {
      /* An admin-CHOSEN password is still an admin-KNOWN password, so this is
         not conditional on the server having generated it. */
      const typed = await admin().create({
        email: emailFor("typed"), firstName: "Typed", lastName: "Password", password: "typed-password-1",
      });
      expect((await readUser(typed.user.id)).mustChangePassword).toBe(true);

      const generated = await admin().create({
        email: emailFor("generated"), firstName: "Gen", lastName: "Erated",
      });
      expect((await readUser(generated.user.id)).mustChangePassword).toBe(true);

      /* `login()` reports it rather than refusing on it — refusing would leave
         the user unable to do the one thing the flag is asking for. */
      const signedIn = await login(db, emailFor("typed"), "typed-password-1");
      expect(signedIn.ok).toBe(true);
      if (signedIn.ok) expect(signedIn.mustChangePassword).toBe(true);
    });

    it("is set again by resetPassword", async () => {
      const email = emailFor("reflagged");
      const { user } = await admin().create({ email, firstName: "Re", lastName: "Flagged", password: "reflagged-pw-1" });
      await self(user.id).changePassword({ currentPassword: "reflagged-pw-1", newPassword: "chosen-by-them-1" });
      expect((await readUser(user.id)).mustChangePassword).toBe(false);

      await admin().resetPassword({ userId: user.id });
      expect((await readUser(user.id)).mustChangePassword).toBe(true);
    });

    it("is cleared by changePassword, which needs no administrative permission", async () => {
      const email = emailFor("changer");
      const { user } = await admin().create({ email, firstName: "Self", lastName: "Serve", password: "issued-to-them-1" });
      const before = await readUser(user.id);
      expect(before.mustChangePassword).toBe(true);

      /* The session carries NO permissions at all. Gating this on
         `config.manage` is what would make the flag unsatisfiable. */
      const res = await self(user.id).changePassword({
        currentPassword: "issued-to-them-1",
        newPassword: "their-own-choice-1",
      });
      expect(res).toEqual({ ok: true });

      const after = await readUser(user.id);
      expect(after.mustChangePassword).toBe(false);
      expect(after.passwordHash).not.toBe(before.passwordHash);
      expect(JSON.stringify(res)).not.toContain(BCRYPT_PREFIX);

      expect((await login(db, email, "issued-to-them-1")).ok).toBe(false);
      const now = await login(db, email, "their-own-choice-1");
      expect(now.ok).toBe(true);
      if (now.ok) expect(now.mustChangePassword).toBe(false);
    });

    it("refuses the wrong current password, and leaves the flag set", async () => {
      const email = emailFor("wrongcurrent");
      const { user } = await admin().create({ email, firstName: "Wrong", lastName: "Current", password: "the-real-one-1" });

      /* A session token is a bearer token. Without this check anyone holding a
         stolen one could set a password of their own and turn a borrowed
         session into permanent ownership of the account. */
      await expect(
        self(user.id).changePassword({ currentPassword: "not-the-real-one", newPassword: "attacker-choice-1" }),
      ).rejects.toThrow(/not your current password/i);

      const row = await readUser(user.id);
      expect(row.mustChangePassword).toBe(true);
      expect((await login(db, email, "the-real-one-1")).ok).toBe(true);
    });

    it("refuses to re-set the same password", async () => {
      const email = emailFor("samepw");
      const { user } = await admin().create({ email, firstName: "Same", lastName: "Again", password: "no-change-here-1" });
      await expect(
        self(user.id).changePassword({ currentPassword: "no-change-here-1", newPassword: "no-change-here-1" }),
      ).rejects.toThrow(/must be different/i);
      /* Clearing the flag on a no-op change would defeat the whole mechanism. */
      expect((await readUser(user.id)).mustChangePassword).toBe(true);
    });

    it("writes only the caller's own row — there is no userId to point elsewhere", async () => {
      const mine = await admin().create({
        email: emailFor("mine"), firstName: "My", lastName: "Row", password: "my-own-row-pw-1",
      });
      const theirs = await admin().create({
        email: emailFor("theirs"), firstName: "Their", lastName: "Row", password: "their-own-row-pw",
      });
      const theirsBefore = await readUser(theirs.user.id);

      await self(mine.user.id).changePassword({
        currentPassword: "my-own-row-pw-1",
        newPassword: "my-new-row-pw-11",
      });

      /* The row written is `ctx.session.userId`, never an input, so there is no
         argument an attacker could aim at somebody else. */
      const theirsAfter = await readUser(theirs.user.id);
      expect(theirsAfter.passwordHash).toBe(theirsBefore.passwordHash);
      expect(theirsAfter.mustChangePassword).toBe(true);
    });
  });

  it("resets a password to a new credential, revokes the old sessions, and returns no hash", async () => {
    const email = emailFor("forgot");
    const oldPassword = "old-password-123";
    const { user } = await admin().create({ email, firstName: "For", lastName: "Got", password: oldPassword });

    const first = await login(db, email, oldPassword);
    expect(first.ok).toBe(true);
    const sessionId = first.ok ? first.sessionId : "";

    const res = await admin().resetPassword({ userId: user.id });
    expect(res.temporaryPassword).toBeTruthy();
    expect(JSON.stringify(res)).not.toContain(BCRYPT_PREFIX);
    expect(Object.keys(res)).toEqual(["temporaryPassword"]);

    expect((await login(db, email, oldPassword)).ok).toBe(false);
    expect((await login(db, email, res.temporaryPassword!)).ok).toBe(true);

    /* A reset that left the old bearer token alive would have revoked nothing —
       which is usually the whole reason somebody resets a password. */
    const [alive] = await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.id, sessionId));
    expect(alive).toBeUndefined();
  });

  it("no procedure anywhere in this router puts a password hash on the wire", async () => {
    const email = emailFor("scanned");
    const created = await admin().create({ email, firstName: "Scan", lastName: "Ned", password: "scanned-user-pw" });
    const payloads: unknown[] = [
      created,
      await admin().list(),
      await admin().roles(),
      await admin().setRole({ userId: created.user.id, roleId: foremanRoleId }),
      /* Reads `passwordHash` to compare against — the one procedure here that
         does — so it is exactly the one worth scanning. Ordered before the
         reset below, which would replace the credential it is given. */
      await self(created.user.id).changePassword({
        currentPassword: "scanned-user-pw", newPassword: "scanned-user-new-1",
      }),
      await admin().setActive({ userId: created.user.id, isActive: false }),
      await admin().resetPassword({ userId: created.user.id }),
    ];
    for (const p of payloads) {
      const json = JSON.stringify(p);
      expect(json).not.toContain(BCRYPT_PREFIX);
      expect(json).not.toContain("passwordHash");
      expect(json).not.toContain("llmApiKeyEnc");
    }
  });

  it("scopes every read to the tenant", async () => {
    /* The other tenant's account shares the `dupe` address and must not appear
       here. There is no RLS; the WHERE clause is the isolation. */
    const rows = await admin().list();
    expect(rows.length).toBeGreaterThan(0);
    const ids = new Set(rows.map((r) => r.id));
    const [outsider] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.tenantId, otherTenantId))
      .limit(1);
    expect(ids.has(outsider!.id)).toBe(false);

    const roleRows = await admin().roles();
    expect(roleRows.map((r) => r.id)).not.toContain(otherTenantRoleId);
  });
});
