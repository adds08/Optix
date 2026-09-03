import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { moveEmployeeToProject } from "../project-assign.js";
import { visibleProjectScope, viewTierOf } from "../scope.js";
import { buildOrgForest, findCycle, visibleEmployeeIds } from "@stinventory/domain";
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

  `pm`, `superintendent` and `foreman` keep their OWN permissions
  (`project.assign.pm` etc.) unchanged — nothing about assigning those three
  moved, and `rbac-matrix.test.ts` still exercises exactly the grants it always
  did. A row a tenant adds has no such permission by construction (the
  `Permission` union is fixed code, edited by nobody in a settings screen) and
  falls to `project.team.assign` instead — see the comment on that string in
  packages/types.

  NOT the login/permission role (`tbl_entity_role`, `/admin/roles`) and not a
  lookup between them. Confirmed deliberately separate after nearly conflating
  the two on 2026-09-03: the seed carries one person whose LOGIN role is
  `engineer` and whose TEAM role is `pm` — the two vocabularies diverge for the
  same person on purpose. A lookup would be the two-lists-that-drift pattern
  `role`'s own header comment exists to end.
*/
const BUILT_IN_PERM: Partial<Record<string, Permission>> = {
  pm: "project.assign.pm",
  superintendent: "project.assign.superintendent",
  foreman: "project.assign.foreman",
};

type TeamRoleRow = { name: string; label: string; canHoldCustody: boolean; isSystem: boolean };

async function requireTeamRole(db: any, tid: string, name: string): Promise<TeamRoleRow> {
  const [row] = await db
    .select({
      name: schema.teamRole.name,
      label: schema.teamRole.label,
      canHoldCustody: schema.teamRole.canHoldCustody,
      isSystem: schema.teamRole.isSystem,
    })
    .from(schema.teamRole)
    .where(and(eq(schema.teamRole.tenantId, tid), eq(schema.teamRole.name, name)));
  if (!row) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `"${name}" is not a team role in this tenant.` });
  }
  return row;
}

