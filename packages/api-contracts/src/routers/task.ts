import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

export const taskRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const conditions = [eq(schema.task.tenantId, tid)];
      if (input?.status) conditions.push(eq(schema.task.status, input.status));

      const rows = await ctx.db
        .select({
          id: schema.task.id,
          title: schema.task.title,
          description: schema.task.description,
          status: schema.task.status,
          priority: schema.task.priority,
          assignedToEmployeeId: schema.task.assignedToEmployeeId,
          createdByUserId: schema.task.createdByUserId,
          relatedAssetId: schema.task.relatedAssetId,
          relatedProjectId: schema.task.relatedProjectId,
          source: schema.task.source,
          sourceMessageId: schema.task.sourceMessageId,
          dueDate: schema.task.dueDate,
          completedAt: schema.task.completedAt,
          createdAt: schema.task.createdAt,
          updatedAt: schema.task.updatedAt,
        })
        .from(schema.task)
        .where(and(...conditions))
        .orderBy(desc(schema.task.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);

      const [countResult] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(schema.task)
        .where(and(...conditions));

      return { items: rows, total: Number(countResult?.count ?? 0) };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const row = await ctx.db.query.task.findFirst({
        where: and(eq(schema.task.id, input.id), eq(schema.task.tenantId, tid)),
      });
      if (!row) throw new Error("Task not found");
      return row;
    }),

  create: requirePermission("assignment.create")
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).default("pending"),
        priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
        assignedToEmployeeId: z.string().uuid().optional(),
        relatedAssetId: z.string().uuid().optional(),
        relatedProjectId: z.string().uuid().optional(),
        dueDate: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const [row] = await ctx.db
        .insert(schema.task)
        .values({
          tenantId: tid,
          title: input.title,
          description: input.description ?? null,
          status: input.status,
          priority: input.priority,
          assignedToEmployeeId: input.assignedToEmployeeId ?? null,
          createdByUserId: ctx.session.userId,
          relatedAssetId: input.relatedAssetId ?? null,
          relatedProjectId: input.relatedProjectId ?? null,
          source: "manual",
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        })
        .returning();

      await logEvent(ctx, {
        category: "task",
        action: "create",
        entityType: "task",
        entityId: row!.id,
        details: { title: input.title },
      });

      return row;
    }),

  update: requirePermission("assignment.create")
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        assignedToEmployeeId: z.string().uuid().nullable().optional(),
        relatedAssetId: z.string().uuid().nullable().optional(),
        relatedProjectId: z.string().uuid().nullable().optional(),
        dueDate: z.string().datetime().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.task.findFirst({
        where: and(eq(schema.task.id, input.id), eq(schema.task.tenantId, tid)),
      });
      if (!existing) throw new Error("Task not found");

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.description !== undefined) updates.description = input.description;
      if (input.status !== undefined) updates.status = input.status;
      if (input.priority !== undefined) updates.priority = input.priority;
      if (input.assignedToEmployeeId !== undefined) updates.assignedToEmployeeId = input.assignedToEmployeeId;
      if (input.relatedAssetId !== undefined) updates.relatedAssetId = input.relatedAssetId;
      if (input.relatedProjectId !== undefined) updates.relatedProjectId = input.relatedProjectId;
      if (input.dueDate !== undefined) updates.dueDate = input.dueDate ? new Date(input.dueDate) : null;
      if (input.status === "completed" && existing.status !== "completed") {
        updates.completedAt = new Date();
      }
      if (existing.status === "completed" && input.status && input.status !== "completed") {
        updates.completedAt = null;
      }

      const [row] = await ctx.db
        .update(schema.task)
        .set(updates)
        .where(and(eq(schema.task.id, input.id), eq(schema.task.tenantId, tid)))
        .returning();

      await logEvent(ctx, {
        category: "task",
        action: "update",
        entityType: "task",
        entityId: input.id,
        details: { changes: Object.keys(updates) },
      });

      return row;
    }),

  delete: requirePermission("assignment.create")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.task.findFirst({
        where: and(eq(schema.task.id, input.id), eq(schema.task.tenantId, tid)),
      });
      if (!existing) throw new Error("Task not found");

      await ctx.db
        .delete(schema.task)
        .where(and(eq(schema.task.id, input.id), eq(schema.task.tenantId, tid)));

      await logEvent(ctx, {
        category: "task",
        action: "delete",
        entityType: "task",
        entityId: input.id,
      });

      return { ok: true };
    }),
});
