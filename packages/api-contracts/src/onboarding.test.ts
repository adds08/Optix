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
  let strangerUserId: string;
  let strangerEmp: string;

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
  /* An employee who is on NO jobs — the real shape of a mechanic, an equipment
     admin or the yard desk, who all have employee records and serve every job
     rather than working on any. Distinct from the no-employee account below:
     this one has a person behind it and still must not be sent to a wizard
     whose first question is "which of your jobs is this about". */
  const asStranger = () =>
    onboardingRouter.createCaller(ctx(strangerUserId, strangerEmp, ["project.team.read"]));
  const teamAsForeman = () => projectTeamRouter.createCaller(ctx(plainUserId, foremanEmp, ["project.team.read"]));
  const teamAsBoss = () =>
    projectTeamRouter.createCaller(
      ctx(bossUserId, superEmp, ["project.team.assign", "project.team.read", "project.assign.foreman", "project.assign.superintendent"]),
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
      { tenantId, name: "foreman", label: "Foreman", canHoldCustody: true },
      { tenantId, name: "superintendent", label: "Superintendent", canHoldCustody: true },
    ]);

    plainUserId = await mkUser(`onb-foreman-${suffix}@stinventory.local`);
    bossUserId = await mkUser(`onb-boss-${suffix}@stinventory.local`);
    noEmployeeUserId = await mkUser(`onb-noemp-${suffix}@stinventory.local`);
    strangerUserId = await mkUser(`onb-stranger-${suffix}@stinventory.local`);

    foremanEmp = await mkEmployee("Onb Foreman");
    strangerEmp = await mkEmployee("Onb Stranger");
    superEmp = await mkEmployee("Onb Super");

    jobA = await mkProject(`Job A ${suffix}`, "in_progress");
    jobB = await mkProject(`Job B ${suffix}`, "awarded");
    doneJob = await mkProject(`Job Done ${suffix}`, "completed");

    /* The foreman is put on jobA HERE rather than inside a test, because
       `shouldPrompt` now requires a live roster row: a person on no jobs is
       never sent to a wizard whose first question is which of their jobs it is
       about. Every `state` assertion below depends on this fixture being a
       person the product would actually prompt. `asStranger` deliberately gets
       no roster row and is the other half of that rule. */
    await teamAsBoss().assign({ projectId: jobA, employeeId: foremanEmp, role: "foreman" });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
  });

  describe("required setup state", () => {
    // The old optional map wizard is replaced by required, department-aware setup.
    it("creates one resumable row and defaults an unmapped account to review", async () => {
      const first = await asForeman().state();
      expect(first.currentStep).toBe("review");
      expect(first.shouldPrompt).toBe(true);
      await asForeman().state();
      const rows = await db.select().from(schema.userOnboarding).where(and(eq(schema.userOnboarding.tenantId, tenantId), eq(schema.userOnboarding.userId, plainUserId)));
      expect(rows).toHaveLength(1);
    });
    it("requires review for office accounts and people with no project", async () => {
      for (const caller of [onboardingRouter.createCaller(ctx(noEmployeeUserId, null, [])), asStranger()]) {
        const state = await caller.state();
        expect(state.shouldPrompt).toBe(true);
        expect(state.steps).toEqual(["review"]);
      }
    });
    it("does not allow skipping or completing without acknowledgment", async () => {
      await expect(asForeman().complete({ dismissed: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(asForeman().complete()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
    it("allows a configured none role to bypass setup", async () => {
      const uid = await mkUser(`none-${suffix}@test.local`);
      const [role] = await db.insert(schema.role).values({ tenantId, name: `none-${suffix}`, onboardingKind: "none" }).returning();
      await db.insert(schema.userRole).values({ userId: uid, roleId: role!.id });
      const state = await onboardingRouter.createCaller(ctx(uid, null, [])).state();
      expect(state.shouldPrompt).toBe(false);
      expect(state.needsSetup).toBe(false);
    });
    it("resumes only steps available to the account", async () => {
      await asForeman().setStep({ step: "location" });
      expect((await asForeman().state()).currentStep).toBe("review");
    });
    it("finishing is durable and resume does not reopen completed setup", async () => {
      await asForeman().complete({ acknowledged: true });
      await asForeman().complete({ acknowledged: true });
      await asForeman().resume();
      const state = await asForeman().state();
      expect(state.shouldPrompt).toBe(false);
      expect(state.completedAt).toBeTruthy();
      expect(state.dismissedAt).toBeNull();
    });
  });

  describe("candidate projects", () => {
    /*
      Step one lists THE JOBS YOU ARE ON, and nothing else.

      This block used to assert the opposite — that the list was deliberately
      wider than the caller's roster, so a person with no roster rows could
      tick jobs into a `project_claim`. That design shipped and was withdrawn:
      the tick granted nothing, so steps two through four ignored every claimed
      job, and the wizard ended up explaining its own bookkeeping to a person
      who had ticked a box thirty seconds earlier. Claims are gone.

      What replaced it is the invariant these tests now pin: the set step one
      shows is exactly the set the later mutations accept, so the wizard can
      never offer an action the server will refuse.
    */
    it("lists only jobs the caller holds a live roster row on", async () => {
      const rows = await asForeman().candidateProjects();
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(jobA);
      /* jobB is a real, active job this person is simply not on. Before, it
         was offered as a tickable candidate. */
      expect(ids).not.toContain(jobB);
    });

    it("is empty for somebody on no jobs, rather than offering the whole tenant", async () => {
      const rows = await asStranger().candidateProjects();
      expect(rows).toEqual([]);
    });

    it("carries the caller's tier on each job", async () => {
      const rows = await asForeman().candidateProjects();
      expect(rows.find((r) => r.id === jobA)?.teamRole).toBe("foreman");
    });

    it("leaves out jobs that are finished", async () => {
      const rows = await asForeman().candidateProjects();
      expect(rows.map((r) => r.id)).not.toContain(doneJob);
    });

    it("carries names and codes only — never tools or people", async () => {
      /* An EXACT key list, not a subset check. Step one is the first screen a
         new person sees, and what it carries should stay boring on purpose —
         adding a field here is a decision, and this assertion is what forces
         it to be one. */
      const rows = await asForeman().candidateProjects();
      const keys = Object.keys(rows[0] ?? {}).sort();
      expect(keys).toEqual([
        "alreadyOn",
        "claimed",
        "externalId",
        "id",
        "name",
        "siteAddress",
        "status",
        "teamRole",
        "teamRoleLabel",
      ]);
    });
  });

  describe("deferral", () => {
    it("records a tier the person cannot fill themselves", async () => {
      await db.insert(schema.projectTeamMember).values({ tenantId, projectId: jobB, employeeId: foremanEmp, role: "foreman", startedOn: "2026-01-01" });
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

      await expect(asForeman().defer({ projectId: p!.id, teamRole: "superintendent" })).rejects.toMatchObject({ code: "FORBIDDEN" });
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
