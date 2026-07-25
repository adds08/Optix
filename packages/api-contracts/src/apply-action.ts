import { and, eq } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";

/*
  The single place a chat-derived intent becomes real state.

  Both callers route through here — `messaging.confirmAction` (a human tapped
  Confirm) and the background worker's auto-execute path. They used to carry
  separate implementations, and they drifted: confirmAction handled only
  assign/return/transfer, while the worker's auto-execute wrote transactions
  for `report` alone. Every other intent reported success and changed nothing,
  so a tool reported lost stayed `available` in the register.

  Invariant: an action either appends a transaction and moves the projection,
  or it throws. It never silently succeeds.
*/

export type ChatAction = {
  type: string;
  assetIds?: string[];
  custodianId?: string;
  projectId?: string;
  locationId?: string;
  note?: string;
};

/* Intents that move custody or change an asset's status. These always need a
   human to confirm — the model's confidence is an input to the workflow, not
   an authority over it (see docs/06-decisions.md ADR-4). */
export const CUSTODY_INTENTS = new Set(["assign", "transfer", "return", "repair", "lost"]);

/* Intents that are safe to apply without confirmation: they annotate or create
   a work item, and move nothing. */
export const AUTO_SAFE_INTENTS = new Set(["report", "task"]);

export type ApplyResult = { transactionIds: string[]; applied: number };

