import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { FEATURE_STATES } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

/*
  Tenant-level feature presentation — see packages/db/src/schema/feature.ts
  for why this is a table rather than a jsonb bag, and ADR-11 in
  docs/06-decisions.md for the binary predecessor this generalizes.

  `states` is deliberately a plain `protectedProcedure`: every signed-in
  person needs it to know what their own nav should show, the same way
  `identity.me`'s permissions are read by anyone. `set` is the
  administrative half, gated exactly like `settings.update`.
*/
export const featureRouter = router({
  states: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ key: schema.tenantFeature.key, state: schema.tenantFeature.state })
      .from(schema.tenantFeature)
      .where(eq(schema.tenantFeature.tenantId, ctx.session.tenantId));
    /* No row for a key means enabled — the default has to be the common
       case, or every tenant that existed before a key was invented would
       silently lose whatever it named. */
    return Object.fromEntries(rows.map((r) => [r.key, r.state])) as Record<string, string>;
  }),

  set: requirePermission("config.manage")
    .input(z.object({ key: z.string().min(1).max(120), state: z.enum(FEATURE_STATES) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.tenantFeature.findFirst({
        where: and(eq(schema.tenantFeature.tenantId, tid), eq(schema.tenantFeature.key, input.key)),
      });
      if (existing) {
        await ctx.db
          .update(schema.tenantFeature)
          .set({ state: input.state, updatedAt: new Date() })
          .where(eq(schema.tenantFeature.id, existing.id));
      } else {
        await ctx.db.insert(schema.tenantFeature).values({ tenantId: tid, key: input.key, state: input.state });
      }
      await logEvent(ctx, {
        category: "system",
        action: "feature.set",
        entityType: "tenant_feature",
        entityId: input.key,
        details: { key: input.key, state: input.state },
      });
      return { ok: true as const };
    }),
});
