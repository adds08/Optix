import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, router } from "../trpc.js";

/*
  Per-user appearance + dashboard preferences (docs/19).

  The theme catalog is the source of truth for what is valid: the router
  validates against it, so a stale client can never write a theme name the
  CSS does not know. `preferences.get` upserts nothing — it returns the row
  or a clean default, and the client hydrates from there.
*/

export const THEME_NAMES = ["drafting-ink", "field-amber", "concrete"] as const;
export const FONT_FAMILIES = ["system", "serif", "mono"] as const;

const prefsInput = z.object({
  themeName: z.enum(THEME_NAMES),
  fontFamily: z.enum(FONT_FAMILIES),
  fontScale: z.string().regex(/^(0\.\d|1|1\.\d|2)$/),
  density: z.enum(["comfortable", "compact"]),
  dashboard: z.object({ widgets: z.record(z.string(), z.boolean()) }),
});

export const preferencesRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const uid = ctx.session.userId;
    const row = await ctx.db.query.userPreferences.findFirst({
      where: and(eq(schema.userPreferences.tenantId, tid), eq(schema.userPreferences.userId, uid)),
    });
    if (!row) {
      return {
        themeName: "drafting-ink" as const,
        fontFamily: "system" as const,
        fontScale: "1.0",
        density: "comfortable" as const,
        dashboard: { widgets: {} },
      };
    }
    return {
      themeName: row.themeName,
      fontFamily: row.fontFamily,
      fontScale: row.fontScale,
      density: row.density,
      dashboard: row.dashboard,
    };
  }),

  set: protectedProcedure.input(prefsInput).mutation(async ({ ctx, input }) => {
    const tid = ctx.session.tenantId;
    const uid = ctx.session.userId;
    const existing = await ctx.db.query.userPreferences.findFirst({
      where: and(eq(schema.userPreferences.tenantId, tid), eq(schema.userPreferences.userId, uid)),
    });
    if (existing) {
      await ctx.db
        .update(schema.userPreferences)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.userPreferences.id, existing.id));
    } else {
      await ctx.db.insert(schema.userPreferences).values({ tenantId: tid, userId: uid, ...input });
    }
    return { ok: true };
  }),
});
