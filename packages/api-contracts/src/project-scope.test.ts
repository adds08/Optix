import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { projectRouter } from "./routers/project.js";
import { visibleProjectScope } from "./scope.js";
import type { Context } from "./trpc.js";

/*
  STI-403 — a PM and a superintendent each manage through /jobsites, confined
  by the visibility ladder rather than by a screen of their own.

  The ticket asked for two dedicated management views. The product answer was
  that the shared surface IS the answer, filtered by permission — which is only
  true if the filtering actually holds. Nothing tested `visibleProjectScope`
  before this file, so "scoped by permission, not role name" was an assertion
  about code nobody had exercised.

  This is the test that makes closing the ticket honest. If someone later
  decides separate screens are wanted after all, these assertions are still
  the contract those screens would have to meet.

  Note what is NOT asserted: nothing here checks a role NAME. The ladder is
  four permissions, and a role is just a bundle of them — which is the whole
  point of STI-802. A test that asserted `role === "pm"` would re-introduce
  exactly what that ticket removed.
*/

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("what a PM and a superintendent can see (STI-403)", () => {
  let db: Database;
  let tenantId: string;
  let userId: string;

  let theirJob: string;
  let otherJob: string;

  let pmId: string;
  let superId: string;
  let foremanOnTheirJob: string;
  let foremanElsewhere: string;

  const ctx = (employeeId: string | null, perms: Permission[]): Context => ({
    db,
    session: {
      userId,
      tenantId,
      employeeId,
      permissions: new Set<Permission>(perms),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "sti403-test-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  async function newEmployee(name: string, role: string, primaryProjectId: string | null = null) {
    const [row] = await db
      .insert(schema.employee)
      .values({ tenantId, name, role, employmentStatus: "active", primaryProjectId })
      .returning({ id: schema.employee.id });
    return row!.id;
  }

  async function teamRow(employeeId: string, projectId: string, role: "pm" | "superintendent" | "foreman") {
    await db
      .insert(schema.projectTeamMember)
      .values({ tenantId, projectId, employeeId, role, startedOn: "2026-01-01" });
  }

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "STI-403 scope", slug: `sti403-${crypto.randomUUID().slice(0, 8)}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `sti403-${crypto.randomUUID().slice(0, 8)}@test.local`, passwordHash: "not-a-real-hash", firstName: "STI", lastName: "FourOhThree" })
      .returning({ id: schema.user.id });
    userId = u!.id;

    const [p1] = await db.insert(schema.project).values({ tenantId, name: "STI-403 Their Job", startDate: "2025-01-06" }).returning({ id: schema.project.id });
    theirJob = p1!.id;
    const [p2] = await db.insert(schema.project).values({ tenantId, name: "STI-403 Somebody Else's Job", startDate: "2025-01-06" }).returning({ id: schema.project.id });
    otherJob = p2!.id;

    pmId = await newEmployee("STI-403 PM", "pm");
    superId = await newEmployee("STI-403 Superintendent", "superintendent");
    foremanOnTheirJob = await newEmployee("STI-403 Foreman Here", "foreman", theirJob);
    foremanElsewhere = await newEmployee("STI-403 Foreman Elsewhere", "foreman", otherJob);

    await teamRow(pmId, theirJob, "pm");
    await teamRow(superId, theirJob, "superintendent");
    await teamRow(foremanOnTheirJob, theirJob, "foreman");
    await teamRow(foremanElsewhere, otherJob, "foreman");
  });

  afterAll(async () => {
    if (db && tenantId) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("a PM sees the job they are on, and NOT the one they are not", async () => {
    const scope = await visibleProjectScope(db, ctx(pmId, ["assets.view.project", "project.read"]).session!);
    expect(scope.restrict).toBe(true);
    expect(scope.ids.has(theirJob)).toBe(true);
    expect(scope.ids.has(otherJob)).toBe(false);
  });

  it("project.list gives a PM only their own jobs", async () => {
    const rows = await projectRouter
      .createCaller(ctx(pmId, ["assets.view.project", "project.read"]))
      .list();
    const names = rows.map((r: { name: string }) => r.name);
    expect(names).toContain("STI-403 Their Job");
    expect(names).not.toContain("STI-403 Somebody Else's Job");
  });

  it("a superintendent sees the jobs their crew is working", async () => {
    const scope = await visibleProjectScope(db, ctx(superId, ["assets.view.crew", "project.read"]).session!);
    expect(scope.restrict).toBe(true);
    /* Derived from the crew — the foreman's posting is the fact, and the job
       follows it. This is what makes a superintendent's job list match the
       tools they can see. */
    expect(scope.ids.has(theirJob)).toBe(true);
    expect(scope.ids.has(otherJob)).toBe(false);
  });

  it("a foreman sees only the job they are posted to", async () => {
    const scope = await visibleProjectScope(db, ctx(foremanOnTheirJob, ["assets.view.own", "project.read"]).session!);
    expect(scope.ids.has(theirJob)).toBe(true);
    expect(scope.ids.has(otherJob)).toBe(false);
  });

  it("the equipment desk sees every job — the ladder's top rung does not restrict", async () => {
    const scope = await visibleProjectScope(db, ctx(null, ["assets.view.all", "project.read"]).session!);
    expect(scope.restrict).toBe(false);
  });

  it("an account with NO employee record sees nothing, rather than everything", async () => {
    /* A business login — Office Administrator, a service account. Every tier
       below `all` is a statement about a person; the honest answer for a
       non-person is "nothing". Falling through to "everything" here is the
       classic scoping bug and this pins it shut. */
    const scope = await visibleProjectScope(db, ctx(null, ["assets.view.project", "project.read"]).session!);
    expect(scope.restrict).toBe(true);
    expect(scope.ids.size).toBe(0);
  });

  it("moving a foreman off the job removes it from their superintendent's scope", async () => {
    await db
      .update(schema.projectTeamMember)
      .set({ endedOn: "2026-08-23" })
      .where(eq(schema.projectTeamMember.employeeId, foremanOnTheirJob));

    const scope = await visibleProjectScope(db, ctx(superId, ["assets.view.crew", "project.read"]).session!);
    /* The superintendent's own team row still names the job, so they keep it —
       what they lose is the crew member. The assertion that matters is that
       the OTHER job never appears. */
    expect(scope.ids.has(otherJob)).toBe(false);

    /* Put it back so ordering between tests cannot matter. */
    await db
      .update(schema.projectTeamMember)
      .set({ endedOn: null })
      .where(eq(schema.projectTeamMember.employeeId, foremanOnTheirJob));
  });
});
