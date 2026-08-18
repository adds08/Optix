import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Database, Transaction } from "@stinventory/db";
import * as schema from "@stinventory/db/schema";

/*
  The one place a custody link opens or closes.

  "At most one active Assignment per serialized asset" is the invariant the
  whole custody model rests on, and three writers were breaking it independently
  — `assignment.create` and `transfer.create`/`approve` inserted or moved custody
  without ever closing the row that was already active. The damage is quiet:
  the register shows the new holder, the custody screen shows the old one, and
  anything that reasons over "who holds what" (offboarding clearance, the value
  a foreman is carrying, which tools follow them to a new job) reads a person
  who gave the tool away weeks ago.

  Since STI-103 this file is no longer the only enforcement: the partial unique
  index `assignment_one_active_uq` (schema/asset.ts) makes a second active row a
  database error. The index is the backstop, not the mechanism — it turns the
  bug above into a loud failure instead of quiet corruption, but only this file
  knows that opening custody means closing what was active first. A writer that
  bypasses it now gets an exception rather than two custodians; it is still a
  bypass, and still wrong.

  Every path that changes who holds a tool goes through here — and since
  STI-102, only ever inside a transaction. The `Transaction` parameter is a
  real type, not `any`: passing a raw `db` is a compile error, because a raw
  handle is exactly how close-without-open and open-without-close shipped.
  The caller owns the transaction (it has its own projection and ledger writes
  to include); this file never opens one of its own.
*/
export type CustodyMove = {
  tenantId: string;
  assetId: string;
  /** Null means the tool is going back to a place, not a person. */
  toCustodianId: string | null;
  projectId: string | null;
  locationId: string | null;
  /*
    STI-202/203: the truck and trailer the tool rides on, both FKs to `vehicle`
    (the composite FKs in schema/asset.ts hold truckId to a truck and
    trailerId to a trailer). Persisted on the opened link as `?? null`, so the
    row always records an answer. Callers on custody paths must ALSO emit both
    keys in their ledger toState as EXPLICIT values (null means "affirmatively
    none"), never as omitted keys — an absent key folds to "not recorded",
    see the shape-boundary rule in packages/domain/src/fold.ts.
    NO default here, ever: `projectForCustodian` exists because tools follow
    the person, but a tool does not inherit the truck of whoever receives it.
  */
  truckId?: string | null;
  trailerId?: string | null;
  actorUserId: string | null;
  /** Recorded on the row being closed. `returned` when the tool comes back in. */
  closeAs?: "transferred" | "returned";
};

