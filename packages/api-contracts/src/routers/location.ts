import { alias } from "drizzle-orm/pg-core";
import { and, eq, inArray, notInArray, or } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { vehicleStatus, type VehicleStatus } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { logEvent } from "../audit.js";
import { moveCustody, vehicleContextFromLedger } from "../custody.js";

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

  Handing a TRUCK to somebody also hands it to whatever trailers are hitched to
  it (`location.parentLocationId`) — a trailer attached to a truck moves with
  the truck, contents included.
*/
export const containerCustodyInput = z.object({
  locationId: z.string().uuid(),
  /* Null unassigns — the container goes back to being a place nobody carries. */
  custodianEmployeeId: z.string().uuid().nullable(),
  moveContents: z.boolean().default(true),
  note: z.string().max(500).optional(),
});

/*
  One container's worth of the hand-over: custodian (and the vehicle mirror),
  then — when asked — the tools inside it, each through `moveCustody` plus its
  own ledger entry. Shared by `setCustodian` (for the container and whatever is
  hitched to it) and the vehicle editor (attaching a trailer to a truck that
  already has a foreman).
*/
async function applyContainerCustody(opts: {
  tx: any;
  tid: string;
  actorUserId: string;
  locationId: string;
  locationName: string;
  custodianId: string | null;
  custodianName: string | null;
  moveContents: boolean;
  note: string | null;
}): Promise<number> {
  const { tx, tid, actorUserId, locationId, locationName, custodianId, custodianName, moveContents, note } = opts;

  await tx
    .update(schema.location)
    .set({ custodianEmployeeId: custodianId })
    .where(eq(schema.location.id, locationId));

  /* Keep the vehicle mirror in step. `location.custodianEmployeeId` is the
     authoritative column, but the vehicle list and import still read
     `vehicle.foremanEmployeeId`. */
  await tx
    .update(schema.vehicle)
    .set({ foremanEmployeeId: custodianId, updatedAt: new Date() })
    .where(and(eq(schema.vehicle.tenantId, tid), eq(schema.vehicle.locationId, locationId)));

  if (!moveContents) return 0;

  /* Everything sitting in this container. Lost and disposed tools stay put —
     the record of where they went missing should not follow the trailer to its
     next foreman. */
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
        eq(schema.asset.currentLocationId, locationId),
        notInArray(schema.asset.currentStatus, ["lost", "disposed"]),
      ),
    );

  const moving = contents.filter((a: any) => a.currentCustodianId !== custodianId);
  if (!moving.length) return 0;

  const ids = moving.map((a: any) => a.id);

  await tx
    .update(schema.asset)
    .set({
      currentCustodianId: custodianId,
      /* A container nobody carries holds tools nobody holds — they are back in
         stock, not assigned. */
      currentStatus: custodianId ? "assigned" : "available",
      updatedAt: new Date(),
    })
    .where(and(eq(schema.asset.tenantId, tid), inArray(schema.asset.id, ids)));

  /* Custody links follow, through the same helper every other custody writer
     uses, so the one-active-link invariant holds here too.

     Which bucket is this writer in (STI-203)? A container hand-over moves the
     WHO, not the WHERE-IT-RIDES: the tools stay inside the same box, so this
     writer asserts nothing new about vehicles and CARRIES the newest ledger
     snapshot's truck/trailer keys FORWARD verbatim — absent stays absent, the
     same rule as the decline writers. It must not stay four-key: the fold
     replaces, so a four-key custodian_change here erased "still in TE-006"
     from a tool that never left the trailer. And it must not emit blind
     nulls: that stamps "affirmatively no trailer" over a recorded ride. The
     carried context also goes onto the link moveCustody opens, so the row and
     the event tell one story — the STI-113 lesson, one source for both. */
  const rideByAsset = new Map<string, { truckId?: string | null; trailerId?: string | null }>();
  for (const a of moving) {
    const ride = await vehicleContextFromLedger(tx, tid, a.id);
    rideByAsset.set(a.id, ride);
    await moveCustody(tx, {
      tenantId: tid,
      assetId: a.id,
      toCustodianId: custodianId,
      projectId: a.currentProjectId,
      locationId,
      truckId: ride.truckId,
      trailerId: ride.trailerId,
      actorUserId,
    });
  }

  await tx.insert(schema.transaction).values(
    moving.map((a: any) => ({
      tenantId: tid,
      assetId: a.id,
      eventType: "custodian_change",
      actorId: actorUserId,
      fromState: {
        status: a.currentStatus,
        custodianId: a.currentCustodianId,
        projectId: a.currentProjectId,
        locationId: a.currentLocationId,
      },
      toState: {
        status: custodianId ? "assigned" : "available",
        custodianId,
        projectId: a.currentProjectId,
        locationId,
        ...rideByAsset.get(a.id),
      },
      refType: "location",
      refId: locationId,
      note,
    })),
  );

  return moving.length;
}

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
        /* The container being handed over, plus anything hitched to it — a
           trailer whose location points at this one. They move as one unit,
           which is what a hitch means. */
        const followers = await tx
          .select({ id: schema.location.id, name: schema.location.name })
          .from(schema.location)
          .where(
            and(
              eq(schema.location.tenantId, tid),
              or(
                eq(schema.location.id, input.locationId),
                eq(schema.location.parentLocationId, input.locationId),
              ),
            ),
          );

        let toolsMoved = 0;
        for (const f of followers) {
          const isMain = f.id === input.locationId;
          const note =
            input.note ||
            (custodianName
              ? isMain
                ? `Moved with ${loc.name} to ${custodianName}`
                : `Moved with ${loc.name} to ${custodianName} (trailer follows)`
              : isMain
                ? `${loc.name} handed back — no custodian`
                : `${loc.name} handed back — no custodian (trailer follows)`);
          toolsMoved += await applyContainerCustody({
            tx,
            tid,
            actorUserId: ctx.session.userId,
            locationId: f.id,
            locationName: f.name,
            custodianId: input.custodianEmployeeId,
            custodianName,
            moveContents: input.moveContents,
            note,
          });
        }

        return { toolsMoved };
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


