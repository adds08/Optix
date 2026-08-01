import { alias } from "drizzle-orm/pg-core";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { vehicleStatus, type VehicleStatus } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { logEvent } from "../audit.js";
import { moveCustody } from "../custody.js";

/*
  Hand a container to a foreman, or take it back.

  Trucks, trailers and gang boxes are how tools actually move — nobody checks
  out forty items one at a time, they hitch up a trailer. But until now the
  custodian could only be set when the row was created, so a trailer reassigned
  in the yard stayed recorded against whoever first had it, and the register
  quietly went stale.

  `moveContents` is on by default because that is what physically happens: the
  tools are inside it. Turning it off is for the case where the container is
  changing hands empty, or the contents were already moved separately.
*/
export const containerCustodyInput = z.object({
  locationId: z.string().uuid(),
  /* Null unassigns — the container goes back to being a place nobody carries. */
  custodianEmployeeId: z.string().uuid().nullable(),
  moveContents: z.boolean().default(true),
  note: z.string().max(500).optional(),
});

export const locationCustodyRouter = {
  setCustodian: requirePermission("location.manage")
    .input(containerCustodyInput)
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;

      const loc = await ctx.db.query.location.findFirst({
        where: and(eq(schema.location.id, input.locationId), eq(schema.location.tenantId, tid)),
      });
      if (!loc) throw new TRPCError({ code: "NOT_FOUND", message: "No such location in this tenant" });

      let custodianName: string | null = null;
      if (input.custodianEmployeeId) {
        const emp = await ctx.db.query.employee.findFirst({
          where: and(
            eq(schema.employee.id, input.custodianEmployeeId),
            eq(schema.employee.tenantId, tid),
          ),
        });
        if (!emp) throw new TRPCError({ code: "NOT_FOUND", message: "No such person in this tenant" });
        custodianName = emp.name;
      }

      const result = await ctx.db.transaction(async (tx: any) => {
        await tx
          .update(schema.location)
          .set({ custodianEmployeeId: input.custodianEmployeeId })
          .where(eq(schema.location.id, input.locationId));

        /* Keep the vehicle mirror in step. `location.custodianEmployeeId` is
           the authoritative column, but the vehicle list and import still read
           `vehicle.foremanEmployeeId`. */
        await tx
          .update(schema.vehicle)
          .set({ foremanEmployeeId: input.custodianEmployeeId, updatedAt: new Date() })
          .where(and(eq(schema.vehicle.tenantId, tid), eq(schema.vehicle.locationId, input.locationId)));

        if (!input.moveContents) return { toolsMoved: 0 };

        /* Everything sitting in this container. Lost and disposed tools stay
           put — the record of where they went missing should not follow the
           trailer to its next foreman. */
        const contents = await tx
          .select({
            id: schema.asset.id,
            tag: schema.asset.tag,
            currentStatus: schema.asset.currentStatus,
            currentCustodianId: schema.asset.currentCustodianId,
            currentProjectId: schema.asset.currentProjectId,
            currentLocationId: schema.asset.currentLocationId,
          })
          .from(schema.asset)
          .where(
            and(
              eq(schema.asset.tenantId, tid),
              eq(schema.asset.currentLocationId, input.locationId),
              notInArray(schema.asset.currentStatus, ["lost", "disposed"]),
            ),
          );

        const moving = contents.filter((a: any) => a.currentCustodianId !== input.custodianEmployeeId);
        if (!moving.length) return { toolsMoved: 0 };

        const ids = moving.map((a: any) => a.id);

        await tx
          .update(schema.asset)
          .set({
            currentCustodianId: input.custodianEmployeeId,
            /* A container nobody carries holds tools nobody holds — they are
               back in stock, not assigned. */
            currentStatus: input.custodianEmployeeId ? "assigned" : "available",
            updatedAt: new Date(),
          })
          .where(and(eq(schema.asset.tenantId, tid), inArray(schema.asset.id, ids)));

        /* Custody links follow, through the same helper every other custody
           writer uses, so the one-active-link invariant holds here too. */
        for (const a of moving) {
          await moveCustody(tx, {
            tenantId: tid,
            assetId: a.id,
            toCustodianId: input.custodianEmployeeId,
            projectId: a.currentProjectId,
            locationId: input.locationId,
            actorUserId: ctx.session.userId,
          });
        }

        const note =
          input.note ||
          (custodianName
            ? `Moved with ${loc.name} to ${custodianName}`
            : `${loc.name} handed back — no custodian`);

        await tx.insert(schema.transaction).values(
          moving.map((a: any) => ({
            tenantId: tid,
            assetId: a.id,
            eventType: "custodian_change",
            actorId: ctx.session.userId,
            fromState: {
              status: a.currentStatus,
              custodianId: a.currentCustodianId,
              projectId: a.currentProjectId,
              locationId: a.currentLocationId,
            },
            toState: {
              status: input.custodianEmployeeId ? "assigned" : "available",
              custodianId: input.custodianEmployeeId,
              projectId: a.currentProjectId,
              locationId: input.locationId,
            },
            refType: "location",
            refId: input.locationId,
            note,
          })),
        );

        return { toolsMoved: moving.length };
      });

      await logEvent(ctx, {
        category: "location",
        action: input.custodianEmployeeId ? "setCustodian" : "clearCustodian",
        entityType: "location",
        entityId: input.locationId,
        entityLabel: loc.name,
        details: { custodianEmployeeId: input.custodianEmployeeId, ...result },
      });

      return { ok: true, custodianName, ...result };
    }),
};

