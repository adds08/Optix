import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { requiresCustodyApproval } from "@stinventory/domain";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { moveCustody } from "../custody.js";
import { notifyCustodyDecision } from "../notify.js";

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
        /* Close the link the previous holder had and open the new one. Without
           this the register shows the new holder while the custody screen still
           shows the old — see packages/api-contracts/src/custody.ts. */
        await moveCustody(ctx.db, {
          tenantId: tid,
          assetId: input.assetId,
          toCustodianId: input.toCustodianId,
          projectId: input.toProjectId ?? asset.currentProjectId ?? null,
          locationId: input.toLocationId ?? asset.currentLocationId ?? null,
          actorUserId: ctx.session.userId,
        });
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
      await moveCustody(ctx.db, {
        tenantId: ctx.session.tenantId,
        assetId: tr.assetId,
        toCustodianId: tr.toCustodianId,
        projectId: tr.toProjectId,
        locationId: tr.toLocationId,
        actorUserId: ctx.session.userId,
      });
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

      /* Close the loop. Whoever asked for this hand-off, and whoever is now
         holding the tool, both need to hear that it went through. */
      const asset = await ctx.db.query.asset.findFirst({ where: eq(schema.asset.id, tr.assetId) });
      await notifyCustodyDecision(ctx.db, {
        tenantId: ctx.session.tenantId,
        requestedByUserId: tr.requestedBy,
        toCustodianId: tr.toCustodianId,
        fromCustodianId: tr.fromCustodianId,
        refType: "transfer",
        refId: tr.id,
        assetTag: asset?.tag ?? "a tool",
        approved: true,
      });

      await logEvent(ctx, {
        category: "transfer",
        action: "approve",
        entityType: "transfer",
        entityId: tr.id,
        entityLabel: asset?.tag ?? null,
      });
      return { ok: true };
    }),

  /* The other half of the gate. Cancelling records that a hand-off was put up
     and refused, which deleting the row would not. */
  decline: requirePermission("transfer.approve")
    .input(z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const tr = await ctx.db.query.transfer.findFirst({
        where: and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, tid)),
      });
      if (!tr) throw new Error("Transfer not found");
      if (tr.status !== "pending_approval") {
        throw new Error(`This transfer is already ${tr.status}`);
      }

      await ctx.db
        .update(schema.transfer)
        .set({ status: "cancelled", approvedBy: ctx.session.userId, updatedAt: new Date() })
        .where(eq(schema.transfer.id, input.id));

      /* Nothing moved, so the asset projection is untouched — but the refusal
         belongs in the tool's history, since "why is this still with Miguel?"
         is answered here. */
      const asset = await ctx.db.query.asset.findFirst({ where: eq(schema.asset.id, tr.assetId) });
      if (asset) {
        const state = {
          status: asset.currentStatus,
          custodianId: asset.currentCustodianId,
          projectId: asset.currentProjectId,
          locationId: asset.currentLocationId,
        };
        await ctx.db.insert(schema.transaction).values({
          tenantId: tid,
          assetId: tr.assetId,
          eventType: "status_change",
          actorId: ctx.session.userId,
          fromState: state,
          toState: state,
          refType: "transfer",
          refId: tr.id,
          note: input.reason ? `Transfer declined — ${input.reason}` : "Transfer declined",
        });
      }

      /* The refusal is the half that was missing entirely: a declined hand-off
         used to end at the database row, so the foreman who asked for it never
         found out, and the tool "not going back" looked like a bug. */
      await notifyCustodyDecision(ctx.db, {
        tenantId: tid,
        requestedByUserId: tr.requestedBy,
        toCustodianId: tr.toCustodianId,
        fromCustodianId: tr.fromCustodianId,
        refType: "transfer",
        refId: tr.id,
        assetTag: asset?.tag ?? "a tool",
        approved: false,
        reason: input.reason ?? null,
      });

      await logEvent(ctx, {
        category: "transfer",
        action: "decline",
        entityType: "transfer",
        entityId: tr.id,
        entityLabel: asset?.tag ?? null,
        details: { reason: input.reason ?? null },
      });
      return { ok: true };
    }),
});
