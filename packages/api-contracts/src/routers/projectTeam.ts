import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { moveEmployeeToProject } from "../project-assign.js";
import { visibleProjectScope } from "../scope.js";
import type { Permission } from "@stinventory/types";

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
  `PERM_FOR_ROLE` maps the target role to the permission it costs, and
  `assertCanAssign` is the only gate. Nothing here reads `session.roleName`.
*/
const TEAM_ROLES = ["pm", "superintendent", "foreman"] as const;
type TeamRole = (typeof TEAM_ROLES)[number];

/* Team roles whose project link MOVES CUSTODY. Named rather than compared
   against the literal "foreman" in three places, which is how
   `CUSTODIAN_ROLES` came to exist in packages/types after three custodian
   pickers had drifted apart. Deliberately separate from `CUSTODIAN_ROLES`:
   that answers "may hold a tool" and includes `mechanic`, who is never on a
   project team. */
const TOOLS_FOLLOW: readonly TeamRole[] = ["foreman"];
const toolsFollow = (role: TeamRole) => TOOLS_FOLLOW.includes(role);

const PERM_FOR_ROLE: Record<TeamRole, Permission> = {
  pm: "project.assign.pm",
  superintendent: "project.assign.superintendent",
  foreman: "project.assign.foreman",
};

function assertCanAssign(permissions: ReadonlySet<Permission>, role: TeamRole): void {
  /* The GATE is `PERM_FOR_ROLE[role]` — a permission, never a role name. The
     comparisons below it only choose which sentence to show; getting one wrong
     mis-words a refusal that has already happened. STI-307 AC 5 survivor,
     annotated. */
  if (!permissions.has(PERM_FOR_ROLE[role])) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        role === "pm"
          ? "Only admins and the equipment department can put a PM on a project."
          : role === "superintendent"
            ? "PMs and admins assign superintendents to projects."
            : "You need to be a PM, superintendent, admin or the equipment department to assign a foreman.",
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
        role: z.enum(TEAM_ROLES),
        startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      assertCanAssign(ctx.session.permissions, input.role);

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

      if (toolsFollow(input.role)) {
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
          role: "foreman",
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
    .input(z.object({ projectId: z.string().uuid(), employeeId: z.string().uuid(), role: z.enum(TEAM_ROLES) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      assertCanAssign(ctx.session.permissions, input.role);

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

      if (toolsFollow(input.role)) {
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
});
