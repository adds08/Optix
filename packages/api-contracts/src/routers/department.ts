import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

export const departmentRouter = router({
  list: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: schema.department.id,
          name: schema.department.name,
          code: schema.department.code,
          isActive: schema.department.isActive,
        })
        .from(schema.department)
        .where(
          and(
            eq(schema.department.tenantId, ctx.session.tenantId),
            input?.includeInactive ? undefined : eq(schema.department.isActive, true),
          ),
        )
        .orderBy(asc(schema.department.name));
    }),

  create: requirePermission("department.manage")
    .input(
      z.object({
        name: z.string().min(1).max(120),
        code: z.string().max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.department)
        .values({ tenantId: ctx.session.tenantId, ...input })
        .returning();
      if (row) await logEvent(ctx, { category: "department", action: "create", entityType: "department", entityId: row.id, entityLabel: row.name });
      return row;
    }),

  update: requirePermission("department.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        code: z.string().max(20).nullable().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const { id, ...changes } = input;
      const existing = await ctx.db.query.department.findFirst({
        where: and(eq(schema.department.id, id), eq(schema.department.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such department in this tenant" });

      const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length) return existing;

      const [row] = await ctx.db
        .update(schema.department)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(schema.department.id, id), eq(schema.department.tenantId, tid)))
        .returning();

      await logEvent(ctx, {
        category: "department", action: "update", entityType: "department",
        entityId: id, entityLabel: row?.name ?? existing.name,
        details: { changed: Object.keys(patch) },
      });
      return row;
    }),
});