export const locationRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const custodian = alias(schema.employee, "location_custodian");
    return ctx.db
      .select({
        id: schema.location.id,
        type: schema.location.type,
        name: schema.location.name,
        warehouseId: schema.location.warehouseId,
        warehouseName: schema.warehouse.name,
        projectId: schema.location.projectId,
        projectName: schema.project.name,
        /* Nobody checks out forty tools one at a time — they take a trailer or
           a gang box. Knowing who holds the container is how "where is UIC-1012?"
           gets an answer that names a person. */
        custodianEmployeeId: schema.location.custodianEmployeeId,
        custodianName: custodian.name,
      })
      .from(schema.location)
      .leftJoin(schema.warehouse, eq(schema.location.warehouseId, schema.warehouse.id))
      .leftJoin(schema.project, eq(schema.location.projectId, schema.project.id))
      .leftJoin(custodian, eq(schema.location.custodianEmployeeId, custodian.id))
      .where(eq(schema.location.tenantId, ctx.session.tenantId));
  }),

  create: requirePermission("location.manage")
    .input(
      z.object({
        type: z.string(),
        name: z.string().min(1).max(200),
        warehouseId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        custodianEmployeeId: z.string().uuid().optional(),
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

  update: requirePermission("location.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        type: z.string().max(40).optional(),
        warehouseId: z.string().uuid().nullable().optional(),
        projectId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const { id, ...changes } = input;
      const existing = await ctx.db.query.location.findFirst({
        where: and(eq(schema.location.id, id), eq(schema.location.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such location in this tenant" });

      /* `custodianEmployeeId` is not editable here — that is `setCustodian`,
         which also moves the contents. Changing the column alone would say a
         trailer belongs to somebody while its tools still sit with the last
         person. */
      if (changes.type && existing.type === "vehicle") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This location belongs to a truck or trailer — its type is fixed.",
        });
      }

      const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length) return existing;

      const [row] = await ctx.db
        .update(schema.location)
        .set(patch)
        .where(and(eq(schema.location.id, id), eq(schema.location.tenantId, tid)))
        .returning();

      /* A vehicle location is named after its unit; keep the two in step. */
      if (patch.name && existing.type === "vehicle") {
        await ctx.db
          .update(schema.vehicle)
          .set({ unit: patch.name as string, updatedAt: new Date() })
          .where(and(eq(schema.vehicle.tenantId, tid), eq(schema.vehicle.locationId, id)));
      }

      await logEvent(ctx, {
        category: "location", action: "update", entityType: "location",
        entityId: id, entityLabel: row?.name ?? existing.name,
        details: { changed: Object.keys(patch) },
      });
      return row;
    }),

  delete: requirePermission("location.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.location.findFirst({
        where: and(eq(schema.location.id, input.id), eq(schema.location.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such location in this tenant" });

      const [holding] = await ctx.db
        .select({ id: schema.asset.id })
        .from(schema.asset)
        .where(and(eq(schema.asset.tenantId, tid), eq(schema.asset.currentLocationId, input.id)))
        .limit(1);
      if (holding) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "There are tools recorded here. Move them somewhere else first.",
        });
      }

      /* Deleting the location of a truck would orphan the vehicle row, whose
         `locationId` is NOT NULL. Delete the vehicle from the vehicle side. */
      const [veh] = await ctx.db
        .select({ id: schema.vehicle.id, unit: schema.vehicle.unit })
        .from(schema.vehicle)
        .where(and(eq(schema.vehicle.tenantId, tid), eq(schema.vehicle.locationId, input.id)))
        .limit(1);
      if (veh) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This is ${veh.unit}'s location. Delete the vehicle instead.`,
        });
      }

      await ctx.db.delete(schema.location).where(and(eq(schema.location.id, input.id), eq(schema.location.tenantId, tid)));
      await logEvent(ctx, {
        category: "location", action: "delete", entityType: "location",
        entityId: input.id, entityLabel: existing.name,
      });
      return { ok: true };
    }),

  ...locationCustodyRouter,
});

