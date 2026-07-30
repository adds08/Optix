import { TRPCError } from "@trpc/server";
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

      /*
        One open hand-off per tool.

        Nothing stopped a second identical transfer being raised while the first
        was still waiting, and the desk got two rows for one physical event —
        approve one and the other stays in the queue forever, pointing at a
        hand-off that already happened. Easy to hit by tapping twice on bad
        signal, which is the normal condition in a yard.
      */
      const openTransfer = await ctx.db.query.transfer.findFirst({
        where: and(
          eq(schema.transfer.tenantId, tid),
          eq(schema.transfer.assetId, input.assetId),
          eq(schema.transfer.status, "pending_approval"),
        ),
      });
      if (openTransfer) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This tool already has a transfer waiting for approval at the equipment desk.",
        });
      }

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
          /* Mirrors the asset update above, which already fell back to the
             current values. The ledger did not, so the two disagreed — and this
             is now the common path rather than the rare one, because an
             ordinary hand-off no longer waits for approval. */
          toState: {
            status: "assigned",
            custodianId: input.toCustodianId,
            projectId: input.toProjectId ?? asset.currentProjectId ?? null,
            locationId: input.toLocationId ?? asset.currentLocationId ?? null,
          },
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

      /*
        A transfer names only what it changes.

        `create` stores `toProjectId`/`toLocationId` as null when the person
        moving the tool did not pick one — the form's "No change" option. Approve
        then wrote those nulls straight onto the asset, so signing off a
        person-to-person hand-off silently erased where the tool was and which
        project it was on. UIC-1001 lost both this way, and the register could no
        longer answer "where is it" for a tool it still called assigned.

        Null means "leave it alone", so the current value is the fallback.
      */
      const asset = await ctx.db.query.asset.findFirst({
        where: and(eq(schema.asset.id, tr.assetId), eq(schema.asset.tenantId, ctx.session.tenantId)),
      });
      const toProjectId = tr.toProjectId ?? asset?.currentProjectId ?? null;
      const toLocationId = tr.toLocationId ?? asset?.currentLocationId ?? null;

      await ctx.db
        .update(schema.transfer)
        .set({ status: "completed", approvedBy: ctx.session.userId, completedAt: new Date() })
        .where(eq(schema.transfer.id, input.id));
      await ctx.db
        .update(schema.asset)
        .set({
          currentCustodianId: tr.toCustodianId,
          currentLocationId: toLocationId,
          currentProjectId: toProjectId,
          updatedAt: new Date(),
        })
        .where(eq(schema.asset.id, tr.assetId));
      await moveCustody(ctx.db, {
        tenantId: ctx.session.tenantId,
        assetId: tr.assetId,
        toCustodianId: tr.toCustodianId,
        projectId: toProjectId,
        locationId: toLocationId,
        actorUserId: ctx.session.userId,
      });
      await ctx.db.insert(schema.transaction).values({
        tenantId: ctx.session.tenantId,
        assetId: tr.assetId,
        eventType: "transfer",
        actorId: ctx.session.userId,
        /* The fold is last-snapshot-wins, so this has to be the complete state
           after the move — a partial one blanks whatever it omits. */
        fromState: asset
          ? {
              status: asset.currentStatus,
              custodianId: asset.currentCustodianId,
              projectId: asset.currentProjectId,
              locationId: asset.currentLocationId,
            }
          : null,
        toState: { status: "assigned", custodianId: tr.toCustodianId, projectId: toProjectId, locationId: toLocationId },
        refType: "transfer",
        refId: tr.id,
        note: "Transfer approved",
      });

      /* Close the loop. Whoever asked for this hand-off, and whoever is now
         holding the tool, both need to hear that it went through. The asset was
         already read above, before the update, which is also the state the
         notification should describe. */
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
