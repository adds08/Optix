import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, router } from "../trpc.js";

export const transactionRouter = router({
  // Append-only event feed. Pass `assetId` to get one tool's custody chain —
  // that chain IS the audit trail, so nothing here is filtered or redacted.
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          assetId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const where = input?.assetId
        ? and(eq(schema.transaction.tenantId, tid), eq(schema.transaction.assetId, input.assetId))
        : eq(schema.transaction.tenantId, tid);

      return ctx.db
        .select({
          id: schema.transaction.id,
          assetId: schema.transaction.assetId,
          tag: schema.asset.tag,
          modelName: schema.asset.modelName,
          eventType: schema.transaction.eventType,
          occurredAt: schema.transaction.occurredAt,
          note: schema.transaction.note,
          fromState: schema.transaction.fromState,
          toState: schema.transaction.toState,
          refType: schema.transaction.refType,
          actorName: schema.user.firstName,
        })
        .from(schema.transaction)
        .innerJoin(schema.asset, eq(schema.transaction.assetId, schema.asset.id))
        .leftJoin(schema.user, eq(schema.transaction.actorId, schema.user.id))
        .where(where)
        .orderBy(sql`${schema.transaction.occurredAt} DESC, ${schema.transaction.id} DESC`)
        .limit(input?.limit ?? 50);
    }),
});
