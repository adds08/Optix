import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { requiresCustodyApproval, isOverdueLoan } from "@stinventory/domain";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

export const assignmentRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const rows = await ctx.db
      .select({
        id: schema.assignment.id,
        assetId: schema.assignment.assetId,
        tag: schema.asset.tag,
        modelName: schema.asset.modelName,
        custodianId: schema.assignment.custodianId,
        custodianName: schema.employee.name,
        custodianExternalId: schema.employee.externalId,
        projectId: schema.assignment.projectId,
        projectName: schema.project.name,
        locationId: schema.assignment.locationId,
        locationName: schema.location.name,
        type: schema.assignment.type,
        startDate: schema.assignment.startDate,
        expectedEnd: schema.assignment.expectedEndDate,
        status: schema.assignment.status,
      })
      .from(schema.assignment)
      .innerJoin(schema.asset, eq(schema.assignment.assetId, schema.asset.id))
      .innerJoin(schema.employee, eq(schema.assignment.custodianId, schema.employee.id))
      .leftJoin(schema.project, eq(schema.assignment.projectId, schema.project.id))
      .leftJoin(schema.location, eq(schema.assignment.locationId, schema.location.id))
      .where(eq(schema.assignment.tenantId, tid));
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((r) => ({
      ...r,
      overdue: isOverdueLoan({ type: r.type as "permanent" | "temporary", status: r.status, expectedEndDate: r.expectedEnd, today }),
    }));
  }),

  create: requirePermission("assignment.create")
    .input(
      z.object({
        assetId: z.string().uuid(),
        custodianId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        locationId: z.string().uuid().optional(),
        type: z.enum(["permanent", "temporary"]).default("permanent"),
        expectedEnd: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const asset = await ctx.db.query.asset.findFirst({
        where: and(eq(schema.asset.id, input.assetId), eq(schema.asset.tenantId, tid)),
      });
      if (!asset) throw new Error("Asset not found");

      const settings = await ctx.db.query.tenantSettings.findFirst({
        where: eq(schema.tenantSettings.tenantId, tid),
      });
      const needsApproval = requiresCustodyApproval({
        fromCustodianId: asset.currentCustodianId ?? null,
        toCustodianId: input.custodianId,
        assetCost: asset.acquisitionCost ? Number(asset.acquisitionCost) : null,
        highValueThreshold: settings?.highValueThreshold ?? null,
      });

      const status = needsApproval ? "pending_approval" : "active";
      const [row] = await ctx.db
        .insert(schema.assignment)
        .values({
          tenantId: tid,
          assetId: input.assetId,
          custodianId: input.custodianId,
          projectId: input.projectId ?? null,
          locationId: input.locationId ?? null,
          type: input.type,
          startDate: new Date().toISOString().slice(0, 10),
          expectedEndDate: input.expectedEnd ?? null,
          status,
          approvedBy: needsApproval ? null : ctx.session.userId,
        })
        .returning();
      if (row && !needsApproval) {
        // Apply projection immediately: update asset current_* and append transaction.
        await ctx.db
          .update(schema.asset)
          .set({
            currentStatus: "assigned",
            currentCustodianId: input.custodianId,
            currentProjectId: input.projectId ?? asset.currentProjectId,
            currentLocationId: input.locationId ?? asset.currentLocationId,
            updatedAt: new Date(),
          })
          .where(eq(schema.asset.id, input.assetId));
        await ctx.db.insert(schema.transaction).values({
          tenantId: tid,
          assetId: input.assetId,
          eventType: "assign",
          actorId: ctx.session.userId,
          fromState: { status: asset.currentStatus, custodianId: asset.currentCustodianId, projectId: asset.currentProjectId, locationId: asset.currentLocationId },
          toState: { status: "assigned", custodianId: input.custodianId, projectId: input.projectId ?? null, locationId: input.locationId ?? null },
          refType: "assignment",
          refId: row.id,
          note: `Assigned to foreman`,
        });
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
      if (!a) throw new Error("Assignment not found");
      await ctx.db
        .update(schema.assignment)
        .set({ status: "active", approvedBy: ctx.session.userId, updatedAt: new Date() })
        .where(eq(schema.assignment.id, input.id));
      await ctx.db
        .update(schema.asset)
        .set({
          currentStatus: "assigned",
          currentCustodianId: a.custodianId,
          currentProjectId: a.projectId,
          currentLocationId: a.locationId,
          updatedAt: new Date(),
        })
        .where(eq(schema.asset.id, a.assetId));
      await ctx.db.insert(schema.transaction).values({
        tenantId: ctx.session.tenantId,
        assetId: a.assetId,
        eventType: "assign",
        actorId: ctx.session.userId,
        toState: { status: "assigned", custodianId: a.custodianId, projectId: a.projectId, locationId: a.locationId },
        refType: "assignment",
        refId: a.id,
        note: "Assignment approved",
      });
      return { ok: true };
    }),

  return: requirePermission("assignment.create")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.db.query.assignment.findFirst({
        where: and(eq(schema.assignment.id, input.id), eq(schema.assignment.tenantId, ctx.session.tenantId)),
      });
      if (!a) throw new Error("Assignment not found");
      await ctx.db
        .update(schema.assignment)
        .set({ status: "returned", returnedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.assignment.id, input.id));
      const asset = await ctx.db.query.asset.findFirst({ where: eq(schema.asset.id, a.assetId) });
      await ctx.db
        .update(schema.asset)
        .set({ currentStatus: "available", currentCustodianId: null, updatedAt: new Date() })
        .where(eq(schema.asset.id, a.assetId));
      await ctx.db.insert(schema.transaction).values({
        tenantId: ctx.session.tenantId,
        assetId: a.assetId,
        eventType: "return",
        actorId: ctx.session.userId,
        fromState: asset ? { status: asset.currentStatus, custodianId: asset.currentCustodianId, projectId: asset.currentProjectId, locationId: asset.currentLocationId } : null,
        toState: { status: "available", custodianId: null, projectId: null, locationId: null },
        refType: "assignment",
        refId: a.id,
        note: "Returned to warehouse",
      });
      return { ok: true };
    }),
});
