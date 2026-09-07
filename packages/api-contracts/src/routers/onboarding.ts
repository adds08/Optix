import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { adjacentTiers, descendantsOf, tiersAtOrBelow } from "@stinventory/domain";
import type { Permission } from "@stinventory/types";
import { protectedProcedure, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { viewTierOf } from "../scope.js";
import { BUILT_IN_PERM } from "./projectTeam.js";

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
  exception to that. What a foreman gets instead is the confirmation step: their
  superintendent already recorded them, and they see it.

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
export const ONBOARDING_STEPS = ["projects", "details", "location", "crew", "invite"] as const;
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

export const onboardingRouter = router({
  /*
    Where this person is up to, and whether they should be sent to the wizard.

    `shouldPrompt` is computed HERE rather than in the shell, so the redirect
    rule lives beside the data it reads instead of being re-derived in a
    `useEffect`. Three accounts never get prompted:

    - Somebody with no employee record. Roughly seven seeded accounts have a null
      `employeeId` — owner@, finance@, office@ and the rest — and every scoped
      query in this codebase already carries a second branch for them (see
      scope.ts). The wizard is built entirely on roster rows, which those
      accounts cannot hold, so prompting them opens a wizard they cannot
      complete. Same reasoning as `projectTeam.orgChart` returning nothing rather
      than everything for them.
    - Somebody still owing a password change. That redirect already owns the
      first page load, and two competing redirects is a loop.
    - **Somebody on no jobs.** An employee record is not enough: an equipment
      admin, a mechanic and the yard desk all have one and sit on zero crew
      rows, because they serve every job rather than working on any. This
      wizard's first question is "which of your jobs is this about", so for
      them every step is empty and the finish button records nothing. They were
      being prompted, and answering honestly took five clicks to reach a screen
      that said they had claimed nothing.

      Keyed on the ROSTER, not on the role name. A role list would be wrong the
      day a tenant adds a role — and `nav-config`'s role-name branch is already
      the last one in the product for exactly that reason. A mechanic who genuinely
      is put on a job gets the wizard; an office-bound PM does not.
  */
  state: protectedProcedure.query(async ({ ctx }) => {
    const row = await ensureRow(ctx);
    const hasEmployee = !!ctx.session.employeeId;

    /* One row is enough — this asks "is this person on any job at all", so
       LIMIT 1 rather than a count of jobs nobody reads. */
    const [anyJob] = hasEmployee
      ? await ctx.db
          .select({ id: schema.projectTeamMember.id })
          .from(schema.projectTeamMember)
          .where(
            and(
              eq(schema.projectTeamMember.tenantId, ctx.session.tenantId),
              eq(schema.projectTeamMember.employeeId, ctx.session.employeeId!),
              isNull(schema.projectTeamMember.endedOn),
            ),
          )
          .limit(1)
      : [];
    const onAnyJob = !!anyJob;

    /*
      WHICH wizard this person's role asks for, straight off the role register.

      `none` means the role is never sent to onboarding at all — a technical
      administrator or a finance account is not describing their own crew, and
      the client asked for exactly this: "there might be some roles, especially
      technical admins, super admins, that might not even require this
      on-boarding screen".

      Read from the ROLE ROW, never from a list of role names here. A name list
      is wrong the day a tenant adds a role, which is the same reasoning that
      keyed the rest of this procedure on the roster.

      Defaults to `equipment` when a user somehow has no role row: the wizard is
      harmless and skippable, whereas silently skipping setup for somebody who
      needed it is not.
    */
    const [roleRow] = await ctx.db
      .select({ onboardingKind: schema.role.onboardingKind })
      .from(schema.userRole)
      .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
      .where(eq(schema.userRole.userId, ctx.session.userId))
      .limit(1);
    const onboardingKind = roleRow?.onboardingKind ?? "equipment";
    const wantsWizard = onboardingKind !== "none";

    /* Finished for real: closed, and not closed by pressing Skip. */
    const hasFinished = !!row.completedAt && !row.dismissedAt;
    return {
      currentStep: row.currentStep as OnboardingStep,
      completedAt: row.completedAt,
      dismissedAt: row.dismissedAt,
      startedAt: row.startedAt,
      /* The shell reads only this. Keeping the reasons server-side means a new
         exemption is one edit here, not one here and one in the client. */
      shouldPrompt: !row.completedAt && wantsWizard && hasEmployee && onAnyJob,
      /*
        Skipped and not since finished — what the sidebar's "setup unfinished"
        notice reads. Deliberately NOT the same question as `shouldPrompt`: this
        one never redirects anybody, it only offers a way back, which is the
        whole difference between a nudge and a gate.

        Gated on the same conditions as `shouldPrompt`, and for the same
        reason: an account that would never be sent to the wizard must not be
        told its setup is unfinished. That includes somebody on no jobs — the
        sidebar would otherwise nag a mechanic forever about a wizard that has
        nothing to ask them.
      */
      needsSetup: !!row.dismissedAt && !hasFinished && wantsWizard && hasEmployee && onAnyJob,
      hasEmployeeRecord: hasEmployee,
      /* So the wizard can render the right questions, and so a screen can say
         "your role does not need this" rather than showing empty steps. */
      onboardingKind,
      /* So the wizard itself can say why it is empty if somebody reaches
         `/welcome` by typing the URL, rather than rendering five blank steps. */
      onAnyJob,
      steps: ONBOARDING_STEPS,
    };
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
    .input(z.object({ dismissed: z.boolean().default(false) }).optional())
    .mutation(async ({ ctx, input }) => {
      const row = await ensureRow(ctx);
      /* Only a REAL finish is already-done. Somebody who skipped is closed but
         not finished, and pressing Finish after coming back has to land. */
      if (row.completedAt && !row.dismissedAt) return { ok: true, alreadyDone: true };

      await ctx.db
        .update(schema.userOnboarding)
        .set({
          completedAt: new Date(),
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
    `assertCanAssign` throws and has no boolean-returning twin. Grep for
    `BUILT_IN_PERM` alongside this comment if you touch either.

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
      })
      .from(schema.teamRole)
      .where(eq(schema.teamRole.tenantId, tid));
    const roleById = new Map(allRoles.map((r) => [r.id, r]));
    const roleByName = new Map(allRoles.map((r) => [r.name, r]));

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
    const canAssignTier = (roleName: string): boolean => {
      const perm: Permission = BUILT_IN_PERM[roleName] ?? "project.team.assign";
      return permissions.has(perm);
    };

    return myRows.map((mine) => {
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
          canAssign: canAssignTier(role.name),
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
      })
      .from(schema.employee)
      .leftJoin(schema.user, eq(schema.user.employeeId, schema.employee.id))
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
          onboardingComplete: !!onboarding?.completedAt,
        };
      });
    byPerson.sort((a, b) => a.name.localeCompare(b.name));

    return { byJob, byPerson, scoped: !seesAll };
  }),
});
