import { restrictedProjects, assertProjectAccess, activeProjectRows } from "../project-access.js";
import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { adjacentTiers, canAssignIntoTier, descendantsOf, removalBranch, tiersAbove, tiersAtOrBelow } from "@stinventory/domain";
import type { Permission } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { viewTierOf } from "../scope.js";
import { projectTeamRouter } from "./projectTeam.js";

/*
  First-run setup — walking a newly invited person through claiming their work.

  The product's shape before this: an invite lands on a password form, and the
  person is then dropped into the shell with no idea what they are responsible
  for. Everything the system knows about them was typed in by an administrator,
  and anything that administrator did not know stays unknown forever.

  WHAT THIS ROUTER IS NOT. It is not a second way to write the roster. Every
  write the wizard performs goes through `projectTeam.assign`, under the caller's
  own permissions, exactly as the Tools by Jobsite card does — see the note on
  `assertCanAssign`. A superintendent puts their foremen on; a foreman does not,
  because a foreman never could, and the wizard is not the place to invent an
  exception to that. Foremen skip onboarding (role onboardingKind = none) and
  see their superintendent-recorded crew and assigned tools in the app.

  So this router owns:
    - the per-user state row (where am I up to, am I done)
    - the deferral record (I am deliberately leaving this tier to my boss)
    - reads that assemble a person's wizard, and a boss's view of their crew's
      wizards, from tables owned elsewhere

  `progress` (bottom of this file) is the last of those: it computes, never
  stores. There is no `onboarding_progress` table — this codebase's one idea
  is that state is calculated from what happened rather than typed into a
  field, and a stored percentage would be the same mistake this whole feature
  exists to avoid, just moved one screen over.
*/

/* The wizard's steps, in order. Exported so the client cannot drift from the
   server's idea of what comes next — the resume point is stored as one of
   these and validated on write. */
export const ONBOARDING_STEPS = ["projects", "details", "location", "crew", "invite", "review"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/*
  Find or create this person's onboarding row.

  Lazy rather than created with the account, because an account an administrator
  made months ago and nobody ever used has no onboarding state — and backfilling
  rows for accounts that may never sign in would make "has not started" and "does
  not exist" indistinguishable.

  The insert races itself across two tabs, which `user_onboarding_user_uq` turns
  into a failed insert rather than a duplicate. Re-reading on conflict is the
  whole recovery: the other tab's row is just as good as the one we wanted.
*/
async function ensureRow(ctx: any) {
  const tid = ctx.session.tenantId;
  const uid = ctx.session.userId;

  const existing = await ctx.db.query.userOnboarding.findFirst({
    where: and(eq(schema.userOnboarding.userId, uid), eq(schema.userOnboarding.tenantId, tid)),
  });
  if (existing) return existing;

  try {
    const [created] = await ctx.db
      .insert(schema.userOnboarding)
      .values({ tenantId: tid, userId: uid, currentStep: "projects" })
      .returning();
    return created!;
  } catch {
    const row = await ctx.db.query.userOnboarding.findFirst({
      where: and(eq(schema.userOnboarding.userId, uid), eq(schema.userOnboarding.tenantId, tid)),
    });
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not start onboarding." });
    return row;
  }
}

/*
  Does this role keep the ability to claim after setup is finished?

  Today: any role granted a tier. The grant is already narrow — three roles hold
  one — and it is exactly the set that leads jobs, so a second flag saying
  "...and may keep doing it" would be a second name for the same fact and one
  more thing to keep in step.

  Kept as a named function anyway, because `canClaim`, `claimOptions` and
  `claimProject` all have to agree and three copies of `!!role.claimTierNames.length`
  is how they would stop agreeing.
*/
function isStandingClaimer(role: { claimTierNames: string[] } | undefined): boolean {
  return !!role?.claimTierNames.length;
}

async function onboardingRole(ctx: any) {
  const roles = await ctx.db.select({ onboardingKind: schema.role.onboardingKind, needsLogin: schema.role.needsLogin, claimTierNames: schema.role.claimTierNames }).from(schema.userRole).innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId)).where(eq(schema.userRole.userId, ctx.session.userId));
  if (roles.length > 1) throw new TRPCError({ code: "CONFLICT", message: "Ask an administrator to select one access role for your account." });
  return roles[0] as { onboardingKind: string; needsLogin: boolean; claimTierNames: string[] } | undefined;
}

