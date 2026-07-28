import { and, eq } from "drizzle-orm";
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

  Every path that changes who holds a tool goes through here.
*/
export type CustodyMove = {
  tenantId: string;
  assetId: string;
  /** Null means the tool is going back to a place, not a person. */
  toCustodianId: string | null;
  projectId: string | null;
  locationId: string | null;
  actorUserId: string | null;
  type?: "permanent" | "temporary";
  expectedEndDate?: string | null;
  /** Recorded on the row being closed. `returned` when the tool comes back in. */
  closeAs?: "transferred" | "returned";
};

/** Closes every active link on the asset. Returns the ids it closed. */
export async function closeActiveCustody(
  db: any,
  tenantId: string,
  assetId: string,
  closeAs: "transferred" | "returned" = "transferred",
): Promise<string[]> {
  /* Updated by predicate rather than by id: duplicates already exist in the
     wild from the writers this helper replaces, and closing only the first one
     found would leave the rest active forever. */
  const closed = await db
    .update(schema.assignment)
    .set({
      status: closeAs,
      returnedAt: closeAs === "returned" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.assignment.tenantId, tenantId),
        eq(schema.assignment.assetId, assetId),
        eq(schema.assignment.status, "active"),
      ),
    )
    .returning({ id: schema.assignment.id });
  return closed.map((r: { id: string }) => r.id);
}

/** Closes whatever was active, then opens the new link if there is a holder. */
export async function moveCustody(db: any, move: CustodyMove): Promise<{ closedIds: string[]; openedId: string | null }> {
  const closedIds = await closeActiveCustody(db, move.tenantId, move.assetId, move.closeAs ?? "transferred");

  if (!move.toCustodianId) return { closedIds, openedId: null };

  const [row] = await db
    .insert(schema.assignment)
    .values({
      tenantId: move.tenantId,
      assetId: move.assetId,
      custodianId: move.toCustodianId,
      projectId: move.projectId,
      locationId: move.locationId,
      type: move.type ?? "permanent",
      startDate: new Date().toISOString().slice(0, 10),
      expectedEndDate: move.expectedEndDate ?? null,
      status: "active",
      approvedBy: move.actorUserId,
    })
    .returning();

  return { closedIds, openedId: row?.id ?? null };
}
