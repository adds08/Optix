import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { custodyOutcome } from "@stinventory/domain";
import { formatAssetModel } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { moveCustody, projectForCustodian } from "../custody.js";
import { notifyCustodyDecision, notifyDeskPending } from "../notify.js";

/*
  Moving a tool from one custodian to another.

  This is the equipment desk's operation and nobody else's. `transfer.create`
  requires `transfer.create`, which only the desk-side roles hold — a foreman
  can see what he is holding and nothing more.

  There used to be a third path here: a foreman's hand-off became a `borrow`,
  applied immediately as temporary custody with the permanent owner untouched,
  and the desk confirmed or rejected it afterwards through `transfer.verify`.
  Urban does not work that way. Tools are issued and reassigned by the yard, so
  the borrow, the `pending_verification` state and the verify step are gone —
  see the 2026-08-09 changelog. Two outcomes remain: apply it, or hold it for a
  second signature because of what it is worth.
*/
export const transferRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    return ctx.db
      .select({
        id: schema.transfer.id,
        assetId: schema.transfer.assetId,
        tag: schema.asset.tag,
        make: schema.asset.make,
        modelNumber: schema.asset.modelNumber,
        description: schema.asset.description,
        fromCustodianId: schema.transfer.fromCustodianId,
        toCustodianId: schema.transfer.toCustodianId,
        reason: schema.transfer.reason,
        status: schema.transfer.status,
        createdAt: schema.transfer.createdAt,
        completedAt: schema.transfer.completedAt,
      })
      .from(schema.transfer)
      .innerJoin(schema.asset, eq(schema.transfer.assetId, schema.asset.id))
      .where(eq(schema.transfer.tenantId, tid))
      .then((rows) => rows.map((r) => ({ ...r, modelName: formatAssetModel(r) })));
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
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "That tool is not in the register." });

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
      const outcome = custodyOutcome({
        assetCost: asset.acquisitionCost ? Number(asset.acquisitionCost) : null,
        highValueThreshold: settings?.highValueThreshold ?? null,
      });
      const applyNow = outcome === "auto";

      /* A hand-off sends the tool to the recipient's job, not the project the
         form happened to be on. An explicit pick wins; a blank one means
         "wherever the recipient works". */
      const toProjectId = input.toProjectId ?? (await projectForCustodian(ctx.db, tid, input.toCustodianId, null));

      /* Transfer row + close + open + projection + ledger commit or vanish
         together (STI-102). These were bare consecutive writes: a crash midway
         left a transfer marked applied whose custody never moved, and two
         concurrent hand-offs of one tool could both open a link. The custody
         move takes the asset-row lock inside custody.ts, so they serialise. */
      const row = await ctx.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.transfer)
          .values({
            tenantId: tid,
            assetId: input.assetId,
            fromCustodianId: asset.currentCustodianId,
            toCustodianId: input.toCustodianId,
            fromLocationId: asset.currentLocationId,
            toLocationId: input.toLocationId ?? null,
            fromProjectId: asset.currentProjectId,
            toProjectId,
            reason: input.reason,
            status: applyNow ? "approved" : "pending_approval",
            requestedBy: ctx.session.userId,
            approvedBy: applyNow ? ctx.session.userId : null,
          })
          .returning();

        if (created && applyNow) {
          await tx
            .update(schema.asset)
            .set({
              currentStatus: "assigned",
              currentCustodianId: input.toCustodianId,
              currentLocationId: input.toLocationId ?? asset.currentLocationId,
              currentProjectId: toProjectId ?? asset.currentProjectId,
              updatedAt: new Date(),
            })
            .where(and(eq(schema.asset.id, input.assetId), eq(schema.asset.tenantId, tid)));
          /* Close the link the previous holder had and open the new one. Without
             this the register shows the new holder while the custody screen still
             shows the old — see packages/api-contracts/src/custody.ts. */
          await moveCustody(tx, {
            tenantId: tid,
            assetId: input.assetId,
            toCustodianId: input.toCustodianId,
            projectId: toProjectId ?? asset.currentProjectId ?? null,
            locationId: input.toLocationId ?? asset.currentLocationId ?? null,
            actorUserId: ctx.session.userId,
          });
          await tx
            .update(schema.transfer)
            .set({ status: "completed", completedAt: new Date() })
            .where(and(eq(schema.transfer.id, created.id), eq(schema.transfer.tenantId, tid)));
          await tx.insert(schema.transaction).values({
            tenantId: tid,
            assetId: input.assetId,
            eventType: "transfer",
            actorId: ctx.session.userId,
            fromState: {
              status: asset.currentStatus,
              custodianId: asset.currentCustodianId,
              projectId: asset.currentProjectId,
              locationId: asset.currentLocationId,
            },
            /* Mirrors the asset update above, which already fell back to the
               current values. The ledger did not, so the two disagreed — and
               replaying the ledger blanked whatever the snapshot omitted. */
            toState: {
              status: "assigned",
              custodianId: input.toCustodianId,
              projectId: toProjectId ?? asset.currentProjectId ?? null,
              locationId: input.toLocationId ?? asset.currentLocationId ?? null,
            },
            refType: "transfer",
            refId: created.id,
            note: input.note ?? "Transfer completed",
          });
        }
        return created;
      });

      /* Put a held transfer in front of the desk. Until this existed the queue
         filled up silently. Never allowed to fail the transfer itself. */
      if (row && !applyNow) {
        try {
          const toEmp = await ctx.db.query.employee.findFirst({
            where: and(eq(schema.employee.id, input.toCustodianId), eq(schema.employee.tenantId, tid)),
            columns: { name: true },
          });
          await notifyDeskPending(ctx.db, {
            tenantId: tid,
            approverRole: settings?.custodyApproverRole ?? null,
            refType: "transfer",
            refId: row.id,
            assetTag: asset.tag,
            assetLabel: formatAssetModel(asset) || "a tool",
            actorEmployeeId: ctx.session.employeeId ?? null,
            toName: toEmp?.name ?? null,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[notify] desk pending failed", err);
        }
      }

      if (row) {
        await logEvent(ctx, {
          category: "transfer",
          action: "create",
          entityType: "transfer",
          entityId: row.id,
          details: { outcome },
        });
      }
      return { transfer: row, outcome };
    }),

  approve: requirePermission("transfer.approve")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tr = await ctx.db.query.transfer.findFirst({
        where: and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, ctx.session.tenantId)),
      });
      if (!tr) throw new TRPCError({ code: "NOT_FOUND", message: "That transfer no longer exists." });
      if (tr.status !== "pending_approval") {
        throw new TRPCError({ code: "CONFLICT", message: `This transfer is already ${tr.status}.` });
      }

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

      /* Sign-off + close + open + projection + ledger commit or vanish together
         (STI-102). This used to be four bare consecutive writes — a crash
         between any two left a completed transfer whose custody never moved,
         the disagreement the rebuild guarantee exists to detect. */
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(schema.transfer)
          .set({ status: "completed", approvedBy: ctx.session.userId, completedAt: new Date() })
          .where(and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, ctx.session.tenantId)));
        await tx
          .update(schema.asset)
          .set({
            currentStatus: "assigned",
            currentCustodianId: tr.toCustodianId,
            currentLocationId: toLocationId,
            currentProjectId: toProjectId,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.asset.id, tr.assetId), eq(schema.asset.tenantId, ctx.session.tenantId)));
        await moveCustody(tx, {
          tenantId: ctx.session.tenantId,
          assetId: tr.assetId,
          toCustodianId: tr.toCustodianId,
          projectId: toProjectId,
          locationId: toLocationId,
          actorUserId: ctx.session.userId,
        });
        await tx.insert(schema.transaction).values({
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
      });

      /* Close the loop. Whoever asked for this hand-off, and whoever is now
         holding the tool, both need to hear that it went through. */
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

  /* The other half of the gate. Declining records that a hand-off was put up
     and refused, which deleting the row would not. Nothing has moved — a held
     transfer never touched the register — so this only has to be written down
     and told to the person who asked. */
  decline: requirePermission("transfer.approve")
    .input(z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const tr = await ctx.db.query.transfer.findFirst({
        where: and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, tid)),
      });
      if (!tr) throw new TRPCError({ code: "NOT_FOUND", message: "That transfer no longer exists." });
      if (tr.status !== "pending_approval") {
        throw new TRPCError({ code: "CONFLICT", message: `This transfer is already ${tr.status}.` });
      }

      const asset = await ctx.db.query.asset.findFirst({ where: eq(schema.asset.id, tr.assetId) });

      /* Refusal + its history entry commit together (STI-102): a crash between
         them left a cancelled transfer the tool's history never mentioned. */
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(schema.transfer)
          .set({ status: "cancelled", approvedBy: ctx.session.userId, updatedAt: new Date() })
          .where(and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, tid)));

        /* The refusal belongs in the tool's history, since "why is this still
           with Miguel?" is answered here. The state does not change, so both
           snapshots are the same — what this records is that somebody asked and
           was told no. */
        if (asset) {
          const state = {
            status: asset.currentStatus,
            custodianId: asset.currentCustodianId,
            projectId: asset.currentProjectId,
            locationId: asset.currentLocationId,
          };
          await tx.insert(schema.transaction).values({
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
      });

      /* A declined hand-off used to end at the database row, so the person who
         asked for it never found out and the tool "not moving" looked like a
         bug. */
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
