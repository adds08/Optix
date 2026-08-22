import { and, eq } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, router } from "../trpc.js";

export const identityRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    const u = await ctx.db.query.user.findFirst({
      /* The tenant predicate is not decoration even though `session.userId` is
         trusted and unique: the PAIR is what proves the row belongs to the
         tenant this session is acting in, and CLAUDE.md non-negotiable 3 is a
         rule with no exceptions precisely so nobody has to work out which
         lookups are safe without one (STI-119). */
      where: and(eq(schema.user.id, ctx.session.userId), eq(schema.user.tenantId, ctx.session.tenantId)),
      columns: {
        id: true, email: true, firstName: true, lastName: true, tenantId: true, employeeId: true,
        /*
          STI-303 shipped `must_change_password` and reported it from
          `login()`, but nothing on any client read it — the flag was set on
          every created and reset account and then ignored, so "you must change
          your password" was true and unenforceable.

          It belongs HERE rather than only in the login response because a
          session outlives the login call: an administrator resetting a
          password mid-session must reach that user on their next page load,
          not only if they happen to sign in again.
        */
        mustChangePassword: true,
      },
    });
    if (!u) return null;
    return {
      ...u,
      role: ctx.session.roleName ?? null,
      permissions: Array.from(ctx.session.permissions),
    };
  }),
});
