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

  /*
    Marking YOUR OWN alert read. Deliberately bare of a permission — gating it
    would mean the people who receive alerts could not clear them — but not
    bare of a scope.

    It used to match on `(id, tenantId)` alone, so any signed-in account could
    mark any other account's alert read by id: an overdue-tool alert a
    superintendent had not seen yet could be silently cleared by somebody who
    never received it. Found by STI-308's "every mutation carries a permission"
    walk, which is the point of walking the tree rather than a list.

    An account with no employee record receives no alerts, so it can clear
    none — `recipientEmployeeId` is never null on a delivered row.
  */
  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const empId = ctx.session.employeeId;
      if (!empId) return { ok: true };
      await ctx.db
        .update(schema.notification)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(schema.notification.id, input.id),
            eq(schema.notification.tenantId, ctx.session.tenantId),
            eq(schema.notification.recipientEmployeeId, empId),
          ),
        );
      return { ok: true };
    }),
});
