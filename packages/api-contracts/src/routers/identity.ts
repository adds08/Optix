import { eq } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, router } from "../trpc.js";

export const identityRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    const u = await ctx.db.query.user.findFirst({
      where: eq(schema.user.id, ctx.session.userId),
      columns: { id: true, email: true, firstName: true, lastName: true, tenantId: true, employeeId: true },
    });
    if (!u) return null;
    return {
      ...u,
      role: ctx.session.roleName ?? null,
      permissions: Array.from(ctx.session.permissions),
    };
  }),
});
