import { alias } from "drizzle-orm/pg-core";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

export const assetRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          status: z.string().optional(),
          projectId: z.string().uuid().optional(),
          custodianId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const conditions = [eq(schema.asset.tenantId, tid)];
      if (input?.status && input.status !== "all") conditions.push(eq(schema.asset.currentStatus, input.status));
      if (input?.projectId) conditions.push(eq(schema.asset.currentProjectId, input.projectId));
      if (input?.custodianId) conditions.push(eq(schema.asset.currentCustodianId, input.custodianId));
      if (input?.search) {
        const q = `%${input.search}%`;
        conditions.push(
          or(
            ilike(schema.asset.tag, q),
            ilike(schema.asset.modelName, q),
            ilike(schema.asset.serialNumber, q),
          )!,
        );
      }
      const currentProject = alias(schema.project, "current_project");
      const owningProject = alias(schema.project, "owning_project");
      const rows = await ctx.db
        .select({
          id: schema.asset.id,
          tag: schema.asset.tag,
          modelName: schema.asset.modelName,
          categoryName: schema.asset.categoryName,
          serialNumber: schema.asset.serialNumber,
          isSerialized: schema.asset.isSerialized,
          quantity: schema.asset.quantity,
          status: schema.asset.currentStatus,
          acquisitionCost: schema.asset.acquisitionCost,
          acquisitionDate: schema.asset.acquisitionDate,
          warrantyExpiresOn: schema.asset.warrantyExpiresOn,
          condition: schema.asset.condition,
          custodianId: schema.asset.currentCustodianId,
          custodianName: schema.employee.name,
          custodianExternalId: schema.employee.externalId,
          currentProjectId: schema.asset.currentProjectId,
          currentProjectName: currentProject.name,
          locationId: schema.asset.currentLocationId,
          locationName: schema.location.name,
          owningProjectId: schema.asset.owningProjectId,
          owningProjectName: owningProject.name,
        })
        .from(schema.asset)
        .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
        .leftJoin(currentProject, eq(schema.asset.currentProjectId, currentProject.id))
        .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
        .leftJoin(owningProject, eq(schema.asset.owningProjectId, owningProject.id))
        .where(and(...conditions));
      return rows;
    }),

  // Returns the same joined shape as `list` so the detail screen shows names,
  // not raw uuids. Both projections read from asset.current_* — never from a
  // hand-edited field.
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const currentProject = alias(schema.project, "current_project");
      const owningProject = alias(schema.project, "owning_project");
      const [row] = await ctx.db
        .select({
          id: schema.asset.id,
          tag: schema.asset.tag,
          modelName: schema.asset.modelName,
          categoryName: schema.asset.categoryName,
          serialNumber: schema.asset.serialNumber,
          isSerialized: schema.asset.isSerialized,
          quantity: schema.asset.quantity,
          status: schema.asset.currentStatus,
          acquisitionCost: schema.asset.acquisitionCost,
          acquisitionDate: schema.asset.acquisitionDate,
          warrantyExpiresOn: schema.asset.warrantyExpiresOn,
          condition: schema.asset.condition,
          custodianId: schema.asset.currentCustodianId,
          custodianName: schema.employee.name,
          custodianExternalId: schema.employee.externalId,
          currentProjectId: schema.asset.currentProjectId,
          currentProjectName: currentProject.name,
          locationId: schema.asset.currentLocationId,
          locationName: schema.location.name,
          owningProjectId: schema.asset.owningProjectId,
          owningProjectName: owningProject.name,
          createdAt: schema.asset.createdAt,
        })
        .from(schema.asset)
        .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
        .leftJoin(currentProject, eq(schema.asset.currentProjectId, currentProject.id))
        .leftJoin(schema.location, eq(schema.asset.currentLocationId, schema.location.id))
        .leftJoin(owningProject, eq(schema.asset.owningProjectId, owningProject.id))
        .where(and(eq(schema.asset.id, input.id), eq(schema.asset.tenantId, ctx.session.tenantId)));
      return row ?? null;
    }),

  create: requirePermission("asset.manage")
    .input(
      z.object({
        tag: z.string().min(1).max(60),
        modelName: z.string().min(1).max(200),
        categoryName: z.string().optional(),
        serialNumber: z.string().optional(),
        isSerialized: z.boolean().default(true),
        quantity: z.number().int().min(1).default(1),
        acquisitionCost: z.string().optional(),
        acquisitionDate: z.string().optional(),
        owningProjectId: z.string().uuid().optional(),
        warrantyExpiresOn: z.string().optional(),
        condition: z.string().default("good"),
        locationId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.asset)
        .values({
          tenantId: ctx.session.tenantId,
          createdBy: ctx.session.userId,
          currentStatus: "available",
          currentLocationId: input.locationId ?? null,
          ...input,
        })
        .returning();
      if (row) {
        await ctx.db.insert(schema.transaction).values({
          tenantId: ctx.session.tenantId,
          assetId: row.id,
          eventType: "tag",
          actorId: ctx.session.userId,
          toState: { status: "available", custodianId: null, projectId: null, locationId: input.locationId ?? null },
          refType: "manual",
          note: `Asset ${row.tag} registered`,
        });
        await logEvent(ctx, {
          category: "asset",
          action: "create",
          entityType: "asset",
          entityId: row.id,
          entityLabel: row.tag,
        });
      }
      return row;
    }),

  setStatus: requirePermission("asset.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.string(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(schema.asset)
        .set({ currentStatus: input.status, updatedAt: new Date() })
        .where(and(eq(schema.asset.id, input.id), eq(schema.asset.tenantId, ctx.session.tenantId)))
        .returning();
      if (row) {
        await ctx.db.insert(schema.transaction).values({
          tenantId: ctx.session.tenantId,
          assetId: row.id,
          eventType: "status_change",
          actorId: ctx.session.userId,
          toState: { status: input.status },
          refType: "manual",
          note: input.note ?? `Status → ${input.status}`,
        });
      }
      return row;
    }),

  rebuild: requirePermission("asset.manage").mutation(async ({ ctx }) => {
    // Rebuild all assets.current_* from the transaction log (rebuild guarantee).
    const tid = ctx.session.tenantId;
    const events = await ctx.db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.tenantId, tid))
      .orderBy(sql`${schema.transaction.occurredAt} ASC, ${schema.transaction.id} ASC`);
    const byAsset = new Map<string, (typeof events)[number][]>();
    for (const e of events) {
      const list = byAsset.get(e.assetId);
      if (list) list.push(e);
      else byAsset.set(e.assetId, [e]);
    }
    let updated = 0;
    for (const [assetId, list] of byAsset) {
      let latest: (typeof events)[number] | null = null;
      for (const e of list) if (e.toState) latest = e;
      if (latest?.toState) {
        const s = latest.toState as {
          status?: string;
          custodianId?: string | null;
          projectId?: string | null;
          locationId?: string | null;
        };
        await ctx.db
          .update(schema.asset)
          .set({
            currentStatus: s.status ?? "available",
            currentCustodianId: s.custodianId ?? null,
            currentProjectId: s.projectId ?? null,
            currentLocationId: s.locationId ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tid)));
        updated++;
      }
    }
    return { assetsRebuilt: updated, totalEvents: events.length };
  }),
});