export const onboardingRouter = router({
  state: protectedProcedure.query(async ({ ctx }) => {
    const row = await ensureRow(ctx);
    const role = await onboardingRole(ctx);
    const projects = ctx.session.employeeId ? await ctx.db.select({ id: schema.projectTeamMember.id }).from(schema.projectTeamMember).where(and(eq(schema.projectTeamMember.tenantId, ctx.session.tenantId), eq(schema.projectTeamMember.employeeId, ctx.session.employeeId), isNull(schema.projectTeamMember.endedOn))) : [];
    const onAnyJob = projects.length > 0;
    const hasEmployee = !!ctx.session.employeeId;
    const onboardingKind = role?.onboardingKind ?? "office";
    /*
      CLAIMING DOES NOT CLOSE FOR THE TIERS THAT LEAD JOBS.

      `claimingClosedAt` and `completedAt` were both hard stops: a person
      claimed during first-run setup and never again. That is right for
      somebody describing where they already work — the wizard asks once and
      their boss corrects it afterwards.

      It is wrong for the tiers that RUN jobs. A director takes on a new job
      routinely, and under the old rule the only way to record it was for an
      administrator to reopen their onboarding, which made a weekly act need a
      support request. Since 2026-09-10 a role holding `claimTierNames` keeps
      the ability, and reaches it from a standing page (`/claim-a-job`) rather
      than only from the wizard.

      Everyone else is unchanged, which is what stops this becoming a way to
      regain access: a person with no claim grant still gets one pass, and
      Re-onboard still cannot hand them another.
    */
    const canClaim = hasEmployee && !!role?.claimTierNames.length && (isStandingClaimer(role) || (!row.claimingClosedAt && !row.completedAt));
    const steps: OnboardingStep[] = onboardingKind === "equipment" && hasEmployee && (onAnyJob || canClaim) ? ["projects", ...(ctx.session.permissions.has("project.team.read") ? ["crew" as const] : []), "review"] : ["review"];
    const finished = !!row.completedAt && !row.dismissedAt;
    return {
      currentStep: steps.includes(row.currentStep as OnboardingStep) ? row.currentStep as OnboardingStep : steps[0]!,
      completedAt: row.completedAt, dismissedAt: row.dismissedAt, startedAt: row.startedAt,
      shouldPrompt: !finished && onboardingKind !== "none" && (role?.needsLogin ?? true),
      needsSetup: !finished && onboardingKind !== "none",
      hasEmployeeRecord: hasEmployee, onboardingKind, onAnyJob, steps, canClaim,
    };
  }),

  claimOptions: protectedProcedure.query(async ({ ctx }) => {
    const row = await ensureRow(ctx);
    const role = await onboardingRole(ctx);
    if (!ctx.session.employeeId || !role?.claimTierNames.length) return { projects: [], tiers: [] };
    if (!isStandingClaimer(role) && (row.completedAt || row.claimingClosedAt)) return { projects: [], tiers: [] };
    const denied = await restrictedProjects(ctx.db, ctx.session);
    const projects = await ctx.db.select({ id: schema.project.id, name: schema.project.name, code: schema.project.code }).from(schema.project).where(and(eq(schema.project.tenantId, ctx.session.tenantId), eq(schema.project.kind, "project"), inArray(schema.project.status, ["awarded", "in_progress", "on_hold"])));
    const tiers = await ctx.db.select({ name: schema.teamRole.name, label: schema.teamRole.label }).from(schema.teamRole).where(and(eq(schema.teamRole.tenantId, ctx.session.tenantId), inArray(schema.teamRole.name, role.claimTierNames)));
    return { projects: projects.filter(p => !denied.has(p.id)), tiers };
  }),

  claimProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), tier: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureRow(ctx);
      return ctx.db.transaction(async tx => {
        // Serialize claiming against finishing: a stale onboarding tab cannot regain access.
        const [row] = await tx.select().from(schema.userOnboarding).where(and(eq(schema.userOnboarding.userId, ctx.session.userId), eq(schema.userOnboarding.tenantId, ctx.session.tenantId))).for("update");
        const role = await onboardingRole({ ...ctx, db: tx });
        const closed = !isStandingClaimer(role) && (row?.completedAt || row?.claimingClosedAt);
        if (!ctx.session.employeeId || closed || !role?.claimTierNames.includes(input.tier)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            /* Two different refusals wearing one sentence was the complaint
               that started this: a director with no claim grant was told to
               ask a manager they do not have. Say which case it is. */
            message: role?.claimTierNames.length
              ? "That is not a tier you may take on. Choose one of your own, or ask whoever runs this job."
              : "Project claiming is not available for your role. Ask whoever runs this job to add you.",
          });
        }
        if ((await restrictedProjects(tx as any, ctx.session)).has(input.projectId)) throw new TRPCError({ code: "FORBIDDEN", message: "Your manager removed access to this project." });
        const project = await tx.query.project.findFirst({ where: and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, ctx.session.tenantId)) });
        if (!project || project.kind !== "project" || !["awarded", "in_progress", "on_hold"].includes(project.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an active project." });
        const employee = await tx.query.employee.findFirst({ where: and(eq(schema.employee.id, ctx.session.employeeId), eq(schema.employee.tenantId, ctx.session.tenantId)) });
        if (!employee || employee.hrFlaggedInactiveAt || employee.employmentStatus !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Your employee status needs administrator review." });
        const existing = await tx.query.projectTeamMember.findFirst({ where: and(eq(schema.projectTeamMember.tenantId, ctx.session.tenantId), eq(schema.projectTeamMember.projectId, input.projectId), eq(schema.projectTeamMember.employeeId, ctx.session.employeeId), eq(schema.projectTeamMember.role, input.tier), isNull(schema.projectTeamMember.endedOn)) });
        if (existing) return { ok: true };
        // Temporary INTERNAL authority after explicit role, lifecycle and project checks.
        // No permission is persisted; the existing assignment writer still owns custody.
        const permissions = new Set(ctx.session.permissions);
        permissions.add("project.team.assign");
        await projectTeamRouter.createCaller({ ...ctx, db: tx as any, session: { ...ctx.session, permissions } }).assign({ projectId: input.projectId, employeeId: ctx.session.employeeId, role: input.tier, source: "manual_entry" });
        await logEvent({ ...ctx, db: tx as any }, { category: "project", action: "onboarding.claimProject", entityType: "project", entityId: input.projectId, details: { employeeId: ctx.session.employeeId, tier: input.tier } });
        return { ok: true };
      });
    }),

  /*
    UNDO A MISCLICK. Not the same feature as `projectTeams.removeBranch`.

    That procedure exists to take somebody ELSE off a job for cause: it demands
    a reason, and it writes a `projectAccessRestriction` row so the person stays
    barred until an admin lifts it. Using it for "I clicked the wrong project"
    would read as an accusation over a typo, and would leave a restriction
    record nobody meant to create.

    This is the narrow case: undoing YOUR OWN claim, made moments ago, before
    anyone has built anything on top of it. So:

      - Only your own row (`employeeId` is always the caller's, never an input)
      - No reason, no restriction row — the row just ends
      - Refuses once it is no longer a simple undo: somebody reports to you on
        this project, or you are already holding a tool through it. Both mean
        this stopped being "a project I clicked by mistake" and became "a job I
        am running" — at that point `removeBranch` is the correct tool, with
        its reason and its record.

    Deliberately no `assertCanAssign` check the way `removeBranch` has one:
    the caller is always ending their OWN row, which needs no permission over
    anybody else's tier — the same reasoning `claimProject` uses to let a
    person write a roster row for themselves without a tenant-wide grant.
  */
  unclaimProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      if (!ctx.session.employeeId) throw new TRPCError({ code: "FORBIDDEN", message: "No employee record to undo a claim for." });
      return ctx.db.transaction(async (tx) => {
        const rows = await activeProjectRows(tx as any, tid);
        const { members, employeeIds } = removalBranch(rows, input.projectId, ctx.session.employeeId!);
        const own = members.find((m) => m.employeeId === ctx.session.employeeId && m.projectId === input.projectId);
        if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "You are not on this job." });
        /* `removalBranch` walks downward from you — if it found anyone besides
           your own row, somebody has already been placed under you here, and
           this is no longer a plain undo. */
        if (employeeIds.length > 1 || members.length > 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You have already added people to this job. Ask an administrator to remove the branch instead.",
          });
        }
        const [held] = await tx
          .select({ id: schema.assignment.id })
          .from(schema.assignment)
          .where(
            and(
              eq(schema.assignment.tenantId, tid),
              eq(schema.assignment.projectId, input.projectId),
              eq(schema.assignment.custodianId, ctx.session.employeeId!),
              isNull(schema.assignment.returnedAt),
            ),
          )
          .limit(1);
        if (held) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You are holding tools through this job. Return or transfer them before undoing this.",
          });
        }
        const today = new Date().toISOString().slice(0, 10);
        await tx
          .update(schema.projectTeamMember)
          .set({ endedOn: today })
          .where(and(eq(schema.projectTeamMember.tenantId, tid), eq(schema.projectTeamMember.id, own.id)));
        await tx
          .update(schema.employeeProjectAssignment)
          .set({ endedOn: today })
          .where(
            and(
              eq(schema.employeeProjectAssignment.tenantId, tid),
              eq(schema.employeeProjectAssignment.projectId, input.projectId),
              eq(schema.employeeProjectAssignment.employeeId, ctx.session.employeeId!),
              isNull(schema.employeeProjectAssignment.endedOn),
            ),
          );
        await tx
          .update(schema.employee)
          .set({ primaryProjectId: null })
          .where(
            and(
              eq(schema.employee.tenantId, tid),
              eq(schema.employee.id, ctx.session.employeeId!),
              eq(schema.employee.primaryProjectId, input.projectId),
            ),
          );
        await logEvent({ ...ctx, db: tx as any }, {
          category: "project",
          action: "onboarding.unclaimProject",
          entityType: "project",
          entityId: input.projectId,
          details: { employeeId: ctx.session.employeeId },
        });
        return { ok: true };
      });
    }),

  administer: requirePermission("user.manage")
    .input(z.object({ userId: z.string().uuid(), action: z.enum(["complete", "reopen"]), reason: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db.query.user.findFirst({ where: and(eq(schema.user.id, input.userId), eq(schema.user.tenantId, ctx.session.tenantId)), columns: { id: true } });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      const row = await ensureRow({ ...ctx, session: { ...ctx.session, userId: target.id } });
      await ctx.db.update(schema.userOnboarding).set({ completedAt: input.action === "complete" ? new Date() : null, dismissedAt: null, claimingClosedAt: row.claimingClosedAt ?? new Date(), currentStep: "projects", updatedAt: new Date() }).where(and(eq(schema.userOnboarding.id, row.id), eq(schema.userOnboarding.tenantId, ctx.session.tenantId)));
      await logEvent(ctx, { category: "auth", action: `onboarding.admin.${input.action}`, entityType: "user", entityId: target.id, details: { reason: input.reason } });
      return { ok: true };
    }),

  /* Move the resume point. Idempotent and unvalidated against order on purpose —
     going back a step is a normal thing to do, and a wizard that refuses to is
     a wizard people abandon. */
  setStep: protectedProcedure
    .input(z.object({ step: z.enum(ONBOARDING_STEPS) }))
    .mutation(async ({ ctx, input }) => {
      const row = await ensureRow(ctx);
      await ctx.db
        .update(schema.userOnboarding)
        .set({ currentStep: input.step, updatedAt: new Date() })
        .where(and(eq(schema.userOnboarding.id, row.id), eq(schema.userOnboarding.tenantId, ctx.session.tenantId)));
      return { ok: true };
    }),

  /*
    Finish, or dismiss.

    One procedure for both because the product question is "should this person be
    sent here again", and the answer is no either way. What they actually filled
    in is readable from the rows the wizard wrote — that is the whole reason no
    progress is stored on this table.
  */
  complete: protectedProcedure
    .input(z.object({ dismissed: z.boolean().default(false), acknowledged: z.boolean().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const row = await ensureRow(ctx);
      if (input?.dismissed) throw new TRPCError({ code: "BAD_REQUEST", message: "Finish your required setup, or sign out and return later." });
      if (!input?.acknowledged) throw new TRPCError({ code: "BAD_REQUEST", message: "Confirm your details on the review step before finishing." });
      /* Only a REAL finish is already-done. Somebody who skipped is closed but
         not finished, and pressing Finish after coming back has to land. */
      if (row.completedAt && !row.dismissedAt) return { ok: true, alreadyDone: true };

      await ctx.db
        .update(schema.userOnboarding)
        .set({
          completedAt: new Date(),
          claimingClosedAt: row.claimingClosedAt ?? new Date(),
          /* Explicitly nulled on a real finish, so somebody who skipped and
             later came back stops being marked as skipped. */
          dismissedAt: input?.dismissed ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.userOnboarding.id, row.id), eq(schema.userOnboarding.tenantId, ctx.session.tenantId)));

      await logEvent(ctx, {
        /* `auth`, not a new category — this is an account-lifecycle event and
           `user.create` / `user.invite` already log there. */
        category: "auth",
        action: input?.dismissed ? "onboarding.dismissed" : "onboarding.completed",
        entityType: "user_onboarding",
        entityId: row.id,
      });
      return { ok: true, alreadyDone: false };
    }),

  /*
    Reopen the wizard for somebody who skipped it.

    Clears `completedAt` so the gate sends them back, and `dismissedAt` so the
    sidebar's notice stops showing the moment they act on it. `currentStep` is
    deliberately LEFT ALONE — they resume where they stopped, which is the whole
    point of storing it, and somebody who skipped on step three has already done
    steps one and two.

    Needs no permission: it reopens the caller's OWN wizard, reads the row by
    session userId, and there is no id in the input that could point at anybody
    else. Same shape as `setStep` and `complete` beside it.
  */
  resume: protectedProcedure.mutation(async ({ ctx }) => {
    const row = await ensureRow(ctx);
    /* A person who genuinely finished has nothing to resume, and reopening it
       from a stale sidebar would drop them into a wizard they already
       completed. */
    if (row.completedAt && !row.dismissedAt) return { ok: true, reopened: false };

    await ctx.db
      .update(schema.userOnboarding)
      .set({ completedAt: null, dismissedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.userOnboarding.id, row.id), eq(schema.userOnboarding.tenantId, ctx.session.tenantId)));

    await logEvent(ctx, {
      category: "auth",
      action: "onboarding.resumed",
      entityType: "user_onboarding",
      entityId: row.id,
    });
    return { ok: true, reopened: true };
  }),

  /*
    Step one's list: THE JOBS THIS PERSON IS ON. Nothing else.

    This used to be every active job in the tenant with a tick box, and the
    tick wrote a `project_claim` — "I say I work here" — which granted nothing
    and which the later steps then had to work around. It produced the defect
    that killed the idea: a person ticked five jobs, and steps two through four
    silently ignored four of them because editing a job needs a roster row.
    The wizard then explained its own bookkeeping to somebody who had ticked a
    box thirty seconds earlier and reasonably thought it meant something.

    The rule now is the simple one: **you are on a job when somebody who runs
    it puts you on it.** That is `project_team_member`, written through
    `projectTeam.assign` under a real permission, and it is the only fact this
    step reports. A person who thinks a job is missing takes that up with
    whoever runs it — which is the same conversation the claim was standing in
    for, minus a table.

    This is read-only, so there is nothing to get wrong: no tick, no write, no
    way for a person to put themselves on a job. `assertCanAssign` refusing a
    superintendent their own tier stops being an awkward edge case, because
    nothing here tries to assign anybody.

    Ended rows are excluded, so a job somebody has come off does not reappear
    at their next sign-in.
  */
  candidateProjects: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    if (!ctx.session.employeeId) return [];

    const rows = await ctx.db
      .select({
        id: schema.project.id,
        name: schema.project.name,
        externalId: schema.project.code,
        status: schema.project.status,
        siteAddress: schema.project.siteAddress,
        teamRole: schema.projectTeamMember.role,
        /* The tenant's own wording for the tier. LEFT joined and coalesced by
           the caller: `projectTeamMember.role` is a name string, and a tenant
           that renamed or removed a tier must not make a job vanish from
           somebody's list over a missing label. */
        teamRoleLabel: schema.teamRole.label,
      })
      .from(schema.projectTeamMember)
      .innerJoin(schema.project, eq(schema.project.id, schema.projectTeamMember.projectId))
      .leftJoin(
        schema.teamRole,
        and(
          eq(schema.teamRole.tenantId, tid),
          eq(schema.teamRole.name, schema.projectTeamMember.role),
        ),
      )
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tid),
          eq(schema.projectTeamMember.employeeId, ctx.session.employeeId),
          isNull(schema.projectTeamMember.endedOn),
          eq(schema.project.tenantId, tid),
        ),
      )
      /* Stable order, same reasoning as every other list in this router: a
         refetch must not reshuffle rows under somebody reading them. */
      .orderBy(schema.project.name);

    return rows.map((r) => ({
      ...r,
      /* Kept so the client need not special-case a shape change. Everything
         here is, by construction, a job the person is on. */
      alreadyOn: true,
      claimed: true,
    }));
  }),

  /*
    Steps two and three read this: the jobs the caller is on, with what's
    missing already computed, so the client never has to guess which fields
    count as gaps.

    Roster rows only, like `candidateProjects`. This once returned the UNION of
    roster rows and `project_claim` ticks, which is what produced the bug that
    retired claims altogether: `fillDetails` and `setLocation` both require a
    roster row, so a claim-only job appeared here, offered its controls, and
    then answered 403 when used. There is now one definition of "your jobs"
    across every step of the wizard, and it is the one the mutations enforce.

    A job with nothing missing is not omitted — the client needs to render it as
    "already complete" rather than have it silently disappear, which would read
    as a bug rather than as good news.
  */
  myClaimedProjects: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    if (!ctx.session.employeeId) return [];

    const rows = await ctx.db
      .select({
        id: schema.project.id,
        name: schema.project.name,
        externalId: schema.project.code,
        description: schema.project.description,
        siteAddress: schema.project.siteAddress,
        startDate: schema.project.startDate,
        endDate: schema.project.endDate,
        latitude: schema.project.latitude,
        longitude: schema.project.longitude,
        geofenceRadiusM: schema.project.geofenceRadiusM,
      })
      .from(schema.projectTeamMember)
      .innerJoin(schema.project, eq(schema.project.id, schema.projectTeamMember.projectId))
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tid),
          eq(schema.projectTeamMember.employeeId, ctx.session.employeeId),
          isNull(schema.projectTeamMember.endedOn),
          eq(schema.project.tenantId, tid),
        ),
      )
      /* Stable order for the same reason `crewStatus` needs one: saving a
         detail or dropping a pin refetches this, and heap order would reshuffle
         the list the person is working down. */
      .orderBy(schema.project.name);

    return rows.map((r) => ({
      ...r,
      missingSiteAddress: !r.siteAddress,
      missingLocation: r.latitude == null || r.longitude == null,
      /* Always true now that this reads the roster. Kept so the client keeps
         one shape and the read-only branch stays reachable if a future step
         ever surfaces a job somebody is not on. */
      onRoster: true,
    }));
  }),

  /*
    Fill in what's missing on a job just claimed — NOT a general edit.

    `project.update` already exists and does this and more, gated on
    `project.manage`, which the primary onboarding user (a foreman, a
    superintendent) does not hold. Reusing it here would mean either widening
    that permission's meaning or bypassing it, and neither is right: this
    procedure exists so a person can CONTRIBUTE what they know about a job they
    are actually on, not so they can administer the job register.

    The scope is therefore double-checked, not just permission-checked: the
    caller must hold a live roster row on this exact project. That is smaller
    than `project.manage` and larger than nothing — a person contributes only
    to jobs they are actually working, never to an arbitrary id they happen to
    guess.

    Deliberately no `status` field — changing a job's status is a decision with
    consequences (`project.update`'s STI-105 completion guard, for one) that
    does not belong in a first-run form.
  */
  fillDetails: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        siteAddress: z.string().max(400).optional(),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      if (!ctx.session.employeeId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No employee record to act as." });
      }

      const [onIt] = await ctx.db
        .select({ id: schema.projectTeamMember.id })
        .from(schema.projectTeamMember)
        .where(
          and(
            eq(schema.projectTeamMember.tenantId, tid),
            eq(schema.projectTeamMember.projectId, input.projectId),
            eq(schema.projectTeamMember.employeeId, ctx.session.employeeId),
            isNull(schema.projectTeamMember.endedOn),
          ),
        )
        .limit(1);
      if (!onIt) throw new TRPCError({ code: "FORBIDDEN", message: "You are not on this job." });

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      /* Fill gaps only — never overwrite what is already recorded. A form
         offered as "what's missing" that silently clobbers a real address
         typed by someone else would be a worse bug than the gap it fixes. */
      const project = await ctx.db.query.project.findFirst({
        where: and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, tid)),
        columns: { siteAddress: true, description: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "No such job" });

      if (input.siteAddress !== undefined && !project.siteAddress) patch.siteAddress = input.siteAddress;
      if (input.description !== undefined && !project.description) patch.description = input.description;
      if (Object.keys(patch).length === 1) return { ok: true, changed: false };

      await ctx.db
        .update(schema.project)
        .set(patch)
        .where(and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, tid)));

      await logEvent(ctx, {
        category: "project",
        action: "onboarding.fillDetails",
        entityType: "project",
        entityId: input.projectId,
        details: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
      });
      return { ok: true, changed: true };
    }),

  /*
    Pin a job on the map, or drag its radius. Same scoping as `fillDetails` and
    for the same reason — this is a person recording what they know about a job
    they are on, not a general edit of the project register.

    Radius alone with no coordinates is refused: a radius describes an area
    AROUND a point, and one with no point is not a smaller version of the
    feature, it is meaningless data nothing can render.

    Unlike `fillDetails`, this OVERWRITES rather than fills gaps — repinning a
    location that turns out to be wrong is the normal use of a map step, not a
    conflict with an earlier answer the way a typed address is.
  */
  setLocation: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
        geofenceRadiusM: z.number().int().min(10).max(20000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      if (!ctx.session.employeeId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No employee record to act as." });
      }
      if (input.geofenceRadiusM != null && (input.latitude == null || input.longitude == null)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A radius needs a pin to draw it around." });
      }

      const [onIt] = await ctx.db
        .select({ id: schema.projectTeamMember.id })
        .from(schema.projectTeamMember)
        .where(
          and(
            eq(schema.projectTeamMember.tenantId, tid),
            eq(schema.projectTeamMember.projectId, input.projectId),
            eq(schema.projectTeamMember.employeeId, ctx.session.employeeId),
            isNull(schema.projectTeamMember.endedOn),
          ),
        )
        .limit(1);
      if (!onIt) throw new TRPCError({ code: "FORBIDDEN", message: "You are not on this job." });

      const project = await ctx.db.query.project.findFirst({
        where: and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, tid)),
        columns: { id: true, name: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "No such job" });

      await ctx.db
        .update(schema.project)
        .set({
          latitude: input.latitude == null ? null : String(input.latitude),
          longitude: input.longitude == null ? null : String(input.longitude),
          geofenceRadiusM: input.geofenceRadiusM,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, tid)));

      await logEvent(ctx, {
        category: "project",
        action: "onboarding.setLocation",
        entityType: "project",
        entityId: input.projectId,
        entityLabel: project.name,
        details: { hasPin: input.latitude != null },
      });
      return { ok: true };
    }),

  /*
    Step four's read: for each job the caller is on, the tiers directly above
    and below their own, per the company's declared ladder, cross-referenced
    with who is actually recorded there.

    THIS DOES NOT ASSIGN ANYTHING. It only assembles what the client needs to
    ask the right questions:
      - a tier with a LIVE roster row: shown filled, with who and whether
        `confirmedAt` is set (so the client can offer the confirm action)
      - a tier with an OPEN deferral: shown deferred, not empty
      - a tier with neither: shown empty, with `canAssign` telling the client
        whether to offer a person picker or only the defer toggle

    `canAssign` is computed from the SAME `assertCanAssign` gate `projectTeam.
    assign` enforces — recomputed here rather than tried-and-caught, so the
    client can decide what to render without firing a mutation to find out.
    This can drift from the real gate if `assertCanAssign`'s logic ever changes
    without this being updated; there is no single source both call, because
    `assertCanAssign` throws and has no boolean-returning twin. Both do call
    `canAssignIntoTier` with the same inputs, so grep for that if you touch
    either.

    A tier with NO reporting edge at all (the ladder has not been drawn that
    far, or this is the top of it) is simply not offered — there is nothing to
    ask about a tier the company has not related to this one.
  */
  crewStatus: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    if (!ctx.session.employeeId) return [];

    const myRows = await ctx.db
      .select({
        projectId: schema.projectTeamMember.projectId,
        projectName: schema.project.name,
        role: schema.projectTeamMember.role,
      })
      .from(schema.projectTeamMember)
      .innerJoin(schema.project, eq(schema.project.id, schema.projectTeamMember.projectId))
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tid),
          eq(schema.projectTeamMember.employeeId, ctx.session.employeeId),
          isNull(schema.projectTeamMember.endedOn),
        ),
      )
      /* Heap order otherwise, the same defect UI-73/UI-74 fixed on the people
         and asset registers. It bites harder here: confirming a crew refetches
         this, and without a stable order the jobs reorder UNDER the person
         mid-task — the row they were about to click moves. Observed in a
         browser doing exactly that. */
      .orderBy(schema.project.name);
    if (myRows.length === 0) return [];

    const allRoles = await ctx.db
      .select({
        id: schema.teamRole.id,
        name: schema.teamRole.name,
        label: schema.teamRole.label,
        reportsToTeamRoleId: schema.teamRole.reportsToTeamRoleId,
        assignableByEveryone: schema.teamRole.assignableByEveryone,
      })
      .from(schema.teamRole)
      .where(eq(schema.teamRole.tenantId, tid));
    const roleById = new Map(allRoles.map((r) => [r.id, r]));
    const roleByName = new Map(allRoles.map((r) => [r.name, r]));

    /*
      "Set by", tenant-wide — see the identical comment in
      `routers/projectTeam.ts`'s `myCrew`, which this must stay in lockstep
      with by hand — both feed `canAssignIntoTier`, and that is the only thing
      keeping the hint and the gate honest with each other.
    */
    const allTierIds = allRoles.map((r) => r.id);
    const assignerRows: { teamRoleId: string; assignerTeamRoleId: string }[] = allTierIds.length
      ? await ctx.db
          .select({
            teamRoleId: schema.teamRoleAssigner.teamRoleId,
            assignerTeamRoleId: schema.teamRoleAssigner.assignerTeamRoleId,
          })
          .from(schema.teamRoleAssigner)
          .where(inArray(schema.teamRoleAssigner.teamRoleId, allTierIds))
      : [];
    const assignerNamesByTargetId = new Map<string, Set<string>>();
    for (const r of assignerRows) {
      const assignerName = roleById.get(r.assignerTeamRoleId)?.name;
      if (!assignerName) continue;
      const set = assignerNamesByTargetId.get(r.teamRoleId) ?? new Set<string>();
      set.add(assignerName);
      assignerNamesByTargetId.set(r.teamRoleId, set);
    }

    const projectIds = [...new Set(myRows.map((r) => r.projectId))];

    const allTeamRows = await ctx.db
      .select({
        id: schema.projectTeamMember.id,
        projectId: schema.projectTeamMember.projectId,
        role: schema.projectTeamMember.role,
        employeeId: schema.projectTeamMember.employeeId,
        employeeName: schema.employee.name,
        confirmedAt: schema.projectTeamMember.confirmedAt,
      })
      .from(schema.projectTeamMember)
      .leftJoin(schema.employee, eq(schema.employee.id, schema.projectTeamMember.employeeId))
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tid),
          inArray(schema.projectTeamMember.projectId, projectIds),
          isNull(schema.projectTeamMember.endedOn),
        ),
      );

    const openDeferrals = await ctx.db
      .select({ projectId: schema.projectRoleDeferral.projectId, teamRole: schema.projectRoleDeferral.teamRole })
      .from(schema.projectRoleDeferral)
      .where(
        and(
          eq(schema.projectRoleDeferral.tenantId, tid),
          inArray(schema.projectRoleDeferral.projectId, projectIds),
          isNull(schema.projectRoleDeferral.resolvedAt),
        ),
      );

    const permissions = ctx.session.permissions;

    return myRows.map((mine) => {
      /* Per row, not above the `.map` — see the identical comment in
         `projectTeam.ts`'s `myCrew` for why: it reads `mine.role`, the
         caller's own tier ON THIS project. */
      const canAssignTier = (targetRole: { name: string; id: string; assignableByEveryone: boolean }): boolean =>
        canAssignIntoTier({
          hasAdminPermission: permissions.has("project.team.assign" as Permission),
          targetIsOpenToEveryone: targetRole.assignableByEveryone,
          callerTierNamesOnThisProject: new Set(myRows.filter(r => r.projectId === mine.projectId).map(r => r.role)),
          targetAssignerTierNames: assignerNamesByTargetId.get(targetRole.id) ?? new Set(),
          /* Path 4, in lockstep with `assertCanAssign` and `myCrew` —
             `allRoles` is this procedure's copy of the tier register. */
          targetAncestorTierNames: new Set(
            tiersAbove(allRoles, targetRole.id)
              .map((id) => roleById.get(id)?.name)
              .filter((n): n is string => !!n),
          ),
        });

      const myTier = roleByName.get(mine.role);
      /*
        ABOVE stays adjacent; BELOW is now the whole subtree (changed
        2026-09-08).

        You report to exactly one tier, so "who is above me" has one answer and
        `adjacentTiers` is right for it. Below was adjacent too, and that made
        the step unusable for the case the client hit: a PM on a job with no
        superintendent could not name the foreman, because foreman is two tiers
        down and simply was not in the list. There is no way to walk it one link
        at a time either — that would mean inventing an intermediate person who
        does not exist so the chain has something to hang off.

        `hops` and `skipsTiers` come with each tier so the client can warn when
        a claim steps over somebody, the same advisory-not-blocking treatment
        `/my-crew` uses. `hops < 1` is dropped: that is the caller's own tier,
        which `tiersAtOrBelow` includes for the claiming screen and which is
        not "your crew" here.
      */
      const above = myTier ? adjacentTiers(allRoles, myTier.id).above : null;
      const belowTiers = myTier
        ? tiersAtOrBelow(allRoles, myTier.id).filter((t) => t.hops >= 1)
        : [];

      const entries: { tierId: string; hops: number; via: string[] }[] = [
        ...(above ? [{ tierId: above, hops: 0, via: [] as string[] }] : []),
        ...belowTiers.map((t) => ({ tierId: t.teamRoleId, hops: t.hops, via: t.viaTeamRoleIds })),
      ];

      const tiers = entries.map((entry) => {
        const role = roleById.get(entry.tierId)!;
        const filled = allTeamRows.filter((r) => r.projectId === mine.projectId && r.role === role.name);
        const deferred = openDeferrals.some((d) => d.projectId === mine.projectId && d.teamRole === role.name);
        const isAbove = entry.tierId === above;
        return {
          teamRoleId: role.id,
          teamRoleName: role.name,
          label: role.label,
          relation: isAbove ? ("above" as const) : ("below" as const),
          /* 0 for the tier above (the distance is not meaningful upward), then
             1 for a direct report and 2+ for a claim that steps over a tier. */
          hops: isAbove ? 0 : entry.hops,
          skipsTiers: isAbove
            ? []
            : entry.via.map((id) => roleById.get(id)?.label).filter((l): l is string => !!l),
          canAssign: canAssignTier(role),
          deferred: deferred && filled.length === 0,
          filled: filled.map((f) => ({
            id: f.id,
            employeeId: f.employeeId,
            employeeName: f.employeeName ?? "Unknown",
            confirmed: !!f.confirmedAt,
          })),
        };
      });

      return {
        projectId: mine.projectId,
        projectName: mine.projectName,
        myTeamRole: mine.role,
        tiers,
      };
    });
  }),

  /*
    Record that a tier on a job is somebody else's to fill.

    The state this makes visible: "no superintendent because nobody got round to
    it" and "no superintendent because the PM names those" look identical in the
    roster, and without the distinction the first nags the foreman forever while
    the second never reaches the PM.

    Deliberately requires no permission beyond being signed in. Saying "this is
    not mine to decide" is not an act on the roster — it writes nothing to it —
    and gating the admission of a limit behind the permission the person is
    admitting they lack would be incoherent.
  */
  defer: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        teamRole: z.string().min(1).max(40),
        deferredToEmployeeId: z.string().uuid().nullable().optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      await assertProjectAccess(ctx.db, ctx.session, input.projectId);

      /* Both ids checked against this tenant. The FKs have no tenant predicate
         and would accept another tenant's project id happily — the WHERE clause
         is the isolation here, as everywhere else. */
      const project = await ctx.db.query.project.findFirst({
        where: and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, tid)),
        columns: { id: true, name: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "No such job" });

      const role = await ctx.db.query.teamRole.findFirst({
        where: and(eq(schema.teamRole.name, input.teamRole), eq(schema.teamRole.tenantId, tid)),
        columns: { name: true, label: true },
      });
      if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "No such team role" });

      if (input.deferredToEmployeeId) {
        const who = await ctx.db.query.employee.findFirst({
          where: and(eq(schema.employee.id, input.deferredToEmployeeId), eq(schema.employee.tenantId, tid)),
          columns: { id: true },
        });
        if (!who) throw new TRPCError({ code: "NOT_FOUND", message: "No such person" });
      }

      /* Already filled? Then there is nothing to defer, and recording one would
         put a permanently unresolvable row on somebody's screen. */
      const [filled] = await ctx.db
        .select({ id: schema.projectTeamMember.id })
        .from(schema.projectTeamMember)
        .where(
          and(
            eq(schema.projectTeamMember.tenantId, tid),
            eq(schema.projectTeamMember.projectId, input.projectId),
            eq(schema.projectTeamMember.role, input.teamRole),
            isNull(schema.projectTeamMember.endedOn),
          ),
        )
        .limit(1);
      if (filled) return { ok: true, alreadyFilled: true };

      /* One open deferral per job and tier — `prd_one_open_uq`. Two foremen on
         one job both deferring the superintendent is ONE outstanding decision,
         so a second is a no-op rather than an error. */
      const [open] = await ctx.db
        .select({ id: schema.projectRoleDeferral.id })
        .from(schema.projectRoleDeferral)
        .where(
          and(
            eq(schema.projectRoleDeferral.tenantId, tid),
            eq(schema.projectRoleDeferral.projectId, input.projectId),
            eq(schema.projectRoleDeferral.teamRole, input.teamRole),
            isNull(schema.projectRoleDeferral.resolvedAt),
          ),
        )
        .limit(1);
      if (open) return { ok: true, alreadyDeferred: true };

      await ctx.db.insert(schema.projectRoleDeferral).values({
        tenantId: tid,
        projectId: input.projectId,
        teamRole: input.teamRole,
        deferredByUserId: ctx.session.userId,
        deferredToEmployeeId: input.deferredToEmployeeId ?? null,
        note: input.note ?? null,
      });

      await logEvent(ctx, {
        category: "project",
        action: "onboarding.defer",
        entityType: "project",
        entityId: input.projectId,
        entityLabel: project.name,
        details: { teamRole: input.teamRole },
      });
      return { ok: true, alreadyFilled: false, alreadyDeferred: false };
    }),

  /*
    Withdraw a deferral — "actually, I'll name them myself".

    DELETES the row rather than closing it, which is a reversal of the rule on
    `projectRoleDeferral`'s schema comment ("Rows are CLOSED, never deleted...
    the audit answer to who was supposed to do this and did it happen needs the
    history"). The client chose deletion on 2026-09-08 when asked directly, and
    the reasoning is defensible: a deferral that was withdrawn before anybody
    acted on it is not a fact about the job, it is a person changing their mind
    inside one sitting. `resolvedAt` is reserved for the meaningful close — the
    tier actually being filled — and using it for a withdrawal as well would
    make "resolved" two different things and the audit answer worse, not
    better. The schema comment has been corrected to say so.

    Only an OPEN deferral can be withdrawn. One already resolved was answered
    by somebody filling the tier, and removing that record would delete
    genuine history.

    Same permission stance as `defer`: none beyond being signed in. Saying
    "this is mine after all" writes nothing to the roster, and the person who
    recorded the limit is the one lifting it.
  */
  undefer: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), teamRole: z.string().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      await assertProjectAccess(ctx.db, ctx.session, input.projectId);

      /* Tenant-scoped even though the delete below carries its own predicate —
         CLAUDE.md non-negotiable 3, and it is what makes the NOT_FOUND honest
         rather than "no rows matched for reasons unknown". */
      const project = await ctx.db.query.project.findFirst({
        where: and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, tid)),
        columns: { id: true, name: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "No such job" });

      const deleted = await ctx.db
        .delete(schema.projectRoleDeferral)
        .where(
          and(
            eq(schema.projectRoleDeferral.tenantId, tid),
            eq(schema.projectRoleDeferral.projectId, input.projectId),
            eq(schema.projectRoleDeferral.teamRole, input.teamRole),
            ...(ctx.session.permissions.has("project.team.assign") ? [] : [eq(schema.projectRoleDeferral.deferredByUserId, ctx.session.userId)]),
            isNull(schema.projectRoleDeferral.resolvedAt),
          ),
        )
        .returning({ id: schema.projectRoleDeferral.id });

      /* Nothing open to withdraw is a no-op, not an error — two people can
         both press this, the same way `defer` treats a second deferral. */
      if (deleted.length === 0) return { ok: true, nothingToWithdraw: true };

      await logEvent(ctx, {
        category: "project",
        action: "onboarding.undefer",
        entityType: "project",
        entityId: input.projectId,
        entityLabel: project.name,
        details: { teamRole: input.teamRole },
      });
      return { ok: true, nothingToWithdraw: false };
    }),

  /*
    The oversight screen: who below the caller has done this, and who hasn't.

    Gated identically to `projectTeam.orgChart` — `project.team.read`, widened
    to everyone by the same `assets.view.all` tier that already sees the whole
    org chart — rather than inventing a second idea of "admin" that would need
    keeping in step with role-perms.ts on its own. This is a plan decision
    (`docs/workings/ONBOARDING_AND_ROLE_HIERARCHY.md` §7.1), taken rather than
    left open: reusing a permission every foreman already holds means the
    screen is reachable by construction and simply renders empty for someone
    with nobody below them, which is the honest answer for a foreman anyway.

    Scoped by `descendantsOf`, NOT `visibleEmployeeIds` — the org chart's
    helper also returns the chain ABOVE the viewer, and a PM's progress screen
    reporting on their own director would be a different, wrong feature.

    Two views over the SAME rows, because the plan asks for both and computing
    each from a second query would let them disagree about who is even in
    scope:
      - byJob: for each project someone below the caller works, whether it has
        geography, how many of its expected tiers are filled, how many of
        those are still unconfirmed, and any open deferral.
      - byPerson: for each person below the caller, whether they have signed in
        and whether they have finished their own wizard.

    A deferral appears on THIS caller's screen only when it names a tier THIS
    caller (or nobody) is meant to fill — see the plan's "deferrals show as
    assigned to the viewer, not somebody else's incomplete work". Concretely:
    a tier whose team-role reports (per the ladder) to a tier the caller
    currently holds on that job, OR whose deferral explicitly named the
    caller's own employeeId.
  */
  progress: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.permissions.has("project.team.read")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "missing permission: project.team.read" });
    }
    const tid = ctx.session.tenantId;
    const tier = viewTierOf(ctx.session);
    const seesAll = tier === "assets.view.all";

    if (!seesAll && !ctx.session.employeeId) {
      return { byJob: [], byPerson: [], scoped: true as const };
    }

    const allRows = await ctx.db
      .select({
        id: schema.projectTeamMember.id,
        projectId: schema.projectTeamMember.projectId,
        employeeId: schema.projectTeamMember.employeeId,
        role: schema.projectTeamMember.role,
        reportsToEmployeeId: schema.projectTeamMember.reportsToEmployeeId,
        confirmedAt: schema.projectTeamMember.confirmedAt,
      })
      .from(schema.projectTeamMember)
      .where(and(eq(schema.projectTeamMember.tenantId, tid), isNull(schema.projectTeamMember.endedOn)));

    const below = seesAll ? null : descendantsOf(allRows, ctx.session.employeeId!);

    /* The rows IN SCOPE: everything, for an admin-tier viewer; otherwise the
       caller's own rows plus every row belonging to someone below them — a
       superintendent's own row has to be in scope too, or a job they alone
       run would vanish from their own progress screen. */
    const scopedRows = seesAll
      ? allRows
      : allRows.filter((r) => r.employeeId === ctx.session.employeeId || below!.has(r.employeeId));
    if (scopedRows.length === 0) {
      return { byJob: [], byPerson: [], scoped: !seesAll };
    }

    const projectIds = [...new Set(scopedRows.map((r) => r.projectId))];
    const employeeIds = [...new Set(scopedRows.map((r) => r.employeeId))];

    const projects = await ctx.db
      .select({
        id: schema.project.id,
        name: schema.project.name,
        externalId: schema.project.code,
        latitude: schema.project.latitude,
        longitude: schema.project.longitude,
      })
      .from(schema.project)
      .where(and(eq(schema.project.tenantId, tid), inArray(schema.project.id, projectIds)));
    const projectById = new Map(projects.map((p) => [p.id, p]));

    const employees = await ctx.db
      .select({
        id: schema.employee.id,
        name: schema.employee.name,
        userId: schema.user.id,
        lastSignInAt: schema.user.lastSignInAt,
        onboardingKind: schema.role.onboardingKind,
      })
      .from(schema.employee)
      .leftJoin(schema.user, eq(schema.user.employeeId, schema.employee.id))
      .leftJoin(schema.role, eq(schema.role.id, schema.employee.roleId))
      .where(and(eq(schema.employee.tenantId, tid), inArray(schema.employee.id, employeeIds)));
    const employeeById = new Map(employees.map((e) => [e.id, e]));

    const onboardingRows = await ctx.db
      .select({ userId: schema.userOnboarding.userId, completedAt: schema.userOnboarding.completedAt })
      .from(schema.userOnboarding)
      .where(eq(schema.userOnboarding.tenantId, tid));
    const onboardingByUserId = new Map(onboardingRows.map((r) => [r.userId, r]));

    const teamRoles = await ctx.db
      .select({
        id: schema.teamRole.id,
        name: schema.teamRole.name,
        label: schema.teamRole.label,
        reportsToTeamRoleId: schema.teamRole.reportsToTeamRoleId,
      })
      .from(schema.teamRole)
      .where(eq(schema.teamRole.tenantId, tid));
    const roleByName = new Map(teamRoles.map((r) => [r.name, r]));

    const openDeferrals = await ctx.db
      .select({
        id: schema.projectRoleDeferral.id,
        projectId: schema.projectRoleDeferral.projectId,
        teamRole: schema.projectRoleDeferral.teamRole,
        deferredToEmployeeId: schema.projectRoleDeferral.deferredToEmployeeId,
      })
      .from(schema.projectRoleDeferral)
      .where(
        and(
          eq(schema.projectRoleDeferral.tenantId, tid),
          inArray(schema.projectRoleDeferral.projectId, projectIds),
          isNull(schema.projectRoleDeferral.resolvedAt),
        ),
      );

    /* A deferral belongs on THIS caller's screen when the tier it names
       reports (per the ladder) to a tier the caller holds on that same job, or
       when it was explicitly aimed at the caller. Not "every open deferral on
       a job I can see" — that would put a foreman's deferred PM slot on every
       foreman's screen on that job, when only the actual PM's boss should see it. */
    const myRolesByProject = new Map<string, Set<string>>();
    for (const r of scopedRows) {
      if (r.employeeId !== ctx.session.employeeId) continue;
      const set = myRolesByProject.get(r.projectId) ?? new Set<string>();
      set.add(r.role);
      myRolesByProject.set(r.projectId, set);
    }
    const isMineToSee = (d: (typeof openDeferrals)[number]): boolean => {
      if (seesAll) return true;
      if (d.deferredToEmployeeId === ctx.session.employeeId) return true;
      const deferredRole = roleByName.get(d.teamRole);
      if (!deferredRole?.reportsToTeamRoleId) return false;
      const parentRole = teamRoles.find((r) => r.id === deferredRole.reportsToTeamRoleId);
      const mine = myRolesByProject.get(d.projectId);
      return !!parentRole && !!mine?.has(parentRole.name);
    };
    const myDeferrals = openDeferrals.filter(isMineToSee);

    const byJob = projectIds.map((pid) => {
      const proj = projectById.get(pid);
      const rowsHere = scopedRows.filter((r) => r.projectId === pid);
      const confirmed = rowsHere.filter((r) => !!r.confirmedAt).length;
      const deferralsHere = myDeferrals.filter((d) => d.projectId === pid);
      return {
        projectId: pid,
        projectName: proj?.name ?? "Unknown job",
        projectExternalId: proj?.externalId ?? null,
        hasLocation: !!proj?.latitude && !!proj?.longitude,
        rosterCount: rowsHere.length,
        confirmedCount: confirmed,
        unconfirmedCount: rowsHere.length - confirmed,
        openDeferrals: deferralsHere.map((d) => ({
          teamRole: d.teamRole,
          label: roleByName.get(d.teamRole)?.label ?? d.teamRole,
        })),
      };
    });
    /* Sorted here rather than in SQL: `projectIds` is derived from the scoped
       roster rows in memory, so there is no query to hang an ORDER BY on. Same
       reason as the other two reads in this router — a progress screen that
       reorders itself on refetch is one somebody loses their place in. */
    byJob.sort((a, b) => a.projectName.localeCompare(b.projectName));

    const byPerson = employeeIds
      .filter((id) => id !== ctx.session.employeeId || seesAll)
      .map((id) => {
        const emp = employeeById.get(id);
        const onboarding = emp?.userId ? onboardingByUserId.get(emp.userId) : undefined;
        return {
          employeeId: id,
          name: emp?.name ?? "Unknown",
          hasAccount: !!emp?.userId,
          everSignedIn: !!emp?.lastSignInAt,
          onboardingComplete: emp?.onboardingKind === "none" || !!onboarding?.completedAt,
        };
      });
    byPerson.sort((a, b) => a.name.localeCompare(b.name));

    return { byJob, byPerson, scoped: !seesAll };
  }),
});
