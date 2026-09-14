import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@optix/db/schema";
import type { Database, Transaction } from "@optix/db";
import { EQUIPMENT_CLASSES, LOCATION_TYPES, vehicleStatus, type VehicleStatus } from "@optix/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { visibleProjectScope } from "../scope.js";
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
export async function applyContainerCustody(opts: {
  /* `Transaction`, not `any`. The custody chokepoint's signatures exist to make
     a raw `db` handle a COMPILE ERROR — that is the enforcement, and an `any`
     here quietly opted this function out of it while calling straight into
     `moveCustody`. See packages/db/src/index.ts:17. */
  tx: Transaction;
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

  /* Tenant-scoped. It was not, and the vehicle-mirror update immediately below
     always has been — so the omission read as an accident rather than a
     decision. Safe in practice because every caller selects `locationId` under
     a tenant predicate first, but there is no RLS here: the WHERE clause IS the
     isolation, and a control that depends on all its callers being careful is
     not a control. Found in review while a second caller was being added. */
  await tx
    .update(schema.location)
    .set({ custodianEmployeeId: custodianId })
    .where(and(eq(schema.location.id, locationId), eq(schema.location.tenantId, tid)));

  /* Keep the vehicle mirror in step. `location.custodianEmployeeId` is the
     authoritative column, but the vehicle list and import still read
     `vehicle.foremanEmployeeId`. */
  await tx
    .update(schema.equipment)
    .set({ foremanEmployeeId: custodianId, updatedAt: new Date() })
    .where(and(eq(schema.equipment.tenantId, tid), eq(schema.equipment.locationId, locationId)));

  if (!moveContents) return 0;

  /*
    Which tools are aboard? (STI-207 — the decision, recorded here and in
    `.claude/rules/custody-and-ledger.md`.)

    THE ACTIVE ASSIGNMENT IS THE TRUTH FOR A VEHICLE. Not the location row.

    Before STI-202 there was one signal — `asset.current_location_id` pointing
    at the vehicle's location row — so this query had no choice. STI-202 added
    `assignment.truck_id` / `trailer_id` and STI-203 made them what the product
    reads ("Rides in" on the jobsite table, Truck/Trailer on tool detail). That
    left TWO answers to "is this tool aboard TE-006", and only this query drove
    custody. A tool assigned the way the schema comment prescribes — trailerId
    set, locationId a yard — was aboard by the assignment and NOT aboard here,
    so handing the trailer over silently left its custody behind. It then read
    "Rides in: TE-006" while held by whoever had it before: no error, no
    divergence, the projection and the ledger agreeing with each other and both
    wrong about the world.

    So, for a container that IS a vehicle, PRECEDENCE — not a union:

      1. a tool with an ACTIVE ASSIGNMENT naming this vehicle is aboard;
      2. a tool with NO active assignment at all is aboard if its
         `current_location_id` is this container's location row.

    Rule 2 is not a second source of truth sneaking back in. An unheld tool has
    no assignment, so it has no `trailerId` to be aboard of — the location row
    is the ONLY record that it is sitting in this trailer. Without rule 2,
    handing a trailer BACK (`custodianEmployeeId: null`) closes every active
    link and nothing reopens; the manifest would then be permanently empty and
    the next hand-over would move zero tools while nineteen sat in the trailer.
    Review caught that before it shipped. The two sets are disjoint by
    construction — one demands an active assignment, the other demands none —
    so no tool can be moved twice, and the result is deduped by id anyway.

    For a container that is NOT a vehicle — a gang box, a yard, a warehouse
    shelf — `locationId` is the only signal there is and stays authoritative
    for held and unheld tools alike. That split is exactly what the schema
    comment on `assignment.locationId` prescribes: vehicles live in the vehicle
    columns, `locationId` carries non-vehicle places.

    Verified against the seed before changing it: every seeded trailer had the
    two signals in perfect agreement (0 tools would stop moving), and exactly
    one tool — assigned to a truck with its location elsewhere — starts moving
    that never did. That one row is the bug, demonstrated.
  */
  const [containerVehicle] = await tx
    .select({ id: schema.equipment.id, vehicleType: schema.equipment.vehicleType })
    .from(schema.equipment)
    .where(and(eq(schema.equipment.tenantId, tid), eq(schema.equipment.locationId, locationId)))
    .limit(1);

  const contentsColumns = {
    id: schema.smallTool.id,
    code: schema.smallTool.code,
    currentStatus: schema.smallTool.currentStatus,
    currentCustodianId: schema.smallTool.currentCustodianId,
    currentProjectId: schema.smallTool.currentProjectId,
    currentLocationId: schema.smallTool.currentLocationId,
  };

  /* Lost and disposed tools stay put either way — the record of where they went
     missing should not follow the trailer to its next foreman. */
  const aliveInTenant = notInArray(schema.smallTool.currentStatus, ["lost", "disposed"]);

  const byLocation = await tx
    .select(contentsColumns)
    .from(schema.smallTool)
    /* An UNHELD tool has no active assignment at all, so it has no
       `trailerId` to be aboard of — for those the location row is not a weaker
       second signal, it is the ONLY record that the tool is in this trailer.
       See the precedence rule below. */
    .leftJoin(
      schema.assignment,
      and(
        eq(schema.assignment.assetId, schema.smallTool.id),
        eq(schema.assignment.tenantId, tid),
        eq(schema.assignment.status, "active"),
      ),
    )
    .where(
      and(
        eq(schema.smallTool.tenantId, tid),
        eq(schema.smallTool.currentLocationId, locationId),
        aliveInTenant,
        containerVehicle ? isNull(schema.assignment.id) : undefined,
      ),
    );

  const byAssignment = containerVehicle
    ? await tx
        .select(contentsColumns)
        .from(schema.smallTool)
        /* Tenant-scoped on the JOIN as well as the WHERE. The composite FK
           behind these columns is tenant-blind — it proves the vehicle's TYPE
           and nothing about whose vehicle it is — so this predicate is the
           only isolation there is. */
        .innerJoin(
          schema.assignment,
          and(
            eq(schema.assignment.assetId, schema.smallTool.id),
            eq(schema.assignment.tenantId, tid),
            eq(schema.assignment.status, "active"),
            containerVehicle.vehicleType === "truck"
              ? eq(schema.assignment.truckId, containerVehicle.id)
              : eq(schema.assignment.trailerId, containerVehicle.id),
          ),
        )
        .where(and(eq(schema.smallTool.tenantId, tid), aliveInTenant))
    : [];

  /* Deduped by id: the two sets are disjoint by construction for a vehicle
     (one requires an active assignment, the other requires none), but a tool
     must never be moved twice whatever a future edit does here. */
  const seen = new Set<string>();
  const contents = [...byAssignment, ...byLocation].filter((a: any) =>
    seen.has(a.id) ? false : (seen.add(a.id), true),
  );

  const moving = contents.filter((a: any) => a.currentCustodianId !== custodianId);
  if (!moving.length) return 0;

  const ids = moving.map((a: any) => a.id);

  await tx
    .update(schema.smallTool)
    .set({
      currentCustodianId: custodianId,
      /* A container nobody carries holds tools nobody holds — they are back in
         stock, not assigned. */
      currentStatus: custodianId ? "assigned" : "available",
      updatedAt: new Date(),
    })
    .where(and(eq(schema.smallTool.tenantId, tid), inArray(schema.smallTool.id, ids)));

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
      /* The tool's OWN recorded place, not the container's location row.
         A hand-over changes WHO holds it, not where it is — the same reason
         the vehicle keys are carried forward rather than re-asserted.

         Before STI-207 these were always equal, because the contents query
         WAS `currentLocationId = locationId`; writing the container's id was
         a restatement of a fact already true. That identity is gone: a tool
         selected by its assignment can be recorded in a yard. Writing the
         container's location here would then stamp a location the projection
         never updates (this function deliberately never writes
         `currentLocationId`), so the fold and the register would disagree —
         a `stale_projection` divergence raised every six hours forever, and
         an `asset.rebuild` that silently relocates the tool. Caught in review
         before it shipped. */
      locationId: a.currentLocationId,
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
        /* Same reason as the link above: the tool's own place, so the snapshot
           folds back to the projection this function actually wrote. */
        locationId: a.currentLocationId,
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

        /*
          One truck per foreman, of EITHER ownership type (STI-502, widened
          2026-09-12 at the client's explicit direction — see the schema
          comment on `oneTruckPerForemanUq`). The partial unique index is the
          guarantee; this check is the MESSAGE.

          Without it the index still holds, but the desk sees a raw
          constraint violation as an INTERNAL_SERVER_ERROR — the same
          unreadable failure STI-104's delete guard was written to avoid. The
          ticket asks for "an error naming the current holder", and a
          constraint cannot name anything.

          Read the vehicle at THIS location first: only a truck can trip the
          index, so a trailer or a gang box skips the query entirely.
        */
        const [thisVehicle] = await ctx.db
          .select({
            id: schema.equipment.id,
            vehicleType: schema.equipment.vehicleType,
          })
          .from(schema.equipment)
          .where(and(eq(schema.equipment.tenantId, tid), eq(schema.equipment.locationId, input.locationId)))
          .limit(1);

        if (thisVehicle?.vehicleType === "truck") {
          const [heldTruck] = await ctx.db
            .select({ id: schema.equipment.id, code: schema.equipment.code })
            .from(schema.equipment)
            .where(
              and(
                eq(schema.equipment.tenantId, tid),
                eq(schema.equipment.vehicleType, "truck"),
                eq(schema.equipment.foremanEmployeeId, input.custodianEmployeeId),
              ),
            )
            .limit(1);

          /* Re-assigning the truck they already hold is a no-op, not a
             conflict — the index would not fire either. */
          if (heldTruck && heldTruck.id !== thisVehicle.id) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                `${emp.name} already has truck ${heldTruck.code}. A foreman drives one truck — ` +
                `detach ${heldTruck.code} first, then assign this one.`,
            });
          }
        }
      }

      const result = await ctx.db.transaction(async (tx) => {
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
  /*
    STI-302. A place is scoped by PROJECT, not by the asset ladder — a gang box
    is not a tool and has no custodian ladder of its own. `visibleProjectScope`
    is derived from the same four permissions, so the two cannot disagree.

    Locations with NO project stay visible to everyone who holds
    `location.read`. That is deliberate: they are the warehouses and the yard,
    every foreman collects from them, and hiding the Dallas Yard from the
    people who load out of it would break the product to protect nothing —
    the tools inside it are already scoped by the ladder.
  */
  list: requirePermission("location.read").query(async ({ ctx }) => {
    const scope = await visibleProjectScope(ctx.db, ctx.session);
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
      .where(
        and(
          eq(schema.location.tenantId, ctx.session.tenantId),
          scope.restrict
            ? or(
                isNull(schema.location.projectId),
                scope.ids.size ? inArray(schema.location.projectId, [...scope.ids]) : sql`false`,
              )
            : undefined,
        ),
      );
  }),

  create: requirePermission("location.manage")
    .input(
      z.object({
        /* LOCATION_TYPES, not `z.string()`. This accepted any string until
           2026-09-14 — the constant existed and this router did not import it,
           so a typo reached the column and every screen that switched on the
           type fell through to no branch. Migration 0072 is the floor under
           this; this is the readable error above it. */
        type: z.enum(LOCATION_TYPES),
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
        type: z.enum(LOCATION_TYPES).optional(),
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

      /* A vehicle location is named after its CODE; keep the two in step.
         Wrote `unit` until migration 0077 dropped it — `unit` and `code` held
         the identical value on all 88 real vehicles, so this is the same
         write, naming the column that survived. */
      if (patch.name && existing.type === "vehicle") {
        await ctx.db
          .update(schema.equipment)
          .set({ code: patch.name as string, updatedAt: new Date() })
          .where(and(eq(schema.equipment.tenantId, tid), eq(schema.equipment.locationId, id)));
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
        .select({ id: schema.smallTool.id })
        .from(schema.smallTool)
        .where(and(eq(schema.smallTool.tenantId, tid), eq(schema.smallTool.currentLocationId, input.id)))
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
        .select({ id: schema.equipment.id, code: schema.equipment.code })
        .from(schema.equipment)
        .where(and(eq(schema.equipment.tenantId, tid), eq(schema.equipment.locationId, input.id)))
        .limit(1);
      if (veh) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This is ${veh.code}'s location. Delete the vehicle instead.`,
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
async function vehicleInCustodyRecord(db: Database | Transaction, tid: string, vehicleId: string): Promise<boolean> {
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

export const equipmentRouter = router({
  /* Same project axis as `location.list`, same reasoning for the null case:
     an unassigned truck sitting in the yard belongs to no job, and hiding it
     would stop a foreman naming the rig he is actually driving. */
  list: requirePermission("vehicle.read")
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scope = await visibleProjectScope(ctx.db, ctx.session);
      const conditions = [eq(schema.equipment.tenantId, ctx.session.tenantId)];
      if (scope.restrict) {
        conditions.push(
          or(
            isNull(schema.equipment.projectId),
            scope.ids.size ? inArray(schema.equipment.projectId, [...scope.ids]) : sql`false`,
          )!,
        );
      }
      if (input?.projectId) conditions.push(eq(schema.equipment.projectId, input.projectId));
      const payee = alias(schema.employee, "payee");
      const foreman = alias(schema.employee, "foreman");
      const attached = alias(schema.equipment, "attached");
      const rows = await ctx.db
        .select({
          id: schema.equipment.id,
          vehicleType: schema.equipment.vehicleType,
          equipmentClass: schema.equipment.equipmentClass,
          code: schema.equipment.code,
          vin: schema.equipment.vin,
          description: schema.equipment.description,
          unit: schema.equipment.code,
          plate: schema.equipment.plate,
          makeModel: schema.equipment.makeModel,
          ownershipType: schema.equipment.ownershipType,
          payeeEmployeeId: schema.equipment.payeeEmployeeId,
          payeeName: payee.name,
          allowanceRate: schema.equipment.allowanceRate,
          allowanceFrequency: schema.equipment.allowanceFrequency,
          gpsLat: schema.equipment.gpsLat,
          gpsLng: schema.equipment.gpsLng,
          gpsAt: schema.equipment.gpsAt,
          gpsSource: schema.equipment.gpsSource,
          projectId: schema.equipment.projectId,
          projectName: schema.project.name,
          foremanEmployeeId: schema.equipment.foremanEmployeeId,
          foremanName: foreman.name,
          locationId: schema.equipment.locationId,
          locationName: schema.location.name,
          /* A trailer hitched to a truck: the trailer's location points at the
             truck's location, and this join turns that into "Truck 07". */
          attachedToVehicleId: attached.id,
          attachedToUnit: attached.code,
        })
        .from(schema.equipment)
        .leftJoin(payee, eq(schema.equipment.payeeEmployeeId, payee.id))
        .leftJoin(schema.project, eq(schema.equipment.projectId, schema.project.id))
        .leftJoin(foreman, eq(schema.equipment.foremanEmployeeId, foreman.id))
        .leftJoin(schema.location, eq(schema.equipment.locationId, schema.location.id))
        .leftJoin(attached, eq(schema.location.parentLocationId, attached.locationId))
        .where(and(...conditions))
        /* Matches the newest-first convention `project.list`/`employee.list`
           already use (UI-73/74) — an unordered list is heap order, which
           surfaces new rows wherever Postgres happens to put them rather than
           where somebody who just created one would look.

           This used to break ties on ownership type (company truck before
           personal), because `rigOf()` (apps/web/lib/rig.ts) picks the first
           truck in this array matching a foreman with a bare `.find()`, and a
           foreman could hold one of each at once. Since the schema tightened
           to one truck per foreman of EITHER kind (2026-09-12), that tie can
           no longer occur — a foreman's own truck rows never collide — so a
           plain newest-first order is enough. */
        .orderBy(desc(schema.equipment.createdAt));
      return rows.map((r) => ({
        ...r,
        /* Derived once, server-side, so the locations page and the map cannot
           disagree about whether a unit is online. See @optix/types/gps. */
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
        .update(schema.equipment)
        .set({
          gpsLat: input.lat,
          gpsLng: input.lng,
          gpsAt: new Date(),
          gpsSource: input.source ?? "manual",
          updatedAt: new Date(),
        })
        .where(and(eq(schema.equipment.id, input.id), eq(schema.equipment.tenantId, ctx.session.tenantId)))
        .returning();
      return row;
    }),

  create: requirePermission("vehicle.manage")
    .input(
      z.object({
        vehicleType: z.enum(["truck", "trailer"]),
        /* How the yard FILES this, as opposed to what the foreign keys need it
           to be. Optional and defaulted, so registering a machine is never
           blocked on deciding its category. */
        equipmentClass: z.enum(EQUIPMENT_CLASSES).default("vehicle"),
        /* One code, required. This took `unit` AND `code` as separate inputs
           until migration 0077 — which is the duplication seen from the API
           side: all 88 real vehicles had them equal. `unit`'s length limit
           (40) wins over `code`'s (60) because it was the required one and is
           what the real data fits. */
        code: z.string().min(1).max(40),
        description: z.string().max(2000).optional(),
        plate: z.string().optional(),
        /* Unconstrained on purpose — see the column comment. A malformed VIN is
           reported by the importer, not refused here, because refusing loses
           the whole vehicle over a typo in one field. */
        vin: z.string().max(40).optional(),
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
        const truck = await ctx.db.query.equipment.findFirst({
          where: and(
            eq(schema.equipment.id, input.attachedToVehicleId),
            eq(schema.equipment.tenantId, tid),
          ),
        });
        if (!truck) throw new TRPCError({ code: "NOT_FOUND", message: "No such truck in this tenant" });
        if (truck.vehicleType !== "truck") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A trailer can only be attached to a truck." });
        }
        attachedLocId = truck.locationId;
        resolvedForeman = input.foremanEmployeeId ?? truck.foremanEmployeeId ?? null;
      }

      /*
        BOTH INSERTS IN ONE TRANSACTION.

        A vehicle is two rows because it is two things: a machine in the
        register, and a PLACE tools sit in — `location` is what custody points
        at, which is how "TOOL-0007 is in trailer TE-011" is recorded at all.

        Without a transaction a failure between the two leaves a location of
        type `vehicle` with no vehicle behind it: a phantom container that
        shows up in every location picker, that no screen owns, and that
        nothing can delete because `vehicle.delete` is the only path that
        removes a vehicle location and there is no vehicle to delete.
      */
      const row = await ctx.db.transaction(async (tx) => {
        /*
          A duplicate code is refused HERE, with a readable message.

          `vehicle.create` had no duplicate check at all: the only thing
          stopping two trucks both being `TRK-034` was
          `equipment_code_per_tenant_uq`, and a raw 23505 reaches the user as
          "Something went wrong on our side. Try again." — which tells them
          nothing and reads like our fault rather than a code they can change.

          Case-insensitive, matching the index and `asset.create`. Inside the
          transaction so the check and the insert cannot straddle another
          writer; it is still check-then-act, and the index is what makes two
          simultaneous creates of one code fail rather than both land.
        */
        const [codeClash] = await tx
          .select({ code: schema.equipment.code })
          .from(schema.equipment)
          .where(
            and(
              eq(schema.equipment.tenantId, tid),
              sql`lower(${schema.equipment.code}) = lower(${input.code})`,
            ),
          )
          .limit(1);
        if (codeClash) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `${codeClash.code} is already in the equipment register. Codes identify a truck or trailer on every screen, so each one has to be unique.`,
          });
        }

        /*
          A VIN is unique where present (migration 0080). Nullable because
          Urban's VINs arrive over time, so most rows have none — but two
          vehicles carrying one VIN means one of them is wrong, and the
          manufacturer's number is the only permanent identity a truck has.
          Checked here so the answer is a sentence rather than a raw 23505.
        */
        if (input.vin?.trim()) {
          const [vinClash] = await tx
            .select({ code: schema.equipment.code, vin: schema.equipment.vin })
            .from(schema.equipment)
            .where(
              and(
                eq(schema.equipment.tenantId, tid),
                sql`lower(${schema.equipment.vin}) = lower(${input.vin.trim()})`,
              ),
            )
            .limit(1);
          if (vinClash) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `VIN ${vinClash.vin} is already on ${vinClash.code}. A VIN is the manufacturer's permanent identity, so two vehicles cannot share one.`,
            });
          }
        }

        // Location first: vehicle.locationId is NOT NULL.
        const [loc] = await tx
          .insert(schema.location)
          .values({
            tenantId: tid,
            type: "vehicle",
            name: input.code,
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

        const [created] = await tx
          .insert(schema.equipment)
          .values({
            tenantId: tid,
            locationId: loc.id,
            vehicleType: input.vehicleType,
            code: input.code,
            equipmentClass: input.equipmentClass,
            vin: input.vin ?? null,
            description: input.description ?? null,
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
        return created;
      });

      if (row) await logEvent(ctx, { category: "vehicle", action: "create", entityType: "vehicle", entityId: row.id, entityLabel: row.code });
      return row;
    }),
  update: requirePermission("vehicle.manage")
    .input(
      z.object({
        id: z.string().uuid(),
        /* Not nullable: `code` is NOT NULL since 0077, so clearing it is not a
           legal edit. It was nullable while `unit` carried the identity. */
        code: z.string().min(1).max(40).optional(),
        description: z.string().max(2000).nullable().optional(),
        plate: z.string().max(40).nullable().optional(),
        vin: z.string().max(40).nullable().optional(),
        makeModel: z.string().max(120).nullable().optional(),
        vehicleType: z.enum(["truck", "trailer"]).optional(),
        /* Freely changeable, unlike `vehicleType` above: nothing references it,
           so refiling a machine cannot orphan an assignment row. */
        equipmentClass: z.enum(EQUIPMENT_CLASSES).optional(),
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
      const existing = await ctx.db.query.equipment.findFirst({
        where: and(eq(schema.equipment.id, id), eq(schema.equipment.tenantId, tid)),
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
            message: `${existing.code} appears as a ${existing.vehicleType} in the custody record — assignment history or a transfer — so its type cannot change. Register the ${changes.vehicleType} as a new vehicle instead.`,
          });
        }
      }

      /* `foremanEmployeeId` is not here: handing a truck over is
         `location.setCustodian`, which takes the tools aboard with it. */
      if (changes.code && changes.code !== existing.code) {
        /* `lower()` on both sides, matching the unique index
           (`equipment_code_per_tenant_uq` is on `lower(code)`). A plain `eq`
           here let `trk-034` past when `TRK-034` existed, and the index then
           raised a raw 23505 the formatter renders as "Something went wrong on
           our side" — the same asymmetry `asset.update` had. */
        const clash = await ctx.db.query.equipment.findFirst({
          where: and(
            eq(schema.equipment.tenantId, tid),
            sql`lower(${schema.equipment.code}) = lower(${changes.code})`,
          ),
        });
        if (clash) throw new TRPCError({ code: "CONFLICT", message: `${changes.code} is already in use` });
      }

      const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length && attachedToVehicleId === undefined) return existing;

      const result = await ctx.db.transaction(async (tx) => {
        if (Object.keys(patch).length) {
          await tx
            .update(schema.equipment)
            .set({ ...patch, updatedAt: new Date() })
            .where(and(eq(schema.equipment.id, id), eq(schema.equipment.tenantId, tid)));
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
            .where(and(eq(schema.location.id, existing.locationId), eq(schema.location.tenantId, tid)));
        }

        /* The hitch: a trailer's location points at its truck's location. Only
           trailers take one, and only trucks can be the other end. */
        if (attachedToVehicleId !== undefined) {
          if (existing.vehicleType !== "trailer") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Only trailers can be attached to a truck." });
          }
          /* `undefined`, not `null` — `findFirst` returns undefined when it
             matches nothing. The `tx: any` above hid the difference until the
             parameter was properly typed. */
          let truck: (typeof existing) | null | undefined = null;
          let parentLocId: string | null = null;
          if (attachedToVehicleId) {
            truck = await tx.query.equipment.findFirst({
              where: and(eq(schema.equipment.id, attachedToVehicleId), eq(schema.equipment.tenantId, tid)),
            });
            if (!truck || truck.vehicleType !== "truck") {
              throw new TRPCError({ code: "BAD_REQUEST", message: "A trailer can only be attached to a truck in this tenant." });
            }
            parentLocId = truck.locationId;
          }
          await tx
            .update(schema.location)
            .set({ parentLocationId: parentLocId })
            .where(and(eq(schema.location.id, existing.locationId), eq(schema.location.tenantId, tid)));

          /* Attaching to a truck that already has a foreman puts the trailer in
             that foreman's custody on the spot — tools inside follow, each with
             its own ledger entry. A truck with nobody assigned keeps the
             trailer's current custodian.

             STI-208, DELIBERATE — do not "fix" this: the tools aboard keep
             whatever truck their last custody move recorded, which may be an
             older truck or an explicit null. `truck.id` is in scope here and
             the writer could assert it. It does not, because
             `assignment.truckId` records THE TRUCK A CUSTODY MOVE RECORDED —
             a fact about a hand-off, not a live tracking field. Asserting it
             on every hitch would append ledger events for tools nobody
             touched, and unhitching would then have no defensible answer: null
             would mean "affirmatively no truck" under the three-state rule,
             which is a claim nobody made. The reasoning is in
             `.claude/rules/custody-and-ledger.md`. */
          if (truck?.foremanEmployeeId) {
            const emp = await tx.query.employee.findFirst({
              where: and(eq(schema.employee.id, truck.foremanEmployeeId), eq(schema.employee.tenantId, tid)),
            });
            await applyContainerCustody({
              tx,
              tid,
              actorUserId: ctx.session.userId,
              locationId: existing.locationId,
              locationName: existing.code,
              custodianId: truck.foremanEmployeeId,
              custodianName: emp?.name ?? null,
              moveContents: true,
              note: `Attached to ${truck.code}`,
            });
          }
        }

        return patch;
      });

      await logEvent(ctx, {
        category: "vehicle", action: "update", entityType: "vehicle",
        entityId: id, entityLabel: existing.code,
        details: { changed: Object.keys(result), attachedToVehicleId: attachedToVehicleId ?? null },
      });
      return existing;
    }),

  delete: requirePermission("vehicle.manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const existing = await ctx.db.query.equipment.findFirst({
        where: and(eq(schema.equipment.id, input.id), eq(schema.equipment.tenantId, tid)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "No such vehicle in this tenant" });

      const [aboard] = await ctx.db
        .select({ id: schema.smallTool.id })
        .from(schema.smallTool)
        .where(and(eq(schema.smallTool.tenantId, tid), eq(schema.smallTool.currentLocationId, existing.locationId)))
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
          message: `${existing.code} is named in the custody record — assignment history or a transfer — so it cannot be deleted. The register keeps it so that history stays answerable.`,
        });
      }

      /* Vehicle first, then its location: the FK points that way. Both in one
         transaction — a failure between them leaves the location behind as a
         phantom container with no vehicle to delete it (see `create`). */
      await ctx.db.transaction(async (tx) => {
        await tx.delete(schema.equipment).where(and(eq(schema.equipment.id, input.id), eq(schema.equipment.tenantId, tid)));
        await tx.delete(schema.location).where(and(eq(schema.location.id, existing.locationId), eq(schema.location.tenantId, tid)));
      });

      await logEvent(ctx, {
        category: "vehicle", action: "delete", entityType: "vehicle",
        entityId: input.id, entityLabel: existing.code,
      });
      return { ok: true };
    }),
});