export const vehicleRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(schema.vehicle.tenantId, ctx.session.tenantId)];
      if (input?.projectId) conditions.push(eq(schema.vehicle.projectId, input.projectId));
      const payee = alias(schema.employee, "payee");
      const foreman = alias(schema.employee, "foreman");
      const rows = await ctx.db
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
          gpsSource: schema.vehicle.gpsSource,
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
      return rows.map((r) => ({
        ...r,
        /* Derived once, server-side, so the locations page and the map cannot
           disagree about whether a unit is online. See @stinventory/types/gps. */
        status: vehicleStatus(r.gpsAt) as VehicleStatus,
      }));
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
          /* The location column is the authoritative one for "who holds this
             container"; vehicle.foremanEmployeeId is the older, vehicle-only
             version of the same fact. Set both until the callers move over. */
          custodianEmployeeId: input.foremanEmployeeId ?? null,
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
  update: requirePermission("vehicle.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        unit: z.string().min(1).max(40).optional(),
        plate: z.string().max(40).nullable().optional(),
        makeModel: z.string().max(120).nullable().optional(),
        vehicleType: z.enum(["truck", "trailer"]).optional(),
        ownershipType: z.enum(["company_owned", "personal_allowance"]).optional(),
        payeeEmployeeId: z.string().uuid().nullable().optional(),
        allowanceRate: z.string().max(20).nullable().optional(),
        allowanceFrequency: z.enum(["weekly", "monthly"]).nullable().optional(),
        projectId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const { id, ...changes } = input;
      const existing = await ctx.db.query.vehicle.findFirst({
        where: and(eq(schema.vehicle.id, id), eq(schema.vehicle.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such vehicle in this tenant" });

      /* `foremanEmployeeId` is not here: handing a truck over is
         `location.setCustodian`, which takes the tools aboard with it. */
      if (changes.unit && changes.unit !== existing.unit) {
        const clash = await ctx.db.query.vehicle.findFirst({
          where: and(eq(schema.vehicle.tenantId, tid), eq(schema.vehicle.unit, changes.unit)),
        });
        if (clash) throw new TRPCError({ code: "CONFLICT", message: `${changes.unit} is already in use` });
      }

      const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length) return existing;

      const [row] = await ctx.db
        .update(schema.vehicle)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(schema.vehicle.id, id), eq(schema.vehicle.tenantId, tid)))
        .returning();

      /* The location row is the vehicle under another name — a renamed unit
         has to rename the place tools are recorded as being. */
      if (patch.unit || patch.projectId !== undefined) {
        await ctx.db
          .update(schema.location)
          .set({
            ...(patch.unit ? { name: patch.unit as string } : {}),
            ...(patch.projectId !== undefined ? { projectId: (patch.projectId as string) ?? null } : {}),
          })
          .where(eq(schema.location.id, existing.locationId));
      }

      await logEvent(ctx, {
        category: "vehicle", action: "update", entityType: "vehicle",
        entityId: id, entityLabel: row?.unit ?? existing.unit,
        details: { changed: Object.keys(patch) },
      });
      return row;
    }),

  delete: requirePermission("vehicle.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.vehicle.findFirst({
        where: and(eq(schema.vehicle.id, input.id), eq(schema.vehicle.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such vehicle in this tenant" });

      const [aboard] = await ctx.db
        .select({ id: schema.asset.id })
        .from(schema.asset)
        .where(and(eq(schema.asset.tenantId, tid), eq(schema.asset.currentLocationId, existing.locationId)))
        .limit(1);
      if (aboard) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "There are tools recorded aboard. Unload it first — hand it over to nobody.",
        });
      }

      /* Vehicle first, then its location: the FK points that way. */
      await ctx.db.delete(schema.vehicle).where(and(eq(schema.vehicle.id, input.id), eq(schema.vehicle.tenantId, tid)));
      await ctx.db.delete(schema.location).where(and(eq(schema.location.id, existing.locationId), eq(schema.location.tenantId, tid)));

      await logEvent(ctx, {
        category: "vehicle", action: "delete", entityType: "vehicle",
        entityId: input.id, entityLabel: existing.unit,
      });
      return { ok: true };
    }),
});
