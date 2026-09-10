import { assertProjectAccess, assertBranchTarget, activeProjectRows, restrictedProjects } from "../project-access.js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { moveEmployeeToProject } from "../project-assign.js";
import { visibleProjectScope, viewTierOf } from "../scope.js";
import {
  buildOrgForest,
  canAssignIntoTier,
  findCycle,
  findTierCycle,
  tiersAtOrBelow,
  tiersAbove,
  visibleEmployeeIds,
} from "@stinventory/domain";
import { TEAM_SOURCES, DEFAULT_TEAM_SOURCE, type Permission } from "@stinventory/types";

/*
  The project team roster — who runs a job and who is working it.

  This is the first cut of the people/roles/teams module, living inside the
  project module until the dedicated app exists (the extensibility seam the
  roadmap calls for). It answers "who is on this project" as one table,
  project_team_member, so the Tools by Jobsite hub, the people screen and the
  scope filter all read the same answer.

  Assignment hierarchy, enforced here on every write:

    Assigning a PM            → owners, equipment admins, the equipment dept
    Assigning a superintendent → the above, plus PMs
    Assigning a foreman        → the above, plus PMs and superintendents

  The tier is the TARGET role, not the actor's rank in general: an equipment
  admin assigning a PM is a different act from a superintendent assigning a
  foreman, and each carries its own permission. The matrix below is the only
  place the mapping lives; the seed grants the same strings.

  A foreman linked to a project is a foreman WORKING that project — their
  posting, primary project, tools and truck all move with them (the same
  rules employee.assignToProject has always enforced, shared via
  moveEmployeeToProject so the two paths cannot drift).
*/

/*
  STI-307 — which category each role comparison in this file belongs to.

  These are branches on DOMAIN DATA, not on authorisation, and they stay. A
  foreman is a kind of person: linking one to a project physically moves their
  tools, and linking a PM does not. That is a fact about how Urban works, not a
  statement about what the CALLER may do.

  Authorisation in this file is entirely permission-based and always was —
  `assertCanAssign` is the only gate. Nothing here reads `session.roleName`.
*/

/*
  Team roles were the literal array `["pm", "superintendent", "foreman"]` until
  2026-09-03. That stopped being tenable the moment the client described a
  chain — director, area in-charge, PM & general superintendent, superintendent,
  foreman — with more tiers than the product has, and said plainly that "the
  roles and tiers are not fully set, this can expand later". A literal array
  needs a code change and a deploy for every tenant's variation on that chain;
  `tbl_entity_team_role` (packages/db/src/schema/reference.ts) is the register
  an administrator edits instead.

  Every tier is gated identically as of 2026-09-10: `project.team.assign`
  tenant-wide, or the tier's own `team_role_assigner` rows. The three dedicated
  `project.assign.*` permissions were deleted — they named tiers the product
  happened to ship with, in a register a tenant edits, so a tenant's own tier
  could never have one and the ladder they claimed to enforce was already
  incomplete. See the comment on `project.team.assign` in
  packages/types.

  NOT the login/permission role (`tbl_entity_role`, `/admin/roles`) and not a
  lookup between them. Confirmed deliberately separate after nearly conflating
  the two on 2026-09-03: the seed carries one person whose LOGIN role is
  `engineer` and whose TEAM role is `pm` — the two vocabularies diverge for the
  same person on purpose. A lookup would be the two-lists-that-drift pattern
  `role`'s own header comment exists to end.
*/
/* `BUILT_IN_PERM` lived here until 2026-09-10: a map from three tier NAMES to
   three dedicated permissions. It went because tiers are tenant data and those
   three names were only ever the tiers the product happened to ship with —
   Urban's `area_in_charge` and `general_superintendent` never had one and fell
   through to `project.team.assign` regardless, so the ladder it claimed to
   enforce was already incomplete in production.

   `project.team.assign` is now the only tenant-wide grant. Everything
   finer-grained — a PM may place a superintendent but not another PM — is
   `team_role_assigner` data, which says it for EVERY tier and needs no deploy
   to add one. `assertCanAssign` below stays the one place that GATES a write. */

type TeamRoleRow = {
  id: string;
  name: string;
  label: string;
  canHoldCustody: boolean;
  assignableByEveryone: boolean;
};

export async function requireTeamRole(db: any, tid: string, name: string): Promise<TeamRoleRow> {
  const [row] = await db
    .select({
      id: schema.teamRole.id,
      name: schema.teamRole.name,
      label: schema.teamRole.label,
      canHoldCustody: schema.teamRole.canHoldCustody,
      assignableByEveryone: schema.teamRole.assignableByEveryone,
    })
    .from(schema.teamRole)
    .where(and(eq(schema.teamRole.tenantId, tid), eq(schema.teamRole.name, name)));
  if (!row) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `"${name}" is not a team role in this tenant.` });
  }
  return row;
}

/*
  Team-role tier NAMES the caller holds on ONE project, via an active
  `project_team_member` row — never a login role, never a tier held on some
  OTHER job. Empty for an account with no employee record (an office/admin
  account), which is fine: such an account reaches every write through path 1
  below, never path 3.
*/
async function callerTierNamesOnProject(
  db: any,
  tid: string,
  projectId: string,
  employeeId: string | null,
): Promise<ReadonlySet<string>> {
  if (!employeeId) return new Set();
  const rows: { role: string }[] = await db
    .select({ role: schema.projectTeamMember.role })
    .from(schema.projectTeamMember)
    .where(
      and(
        eq(schema.projectTeamMember.tenantId, tid),
        eq(schema.projectTeamMember.projectId, projectId),
        eq(schema.projectTeamMember.employeeId, employeeId),
        isNull(schema.projectTeamMember.endedOn),
      ),
    );
  return new Set(rows.map((r) => r.role));
}

/*
  The target tier's registered "Set by" list, as tier NAMES rather than ids —
  `canAssignIntoTier` compares against `callerTierNamesOnProject`'s names, and
  a tier can be renamed (its `label`) without this join ever needing to change,
  because both sides key on the stable `name`/id, not the label.
*/
async function assignerTierNamesFor(db: any, teamRoleId: string): Promise<ReadonlySet<string>> {
  const rows: { name: string }[] = await db
    .select({ name: schema.teamRole.name })
    .from(schema.teamRoleAssigner)
    .innerJoin(schema.teamRole, eq(schema.teamRole.id, schema.teamRoleAssigner.assignerTeamRoleId))
    .where(eq(schema.teamRoleAssigner.teamRoleId, teamRoleId));
  return new Set(rows.map((r) => r.name));
}

