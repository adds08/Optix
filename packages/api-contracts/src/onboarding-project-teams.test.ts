import { describe, it, expect, beforeAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createDb } from "@stinventory/db";
import * as schema from "@stinventory/db/schema";
import { PERMISSIONS, type Permission } from "@stinventory/types";
import { appRouter } from "./index";
import type { Context } from "./trpc";

// Isolated tenant in the DATABASE_URL test database; no BambooHR or external mail calls.
describe.skipIf(!process.env.DATABASE_URL)("one-time onboarding and project branches", () => {
  let db: ReturnType<typeof createDb>, tid: string, adminId: string, leadId: string, leadUser: string, leadRole: string, hrUser: string, projectId: string, otherProject: string, childId: string, otherLead: string;
  const caller = (userId: string, employeeId: string | null, permissions: readonly Permission[]) => appRouter.createCaller({ db, session: { userId, tenantId: tid, employeeId, permissions: new Set(permissions), roleName: null, actorLabel: "Test" }, sessionSecret: "test-only", mailFallback: null, webOrigin: "http://localhost:3100", request: { method: null, path: null, ip: null, userAgent: null, source: "system" } } satisfies Context);
  const admin = () => caller(adminId, null, PERMISSIONS);
  const lead = () => caller(leadUser, leadId, ["project.team.read", "assets.view.crew", "employee.read"]);
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    [tid] = (await db.insert(schema.tenant).values({ name: "Onboarding branches", slug: `branches-${crypto.randomUUID()}` }).returning()).map(t => t.id) as [string];
    const [adminUser] = await db.insert(schema.user).values({ tenantId: tid, email: `admin-${tid}@test.local`, firstName: "Admin", lastName: "Test", passwordHash: "unused" }).returning(); adminId = adminUser!.id;
    const [role] = await db.insert(schema.role).values({ tenantId: tid, name: "leader", onboardingKind: "equipment", claimTierNames: ["superintendent"] }).returning(); leadRole = role!.id;
    const employees = await db.insert(schema.employee).values(["Leader", "Foreman", "Other leader"].map(name => ({ tenantId: tid, name, employmentStatus: "active" }))).returning(); [leadId, childId, otherLead] = employees.map(e => e.id) as [string,string,string];
    const [u] = await db.insert(schema.user).values({ tenantId: tid, employeeId: leadId, email: `leader-${tid}@test.local`, firstName: "Leader", lastName: "Test", passwordHash: "unused" }).returning(); leadUser = u!.id;
    await db.insert(schema.userRole).values({ userId: leadUser, roleId: leadRole });
    const [hrRole] = await db.insert(schema.role).values({ tenantId: tid, name: "hr", onboardingKind: "people" }).returning();
    const [hr] = await db.insert(schema.user).values({ tenantId: tid, email: `hr-${tid}@test.local`, firstName: "HR", lastName: "Test", passwordHash: "unused" }).returning(); hrUser = hr!.id;
    await db.insert(schema.userRole).values({ userId: hrUser, roleId: hrRole!.id });
    const projects = await db.insert(schema.project).values(["NEX", "Other job"].map(name => ({ tenantId: tid, name, status: "in_progress", startDate: "2026-01-01" }))).returning(); [projectId, otherProject] = projects.map(p => p.id) as [string,string];
    const tiers = await db.insert(schema.teamRole).values([{ tenantId: tid, name: "superintendent", label: "Superintendent" }, { tenantId: tid, name: "foreman", label: "Foreman" }, { tenantId: tid, name: "director", label: "Director" }]).returning({ id: schema.teamRole.id, name: schema.teamRole.name });
    /* A superintendent fills a foreman slot. Carried by "Set by" since the
       dedicated `project.assign.foreman` permission was removed (2026-09-10). */
    const tierId = (n: string) => tiers.find(t => t.name === n)!.id;
    await db.insert(schema.teamRoleAssigner).values([{ teamRoleId: tierId("foreman"), assignerTeamRoleId: tierId("superintendent") }]);
  });
  it("HR has relevant required setup with no employee or project", async () => {
    const state = await caller(hrUser, null, ["employee.read"]).onboarding.state();
    expect(state.shouldPrompt).toBe(true); expect(state.steps).toEqual(["review"]);
  });
  it("only offers explicitly configured claim tiers", async () => {
    expect((await lead().onboarding.claimOptions()).tiers.map(t => t.name)).toEqual(["superintendent"]);
    await expect(lead().onboarding.claimProject({ projectId, tier: "director" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("claims immediately and repeated submissions do not duplicate membership", async () => {
    await lead().onboarding.claimProject({ projectId, tier: "superintendent" });
    await lead().onboarding.claimProject({ projectId, tier: "superintendent" });
    const rows = await db.select().from(schema.projectTeamMember).where(and(eq(schema.projectTeamMember.tenantId, tid), eq(schema.projectTeamMember.employeeId, leadId), isNull(schema.projectTeamMember.endedOn)));
    expect(rows).toHaveLength(1);
    expect((await lead().project.list()).map(p => p.id)).toContain(projectId);
  });
  it("cannot dismiss required setup or finish without acknowledgement", async () => {
    await expect(lead().onboarding.complete({ dismissed: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(lead().onboarding.complete()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  /*
    REWRITTEN 2026-09-10. This asserted that finishing setup closed claiming
    permanently for everybody, which was the shipped rule and is no longer it:
    a role holding `claimTierNames` keeps the ability and reaches it from
    `/claim-a-job`, because a director takes on a new job routinely and the old
    rule made that need an administrator.

    The `leader` fixture holds a claim grant, so it is now a STANDING claimer
    and this test proves the new rule. The guard the old test was really
    protecting — that finishing is not a way for somebody with no grant to get
    a second pass — is asserted by the test below it, which uses an account
    with an empty `claimTierNames`.
  */
  it("a role that may claim keeps claiming after setup is finished", async () => {
    await lead().onboarding.complete({ acknowledged: true });
    expect((await lead().onboarding.state()).shouldPrompt).toBe(false);
    /* The whole point: still true after completing. */
    expect((await lead().onboarding.state()).canClaim).toBe(true);
    await lead().onboarding.claimProject({ projectId: otherProject, tier: "superintendent" });
    const row = await db.query.projectTeamMember.findFirst({
      where: and(
        eq(schema.projectTeamMember.tenantId, tid),
        eq(schema.projectTeamMember.projectId, otherProject),
        eq(schema.projectTeamMember.employeeId, leadId),
        isNull(schema.projectTeamMember.endedOn),
      ),
    });
    /* A claim is a REAL roster row, not a note about intent — that is what
       separates this from the `project_claim` design that was deleted. */
    expect(row?.role).toBe("superintendent");

    /* Put `otherProject` back out of reach. The tests below assert the lead
       CANNOT touch it, and this suite shares one tenant across cases in order —
       leaving the claim standing would make those two fail for the right reason
       at the wrong time, which reads as a permission regression and is not one. */
    await db
      .update(schema.projectTeamMember)
      .set({ endedOn: new Date().toISOString().slice(0, 10) })
      .where(eq(schema.projectTeamMember.id, row!.id));
  });

  it("a role with no claim grant cannot claim, before or after finishing", async () => {
    /* The guard the previous version of the test above was protecting. `hrUser`
       holds a role with an empty `claimTierNames`, so no amount of finishing or
       reopening hands it a way onto a job. */
    const hr = caller(hrUser, leadId, ["employee.read"]);
    expect((await hr.onboarding.state()).canClaim).toBe(false);
    await expect(
      hr.onboarding.claimProject({ projectId: otherProject, tier: "superintendent" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("a configured assignment permission still requires the caller's project", async () => {
    await expect(lead().projectTeam.assign({ projectId: otherProject, employeeId: childId, role: "foreman" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await lead().projectTeam.assign({ projectId, employeeId: childId, role: "foreman" });
    const row = await db.query.projectTeamMember.findFirst({ where: and(eq(schema.projectTeamMember.tenantId, tid), eq(schema.projectTeamMember.employeeId, childId), isNull(schema.projectTeamMember.endedOn)) });
    expect(row?.reportsToEmployeeId).toBe(leadId);
  });
  it("does not allow editing another manager's branch", async () => {
    await admin().projectTeam.assign({ projectId, employeeId: otherLead, role: "superintendent" });
    await expect(lead().projectTeam.setReportsTo({ id: (await db.query.projectTeamMember.findFirst({ where: and(eq(schema.projectTeamMember.tenantId, tid), eq(schema.projectTeamMember.employeeId, childId), isNull(schema.projectTeamMember.endedOn)) }))!.id, reportsToEmployeeId: otherLead })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("removal revokes descendant access while preserving roster history", async () => {
    await admin().projectTeams.removeBranch({ projectId, employeeId: leadId, reason: "Incorrect project claim" });
    expect((await lead().project.list()).map(p => p.id)).not.toContain(projectId);
    await expect(lead().projectTeam.assign({ projectId, employeeId: childId, role: "foreman" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const history = await db.select().from(schema.projectTeamMember).where(and(eq(schema.projectTeamMember.tenantId, tid), eq(schema.projectTeamMember.employeeId, childId)));
    expect(history.length).toBeGreaterThan(0); expect(history.every(r => r.endedOn)).toBe(true);
  });
  it("the manager can restore an assignment without deleting removal history", async () => {
    await admin().projectTeam.assign({ projectId, employeeId: leadId, role: "superintendent" });
    expect((await lead().project.list()).map(p => p.id)).toContain(projectId);
    const restriction = await db.query.projectAccessRestriction.findFirst({ where: and(eq(schema.projectAccessRestriction.tenantId, tid), eq(schema.projectAccessRestriction.employeeId, leadId)) });
    expect(restriction?.restoredAt).toBeTruthy();
  });
  it("read-only callers cannot administer onboarding or edit HR fields", async () => {
    await expect(lead().onboarding.administer({ userId: hrUser, action: "complete", reason: "No authority" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.insert(schema.employeeExternalRef).values({ tenantId: tid, employeeId: leadId, system: "bamboohr", externalId: "test-hr-employee" });
    await expect(admin().employee.setHrDetails({ employeeId: leadId, code: "change", jobTitle: "Director", department: "IT", division: "Office" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