export async function applyChatAction(
  db: any,
  tenantId: string,
  actorUserId: string | null,
  action: ChatAction,
  refMessageId?: string,
): Promise<ApplyResult> {
  const assetIds = action.assetIds ?? [];
  if (!assetIds.length) {
    throw new Error("No assets resolved for this action");
  }

  const transactionIds: string[] = [];
  let applied = 0;

  for (const assetId of assetIds) {
    const asset = await db.query.asset.findFirst({
      where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tenantId)),
    });
    if (!asset) continue;

    const before = {
      status: asset.currentStatus,
      custodianId: asset.currentCustodianId,
      projectId: asset.currentProjectId,
      locationId: asset.currentLocationId,
    };

    let after = { ...before };
    let eventType = "status_change";
    let refType = "message";
    let refId: string | null = refMessageId ?? null;
    let note = action.note ?? "";

    switch (action.type) {
      case "assign": {
        if (!action.custodianId) throw new Error("Assign needs a custodian");
        const [assignment] = await db
          .insert(schema.assignment)
          .values({
            tenantId,
            assetId,
            custodianId: action.custodianId,
            projectId: action.projectId ?? asset.currentProjectId ?? null,
            locationId: action.locationId ?? asset.currentLocationId ?? null,
            type: "permanent",
            startDate: new Date().toISOString().slice(0, 10),
            status: "active",
            approvedBy: actorUserId,
          })
          .returning();
        after = {
          status: "assigned",
          custodianId: action.custodianId,
          projectId: action.projectId ?? asset.currentProjectId ?? null,
          locationId: action.locationId ?? asset.currentLocationId ?? null,
        };
        eventType = "assign";
        refType = "assignment";
        refId = assignment?.id ?? null;
        note = note || "Assigned via chat";
        break;
      }

      case "transfer": {
        if (!action.custodianId && !action.locationId && !action.projectId) {
          throw new Error("Transfer needs a destination");
        }
        // Close any assignment the previous holder had.
        const open = await db.query.assignment.findFirst({
          where: and(
            eq(schema.assignment.assetId, assetId),
            eq(schema.assignment.status, "active"),
            eq(schema.assignment.tenantId, tenantId),
          ),
        });
        if (open) {
          await db
            .update(schema.assignment)
            .set({ status: "transferred", updatedAt: new Date() })
            .where(eq(schema.assignment.id, open.id));
        }
        const [transfer] = await db
          .insert(schema.transfer)
          .values({
            tenantId,
            assetId,
            fromCustodianId: asset.currentCustodianId,
            toCustodianId: action.custodianId ?? asset.currentCustodianId,
            fromLocationId: asset.currentLocationId,
            toLocationId: action.locationId ?? asset.currentLocationId,
            fromProjectId: asset.currentProjectId,
            toProjectId: action.projectId ?? asset.currentProjectId,
            reason: "reallocation",
            status: "completed",
            requestedBy: actorUserId,
            approvedBy: actorUserId,
            completedAt: new Date(),
          })
          .returning();
        // A transfer with a new custodian opens their assignment.
        if (action.custodianId) {
          await db.insert(schema.assignment).values({
            tenantId,
            assetId,
            custodianId: action.custodianId,
            projectId: action.projectId ?? asset.currentProjectId ?? null,
            locationId: action.locationId ?? asset.currentLocationId ?? null,
            type: "permanent",
            startDate: new Date().toISOString().slice(0, 10),
            status: "active",
            approvedBy: actorUserId,
          });
        }
        after = {
          status: "assigned",
          custodianId: action.custodianId ?? asset.currentCustodianId,
          projectId: action.projectId ?? asset.currentProjectId,
          locationId: action.locationId ?? asset.currentLocationId,
        };
        eventType = "transfer";
        refType = "transfer";
        refId = transfer?.id ?? null;
        note = note || "Transferred via chat";
        break;
      }

      case "return": {
        const open = await db.query.assignment.findFirst({
          where: and(
            eq(schema.assignment.assetId, assetId),
            eq(schema.assignment.status, "active"),
            eq(schema.assignment.tenantId, tenantId),
          ),
        });
        if (open) {
          await db
            .update(schema.assignment)
            .set({ status: "returned", returnedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.assignment.id, open.id));
        }
        after = {
          status: "available",
          custodianId: null,
          projectId: null,
          locationId: action.locationId ?? asset.currentLocationId,
        };
        eventType = "return";
        refType = "assignment";
        refId = open?.id ?? null;
        note = note || "Returned via chat";
        break;
      }

      /* Previously fell through every branch: marked done, wrote nothing. */
      case "repair": {
        const open = await db.query.assignment.findFirst({
          where: and(
            eq(schema.assignment.assetId, assetId),
            eq(schema.assignment.status, "active"),
            eq(schema.assignment.tenantId, tenantId),
          ),
        });
        if (open) {
          await db
            .update(schema.assignment)
            .set({ status: "returned", returnedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.assignment.id, open.id));
        }
        after = { ...before, status: "in_maintenance", custodianId: null };
        eventType = "repair_start";
        note = note || "Sent for repair via chat";
        break;
      }

      /* Same class of bug: a tool reported lost stayed `available`. */
      case "lost": {
        after = { ...before, status: "lost" };
        eventType = "lost";
        note = note || "Reported missing via chat";
        break;
      }

      case "report": {
        // Annotation only — status and custody are untouched by design.
        after = { ...before };
        eventType = "status_change";
        note = note || "Note from the field";
        break;
      }

      default:
        throw new Error(`Cannot apply unsupported action type: ${action.type}`);
    }

    await db
      .update(schema.asset)
      .set({
        currentStatus: after.status,
        currentCustodianId: after.custodianId,
        currentProjectId: after.projectId,
        currentLocationId: after.locationId,
        updatedAt: new Date(),
      })
      .where(eq(schema.asset.id, assetId));

    const [tx] = await db
      .insert(schema.transaction)
      .values({
        tenantId,
        assetId,
        eventType,
        actorId: actorUserId,
        fromState: before,
        // The fold is last-snapshot-wins, so every writer must emit a COMPLETE
        // to_state — a partial object replaces rather than merges.
        toState: after,
        refType,
        refId,
        note,
      })
      .returning();

    if (tx) transactionIds.push(String(tx.id));
    applied++;
  }

  if (applied === 0) throw new Error("No matching assets in this tenant");
  return { transactionIds, applied };
}
