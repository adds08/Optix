import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { projectTeamRouter } from "./routers/projectTeam.js";
import type { Context } from "./trpc.js";

/*
  "Set by" (STI-503) — the real Postgres exercise of the mechanism designed
  and reviewed in the 2026-09-09 conversation.

  The claim under test: a tenant's own tier (Director, Area In-charge — no
  dedicated `project.assign.*` permission, since `Permission` is fixed code)
  can gain assign authority through DATA (`team_role_assigner`) instead of
  code, WITHOUT taking anything away from the three built-in tiers' existing
  permission-based path. Both halves are asserted, because a mechanism that
  only proves the addition and never re-checks the thing it promised not to
  touch is exactly the drift `BUILT_IN_PERM`'s own comment warns about.

  Real Postgres via DATABASE_URL, throwaway tenant — following
  `project-team-move.test.ts`'s shape (a direct `projectTeamRouter.createCaller`
  rather than the full HTTP stack, since this is a router-level authorisation
  question, not a wire-format one).
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("team-role Set-by (STI-503)", () => {
  let db: Database;
  let tenantId: string;
  let actorUserId: string;
  let projectA: string;
  let projectB: string;
  let directorTierId: string;
  let areaInChargeTierId: string;
  let pmTierId: string;
  let openTierId: string;

  const suffix = crypto.randomUUID().slice(0, 8);

  /* One real row: `assigned_by_user_id` is a hard FK into `tbl_entity_user`,
     so a caller's `userId` has to name a row that exists — who is signed in
     is not what this file exercises, so every case reuses the same one. */
  function ctxFor(opts: { employeeId: string | null; permissions: Permission[] }): Context {
    return {
      db,
      session: {
        userId: actorUserId,
        tenantId,
        employeeId: opts.employeeId,
        permissions: new Set(opts.permissions),
        roleName: null,
        actorLabel: null,
      },
      sessionSecret: "team-role-set-by-secret",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    };
  }

  const callerFor = (opts: { employeeId: string | null; permissions: Permission[] }) =>
    projectTeamRouter.createCaller(ctxFor(opts));

  async function makeEmployee(name: string) {
    const [row] = await db
      .insert(schema.employee)
      .values({ tenantId, name, employmentStatus: "active" })
      .returning({ id: schema.employee.id });
    return row!.id;
  }

  /** Put an employee on a project in a tier directly — bypassing the router
      being tested, so the fixture cannot accidentally depend on the very
      authorisation it exists to exercise. */
  async function seatOnProject(employeeId: string, projectId: string, role: string) {
    await db.insert(schema.projectTeamMember).values({
      tenantId,
      projectId,
      employeeId,
      role,
      startedOn: new Date().toISOString().slice(0, 10),
      source: "manual",
    });
  }

  const rosterRow = (projectId: string, employeeId: string, role: string) =>
    db.query.projectTeamMember.findFirst({
      where: and(
        eq(schema.projectTeamMember.tenantId, tenantId),
        eq(schema.projectTeamMember.projectId, projectId),
        eq(schema.projectTeamMember.employeeId, employeeId),
        eq(schema.projectTeamMember.role, role),
      ),
    });

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "set-by test", slug: `setby-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    const [pm] = await db
      .insert(schema.teamRole)
      .values({ tenantId, name: "pm", label: "Project Manager", canHoldCustody: false, isSystem: true })
      .returning({ id: schema.teamRole.id });
    pmTierId = pm!.id;

    const [director] = await db
      .insert(schema.teamRole)
      .values({ tenantId, name: "director", label: "Director", canHoldCustody: false, isSystem: false })
      .returning({ id: schema.teamRole.id });
    directorTierId = director!.id;

    const [areaInCharge] = await db
      .insert(schema.teamRole)
      .values({ tenantId, name: "area_in_charge", label: "Area In-charge", canHoldCustody: false, isSystem: false })
      .returning({ id: schema.teamRole.id });
    areaInChargeTierId = areaInCharge!.id;

    const [open] = await db
      .insert(schema.teamRole)
      .values({
        tenantId,
        name: "safety_officer",
        label: "Safety Officer",
        canHoldCustody: false,
        isSystem: false,
        assignableByEveryone: true,
      })
      .returning({ id: schema.teamRole.id });
    openTierId = open!.id;

    /* "Director" may place someone into "Area In-charge" — the exact case
       from the conversation this ships from: the tier has no
       `project.assign.*` permission and previously had no path at all. */
    await db.insert(schema.teamRoleAssigner).values({
      teamRoleId: areaInChargeTierId,
      assignerTeamRoleId: directorTierId,
    });

    const projects = await db
      .insert(schema.project)
      .values([
        { tenantId, name: "Job A", code: `A-${suffix}`, startDate: "2026-01-01" },
        { tenantId, name: "Job B", code: `B-${suffix}`, startDate: "2026-01-01" },
      ])
      .returning({ id: schema.project.id });
    projectA = projects[0]!.id;
    projectB = projects[1]!.id;

    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `setby-${suffix}@test.local`, passwordHash: "x", firstName: "Set", lastName: "By" })
      .returning({ id: schema.user.id });
    actorUserId = u!.id;
  });

  afterAll(async () => {
    await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
  });

  it("refuses a tenant tier with no permission and no Set-by grant", async () => {
    const director = await makeEmployee("No Grant Director");
    await seatOnProject(director, projectA, "director");
    const target = await makeEmployee("Nobody Yet");

    await expect(
      callerFor({ employeeId: director, permissions: [] }).assign({
        projectId: projectA,
        employeeId: target,
        role: "pm", // pm has NO Set-by row granting director — only area_in_charge does
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a Set-by grant lets a tenant tier assign, on the project it holds that tier", async () => {
    const director = await makeEmployee("Grant Director");
    await seatOnProject(director, projectA, "director");
    const areaManager = await makeEmployee("New Area Manager");

    await callerFor({ employeeId: director, permissions: [] }).assign({
      projectId: projectA,
      employeeId: areaManager,
      role: "area_in_charge",
    });

    const row = await rosterRow(projectA, areaManager, "area_in_charge");
    expect(row).toBeTruthy();
  });

  it("the SAME grant refuses on a DIFFERENT project — authority is tier-on-that-job, not tenant-wide", async () => {
    const director = await makeEmployee("Two Job Director");
    /* Holds "director" on A only. */
    await seatOnProject(director, projectA, "director");
    const areaManager = await makeEmployee("Cross-Project Target");

    await expect(
      callerFor({ employeeId: director, permissions: [] }).assign({
        projectId: projectB,
        employeeId: areaManager,
        role: "area_in_charge",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("holding the granted tier on ANOTHER project does not count on THIS one", async () => {
    const director = await makeEmployee("Wrong Project Director");
    /* Holds "director" on B, tries to assign on A. */
    await seatOnProject(director, projectB, "director");
    const target = await makeEmployee("Should Stay Unassigned");

    await expect(
      callerFor({ employeeId: director, permissions: [] }).assign({
        projectId: projectA,
        employeeId: target,
        role: "area_in_charge",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await rosterRow(projectA, target, "area_in_charge")).toBeUndefined();
  });

  it("assignableByEveryone admits a caller holding no tier and no permission at all", async () => {
    const nobody = await makeEmployee("Ordinary Nobody");
    /* Not seated on the project at all — the wildcard is meant to mean
       exactly "no tier check applies". */
    const target = await makeEmployee("Safety Hire");

    await callerFor({ employeeId: nobody, permissions: [] }).assign({
      projectId: projectA,
      employeeId: target,
      role: "safety_officer",
    });

    expect(await rosterRow(projectA, target, "safety_officer")).toBeTruthy();
  });

  it("REGRESSION: an existing dedicated permission still works with an EMPTY Set-by list — nothing was taken away", async () => {
    /* "pm" has zero rows in team_role_assigner in this fixture. Before
       STI-503 this permission was the ONLY path; it must still be A path. */
    const admin = await makeEmployee("Admin Account Person");
    const target = await makeEmployee("New PM");

    await callerFor({ employeeId: admin, permissions: ["project.assign.pm"] }).assign({
      projectId: projectA,
      employeeId: target,
      role: "pm",
    });

    expect(await rosterRow(projectA, target, "pm")).toBeTruthy();
  });

  it("REGRESSION: holding the target tier itself, with no grant and no permission, still refuses", async () => {
    /* Holding "pm" on the project is not the same as being GRANTED authority
       over "pm" — nothing here should let a tier assign into ITSELF by
       default. (It could, if someone deliberately granted it — not tested
       here, since that is the same mechanism as any other grant.) */
    const pmHolder = await makeEmployee("Existing PM");
    await seatOnProject(pmHolder, projectA, "pm");
    const target = await makeEmployee("Another PM Hopeful");

    await expect(
      callerFor({ employeeId: pmHolder, permissions: [] }).assign({
        projectId: projectA,
        employeeId: target,
        role: "pm",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
