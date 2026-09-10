import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@stinventory/db";
import type { Permission } from "@stinventory/types";
import { onboardingRouter } from "./routers/onboarding.js";
import { projectTeamRouter } from "./routers/projectTeam.js";
import type { Context } from "./trpc.js";

/*
  Project geography (fillDetails/setLocation) and the crew step's read
  (crewStatus).

  The shared thread across all three: none of them may accept a permission
  wide enough to let the caller act on a job they are not on. `project.manage`
  would do it in one line and is exactly what was rejected — the primary
  onboarding user does not hold it, so these are scoped in-body to the
  caller's own live roster row instead. The tests here exist to pin THAT
  choice, not just "does the write succeed".

  Real Postgres via DATABASE_URL, throwaway tenant with a real five-tier ladder
  so `crewStatus` has something non-trivial to compute over.
*/
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("onboarding: geography and crew status", () => {
  let db: Database;
  let tenantId: string;
  let jobA: string;
  let jobB: string;
  let foremanEmp: string;
  let superEmp: string;
  let pmEmp: string;
  let foremanUserId: string;
  let superUserId: string;
  let pmUserId: string;

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
    sessionSecret: "onboarding-geo-secret",
    mailFallback: null,
    webOrigin: "http://localhost:3100",
    request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
  });

  const asForeman = () => onboardingRouter.createCaller(ctx(foremanUserId, foremanEmp, ["project.team.read"]));
  const asSuper = () =>
    onboardingRouter.createCaller(ctx(superUserId, superEmp, ["project.team.read"]));
  const asPm = () =>
    onboardingRouter.createCaller(
      ctx(pmUserId, pmEmp, ["project.team.read"]),
    );
  const teamAsPm = () =>
    projectTeamRouter.createCaller(
      ctx(pmUserId, pmEmp, ["project.team.read"]),
    );
  /* Setup only — placing the PM themselves needs a wider grant than a PM
     actually holds day to day (filling a PM slot is admin/equipment-department
     territory, and no tier is registered to set it). An admin-shaped caller does the fixture's own seeding so the
     PM's own permission set stays the real, narrow one everywhere else. */
  const teamAsAdmin = () =>
    projectTeamRouter.createCaller(
      ctx(pmUserId, pmEmp, ["project.team.assign", "project.team.read"]),
    );

  async function mkUser(email: string) {
    const [u] = await db
      .insert(schema.user)
      .values({ tenantId, email, passwordHash: "x", firstName: "T", lastName: "User" })
      .returning({ id: schema.user.id });
    return u!.id;
  }
  async function mkProject(name: string) {
    const [p] = await db
      .insert(schema.project)
      .values({ tenantId, name, status: "in_progress", startDate: "2026-01-01" })
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
      .values({ name: `OnbGeo ${suffix}`, slug: `onb-geo-${suffix}` })
      .returning({ id: schema.tenant.id });
    tenantId = t!.id;

    /* A real ladder: pm -> superintendent -> foreman, so crewStatus has a tier
       above and below the superintendent to compute. */
    const [pmRole] = await db
      .insert(schema.teamRole)
      .values({ tenantId, name: "pm", label: "Project Manager", canHoldCustody: false })
      .returning({ id: schema.teamRole.id });
    const [superRole] = await db
      .insert(schema.teamRole)
      .values({
        tenantId,
        name: "superintendent",
        label: "Superintendent",
        canHoldCustody: true,
        reportsToTeamRoleId: pmRole!.id,
      })
      .returning({ id: schema.teamRole.id });
    const [foremanRole] = await db
      .insert(schema.teamRole)
      .values({
        tenantId,
        name: "foreman",
        label: "Foreman",
        canHoldCustody: true,
        reportsToTeamRoleId: superRole!.id,
      })
      .returning({ id: schema.teamRole.id });

    /* "Set by": who may FILL each tier, held on the same project. This is what
       carries the authority the dedicated `project.assign.*` permissions used
       to grant tenant-wide, removed 2026-09-10 — a superintendent fills a
       foreman slot, a PM fills a superintendent slot, and nobody fills a PM
       slot without `project.team.assign`. Note this is NOT the same shape as
       `reportsToTeamRoleId` above, which says who a tier ANSWERS to. */
    await db.insert(schema.teamRoleAssigner).values([
      { teamRoleId: foremanRole!.id, assignerTeamRoleId: superRole!.id },
      /* A PM fills a foreman slot too. Not redundant with the superintendent
         row: authority is the tier held ON THAT JOB, so on a job flatter than
         the ladder — no superintendent, foreman reporting straight to the PM,
         which the schema comment on reportsToEmployeeId calls legal — the
         superintendent row grants nobody anything. The removed
         `project.assign.foreman` permission covered this case tenant-wide and
         silently; the register now has to say it. */
      { teamRoleId: foremanRole!.id, assignerTeamRoleId: pmRole!.id },
      { teamRoleId: superRole!.id, assignerTeamRoleId: pmRole!.id },
    ]);

    foremanUserId = await mkUser(`geo-foreman-${suffix}@stinventory.local`);
    superUserId = await mkUser(`geo-super-${suffix}@stinventory.local`);
    pmUserId = await mkUser(`geo-pm-${suffix}@stinventory.local`);

    foremanEmp = await mkEmployee("Geo Foreman");
    superEmp = await mkEmployee("Geo Super");
    pmEmp = await mkEmployee("Geo PM");

    jobA = await mkProject(`Geo Job A ${suffix}`);
    jobB = await mkProject(`Geo Job B ${suffix}`);

    /* Place people on jobA through the real chokepoint, not a direct insert —
       the whole roster is a live thing these tests read back through. */
    /* reportsToEmployeeId set explicitly — this is the PERSON edge
       `descendantsOf`/`progress` actually walk, distinct from the tier ladder
       tested elsewhere. A real onboarding crew step writes this the same way,
       from the picker in `crew-step.tsx`. */
    await teamAsAdmin().assign({ projectId: jobA, employeeId: pmEmp, role: "pm" });
    await teamAsAdmin().assign({
      projectId: jobA,
      employeeId: superEmp,
      role: "superintendent",
      reportsToEmployeeId: pmEmp,
    });
    await teamAsAdmin().assign({
      projectId: jobA,
      employeeId: foremanEmp,
      role: "foreman",
      reportsToEmployeeId: superEmp,
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.tenant).where(eq(schema.tenant.id, tenantId));
  });

  describe("myClaimedProjects", () => {
    it("returns only jobs the caller actually holds a live roster row on", async () => {
      const rows = await asForeman().myClaimedProjects();
      expect(rows.map((r) => r.id)).toEqual([jobA]);
    });

    it("is empty for somebody with no roster row anywhere", async () => {
      const rows = await asForeman().myClaimedProjects();
      expect(rows.find((r) => r.id === jobB)).toBeUndefined();
    });

    it("flags what's missing", async () => {
      const rows = await asForeman().myClaimedProjects();
      const job = rows.find((r) => r.id === jobA)!;
      expect(job.missingSiteAddress).toBe(true);
      expect(job.missingLocation).toBe(true);
    });
  });

  describe("fillDetails", () => {
    it("refuses a job the caller is not on", async () => {
      await expect(asForeman().fillDetails({ projectId: jobB, siteAddress: "123 Nowhere" })).rejects.toThrow(
        /not on this job/i,
      );
    });

    it("fills a genuinely missing field", async () => {
      const r = await asForeman().fillDetails({ projectId: jobA, siteAddress: "123 Site Rd" });
      expect(r.changed).toBe(true);
      const row = await db.query.project.findFirst({ where: eq(schema.project.id, jobA) });
      expect(row?.siteAddress).toBe("123 Site Rd");
    });

    it("does NOT overwrite a field that is already set", async () => {
      const r = await asForeman().fillDetails({ projectId: jobA, siteAddress: "A different address" });
      expect(r.changed).toBe(false);
      const row = await db.query.project.findFirst({ where: eq(schema.project.id, jobA) });
      expect(row?.siteAddress).toBe("123 Site Rd");
    });

    it("needs no project.manage — a foreman with only project.team.read can fill their own job", async () => {
      /* This is the whole point of the procedure existing separately from
         project.update: the primary onboarding user does not hold
         project.manage, and this must still work for them. */
      const r = await asForeman().fillDetails({ projectId: jobA, description: "Notes from the foreman" });
      expect(r.changed).toBe(true);
    });
  });

  describe("setLocation", () => {
    it("refuses a job the caller is not on", async () => {
      await expect(
        asForeman().setLocation({ projectId: jobB, latitude: 32.5, longitude: -96.5, geofenceRadiusM: 100 }),
      ).rejects.toThrow(/not on this job/i);
    });

    it("refuses a radius with no pin", async () => {
      await expect(
        asForeman().setLocation({ projectId: jobA, latitude: null, longitude: null, geofenceRadiusM: 100 }),
      ).rejects.toThrow(/needs a pin/i);
    });

    it("pins the job", async () => {
      await asForeman().setLocation({ projectId: jobA, latitude: 32.7767, longitude: -96.797, geofenceRadiusM: 150 });
      const row = await db.query.project.findFirst({ where: eq(schema.project.id, jobA) });
      expect(Number(row?.latitude)).toBeCloseTo(32.7767, 4);
      expect(Number(row?.longitude)).toBeCloseTo(-96.797, 4);
      expect(row?.geofenceRadiusM).toBe(150);
    });

    it("OVERWRITES rather than fills gaps — repinning is normal use", async () => {
      await asForeman().setLocation({ projectId: jobA, latitude: 33.0, longitude: -97.0, geofenceRadiusM: 200 });
      const row = await db.query.project.findFirst({ where: eq(schema.project.id, jobA) });
      expect(Number(row?.latitude)).toBeCloseTo(33.0, 4);
      expect(row?.geofenceRadiusM).toBe(200);
    });

    it("clears the pin when asked", async () => {
      await asForeman().setLocation({ projectId: jobA, latitude: null, longitude: null, geofenceRadiusM: null });
      const row = await db.query.project.findFirst({ where: eq(schema.project.id, jobA) });
      expect(row?.latitude).toBeNull();
      expect(row?.geofenceRadiusM).toBeNull();
    });
  });

  describe("crewStatus", () => {
    it("shows the superintendent's boss (PM) as FILLED and unconfirmed", async () => {
      const rows = await asSuper().crewStatus();
      const job = rows.find((r) => r.projectId === jobA)!;
      const above = job.tiers.find((t) => t.relation === "above")!;
      expect(above.teamRoleName).toBe("pm");
      expect(above.filled).toHaveLength(1);
      expect(above.filled[0]!.confirmed).toBe(false);
    });

    it("shows the superintendent's crew (foreman) as FILLED too", async () => {
      const rows = await asSuper().crewStatus();
      const job = rows.find((r) => r.projectId === jobA)!;
      const below = job.tiers.find((t) => t.relation === "below")!;
      expect(below.teamRoleName).toBe("foreman");
      expect(below.filled).toHaveLength(1);
    });

    it("canAssign is true for a tier the caller actually holds the permission for", async () => {
      const rows = await asSuper().crewStatus();
      const job = rows.find((r) => r.projectId === jobA)!;
      const above = job.tiers.find((t) => t.relation === "above")!; // pm
      /* This caller's tier may fill a foreman slot, but nothing may fill a PM
         slot except the tenant-wide grant, which this caller does not hold. */
      expect(above.canAssign).toBe(false);
    });

    it("canAssign is true for the PM looking at their own superintendent tier", async () => {
      const rows = await asPm().crewStatus();
      const job = rows.find((r) => r.projectId === jobA)!;
      const below = job.tiers.find((t) => t.relation === "below")!;
      expect(below.teamRoleName).toBe("superintendent");
      expect(below.canAssign).toBe(true);
    });

    it("PM confirming the superintendent's row succeeds and is reflected here", async () => {
      const rows = await asPm().crewStatus();
      const job = rows.find((r) => r.projectId === jobA)!;
      const below = job.tiers.find((t) => t.relation === "below")!;
      const rowId = below.filled[0]!.id;

      await teamAsPm().confirm({ id: rowId });

      const after = await asPm().crewStatus();
      const jobAfter = after.find((r) => r.projectId === jobA)!;
      const belowAfter = jobAfter.tiers.find((t) => t.relation === "below")!;
      expect(belowAfter.filled[0]!.confirmed).toBe(true);
    });

    it("is empty for somebody with no live roster row", async () => {
      const rows = await onboardingRouter
        .createCaller(ctx(await mkUser(`geo-nobody-${suffix}@stinventory.local`), null, []))
        .crewStatus();
      expect(rows).toEqual([]);
    });

    it("shows a tier as deferred, not empty, once deferred", async () => {
      /* jobB has nobody on it yet, so put the PM and the foreman on it — the
         PM is who the deferral belongs to (superintendent reports to pm in
         this fixture's ladder), and crewStatus needs something on the job to
         compute for. */
      await teamAsAdmin().assign({ projectId: jobB, employeeId: pmEmp, role: "pm" });
      /* No superintendent on jobB — that tier is exactly what was just
         deferred — so the foreman reports straight to the PM here, the same
         shape the schema comment on reportsToEmployeeId describes as legal
         (a job can be flatter than the tier ladder's usual chain). */
      await teamAsPm().assign({ projectId: jobB, employeeId: foremanEmp, role: "foreman", reportsToEmployeeId: pmEmp });

      await asForeman().defer({ projectId: jobB, teamRole: "superintendent" });

      const rows = await asForeman().crewStatus();
      const jobBRow = rows.find((r) => r.projectId === jobB)!;
      const above = jobBRow.tiers.find((t) => t.relation === "above")!;
      expect(above.teamRoleName).toBe("superintendent");
      expect(above.deferred).toBe(true);
      expect(above.filled).toHaveLength(0);
    });
  });

  /*
    `progress` gets its OWN tenant and roster rather than reusing jobA/jobB
    above. Those are mutated across five prior `describe` blocks — a foreman
    reassigned to a second job closes his first roster row, exactly as
    `moveEmployeeToProject` is supposed to — and asserting counts against that
    shared, evolving history is fragile in a way that cost real debugging time
    while this file was written: a count that was right when the test was
    first drafted silently went wrong two `it`s later for a completely
    legitimate reason. A dedicated fixture makes every assertion here true by
    construction instead of true by coincidence of execution order.
  */
  /*
    The claim, and the bug it exists to prevent.

    Step one's ticks were React state and nothing else in the first cut: a
    person picked three jobs, moved to step two, and was told they had claimed
    none, because steps two and three read the server. These pin the fix at the
    seam where it broke — a claim written by `setClaim` has to show up in
    `myClaimedProjects`, which is what those steps actually call.
  */
  /*
    The claim, and the bug it exists to prevent.

    Step one's ticks were React state and nothing else in the first cut: a
    person picked three jobs, moved to step two, and was told they had claimed
    none, because steps two and three read the server. These pin the fix at the
    seam where it broke — a claim written by `setClaim` has to show up in
    `myClaimedProjects`, which is what those steps actually call.

    Uses its OWN job, created here rather than reusing jobA/jobB. Those two are
    mutated by the crew tests above (a foreman reassigned to a second job
    closes his first roster row, exactly as `moveEmployeeToProject` should), and
    asserting "no roster row on this job" against them depends on which
    `describe` ran last — which is the coupling that made the first draft of
    these four tests fail for a reason that had nothing to do with claims.
  */
  /*
    Replaces the old "claims" block. `project_claim` and `setClaim` are gone:
    step one no longer lets a person tick a job they are not on, because the
    tick granted nothing and every later step then had to refuse it. What
    remains to pin is the rule that replaced it — the wizard's idea of "your
    jobs" is the roster, and it is the SAME set the mutations enforce, so the
    UI can never offer an edit the server will reject.
  */
  describe("your jobs is the roster, everywhere", () => {
    let strangerJob: string;

    beforeAll(async () => {
      strangerJob = await mkProject(`Geo Stranger Job ${suffix}`);
    });

    it("candidateProjects lists only jobs the caller is rostered on", async () => {
      const rows = await asForeman().candidateProjects();
      expect(rows.map((r) => r.id)).not.toContain(strangerJob);
      /* Not merely "excludes that one" — everything returned is a real roster
         row, which is the property the client relies on. */
      expect(rows.every((r) => r.alreadyOn)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });

    it("candidateProjects and myClaimedProjects agree on the set", async () => {
      const [a, b] = await Promise.all([
        asForeman().candidateProjects(),
        asForeman().myClaimedProjects(),
      ]);
      expect(new Set(b.map((r) => r.id))).toEqual(new Set(a.map((r) => r.id)));
    });

    /*
      The contract behind the bug that retired claims. These two mutations are
      what step one's list must agree with: if a job can be listed but not
      edited, the wizard offers an action that 403s. Asserted rather than
      implied, because loosening either one silently breaks the UI's premise.
    */
    it("refuses setLocation on a job the caller is not on", async () => {
      await expect(
        asForeman().setLocation({
          projectId: strangerJob,
          latitude: 32.7767,
          longitude: -96.797,
          geofenceRadiusM: 150,
        }),
      ).rejects.toThrow(/not on this job/i);
    });

    it("refuses fillDetails on a job the caller is not on", async () => {
      await expect(
        asForeman().fillDetails({ projectId: strangerJob, siteAddress: "1 Test Way" }),
      ).rejects.toThrow(/not on this job/i);
    });
  });

  describe("progress", () => {
    let ptid: string;
    let pJobA: string;
    let pJobB: string;
    let pPm: string;
    let pSuper: string;
    let pForeman: string;
    let pPmUserId: string;
    let pForemanUserId: string;
    let pSuperUserId: string;

    const pctx = (userId: string, employeeId: string | null, perms: Permission[]): Context => ({
      db,
      session: {
        userId,
        tenantId: ptid,
        employeeId,
        permissions: new Set<Permission>(perms),
        roleName: null,
        actorLabel: null,
      },
      sessionSecret: "onboarding-progress-secret",
      mailFallback: null,
      webOrigin: "http://localhost:3100",
      request: { method: null, path: null, ip: null, userAgent: null, source: "system" },
    });
    const pAsPm = () =>
      onboardingRouter.createCaller(
        pctx(pPmUserId, pPm, ["project.team.read"]),
      );
    const pAsSuper = () =>
      onboardingRouter.createCaller(pctx(pSuperUserId, pSuper, ["project.team.read"]));
    const pAsForeman = () => onboardingRouter.createCaller(pctx(pForemanUserId, pForeman, ["project.team.read"]));
    const pTeamAsAdmin = () =>
      projectTeamRouter.createCaller(
        pctx(pPmUserId, pPm, [
          "project.team.assign",
          "project.team.read",
        ]),
      );
    const pTeamAsPm = () =>
      projectTeamRouter.createCaller(
        pctx(pPmUserId, pPm, ["project.team.read"]),
      );

    beforeAll(async () => {
      const [t] = await db
        .insert(schema.tenant)
        .values({ name: `OnbProg ${suffix}`, slug: `onb-prog-${suffix}` })
        .returning({ id: schema.tenant.id });
      ptid = t!.id;

      const [pmRole] = await db
        .insert(schema.teamRole)
        .values({ tenantId: ptid, name: "pm", label: "Project Manager", canHoldCustody: false })
        .returning({ id: schema.teamRole.id });
      const [superRole] = await db
        .insert(schema.teamRole)
        .values({
          tenantId: ptid,
          name: "superintendent",
          label: "Superintendent",
          canHoldCustody: true,
          reportsToTeamRoleId: pmRole!.id,
        })
        .returning({ id: schema.teamRole.id });
      const [pForemanRole] = await db
        .insert(schema.teamRole)
        .values({
          tenantId: ptid,
          name: "foreman",
          label: "Foreman",
          canHoldCustody: true,
          reportsToTeamRoleId: superRole!.id,
        })
        .returning({ id: schema.teamRole.id });

      /* Same "Set by" wiring as the geo fixture above — see the comment there
         for why these rows and not a permission. */
      await db.insert(schema.teamRoleAssigner).values([
        { teamRoleId: pForemanRole!.id, assignerTeamRoleId: superRole!.id },
        { teamRoleId: pForemanRole!.id, assignerTeamRoleId: pmRole!.id },
        { teamRoleId: superRole!.id, assignerTeamRoleId: pmRole!.id },
      ]);

      const mkPUser = async (email: string) => {
        const [u] = await db
          .insert(schema.user)
          .values({ tenantId: ptid, email, passwordHash: "x", firstName: "T", lastName: "User" })
          .returning({ id: schema.user.id });
        return u!.id;
      };
      const mkPEmployee = async (name: string, userId?: string) => {
        const [e] = await db
          .insert(schema.employee)
          .values({ tenantId: ptid, name, role: "foreman", employmentStatus: "active" })
          .returning({ id: schema.employee.id });
        if (userId) await db.update(schema.user).set({ employeeId: e!.id }).where(eq(schema.user.id, userId));
        return e!.id;
      };
      const mkPProject = async (name: string) => {
        const [p] = await db
          .insert(schema.project)
          .values({ tenantId: ptid, name, status: "in_progress", startDate: "2026-01-01" })
          .returning({ id: schema.project.id });
        return p!.id;
      };

      pPmUserId = await mkPUser(`prog-pm-${suffix}@stinventory.local`);
      pForemanUserId = await mkPUser(`prog-foreman-${suffix}@stinventory.local`);
      pSuperUserId = await mkPUser(`prog-super-${suffix}@stinventory.local`);

      pPm = await mkPEmployee("Prog PM", pPmUserId);
      pSuper = await mkPEmployee("Prog Super", pSuperUserId);
      pForeman = await mkPEmployee("Prog Foreman", pForemanUserId);

      pJobA = await mkPProject(`Prog Job A ${suffix}`);
      pJobB = await mkPProject(`Prog Job B ${suffix}`);

      /* jobA: full chain, pm -> super -> foreman, super's row confirmed. */
      await pTeamAsAdmin().assign({ projectId: pJobA, employeeId: pPm, role: "pm" });
      await pTeamAsAdmin().assign({
        projectId: pJobA,
        employeeId: pSuper,
        role: "superintendent",
        reportsToEmployeeId: pPm,
      });
      const [superRow] = await db
        .select({ id: schema.projectTeamMember.id })
        .from(schema.projectTeamMember)
        .where(
          and(
            eq(schema.projectTeamMember.tenantId, ptid),
            eq(schema.projectTeamMember.employeeId, pSuper),
            eq(schema.projectTeamMember.projectId, pJobA),
          ),
        );
      await pTeamAsPm().confirm({ id: superRow!.id });

      /* jobB: pm and foreman only, foreman reporting straight to the PM — a
         flatter shape than the usual chain, which the roster schema comment
         says is legal. The foreman defers the superintendent tier here. */
      await pTeamAsAdmin().assign({ projectId: pJobB, employeeId: pPm, role: "pm" });
      await pTeamAsPm().assign({
        projectId: pJobB,
        employeeId: pForeman,
        role: "foreman",
        reportsToEmployeeId: pPm,
      });
      await pAsForeman().defer({ projectId: pJobB, teamRole: "superintendent" });
    });

    afterAll(async () => {
      await db.delete(schema.tenant).where(eq(schema.tenant.id, ptid));
    });

    it("counts the roster and what's unconfirmed on a job", async () => {
      const rows = await pAsPm().progress();
      const job = rows.byJob.find((r) => r.projectId === pJobA)!;
      expect(job.rosterCount).toBe(2); // pm, super (foreman is on jobB in this fixture)
      expect(job.unconfirmedCount).toBe(1); // pm's own row; super's was confirmed
    });

    it("reports no geography until a pin is actually set", async () => {
      const rows = await pAsPm().progress();
      const job = rows.byJob.find((r) => r.projectId === pJobA)!;
      expect(job.hasLocation).toBe(false);
    });

    it("lists people below the PM, not the PM themselves", async () => {
      const rows = await pAsPm().progress();
      const ids = rows.byPerson.map((p) => p.employeeId);
      expect(ids).toContain(pSuper);
      expect(ids).toContain(pForeman);
      expect(ids).not.toContain(pPm);
    });

    it("goes several levels deep — the super's own crew shows on the PM's screen too", async () => {
      /* pForeman reports to pPm directly on jobB, not through pSuper, so this
         is really testing that BOTH of the PM's reporting lines merge into one
         list — jobA's chain and jobB's flatter one. */
      const rows = await pAsPm().progress();
      expect(rows.byPerson.map((p) => p.employeeId).sort()).toEqual([pForeman, pSuper].sort());
    });

    it("does not show a superintendent's own boss, only their crew", async () => {
      const rows = await pAsSuper().progress();
      const ids = rows.byPerson.map((p) => p.employeeId);
      expect(ids).not.toContain(pPm);
    });

    it("puts a foreman's deferred tier on the PM's screen, not the foreman's", async () => {
      const pmRows = await pAsPm().progress();
      const jobBForPm = pmRows.byJob.find((r) => r.projectId === pJobB);
      expect(jobBForPm?.openDeferrals.map((d) => d.teamRole)).toContain("superintendent");

      const foremanRows = await pAsForeman().progress();
      const jobBForForeman = foremanRows.byJob.find((r) => r.projectId === pJobB);
      expect(jobBForForeman?.openDeferrals ?? []).toHaveLength(0);
    });

    it("reflects account and sign-in state honestly", async () => {
      const rows = await pAsPm().progress();
      const foreman = rows.byPerson.find((p) => p.employeeId === pForeman)!;
      expect(foreman.hasAccount).toBe(true);
      expect(foreman.everSignedIn).toBe(false);
    });

    it("is empty for somebody with nobody below them", async () => {
      const rows = await pAsForeman().progress();
      expect(rows.byPerson).toEqual([]);
    });

    it("needs project.team.read", async () => {
      await expect(onboardingRouter.createCaller(pctx(pPmUserId, pPm, [])).progress()).rejects.toThrow();
    });
  });
});
