import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

/*
  Tool categories, finally backed by the table that was always there.

  The `category` table has existed and been seeded since the first commit, and
  nothing ever read it. What actually drove every dropdown was
  `asset.category_name` — a free-text column marked `// denormalized` — with the
  register deriving its filter list from whatever distinct strings happened to be
  sitting on tools.

  That is why nobody could "create" a category: typing a new string on a tool
  created one, and deleting the last tool using it destroyed one. There was no
  object to manage, so there was no screen to manage it.

  The denormalised column stays. It is what reports read, it survives a category
  being renamed out from under old rows, and changing it would mean a migration
  across the whole register for no gain. What changes is that the *list* now
  comes from a real table an admin owns, unioned with anything already in use so
  that turning this on cannot make an existing category vanish from the filters.
*/

/** Distinct category names actually written on tools, with how many use each. */
async function inUse(db: any, tenantId: string) {
  return db
    .select({
      name: schema.asset.categoryName,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.asset)
    .where(and(eq(schema.asset.tenantId, tenantId), sql`${schema.asset.categoryName} is not null`))
    .groupBy(schema.asset.categoryName);
}

export const categoryRouter = router({
  /*
    Everything a dropdown needs: the managed list, plus any name a tool already
    carries that nobody has added to the table yet.

    `inUseOnly` names the second kind. Those are not errors — they are what the
    importer and the seed produced before this table was wired up — but the desk
    should be able to see which of its categories are ad-hoc.
  */
  list: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;

    const [managed, used] = await Promise.all([
      ctx.db
        .select({ id: schema.category.id, name: schema.category.name })
        .from(schema.category)
        .where(eq(schema.category.tenantId, tid))
        .orderBy(asc(schema.category.name)),
      inUse(ctx.db, tid),
    ]);

    const countByName = new Map<string, number>(
      used.map((r: any) => [String(r.name), Number(r.count)] as const),
    );
    const managedNames = new Set(managed.map((c: any) => c.name as string));

    const rows: { id: string | null; name: string; assetCount: number; managed: boolean }[] = [
      ...managed.map((c: any) => ({
        id: c.id as string,
        name: c.name as string,
        assetCount: countByName.get(c.name) ?? 0,
        managed: true,
      })),
      ...[...countByName.entries()]
        .filter(([name]) => !managedNames.has(name))
        .map(([name, count]) => ({
          id: null,
          name,
          assetCount: count,
          managed: false,
        })),
    ];

    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }),

  create: requirePermission("asset.manage")
    .input(z.object({ name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const name = input.name.trim();
      if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "A category needs a name." });

      /* Case-insensitive, because "Power tools" and "Power Tools" as two
         entries is precisely the mess this table exists to end. */
      const clash = await ctx.db
        .select({ id: schema.category.id })
        .from(schema.category)
        .where(and(eq(schema.category.tenantId, tid), sql`lower(${schema.category.name}) = lower(${name})`))
        .limit(1);
      if (clash.length) {
        throw new TRPCError({ code: "CONFLICT", message: `"${name}" already exists.` });
      }

      const [row] = await ctx.db
        .insert(schema.category)
        .values({ tenantId: tid, name })
        .returning();

      await logEvent(ctx, {
        category: "asset",
        action: "category.create",
        entityType: "category",
        entityId: row?.id ?? null,
        entityLabel: name,
      });
      return row;
    }),

  /*
    Renaming carries the tools with it.

    The denormalised name on every asset is updated in the same transaction, so
    the register never shows a category that no longer exists. Without that,
    renaming would orphan every tool onto a dead string — the exact failure the
    free-text approach already had.
  */
  rename: requirePermission("asset.manage")
    .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const name = input.name.trim();

      const existing = await ctx.db.query.category.findFirst({
        where: and(eq(schema.category.id, input.id), eq(schema.category.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such category." });
      if (existing.name === name) return existing;

      await ctx.db.transaction(async (tx: any) => {
        await tx
          .update(schema.category)
          .set({ name })
          .where(and(eq(schema.category.id, input.id), eq(schema.category.tenantId, tid)));
        await tx
          .update(schema.asset)
          .set({ categoryName: name, updatedAt: new Date() })
          .where(and(eq(schema.asset.tenantId, tid), eq(schema.asset.categoryName, existing.name)));
      });

      await logEvent(ctx, {
        category: "asset",
        action: "category.rename",
        entityType: "category",
        entityId: input.id,
        entityLabel: name,
        details: { from: existing.name, to: name },
      });
      return { ...existing, name };
    }),

  /*
    Refuses while tools still carry the name.

    Same posture as the other registers: "you can't, and here is why" beats a
    button that silently leaves the tools pointing at nothing. Reassigning them
    first is a deliberate act, not something a delete should do quietly.
  */
  delete: requirePermission("asset.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.category.findFirst({
        where: and(eq(schema.category.id, input.id), eq(schema.category.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such category." });

      const [{ count } = { count: 0 }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.asset)
        .where(and(eq(schema.asset.tenantId, tid), eq(schema.asset.categoryName, existing.name)));

      if (Number(count) > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${count} tool${Number(count) === 1 ? "" : "s"} still in "${existing.name}". Move them to another category first.`,
        });
      }

      await ctx.db.delete(schema.category).where(and(eq(schema.category.id, input.id), eq(schema.category.tenantId, tid)));
      await logEvent(ctx, {
        category: "asset",
        action: "category.delete",
        entityType: "category",
        entityId: input.id,
        entityLabel: existing.name,
      });
      return { ok: true };
    }),

  /*
    Pull the ad-hoc names into the managed table in one go.

    Every tenant starts with a register full of strings that arrived by import.
    Making the desk retype each one to "adopt" it would be busywork with a
    typo in it.
  */
  adoptInUse: requirePermission("asset.manage").mutation(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const [managed, used] = await Promise.all([
      ctx.db
        .select({ name: schema.category.name })
        .from(schema.category)
        .where(eq(schema.category.tenantId, tid)),
      inUse(ctx.db, tid),
    ]);
    const have = new Set(managed.map((c: any) => (c.name as string).toLowerCase()));
    const missing = used
      .map((r: any) => r.name as string)
      .filter((n: string) => n && !have.has(n.toLowerCase()));

    if (!missing.length) return { added: 0 };
    await ctx.db.insert(schema.category).values(missing.map((name: string) => ({ tenantId: tid, name })));

    await logEvent(ctx, {
      category: "asset",
      action: "category.adopt",
      entityType: "category",
      details: { added: missing },
    });
    return { added: missing.length };
  }),
});
