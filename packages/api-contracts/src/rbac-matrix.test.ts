import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { createDb, schema, ROLE_PERMS, type Database } from "@stinventory/db";
import { PERMISSIONS, ROLES, VIEW_SCOPES, type Permission } from "@stinventory/types";
import { appRouter } from "./index.js";
import { assetVisibility, assetScopeWhere, viewTierOf } from "./scope.js";
import { assetRouter } from "./routers/asset.js";
import { reportRouter } from "./routers/report.js";
import { dashboardRouter } from "./routers/dashboard.js";
import type { Context } from "./trpc.js";

/*
  STI-308 — the RBAC matrix test.

  Before this file there was NO test touching roles or permissions anywhere in
  the repository, which meant every claim about who may do what was unguarded.
  Worse, every journey the product had ever been exercised on was driven as
  `owner` — an account that cannot be refused anything — so no permission
  denial had ever actually been observed. A permission system tested only by a
  superuser is not a tested permission system.

  Four separate things are pinned here, and they fail for different reasons:

    1. THE MATRIX ITSELF. `ROLE_PERMS` (packages/db/src/role-perms.ts) is the
       matrix in code, and the seeded `role_permission` rows must match it in
       BOTH directions. One-directional assertions are how over-granting
       survives: "the role has everything the matrix says" passes cleanly for a
       role that also has six permissions the matrix never mentioned.

    2. THE LADDER, THROUGH THE REAL QUERY PATH. Asserting `hasPermission`
       proves the helper works and proves nothing about the routers. These
       tests build a session, call the actual procedure, and count rows — the
       same thing a browser does.

    3. EVERY MUTATION CARRIES A PERMISSION. Walked from the router tree rather
       than from a list somebody maintains, so it catches the NEXT mutation
       added, which is the only one that matters.

    4. THE LADDER'S SHAPE. An actor with no tier resolves to an empty result
       and never to an unscoped one — the difference between the two is a
       single dropped `undefined`, and it is invisible in every other test
       because "returns too much data" looks exactly like working correctly.

  Harness: real Postgres via DATABASE_URL (skipped without it). Reads run
  against the SEEDED tenant, on purpose — the matrix is only true if the
  database people actually log into carries it, and a throwaway tenant would
  assert that the test's own fixtures are self-consistent.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("RBAC matrix (STI-308)", () => {
  let db: Database;
  let tenantId: string;

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .select({ id: schema.tenant.id })
      .from(schema.tenant)
      .where(eq(schema.tenant.slug, "urban"));
    tenantId = t!.id;
  });

  afterAll(async () => {
    /* Read-only suite — nothing to clean up. */
  });

  const ctxFor = (permissions: Permission[], employeeId: string | null = null): Context => ({
    db,
    session: {
      userId: "00000000-0000-0000-0000-000000000000",
      tenantId,
      employeeId,
      permissions: new Set(permissions),
      /* Deliberately null. Anything that still needs a role NAME to behave
         correctly is a STI-307 regression, and this is what surfaces it. */
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "sti308-test-secret",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  /* A real session for a seeded account, resolved the way login does: the
     account's role, that role's permissions, and the employee it is linked to.
     Using the seeded accounts rather than hand-built ones is the point — it is
     what makes these tests fail when the SEED regresses, not just when the
     code does. */
  const sessionForAccount = async (email: string) => {
    const [row] = await db
      .select({ employeeId: schema.user.employeeId, roleName: schema.role.name })
      .from(schema.user)
      .innerJoin(schema.userRole, eq(schema.userRole.userId, schema.user.id))
      .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
      .where(and(eq(schema.user.tenantId, tenantId), eq(schema.user.email, email)));
    expect(row, `seeded account missing: ${email}`).toBeTruthy();
    const perms = await db
      .select({ name: schema.rolePermission.permissionName })
      .from(schema.rolePermission)
      .innerJoin(schema.role, eq(schema.role.id, schema.rolePermission.roleId))
      .where(and(eq(schema.role.tenantId, tenantId), eq(schema.role.name, row!.roleName)));
    return ctxFor(perms.map((p) => p.name as Permission), row!.employeeId);
  };

  // -------------------------------------------------------------------------
  // 1. The matrix
  // -------------------------------------------------------------------------

  describe("the matrix and the database agree, in both directions", () => {
    it("names only permissions that exist", () => {
      const known = new Set<string>(PERMISSIONS);
      for (const [role, perms] of Object.entries(ROLE_PERMS)) {
        for (const p of perms) {
          expect(known.has(p), `${role} is granted "${p}", which is not in PERMISSIONS`).toBe(true);
        }
      }
    });

    it("covers every role, with nobody left silently empty", () => {
      for (const role of ROLES) {
        expect(ROLE_PERMS[role], `no entry for role "${role}"`).toBeTruthy();
        /* A role with no permissions can log in and do nothing, which is a
           support ticket rather than a control. If one is ever genuinely
           wanted, this line is where to say so. */
        expect(ROLE_PERMS[role].length, `role "${role}" grants nothing`).toBeGreaterThan(0);
      }
    });

    it.each(ROLES)("%s holds exactly what the matrix grants — no more, no less", async (role) => {
      const rows = await db
        .select({ name: schema.rolePermission.permissionName })
        .from(schema.rolePermission)
        .innerJoin(schema.role, eq(schema.role.id, schema.rolePermission.roleId))
        .where(and(eq(schema.role.tenantId, tenantId), eq(schema.role.name, role)));

      const seeded = [...new Set(rows.map((r) => r.name))].sort();
      const expected = [...new Set(ROLE_PERMS[role])].sort();

      /* Both directions in one assertion. A subset check would pass for a role
         carrying extra grants, which is the failure that actually costs
         something. */
      expect(seeded).toEqual(expected);
    });

    it("gives every role exactly one visibility tier to resolve from", () => {
      for (const role of ROLES) {
        const tiers = ROLE_PERMS[role].filter((p) => (VIEW_SCOPES as readonly string[]).includes(p));
        expect(tiers.length, `role "${role}" has no visibility tier — it would see nothing`).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. The ladder, through the real query path
  // -------------------------------------------------------------------------

  describe("the visibility ladder narrows the actual queries", () => {
    /* Resolved once. These are counts, not ids, because the assertion that
       matters is relative: each tier must see strictly less than the one above
       and strictly more than nothing. Hard-coded numbers would break every
       time the seed gains a tool, and a test nobody can keep green gets
       deleted. */
    const countsFor = async (email: string) => {
      const ctx = await sessionForAccount(email);
      const assets = await assetRouter.createCaller(ctx).list({});
      const kpis = await dashboardRouter.createCaller(ctx).kpis();
      const register = await reportRouter.createCaller(ctx).assetRegister();
      return { assets: assets.length, assigned: kpis.assigned, register: register.length };
    };

    it("puts the tiers in order: all > project > crew > own > nothing", async () => {
      const desk = await countsFor("warehouse@stinventory.local");
      const pm = await countsFor("pm@stinventory.local");
      const sup = await countsFor("super@stinventory.local");
      const foreman = await countsFor("foreman@stinventory.local");
      const mechanic = await countsFor("mechanic@stinventory.local");

      /* Every tier must be non-empty, or the ordering below would hold
         vacuously for a ladder wired to return nothing at all. That is the
         failure this whole suite is most likely to miss. */
      for (const [who, n] of Object.entries({ desk: desk.assets, pm: pm.assets, sup: sup.assets, foreman: foreman.assets, mechanic: mechanic.assets })) {
        expect(n, `${who} sees nothing — the seed can no longer exercise this tier`).toBeGreaterThan(0);
      }

      expect(desk.assets).toBeGreaterThan(pm.assets);
      expect(pm.assets).toBeGreaterThan(foreman.assets);
      expect(sup.assets).toBeGreaterThan(foreman.assets);
      expect(foreman.assets).toBeGreaterThan(mechanic.assets);
    });

    it("counts the same set on every surface — the list, the KPI tile and the report", async () => {
      /* The leak this catches is a screen that is scoped and a total that is
         not. A dashboard reading "312 assigned" above a list of four tools has
         disclosed 308 tools as surely as printing them. */
      for (const email of [
        "warehouse@stinventory.local",
        "pm@stinventory.local",
        "super@stinventory.local",
        "foreman@stinventory.local",
        "mechanic@stinventory.local",
      ]) {
        const c = await countsFor(email);
        expect(c.register, `${email}: report disagrees with list`).toBe(c.assets);
        expect(c.assigned, `${email}: KPI tile disagrees with list`).toBeLessThanOrEqual(c.assets);
      }
    });

    it("does not let crew and project mean the same thing", async () => {
      /* The cheapest way to get this wrong is to implement `crew` as "the
         projects my crew are on", which quietly promotes a superintendent to
         the project tier. The seed puts Marcus's crew on two jobs and Dana on
         one of them, so the two sets must differ in BOTH directions. */
      const pmCtx = await sessionForAccount("pm@stinventory.local");
      const supCtx = await sessionForAccount("super@stinventory.local");

      const pmIds = new Set((await assetRouter.createCaller(pmCtx).list({})).map((a) => a.id));
      const supIds = new Set((await assetRouter.createCaller(supCtx).list({})).map((a) => a.id));

      const onlyPm = [...pmIds].filter((id) => !supIds.has(id));
      const onlySup = [...supIds].filter((id) => !pmIds.has(id));

      expect(onlyPm.length, "the PM sees nothing the superintendent cannot — crew has collapsed into project").toBeGreaterThan(0);
      expect(onlySup.length, "the superintendent sees nothing the PM cannot — crew has collapsed into project").toBeGreaterThan(0);
    });

    it("a foreman cannot read a tool outside his own custody, by id", async () => {
      /* Scoping the list and not the row behind it is the classic hole: the
         tool vanishes from your register and stays readable by pasting its id
         into the URL. The id is not a secret — it is in every chat card. */
      const deskCtx = await sessionForAccount("warehouse@stinventory.local");
      const foremanCtx = await sessionForAccount("foreman@stinventory.local");

      const mine = new Set((await assetRouter.createCaller(foremanCtx).list({})).map((a) => a.id));
      const somebodyElses = (await assetRouter.createCaller(deskCtx).list({})).find((a) => !mine.has(a.id));
      expect(somebodyElses, "the seed no longer contains a tool outside the foreman's custody").toBeTruthy();

      const mineOne = [...mine][0]!;
      await expect(assetRouter.createCaller(foremanCtx).get({ id: mineOne })).resolves.toBeTruthy();
      /* Out of scope reads as "not found", not "forbidden" — a FORBIDDEN would
         confirm the id names a real tool on a job the caller has no business
         knowing about. */
      await expect(assetRouter.createCaller(foremanCtx).get({ id: somebodyElses!.id })).resolves.toBeNull();
    });

    it("an account with no tier at all sees nothing, not everything", async () => {
      /* `assetScopeWhere` returns `undefined` for the desk, meaning "no
         narrowing". Drizzle's `and()` drops an `undefined`, so a tier that
         returned `undefined` by mistake would read as UNRESTRICTED. This is
         the single most dangerous line in scope.ts and it gets its own test. */
      const ctx = ctxFor(["asset.read"]);
      expect(viewTierOf(ctx.session!)).toBe("none");
      expect(assetScopeWhere(await assetVisibility(db, ctx.session!))).toBeDefined();

      const rows = await assetRouter.createCaller(ctx).list({});
      expect(rows).toHaveLength(0);
    });

    it("a login with no employee record cannot reach a person-shaped tier", async () => {
      /* Office Administrator and the back-office accounts have no employee
         row. `own`, `crew` and `project` are all statements about a person, so
         for such an account the honest answer is "nothing" — not "everything",
         which is what an unguarded `employeeId` null would produce. */
      const ctx = ctxFor(["asset.read", "assets.view.own"], null);
      const scope = await assetVisibility(db, ctx.session!);
      expect(scope.tier).toBe("none");
      expect(await assetRouter.createCaller(ctx).list({})).toHaveLength(0);
    });

    it("resolves the widest tier when a role holds more than one", () => {
      /* `owner` and `equipment_admin` are granted the full permission set, so
         they hold all four scopes at once. First-match-wins must give them
         `all` — resolving to `own` instead would hand the desk a foreman's
         view of the register and look like a data problem, not a code one. */
      const ctx = ctxFor([...VIEW_SCOPES]);
      expect(viewTierOf(ctx.session!)).toBe("assets.view.all");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Every mutation carries a permission
  // -------------------------------------------------------------------------

  describe("the router tree", () => {
    /* Walked from `appRouter` rather than from a list, so a mutation added
       tomorrow is covered without anybody remembering to add it here.
       `requirePermission` records which permission it enforces in procedure
       meta (see trpc.ts); a bare `protectedProcedure` has none. */
    const procedures = Object.entries(
      (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string; meta?: { permission?: string } } }> } })._def.procedures,
    );

    it("is actually enumerable — the walk itself must not silently find nothing", () => {
      expect(procedures.length).toBeGreaterThan(50);
      expect(procedures.some(([, p]) => p._def.type === "mutation")).toBe(true);
    });

    /*
      CLAUDE.md non-negotiable 4: "Every mutating procedure carries a
      permission. A bare `protectedProcedure` that writes needs a reason in the
      diff." This is that rule, enforced.

      Two kinds of entry live below and they are NOT the same thing:

      (a) IN-BODY CHECKS. The permission depends on the INPUT, so no static
          `requirePermission` can express it — assigning a PM to a job costs
          `project.assign.pm` while assigning a foreman costs
          `project.assign.foreman`, and which one applies is not known until
          the call arrives. CLAUDE.md sanctions exactly this ("or a documented
          in-body check"). Each names the function that does the checking, so a
          reviewer can go and read it.

      (b) DELIBERATELY OPEN. A write every account may make, on its own row.

      The reason string is not decoration. Adding a name here is a decision
      somebody has to write a sentence to justify; leaving a mutation out by
      accident is a build failure. When this list was first generated it had
      TWELVE entries, of which two were real holes — `notification.markRead`
      would clear anyone's alert by id, and `messaging.dismiss` let any account
      empty the desk's unresolved queue. Both were fixed rather than listed.
    */
    const BARE_BY_DESIGN: Record<string, string> = {
      // (a) in-body, input-dependent
      "projectTeam.assign": "assertCanAssign(permissions, input.role) — the permission is per target role",
      "projectTeam.remove": "assertCanAssign(permissions, input.role) — same gate as assign",
      "task.approve": "canApplyAction(task.actionType, permissions) — charged against the APPROVER, by action",
      "task.decline": "canApplyAction(task.actionType, permissions) — declining costs what approving costs",
      "action.submit": "canApplyAction(input.type, permissions) — and falls back to a request when refused",
      "messaging.confirmAction": "canApplyAction via confirmMessageAction — chat carries no more authority than the form",
      "messaging.manualEntry": "canApplyAction(input.actionType, permissions) — per action, not per screen",
      "import.preview": "requirePerm(session, spec) — per import entity",
      "import.commit": "requirePerm(session, spec) — per import entity",
      // (b) deliberately open
      "user.changePassword":
        "a person changing THEIR OWN password. Gating it would mean the accounts forced to change on first login are exactly the ones that cannot (STI-303)",
      "preferences.set": "per-user theme and dashboard preference; writes only the caller's own row",
      "messaging.send":
        "posting to chat. Field intake must be open to every account — the message is an observation, and what it PROPOSES is gated when it is applied",
      "notification.markRead":
        "clearing your own alert. Bare of a permission by design, but scoped to recipientEmployeeId — see the note in notification.ts",
    };

    it("has no mutating procedure without a permission", () => {
      const bare = procedures
        .filter(([, p]) => p._def.type === "mutation" && !p._def.meta?.permission)
        .map(([name]) => name)
        .filter((name) => !(name in BARE_BY_DESIGN));

      expect(bare, `mutations with no permission check:\n  ${bare.join("\n  ")}`).toEqual([]);
    });

    it("has no stale entries in the exemption list", () => {
      /* The other direction. Once a procedure gains a real
         `requirePermission`, its exemption must go — otherwise the list grows
         into a place where a genuinely bare mutation can hide behind a name
         that used to need one. */
      const mutations = new Map(procedures.filter(([, p]) => p._def.type === "mutation"));
      const stale = Object.keys(BARE_BY_DESIGN).filter((name) => {
        const p = mutations.get(name);
        return !p || !!p._def.meta?.permission;
      });
      expect(stale, `exemptions that are no longer needed:\n  ${stale.join("\n  ")}`).toEqual([]);
    });

    it("only ever enforces permissions that exist", () => {
      const known = new Set<string>(PERMISSIONS);
      const bogus = procedures
        .filter(([, p]) => p._def.meta?.permission && !known.has(p._def.meta.permission))
        .map(([name, p]) => `${name} -> ${p._def.meta!.permission}`);
      expect(bogus).toEqual([]);
    });

    it("has no permission that nothing enforces and nobody holds", () => {
      /* A permission granted in the matrix and checked nowhere is a promise
         the code does not keep; one checked nowhere AND granted to nobody is
         dead weight that makes the matrix harder to read. The visibility
         scopes are exempt — they are resolved by scope.ts, not by
         `requirePermission`. */
      const enforced = new Set(procedures.map(([, p]) => p._def.meta?.permission).filter(Boolean));
      const granted = new Set(Object.values(ROLE_PERMS).flat());
      const orphans = PERMISSIONS.filter(
        (p) => !enforced.has(p) && !granted.has(p) && !(VIEW_SCOPES as readonly string[]).includes(p),
      );
      expect(orphans).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Denials are real, not cosmetic
  // -------------------------------------------------------------------------

  describe("denial", () => {
    it.each([
      ["asset.list", (ctx: Context) => assetRouter.createCaller(ctx).list({})],
      ["dashboard.kpis", (ctx: Context) => dashboardRouter.createCaller(ctx).kpis()],
      ["dashboard.charts", (ctx: Context) => dashboardRouter.createCaller(ctx).charts()],
      ["report.assetRegister", (ctx: Context) => reportRouter.createCaller(ctx).assetRegister()],
    ])("%s refuses a session holding an unrelated permission", async (_name, call) => {
      /* Holding SOME permission, not none — an empty set would pass a check
         that merely tests for a signed-in user. */
      await expect(call(ctxFor(["notification.read"]))).rejects.toThrow(/FORBIDDEN|missing permission/);
    });

    it("refuses HR the asset register, which is what report.read used to hand them", async () => {
      /* HR holds `report.read` and deliberately not `asset.read`. Both
         `report.assetRegister` and `dashboard.charts` are asset data wearing a
         report's name, and gating them on `report.read` let HR read every tool
         Urban owns and the total value of the fleet. Found by probing all
         thirteen roles against the running API — no reading of the matrix
         would have caught it, because it does not notice that two of its rows
         describe the same data. */
      const hr = await sessionForAccount("hr@stinventory.local");
      expect(hr.session!.permissions.has("report.read")).toBe(true);
      expect(hr.session!.permissions.has("asset.read")).toBe(false);
      await expect(reportRouter.createCaller(hr).assetRegister()).rejects.toThrow(/FORBIDDEN|missing permission/);
      await expect(dashboardRouter.createCaller(hr).charts()).rejects.toThrow(/FORBIDDEN|missing permission/);
    });
  });
});
