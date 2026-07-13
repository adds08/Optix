import { alias } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

export const locationRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: schema.location.id,
        type: schema.location.type,
        name: schema.location.name,
        warehouseId: schema.location.warehouseId,
        warehouseName: schema.warehouse.name,
        projectId: schema.location.projectId,
        projectName: schema.project.name,
      })
      .from(schema.location)
      .leftJoin(schema.warehouse, eq(schema.location.warehouseId, schema.warehouse.id))
      .leftJoin(schema.project, eq(schema.location.projectId, schema.project.id))
      .where(eq(schema.location.tenantId, ctx.session.tenantId));
  }),

  create: requirePermission("location.manage")
    .input(
      z.object({
        type: z.string(),
        name: z.string().min(1).max(200),
        warehouseId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.location)
        .values({ tenantId: ctx.session.tenantId, ...input })
        .returning();
      if (row) await logEvent(ctx, { category: "location", action: "create", entityType: "location", entityId: row.id, entityLabel: row.name });
      return row;
    }),
});

export const vehicleRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(schema.vehicle.tenantId, ctx.session.tenantId)];
      if (input?.projectId) conditions.push(eq(schema.vehicle.projectId, input.projectId));
      const payee = alias(schema.employee, "payee");
      const foreman = alias(schema.employee, "foreman");
      return ctx.db
        .select({
          id: schema.vehicle.id,
          vehicleType: schema.vehicle.vehicleType,
          unit: schema.vehicle.unit,
          plate: schema.vehicle.plate,
          makeModel: schema.vehicle.makeModel,
          ownershipType: schema.vehicle.ownershipType,
          payeeEmployeeId: schema.vehicle.payeeEmployeeId,
          payeeName: payee.name,
          allowanceRate: schema.vehicle.allowanceRate,
          allowanceFrequency: schema.vehicle.allowanceFrequency,
          gpsLat: schema.vehicle.gpsLat,
          gpsLng: schema.vehicle.gpsLng,
          gpsAt: schema.vehicle.gpsAt,
          projectId: schema.vehicle.projectId,
          projectName: schema.project.name,
          foremanEmployeeId: schema.vehicle.foremanEmployeeId,
          foremanName: foreman.name,
          locationId: schema.vehicle.locationId,
          locationName: schema.location.name,
        })
        .from(schema.vehicle)
        .leftJoin(payee, eq(schema.vehicle.payeeEmployeeId, payee.id))
        .leftJoin(schema.project, eq(schema.vehicle.projectId, schema.project.id))
        .leftJoin(foreman, eq(schema.vehicle.foremanEmployeeId, foreman.id))
        .leftJoin(schema.location, eq(schema.vehicle.locationId, schema.location.id))
        .where(and(...conditions));
    }),

  updateGps: requirePermission("vehicle.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        lat: z.string(),
        lng: z.string(),
        source: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(schema.vehicle)
        .set({
          gpsLat: input.lat,
          gpsLng: input.lng,
          gpsAt: new Date(),
          gpsSource: input.source ?? "manual",
          updatedAt: new Date(),
        })
        .where(and(eq(schema.vehicle.id, input.id), eq(schema.vehicle.tenantId, ctx.session.tenantId)))
        .returning();
      return row;
    }),

  create: requirePermission("vehicle.manage")
    .input(
      z.object({
        vehicleType: z.enum(["truck", "trailer"]),
        unit: z.string().min(1).max(40),
        plate: z.string().optional(),
        makeModel: z.string().optional(),
        ownershipType: z.enum(["company_owned", "personal_allowance"]).default("company_owned"),
        payeeEmployeeId: z.string().uuid().optional(),
        allowanceRate: z.string().optional(),
        allowanceFrequency: z.enum(["weekly", "monthly"]).optional(),
        projectId: z.string().uuid().optional(),
        foremanEmployeeId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      // Insert location row (type=vehicle) first since vehicle.locationId is NOT NULL.
      const [loc] = await ctx.db
        .insert(schema.location)
        .values({
          tenantId: tid,
          type: "vehicle",
          name: input.unit,
          projectId: input.projectId ?? null,
        })
        .returning();
      if (!loc) throw new Error("Failed to create vehicle location");

      const [row] = await ctx.db
        .insert(schema.vehicle)
        .values({
          tenantId: tid,
          locationId: loc.id,
          vehicleType: input.vehicleType,
          unit: input.unit,
          plate: input.plate ?? null,
          makeModel: input.makeModel ?? null,
          ownershipType: input.ownershipType,
          payeeEmployeeId: input.payeeEmployeeId ?? null,
          allowanceRate: input.allowanceRate ?? null,
          allowanceFrequency: input.allowanceFrequency ?? null,
          projectId: input.projectId ?? null,
          foremanEmployeeId: input.foremanEmployeeId ?? null,
        })
        .returning();
      if (row) await logEvent(ctx, { category: "vehicle", action: "create", entityType: "vehicle", entityId: row.id, entityLabel: row.unit });
      return row;
    }),
});
