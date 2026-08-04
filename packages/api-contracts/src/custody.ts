import { and, desc, eq } from "drizzle-orm";
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

/*
  Who a tool belongs to when nobody has borrowed it.

  A foreman's hand-off opens a `temporary` link, which closes the `permanent`
  one — the invariant allows only one active link per asset, and relaxing that
  would mean every reader of "who holds this" has to learn which of two rows to
  believe. So the permanent owner is not stored a second time; it is read back
  out of the history, which is append-only and already has the answer.

  The most recent `permanent` row is the home, whatever its status: closing it
  as `transferred` is exactly what a borrow does, and it stays the home until
  the desk grants ownership to somebody else.

  Returns null for a tool that has only ever been lent, or never assigned.
*/
export async function homeCustodianId(
  db: any,
  tenantId: string,
  assetId: string,
): Promise<string | null> {
  const row = await db.query.assignment.findFirst({
    where: and(
      eq(schema.assignment.tenantId, tenantId),
      eq(schema.assignment.assetId, assetId),
      eq(schema.assignment.type, "permanent"),
    ),
    orderBy: [desc(schema.assignment.createdAt)],
  });
  return row?.custodianId ?? null;
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

/*
  The job a tool goes to when it is handed to somebody: that person's current
  job. Tools follow the foreman, not the site — so a form that lets the project
  be typed in independently of the person is how a tool ends up booked to a job
  its holder never worked. Every custody writer defaults here; a caller that
  explicitly passes a project still wins.
*/
export async function projectForCustodian(
  db: any,
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