/*
  Every row that can pin a vehicle at the database level (STI-203).

  TWO tables reference vehicle through the composite NO ACTION FKs:
  assignment (truck_id/trailer_id, migration 0016) and transfer
  (to_truck_id/to_trailer_id, migration 0017) — and the transfer writers park
  the rig on EVERY row, pending, declined and completed alike, so any vehicle
  ever named in a hand-off is pinned forever. A guard that checked only
  assignment passed for a vehicle named once in a declined transfer and then
  died on the raw FK as a 500 (QA-203 reproduced it). No status predicate on
  either table, deliberately: the FKs have none.
*/
async function vehicleInCustodyRecord(db: any, tid: string, vehicleId: string): Promise<boolean> {
  const [assignmentRef] = await db
    .select({ id: schema.assignment.id })
    .from(schema.assignment)
    .where(
      and(
        eq(schema.assignment.tenantId, tid),
        or(eq(schema.assignment.truckId, vehicleId), eq(schema.assignment.trailerId, vehicleId)),
      ),
    )
    .limit(1);
  if (assignmentRef) return true;
  const [transferRef] = await db
    .select({ id: schema.transfer.id })
    .from(schema.transfer)
    .where(
      and(
        eq(schema.transfer.tenantId, tid),
        or(eq(schema.transfer.toTruckId, vehicleId), eq(schema.transfer.toTrailerId, vehicleId)),
      ),
    )
    .limit(1);
  return !!transferRef;
}

