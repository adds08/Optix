import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { adjacentTiers } from "@stinventory/domain";
import type { Permission } from "@stinventory/types";
import { protectedProcedure, router } from "../trpc.js";
import { logEvent } from "../audit.js";
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

  So this router owns only three things:
    - the per-user state row (where am I up to, am I done)
    - the deferral record (I am deliberately leaving this tier to my boss)
    - the read that assembles a person's wizard from tables owned elsewhere
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
    `useEffect`. Two accounts never get prompted:

    - Somebody with no employee record. Roughly seven seeded accounts have a null
      `employeeId` — owner@, finance@, office@ and the rest — and every scoped
      query in this codebase already carries a second branch for them (see
      scope.ts). The wizard is built entirely on roster rows, which those
      accounts cannot hold, so prompting them opens a wizard they cannot
      complete. Same reasoning as `projectTeam.orgChart` returning nothing rather
      than everything for them.
    - Somebody still owing a password change. That redirect already owns the
      first page load, and two competing redirects is a loop.
  */
  state: protectedProcedure.query(async ({ ctx }) => {
    const row = await ensureRow(ctx);
    const hasEmployee = !!ctx.session.employeeId;
    return {
      currentStep: row.currentStep as OnboardingStep,
      completedAt: row.completedAt,
      startedAt: row.startedAt,
      /* The shell reads only this. Keeping the reasons server-side means a new
         exemption is one edit here, not one here and one in the client. */
      shouldPrompt: !row.completedAt && hasEmployee,
      hasEmployeeRecord: hasEmployee,
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
      if (row.completedAt) return { ok: true, alreadyDone: true };

      await ctx.db
        .update(schema.userOnboarding)
        .set({ completedAt: new Date(), updatedAt: new Date() })
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
    The jobs this person can claim in step one.

    THE TRAP THIS SOLVES, worth the length. The obvious implementation is to
    reuse `visibleProjectScope`, which is what every other project list uses. It
    does not work here, and the failure is silent: that helper derives visibility
    FROM roster rows and postings, and a newly invited foreman has neither —
    those are what the wizard exists to create. So the honest reuse produces an
    empty list for exactly the person being onboarded, the wizard dead-ends, and
    the only accounts that see anything are the all-projects tier who least need
    it.

    So the candidate list is deliberately WIDER than the person's normal
    visibility, and that is a decision rather than an oversight:

      - It is a list of NAMES AND CODES of active jobs, nothing more. No tools,
        no people, no costs. The equivalent of a job board on a site office wall.
      - Claiming one does not grant access to it. Access still comes from the
        roster row, written by `projectTeam.assign` under the caller's own
        permissions, which may well refuse them.
      - It is offered only while onboarding is unfinished.

    An account that already has the all-projects tier gets the same list by a
    different route, so the widening changes nothing for them.

    Completed and cancelled jobs are excluded: nobody is onboarded onto a job
    that finished, and offering them is how a wrong claim gets made.
  */
  candidateProjects: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;

    const rows = await ctx.db
      .select({
        id: schema.project.id,
        name: schema.project.name,
        externalId: schema.project.externalId,
        status: schema.project.status,
        siteAddress: schema.project.siteAddress,
      })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.tenantId, tid),
          inArray(schema.project.status, ["awarded", "in_progress", "on_hold", "not_awarded"]),
        ),
      )
      .orderBy(desc(schema.project.startDate));

    /* Which of them this person is already on, so the step can show them ticked
       rather than inviting a duplicate claim `ptm_one_active_uq` would refuse. */
    const mine = ctx.session.employeeId
      ? await ctx.db
          .select({ projectId: schema.projectTeamMember.projectId, role: schema.projectTeamMember.role })
          .from(schema.projectTeamMember)
          .where(
            and(
              eq(schema.projectTeamMember.tenantId, tid),
              eq(schema.projectTeamMember.employeeId, ctx.session.employeeId),
              isNull(schema.projectTeamMember.endedOn),
            ),
          )
      : [];

    const onIt = new Map(mine.map((m) => [m.projectId, m.role]));
    return rows.map((r) => ({ ...r, alreadyOn: onIt.get(r.id) ?? null }));
  }),

  /*
    Steps two and three read this: the jobs the caller is ACTUALLY on, with
    what's missing already computed, so the client never has to guess which
    fields count as gaps.

    Deliberately narrower than `candidateProjects`. Step one is wide on purpose
    — a person with no roster row yet still needs to see jobs to claim. Steps
    two and three are the opposite: filling in a job's address or dropping a
    pin is an act ON that job, so it is scoped to jobs the person actually holds
    a live roster row on, the same set `myTeamRole` reads.

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
        externalId: schema.project.externalId,
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
        ),
      )
      /* A person can hold more than one team row on the same job (STI-1xxx: a PM
         acting as area in-charge on the one job in their patch is two rows, not
         a contradiction) — dedupe rather than show the same job twice. */
      .groupBy(
        schema.project.id,
        schema.project.name,
        schema.project.externalId,
        schema.project.description,
        schema.project.siteAddress,
        schema.project.startDate,
        schema.project.endDate,
        schema.project.latitude,
        schema.project.longitude,
        schema.project.geofenceRadiusM,
      );

    return rows.map((r) => ({
      ...r,
      missingSiteAddress: !r.siteAddress,
      missingLocation: r.latitude == null || r.longitude == null,
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
      );
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
      const { above, below } = myTier
        ? adjacentTiers(allRoles, myTier.id)
        : { above: null, below: [] as string[] };

      const tierIds = [...(above ? [above] : []), ...below];
      const tiers = tierIds.map((tierId) => {
        const role = roleById.get(tierId)!;
        const filled = allTeamRows.filter((r) => r.projectId === mine.projectId && r.role === role.name);
        const deferred = openDeferrals.some((d) => d.projectId === mine.projectId && d.teamRole === role.name);
        return {
          teamRoleId: role.id,
          teamRoleName: role.name,
          label: role.label,
          relation: tierId === above ? ("above" as const) : ("below" as const),
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
});
