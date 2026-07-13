import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { requiresCustodyApproval } from "@stinventory/domain";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

export const transferRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    return ctx.db
      .select({
        id: schema.transfer.id,
        assetId: schema.transfer.assetId,
        tag: schema.asset.tag,
        modelName: schema.asset.modelName,
        fromCustodianId: schema.transfer.fromCustodianId,
        toCustodianId: schema.transfer.toCustodianId,
        reason: schema.transfer.reason,
        status: schema.transfer.status,
        createdAt: schema.transfer.createdAt,
        completedAt: schema.transfer.completedAt,
      })
      .from(schema.transfer)
      .innerJoin(schema.asset, eq(schema.transfer.assetId, schema.asset.id))
      .where(eq(schema.transfer.tenantId, tid));
  }),

  create: requirePermission("transfer.create")
    .input(
      z.object({
        assetId: z.string().uuid(),
        toCustodianId: z.string().uuid(),
        toLocationId: z.string().uuid().optional(),
        toProjectId: z.string().uuid().optional(),
        reason: z.string().default("reallocation"),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const asset = await ctx.db.query.asset.findFirst({
        where: and(eq(schema.asset.id, input.assetId), eq(schema.asset.tenantId, tid)),
      });
      if (!asset) throw new Error("Asset not found");

      const settings = await ctx.db.query.tenantSettings.findFirst({ where: eq(schema.tenantSettings.tenantId, tid) });
      const needsApproval = requiresCustodyApproval({
        fromCustodianId: asset.currentCustodianId,
        toCustodianId: input.toCustodianId,
        assetCost: asset.acquisitionCost ? Number(asset.acquisitionCost) : null,
        highValueThreshold: settings?.highValueThreshold ?? null,
      });

      const status = needsApproval ? "pending_approval" : "approved";
      const [row] = await ctx.db
        .insert(schema.transfer)
        .values({
          tenantId: tid,
          assetId: input.assetId,
          fromCustodianId: asset.currentCustodianId,
          toCustodianId: input.toCustodianId,
          fromLocationId: asset.currentLocationId,
          toLocationId: input.toLocationId ?? null,
          fromProjectId: asset.currentProjectId,
          toProjectId: input.toProjectId ?? null,
          reason: input.reason,
          status,
          requestedBy: ctx.session.userId,
          approvedBy: needsApproval ? null : ctx.session.userId,
        })
        .returning();

      if (row && !needsApproval) {
        // Auto-approved: apply the transfer immediately.
        await ctx.db
          .update(schema.asset)
          .set({
            currentCustodianId: input.toCustodianId,
            currentLocationId: input.toLocationId ?? asset.currentLocationId,
            currentProjectId: input.toProjectId ?? asset.currentProjectId,
            updatedAt: new Date(),
          })
          .where(eq(schema.asset.id, input.assetId));
        await ctx.db
          .update(schema.transfer)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(schema.transfer.id, row.id));
        await ctx.db.insert(schema.transaction).values({
          tenantId: tid,
          assetId: input.assetId,
          eventType: "transfer",
          actorId: ctx.session.userId,
          fromState: { status: asset.currentStatus, custodianId: asset.currentCustodianId, projectId: asset.currentProjectId, locationId: asset.currentLocationId },
          toState: { status: "assigned", custodianId: input.toCustodianId, projectId: input.toProjectId ?? null, locationId: input.toLocationId ?? null },
          refType: "transfer",
          refId: row.id,
          note: input.note ?? "Transfer completed",
        });
      }
      if (row) await logEvent(ctx, { category: "transfer", action: "create", entityType: "transfer", entityId: row.id, details: { needsApproval } });
      return { transfer: row, needsApproval };
    }),

  approve: requirePermission("transfer.approve")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tr = await ctx.db.query.transfer.findFirst({
        where: and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, ctx.session.tenantId)),
      });
      if (!tr) throw new Error("Transfer not found");
      await ctx.db
        .update(schema.transfer)
        .set({ status: "completed", approvedBy: ctx.session.userId, completedAt: new Date() })
        .where(eq(schema.transfer.id, input.id));
      await ctx.db
        .update(schema.asset)
        .set({
          currentCustodianId: tr.toCustodianId,
          currentLocationId: tr.toLocationId,
          currentProjectId: tr.toProjectId,
          updatedAt: new Date(),
        })
        .where(eq(schema.asset.id, tr.assetId));
      await ctx.db.insert(schema.transaction).values({
        tenantId: ctx.session.tenantId,
        assetId: tr.assetId,
        eventType: "transfer",
        actorId: ctx.session.userId,
        toState: { status: "assigned", custodianId: tr.toCustodianId, projectId: tr.toProjectId, locationId: tr.toLocationId },
        refType: "transfer",
        refId: tr.id,
        note: "Transfer approved",
      });
      return { ok: true };
    }),
});
