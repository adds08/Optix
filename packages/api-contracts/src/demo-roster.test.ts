import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createDb, ROLE_PERMS, type Database } from "@optix/db";
import * as schema from "@optix/db/schema";
import { PERMISSIONS, type Permission } from "@optix/types";
import { appRouter } from "./index.js";
import { seedDemoTenant, type DemoSeed } from "./demo-fixtures.js";
import type { Context } from "./trpc.js";

/*
  The demo roster, built the way the real one is: one person at a time, through
  `projectTeam.assign`, top-down.

  What this file pins is the pair of facts that make an org chart trustworthy
  and that a raw INSERT would quietly get wrong:

    1. the PERSON edge — `project_team_member.reportsToEmployeeId` — reaches
       every rung, so "who is in my reporting line" has an answer; and
    2. the TIER ladder — `team_role.reportsToTeamRoleId` — is the company's own
       declaration and stays independent of any person's row.

  The authority to build it is exercised from the DIRECTOR account, which holds
  no `project.team.assign` at all: a director can staff the tiers below because
  she is above them on the ladder, which is the behaviour STI-503 shipped. An
  admin's tenant-wide grant is only used for the one row nobody can write for
  themselves — the director's own place on the job.

  Real Postgres via DATABASE_URL, throwaway tenant, cleaned up after.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("demo data: the roster and the ladder", () => {
  let db: Database;
  let seed: DemoSeed;
  let projectId: string;

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
        actorLabel: "Demo roster test",
      },
      sessionSecret: "demo-roster-test",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    } satisfies Context);

  const admin = () => caller(seed.adminUserId, null, PERMISSIONS);
  const director = () => {
    const a = seed.account("director");
    return caller(a.userId, a.employeeId, permsFor("director"));
  };

  const activeRow = (employeeId: string) =>
    db.query.projectTeamMember.findFirst({
      where: and(
        eq(schema.projectTeamMember.tenantId, seed.tenantId),
        eq(schema.projectTeamMember.projectId, projectId),
        eq(schema.projectTeamMember.employeeId, employeeId),
        isNull(schema.projectTeamMember.endedOn),
      ),
    });

  beforeAll(async () => {
    db = createDb(url!);
    seed = await seedDemoTenant(db, { name: "Demo roster", slug: `demo-roster-${crypto.randomUUID().slice(0, 8)}` });
    projectId = seed.projectId("22018");

    const directorAcc = seed.account("director");
    const pmAcc = seed.account("project_manager");
    const superAcc = seed.account("superintendent");
    const foremanAcc = seed.account("foreman");

    /* The director's own row needs the tenant-wide grant — she cannot place
       herself, and that is the one act here an admin performs. */
    await admin().projectTeam.assign({ projectId, employeeId: directorAcc.employeeId, role: "director", source: "manual_entry" });

    /* Everything below is the director's own authority, on the ladder. */
    await director().projectTeam.assign({
      projectId,
      employeeId: pmAcc.employeeId,
      role: "pm",
      source: "manual_entry",
      reportsToEmployeeId: directorAcc.employeeId,
    });
    await director().projectTeam.assign({
      projectId,
      employeeId: superAcc.employeeId,
      role: "superintendent",
      source: "manual_entry",
      reportsToEmployeeId: pmAcc.employeeId,
    });
    await director().projectTeam.assign({
      projectId,
      employeeId: foremanAcc.employeeId,
      role: "foreman",
      source: "manual_entry",
      reportsToEmployeeId: superAcc.employeeId,
    });
    await director().projectTeam.assign({
      projectId,
      employeeId: seed.employeeId("Cody Crew"),
      role: "foreman",
      source: "manual_entry",
      reportsToEmployeeId: foremanAcc.employeeId,
    });
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

  it("writes the whole person edge, rung by rung", async () => {
    const directorAcc = seed.account("director");
    const pmAcc = seed.account("project_manager");
    const superAcc = seed.account("superintendent");
    const foremanAcc = seed.account("foreman");

    expect((await activeRow(pmAcc.employeeId))?.reportsToEmployeeId).toBe(directorAcc.employeeId);
    expect((await activeRow(superAcc.employeeId))?.reportsToEmployeeId).toBe(pmAcc.employeeId);
    expect((await activeRow(foremanAcc.employeeId))?.reportsToEmployeeId).toBe(superAcc.employeeId);
    expect((await activeRow(seed.employeeId("Cody Crew")))?.reportsToEmployeeId).toBe(foremanAcc.employeeId);
    /* The top of the chain answers to nobody. */
    expect((await activeRow(directorAcc.employeeId))?.reportsToEmployeeId ?? null).toBeNull();
  });

  it("draws the same chain on the org chart", async () => {
    const chart = await director().projectTeam.orgChart();
    const edge = new Map(chart.members.map((m) => [m.employeeId, m.reportsToEmployeeId]));

    expect(edge.get(seed.account("project_manager").employeeId)).toBe(seed.account("director").employeeId);
    expect(edge.get(seed.account("superintendent").employeeId)).toBe(seed.account("project_manager").employeeId);
    expect(edge.get(seed.account("foreman").employeeId)).toBe(seed.account("superintendent").employeeId);
    expect(edge.get(seed.employeeId("Cody Crew"))).toBe(seed.account("foreman").employeeId);
  });

  it("keeps the tier ladder separate from any person's row", async () => {
    const tier = (name: string) => seed.tiers.get(name)!;
    const parentOf = async (name: string) => {
      const row = await db.query.teamRole.findFirst({ where: eq(schema.teamRole.id, tier(name)) });
      return row?.reportsToTeamRoleId ?? null;
    };

    /* Urban's own diamond: PM and superintendent are siblings under the area
       in-charge, and engineers and foremen sit beneath the superintendent. */
    expect(await parentOf("director")).toBeNull();
    expect(await parentOf("area_in_charge")).toBe(tier("director"));
    expect(await parentOf("pm")).toBe(tier("area_in_charge"));
    expect(await parentOf("superintendent")).toBe(tier("area_in_charge"));
    expect(await parentOf("foreman")).toBe(tier("superintendent"));
  });

  it("surfaces the Set-by rows the authority gate reads", async () => {
    const roles = await director().projectTeam.roles.list();
    const byName = new Map(roles.map((r) => [r.name, r]));
    const nameOf = (id: string) => roles.find((r) => r.id === id)?.name;

    /* A superintendent is who fills a foreman slot; the dedicated
       `project.assign.*` permissions that used to say so were removed. */
    const foremanAssigners = byName.get("foreman")!.assignerTeamRoleIds.map(nameOf);
    expect(foremanAssigners).toContain("superintendent");
  });

  it("refuses a foreman the authority to place a PM", async () => {
    /* A foreman is neither above a PM on the ladder nor in its "Set by" set.
       The refusal is the property that keeps this a hierarchy. */
    const foremanAcc = seed.account("foreman");
    await expect(
      caller(foremanAcc.userId, foremanAcc.employeeId, permsFor("foreman")).projectTeam.assign({
        projectId,
        employeeId: seed.employeeId("Gina Foreman"),
        role: "pm",
        source: "manual_entry",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is idempotent — re-placing somebody is a no-op, not a second row", async () => {
    const pmAcc = seed.account("project_manager");
    const before = await db
      .select({ id: schema.projectTeamMember.id })
      .from(schema.projectTeamMember)
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, seed.tenantId),
          eq(schema.projectTeamMember.projectId, projectId),
          eq(schema.projectTeamMember.employeeId, pmAcc.employeeId),
        ),
      );

    const res = await director().projectTeam.assign({
      projectId,
      employeeId: pmAcc.employeeId,
      role: "pm",
      source: "manual_entry",
      reportsToEmployeeId: seed.account("director").employeeId,
    });
    expect(res).toMatchObject({ alreadyAssigned: true });

    const after = await db
      .select({ id: schema.projectTeamMember.id })
      .from(schema.projectTeamMember)
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, seed.tenantId),
          eq(schema.projectTeamMember.projectId, projectId),
          eq(schema.projectTeamMember.employeeId, pmAcc.employeeId),
        ),
      );
    expect(after.length).toBe(before.length);
  });
});