/*
  The tiers ABOVE a target on the ladder, as names — path 4 of
  `canAssignIntoTier`, added 2026-09-10 so authority flows down the chain and a
  Director can place a Foreman on a job she runs.

  Loads the tenant's whole tier register in one query and hands it to
  `tiersAbove` (packages/domain/src/org-chart.ts), rather than walking the
  parent edge one SELECT at a time: the register is a handful of rows, the walk
  is already written and cycle-safe, and a second walker is exactly how two
  answers to "who is above whom" start disagreeing.

  Returns names, matching `assignerTierNamesFor` above, because
  `canAssignIntoTier` compares against the caller's tier NAMES.

  ONE helper for every call site — the real gate in `assertCanAssign`, the
  `assignable` list on `projectTeams.workspace`, and the `canAssign` hints. The
  gate and the hint are computed separately and MUST agree; a hint that offers a
  tier the write then refuses is worse than not offering it.
*/
export async function ancestorTierNamesFor(
  db: any,
  tenantId: string,
  teamRoleId: string,
): Promise<ReadonlySet<string>> {
  const rows: { id: string; name: string; reportsToTeamRoleId: string | null }[] = await db
    .select({
      id: schema.teamRole.id,
      name: schema.teamRole.name,
      reportsToTeamRoleId: schema.teamRole.reportsToTeamRoleId,
    })
    .from(schema.teamRole)
    .where(eq(schema.teamRole.tenantId, tenantId));
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  return new Set(
    tiersAbove(rows, teamRoleId)
      .map((id) => nameOf.get(id))
      .filter((n): n is string => !!n),
  );
}

/*
  Now async and PROJECT-AWARE — was a pure permission check before STI-503.
  Same refusal messages for the built-in three, because the commonest way to
  be refused (no employee record, or on no jobs, holding neither the
  dedicated permission nor a registered "Set by" tier) is unchanged by this;
  what is NEW is that a tenant's own tier, previously admin-only in practice,
  can now say yes via `canAssignIntoTier`'s path 3.

  `db` and `session` are threaded separately rather than a whole `ctx`, so this
  stays callable from a plain object in a test without constructing a tRPC
  context.
*/
export async function assertCanAssign(
  db: any,
  session: import("@stinventory/auth").ResolvedSession,
  tid: string,
  projectId: string,
  role: TeamRoleRow,
): Promise<void> {
  await assertProjectAccess(db, { ...session, tenantId: tid } as any, projectId);
  const hasAdminPermission = session.permissions.has("project.team.assign");

  /* Short-circuit before either query: the admin path is the common case for
     the built-in three (an office/admin account holding no employee record at
     all), and it would be wasteful — and pointless, since `canAssignIntoTier`
     already returns true on this flag alone — to look up a project roster and
     a Set-by list nobody is about to read. */
  /* `role.id` is empty only for the synthetic fallback `confirm` builds when
     the tier named on an old roster row has since been deleted — cascade
     delete would have removed any `team_role_assigner` rows for it anyway, so
     skipping the query and using an empty set is the same answer, not a
     shortcut. */
  const allowed =
    hasAdminPermission ||
    canAssignIntoTier({
      hasAdminPermission: false,
      targetIsOpenToEveryone: role.assignableByEveryone,
      callerTierNamesOnThisProject: await callerTierNamesOnProject(db, tid, projectId, session.employeeId),
      targetAssignerTierNames: role.id ? await assignerTierNamesFor(db, role.id) : new Set<string>(),
      /* Path 4 — the tiers above the target on the ladder. Same `role.id`
         guard as the line above, for the same reason: a deleted tier has no
         edges left to walk. */
      targetAncestorTierNames: role.id ? await ancestorTierNamesFor(db, tid, role.id) : new Set<string>(),
    });

  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        role.name === "pm"
          ? "Only admins and the equipment department can put a PM on a project."
          : role.name === "superintendent"
            ? "PMs and admins assign superintendents to projects."
            : role.name === "foreman"
              ? "You need to be a PM, superintendent, admin or the equipment department to assign a foreman."
              : `You do not have permission to assign the "${role.label}" role. Ask an admin, or ask whoever holds a tier this one is set to be filled by.`,
    });
  }
}

