import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { custodyOutcome } from "@stinventory/domain";
import { formatAssetModel } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { closeActiveCustody, projectForCustodian } from "../custody.js";
import { notifyCustodyDecision, notifyDeskPending } from "../notify.js";

export const assignmentRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const rows = await ctx.db
      .select({
        id: schema.assignment.id,
        assetId: schema.assignment.assetId,
        tag: schema.asset.tag,
        make: schema.asset.make,
        modelNumber: schema.asset.modelNumber,
        description: schema.asset.description,
        custodianId: schema.assignment.custodianId,
        custodianName: schema.employee.name,
        custodianExternalId: schema.employee.externalId,
        projectId: schema.assignment.projectId,
        projectName: schema.project.name,
        projectExternalId: schema.project.externalId,
        locationId: schema.assignment.locationId,
        locationName: schema.location.name,
        startDate: schema.assignment.startDate,
        status: schema.assignment.status,
      })
      .from(schema.assignment)
      .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
      .innerJoin(schema.employee, eq(schema.assignment.custodianId, schema.employee.id))
      .leftJoin(schema.project, eq(schema.assignment.projectId, schema.project.id))
      .leftJoin(schema.location, eq(schema.assignment.locationId, schema.location.id))
      .where(eq(schema.assignment.tenantId, tid));
    return rows.map((r) => ({ ...r, modelName: formatAssetModel(r) }));
  }),

  create: requirePermission("assignment.create")
    .input(
      z.object({
        assetId: z.string().uuid(),
        custodianId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        locationId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const asset = await ctx.db.query.asset.findFirst({
        where: and(eq(schema.asset.id, input.assetId), eq(schema.asset.tenantId, tid)),
      });
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "That tool is not in the register." });

      const settings = await ctx.db.query.tenantSettings.findFirst({
        where: eq(schema.tenantSettings.tenantId, tid),
      });
      const outcome = custodyOutcome({
        assetCost: asset.acquisitionCost ? Number(asset.acquisitionCost) : null,
        highValueThreshold: settings?.highValueThreshold ?? null,
      });
      const needsApproval = outcome === "approve";
      const status = needsApproval ? "pending_approval" : "active";

      /* Handing a tool to somebody sends it to their job, not to whichever
         project the form happened to be on. Explicitly picking a project still
         wins; leaving it blank now means "wherever the custodian works". */
      const projectId = input.projectId ?? (await projectForCustodian(ctx.db, tid, input.custodianId, null));

      /* Close + open + projection + ledger commit or vanish together (STI-102).
         These used to be bare consecutive writes, so a crash between any two
         left the register and the ledger permanently disagreeing. The close
         also takes the asset-row lock inside custody.ts, so two concurrent
         assignments of the same tool serialise instead of both opening. */
      const row = await ctx.db.transaction(async (tx) => {
        /* One active link per tool. Assigning something that is already out used
           to leave both rows active, so the tool showed up in two people's
           custody at once. A row waiting on approval changes nothing yet, so the
           old link only closes when this one actually takes effect. */
        if (!needsApproval) await closeActiveCustody(tx, tid, input.assetId);

        const [created] = await tx
          .insert(schema.assignment)
          .values({
            tenantId: tid,
            assetId: input.assetId,
            custodianId: input.custodianId,
            projectId,
            locationId: input.locationId ?? null,
            startDate: new Date().toISOString().slice(0, 10),
            status,
            approvedBy: needsApproval ? null : ctx.session.userId,
          })
          .returning();
        if (created && !needsApproval) {
          // Apply projection immediately: update asset current_* and append transaction.
          await tx
            .update(schema.asset)
            .set({
              currentStatus: "assigned",
              currentCustodianId: input.custodianId,
              currentProjectId: projectId ?? asset.currentProjectId,
              currentLocationId: input.locationId ?? asset.currentLocationId,
              updatedAt: new Date(),
            })
            .where(and(eq(schema.asset.id, input.assetId), eq(schema.asset.tenantId, tid)));
          await tx.insert(schema.transaction).values({
            tenantId: tid,
            assetId: input.assetId,
            eventType: "assign",
            actorId: ctx.session.userId,
            fromState: { status: asset.currentStatus, custodianId: asset.currentCustodianId, projectId: asset.currentProjectId, locationId: asset.currentLocationId },
            /* Same fallbacks the asset update two statements up uses. They were
               `?? null` here, so the row said one thing and the ledger said
               another: replaying the ledger blanked a project the register still
               showed. Nothing surfaces that until somebody rebuilds, which is
               exactly when it is least welcome. */
            toState: {
              status: "assigned",
              custodianId: input.custodianId,
              projectId: projectId ?? asset.currentProjectId ?? null,
              locationId: input.locationId ?? asset.currentLocationId ?? null,
            },
            refType: "assignment",
            refId: created.id,
            note: `Assigned to foreman`,
          });
        }
        return created;
      });
      /* Same reason as the transfer path: a held assignment used to reach the
         desk only if somebody opened the dashboard and read a count. Best
         effort — the assignment stands whether or not the alert was written. */
      if (row && needsApproval) {
        try {
          const toEmp = await ctx.db.query.employee.findFirst({
            where: and(eq(schema.employee.id, input.custodianId), eq(schema.employee.tenantId, tid)),
            columns: { name: true },
          });
          await notifyDeskPending(ctx.db, {
            tenantId: tid,
            approverRole: settings?.custodyApproverRole ?? null,
            refType: "assignment",
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

      if (row) await logEvent(ctx, { category: "assignment", action: "create", entityType: "assignment", entityId: row.id, details: { needsApproval } });
      return { assignment: row, needsApproval };
    }),

  approve: requirePermission("assignment.approve")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.db.query.assignment.findFirst({
        where: and(eq(schema.assignment.id, input.id), eq(schema.assignment.tenantId, ctx.session.tenantId)),
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "That assignment no longer exists." });
      /* Only a pending row can take effect. Without this guard, approving an
         already-active row would close it below and re-open it with a duplicate
         ledger event — and it keeps a double-tapped Approve honest. */
      if (a.status !== "pending_approval") {
        throw new TRPCError({ code: "CONFLICT", message: `This assignment is already ${a.status}.` });
      }
      await ctx.db.transaction(async (tx) => {
        /* Approval is the moment this link takes effect, so it is also the
           moment the previous holder's link must close. `create` deliberately
           skips the close while a row waits for approval — and nothing closed
           it here, which is exactly how a tool ended up with two active
           custodians after an approve. The row being approved is still
           `pending_approval`, so the close cannot touch it. */
        await closeActiveCustody(tx, ctx.session.tenantId, a.assetId);
        await tx
          .update(schema.assignment)
          .set({ status: "active", approvedBy: ctx.session.userId, updatedAt: new Date() })
          .where(and(eq(schema.assignment.id, input.id), eq(schema.assignment.tenantId, ctx.session.tenantId)));
        await tx
          .update(schema.asset)
          .set({
            currentStatus: "assigned",
            currentCustodianId: a.custodianId,
            currentProjectId: a.projectId,
            currentLocationId: a.locationId,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.asset.id, a.assetId), eq(schema.asset.tenantId, ctx.session.tenantId)));
        await tx.insert(schema.transaction).values({
          tenantId: ctx.session.tenantId,
          assetId: a.assetId,
          eventType: "assign",
          actorId: ctx.session.userId,
          // Complete snapshot: the fold replaces rather than merges, so all
          // four keys must be present even when their value is null.
          toState: { status: "assigned", custodianId: a.custodianId, projectId: a.projectId, locationId: a.locationId },
          refType: "assignment",
          refId: a.id,
          note: "Assignment approved",
        });
      });

      const asset = await ctx.db.query.asset.findFirst({ where: eq(schema.asset.id, a.assetId) });
      await notifyCustodyDecision(ctx.db, {
        tenantId: ctx.session.tenantId,
        toCustodianId: a.custodianId,
        refType: "assignment",
        refId: a.id,
        assetTag: asset?.tag ?? "a tool",
        approved: true,
      });
      return { ok: true };
    }),

  /* Refusing a proposed custody link. The row is kept as `cancelled` so the
     register can still answer why the tool never went out. */
  decline: requirePermission("assignment.approve")
    .input(z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const a = await ctx.db.query.assignment.findFirst({
        where: and(eq(schema.assignment.id, input.id), eq(schema.assignment.tenantId, tid)),
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "That assignment no longer exists." });
      if (a.status !== "pending_approval") {
        throw new TRPCError({ code: "CONFLICT", message: `This assignment is already .` });
      }

      /* One write, but wrapped like its siblings (STI-102) so every custody
         decision commits atomically and no future second write here can land
         outside the transaction. */
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(schema.assignment)
          .set({ status: "cancelled", approvedBy: ctx.session.userId, updatedAt: new Date() })
          .where(and(eq(schema.assignment.id, input.id), eq(schema.assignment.tenantId, tid)));
      });

      const asset = await ctx.db.query.asset.findFirst({ where: eq(schema.asset.id, a.assetId) });
      await notifyCustodyDecision(ctx.db, {
        tenantId: tid,
        toCustodianId: a.custodianId,
        refType: "assignment",
        refId: a.id,
        assetTag: asset?.tag ?? "a tool",
        approved: false,
        reason: input.reason ?? null,
      });

      await logEvent(ctx, {
        category: "assignment",
        action: "decline",
        entityType: "assignment",
        entityId: a.id,
        entityLabel: asset?.tag ?? null,
        details: { reason: input.reason ?? null },
      });
      return { ok: true };
    }),

  return: requirePermission("assignment.create")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.db.query.assignment.findFirst({
        where: and(eq(schema.assignment.id, input.id), eq(schema.assignment.tenantId, ctx.session.tenantId)),
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "That assignment no longer exists." });
      const asset = await ctx.db.query.asset.findFirst({ where: eq(schema.asset.id, a.assetId) });
      /* Close + projection + ledger commit or vanish together (STI-102). A
         crash after the close used to leave a tool that was nobody's custody
         but still `assigned` in the register. */
      /* What a return MEANS (STI-113): nobody holds the tool, so it is booked
         to no job — the project comes from the custodian (projectForCustodian:
         tools follow the person, not the site), and with no person there is no
         project. Location is a physical fact independent of custody; this
         procedure takes no location input, so the last recorded location stays
         the best evidence of where the tool sits. The chat return in
         apply-action.ts already says exactly this.

         Same partial-snapshot bug the sibling writers carry scars for: this
         one kept project and location on the asset row while nulling both in
         the ledger event, so from the first real return the register and the
         ledger disagreed — every sweep raised a custody_discrepancy and a
         rebuild blanked both fields for good. One `next` object now feeds the
         projection update AND the `toState`, so the two cannot drift apart. */
      const next = {
        status: "available",
        custodianId: null,
        projectId: null,
        locationId: asset?.currentLocationId ?? null,
      };
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(schema.assignment)
          .set({ status: "returned", returnedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.assignment.id, input.id), eq(schema.assignment.tenantId, ctx.session.tenantId)));
        await tx
          .update(schema.asset)
          .set({
            currentStatus: next.status,
            currentCustodianId: next.custodianId,
            currentProjectId: next.projectId,
            currentLocationId: next.locationId,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.asset.id, a.assetId), eq(schema.asset.tenantId, ctx.session.tenantId)));
        await tx.insert(schema.transaction).values({
          tenantId: ctx.session.tenantId,
          assetId: a.assetId,
          eventType: "return",
          actorId: ctx.session.userId,
          fromState: asset ? { status: asset.currentStatus, custodianId: asset.currentCustodianId, projectId: asset.currentProjectId, locationId: asset.currentLocationId } : null,
          toState: next,
          refType: "assignment",
          refId: a.id,
          note: "Returned to warehouse",
        });
      });
      return { ok: true };
    }),
});
