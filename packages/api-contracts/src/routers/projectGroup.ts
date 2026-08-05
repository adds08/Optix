import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

/*
  Job Groups — the buckets a superintendent or PM is scoped to.

  `mine` is what the sidebar selector reads: the groups assigned to the signed
  in user, each with its jobs. `list`/`create`/`update`/`delete`/`setProjects`/
  `setUsers` are the equipment desk's tools for building those buckets.

  A user with no group assignments sees the whole tenant (the desk keeps full
  access); a user with assignments is confined to the jobs in their groups.
*/

export const projectGroupRouter = router({
  /* The groups this user may see, each with its jobs. Empty array = no
     assignments = full access. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const groups = await ctx.db
      .select({
        id: schema.projectGroup.id,
        name: schema.projectGroup.name,
        description: schema.projectGroup.description,
      })
      .from(schema.projectGroup)
      .innerJoin(
        schema.projectGroupUser,
        eq(schema.projectGroupUser.projectGroupId, schema.projectGroup.id),
      )
      .where(
        and(
          eq(schema.projectGroup.tenantId, tid),
          eq(schema.projectGroupUser.userId, ctx.session.userId),
        ),
      )
      .orderBy(schema.projectGroup.name);

    if (!groups.length) return [];

    const memberships = await ctx.db
      .select({
        projectGroupId: schema.projectGroupProject.projectGroupId,
        projectId: schema.projectGroupProject.projectId,
        projectName: schema.project.name,
        projectExternalId: schema.project.externalId,
      })
      .from(schema.projectGroupProject)
      .leftJoin(schema.project, eq(schema.projectGroupProject.projectId, schema.project.id))
      .where(
        and(
          eq(schema.projectGroupProject.tenantId, tid),
          inArray(
            schema.projectGroupProject.projectGroupId,
            groups.map((g) => g.id),
          ),
        ),
      );

    return groups.map((g) => ({
      ...g,
      projects: memberships
        .filter((m) => m.projectGroupId === g.id)
        .map((m) => ({ id: m.projectId, name: m.projectName ?? "Unknown", externalId: m.projectExternalId })),
    }));
  }),

  /* Everything, for the equipment desk to manage. */
  list: requirePermission("project.manage").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const groups = await ctx.db
      .select({
        id: schema.projectGroup.id,
        name: schema.projectGroup.name,
        description: schema.projectGroup.description,
      })
      .from(schema.projectGroup)
      .where(eq(schema.projectGroup.tenantId, tid))
      .orderBy(schema.projectGroup.name);

    if (!groups.length) return [];

    const memberships = await ctx.db
      .select({
        projectGroupId: schema.projectGroupProject.projectGroupId,
        projectId: schema.projectGroupProject.projectId,
        projectName: schema.project.name,
      })
      .from(schema.projectGroupProject)
      .leftJoin(schema.project, eq(schema.projectGroupProject.projectId, schema.project.id))
      .where(
        and(
          eq(schema.projectGroupProject.tenantId, tid),
          inArray(schema.projectGroupProject.projectGroupId, groups.map((g) => g.id)),
        ),
      );
    const users = await ctx.db
      .select({
        projectGroupId: schema.projectGroupUser.projectGroupId,
        userId: schema.projectGroupUser.userId,
        email: schema.user.email,
        name: schema.user.firstName,
      })
      .from(schema.projectGroupUser)
      .leftJoin(schema.user, eq(schema.projectGroupUser.userId, schema.user.id))
      .where(
        and(
          eq(schema.projectGroupUser.tenantId, tid),
          inArray(schema.projectGroupUser.projectGroupId, groups.map((g) => g.id)),
        ),
      );

    return groups.map((g) => ({
      ...g,
      projects: memberships
        .filter((m) => m.projectGroupId === g.id)
        .map((m) => ({ id: m.projectId, name: m.projectName ?? "Unknown" })),
      users: users
        .filter((u) => u.projectGroupId === g.id)
        .map((u) => ({ id: u.userId, email: u.email ?? "—", name: u.name ?? "" })),
    }));
  }),

  create: requirePermission("project.manage")
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(300).optional(),
        projectIds: z.array(z.string().uuid()).default([]),
        userIds: z.array(z.string().uuid()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const [group] = await ctx.db
        .insert(schema.projectGroup)
        .values({ tenantId: tid, name: input.name, description: input.description ?? null })
        .returning();
      if (!group) throw new Error("Could not create the job group");

      if (input.projectIds.length) {
        await ctx.db.insert(schema.projectGroupProject).values(
          input.projectIds.map((projectId) => ({ tenantId: tid, projectGroupId: group.id, projectId })),
        );
      }
      if (input.userIds.length) {
        await ctx.db.insert(schema.projectGroupUser).values(
          input.userIds.map((userId) => ({ tenantId: tid, projectGroupId: group.id, userId })),
        );
      }

      await logEvent(ctx, {
        category: "project",
        action: "projectGroup.create",
        entityType: "projectGroup",
        entityId: group.id,
        entityLabel: group.name,
        details: { projectCount: input.projectIds.length, userCount: input.userIds.length },
      });
      return group;
    }),

  update: requirePermission("project.manage")
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(80).optional(), description: z.string().max(300).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.projectGroup.findFirst({
        where: and(eq(schema.projectGroup.id, input.id), eq(schema.projectGroup.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such job group" });
      const patch = Object.fromEntries(
        Object.entries({ name: input.name, description: input.description }).filter(([, v]) => v !== undefined),
      );
      if (!Object.keys(patch).length) return existing;
      const [row] = await ctx.db
        .update(schema.projectGroup)
        .set(patch)
        .where(eq(schema.projectGroup.id, input.id))
        .returning();
      return row;
    }),

  delete: requirePermission("project.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.projectGroup.findFirst({
        where: and(eq(schema.projectGroup.id, input.id), eq(schema.projectGroup.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such job group" });
      await ctx.db.delete(schema.projectGroup).where(eq(schema.projectGroup.id, input.id));
      await logEvent(ctx, {
        category: "project",
        action: "projectGroup.delete",
        entityType: "projectGroup",
        entityId: input.id,
        entityLabel: existing.name,
      });
      return { ok: true };
    }),

  /* Replace the job membership of a group. */
  setProjects: requirePermission("project.manage")
    .input(z.object({ id: z.string().uuid(), projectIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.projectGroup.findFirst({
        where: and(eq(schema.projectGroup.id, input.id), eq(schema.projectGroup.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such job group" });
      await ctx.db
        .delete(schema.projectGroupProject)
        .where(eq(schema.projectGroupProject.projectGroupId, input.id));
      if (input.projectIds.length) {
        await ctx.db.insert(schema.projectGroupProject).values(
          input.projectIds.map((projectId) => ({ tenantId: tid, projectGroupId: input.id, projectId })),
        );
      }
      return { ok: true, projectCount: input.projectIds.length };
    }),

  /* Replace who can see a group. */
  setUsers: requirePermission("project.manage")
    .input(z.object({ id: z.string().uuid(), userIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.projectGroup.findFirst({
        where: and(eq(schema.projectGroup.id, input.id), eq(schema.projectGroup.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such job group" });
      await ctx.db
        .delete(schema.projectGroupUser)
        .where(eq(schema.projectGroupUser.projectGroupId, input.id));
      if (input.userIds.length) {
        await ctx.db.insert(schema.projectGroupUser).values(
          input.userIds.map((userId) => ({ tenantId: tid, projectGroupId: input.id, userId })),
        );
      }
      return { ok: true, userCount: input.userIds.length };
    }),

  /* The people a group can be handed to — active login accounts. */
  userOptions: requirePermission("project.manage").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const rows = await ctx.db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        firstName: schema.user.firstName,
        lastName: schema.user.lastName,
      })
      .from(schema.user)
      .where(and(eq(schema.user.tenantId, tid), eq(schema.user.isActive, true)))
      .orderBy(schema.user.firstName);
    return rows.map((u) => ({ id: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() }));
  }),
});