export const projectTeamRouter = router({
  /* The whole current roster, keyed by project — the Tools by Jobsite hub reads
     this once instead of one query per card. Scoped the same way project.list
     is: a foreman (who holds project.team.read) must never be able to read the
     roster of jobs they do not work. */
  all: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.permissions.has("project.team.read")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "missing permission: project.team.read" });
    }
    const tid = ctx.session.tenantId;
    const scope = await visibleProjectScope(ctx.db, ctx.session);

    const rows = await ctx.db
      .select({
        projectId: schema.projectTeamMember.projectId,
        memberId: schema.projectTeamMember.id,
        employeeId: schema.projectTeamMember.employeeId,
        role: schema.projectTeamMember.role,
        reportsToEmployeeId: schema.projectTeamMember.reportsToEmployeeId,
        startedOn: schema.projectTeamMember.startedOn,
        note: schema.projectTeamMember.note,
        employeeName: schema.employee.name,
        employeeExternalId: schema.employee.code,
        employeeRole: schema.employee.role,
        employeeStatus: schema.employee.employmentStatus,
        assignedByName: schema.user.firstName,
      })
      .from(schema.projectTeamMember)
      .leftJoin(schema.employee, eq(schema.projectTeamMember.employeeId, schema.employee.id))
      .leftJoin(schema.user, eq(schema.projectTeamMember.assignedByUserId, schema.user.id))
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tid),
          isNull(schema.projectTeamMember.endedOn),
          ...(scope.restrict ? [inArray(schema.projectTeamMember.projectId, [...scope.ids])] : []),
        ),
      );

    const byProject = new Map<string, any[]>();
    for (const r of rows) {
      const list = byProject.get(r.projectId) ?? [];
      list.push({
        id: r.memberId,
        employeeId: r.employeeId,
        name: r.employeeName ?? "Unknown",
        externalId: r.employeeExternalId,
        role: r.role,
        reportsToEmployeeId: r.reportsToEmployeeId,
        employeeRole: r.employeeRole,
        employeeStatus: r.employeeStatus,
        startedOn: r.startedOn,
        note: r.note,
        assignedByName: r.assignedByName ?? null,
      });
      byProject.set(r.projectId, list);
    }
    return [...byProject.entries()].map(([projectId, members]) => ({
      projectId,
      members: members.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }),

  /*
    The organisation chart, scoped.

    A SEPARATE procedure from `all` rather than a flag on it, because the two
    answer different questions and are gated differently. `all` answers "who is
    on the jobs I can see" and is scoped by PROJECT. This answers "who is in my
    reporting line" and is scoped by PERSON: a superintendent sees the PM above
    them and their own crew below, and NOT the next superintendent's crew, even
    though both supers are on the same job and `all` shows both.

    The filtering is here and not in the browser on purpose. Sending every row
    and hiding some with CSS is not an access rule — it ships the whole
    company's reporting structure to anybody who opens devtools.

    Returns FLAT rows, not a tree. The tree is built by `buildOrgForest` in
    packages/domain, which the client calls on the rows it receives — one tested
    implementation of the shape rather than one here and a second in the page.
  */
  orgChart: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.permissions.has("project.team.read")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "missing permission: project.team.read" });
    }
    const tid = ctx.session.tenantId;

    const projectScope = await visibleProjectScope(ctx.db, ctx.session);
    const rows = await ctx.db
      .select({
        id: schema.projectTeamMember.id,
        projectId: schema.projectTeamMember.projectId,
        projectName: schema.project.name,
        projectExternalId: schema.project.code,
        projectStatus: schema.project.status,
        employeeId: schema.projectTeamMember.employeeId,
        role: schema.projectTeamMember.role,
        reportsToEmployeeId: schema.projectTeamMember.reportsToEmployeeId,
        startedOn: schema.projectTeamMember.startedOn,
        note: schema.projectTeamMember.note,
        name: schema.employee.name,
        externalId: schema.employee.code,
        employeeRole: schema.employee.role,
        employeeStatus: schema.employee.employmentStatus,
      })
      .from(schema.projectTeamMember)
      .leftJoin(schema.employee, eq(schema.projectTeamMember.employeeId, schema.employee.id))
      .leftJoin(schema.project, eq(schema.projectTeamMember.projectId, schema.project.id))
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tid),
          isNull(schema.projectTeamMember.endedOn),
          projectScope.restrict ? inArray(schema.projectTeamMember.projectId, [...projectScope.ids]) : undefined,
        ),
      );

    /*
      Who may see the whole chart. Reuses the existing view ladder rather than
      inventing a second idea of "admin" — `assets.view.all` is already what the
      owner, the equipment department and HR hold, and a second test here would
      be one more thing to keep in step with role-perms.ts.
    */
    const tier = viewTierOf(ctx.session);
    const seesAll = tier === "assets.view.all";

    /* An account with no employee record is not a person: it cannot be on a
       team and cannot have a reporting line, so the honest answer is nothing
       rather than everything. Same reasoning as scope.ts assetVisibility. */
    if (!seesAll && !ctx.session.employeeId) {
      return { members: [], referenced: [], viewerEmployeeId: null, scoped: true as const };
    }

    const visible = seesAll
      ? null
      : visibleEmployeeIds(
          rows.map((r) => ({
            id: r.id,
            projectId: r.projectId,
            employeeId: r.employeeId,
            role: r.role,
            reportsToEmployeeId: r.reportsToEmployeeId,
          })),
          ctx.session.employeeId!,
        );

    const members = (visible ? rows.filter((r) => visible.has(r.employeeId)) : rows).map((r) => ({
      ...r,
      name: r.name ?? "Unknown",
      projectName: r.projectName ?? "Unknown job",
    }));

    /*
      People who are POINTED AT but hold no roster row of their own — the
      director above forty jobs. `buildOrgForest` renders them as synthetic
      nodes and needs their names, which are not in `members` by definition.
    */
    const have = new Set(members.map((m) => m.employeeId));
    /*
      NOT filtered by `visible`, and that is the fix for the "Unknown" node.

      It used to be `(!visible || visible.has(id))`, which dropped a manager the
      viewer may not otherwise see. But the roster row still POINTED at them, so
      `buildOrgForest` drew the parent anyway with no name to put in it — the
      chart rendered a card reading "Unknown · Not on a job · Above every job
      below", which looks like corrupt data and tells the reader nothing.

      Withholding the name did not withhold the person: the node, its position
      and its direct-report count were all already on screen. All the filter
      achieved was making that node unreadable. So the name is returned for
      anybody a visible row points at — and nothing else about them is, which
      is the same amount of information a reader could already infer.
    */
    const wanted = [
      ...new Set(
        members.map((m) => m.reportsToEmployeeId).filter((id): id is string => !!id && !have.has(id)),
      ),
    ];
    const referenced = wanted.length
      ? await ctx.db
          .select({
            id: schema.employee.id,
            name: schema.employee.name,
            externalId: schema.employee.code,
            employeeRole: schema.employee.role,
            employeeStatus: schema.employee.employmentStatus,
          })
          .from(schema.employee)
          .where(and(eq(schema.employee.tenantId, tid), inArray(schema.employee.id, wanted)))
      : [];

    return {
      members,
      referenced,
      viewerEmployeeId: ctx.session.employeeId ?? null,
      scoped: !seesAll,
    };
  }),

  /*
    Put a person on a project in the role being assigned.

    A foreman assignment is the move itself — the same transaction
    employee.assignToProject runs, so their posting, tools and truck follow
    and the roster row is kept in lockstep. PM/superintendent assignments are
    pure roster entries: no tools follow, no primary project changes.
  */
  assign: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        employeeId: z.string().uuid(),
        /* Validated against the tenant's team-role register inside the
           handler, not by a static enum — the whole point of making this data. */
        role: z.string().min(1),
        startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        note: z.string().max(500).optional(),
        /* Default TRUE, which is both the old unconditional behaviour and the
           right answer nearly always: tools follow the person. False means the
           tools stay on the job being left, released to nobody — see
           `releaseToolsInPlace` in project-assign.ts for why that is a custody
           write and not just a skipped one. Ignored for roles whose link never
           moved custody in the first place. */
        moveTools: z.boolean().default(true),
        source: z.enum(TEAM_SOURCES).default(DEFAULT_TEAM_SOURCE),
        /* Who this person answers to on this job. Null clears it; omitted
           leaves it unset. See the schema comment for why the edge lives on the
           roster row and not on the employee. */
        reportsToEmployeeId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const roleRow = await requireTeamRole(ctx.db, tid, input.role);
      await assertCanAssign(ctx.db, ctx.session, tid, input.projectId, roleRow);
      await assertBranchTarget(ctx.db, ctx.session, input.projectId, input.employeeId, "reportsToEmployeeId" in input ? input.reportsToEmployeeId as string | null : undefined);

      /*
        Refuse an edge that would close a loop, at ANY depth.

        `routers/project.ts` already rejects the depth-1 case on the employee
        column ("Somebody cannot report to themselves"). That is not the case
        that bites: A -> B -> C -> A is entered one innocent row at a time by
        three different people, none of whom can see the whole chain. A loop
        makes the chart unrenderable and the visibility rule unanswerable, so it
        is refused at the door rather than tolerated downstream — `buildOrgForest`
        breaks loops defensively, but that is a net, not a policy.
      */
      if (input.reportsToEmployeeId) {
        const edges = await ctx.db
          .select({
            id: schema.projectTeamMember.id,
            projectId: schema.projectTeamMember.projectId,
            employeeId: schema.projectTeamMember.employeeId,
            role: schema.projectTeamMember.role,
            reportsToEmployeeId: schema.projectTeamMember.reportsToEmployeeId,
          })
          .from(schema.projectTeamMember)
          .where(
            and(
              eq(schema.projectTeamMember.tenantId, tid),
              isNull(schema.projectTeamMember.endedOn),
            ),
          );
        const loop = findCycle(edges, input.employeeId, input.reportsToEmployeeId);
        if (loop) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              loop.length <= 2
                ? "Somebody cannot report to themselves."
                : "That would make the reporting line circular — the person you picked already reports up to this one.",
          });
        }
      }

      const [person] = await ctx.db
        .select({ id: schema.employee.id, name: schema.employee.name, role: schema.employee.role })
        .from(schema.employee)
        .where(and(eq(schema.employee.id, input.employeeId), eq(schema.employee.tenantId, tid)));
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "No such person in this tenant" });

      const [proj] = await ctx.db
        .select({ id: schema.project.id, name: schema.project.name })
        .from(schema.project)
        .where(and(eq(schema.project.id, input.projectId), eq(schema.project.tenantId, tid)));
      if (!proj) throw new TRPCError({ code: "NOT_FOUND", message: "No such project in this tenant" });

      const active = await ctx.db.query.projectTeamMember.findFirst({ where: and(eq(schema.projectTeamMember.tenantId, tid), eq(schema.projectTeamMember.projectId, input.projectId), eq(schema.projectTeamMember.employeeId, input.employeeId), eq(schema.projectTeamMember.role, input.role), isNull(schema.projectTeamMember.endedOn)) });
      if (active) return { ok: true, alreadyAssigned: true };

      let moved: { toolsMoved: number; containersMoved: number } | null = null;

      if (roleRow.canHoldCustody) {
        /* A foreman linked to a project IS a foreman working it: the same
           move employee.assignToProject performs, with the roster row kept in
           lockstep inside the transaction. */
        const res = await moveEmployeeToProject(ctx.db, {
          tenantId: tid,
          employeeId: input.employeeId,
          projectId: input.projectId,
          actorUserId: ctx.session.userId,
          startedOn: input.startedOn,
          note: input.note,
          /* The team role being assigned, not a hard-coded "foreman" — a
             superintendent's link moves custody too since 2026-09-01, and
             passing the wrong role here would open their posting as somebody
             else's. */
          role: input.role,
          moveTools: input.moveTools,
          releaseToolsInPlace: !input.moveTools,
          source: input.source,
          reportsToEmployeeId: input.reportsToEmployeeId ?? (ctx.session.permissions.has("project.team.assign") ? null : ctx.session.employeeId),
        });
        moved = { toolsMoved: res.toolsMoved, containersMoved: res.containersMoved };
      } else {
        const startedOn = input.startedOn ?? new Date().toISOString().slice(0, 10);
        await ctx.db.transaction(async (tx: any) => {
          await tx
            .update(schema.projectTeamMember)
            .set({ endedOn: startedOn })
            .where(
              and(
                eq(schema.projectTeamMember.tenantId, tid),
                eq(schema.projectTeamMember.projectId, input.projectId),
                eq(schema.projectTeamMember.employeeId, input.employeeId),
                eq(schema.projectTeamMember.role, input.role),
                isNull(schema.projectTeamMember.endedOn),
              ),
            );
          await tx
            .insert(schema.projectTeamMember)
            .values({
              tenantId: tid,
              projectId: input.projectId,
              employeeId: input.employeeId,
              role: input.role,
              assignedByUserId: ctx.session.userId,
              startedOn,
              note: input.note ?? null,
              source: input.source,
              reportsToEmployeeId: input.reportsToEmployeeId ?? (ctx.session.permissions.has("project.team.assign") ? null : ctx.session.employeeId),
            });
        });
      }

      await ctx.db.update(schema.projectAccessRestriction).set({ restoredAt: new Date() }).where(and(eq(schema.projectAccessRestriction.tenantId, tid), eq(schema.projectAccessRestriction.projectId, input.projectId), eq(schema.projectAccessRestriction.employeeId, input.employeeId)));

      /*
        A tier somebody deferred to their boss has now been filled, so the
        deferral is answered — stamped, never deleted, because "who was supposed
        to do this and did it happen" needs the history.

        Placed HERE rather than inside either branch above: the two paths (a
        tools-moving assignment through `moveEmployeeToProject`, and the plain
        roster write) both arrive at this point, and a close in one of them would
        leave the other's deferrals open forever. This is the single writer that
        closes them — see the schema comment on `projectRoleDeferral`.

        Not scoped to who deferred it. The deferral is per (job, tier), because
        two foremen deferring the same superintendent slot is one outstanding
        decision.
      */
      await ctx.db
        .update(schema.projectRoleDeferral)
        .set({ resolvedAt: new Date() })
        .where(
          and(
            eq(schema.projectRoleDeferral.tenantId, tid),
            eq(schema.projectRoleDeferral.projectId, input.projectId),
            eq(schema.projectRoleDeferral.teamRole, input.role),
            isNull(schema.projectRoleDeferral.resolvedAt),
          ),
        );

      await logEvent(ctx, {
        category: "project",
        action: `project.team.assign.${input.role}`,
        entityType: "project",
        entityId: input.projectId,
        entityLabel: proj.name,
        details: {
          employeeId: input.employeeId,
          employeeName: person.name,
          role: input.role,
          toolsMoved: moved?.toolsMoved ?? null,
        },
      });

      return { ok: true, ...(moved ?? {}) };
    }),

  /* Take somebody off a project in that role. A foreman whose tools are on the
     project cannot be unlinked without first moving them — otherwise the
     register would show tools working a job their holder no longer works. */
  remove: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), employeeId: z.string().uuid(), role: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<{ ok: boolean }> => {
      // Compatibility callers use the same audited branch removal as the team page.
      const { projectTeamsRouter } = await import("./projectTeams.js");
      return projectTeamsRouter.createCaller(ctx).removeBranch({ projectId: input.projectId, employeeId: input.employeeId, reason: "Removed through project team actions" });
    }),

  /*
    Change who a roster row answers to, WITHOUT touching custody.

    Deliberately not "call assign again with a different reportsToEmployeeId".
    `assign` on a custody-moving role runs `moveEmployeeToProject` even when
    the project and employee are unchanged, which would close and reopen a
    real custody link — a tools move nobody asked for — to edit a pointer on
    the roster row. This procedure updates exactly `reports_to_employee_id` on
    the existing active row and nothing else: no ledger write, no custody
    touch, no `endedOn` stamp. Same permission gate as putting the person in
    the role in the first place — changing who a PM answers to is the same
    kind of act as assigning the PM.
  */
  setReportsTo: protectedProcedure
    .input(z.object({ id: z.string().uuid(), reportsToEmployeeId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const [row] = await ctx.db
        .select({
          id: schema.projectTeamMember.id,
          projectId: schema.projectTeamMember.projectId,
          employeeId: schema.projectTeamMember.employeeId,
          role: schema.projectTeamMember.role,
        })
        .from(schema.projectTeamMember)
        .where(
          and(
            eq(schema.projectTeamMember.id, input.id),
            eq(schema.projectTeamMember.tenantId, tid),
            isNull(schema.projectTeamMember.endedOn),
          ),
        );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That roster row is not active." });

      const roleRow = await requireTeamRole(ctx.db, tid, row.role);
      await assertCanAssign(ctx.db, ctx.session, tid, row.projectId, roleRow);
      await assertBranchTarget(ctx.db, ctx.session, row.projectId, row.employeeId, input.reportsToEmployeeId);

      if (input.reportsToEmployeeId === row.employeeId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Somebody cannot report to themselves." });
      }
      if (input.reportsToEmployeeId) {
        const edges = await ctx.db
          .select({
            id: schema.projectTeamMember.id,
            projectId: schema.projectTeamMember.projectId,
            employeeId: schema.projectTeamMember.employeeId,
            role: schema.projectTeamMember.role,
            reportsToEmployeeId: schema.projectTeamMember.reportsToEmployeeId,
          })
          .from(schema.projectTeamMember)
          .where(and(eq(schema.projectTeamMember.tenantId, tid), isNull(schema.projectTeamMember.endedOn)));
        const loop = findCycle(edges, row.employeeId, input.reportsToEmployeeId);
        if (loop) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That would make the reporting line circular — the person you picked already reports up to this one.",
          });
        }
      }

      await ctx.db
        .update(schema.projectTeamMember)
        .set({ reportsToEmployeeId: input.reportsToEmployeeId })
        .where(and(eq(schema.projectTeamMember.id, row.id), eq(schema.projectTeamMember.tenantId, tid)));

      await logEvent(ctx, {
        category: "project", action: "project.team.setReportsTo", entityType: "project_team_member",
        entityId: row.id, details: { reportsToEmployeeId: input.reportsToEmployeeId },
      });
      return { ok: true };
    }),

  /*
    Verify a roster row somebody below you recorded.

    The case: a superintendent puts a foreman on a job, and the PM above them
    onboards afterwards. The PM sees what the superintendent already did rather
    than an empty crew step, and says "yes, that is right" once.

    Gated by the SAME permission that would have let the caller write the row in
    the first place — `assertCanAssign` on the row's own tier. Confirming a
    superintendent's placement is an act of the same weight as making it, and a
    confirmation anybody could give would mean nothing.

    Confirms nothing about custody and changes no tools. The row has been live
    since it was written; see the column comment. What this changes is what the
    progress screen counts as outstanding.

    Idempotent: re-confirming an already-confirmed row is a no-op rather than an
    error, because two people clicking the same button is not a conflict.
  */
  confirm: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;

      const [row] = await ctx.db
        .select({
          id: schema.projectTeamMember.id,
          role: schema.projectTeamMember.role,
          projectId: schema.projectTeamMember.projectId,
          employeeId: schema.projectTeamMember.employeeId,
          confirmedAt: schema.projectTeamMember.confirmedAt,
          endedOn: schema.projectTeamMember.endedOn,
        })
        .from(schema.projectTeamMember)
        .where(and(eq(schema.projectTeamMember.id, input.id), eq(schema.projectTeamMember.tenantId, tid)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No such team member" });

      /* A closed row is history. Confirming it would assert something about a
         posting that has already ended. */
      if (row.endedOn) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That posting has already ended." });
      }
      await assertBranchTarget(ctx.db, ctx.session, row.projectId, row.employeeId);
      if (row.confirmedAt) return { ok: true, alreadyConfirmed: true };

      const roleRow = await ctx.db.query.teamRole.findFirst({
        where: and(eq(schema.teamRole.name, row.role), eq(schema.teamRole.tenantId, tid)),
      });
      /* A tier deleted from the register since the row was written. Fall back to
         the generic assign permission rather than letting the confirmation
         through ungated — the same choice `assertCanAssign` makes for a
         tenant's own tiers. `id: ""` rather than a cast past a missing field:
         `assertCanAssign` reads it as "no real tier to look up a Set-by list
         for" and skips that query outright — cascade delete would have
         removed any such rows anyway, so an empty result and a skipped query
         mean the same thing here. */
      await assertCanAssign(
        ctx.db,
        ctx.session,
        tid,
        row.projectId,
        roleRow ?? { id: "", name: row.role, label: row.role, canHoldCustody: false, assignableByEveryone: false },
      );

      await ctx.db
        .update(schema.projectTeamMember)
        .set({ confirmedAt: new Date(), confirmedByUserId: ctx.session.userId })
        .where(and(eq(schema.projectTeamMember.id, row.id), eq(schema.projectTeamMember.tenantId, tid)));

      await logEvent(ctx, {
        category: "project", action: "project.team.confirm", entityType: "project_team_member",
        entityId: row.id, details: { role: row.role, employeeId: row.employeeId },
      });
      return { ok: true, alreadyConfirmed: false };
    }),

  /*
    The team-role register itself — every tier, seeded or tenant-added, joins
    here, not in code. The tiers a tenant starts with are rows like any other,
    with no privileges the tenant's own additions lack: since the dedicated
    `project.assign.*` permissions were removed on 2026-09-10, every tier is
    gated the same way — `project.team.assign` tenant-wide, or the tier's own
    `team_role_assigner` rows.

    Gated on `project.team.manage`, distinct from `project.team.assign`: adding
    a TIER to the vocabulary is a different act from putting one PERSON in an
    existing tier — the same split `config.manage` and `project.team.assign`
    keep for roles generally.
  */
  roles: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.session.permissions.has("project.team.read")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "missing permission: project.team.read" });
      }
      const tid = ctx.session.tenantId;
      const rows = await ctx.db
        .select({
          id: schema.teamRole.id,
          name: schema.teamRole.name,
          label: schema.teamRole.label,
          canHoldCustody: schema.teamRole.canHoldCustody,
          reportsToTeamRoleId: schema.teamRole.reportsToTeamRoleId,
          assignableByEveryone: schema.teamRole.assignableByEveryone,
        })
        .from(schema.teamRole)
        .where(eq(schema.teamRole.tenantId, tid))
        .orderBy(schema.teamRole.label);

      /* "Set by", attached per row. A second query rather than a join because
         a tier can have several assigners — a join would multiply each row by
         its assigner count and this list is small enough (a tenant's whole
         team-role register) that fetching it flat and grouping in memory reads
         more plainly than un-duplicating join output. */
      const tierIds = rows.map((r) => r.id);
      const assignerRows: { teamRoleId: string; assignerTeamRoleId: string }[] = tierIds.length
        ? await ctx.db
            .select({
              teamRoleId: schema.teamRoleAssigner.teamRoleId,
              assignerTeamRoleId: schema.teamRoleAssigner.assignerTeamRoleId,
            })
            .from(schema.teamRoleAssigner)
            .where(inArray(schema.teamRoleAssigner.teamRoleId, tierIds))
        : [];
      const assignerIdsByTarget = new Map<string, string[]>();
      for (const r of assignerRows) {
        const list = assignerIdsByTarget.get(r.teamRoleId) ?? [];
        list.push(r.assignerTeamRoleId);
        assignerIdsByTarget.set(r.teamRoleId, list);
      }

      /*
        WHICH LOGIN ROLES MAY CLAIM A JOB AS THIS TIER.

        Read from `role.claimTierNames`, which lives on the LOGIN role and not
        on the tier — this is a view onto another table's column, deliberately,
        and `setClaimable` below writes it back the same way. Do not "tidy" this
        into a column on `team_role`: what may put ITSELF on a job is a property
        of an account, the same axis as every other permission, and the tier
        register is edited by people who are describing an org chart rather than
        granting authority.

        Surfaced here because the Job Tiers screen is where somebody reasons
        about the ladder, and "who can start one of these" is part of that
        story. `/admin/roles` keeps its own checkboxes over the same data.
      */
      const claimRoles = await ctx.db
        .select({ id: schema.role.id, name: schema.role.name, claimTierNames: schema.role.claimTierNames })
        .from(schema.role)
        .where(eq(schema.role.tenantId, tid));
      const claimersByTier = new Map<string, { id: string; name: string }[]>();
      for (const role of claimRoles) {
        for (const tierName of role.claimTierNames ?? []) {
          const list = claimersByTier.get(tierName) ?? [];
          list.push({ id: role.id, name: role.name });
          claimersByTier.set(tierName, list);
        }
      }

      return rows.map((r) => ({
        ...r,
        assignerTeamRoleIds: assignerIdsByTarget.get(r.id) ?? [],
        claimedByRoles: claimersByTier.get(r.name) ?? [],
      }));
    }),

  /*
    Turn self-claiming on or off for a tier, from the Job Tiers screen.

    Keyed by TIER, because that is the row the administrator is looking at,
    while the data lives on the login role — so this resolves the tier's name to
    the role of the same name and edits that role's `claimTierNames`.

    Matching role-to-tier BY NAME is the whole trick and its one limitation:
    ticking "Director" grants the `director` LOGIN role the right to claim the
    `director` TIER. Where a tenant has a tier with no matching login role there
    is nothing to grant, and this says so rather than inventing a role — giving
    somebody a login is a deliberate act with its own screen, and a settings
    toggle must not become a second way to do it.

    `config.manage`, matching `role.setFlags`: this is a permission decision
    wearing a tier's clothes, and it must not be reachable by somebody who only
    holds `project.team.manage` (the rest of this screen).
  */
  setClaimable: requirePermission("config.manage")
    .input(z.object({ id: z.string().uuid(), claimable: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const [tier] = await ctx.db
        .select({ name: schema.teamRole.name, label: schema.teamRole.label })
        .from(schema.teamRole)
        .where(and(eq(schema.teamRole.id, input.id), eq(schema.teamRole.tenantId, tid)));
      if (!tier) throw new TRPCError({ code: "NOT_FOUND" });

      const [role] = await ctx.db
        .select({ id: schema.role.id, claimTierNames: schema.role.claimTierNames })
        .from(schema.role)
        .where(and(eq(schema.role.tenantId, tid), eq(schema.role.name, tier.name)));
      if (!role) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `There is no access role called "${tier.label}", so nobody can hold it. Create one on the Access Roles screen first.`,
        });
      }

      const current = new Set(role.claimTierNames ?? []);
      if (input.claimable) current.add(tier.name);
      else current.delete(tier.name);

      await ctx.db
        .update(schema.role)
        .set({ claimTierNames: [...current] })
        .where(and(eq(schema.role.id, role.id), eq(schema.role.tenantId, tid)));
      await logEvent(ctx, {
        category: "auth",
        action: "role.setClaimable",
        entityType: "role",
        entityId: role.id,
        details: { tier: tier.name, claimable: input.claimable },
      });
      return { ok: true };
    }),

    create: requirePermission("project.team.manage")
      .input(
        z.object({
          /* Lower-case, no spaces — this is the value written into
             `project_team_member.role`, so it has to survive round-tripping
             through a URL and a Zod `.min(1)` check the same way `pm` does. */
          name: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/, "lowercase letters, digits and underscores only"),
          label: z.string().min(1).max(60),
          canHoldCustody: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tid = ctx.session.tenantId;
        const [clash] = await ctx.db
          .select({ id: schema.teamRole.id })
          .from(schema.teamRole)
          .where(and(eq(schema.teamRole.tenantId, tid), eq(schema.teamRole.name, input.name)))
          .limit(1);
        if (clash) {
          throw new TRPCError({ code: "CONFLICT", message: `There is already a team role called "${input.name}".` });
        }
        const [created] = await ctx.db
          .insert(schema.teamRole)
          .values({
            tenantId: tid,
            name: input.name,
            label: input.label,
            canHoldCustody: input.canHoldCustody,
          })
          .returning({ id: schema.teamRole.id, name: schema.teamRole.name, label: schema.teamRole.label });
        await logEvent(ctx, {
          category: "project", action: "project.team.roles.create", entityType: "team_role",
          entityId: created!.id, entityLabel: created!.label,
        });
        return created;
      }),

    update: requirePermission("project.team.manage")
      .input(
        z.object({
          id: z.string().uuid(),
          label: z.string().min(1).max(60).optional(),
          canHoldCustody: z.boolean().optional(),
          /* The "Everybody" wildcard — see the schema comment on this column
             for why it is separate from, and additive to, `setAssigners`
             below rather than a value stored IN that list. */
          assignableByEveryone: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tid = ctx.session.tenantId;
        const patch: Record<string, unknown> = {};
        if (input.label !== undefined) patch.label = input.label;
        if (input.canHoldCustody !== undefined) patch.canHoldCustody = input.canHoldCustody;
        if (input.assignableByEveryone !== undefined) patch.assignableByEveryone = input.assignableByEveryone;
        if (Object.keys(patch).length === 0) return { ok: true };
        await ctx.db
          .update(schema.teamRole)
          .set(patch)
          .where(and(eq(schema.teamRole.id, input.id), eq(schema.teamRole.tenantId, tid)));
        await logEvent(ctx, {
          category: "project", action: "project.team.roles.update", entityType: "team_role", entityId: input.id, details: patch,
        });
        return { ok: true };
      }),

    /*
      Point one tier at the tier it answers to — the company's own ladder.

      Gated on `project.team.manage`, the same permission as adding a tier,
      because describing the shape of the organisation is the same act as
      naming its parts. Putting a PERSON somewhere in that shape stays
      `project.team.assign`, unchanged.

      Deliberately no reordering, no rank, no "move up". The register is a set
      of edges and the ladder is whatever those edges describe, including the
      shapes a rank cannot express — two tiers sharing a boss, or a tenant that
      has only described half of its chain.

      The seeded three are editable here, same as any tenant-added tier —
      only their `name` is fixed, because it is what a live
      `project_team_member.role` row already points at. Where `pm` sits in a
      given company's ladder is exactly the kind of thing that differs
      between tenants, so refusing to let anyone say it would make the
      feature useless for the seeded three.
    */
    setReportsTo: requirePermission("project.team.manage")
      .input(
        z.object({
          id: z.string().uuid(),
          /* Null clears the edge — "top of the chain, or we have not decided". */
          reportsToTeamRoleId: z.string().uuid().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tid = ctx.session.tenantId;

        const roles = await ctx.db
          .select({
            id: schema.teamRole.id,
            label: schema.teamRole.label,
            reportsToTeamRoleId: schema.teamRole.reportsToTeamRoleId,
          })
          .from(schema.teamRole)
          .where(eq(schema.teamRole.tenantId, tid));

        const self = roles.find((r) => r.id === input.id);
        if (!self) throw new TRPCError({ code: "NOT_FOUND", message: "No such team role" });

        /* Both ids are checked against the tenant's OWN register rather than by
           id alone. The foreign key would happily accept another tenant's role
           id — it has no tenant predicate — and that would be a cross-tenant
           write dressed up as a valid reference. */
        if (input.reportsToTeamRoleId && !roles.some((r) => r.id === input.reportsToTeamRoleId)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No such team role" });
        }

        const loop = findTierCycle(roles, input.id, input.reportsToTeamRoleId);
        if (loop) {
          const labelOf = (id: string) => roles.find((r) => r.id === id)?.label ?? "a role";
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That would make the reporting line circular: ${labelOf(input.reportsToTeamRoleId!)} already reports up to ${self.label}.`,
          });
        }

        await ctx.db
          .update(schema.teamRole)
          .set({ reportsToTeamRoleId: input.reportsToTeamRoleId })
          .where(and(eq(schema.teamRole.id, input.id), eq(schema.teamRole.tenantId, tid)));

        await logEvent(ctx, {
          category: "project", action: "project.team.roles.setReportsTo", entityType: "team_role",
          entityId: input.id, entityLabel: self.label,
          details: { reportsToTeamRoleId: input.reportsToTeamRoleId },
        });
        return { ok: true };
      }),

    /*
      "Set by" (STI-503): which tiers may place someone into this one.

      Replaces the WHOLE list on every call rather than offering add/remove —
      the client edits this as one control (a multi-select against the
      tenant's own tiers), so there is never a partial-update case to get
      wrong, and "set the list to exactly these" is one statement instead of a
      diff against what was there before.

      Gated the same as `setReportsTo` and for the same reason: deciding WHO
      may populate a tier is describing the organisation's shape, the same act
      as adding the tier or pointing it at its boss. Putting a PERSON into a
      tier stays gated by `assertCanAssign` at assignment time, unchanged.

      This is ADDITIVE to `project.team.assign` — see `assertCanAssign` and
      the schema comment on `team_role_assigner`. Emptying this list for a
      tier does not revoke the tenant-wide grant from anyone holding it; it
      only means no tier gains that ability through this mechanism.

      Since the dedicated `project.assign.*` permissions were removed, this
      IS how a superintendent comes to assign a foreman. Emptying the foreman
      tier's list now genuinely removes that, where before it left the
      permission standing behind it.
    */
    setAssigners: requirePermission("project.team.manage")
      .input(
        z.object({
          id: z.string().uuid(),
          /* Tier ids, not names — names are entered as free text on `create`
             and cross-tenant collisions are possible in principle; ids are
             what every other edge on this table already uses
             (`reportsToTeamRoleId`). */
          assignerTeamRoleIds: z.array(z.string().uuid()).max(50),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tid = ctx.session.tenantId;
        const [self] = await ctx.db
          .select({ id: schema.teamRole.id, label: schema.teamRole.label })
          .from(schema.teamRole)
          .where(and(eq(schema.teamRole.id, input.id), eq(schema.teamRole.tenantId, tid)));
        if (!self) throw new TRPCError({ code: "NOT_FOUND", message: "No such team role" });

        /* A tier cannot be its own assigner and cannot name an id from
           another tenant or one that does not exist — verified against THIS
           tenant's own register rather than trusted from the input, the same
           reason `setReportsTo` re-reads `roleByName` instead of taking a
           label on faith. */
        const ids = [...new Set(input.assignerTeamRoleIds)].filter((id) => id !== input.id);
        const valid = ids.length
          ? await ctx.db
              .select({ id: schema.teamRole.id })
              .from(schema.teamRole)
              .where(and(eq(schema.teamRole.tenantId, tid), inArray(schema.teamRole.id, ids)))
          : [];
        const validIds = new Set(valid.map((v) => v.id));
        const unknown = ids.filter((id) => !validIds.has(id));
        if (unknown.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "One or more of those roles do not exist in this tenant." });
        }

        await ctx.db.transaction(async (tx: any) => {
          await tx.delete(schema.teamRoleAssigner).where(eq(schema.teamRoleAssigner.teamRoleId, input.id));
          if (ids.length) {
            await tx
              .insert(schema.teamRoleAssigner)
              .values(ids.map((assignerTeamRoleId) => ({ teamRoleId: input.id, assignerTeamRoleId })));
          }
        });

        await logEvent(ctx, {
          category: "project", action: "project.team.roles.setAssigners", entityType: "team_role",
          entityId: input.id, entityLabel: self.label,
          details: { assignerTeamRoleIds: ids },
        });
        return { ok: true };
      }),

    /* Any tier CAN be deleted, `pm`/`superintendent`/`foreman` included — they
       are ordinary rows, same as one a tenant adds itself. The only refusal
       left is a real one: deleting a tier something currently uses would leave
       live `project_team_member` rows naming a role the Zod edge no longer
       recognises, so that is refused rather than orphaning history. */
    delete: requirePermission("project.team.manage")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const tid = ctx.session.tenantId;
        const [row] = await ctx.db
          .select({ id: schema.teamRole.id, name: schema.teamRole.name, label: schema.teamRole.label })
          .from(schema.teamRole)
          .where(and(eq(schema.teamRole.id, input.id), eq(schema.teamRole.tenantId, tid)));
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No such team role" });
        const [inUse] = await ctx.db
          .select({ id: schema.projectTeamMember.id })
          .from(schema.projectTeamMember)
          .where(
            and(
              eq(schema.projectTeamMember.tenantId, tid),
              eq(schema.projectTeamMember.role, row.name),
              isNull(schema.projectTeamMember.endedOn),
            ),
          )
          .limit(1);
        if (inUse) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `"${row.label}" is currently assigned on at least one job. Remove those first.`,
          });
        }
        await ctx.db.delete(schema.teamRole).where(eq(schema.teamRole.id, input.id));
        await logEvent(ctx, {
          category: "project", action: "project.team.roles.delete", entityType: "team_role", entityId: input.id, entityLabel: row.label,
        });
        return { ok: true };
      }),
  }),

  /*
    "My Crew" — everyone at or below the caller, per job, so a superior can
    claim their crew top-down.

    WHY THIS EXISTS ALONGSIDE `onboarding.crewStatus`, which looks similar and
    is not the same job. That one serves step four of the onboarding wizard: it
    returns the tiers IMMEDIATELY above and below the caller, because a foreman
    being onboarded is asked to name their boss and their own crew and nothing
    further. This one is the whole subtree downward and never upward, because
    the client's case is a director on a short-handed job with no PM and no
    superintendent on it who still has to be able to name the foreman. Walking
    that one link at a time would mean inventing two intermediate people so the
    chain has something to hang off.

    READ-ONLY, and it writes nothing. Claiming goes through `assign` below
    under the caller's own permission — the same chokepoint the jobsite hub and
    the wizard use. This procedure invents no elevated path, and `canAssign`
    per tier below is a HINT for the UI, not a gate: `assertCanAssign` is still
    the only thing that decides.

    `hops` and `viaTeamRoleIds` come back per tier so the client can warn on a
    skip. The warning is advisory by design — settled with the client
    2026-09-07: "they will get a warning but they can do it, like a director
    can directly act as PM". Nothing here refuses a distant tier, and nothing
    should; `assertCanAssign` has never read the reporting chain and making it
    do so would be a different product decision than this screen.
  */
  myCrew: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    /* No employee record means no position in the ladder, so no crew. A
       desk-only login (the tenant owner, say) legitimately hits this. */
    if (!ctx.session.employeeId) return [];

    const myRows = await ctx.db
      .select({
        projectId: schema.projectTeamMember.projectId,
        projectName: schema.project.name,
        projectCode: schema.project.code,
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
      /* Same reason `crewStatus` orders: claiming refetches this, and heap
         order would reshuffle the jobs under the person mid-task. */
      .orderBy(schema.project.name);
    if (myRows.length === 0) return [];

    const allRoles = await ctx.db
      .select({
        id: schema.teamRole.id,
        name: schema.teamRole.name,
        label: schema.teamRole.label,
        canHoldCustody: schema.teamRole.canHoldCustody,
        reportsToTeamRoleId: schema.teamRole.reportsToTeamRoleId,
        assignableByEveryone: schema.teamRole.assignableByEveryone,
      })
      .from(schema.teamRole)
      .where(eq(schema.teamRole.tenantId, tid));
    const roleById = new Map(allRoles.map((r) => [r.id, r]));
    const roleByName = new Map(allRoles.map((r) => [r.name, r]));
    const edges = allRoles.map((r) => ({ id: r.id, reportsToTeamRoleId: r.reportsToTeamRoleId }));

    /*
      "Set by", tenant-wide, resolved to a map once rather than once per tier
      per project — this screen can render several jobs at once. Scoped to the
      tenant by filtering on `allRoles`' own ids (already `tenantId`-scoped
      above): `team_role_assigner` carries no `tenant_id` of its own, the same
      shape as `role_permission` (see `.claude/rules/database.md`), so the
      parent's WHERE clause is the isolation.
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
        reportsToEmployeeId: schema.projectTeamMember.reportsToEmployeeId,
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

    /*
      Who is NOT claimable: anybody holding a tier ABOVE me, anywhere.

      Tenant-wide rather than per-project on purpose. A superintendent on
      another job is still a superintendent, and offering them into my foreman
      slot because they happen not to be on THIS job is how a picker suggests
      naming your own boss's boss into a crew.
    */
    const heldTiersByEmployee = new Map<string, Set<string>>();
    const tenantTeamRows = await ctx.db
      .select({
        employeeId: schema.projectTeamMember.employeeId,
        role: schema.projectTeamMember.role,
      })
      .from(schema.projectTeamMember)
      .where(
        and(
          eq(schema.projectTeamMember.tenantId, tid),
          isNull(schema.projectTeamMember.endedOn),
        ),
      );
    for (const r of tenantTeamRows) {
      const set = heldTiersByEmployee.get(r.employeeId) ?? new Set<string>();
      set.add(r.role);
      heldTiersByEmployee.set(r.employeeId, set);
    }

    /* Leavers a sync has flagged are excluded as well as terminated ones: a
       person BambooHR says has gone is not somebody to be putting on a crew,
       even while `employmentStatus` still reads active because clearing that
       is an admin's decision (see employee.hrFlaggedInactiveAt). */
    const roster = await ctx.db
      .select({
        id: schema.employee.id,
        name: schema.employee.name,
        code: schema.employee.code,
        employmentStatus: schema.employee.employmentStatus,
        hrFlaggedInactiveAt: schema.employee.hrFlaggedInactiveAt,
      })
      .from(schema.employee)
      .where(eq(schema.employee.tenantId, tid));

    const permissions = ctx.session.permissions;

    return myRows.map((mine) => {
      /*
        A HINT for the client, not the gate — same relationship every
        `canAssign` flag in this file has to `assertCanAssign`, which is what
        actually enforces it on write. Defined PER ROW rather than once above
        the `.map`, because it reads `mine.role` — the caller's own tier ON
        THIS project — and closing over the wrong iteration's value here is
        exactly the bug that shape invites. Path 3 is therefore scoped exactly
        the way `assertCanAssign` scopes it: a superintendent on ANOTHER job
        does not make this true here.

        Kept in lockstep with `assertCanAssign` by hand — both call
        `canAssignIntoTier` with the same four inputs, and a change to one
        without the other is exactly the drift that pure function exists to
        prevent.
      */
      const canAssignTier = (targetRole: { name: string; id: string; assignableByEveryone: boolean }): boolean =>
        canAssignIntoTier({
          hasAdminPermission: permissions.has("project.team.assign"),
          targetIsOpenToEveryone: targetRole.assignableByEveryone,
          callerTierNamesOnThisProject: new Set(myRows.filter(r => r.projectId === mine.projectId).map(r => r.role)),
          targetAssignerTierNames: assignerNamesByTargetId.get(targetRole.id) ?? new Set(),
          /* Path 4, in lockstep with `assertCanAssign` — `edges` is the same
             tier register `tiersAbove` walks there. */
          targetAncestorTierNames: new Set(
            tiersAbove(edges, targetRole.id)
              .map(id => roleById.get(id)?.name)
              .filter((n): n is string => !!n),
          ),
        });

      const myTier = roleByName.get(mine.role);
      const claimable = myTier ? tiersAtOrBelow(edges, myTier.id) : [];
      const aboveIds = myTier ? tiersAbove(edges, myTier.id) : [];
      const aboveNames = new Set(
        aboveIds.map((id) => roleById.get(id)?.name).filter((n): n is string => !!n),
      );

      const candidates = roster
        .filter((e) => e.employmentStatus === "active" && !e.hrFlaggedInactiveAt)
        .filter((e) => {
          const held = heldTiersByEmployee.get(e.id);
          if (!held) return true; // nobody's crew yet — claimable into anything
          for (const tierName of held) if (aboveNames.has(tierName)) return false;
          return true;
        })
        .map((e) => ({ id: e.id, name: e.name, code: e.code }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const tiers = claimable
        .map((t) => {
          const role = roleById.get(t.teamRoleId)!;
          const filled = allTeamRows.filter(
            (r) => r.projectId === mine.projectId && r.role === role.name,
          );
          return {
            teamRoleId: role.id,
            teamRoleName: role.name,
            label: role.label,
            canHoldCustody: role.canHoldCustody,
            hops: t.hops,
            /* Labels, not ids — the warning is a sentence a person reads, and
               resolving ids in the client would mean shipping the register
               twice. */
            skipsTiers: t.viaTeamRoleIds
              .map((id) => roleById.get(id)?.label)
              .filter((l): l is string => !!l),
            canAssign: canAssignTier(role),
            filled: filled.map((f) => ({
              id: f.id,
              employeeId: f.employeeId,
              employeeName: f.employeeName ?? "Unknown",
              confirmed: !!f.confirmedAt,
              reportsToMe: f.reportsToEmployeeId === ctx.session.employeeId,
            })),
          };
        })
        /* Nearest first, then alphabetical — the crew you actually run is what
           you came to this screen for, and a stable order matters because
           claiming refetches. */
        .sort((a, b) => a.hops - b.hops || a.label.localeCompare(b.label));

      return {
        projectId: mine.projectId,
        projectName: mine.projectName,
        projectCode: mine.projectCode,
        myTeamRole: mine.role,
        /*
          The claimer's own employee id, and the screen cannot work without it.

          A claim means "this person answers to ME", so the client has to send
          it back as `reportsToEmployeeId` on the assign. Passing `null` there
          instead — which is what the first cut of the page did — writes a row
          meaning "no boss recorded", which is a legal state and the exact
          OPPOSITE of what claiming asserts. It looked right in the diff and was
          caught only by claiming somebody in a browser and reading the row back.
        */
        myEmployeeId: ctx.session.employeeId,
        myTeamRoleLabel: myTier?.label ?? mine.role,
        /* A tier the register has not placed in the ladder yet returns only
           itself, which is honest rather than empty — but the screen needs to
           be able to say why there is nothing below. */
        myTierPlaced: !!myTier,
        candidates,
        tiers,
      };
    });
  }),
});
