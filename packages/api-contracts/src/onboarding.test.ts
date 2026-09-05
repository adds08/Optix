import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { onboardingRouter } from "./routers/onboarding.js";
import { projectTeamRouter } from "./routers/projectTeam.js";
import type { Context } from "./trpc.js";

/*
  First-run setup: the state row, the deferral record, and confirmation.

  The three behaviours worth guarding here are the ones that were WRONG in the
  plan before the code was written, and would silently regress to being wrong
  again:

  1. The candidate-project list cannot come from `visibleProjectScope`. That
     helper derives visibility from roster rows, and a person being onboarded has
     none — so reusing it produces an empty wizard for exactly the person it is
     for. The test that catches a regression is "a foreman with no roster rows
     still sees jobs to claim".
  2. A deferral must close when the tier is filled, from either assign path.
  3. Confirming needs the same permission as assigning. A confirmation anybody
     could give means nothing.

  Real Postgres via DATABASE_URL, throwaway tenant.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("first-run onboarding", () => {
  let db: Database;
  let tenantId: string;
  let jobA: string;
  let jobB: string;
  let doneJob: string;
  let foremanEmp: string;
  let superEmp: string;
  let plainUserId: string;
  let bossUserId: string;
  let noEmployeeUserId: string;

  const suffix = crypto.randomUUID().slice(0, 8);

  const ctx = (userId: string, employeeId: string | null, perms: Permission[]): Context => ({
    db,
    session: {
      userId,
      tenantId,
      employeeId,
      permissions: new Set<Permission>(perms),
      roleName: null,
      actorLabel: null,
    },
    sessionSecret: "onboarding-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  /* A foreman: no assign permissions at all, which is the real seeded shape. */
  const asForeman = () => onboardingRouter.createCaller(ctx(plainUserId, foremanEmp, ["project.team.read"]));
  const teamAsForeman = () => projectTeamRouter.createCaller(ctx(plainUserId, foremanEmp, ["project.team.read"]));
  const teamAsBoss = () =>
    projectTeamRouter.createCaller(
      ctx(bossUserId, superEmp, ["project.team.read", "project.assign.foreman", "project.assign.superintendent"]),
    );

  async function mkUser(email: string) {
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email, passwordHash: "x", firstName: "T", lastName: "User" })
      .returning({ id: schema.user.id });
    return u!.id;
  }
  async function mkProject(name: string, status: string) {
    const [p] = await db
      .insert(schema.project)
      .values({ tenantId, name, status, startDate: "2026-01-01" })
      .returning({ id: schema.project.id });
    return p!.id;
  }
  async function mkEmployee(name: string) {
    const [e] = await db
      .insert(schema.employee)
      .values({ tenantId, name, role: "foreman", employmentStatus: "active" })
      .returning({ id: schema.employee.id });
    return e!.id;
  }

  beforeAll(async () => {
    db = createDb(url!);
    const [t] = await db
      .insert(schema.tenant)
      .values({ name: `Onb ${suffix}`, slug: `onb-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    await db.insert(schema.teamRole).values([
      { tenantId, name: "foreman", label: "Foreman", canHoldCustody: true, isSystem: true },
      { tenantId, name: "superintendent", label: "Superintendent", canHoldCustody: true, isSystem: true },
    ]);

    plainUserId = await mkUser(`onb-foreman-${suffix}@stinventory.local`);
    bossUserId = await mkUser(`onb-boss-${suffix}@stinventory.local`);
    noEmployeeUserId = await mkUser(`onb-noemp-${suffix}@stinventory.local`);

    foremanEmp = await mkEmployee("Onb Foreman");
    superEmp = await mkEmployee("Onb Super");

    jobA = await mkProject(`Job A ${suffix}`, "in_progress");
    jobB = await mkProject(`Job B ${suffix}`, "awarded");
    doneJob = await mkProject(`Job Done ${suffix}`, "completed");
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
  });

  describe("state", () => {
    it("creates the row lazily and starts at the first step", async () => {
      const s = await asForeman().state();
      expect(s.currentStep).toBe("projects");
      expect(s.completedAt).toBeNull();
      expect(s.shouldPrompt).toBe(true);
    });

    it("is idempotent — a second read does not make a second row", async () => {
      await asForeman().state();
      await asForeman().state();
      const rows = await db
        .select({ id: schema.userOnboarding.id })
        .from(schema.userOnboarding)
        .where(and(eq(schema.userOnboarding.tenantId, tenantId), eq(schema.userOnboarding.userId, plainUserId)));
      expect(rows).toHaveLength(1);
    });

    it("does NOT prompt an account with no employee record", async () => {
      /* owner@, finance@, office@ and the rest. The wizard is built on roster
         rows they cannot hold, so prompting opens something they cannot finish. */
      const s = await onboardingRouter
        .createCaller(ctx(noEmployeeUserId, null, ["project.team.read"]))
        .state();
      expect(s.hasEmployeeRecord).toBe(false);
      expect(s.shouldPrompt).toBe(false);
    });

    it("resumes where it was left, forwards and back", async () => {
      await asForeman().setStep({ step: "crew" });
      expect((await asForeman().state()).currentStep).toBe("crew");
      await asForeman().setStep({ step: "details" });
      expect((await asForeman().state()).currentStep).toBe("details");
    });

    it("stops prompting once completed, and completing twice is a no-op", async () => {
      const first = await asForeman().complete({ dismissed: false });
      expect(first.alreadyDone).toBe(false);
      const s = await asForeman().state();
      expect(s.completedAt).not.toBeNull();
      expect(s.shouldPrompt).toBe(false);

      const second = await asForeman().complete({ dismissed: false });
      expect(second.alreadyDone).toBe(true);
    });
  });

  describe("candidate projects", () => {
    it("offers jobs to somebody with NO roster rows at all", async () => {
      /* The regression this file exists for. `visibleProjectScope` derives
         visibility FROM roster rows, so reusing it here returns nothing for the
         person being onboarded and the wizard dead-ends on step one. */
      const rows = await asForeman().candidateProjects();
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(jobA);
      expect(ids).toContain(jobB);
    });

    it("leaves out jobs that are finished", async () => {
      const rows = await asForeman().candidateProjects();
      expect(rows.map((r) => r.id)).not.toContain(doneJob);
    });

    it("marks the ones the person is already on", async () => {
      await teamAsBoss().assign({ projectId: jobA, employeeId: foremanEmp, role: "foreman" });
      const rows = await asForeman().candidateProjects();
      expect(rows.find((r) => r.id === jobA)?.alreadyOn).toBe("foreman");
      expect(rows.find((r) => r.id === jobB)?.alreadyOn).toBeNull();
    });

    it("carries names and codes only — never tools or people", async () => {
      const rows = await asForeman().candidateProjects();
      const keys = Object.keys(rows[0] ?? {}).sort();
      expect(keys).toEqual(["alreadyOn", "externalId", "id", "name", "siteAddress", "status"]);
    });
  });

  describe("deferral", () => {
    it("records a tier the person cannot fill themselves", async () => {
      const r = await asForeman().defer({ projectId: jobB, teamRole: "superintendent" });
      expect(r.ok).toBe(true);
      const [row] = await db
        .select({ id: schema.projectRoleDeferral.id })
        .from(schema.projectRoleDeferral)
        .where(
          and(
            eq(schema.projectRoleDeferral.tenantId, tenantId),
            eq(schema.projectRoleDeferral.projectId, jobB),
            isNull(schema.projectRoleDeferral.resolvedAt),
          ),
        );
      expect(row).toBeTruthy();
    });

    it("needs no assign permission — admitting a limit is not an act on the roster", async () => {
      /* The caller above holds only project.team.read. Gating this behind the
         permission they are admitting they lack would be incoherent. */
      const r = await asForeman().defer({ projectId: jobB, teamRole: "superintendent" });
      expect(r.alreadyDeferred).toBe(true);
    });

    it("is one decision per job and tier, not one per person", async () => {
      const rows = await db
        .select({ id: schema.projectRoleDeferral.id })
        .from(schema.projectRoleDeferral)
        .where(
          and(
            eq(schema.projectRoleDeferral.tenantId, tenantId),
            eq(schema.projectRoleDeferral.projectId, jobB),
            eq(schema.projectRoleDeferral.teamRole, "superintendent"),
            isNull(schema.projectRoleDeferral.resolvedAt),
          ),
        );
      expect(rows).toHaveLength(1);
    });

    it("CLOSES when the tier is actually filled", async () => {
      await teamAsBoss().assign({ projectId: jobB, employeeId: superEmp, role: "superintendent" });
      const open = await db
        .select({ id: schema.projectRoleDeferral.id })
        .from(schema.projectRoleDeferral)
        .where(
          and(
            eq(schema.projectRoleDeferral.tenantId, tenantId),
            eq(schema.projectRoleDeferral.projectId, jobB),
            eq(schema.projectRoleDeferral.teamRole, "superintendent"),
            isNull(schema.projectRoleDeferral.resolvedAt),
          ),
        );
      expect(open).toHaveLength(0);
    });

    it("is stamped, not deleted — the history survives", async () => {
      const all = await db
        .select({ id: schema.projectRoleDeferral.id, resolvedAt: schema.projectRoleDeferral.resolvedAt })
        .from(schema.projectRoleDeferral)
        .where(
          and(
            eq(schema.projectRoleDeferral.tenantId, tenantId),
            eq(schema.projectRoleDeferral.projectId, jobB),
            eq(schema.projectRoleDeferral.teamRole, "superintendent"),
          ),
        );
      expect(all).toHaveLength(1);
      expect(all[0]!.resolvedAt).not.toBeNull();
    });

    it("does not record one for a tier that is already filled", async () => {
      const r = await asForeman().defer({ projectId: jobB, teamRole: "superintendent" });
      expect(r.alreadyFilled).toBe(true);
    });

    it("refuses another tenant's job", async () => {
      const [other] = await db
        .insert(schema.tenant)
        .values({ name: `Other ${suffix}`, slug: `other-onb-${suffix}` })
        .returning({ id: schema.tenant.id });
      const [p] = await db
        .insert(schema.project)
        .values({ tenantId: other!.id, name: "Theirs", status: "in_progress", startDate: "2026-01-01" })
        .returning({ id: schema.project.id });

      await expect(asForeman().defer({ projectId: p!.id, teamRole: "superintendent" })).rejects.toThrow(/No such job/i);
      await db.delete(schema.tenant).where(eq(schema.tenant.id, other!.id));
    });
  });

  describe("confirmation", () => {
    let rowId: string;

    beforeAll(async () => {
      const [row] = await db
        .select({ id: schema.projectTeamMember.id })
        .from(schema.projectTeamMember)
        .where(
          and(
            eq(schema.projectTeamMember.tenantId, tenantId),
            eq(schema.projectTeamMember.projectId, jobA),
            eq(schema.projectTeamMember.employeeId, foremanEmp),
            isNull(schema.projectTeamMember.endedOn),
          ),
        );
      rowId = row!.id;
    });

    it("starts unconfirmed", async () => {
      const row = await db.query.projectTeamMember.findFirst({ where: eq(schema.projectTeamMember.id, rowId) });
      expect(row?.confirmedAt).toBeNull();
    });

    it("refuses somebody who could not have assigned the row", async () => {
      await expect(teamAsForeman().confirm({ id: rowId })).rejects.toThrow();
      const row = await db.query.projectTeamMember.findFirst({ where: eq(schema.projectTeamMember.id, rowId) });
      expect(row?.confirmedAt).toBeNull();
    });

    it("is accepted from somebody who could, and records who", async () => {
      const r = await teamAsBoss().confirm({ id: rowId });
      expect(r.alreadyConfirmed).toBe(false);
      const row = await db.query.projectTeamMember.findFirst({ where: eq(schema.projectTeamMember.id, rowId) });
      expect(row?.confirmedAt).not.toBeNull();
      expect(row?.confirmedByUserId).toBe(bossUserId);
    });

    it("confirming twice is a no-op, not an error", async () => {
      const r = await teamAsBoss().confirm({ id: rowId });
      expect(r.alreadyConfirmed).toBe(true);
    });

    it("does not touch custody", async () => {
      /* The row has been live since it was written. Confirmation is about what
         the progress screen counts as outstanding, and nothing else. */
      const row = await db.query.projectTeamMember.findFirst({ where: eq(schema.projectTeamMember.id, rowId) });
      expect(row?.endedOn).toBeNull();
      expect(row?.role).toBe("foreman");
    });

    it("refuses another tenant's row", async () => {
      await expect(teamAsBoss().confirm({ id: crypto.randomUUID() })).rejects.toThrow(/No such team member/i);
    });
  });
});
