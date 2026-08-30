import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { custodyOutcome } from "@stinventory/domain";
import { formatAssetModel } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { assertVehicleContext, moveCustody, projectForCustodian, vehicleContextFromLedger } from "../custody.js";
import { assetVisibility, assetScopeWhere } from "../scope.js";
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
  list: requirePermission("transfer.read").query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    /* Scoped through the ASSET, not through from/toCustodianId. A transfer has
       two people and scoping on either one alone picks a side: filtering on
       `toCustodianId` hides every tool leaving your crew, and on
       `fromCustodianId` hides every tool arriving. The tool is the thing both
       ends have in common. */
    const scoped = assetScopeWhere(await assetVisibility(ctx.db, ctx.session));
    const truckVehicle = alias(schema.vehicle, "transfer_to_truck");
    const trailerVehicle = alias(schema.vehicle, "transfer_to_trailer");
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
        /* The rig this movement is going out in (STI-206). The desk approves
           from this list, and approving a movement you cannot fully see is a
           weaker signature than it looks — the vehicle is not incidental
           detail. `undefined` here means "no vehicle recorded", which after
           STI-202's three-state rule is a claim, not an absence: render it as
           silence, never as an empty slot that reads like a truck. */
        toTruckId: schema.transfer.toTruckId,
        toTruckUnit: truckVehicle.unit,
        toTruckOwnership: truckVehicle.ownershipType,
        toTrailerId: schema.transfer.toTrailerId,
        toTrailerUnit: trailerVehicle.unit,
      })
      .from(schema.transfer)
      .innerJoin(schema.asset, eq(schema.transfer.assetId, schema.asset.id))
      /* Tenant-scoped on the join. The composite FK behind these columns proves
         the vehicle TYPE and nothing about the tenant, so it will not catch a
         mistake here. */
      .leftJoin(
        truckVehicle,
        and(eq(schema.transfer.toTruckId, truckVehicle.id), eq(truckVehicle.tenantId, tid)),
      )
      .leftJoin(
        trailerVehicle,
        and(eq(schema.transfer.toTrailerId, trailerVehicle.id), eq(trailerVehicle.tenantId, tid)),
      )
      .where(and(eq(schema.transfer.tenantId, tid), scoped))
      .then((rows) => rows.map((r) => ({ ...r, modelName: formatAssetModel(r) })));
  }),

  create: requirePermission("transfer.create")
    .input(
      z.object({
        assetId: z.string().uuid(),
        toCustodianId: z.string().uuid(),
        toLocationId: z.string().uuid().optional(),
        toProjectId: z.string().uuid().optional(),
        /* Which rig the tool rides out in (STI-203). Optional, never
           defaulted — a tool does not inherit the recipient's truck. */
        toTruckId: z.string().uuid().optional(),
        toTrailerId: z.string().uuid().optional(),
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

      /* Tenant-scoped type check before anything is written — the composite FK
         is tenant-blind and answers a wrong type with a raw 500 (custody.ts). */
      await assertVehicleContext(ctx.db, tid, input.toTruckId, input.toTrailerId);

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
            /* Parked with the rest of the "to" state (STI-203 / migration
               0017): before these columns a held transfer silently dropped
               the requester's rig pick and approve could only write nulls. */
            toTruckId: input.toTruckId ?? null,
            toTrailerId: input.toTrailerId ?? null,
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
            /* No current_* fallback, unlike project and location: those fall
               back because "No change" is a sensible answer for them. A tool
               changing hands is NOT still riding the previous holder's rig —
               blank means no vehicle recorded for the new custody. */
            truckId: input.toTruckId ?? null,
            trailerId: input.toTrailerId ?? null,
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
              /* Both keys explicit, mirroring the moveCustody call above —
                 the ledger and the assignment row must tell the same story. */
              truckId: input.toTruckId ?? null,
              trailerId: input.toTrailerId ?? null,
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

      /* Sign-off + close + open + projection + ledger commit or vanish together
         (STI-102). This used to be four bare consecutive writes — a crash
         between any two left a completed transfer whose custody never moved,
         the disagreement the rebuild guarantee exists to detect. */
      let asset: typeof schema.asset.$inferSelect | undefined;
      await ctx.db.transaction(async (tx) => {
        /* Ask again under the lock (STI-109) — identical shape to
           assignment.approve, on purpose. The pending_approval guard above ran
           before this transaction existed, so two simultaneous approves both
           passed it and both wrote a "Transfer approved" event into the
           append-only ledger. The asset read doubles as the lock — the same
           anchor moveCustody locks below — and lives in here (it sat before
           the transaction until STI-117) because a return committing in the
           gap left this path writing a `fromState`, and "no change" fallbacks
           below, describing custody that had already moved: the stale-read
           class STI-112 fixed in `decline`. Whoever held the lock has
           committed by the time these reads run. */
        [asset] = await tx
          .select()
          .from(schema.asset)
          .where(and(eq(schema.asset.id, tr.assetId), eq(schema.asset.tenantId, ctx.session.tenantId)))
          .for("update");
        const [fresh] = await tx
          .select({ status: schema.transfer.status })
          .from(schema.transfer)
          .where(and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, ctx.session.tenantId)));
        if (fresh?.status !== "pending_approval") {
          throw new TRPCError({ code: "CONFLICT", message: `This transfer is already ${fresh?.status ?? "gone"}.` });
        }

        /*
          A transfer names only what it changes.

          `create` stores `toProjectId`/`toLocationId` as null when the person
          moving the tool did not pick one — the form's "No change" option.
          Approve then wrote those nulls straight onto the asset, so signing off
          a person-to-person hand-off silently erased where the tool was and
          which project it was on. UIC-1001 lost both this way, and the register
          could no longer answer "where is it" for a tool it still called
          assigned.

          Null means "leave it alone", so the current value — as read under the
          lock — is the fallback.
        */
        const toProjectId = tr.toProjectId ?? asset?.currentProjectId ?? null;
        const toLocationId = tr.toLocationId ?? asset?.currentLocationId ?? null;
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
        /* The rig the requester named, parked on the row at create time
           (STI-203 / 0017). NULL stays NULL — "not recorded" — with no
           carry-forward, because the tool has changed hands. Unlike project
           and location there is no "No change" fallback: a new custody does
           not inherit the previous holder's rig. moveCustody re-runs the
           tenant-scoped type check on these ids inside the transaction. */
        await moveCustody(tx, {
          tenantId: ctx.session.tenantId,
          assetId: tr.assetId,
          toCustodianId: tr.toCustodianId,
          projectId: toProjectId,
          locationId: toLocationId,
          truckId: tr.toTruckId,
          trailerId: tr.toTrailerId,
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
          toState: {
            status: "assigned",
            custodianId: tr.toCustodianId,
            projectId: toProjectId,
            locationId: toLocationId,
            /* Mirrors the moveCustody call above; an unrecorded rig lands
               here as an explicit null, which is truthful — the requester
               genuinely named none. */
            truckId: tr.toTruckId,
            trailerId: tr.toTrailerId,
          },
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

      /* Refusal + its history entry commit together (STI-102): a crash between
         them left a cancelled transfer the tool's history never mentioned. */
      let asset: typeof schema.asset.$inferSelect | undefined;
      await ctx.db.transaction(async (tx) => {
        /* Same re-check-under-lock shape as the approve paths (STI-109): the
           guard above ran outside the lock, so a decline racing an approve — or
           a double-tapped decline — both passed it, and the loser overwrote the
           winner's decision and duplicated its ledger event. The asset read
           doubles as the lock, and moving it in here (it sat outside the
           transaction) keeps the from=to snapshot below the state at commit
           time — a stale one would become the ledger's newest snapshot, which
           a rebuild would then apply (STI-112). */
        [asset] = await tx
          .select()
          .from(schema.asset)
          .where(and(eq(schema.asset.id, tr.assetId), eq(schema.asset.tenantId, tid)))
          .for("update");
        const [fresh] = await tx
          .select({ status: schema.transfer.status })
          .from(schema.transfer)
          .where(and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, tid)));
        if (fresh?.status !== "pending_approval") {
          throw new TRPCError({ code: "CONFLICT", message: `This transfer is already ${fresh?.status ?? "gone"}.` });
        }
        await tx
          .update(schema.transfer)
          .set({ status: "cancelled", approvedBy: ctx.session.userId, updatedAt: new Date() })
          .where(and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, tid)));

        /* The refusal belongs in the tool's history, since "why is this still
           with Miguel?" is answered here. The state does not change, so both
           snapshots are the same — what this records is that somebody asked and
           was told no. `assignment.decline` records its refusals the same way;
           the shared decision and its reasoning live on the ledger insert
           there (STI-112). */
        if (asset) {
          const state = {
            status: asset.currentStatus,
            custodianId: asset.currentCustodianId,
            projectId: asset.currentProjectId,
            locationId: asset.currentLocationId,
            /* Same carry-forward as assignment.decline (STI-203): truck and
               trailer have no asset.current_* column, so "nothing changed"
               copies the newest ledger snapshot's keys verbatim — a blind
               null would blank a recorded ride on the next rebuild. */
            ...(await vehicleContextFromLedger(tx, tid, tr.assetId)),
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
