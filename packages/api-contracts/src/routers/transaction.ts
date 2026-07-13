import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, router } from "../trpc.js";

export const transactionRouter = router({
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      return ctx.db
        .select({
          id: schema.transaction.id,
          assetId: schema.transaction.assetId,
          tag: schema.asset.tag,
          modelName: schema.asset.modelName,
          eventType: schema.transaction.eventType,
          occurredAt: schema.transaction.occurredAt,
          note: schema.transaction.note,
        })
        .from(schema.transaction)
        .innerJoin(schema.asset, eq(schema.transaction.assetId, schema.asset.id))
        .where(eq(schema.transaction.tenantId, tid))
        .orderBy(sql`${schema.transaction.occurredAt} DESC, ${schema.transaction.id} DESC`)
        .limit(input?.limit ?? 50);
    }),
});
