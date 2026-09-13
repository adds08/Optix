import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, ROLE_PERMS, type Database } from "@optix/db";
import * as schema from "@optix/db/schema";
import { PERMISSIONS, type Permission } from "@optix/types";
import { appRouter } from "./index.js";
import { visibleProjectScope } from "./scope.js";
import { seedDemoTenant, type DemoSeed } from "./demo-fixtures.js";
import type { Context } from "./trpc.js";

/*
  The demo roster through the visibility ladder: a foreman, a superintendent and
  a PM each look at the register and see only the work they touch.

  Two jobs, staffed differently, is the smallest setup in which "sees their own"
  is distinguishable from "sees everything" and from "sees nothing":

    Lone Star   director → PM → superintendent → foreman
    NEX         a second foreman, on a job none of the three above are on

  Nothing here asserts a role NAME. The ladder is four `assets.view.*`
  permissions and a role is only a bundle of them, so the tests build each
  caller's permission set from `ROLE_PERMS` and let `visibleProjectScope`
  decide. That is the same guarantee `project-scope.test.ts` makes for the
  seeded shapes; this one runs it against the demo dataset the manual pass
  uses.

  Real Postgres via DATABASE_URL, throwaway tenant, cleaned up after.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("demo data: foreman vs superintendent vs PM visibility", () => {
  let db: Database;
  let seed: DemoSeed;
  let theirJob: string;
  let otherJob: string;

  const permsFor = (role: string): Permission[] =>
    [...(ROLE_PERMS[role as keyof typeof ROLE_PERMS] ?? [])] as Permission[];

  const caller = (userId: string, employeeId: string | null, perms: readonly Permission[]) =>
    appRouter.createCaller({
      db,
      session: {
        userId,
        tenantId: seed.tenantId,
        employeeId,
        permissions: new Set(perms),
        roleName: null,
        actorLabel: "Demo scope test",
      },
      sessionSecret: "demo-scope-test",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    } satisfies Context);

  const as = (role: string) => {
    const a = seed.account(role);
    return caller(a.userId, a.employeeId, permsFor(role));
  };

  beforeAll(async () => {
    db = createDb(url!);
    seed = await seedDemoTenant(db, { name: "Demo scope", slug: `demo-scope-${crypto.randomUUID().slice(0, 8)}` });
    theirJob = seed.projectId("22018");
    otherJob = seed.projectId("22017");

    const admin = caller(seed.adminUserId, null, PERMISSIONS);
    const director = seed.account("director");
    const pm = seed.account("project_manager");
    const sup = seed.account("superintendent");
    const foreman = seed.account("foreman");

    /* Lone Star, staffed top-down. */
    await admin.projectTeam.assign({ projectId: theirJob, employeeId: director.employeeId, role: "director", source: "manual_entry" });
    await admin.projectTeam.assign({ projectId: theirJob, employeeId: pm.employeeId, role: "pm", source: "manual_entry", reportsToEmployeeId: director.employeeId });
    await admin.projectTeam.assign({ projectId: theirJob, employeeId: sup.employeeId, role: "superintendent", source: "manual_entry", reportsToEmployeeId: pm.employeeId });
    await admin.projectTeam.assign({ projectId: theirJob, employeeId: foreman.employeeId, role: "foreman", source: "manual_entry", reportsToEmployeeId: sup.employeeId });

    /* NEX: a different crew, on a job none of the above are placed on. */
    await admin.projectTeam.assign({ projectId: otherJob, employeeId: seed.employeeId("Gina Foreman"), role: "foreman", source: "manual_entry" });
  });

  afterAll(async () => {
    if (db && seed?.tenantId) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, seed.tenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("a PM sees the job they run, and NOT the one they do not", async () => {
    const pm = seed.account("project_manager");
    const scope = await visibleProjectScope(db, {
      userId: pm.userId,
      tenantId: seed.tenantId,
      employeeId: pm.employeeId,
      permissions: new Set(permsFor("project_manager")),
      roleName: null,
      actorLabel: null,
    });
    expect(scope.restrict).toBe(true);
    expect(scope.ids.has(theirJob)).toBe(true);
    expect(scope.ids.has(otherJob)).toBe(false);

    const names = (await as("project_manager").project.list()).map((p) => p.name);
    expect(names).toContain("Lone Star I-35 East Phase 2");
    expect(names).not.toContain("Alamo NEX Seg N-2");
  });

  it("a superintendent sees the jobs their crew is working", async () => {
    const sup = seed.account("superintendent");
    const scope = await visibleProjectScope(db, {
      userId: sup.userId,
      tenantId: seed.tenantId,
      employeeId: sup.employeeId,
      permissions: new Set(permsFor("superintendent")),
      roleName: null,
      actorLabel: null,
    });
    expect(scope.ids.has(theirJob)).toBe(true);
    expect(scope.ids.has(otherJob)).toBe(false);
  });

  it("a foreman sees only the job they are posted to", async () => {
    const foreman = seed.account("foreman");
    const scope = await visibleProjectScope(db, {
      userId: foreman.userId,
      tenantId: seed.tenantId,
      employeeId: foreman.employeeId,
      permissions: new Set(permsFor("foreman")),
      roleName: null,
      actorLabel: null,
    });
    /* `assets.view.own` is about what is in their hands, and the job they are
       posted to is the one that can hold it. */
    expect(scope.ids.has(theirJob)).toBe(true);
    expect(scope.ids.has(otherJob)).toBe(false);
  });

  it("the equipment desk is the rung that does not restrict", async () => {
    const hr = seed.account("hr");
    const scope = await visibleProjectScope(db, {
      userId: hr.userId,
      tenantId: seed.tenantId,
      employeeId: hr.employeeId,
      permissions: new Set(permsFor("hr")),
      roleName: null,
      actorLabel: null,
    });
    expect(scope.restrict).toBe(false);
  });

  it("the roster a superintendent reads is scoped the same way", async () => {
    /* The same ladder applied to `projectTeam.all`, which the Jobsites hub
       reads. A superintendent who could see their job but not list its crew —
       or could list another job's — would be the two answers drifting apart. */
    const rows = await as("superintendent").projectTeam.all();
    expect(rows.map((r) => r.projectId)).toEqual([theirJob]);
    expect(rows[0]!.members.map((m) => m.role)).toContain("foreman");
  });
});
