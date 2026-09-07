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

    /*
      The other half of the gate, added 2026-09-06 after the seeded roles were
      checked one by one: an employee record is NOT enough.

      An equipment admin, a mechanic and the yard desk all have one and sit on
      zero crew rows, because they serve every job rather than working on any.
      They were being sent to a wizard whose first question is "which of your
      jobs is this about" — every step empty, and five clicks to a finish that
      recorded nothing.

      Keyed on the ROSTER and never on the role name. A role list is wrong the
      day a tenant adds a role, and `nav-config`'s role-name branch is already
      the last one in the product for that reason. A mechanic genuinely put on
      a job is prompted; an office-bound PM is not.
    */
    it("does NOT prompt an employee who is on no jobs", async () => {
      const s = await asStranger().state();
      expect(s.hasEmployeeRecord).toBe(true);
      expect(s.onAnyJob).toBe(false);
      expect(s.shouldPrompt).toBe(false);
    });

    /*
      The THIRD condition on the gate, added 2026-09-07: the role says which
      wizard its people get, and `none` means none at all.

      The client asked for this directly — "HR does not care about project, sees
      all project users, but does not see tools", and separately that technical
      and super admins "might not even require this on-boarding screen". The
      equipment chain (director -> area in-charge -> PM -> superintendent ->
      foreman -> crew) is what the existing wizard is for.

      Read off the ROLE ROW, never a list of role names in this file — the same
      reasoning that keyed the other two conditions on the roster. These tests
      therefore create real roles and attach them, rather than asserting on a
      name the gate never sees.
    */
    describe("onboardingKind on the role", () => {
      async function userWithRole(kind: string, label: string) {
        const [r] = await db
          .insert(schema.role)
          .values({ tenantId, name: `${label}-${suffix}`, onboardingKind: kind })
          .returning({ id: schema.role.id });
        const [u] = await db
          .insert(schema.user)
          .values({
            tenantId,
            email: `${label}-${suffix}@t.local`,
            passwordHash: "x",
            firstName: "K",
            lastName: "Role",
            employeeId: foremanEmp,
          })
          .returning({ id: schema.user.id });
        await db.insert(schema.userRole).values({ userId: u!.id, roleId: r!.id });
        return u!.id;
      }

      /* The control. Same person, same live roster row as `asForeman` — the
         ONLY difference in the three tests below is the flag, which is what
         makes them evidence about the flag rather than about the roster. */
      it("prompts a role marked `equipment`", async () => {
        const uid = await userWithRole("equipment", "equip");
        const s = await onboardingRouter.createCaller(ctx(uid, foremanEmp, ["project.team.read"])).state();
        expect(s.onAnyJob).toBe(true);
        expect(s.onboardingKind).toBe("equipment");
        expect(s.shouldPrompt).toBe(true);
      });

      it("does NOT prompt a role marked `none`, even on a job", async () => {
        const uid = await userWithRole("none", "nowiz");
        const s = await onboardingRouter.createCaller(ctx(uid, foremanEmp, ["project.team.read"])).state();
        /* Both of the OTHER two conditions are satisfied — this account has an
           employee record and a live roster row. The flag is the only thing
           standing between it and the wizard, which is the whole assertion. */
        expect(s.hasEmployeeRecord).toBe(true);
        expect(s.onAnyJob).toBe(true);
        expect(s.shouldPrompt).toBe(false);
      });

      it("does not nag a `none` role about unfinished setup either", async () => {
        /* `needsSetup` drives the sidebar notice. A role that is never sent to
           the wizard must not be told its setup is incomplete — that was the
           exact bug the roster condition fixed for mechanics, and a new
           exemption must not reintroduce it through the other door. */
        const uid = await userWithRole("none", "nonag");
        const caller = onboardingRouter.createCaller(ctx(uid, foremanEmp, ["project.team.read"]));
        await caller.complete({ dismissed: true });
        const s = await caller.state();
        expect(s.dismissedAt).not.toBeNull();
        expect(s.needsSetup).toBe(false);
      });

      it("prompts when a user has no role row at all", async () => {
        /* The default is `equipment`, deliberately: a wizard shown to somebody
           who did not need it is skippable, whereas setup silently skipped for
           somebody who DID need it is invisible. Fail toward the recoverable
           side. */
        const s = await asForeman().state();
        expect(s.onboardingKind).toBe("equipment");
        expect(s.shouldPrompt).toBe(true);
      });
    });

    it("prompts a person once they are put on a job", async () => {
      /*
        The gate has to OPEN as well as close, or it is just a way to lose
        people: somebody hired onto their first job next week must get the
        wizard then.

        Its OWN employee, not `asStranger`'s — assigning that one would leak a
        roster row into every later test in this file, and the
        candidate-projects block below asserts the stranger sees nothing.
        Fixture coupling of exactly that kind has already cost this suite once,
        in the `progress` block.
      */
      const hired = await mkUser(`onb-hired-${suffix}@stinventory.local`);
      const hiredEmp = await mkEmployee("Onb Hired");
      const caller = () => onboardingRouter.createCaller(ctx(hired, hiredEmp, ["project.team.read"]));

      expect((await caller().state()).shouldPrompt).toBe(false);

      await teamAsBoss().assign({ projectId: jobB, employeeId: hiredEmp, role: "foreman" });
      const s = await caller().state();
      expect(s.onAnyJob).toBe(true);
      expect(s.shouldPrompt).toBe(true);
    });

    it("stops nagging in the sidebar too, for somebody on no jobs", async () => {
      /* `needsSetup` drives the sidebar notice. Gated on the same conditions,
         or a mechanic who skipped is nagged forever about a wizard with
         nothing to ask them. */
      const quiet = await mkUser(`onb-quiet-${suffix}@stinventory.local`);
      const quietEmp = await mkEmployee("Onb Quiet");
      const caller = () => onboardingRouter.createCaller(ctx(quiet, quietEmp, ["project.team.read"]));
      await caller().complete({ dismissed: true });
      const s = await caller().state();
      expect(s.dismissedAt).not.toBeNull();
      expect(s.needsSetup).toBe(false);
    });

    it("resumes where it was left, forwards and back", async () => {
      await asForeman().setStep({ step: "crew" });
      expect((await asForeman().state()).currentStep).toBe("crew");
      await asForeman().setStep({ step: "details" });
      expect((await asForeman().state()).currentStep).toBe("details");
    });

    it("distinguishes SKIPPED from finished, and offers a way back", async () => {
      /*
        Skipping used to be indistinguishable from finishing — both stamped
        `completedAt` and the difference lived only in an audit line nothing
        read — which made it a dead end with no route back to the wizard.
        `dismissedAt` is what the sidebar's "finish your setup" notice reads.
      */
      const skipUser = await mkUser(`onb-skipper-${suffix}@stinventory.local`);
      const skipper = () => onboardingRouter.createCaller(ctx(skipUser, foremanEmp, ["project.team.read"]));

      await skipper().complete({ dismissed: true });
      const after = await skipper().state();
      expect(after.completedAt).not.toBeNull();
      expect(after.dismissedAt).not.toBeNull();
      /* Closed for the GATE... */
      expect(after.shouldPrompt).toBe(false);
      /* ...but the sidebar still offers the way back. */
      expect(after.needsSetup).toBe(true);
    });

    it("resume reopens the wizard and clears the notice", async () => {
      const u = await mkUser(`onb-resumer-${suffix}@stinventory.local`);
      const who = () => onboardingRouter.createCaller(ctx(u, foremanEmp, ["project.team.read"]));

      await who().setStep({ step: "location" });
      await who().complete({ dismissed: true });
      expect((await who().state()).needsSetup).toBe(true);

      const r = await who().resume();
      expect(r.reopened).toBe(true);

      const state = await who().state();
      expect(state.completedAt).toBeNull();
      expect(state.dismissedAt).toBeNull();
      /* The gate sends them back... */
      expect(state.shouldPrompt).toBe(true);
      expect(state.needsSetup).toBe(false);
      /* ...to where they stopped, not to the beginning. */
      expect(state.currentStep).toBe("location");
    });

    it("finishing for real after a skip clears the skipped mark for good", async () => {
      const u = await mkUser(`onb-redeemed-${suffix}@stinventory.local`);
      const who = () => onboardingRouter.createCaller(ctx(u, foremanEmp, ["project.team.read"]));

      await who().complete({ dismissed: true });
      await who().resume();
      await who().complete({ dismissed: false });

      const state = await who().state();
      expect(state.completedAt).not.toBeNull();
      expect(state.dismissedAt).toBeNull();
      expect(state.needsSetup).toBe(false);
      expect(state.shouldPrompt).toBe(false);
    });

    it("resume is a no-op for somebody who genuinely finished", async () => {
      /* Otherwise a stale sidebar could drop somebody back into a wizard they
         had already completed. */
      const u = await mkUser(`onb-done-${suffix}@stinventory.local`);
      const who = () => onboardingRouter.createCaller(ctx(u, foremanEmp, ["project.team.read"]));

      await who().complete({ dismissed: false });
      const r = await who().resume();
      expect(r.reopened).toBe(false);
      expect((await who().state()).shouldPrompt).toBe(false);
    });

    it("never offers the notice to an account with no employee record", async () => {
      const who = () => onboardingRouter.createCaller(ctx(noEmployeeUserId, null, ["project.team.read"]));
      await who().complete({ dismissed: true });
      const state = await who().state();
      /* Skipped, but it was never sent to the wizard in the first place, so
         nagging it about setup would be nagging about a task it cannot do. */
      expect(state.dismissedAt).not.toBeNull();
      expect(state.needsSetup).toBe(false);
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
