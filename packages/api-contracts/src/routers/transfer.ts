import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { custodyOutcome } from "@stinventory/domain";
import { formatAssetModel } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { homeCustodianId, moveCustody, projectForCustodian } from "../custody.js";
import { notifyCustodyDecision, notifyDeskPending } from "../notify.js";

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
      .then((rows) =>
        rows.map((r) => ({ ...r, modelName: formatAssetModel(r) })),
      );
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
        /* Only meaningful on a borrow, and optional there. A foreman who knows
           when the tool is coming back can say so and it becomes an overdue
           loan if it does not; one who does not know says nothing and the desk
           closes it out. Requiring a date on every hand-off would put a form
           field between a foreman and telling us where his tool went. */
        expectedEndDate: z.string().date().optional(),
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
        actorCanApprove: ctx.session.permissions.has("transfer.approve"),
        assetCost: asset.acquisitionCost ? Number(asset.acquisitionCost) : null,
        highValueThreshold: settings?.highValueThreshold ?? null,
      });
      /* `verify` still writes the move — it is a borrow the desk is being told
         about, not one it is being asked to permit. Only `approve` withholds it. */
      const applyNow = outcome !== "approve";
      const isBorrow = outcome === "verify";

      const status =
        outcome === "approve" ? "pending_approval" : outcome === "verify" ? "pending_verification" : "approved";
      /* A hand-off sends the tool to the recipient's job, not the project the
         form happened to be on. An explicit pick wins; a blank one means
         "wherever the recipient works". */
      const toProjectId = input.toProjectId ?? (await projectForCustodian(ctx.db, tid, input.toCustodianId, null));
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
          toProjectId,
          reason: input.reason,
          status,
          requestedBy: ctx.session.userId,
          /* A borrow is not approved by the person who raised it. It is applied
             and then shown to the desk, so this stays null until they verify. */
          approvedBy: applyNow && !isBorrow ? ctx.session.userId : null,
        })
        .returning();

      if (row && applyNow) {
        await ctx.db
          .update(schema.asset)
          .set({
            currentCustodianId: input.toCustodianId,
            currentLocationId: input.toLocationId ?? asset.currentLocationId,
            currentProjectId: toProjectId ?? asset.currentProjectId,
            updatedAt: new Date(),
          })
          .where(eq(schema.asset.id, input.assetId));
        /* Close the link the previous holder had and open the new one. Without
           this the register shows the new holder while the custody screen still
           shows the old — see packages/api-contracts/src/custody.ts.

           `temporary` on a borrow is the whole point: the tool has moved and the
           register says so, but ownership has not, and homeCustodianId() can
           still read the permanent owner back out of the history. */
        await moveCustody(ctx.db, {
          tenantId: tid,
          assetId: input.assetId,
          toCustodianId: input.toCustodianId,
          projectId: toProjectId ?? asset.currentProjectId ?? null,
          locationId: input.toLocationId ?? asset.currentLocationId ?? null,
          actorUserId: ctx.session.userId,
          type: isBorrow ? "temporary" : "permanent",
          expectedEndDate: isBorrow ? input.expectedEndDate ?? null : null,
        });
        /* A borrow is not finished when it is recorded — the desk has still to
           look at it, and `completed` would drop it out of their queue. */
        if (!isBorrow) {
          await ctx.db
            .update(schema.transfer)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(schema.transfer.id, row.id));
        }
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
            projectId: toProjectId ?? asset.currentProjectId ?? null,
            locationId: input.toLocationId ?? asset.currentLocationId ?? null,
          },
          refType: "transfer",
          refId: row.id,
          note: input.note ?? (isBorrow ? "Lent, awaiting equipment desk" : "Transfer completed"),
        });
      }
      /* Put it in front of the desk. Until this existed the queue filled up
         silently and the only thing that surfaced a held hand-off was somebody
         opening the dashboard. Never allowed to fail the transfer: the tool has
         already moved (or deliberately has not), and neither outcome should be
         undone because a notification insert went wrong. */
      if (row && outcome !== "auto") {
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
            kind: outcome === "approve" ? "approve" : "verify",
            actorEmployeeId: ctx.session.employeeId ?? null,
            toName: toEmp?.name ?? null,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[notify] desk pending failed", err);
        }
      }

      if (row) await logEvent(ctx, { category: "transfer", action: "create", entityType: "transfer", entityId: row.id, details: { outcome } });
      return { transfer: row, outcome };
    }),

  approve: requirePermission("transfer.approve")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tr = await ctx.db.query.transfer.findFirst({
        where: and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, ctx.session.tenantId)),
      });
      if (!tr) throw new TRPCError({ code: "NOT_FOUND", message: "That transfer no longer exists." });
      /* Approving is for hand-offs that were withheld. A borrow was already
         applied and needs `verify` — running it through here would open a
         second custody link for a tool that has not moved again. */
      if (tr.status !== "pending_approval") {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            tr.status === "pending_verification"
              ? "This is a recorded borrow, not a held request. Verify it instead."
              : `This transfer is already ${tr.status}.`,
        });
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

  /*
    The desk's half of a borrow.

    A foreman's hand-off is already recorded — the tool moved and the register
    says so. What the desk does here is confirm they have seen it, and decide
    whether it stays a borrow or becomes ownership. Nothing about the tool's
    location changes either way; only who it belongs to can.

    This is the step that was missing entirely. Without it a foreman's hand-off
    either wrote permanent ownership with nobody looking, or would have had to
    block in a queue while the tool was already in someone else's truck.
  */
  verify: requirePermission("transfer.approve")
    .input(
      z.object({
        id: z.string().uuid(),
        /* Off by default: the desk acknowledging a borrow is the common case,
           and handing over ownership should be the deliberate one. */
        makePermanent: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const tr = await ctx.db.query.transfer.findFirst({
        where: and(eq(schema.transfer.id, input.id), eq(schema.transfer.tenantId, tid)),
      });
      if (!tr) throw new TRPCError({ code: "NOT_FOUND", message: "That transfer no longer exists." });
      if (tr.status !== "pending_verification") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `This transfer is ${tr.status}, not a borrow awaiting verification.`,
        });
      }

      const asset = await ctx.db.query.asset.findFirst({
        where: and(eq(schema.asset.id, tr.assetId), eq(schema.asset.tenantId, tid)),
      });

      await ctx.db
        .update(schema.transfer)
        .set({ status: "completed", approvedBy: ctx.session.userId, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.transfer.id, tr.id));

      /* Granting ownership replaces the temporary link with a permanent one for
         the same holder. The tool does not move — homeCustodianId() simply
         starts answering with the new person. */
      if (input.makePermanent) {
        await moveCustody(ctx.db, {
          tenantId: tid,
          assetId: tr.assetId,
          toCustodianId: tr.toCustodianId,
          projectId: tr.toProjectId ?? asset?.currentProjectId ?? null,
          locationId: tr.toLocationId ?? asset?.currentLocationId ?? null,
          actorUserId: ctx.session.userId,
          type: "permanent",
        });
        await ctx.db.insert(schema.transaction).values({
          tenantId: tid,
          assetId: tr.assetId,
          eventType: "assign",
          actorId: ctx.session.userId,
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
            projectId: tr.toProjectId ?? asset?.currentProjectId ?? null,
            locationId: tr.toLocationId ?? asset?.currentLocationId ?? null,
          },
          refType: "transfer",
          refId: tr.id,
          note: "Ownership granted by the equipment desk",
        });
      }

      await notifyCustodyDecision(ctx.db, {
        tenantId: tid,
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
        action: input.makePermanent ? "verify_permanent" : "verify",
        entityType: "transfer",
        entityId: tr.id,
        entityLabel: asset?.tag ?? null,
      });
      return { ok: true, madePermanent: input.makePermanent };
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
      if (!tr) throw new TRPCError({ code: "NOT_FOUND", message: "That transfer no longer exists." });
      const wasBorrow = tr.status === "pending_verification";
      if (tr.status !== "pending_approval" && !wasBorrow) {
        throw new TRPCError({ code: "CONFLICT", message: `This transfer is already ${tr.status}.` });
      }

      await ctx.db
        .update(schema.transfer)
        .set({ status: "cancelled", approvedBy: ctx.session.userId, updatedAt: new Date() })
        .where(eq(schema.transfer.id, input.id));

      const asset = await ctx.db.query.asset.findFirst({ where: eq(schema.asset.id, tr.assetId) });

      /*
        Refusing a borrow is not the same as refusing a held request.

        A held request never moved the tool, so declining it only needs
        recording. A borrow already moved it, so the desk saying "no, that is
        wrong" has to put the tool back where it belongs — otherwise the
        register keeps showing a holder the desk has explicitly rejected.

        Home is the last permanent owner, not `fromCustodianId`: the tool may
        have been lent on twice before anyone looked at the queue, and walking
        it back one hop would leave it with a middleman who is not its owner.
      */
      if (wasBorrow) {
        const homeId = await homeCustodianId(ctx.db, tid, tr.assetId);
        await moveCustody(ctx.db, {
          tenantId: tid,
          assetId: tr.assetId,
          toCustodianId: homeId,
          projectId: tr.fromProjectId ?? asset?.currentProjectId ?? null,
          locationId: tr.fromLocationId ?? asset?.currentLocationId ?? null,
          actorUserId: ctx.session.userId,
          type: "permanent",
          closeAs: "returned",
        });
        await ctx.db
          .update(schema.asset)
          .set({
            currentCustodianId: homeId,
            currentStatus: homeId ? "assigned" : "available",
            currentProjectId: tr.fromProjectId ?? asset?.currentProjectId ?? null,
            currentLocationId: tr.fromLocationId ?? asset?.currentLocationId ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.asset.id, tr.assetId));
      }

      /* The refusal belongs in the tool's history either way, since "why is this
         still with Miguel?" is answered here. */
      if (asset) {
        const before = {
          status: asset.currentStatus,
          custodianId: asset.currentCustodianId,
          projectId: asset.currentProjectId,
          locationId: asset.currentLocationId,
        };
        const homeId = wasBorrow ? await homeCustodianId(ctx.db, tid, tr.assetId) : null;
        await ctx.db.insert(schema.transaction).values({
          tenantId: tid,
          assetId: tr.assetId,
          eventType: wasBorrow ? "return" : "status_change",
          actorId: ctx.session.userId,
          fromState: before,
          toState: wasBorrow
            ? {
                status: homeId ? "assigned" : "available",
                custodianId: homeId,
                projectId: tr.fromProjectId ?? asset.currentProjectId,
                locationId: tr.fromLocationId ?? asset.currentLocationId,
              }
            : before,
          refType: "transfer",
          refId: tr.id,
          note: input.reason
            ? `${wasBorrow ? "Borrow rejected, tool returned" : "Transfer declined"} — ${input.reason}`
            : wasBorrow
              ? "Borrow rejected, tool returned"
              : "Transfer declined",
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
