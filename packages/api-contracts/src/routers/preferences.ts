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
  /* Icons are multiplied separately from type — see the column comment in
     `schema/identity.ts`. Same shape of value, same permissive-but-bounded
     pattern, so a stale client cannot write `scale(9999)` into a style. */
  iconScale: z.string().regex(/^(0\.\d|1|1\.\d|2)$/),
  density: z.enum(["comfortable", "compact"]),
  dashboard: z.object({
    widgets: z.record(z.string(), z.boolean()),
    /* The dashboard-tab preference named one of the two old widget-dashboard
       tabs (Fleet / Command Center) and deliberately nothing else. Both the
       Desk — once a separate /desk route, removed 2026-09-03 — and the old
       dashboard itself are gone; the field is retained for stored rows. */
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
        iconScale: "1.0",
        density: "comfortable" as const,
        dashboard: { widgets: {} },
      };
    }
    return {
      themeName: row.themeName,
      fontFamily: row.fontFamily,
      fontScale: row.fontScale,
      iconScale: row.iconScale,
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
