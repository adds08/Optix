import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createDb, ROLE_PERMS, type Database } from "@optix/db";
import * as schema from "@optix/db/schema";
import type { Permission } from "@optix/types";
import { appRouter } from "./index.js";
import { seedDemoTenant, type DemoSeed } from "./demo-fixtures.js";
import type { Context } from "./trpc.js";

/*
  What each demo account is asked for on first sign-in — the "onboarding differs
  by role" promise, made checkable.

  The wizard is not a second writer. `onboarding.state()` COMPUTES the steps
  from what is already true: whether the role gets the equipment wizard at all
  (`role.onboardingKind`), whether the person is on a job (`project_team_member`)
  and whether they hold a claim grant (`role.claimTierNames`). So these tests
  seed the demo tenant, claim and assign with the SAME routers a person would
  use, and assert what the next account would see.

  The five stories:
    director        the claimer — picks the jobs it runs, then staffs them
    PM / super      no job yet and no claim grant → review only
    foreman         skips the wizard entirely (`onboardingKind: none`)
    HR              the PEOPLE review, never the equipment wizard

  Real Postgres via DATABASE_URL, throwaway tenant, cleaned up after.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("demo data: onboarding differs by role", () => {
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
        actorLabel: "Demo onboarding test",
      },
      sessionSecret: "demo-onboarding-test",
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
    seed = await seedDemoTenant(db, { name: "Demo onboarding", slug: `demo-onboarding-${crypto.randomUUID().slice(0, 8)}` });
    projectId = seed.projectId("22018");
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

  it("the director claims a job, and is offered the projects and crew steps", async () => {
    const before = await as("director").onboarding.state();
    expect(before.onboardingKind).toBe("equipment");
    expect(before.canClaim).toBe(true);
    expect(before.onAnyJob).toBe(false);
    /* The claimer walks the full wizard, crew step included because a director
       holds `project.team.read`. */
    expect(before.steps).toEqual(["projects", "crew", "review"]);

    const options = await as("director").onboarding.claimOptions();
    expect(options.projects.map((p) => p.id)).toContain(projectId);
    expect(options.tiers.map((t) => t.name)).toEqual(["director"]);

    await as("director").onboarding.claimProject({ projectId, tier: "director" });

    /* A claim is a real roster row, not a note about intent. */
    const row = await db.query.projectTeamMember.findFirst({
      where: and(
        eq(schema.projectTeamMember.tenantId, seed.tenantId),
        eq(schema.projectTeamMember.projectId, projectId),
        eq(schema.projectTeamMember.employeeId, seed.account("director").employeeId),
        isNull(schema.projectTeamMember.endedOn),
      ),
    });
    expect(row?.role).toBe("director");

    const after = await as("director").onboarding.state();
    expect(after.onAnyJob).toBe(true);
    expect(after.steps).toEqual(["projects", "crew", "review"]);
  });

  it("a PM and a superintendent with no job yet get the review step only", async () => {
    for (const role of ["project_manager", "superintendent"]) {
      const state = await as(role).onboarding.state();
      expect(state.onboardingKind, role).toBe("equipment");
      expect(state.canClaim, role).toBe(false);
      expect(state.onAnyJob, role).toBe(false);
      expect(state.steps, role).toEqual(["review"]);
      /* Needed the wizard, cannot start one yet: the honest prompt. */
      expect(state.needsSetup, role).toBe(true);
    }
  });

  it("the claim grant is what opens claiming — a PM is refused it", async () => {
    expect((await as("project_manager").onboarding.claimOptions()).tiers).toEqual([]);
    await expect(
      as("project_manager").onboarding.claimProject({ projectId, tier: "pm" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the foreman skips the wizard entirely", async () => {
    const state = await as("foreman").onboarding.state();
    expect(state.onboardingKind).toBe("none");
    expect(state.needsSetup).toBe(false);
    expect(state.shouldPrompt).toBe(false);
    expect(state.canClaim).toBe(false);
  });

  it("HR gets the people review, not the equipment wizard", async () => {
    const state = await as("hr").onboarding.state();
    expect(state.onboardingKind).toBe("people");
    expect(state.canClaim).toBe(false);
    expect(state.steps).toEqual(["review"]);
    expect(state.needsSetup).toBe(true);
  });

  it("once the director staffs the job, the PM's wizard opens onto it", async () => {
    const directorAcc = seed.account("director");
    const pmAcc = seed.account("project_manager");

    await as("director").projectTeam.assign({
      projectId,
      employeeId: pmAcc.employeeId,
      role: "pm",
      source: "manual_entry",
      reportsToEmployeeId: directorAcc.employeeId,
    });

    const state = await as("project_manager").onboarding.state();
    expect(state.onAnyJob).toBe(true);
    /* Still not a claimer — the job came from the director, so the wizard
       shows it and offers the crew step rather than the claim step. */
    expect(state.canClaim).toBe(false);
    expect(state.steps).toEqual(["projects", "crew", "review"]);
    expect((await as("project_manager").project.list()).map((p) => p.id)).toContain(projectId);
  });

  it("exercises the ladder, not a tenant-wide grant", () => {
    /* A property of the fixture that makes the tests above mean something: the
       demo director really does hold no `project.team.assign`, so the authority
       exercised there came from being above a tier on the ladder. If this ever
       gains the grant, those tests stop proving the "Set by" path works. */
    expect(permsFor("director")).not.toContain("project.team.assign");
    expect(permsFor("director")).toContain("project.team.read");
  });
});