export const vehicleRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(schema.vehicle.tenantId, ctx.session.tenantId)];
      if (input?.projectId) conditions.push(eq(schema.vehicle.projectId, input.projectId));
      const payee = alias(schema.employee, "payee");
      const foreman = alias(schema.employee, "foreman");
      const attached = alias(schema.vehicle, "attached");
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
          /* A trailer hitched to a truck: the trailer's location points at the
             truck's location, and this join turns that into "Truck 07". */
          attachedToVehicleId: attached.id,
          attachedToUnit: attached.unit,
        })
        .from(schema.vehicle)
        .leftJoin(payee, eq(schema.vehicle.payeeEmployeeId, payee.id))
        .leftJoin(schema.project, eq(schema.vehicle.projectId, schema.project.id))
        .leftJoin(foreman, eq(schema.vehicle.foremanEmployeeId, foreman.id))
        .leftJoin(schema.location, eq(schema.vehicle.locationId, schema.location.id))
        .leftJoin(attached, eq(schema.location.parentLocationId, attached.locationId))
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
        /* Trailers only: which truck this one is hitched to. */
        attachedToVehicleId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;

      /* A trailer attached to a truck rides with it: if the truck already has a
         foreman, the trailer starts out in their custody. */
      let attachedLocId: string | null = null;
      let resolvedForeman = input.foremanEmployeeId ?? null;
      if (input.attachedToVehicleId) {
        if (input.vehicleType !== "trailer") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only trailers can be attached to a truck." });
        }
        const truck = await ctx.db.query.vehicle.findFirst({
          where: and(
            eq(schema.vehicle.id, input.attachedToVehicleId),
            eq(schema.vehicle.tenantId, tid),
          ),
        });
        if (!truck) throw new TRPCError({ code: "NOT_FOUND", message: "No such truck in this tenant" });
        if (truck.vehicleType !== "truck") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A trailer can only be attached to a truck." });
        }
        attachedLocId = truck.locationId;
        resolvedForeman = input.foremanEmployeeId ?? truck.foremanEmployeeId ?? null;
      }

      // Insert location row (type=vehicle) first since vehicle.locationId is NOT NULL.
      const [loc] = await ctx.db
        .insert(schema.location)
        .values({
          tenantId: tid,
          type: "vehicle",
          name: input.unit,
          projectId: input.projectId ?? null,
          parentLocationId: attachedLocId,
          /* The location column is the authoritative one for "who holds this
             container"; vehicle.foremanEmployeeId is the older, vehicle-only
             version of the same fact. Set both until the callers move over. */
          custodianEmployeeId: resolvedForeman,
        })
        .returning();
      if (!loc)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create vehicle location" });

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
          foremanEmployeeId: resolvedForeman,
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
        /* Trailers only. This is how a superintendent tells the system "this
           trailer is hitched to that truck" — the trailer then rides with the
           truck's foreman, tools included. Null detaches it. */
        attachedToVehicleId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const { id, attachedToVehicleId, ...changes } = input;
      const existing = await ctx.db.query.vehicle.findFirst({
        where: and(eq(schema.vehicle.id, id), eq(schema.vehicle.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such vehicle in this tenant" });

      /* A type flip on a vehicle that any assignment OR transfer row
         references — active, closed or historical, because the composite FKs
         (assignment 0016, transfer 0017) check (id, vehicle_type) and do not
         care about status — would violate a FK and surface as a raw Postgres
         500. Refuse it with a sentence instead (STI-203, and
         vehicleInCustodyRecord below). */
      if (changes.vehicleType && changes.vehicleType !== existing.vehicleType) {
        if (await vehicleInCustodyRecord(ctx.db, tid, id)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${existing.unit} appears as a ${existing.vehicleType} in the custody record — assignment history or a transfer — so its type cannot change. Register the ${changes.vehicleType} as a new vehicle instead.`,
          });
        }
      }

      /* `foremanEmployeeId` is not here: handing a truck over is
         `location.setCustodian`, which takes the tools aboard with it. */
      if (changes.unit && changes.unit !== existing.unit) {
        const clash = await ctx.db.query.vehicle.findFirst({
          where: and(eq(schema.vehicle.tenantId, tid), eq(schema.vehicle.unit, changes.unit)),
        });
        if (clash) throw new TRPCError({ code: "CONFLICT", message: `${changes.unit} is already in use` });
      }

      const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length && attachedToVehicleId === undefined) return existing;

      const result = await ctx.db.transaction(async (tx: any) => {
        if (Object.keys(patch).length) {
          await tx
            .update(schema.vehicle)
            .set({ ...patch, updatedAt: new Date() })
            .where(and(eq(schema.vehicle.id, id), eq(schema.vehicle.tenantId, tid)));
        }

        /* The location row is the vehicle under another name — a renamed unit
           has to rename the place tools are recorded as being. */
        if (patch.unit || patch.projectId !== undefined) {
          await tx
            .update(schema.location)
            .set({
              ...(patch.unit ? { name: patch.unit as string } : {}),
              ...(patch.projectId !== undefined ? { projectId: (patch.projectId as string) ?? null } : {}),
            })
            .where(eq(schema.location.id, existing.locationId));
        }

        /* The hitch: a trailer's location points at its truck's location. Only
           trailers take one, and only trucks can be the other end. */
        if (attachedToVehicleId !== undefined) {
          if (existing.vehicleType !== "trailer") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Only trailers can be attached to a truck." });
          }
          let truck: (typeof existing) | null = null;
          let parentLocId: string | null = null;
          if (attachedToVehicleId) {
            truck = await tx.query.vehicle.findFirst({
              where: and(eq(schema.vehicle.id, attachedToVehicleId), eq(schema.vehicle.tenantId, tid)),
            });
            if (!truck || truck.vehicleType !== "truck") {
              throw new TRPCError({ code: "BAD_REQUEST", message: "A trailer can only be attached to a truck in this tenant." });
            }
            parentLocId = truck.locationId;
          }
          await tx
            .update(schema.location)
            .set({ parentLocationId: parentLocId })
            .where(eq(schema.location.id, existing.locationId));

          /* Attaching to a truck that already has a foreman puts the trailer in
             that foreman's custody on the spot — tools inside follow, each with
             its own ledger entry. A truck with nobody assigned keeps the
             trailer's current custodian. */
          if (truck?.foremanEmployeeId) {
            const emp = await tx.query.employee.findFirst({
              where: and(eq(schema.employee.id, truck.foremanEmployeeId), eq(schema.employee.tenantId, tid)),
            });
            await applyContainerCustody({
              tx,
              tid,
              actorUserId: ctx.session.userId,
              locationId: existing.locationId,
              locationName: existing.unit,
              custodianId: truck.foremanEmployeeId,
              custodianName: emp?.name ?? null,
              moveContents: true,
              note: `Attached to ${truck.unit}`,
            });
          }
        }

        return patch;
      });

      await logEvent(ctx, {
        category: "vehicle", action: "update", entityType: "vehicle",
        entityId: id, entityLabel: existing.unit,
        details: { changed: Object.keys(result), attachedToVehicleId: attachedToVehicleId ?? null },
      });
      return existing;
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

      /* Any status counts, not just active — and BOTH referencing tables
         count, assignment (0016) and transfer (0017): the composite NO ACTION
         FKs block the delete while even a closed or declined row names this
         vehicle, so a guard that checked less would pass and the delete would
         still 500. That history is the point — "which trailer was TOOL-0007
         riding in when it went missing" must outlive the trailer's sale
         (STI-203, and vehicleInCustodyRecord above). */
      if (await vehicleInCustodyRecord(ctx.db, tid, input.id)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${existing.unit} is named in the custody record — assignment history or a transfer — so it cannot be deleted. The register keeps it so that history stays answerable.`,
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