/** Closes every active link on the asset. Returns the ids it closed. */
export async function closeActiveCustody(
  tx: Transaction,
  tenantId: string,
  assetId: string,
  closeAs: "transferred" | "returned" = "transferred",
): Promise<string[]> {
  /* Serialise on the asset row before touching its links. Two concurrent moves
     that each read "nothing active" would each open a link — two custodians
     for one tool, the exact bug this file exists to prevent — so every custody
     write queues on this lock first. The asset row is the anchor because it
     exists even when no assignment does; the active rows alone cannot
     serialise the case where there is nothing to close yet. */
  await tx
    .select({ id: schema.asset.id })
    .from(schema.asset)
    .where(and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tenantId)))
    .for("update");

  const activeLinks = and(
    eq(schema.assignment.tenantId, tenantId),
    eq(schema.assignment.assetId, assetId),
    eq(schema.assignment.status, "active"),
  );

  /* Lock the links themselves before reading and closing them, so nothing can
     close or re-open them between this read and the update below. */
  await tx.select({ id: schema.assignment.id }).from(schema.assignment).where(activeLinks).for("update");

  /* Updated by predicate rather than by id. The local database was verified
     duplicate-free on 2026-08-16, and since STI-103 the partial unique index
     blocks NEW duplicate actives — but rows written before the index existed
     (production has not been checked) may still carry them, and closing only
     the first one found would leave the rest active forever. */
  const closed = await tx
    .update(schema.assignment)
    .set({
      status: closeAs,
      returnedAt: closeAs === "returned" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(activeLinks)
    .returning({ id: schema.assignment.id });
  return closed.map((r: { id: string }) => r.id);
}

/*
  The gate in front of the tenant-blind composite FK (STI-203).

  `vehicle_id_type_uq` is `(id, vehicle_type)` with NO tenant component, so at
  the database level an assignment in tenant A can happily reference tenant
  B's truck — the FK guarantees the vehicle's TYPE and nothing else. And when
  the type IS wrong, the FK raises a raw Postgres error that surfaces as a
  500. This lookup is therefore doing two jobs at once: the tenant WHERE
  clause is the isolation (there is no RLS, and only one tenant is seeded, so
  no test downstream of here will catch a missing predicate), and the type
  check turns "trailer picked into the truck slot" into an error a person can
  read. Every writer that records a truck or trailer must pass through it.

  Read-only, so like `projectForCustodian` it accepts either handle.
*/
export async function assertVehicleContext(
  db: Database | Transaction,
  tenantId: string,
  truckId: string | null | undefined,
  trailerId: string | null | undefined,
): Promise<void> {
  const check = async (id: string, wanted: "truck" | "trailer") => {
    const v = await db.query.vehicle.findFirst({
      where: and(eq(schema.vehicle.id, id), eq(schema.vehicle.tenantId, tenantId)),
      columns: { unit: true, vehicleType: true },
    });
    if (!v) throw new TRPCError({ code: "NOT_FOUND", message: `No such ${wanted} in this tenant.` });
    if (v.vehicleType !== wanted) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${v.unit} is a ${v.vehicleType}, not a ${wanted}. Pick it in the ${v.vehicleType} slot instead.`,
      });
    }
  };
  if (truckId) await check(truckId, "truck");
  if (trailerId) await check(trailerId, "trailer");
}

/** Closes whatever was active, then opens the new link if there is a holder. */
export async function moveCustody(tx: Transaction, move: CustodyMove): Promise<{ closedIds: string[]; openedId: string | null }> {
  const closedIds = await closeActiveCustody(tx, move.tenantId, move.assetId, move.closeAs ?? "transferred");

  if (!move.toCustodianId) return { closedIds, openedId: null };

  /* Checked here as well as at the input edge: this is the chokepoint, and a
     future caller that forgets the edge check must not be able to write a
     cross-tenant vehicle or ride the raw FK error to a 500. */
  await assertVehicleContext(tx, move.tenantId, move.truckId, move.trailerId);

  const [row] = await tx
    .insert(schema.assignment)
    .values({
      tenantId: move.tenantId,
      assetId: move.assetId,
      custodianId: move.toCustodianId,
      projectId: move.projectId,
      locationId: move.locationId,
      /* `?? null` and not a passthrough: an undefined key on the MOVE still
         writes an affirmative "no vehicle recorded" on the ROW. The three-state
         distinction (uuid / null / never-asked) lives in the ledger snapshot,
         not here — see the column comment in schema/asset.ts. */
      truckId: move.truckId ?? null,
      trailerId: move.trailerId ?? null,
      startDate: new Date().toISOString().slice(0, 10),
      status: "active",
      approvedBy: move.actorUserId,
    })
    .returning();

  return { closedIds, openedId: row?.id ?? null };
}

/*
  The truck/trailer keys of the newest ledger snapshot, verbatim (STI-203).

  For the writers that record "considered, and refused" — the two decline
  procedures — the from=to snapshot must describe the state at commit time
  WITHOUT changing what the ledger knows. The four base keys come off the
  locked asset row; these two cannot, because the asset table has no truck
  columns — the ledger snapshot is their only authoritative record. Emitting
  blind nulls here would stamp "affirmatively no truck" over a recorded
  `truckId` (a rebuild then blanks it — the shipped-three-times partial-
  snapshot bug, key by key), and inventing values would be worse. So: copy
  exactly the keys the newest snapshot has, absent staying absent, per the
  shape-boundary rule in packages/domain/src/fold.ts.

  Same occurred_at-then-id ordering as the fold's tie-break — bulk writers
  insert many events sharing a timestamp.
*/
export async function vehicleContextFromLedger(
  db: Database | Transaction,
  tenantId: string,
  assetId: string,
): Promise<{ truckId?: string | null; trailerId?: string | null }> {
  const [last] = await db
    .select({ toState: schema.transaction.toState })
    .from(schema.transaction)
    .where(
      and(
        eq(schema.transaction.tenantId, tenantId),
        eq(schema.transaction.assetId, assetId),
        isNotNull(schema.transaction.toState),
      ),
    )
    .orderBy(desc(schema.transaction.occurredAt), desc(schema.transaction.id))
    .limit(1);
  const s = (last?.toState ?? {}) as Record<string, unknown>;
  const out: { truckId?: string | null; trailerId?: string | null } = {};
  if ("truckId" in s) out.truckId = s.truckId as string | null;
  if ("trailerId" in s) out.trailerId = s.trailerId as string | null;
  return out;
}

/*
  The job a tool goes to when it is handed to somebody: that person's current
  job. Tools follow the foreman, not the site — so a form that lets the project
  be typed in independently of the person is how a tool ends up booked to a job
  its holder never worked. Every custody writer defaults here; a caller that
  explicitly passes a project still wins.

  Read-only, so unlike the writers above it accepts either handle — callers
  resolve the default before their transaction opens, or inside it.
*/
export async function projectForCustodian(
  db: Database | Transaction,
  tenantId: string,
  custodianId: string | null | undefined,
  fallback: string | null,
): Promise<string | null> {
  if (!custodianId) return fallback;
  const emp = await db.query.employee.findFirst({
    where: and(eq(schema.employee.id, custodianId), eq(schema.employee.tenantId, tenantId)),
    columns: { primaryProjectId: true },
  });
  return emp?.primaryProjectId ?? fallback;
}
