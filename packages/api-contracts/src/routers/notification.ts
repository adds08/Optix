import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router } from "../trpc.js";

export const notificationRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const empId = ctx.session.employeeId;
    return ctx.db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.tenantId, tid),
          empId ? eq(schema.notification.recipientEmployeeId, empId) : eq(schema.notification.tenantId, tid),
        ),
      )
      .orderBy(schema.notification.createdAt);
  }),

  all: requirePermission("notification.manage").query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.tenantId, ctx.session.tenantId))
      .orderBy(schema.notification.createdAt);
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.notification)
        .set({ readAt: new Date() })
        .where(and(eq(schema.notification.id, input.id), eq(schema.notification.tenantId, ctx.session.tenantId)));
      return { ok: true };
    }),
});
