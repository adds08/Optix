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

/* Must stay in step with the catalog in the web app's `lib/themes/themes.ts`
   — this enum is what stops an unknown theme reaching the preferences row. */
export const THEME_NAMES = [
  "drafting-ink",
  "blocky",
  "field-amber",
  "concrete",
  "blueprint",
  "forest",
  "clay",
  "graphite",
  "high-contrast",
  "site-green",
  "site-cream",
  "site-slate",
  "hi-vis",
] as const;
export const FONT_FAMILIES = ["system", "serif", "mono"] as const;

const prefsInput = z.object({
  themeName: z.enum(THEME_NAMES),
  fontFamily: z.enum(FONT_FAMILIES),
  fontScale: z.string().regex(/^(0\.\d|1|1\.\d|2)$/),
  density: z.enum(["comfortable", "compact"]),
  dashboard: z.object({
    widgets: z.record(z.string(), z.boolean()),
    /* The Desk (STI-501) is a ROUTE, not a tab — it is at /desk and appears in
       both navs — so it deliberately does not belong in this enum. A dashboard
       tab preference names one of the two dashboard tabs and nothing else. */
    defaultTab: z.enum(["fleet", "command"]).optional(),
  }),
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
        themeName: "blocky" as const,
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
        .where(and(eq(schema.userPreferences.id, existing.id), eq(schema.userPreferences.tenantId, tid)));
    } else {
      await ctx.db.insert(schema.userPreferences).values({ tenantId: tid, userId: uid, ...input });
    }
    return { ok: true };
  }),
});