function assertCanAssign(permissions: ReadonlySet<Permission>, role: TeamRoleRow): void {
  const perm = BUILT_IN_PERM[role.name] ?? "project.team.assign";
  if (!permissions.has(perm)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        role.name === "pm"
          ? "Only admins and the equipment department can put a PM on a project."
          : role.name === "superintendent"
            ? "PMs and admins assign superintendents to projects."
            : role.name === "foreman"
              ? "You need to be a PM, superintendent, admin or the equipment department to assign a foreman."
              : `You do not have permission to assign the "${role.label}" role.`,
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
        startedOn: schema.projectTeamMember.startedOn,
        note: schema.projectTeamMember.note,
        employeeName: schema.employee.name,
        employeeExternalId: schema.employee.externalId,
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

    const rows = await ctx.db
      .select({
        id: schema.projectTeamMember.id,
        projectId: schema.projectTeamMember.projectId,
        projectName: schema.project.name,
        projectExternalId: schema.project.externalId,
        projectStatus: schema.project.status,
        employeeId: schema.projectTeamMember.employeeId,
        role: schema.projectTeamMember.role,
        reportsToEmployeeId: schema.projectTeamMember.reportsToEmployeeId,
        startedOn: schema.projectTeamMember.startedOn,
        note: schema.projectTeamMember.note,
        name: schema.employee.name,
        externalId: schema.employee.externalId,
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
    const wanted = [
      ...new Set(
        members
          .map((m) => m.reportsToEmployeeId)
          .filter((id): id is string => !!id && !have.has(id) && (!visible || visible.has(id))),
      ),
    ];
    const referenced = wanted.length
      ? await ctx.db
          .select({
            id: schema.employee.id,
            name: schema.employee.name,
            externalId: schema.employee.externalId,
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
      assertCanAssign(ctx.session.permissions, roleRow);

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
          reportsToEmployeeId: input.reportsToEmployeeId,
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
              reportsToEmployeeId: input.reportsToEmployeeId ?? null,
            });
        });
      }

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
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const roleRow = await requireTeamRole(ctx.db, tid, input.role);
      assertCanAssign(ctx.session.permissions, roleRow);

      const [row] = await ctx.db
        .select({
          id: schema.projectTeamMember.id,
          startedOn: schema.projectTeamMember.startedOn,
        })
        .from(schema.projectTeamMember)
        .where(
          and(
            eq(schema.projectTeamMember.tenantId, tid),
            eq(schema.projectTeamMember.projectId, input.projectId),
            eq(schema.projectTeamMember.employeeId, input.employeeId),
            eq(schema.projectTeamMember.role, input.role),
            isNull(schema.projectTeamMember.endedOn),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That person is not on this project in that role." });

      if (roleRow.canHoldCustody) {
        const [person] = await ctx.db
          .select({ id: schema.employee.id, primaryProjectId: schema.employee.primaryProjectId })
          .from(schema.employee)
          .where(and(eq(schema.employee.id, input.employeeId), eq(schema.employee.tenantId, tid)));
        if (person?.primaryProjectId === input.projectId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This foreman is working this project with tools and a truck that follow them. Assign them to another project first, or return their tools, before removing them from the team.",
          });
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      await ctx.db
        .update(schema.projectTeamMember)
        .set({ endedOn: today })
        .where(and(eq(schema.projectTeamMember.id, row.id), eq(schema.projectTeamMember.tenantId, tid)));

      await logEvent(ctx, {
        category: "project",
        action: `project.team.remove.${input.role}`,
        entityType: "project",
        entityId: input.projectId,
        details: { employeeId: input.employeeId, role: input.role },
      });

      return { ok: true };
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
      assertCanAssign(ctx.session.permissions, roleRow);

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
    The team-role register itself — Director, Area In-charge, General
    Superintendent join here, not in code. `pm`/`superintendent`/`foreman` ship
    seeded and `isSystem`; a tenant's own additions do not carry a dedicated
    `project.assign.*` permission (see BUILT_IN_PERM above) and are gated by
    `project.team.assign` at assignment time instead.

    Gated on `project.team.manage`, distinct from `project.team.assign`: adding
    a TIER to the vocabulary is a different act from putting one PERSON in an
    existing tier, the same split `config.manage` and `project.assign.*` already
    keep for roles generally.
  */
  roles: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.session.permissions.has("project.team.read")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "missing permission: project.team.read" });
      }
      return ctx.db
        .select({
          id: schema.teamRole.id,
          name: schema.teamRole.name,
          label: schema.teamRole.label,
          canHoldCustody: schema.teamRole.canHoldCustody,
          isSystem: schema.teamRole.isSystem,
        })
        .from(schema.teamRole)
        .where(eq(schema.teamRole.tenantId, ctx.session.tenantId))
        .orderBy(schema.teamRole.isSystem, schema.teamRole.label);
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
            isSystem: false,
          })
          .returning({ id: schema.teamRole.id, name: schema.teamRole.name, label: schema.teamRole.label });
        await logEvent(ctx, {
          category: "project", action: "project.team.roles.create", entityType: "team_role",
          entityId: created!.id, entityLabel: created!.label,
        });
        return created;
      }),

    update: requirePermission("project.team.manage")
      .input(z.object({ id: z.string().uuid(), label: z.string().min(1).max(60).optional(), canHoldCustody: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const tid = ctx.session.tenantId;
        const patch: Record<string, unknown> = {};
        if (input.label !== undefined) patch.label = input.label;
        if (input.canHoldCustody !== undefined) patch.canHoldCustody = input.canHoldCustody;
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

    /* `pm`/`superintendent`/`foreman` cannot be deleted — the assignment
       hierarchy, the seed and `rbac-matrix.test.ts` all name them directly, the
       same reason `role.delete` refuses `isSystem` rows. A tenant's own tier
       CAN be deleted if nothing currently uses it; if something does, deleting
       it would leave live `project_team_member` rows naming a role the Zod edge
       no longer recognises, so it is refused rather than orphaning history. */
    delete: requirePermission("project.team.manage")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const tid = ctx.session.tenantId;
        const [row] = await ctx.db
          .select({ id: schema.teamRole.id, name: schema.teamRole.name, label: schema.teamRole.label, isSystem: schema.teamRole.isSystem })
          .from(schema.teamRole)
          .where(and(eq(schema.teamRole.id, input.id), eq(schema.teamRole.tenantId, tid)));
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No such team role" });
        if (row.isSystem) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `"${row.label}" ships with the product and cannot be deleted.` });
        }
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
});
