import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { formatAssetModel } from "@stinventory/types";
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
          make: schema.asset.make,
          modelNumber: schema.asset.modelNumber,
          description: schema.asset.description,
          eventType: schema.transaction.eventType,
          occurredAt: schema.transaction.occurredAt,
          note: schema.transaction.note,
          fromState: schema.transaction.fromState,
          toState: schema.transaction.toState,
          refType: schema.transaction.refType,
          actorName: schema.user.firstName,
          /*
            The custodian ids live inside the state snapshots as raw uuids, so
            every row rendered as "transfer · UIC-090 · via transfer" and the
            reader could not tell which foreman gave what to whom — the one
            question an activity log exists to answer.

            Resolved as scalar subqueries rather than two more joins: the ids
            are inside jsonb, so joining on them means casting in the ON clause
            and two more aliases of `employee` for a feed that reads 200 rows.
          */
          fromCustodianName: sql<string | null>`(
            select name from employee
            where id = (${schema.transaction.fromState} ->> 'custodianId')::uuid
          )`,
          toCustodianName: sql<string | null>`(
            select name from employee
            where id = (${schema.transaction.toState} ->> 'custodianId')::uuid
          )`,
        })
        .from(schema.transaction)
        .innerJoin(schema.asset, eq(schema.transaction.assetId, schema.asset.id))
        .leftJoin(schema.user, eq(schema.transaction.actorId, schema.user.id))
        .where(where)
        .orderBy(sql`${schema.transaction.occurredAt} DESC, ${schema.transaction.id} DESC`)
        .limit(input?.limit ?? 50);
    }),
});
