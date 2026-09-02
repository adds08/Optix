import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { moveCustody } from "./custody.js";
import { projectTeamRouter } from "./routers/projectTeam.js";
import type { Context } from "./trpc.js";

/*
  Moving a crew between jobs, and what happens to the tools.

  `project.team.assign` has always moved the tools with the person — the rule
  that makes small tools different from plant: they belong to the foreman, not
  the site. That is still the default and still what nearly every move wants.

  What is new is the other answer. A crew leaving a job sometimes leaves its
  tools ON that job, and before 2026-09-01 the screen had no way to say so:
  the tools travelled, or the move did not happen. Ticking the box off now
  RELEASES them — custodian cleared, project and location untouched — which is
  the "nobody holding" state the jobsite cards already draw.

  The trap this file exists for is that "leave the tools" reads like doing
  nothing, and doing nothing is wrong. Left alone, the tools keep the departing
  person as custodian while they work somewhere else, so the register names a
  holder who is not there — the STI-306 failure arriving through another door.
  So the assertions below are about what was WRITTEN, not about what was
  skipped.

  Real Postgres via DATABASE_URL, throwaway tenant.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("moving a crew between jobs", () => {
  let db: Database;
  let tenantId: string;
  let actorUserId: string;
  let jobA: string;
  let jobB: string;

  const suffix = crypto.randomUUID().slice(0, 8);

  const ctx = (): Context => ({
    db,
    session: {
      userId: actorUserId,
      tenantId,
      employeeId: null,
      permissions: new Set<Permission>([
        "project.assign.foreman",
        "project.assign.superintendent",
        "project.assign.pm",
        "project.team.read",
      ]),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "project-team-move-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  const caller = () => projectTeamRouter.createCaller(ctx());

  async function makePerson(name: string, role: string, primaryProjectId: string) {
    const [row] = await db
      .insert(schema.employee)
      .values({ tenantId, name, role, employmentStatus: "active", primaryProjectId })
      .returning({ id: schema.employee.id });
    return row!.id;
  }

  /* A tool in somebody's hands on a job — asset row plus the open custody link,
     written through custody.ts so the fixture cannot create a shape the
     application never would. */
  async function giveTool(custodianId: string, projectId: string, description: string) {
    const [row] = await db
      .insert(schema.asset)
      .values({ tenantId, description, currentStatus: "assigned", currentCustodianId: custodianId, currentProjectId: projectId })
      .returning({ id: schema.asset.id });
    const assetId = row!.id;
    await db.transaction(async (tx) => {
      await moveCustody(tx, {
        tenantId,
        assetId,
        toCustodianId: custodianId,
        projectId,
        locationId: null,
        truckId: null,
        trailerId: null,
        actorUserId,
      });
    });
    return assetId;
  }

  const assetRow = (id: string) =>
    db.query.asset.findFirst({ where: and(eq(schema.asset.id, id), eq(schema.asset.tenantId, tenantId)) });

  const activeLinks = async (assetId: string) =>
    db
      .select({ id: schema.assignment.id })
      .from(schema.assignment)
      .where(
        and(
          eq(schema.assignment.tenantId, tenantId),
          eq(schema.assignment.assetId, assetId),
          eq(schema.assignment.status, "active"),
        ),
      );

  const newestEvent = async (assetId: string) => {
    const [row] = await db
      .select({ eventType: schema.transaction.eventType, toState: schema.transaction.toState })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.tenantId, tenantId), eq(schema.transaction.assetId, assetId)))
      .orderBy(desc(schema.transaction.occurredAt), desc(schema.transaction.id))
      .limit(1);
    return row;
  };

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: "crew move test", slug: `crewmove-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    /* `projectTeamRouter.assign`/`remove` resolve the target role against
       this register since 2026-09-03 — a throwaway tenant with none of the
       three built-in rows cannot assign a foreman at all. */
    await db.insert(schema.teamRole).values([
      { tenantId, name: "pm", label: "Project Manager", canHoldCustody: false, isSystem: true },
      { tenantId, name: "superintendent", label: "Superintendent", canHoldCustody: true, isSystem: true },
      { tenantId, name: "foreman", label: "Foreman", canHoldCustody: true, isSystem: true },
    ]);

    const projects = await db
      .insert(schema.project)
      .values([
        { tenantId, name: `Job A ${suffix}`, startDate: "2025-01-06" },
        { tenantId, name: `Job B ${suffix}`, startDate: "2025-01-06" },
      ])
      .returning({ id: schema.project.id, name: schema.project.name });
    jobA = projects.find((p) => p.name.startsWith("Job A"))!.id;
    jobB = projects.find((p) => p.name.startsWith("Job B"))!.id;

    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email: `crewmove-${suffix}@test.local`, passwordHash: "x", firstName: "Crew", lastName: "Mover" })
      .returning({ id: schema.user.id });
    actorUserId = u!.id;
  });

  afterAll(async () => {
    if (db && tenantId) {
      /* Ledger rows are written here, so the cascade delete needs the
         sanctioned transactional trigger disable (migration 0014) — the same
         teardown departure.test.ts uses, for the same reason. */
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" DISABLE TRIGGER transaction_no_update_delete`);
        await tx.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
        await tx.execute(sql`ALTER TABLE "tbl_ops_transaction" ENABLE TRIGGER transaction_no_update_delete`);
      });
    }
    await db?.$client.end();
  });

  it("takes the tools to the new job by default", async () => {
    const fm = await makePerson(`Follow ${suffix}`, "foreman", jobA);
    const tool = await giveTool(fm, jobA, "drill that follows");

    await caller().assign({ projectId: jobB, employeeId: fm, role: "foreman" });

    const a = await assetRow(tool);
    expect(a!.currentProjectId).toBe(jobB);
    /* Still theirs — a move of job is not a change of holder. */
    expect(a!.currentCustodianId).toBe(fm);
  });

  it("releases the tools onto the old job when the box is unticked", async () => {
    const fm = await makePerson(`Leave ${suffix}`, "foreman", jobA);
    const tool = await giveTool(fm, jobA, "drill left behind");

    await caller().assign({ projectId: jobB, employeeId: fm, role: "foreman", moveTools: false });

    const a = await assetRow(tool);
    /* The three things that together mean "left on the job, nobody holding". */
    expect(a!.currentCustodianId).toBeNull();
    expect(a!.currentProjectId).toBe(jobA);
    /* `assigned` is the one status that is a claim about a custodian, so it
       cannot outlive the custodian being cleared. */
    expect(a!.currentStatus).toBe("available");

    /* The custody link is CLOSED, not orphaned. A row left active with a
       cleared projection is the divergence the boot sweep raises. */
    expect(await activeLinks(tool)).toHaveLength(0);
  });

  it("writes a complete snapshot for the release, so a rebuild does not blank it", async () => {
    const fm = await makePerson(`Snapshot ${suffix}`, "foreman", jobA);
    const tool = await giveTool(fm, jobA, "drill with a snapshot");

    await caller().assign({ projectId: jobB, employeeId: fm, role: "foreman", moveTools: false });

    const ev = await newestEvent(tool);
    expect(ev!.eventType).toBe("custodian_change");
    const to = ev!.toState as Record<string, unknown>;
    /* The fold REPLACES rather than merges, so every key has to be present —
       this is the partial-snapshot bug that has shipped three times. Truck and
       trailer are affirmative nulls: the rig left with the foreman, and an
       ABSENT key would fold to "not recorded" and keep quoting the old one. */
    expect(to).toHaveProperty("custodianId", null);
    expect(to).toHaveProperty("projectId", jobA);
    expect(to).toHaveProperty("status", "available");
    expect(to).toHaveProperty("truckId", null);
    expect(to).toHaveProperty("trailerId", null);
    expect(Object.keys(to)).toContain("locationId");
  });

  it("moves a superintendent's tools too, now that they can hold them", async () => {
    /* `TOOLS_FOLLOW` gained `superintendent` on 2026-09-01: a job is often
       rigged before its foreman is hired and the super holds the tools until
       then, so their project link has to move custody the way a foreman's
       does. Before this it was a roster entry only, and the tools stayed
       booked to whatever job they were rigged on. */
    const sup = await makePerson(`Super ${suffix}`, "superintendent", jobA);
    const tool = await giveTool(sup, jobA, "drill held by a super");

    await caller().assign({ projectId: jobB, employeeId: sup, role: "superintendent" });

    const a = await assetRow(tool);
    expect(a!.currentProjectId).toBe(jobB);
    expect(a!.currentCustodianId).toBe(sup);
  });

  it("stamps the provenance of the roster row it opens", async () => {
    const fm = await makePerson(`Source ${suffix}`, "foreman", jobA);
    await caller().assign({ projectId: jobB, employeeId: fm, role: "foreman", source: "payroll_import" });

    const [row] = await db
      .select({ source: schema.projectTeamMember.source })
      .from(schema.projectTeamMember)
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tenantId),
          eq(schema.projectTeamMember.employeeId, fm),
          eq(schema.projectTeamMember.projectId, jobB),
        ),
      );
    expect(row!.source).toBe("payroll_import");
  });

  it("defaults provenance to the equipment department when nobody says", async () => {
    const fm = await makePerson(`Default ${suffix}`, "foreman", jobA);
    await caller().assign({ projectId: jobB, employeeId: fm, role: "foreman" });

    const [row] = await db
      .select({ source: schema.projectTeamMember.source })
      .from(schema.projectTeamMember)
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tenantId),
          eq(schema.projectTeamMember.employeeId, fm),
          eq(schema.projectTeamMember.projectId, jobB),
        ),
      );
    expect(row!.source).toBe("equipment_department");
  });
});
