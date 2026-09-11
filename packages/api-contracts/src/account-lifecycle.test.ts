import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createDb, schema, roleSpecs, ROLE_PERMS, teamRoleSpecs } from "@stinventory/db";
import { generateAuthToken, hashAuthToken, resolveSession } from "@stinventory/auth";
import { PERMISSIONS, type Permission } from "@stinventory/types";
import { appRouter } from "./index";
import type { Context } from "./trpc";

// Exercise the real routers and database, with no external mail delivery.
vi.mock("@stinventory/mail", async (original) => ({ ...await original<any>(), sendMail: vi.fn(async () => ({ ok: true })) }));

describe.skipIf(!process.env.DATABASE_URL)("invited people retain identity, crew and access boundaries", () => {
  let db: ReturnType<typeof createDb>, tenantId: string, adminId: string;
  const roles = new Map<string, string>();
  const caller = (userId: string, employeeId: string | null, permissions: readonly Permission[] = PERMISSIONS) => appRouter.createCaller({
    db, session: { userId, employeeId, tenantId, permissions: new Set(permissions), roleName: null, actorLabel: "Lifecycle test" },
    sessionSecret: "test-only", mailFallback: null, webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  } satisfies Context);
  const admin = () => caller(adminId, null);
  async function person(roleName = "superintendent") {
    const [employee] = await db.insert(schema.employee).values({ tenantId, name: `Lifecycle ${crypto.randomUUID()}`, roleId: roles.get(roleName) }).returning();
    const result = await admin().user.invite({ employeeId: employee!.id, email: `${crypto.randomUUID()}@test.local`, firstName: "Lifecycle", lastName: "Test" });
    return { employee: employee!, user: result.user };
  }
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    const [tenant] = await db.insert(schema.tenant).values({ name: "Lifecycle acceptance", slug: `lifecycle-${crypto.randomUUID()}` }).returning(); tenantId = tenant!.id;
    const [adminUser] = await db.insert(schema.user).values({ tenantId, email: `${crypto.randomUUID()}@test.local`, firstName: "Admin", lastName: "Test", passwordHash: "unused" }).returning(); adminId = adminUser!.id;
    for (const spec of roleSpecs) {
      const [role] = await db.insert(schema.role).values({ ...spec, tenantId }).returning(); roles.set(spec.name, role!.id);
    }
    const tiers = new Map<string, string>();
    for (const spec of teamRoleSpecs) {
      const [tier] = await db.insert(schema.teamRole).values({ tenantId, name: spec.name, label: spec.label }).returning(); tiers.set(spec.name, tier!.id);
    }
    for (const spec of teamRoleSpecs) {
      if (spec.reportsTo) await db.update(schema.teamRole).set({ reportsToTeamRoleId: tiers.get(spec.reportsTo) }).where(eq(schema.teamRole.id, tiers.get(spec.name)!));
      for (const name of spec.setBy ?? []) await db.insert(schema.teamRoleAssigner).values({ teamRoleId: tiers.get(spec.name)!, assignerTeamRoleId: tiers.get(name)! });
    }
  });

  it("resending supersedes old invites without replacing the person or account", async () => {
    const p = await person();
    const [old] = await db.select().from(schema.authToken).where(eq(schema.authToken.userId, p.user.id));
    await admin().user.resendInvite({ userId: p.user.id });
    expect((await db.query.authToken.findFirst({ where: eq(schema.authToken.id, old!.id) }))?.consumedAt).not.toBeNull();
    expect(await db.select().from(schema.authToken).where(and(eq(schema.authToken.userId, p.user.id), isNull(schema.authToken.consumedAt)))).toHaveLength(1);
    expect((await db.query.user.findFirst({ where: eq(schema.user.id, p.user.id) }))?.employeeId).toBe(p.employee.id);
  });

  it("a deactivated accepted account cannot be re-invited as if it were new", async () => {
    const p = await person();
    await db.update(schema.user).set({ isActive: true, emailVerifiedAt: new Date() }).where(eq(schema.user.id, p.user.id));
    await admin().user.setActive({ userId: p.user.id, isActive: false });
    await expect(admin().user.resendInvite({ userId: p.user.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a deactivated temporary-password account is not a pending invite", async () => {
    const result = await admin().user.create({ email: `${crypto.randomUUID()}@test.local`, firstName: "Temporary", lastName: "Account", roleId: roles.get("foreman") });
    await admin().user.setActive({ userId: result.user.id, isActive: false });
    await expect(admin().user.resendInvite({ userId: result.user.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deactivation burns outstanding links and sessions so reactivation cannot revive them", async () => {
    const p = await person();
    const sessionId = generateAuthToken();
    await db.insert(schema.session).values({ id: sessionId, tenantId, userId: p.user.id, expiresAt: new Date(Date.now() + 60_000) });
    await db.insert(schema.authToken).values({ tenantId, userId: p.user.id, kind: "reset", tokenHash: hashAuthToken(generateAuthToken()), expiresAt: new Date(Date.now() + 60_000) });
    await admin().user.setActive({ userId: p.user.id, isActive: false });
    expect(await db.select().from(schema.authToken).where(and(eq(schema.authToken.userId, p.user.id), isNull(schema.authToken.consumedAt)))).toHaveLength(0);
    await admin().user.setActive({ userId: p.user.id, isActive: true });
    expect(await resolveSession(db, sessionId)).toBeNull();
  });

  it("deleting a person preserves their account, crew and project records and is reversible", async () => {
    const p = await person();
    const [project] = await db.insert(schema.project).values({ tenantId, name: "Retained job", status: "in_progress", startDate: "2026-09-11" }).returning();
    await admin().projectTeam.assign({ projectId: project!.id, employeeId: p.employee.id, role: "superintendent" });
    const [asset] = await db.insert(schema.asset).values({ tenantId }).returning();
    await admin().assignment.create({ assetId: asset!.id, custodianId: p.employee.id, projectId: project!.id });
    const before = await db.select().from(schema.projectTeamMember).where(eq(schema.projectTeamMember.employeeId, p.employee.id));
    const custody = await db.select().from(schema.assignment).where(eq(schema.assignment.assetId, asset!.id));
    const ledger = await db.select().from(schema.transaction).where(eq(schema.transaction.assetId, asset!.id));
    const projection = await db.query.asset.findFirst({ where: eq(schema.asset.id, asset!.id) });
    await admin().employee.delete({ id: p.employee.id });
    expect(await db.query.employee.findFirst({ where: eq(schema.employee.id, p.employee.id) })).toMatchObject({ id: p.employee.id, employmentStatus: "inactive" });
    expect(await db.query.user.findFirst({ where: eq(schema.user.id, p.user.id) })).toMatchObject({ employeeId: p.employee.id, isActive: false });
    expect(await db.select().from(schema.projectTeamMember).where(eq(schema.projectTeamMember.employeeId, p.employee.id))).toEqual(before);
    expect(await db.select().from(schema.assignment).where(eq(schema.assignment.assetId, asset!.id))).toEqual(custody);
    expect(await db.select().from(schema.transaction).where(eq(schema.transaction.assetId, asset!.id))).toEqual(ledger);
    expect(await db.query.asset.findFirst({ where: eq(schema.asset.id, asset!.id) })).toEqual(projection);
    await admin().employee.update({ id: p.employee.id, employmentStatus: "active" });
    await admin().user.setActive({ userId: p.user.id, isActive: true });
    expect(await db.query.employee.findFirst({ where: eq(schema.employee.id, p.employee.id) })).toMatchObject({ id: p.employee.id, employmentStatus: "active" });
  });

  it.each(["director", "general_superintendent"])("a superintendent assigned by %s sees the saved crew but cannot change their manager", async managerRole => {
    const boss = await person(managerRole), superPerson = await person(), foreman = await person("foreman");
    const [project] = await db.insert(schema.project).values({ tenantId, name: "Inherited crew", status: "in_progress", startDate: "2026-09-11" }).returning();
    await admin().projectTeam.assign({ projectId: project!.id, employeeId: boss.employee.id, role: managerRole });
    const manager = caller(boss.user.id, boss.employee.id, ROLE_PERMS[managerRole as keyof typeof ROLE_PERMS] as Permission[]);
    await manager.projectTeam.assign({ projectId: project!.id, employeeId: superPerson.employee.id, role: "superintendent", reportsToEmployeeId: boss.employee.id });
    await manager.projectTeam.assign({ projectId: project!.id, employeeId: foreman.employee.id, role: "foreman", reportsToEmployeeId: superPerson.employee.id });
    const me = caller(superPerson.user.id, superPerson.employee.id, ROLE_PERMS.superintendent as Permission[]);
    const theirJob = (await manager.projectTeams.workspace()).projects.find(p => p.id === project!.id)!;
    const myJob = (await me.projectTeams.workspace()).projects.find(p => p.id === project!.id)!;
    expect(myJob.members.map(m => m.id).sort()).toEqual(theirJob.members.map(m => m.id).sort());
    expect(myJob.members.find(m => m.employeeId === boss.employee.id)?.canManage).toBe(false);
    expect(myJob.members.find(m => m.employeeId === superPerson.employee.id)?.canManage).toBe(false);
    await expect(me.projectTeam.assign({ projectId: project!.id, employeeId: boss.employee.id, role: managerRole, reportsToEmployeeId: superPerson.employee.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(me.projectTeam.assign({ projectId: project!.id, employeeId: superPerson.employee.id, role: "superintendent", reportsToEmployeeId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await me.onboarding.complete({ acknowledged: true });
    await admin().onboarding.administer({ userId: superPerson.user.id, action: "reopen", reason: "Repeat with inherited crew" });
    expect((await me.projectTeams.workspace()).projects.find(p => p.id === project!.id)?.members).toEqual(myJob.members);
    expect((await admin().onboarding.progress()).byPerson.find(p => p.employeeId === foreman.employee.id)?.onboardingComplete).toBe(true);
  });

  it("person deactivation cannot bypass account-management or self-deactivation guards", async () => {
    const p = await person();
    await expect(caller(p.user.id, p.employee.id).employee.delete({ id: p.employee.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(adminId, null, ["employee.manage"]).employee.delete({ id: p.employee.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.query.employee.findFirst({ where: eq(schema.employee.id, p.employee.id) }))?.employmentStatus).toBe("active");
    await expect(caller(adminId, null, ["employee.manage"]).employee.update({ id: p.employee.id, employmentStatus: "inactive" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(["project_manager", "general_superintendent", "area_in_charge", "director"])("%s can onboard with an inherited branch without editing above themselves", async roleName => {
    const boss = await person("director"), p = await person(roleName), child = await person("foreman");
    const [project] = await db.insert(schema.project).values({ tenantId, name: `Branch for ${roleName}`, status: "in_progress", startDate: "2026-09-11" }).returning();
    await admin().projectTeam.assign({ projectId: project!.id, employeeId: boss.employee.id, role: "director" });
    const tier = roleName === "project_manager" ? "pm" : roleName;
    await admin().projectTeam.assign({ projectId: project!.id, employeeId: p.employee.id, role: tier, ...(tier !== "director" ? { reportsToEmployeeId: boss.employee.id } : {}) });
    await admin().projectTeam.assign({ projectId: project!.id, employeeId: child.employee.id, role: "foreman", reportsToEmployeeId: p.employee.id });
    const me = caller(p.user.id, p.employee.id, ROLE_PERMS[roleName as keyof typeof ROLE_PERMS] as Permission[]);
    const before = (await me.projectTeams.workspace()).projects.find(j => j.id === project!.id)!;
    expect(before.members.find(m => m.employeeId === p.employee.id)?.canManage).toBe(false);
    expect(before.members.find(m => m.employeeId === boss.employee.id)?.canManage).toBe(false);
    expect(before.members.find(m => m.employeeId === child.employee.id)?.canManage).toBe(true);
    await expect(me.projectTeam.assign({ projectId: project!.id, employeeId: boss.employee.id, role: "director", reportsToEmployeeId: p.employee.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await me.onboarding.complete({ acknowledged: true });
    await admin().onboarding.administer({ userId: p.user.id, action: "reopen", reason: "Inherited branch" });
    expect((await me.projectTeams.workspace()).projects.find(j => j.id === project!.id)?.members).toEqual(before.members);
  });

  it("production's superintendent claim grant works without granting PMs the same access", async () => {
    // Read-only production inspection on 2026-09-11 found this override. Local
    // also grants pm, but production does not: defaults alone cannot test that.
    await db.update(schema.role).set({ claimTierNames: ["superintendent"] }).where(eq(schema.role.id, roles.get("superintendent")!));
    try {
      const sup = await person(), pm = await person("project_manager");
      const superCaller = caller(sup.user.id, sup.employee.id, ROLE_PERMS.superintendent as Permission[]);
      const pmCaller = caller(pm.user.id, pm.employee.id, ROLE_PERMS.project_manager as Permission[]);
      expect((await superCaller.onboarding.state()).canClaim).toBe(true);
      expect((await pmCaller.onboarding.state()).canClaim).toBe(false);
      const [project] = await db.insert(schema.project).values({ tenantId, name: "Production claim settings", status: "in_progress", startDate: "2026-09-11" }).returning();
      await superCaller.onboarding.claimProject({ projectId: project!.id, tier: "superintendent" });
      await superCaller.onboarding.claimProject({ projectId: project!.id, tier: "superintendent" });
      await expect(pmCaller.onboarding.claimProject({ projectId: project!.id, tier: "pm" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.select().from(schema.projectTeamMember).where(and(eq(schema.projectTeamMember.employeeId, sup.employee.id), eq(schema.projectTeamMember.projectId, project!.id), isNull(schema.projectTeamMember.endedOn)))).toHaveLength(1);
    } finally {
      await db.update(schema.role).set({ claimTierNames: [] }).where(eq(schema.role.id, roles.get("superintendent")!));
    }
  });

  it("an engineer invited onto the project-engineer tier retains that tier during onboarding", async () => {
    const p = await person("engineer");
    const [project] = await db.insert(schema.project).values({ tenantId, name: "Project engineer", status: "in_progress", startDate: "2026-09-11" }).returning();
    await admin().projectTeam.assign({ projectId: project!.id, employeeId: p.employee.id, role: "project_engineer" });
    const me = caller(p.user.id, p.employee.id, ROLE_PERMS.engineer as Permission[]);
    expect((await me.onboarding.state()).shouldPrompt).toBe(true);
    expect((await me.onboarding.candidateProjects()).find(j => j.id === project!.id)?.teamRole).toBe("project_engineer");
    await me.onboarding.complete({ acknowledged: true });
    expect((await me.projectTeams.workspace()).projects.find(j => j.id === project!.id)?.members.find(m => m.employeeId === p.employee.id)?.role).toBe("project_engineer");
  });

  it.each(["superintendent", "project_manager", "general_superintendent", "director", "area_in_charge", "equipment_admin", "engineer", "foreman"])("%s: fresh invite, assigned crew and re-onboarding use the same records", async roleName => {
    const p = await person(roleName);
    const me = caller(p.user.id, p.employee.id, ROLE_PERMS[roleName as keyof typeof ROLE_PERMS] as Permission[]);
    const state = await me.onboarding.state();
    expect(state.shouldPrompt).toBe(roleName !== "foreman");
    expect(state.onAnyJob).toBe(false);
    expect(state.canClaim).toBe(!!roleSpecs.find(r => r.name === roleName)?.claimTierNames?.length);
    const [project] = await db.insert(schema.project).values({ tenantId, name: `${roleName} assigned job`, status: "in_progress", startDate: "2026-09-11" }).returning();
    const tier = roleName === "project_manager" ? "pm" : roleName === "engineer" ? "field_engineer" : roleName === "equipment_admin" ? "superintendent" : roleName;
    await admin().projectTeam.assign({ projectId: project!.id, employeeId: p.employee.id, role: tier });
    const before = await db.select().from(schema.projectTeamMember).where(eq(schema.projectTeamMember.employeeId, p.employee.id));
    expect((await me.onboarding.candidateProjects()).map(j => j.id)).toContain(project!.id);
    await me.onboarding.complete({ acknowledged: true });
    await admin().onboarding.administer({ userId: p.user.id, action: "reopen", reason: "Acceptance test" });
    expect((await me.onboarding.state()).shouldPrompt).toBe(roleName !== "foreman");
    expect((await me.onboarding.candidateProjects()).map(j => j.id)).toContain(project!.id);
    await me.onboarding.complete({ acknowledged: true });
    await me.onboarding.complete({ acknowledged: true });
    expect(await db.select().from(schema.projectTeamMember).where(eq(schema.projectTeamMember.employeeId, p.employee.id))).toEqual(before);
  });
});
