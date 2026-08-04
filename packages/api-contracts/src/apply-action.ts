import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@stinventory/db/schema";
import { custodyOutcome, type CustodyOutcome } from "@stinventory/domain";
import { DEFAULT_HIGH_VALUE_THRESHOLD, formatAssetModel, type Permission } from "@stinventory/types";
import {
  ACTION_DEPARTMENTS,
  ACTION_PERMISSIONS,
  AUTO_SAFE_INTENTS,
  CUSTODY_INTENTS,
  REQUEST_TITLES,
} from "@stinventory/intent";
import { closeActiveCustody, moveCustody, projectForCustodian } from "./custody.js";

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

/* A tool the model heard about but the register has never seen. Deliberately
   thin: tag plus something descriptive are the two things somebody actually
   says out loud, and the rest is filled in on the confirm card or left blank.
   The tag is optional — a tool is only tagged once a label is physically on
   it — but the tool has to be describable, so at least one of make or
   description is required (see docs/12-model-field-split.md). */
export type AssetDraft = {
  tag?: string;
  make?: string;
  modelNumber?: string;
  description?: string;
  categoryName?: string;
  serialNumber?: string;
  acquisitionCost?: string;
};

export type ChatAction = {
  type: string;
  assetIds?: string[];
  custodianId?: string;
  projectId?: string;
  locationId?: string;
  note?: string;
  /* Only `intake` carries this — every other action names assets that exist. */
  draft?: AssetDraft;
};

/*
  Which intents need a human, which are safe to run unattended, and what each
  one costs — all re-exported from the catalog in @stinventory/intent rather
  than declared here.

  These were three hand-maintained maps sitting next to a fourth copy of the
  same list inside the LLM prompt. They are kept as named exports because a
  dozen call sites import them, but the catalog is now the only place the
  answers are written down.
*/
export { CUSTODY_INTENTS, AUTO_SAFE_INTENTS, ACTION_PERMISSIONS, ACTION_DEPARTMENTS };

export function permissionForAction(type: string): Permission | null {
  return ACTION_PERMISSIONS[type] ?? null;
}

/* False means "not allowed to apply directly" — the caller should fall back to
   requestChatAction rather than surface an error. Unknown action types are
   refused here and throw in the executor. */
export function canApplyAction(type: string, permissions: ReadonlySet<Permission>): boolean {
  if (!(type in ACTION_PERMISSIONS)) return false;
  const needed = permissionForAction(type);
  return needed === null || permissions.has(needed);
}

export type ApplyOptions = {
  tenantId: string;
  actorUserId: string | null;
  /* The requester as a domain person, so the desk can see whose request this
     is even after the login account goes away. */
  actorEmployeeId?: string | null;
  /* The actor's permissions. Required — passing an empty set denies everything
     except `report`, which is the correct default for an unauthenticated
     caller rather than a convenient one. */
  permissions: ReadonlySet<Permission>;
  action: ChatAction;
  refMessageId?: string;
};

export type ApplyResult = {
  transactionIds: string[];
  applied: number;
  /* Custody changes that were parked for a second signature rather than applied.
     The register did not move for these. */
  awaitingApproval: number;
  /* Applied as borrows and put in front of the equipment desk. The register DID
     move for these — counted apart from `applied` so the chat reply can say
     "recorded, the desk will confirm" rather than claiming it is settled. */
  awaitingVerification: number;
};

/*
  The same rule the routers use, per custodyOutcome in
  packages/domain/src/rules.ts. Chat has to agree with the forms exactly: this
  is the surface a foreman actually uses, so a rule that only the web forms
  honoured would be a rule that never applied to the people it is for.
*/
async function outcomeFor(
  db: any,
  tenantId: string,
  asset: { acquisitionCost: string | null },
  permissions: Set<string>,
): Promise<CustodyOutcome> {
  const settings = await db.query.tenantSettings.findFirst({
    where: eq(schema.tenantSettings.tenantId, tenantId),
  });
  return custodyOutcome({
    actorCanApprove: permissions.has("transfer.approve"),
    assetCost: asset.acquisitionCost != null ? Number(asset.acquisitionCost) : null,
    highValueThreshold: settings?.highValueThreshold ?? DEFAULT_HIGH_VALUE_THRESHOLD,
  });
}

export async function applyChatAction(db: any, opts: ApplyOptions): Promise<ApplyResult> {
  const { tenantId, actorUserId, permissions, action, refMessageId } = opts;

  if (!canApplyAction(action.type, permissions)) {
    const needed = permissionForAction(action.type);
    throw new Error(
      needed
        ? `Not allowed: ${action.type} requires ${needed}`
        : `Cannot apply unsupported action type: ${action.type}`,
    );
  }

  /* Intake runs before the asset loop because it is the one action whose
     subject does not exist yet — there is nothing to look up, only something
     to create. */
  if (action.type === "intake") {
    return applyIntake(db, tenantId, actorUserId, action, refMessageId);
  }

  const assetIds = action.assetIds ?? [];
  if (!assetIds.length) {
    throw new Error("No assets resolved for this action");
  }

  const transactionIds: string[] = [];
  let applied = 0;
  let awaitingApproval = 0;
  let awaitingVerification = 0;

  for (const assetId of assetIds) {
    const asset = await db.query.asset.findFirst({
      where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tenantId)),
    });
    if (!asset) continue;

    /* Custody moves get the rule applied before anything is written. */
    if (action.type === "assign" || action.type === "transfer") {
      const outcome = await outcomeFor(db, tenantId, asset, permissions as Set<string>);

      if (outcome !== "auto") {
        /*
          A hand-off the desk will look at has to name where it is going, or
          acting on it does nothing and refusing it means nothing.

          This used to default `toCustodianId` to the CURRENT holder, so a
          message whose destination the parser could not resolve produced a
          transfer reading "Dwayne → Dwayne": a row the desk cannot act on in
          either direction, and which tells the requester nothing when refused.
          If there is no destination of any kind, the message is not an
          actionable hand-off — it goes back as unresolved.
        */
        const toCustodianId = action.custodianId ?? null;
        const toLocationId = action.locationId ?? null;

        if (!toCustodianId && !toLocationId) {
          throw new Error(
            "This hand-off names nobody to hand it to. Say who is taking it, or record it from Custody.",
          );
        }

        /* Handing a tool to somebody sends it to their job. The chat rarely
           resolves a project, so the fallback is the recipient's current one. */
        const toProjectId =
          action.projectId ??
          (await projectForCustodian(db, tenantId, toCustodianId, asset.currentProjectId));

        const [transferRow] = await db
          .insert(schema.transfer)
          .values({
            tenantId,
            assetId,
            fromCustodianId: asset.currentCustodianId,
            toCustodianId,
            fromLocationId: asset.currentLocationId,
            /* Falling back to the current location is fine — a tool can change
               hands without moving. Falling back on the PERSON is what made the
               row meaningless. */
            toLocationId: toLocationId ?? asset.currentLocationId,
            fromProjectId: asset.currentProjectId,
            toProjectId,
            reason: "handoff",
            status: outcome === "approve" ? "pending_approval" : "pending_verification",
            requestedBy: actorUserId,
          })
          .returning();

        /* `approve` withholds the move entirely. `verify` is a foreman telling
           the desk where his tool went — the tool has already gone, so the
           register follows it now, as a borrow, and the desk sees the row. */
        if (outcome === "approve") {
          awaitingApproval++;
          continue;
        }

        const borrowProjectId = toProjectId ?? asset.currentProjectId ?? null;
        const borrowLocationId = toLocationId ?? asset.currentLocationId ?? null;
        await moveCustody(db, {
          tenantId,
          assetId,
          toCustodianId,
          projectId: borrowProjectId,
          locationId: borrowLocationId,
          actorUserId,
          type: "temporary",
        });
        await db
          .update(schema.asset)
          .set({
            currentCustodianId: toCustodianId,
            currentStatus: "assigned",
            currentProjectId: borrowProjectId,
            currentLocationId: borrowLocationId,
            updatedAt: new Date(),
          })
          .where(eq(schema.asset.id, assetId));
        const [borrowTx] = await db
          .insert(schema.transaction)
          .values({
            tenantId,
            assetId,
            eventType: "transfer",
            actorId: actorUserId,
            fromState: {
              status: asset.currentStatus,
              custodianId: asset.currentCustodianId,
              projectId: asset.currentProjectId,
              locationId: asset.currentLocationId,
            },
            toState: {
              status: "assigned",
              custodianId: toCustodianId,
              projectId: borrowProjectId,
              locationId: borrowLocationId,
            },
            refType: "transfer",
            refId: transferRow?.id ?? null,
            note: action.note ?? "Lent, awaiting equipment desk",
          })
          .returning();
        if (borrowTx?.id) transactionIds.push(borrowTx.id);
        awaitingVerification++;
        continue;
      }
    }

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
        /* Assigning a tool that is already out closes the previous link first,
           or the tool ends up in two people's custody at once. The project
           defaults to the custodian's current job when the action says nothing. */
        await closeActiveCustody(db, tenantId, assetId);
        const assignProjectId =
          action.projectId ?? (await projectForCustodian(db, tenantId, action.custodianId, asset.currentProjectId));
        const [assignment] = await db
          .insert(schema.assignment)
          .values({
            tenantId,
            assetId,
            custodianId: action.custodianId,
            projectId: assignProjectId,
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
          projectId: assignProjectId,
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
        await closeActiveCustody(db, tenantId, assetId);
        const transferProjectId =
          action.projectId ??
          (await projectForCustodian(db, tenantId, action.custodianId, asset.currentProjectId));
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
            toProjectId: transferProjectId,
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
            projectId: transferProjectId,
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
          projectId: transferProjectId,
          locationId: action.locationId ?? asset.currentLocationId,
        };
        eventType = "transfer";
        refType = "transfer";
        refId = transfer?.id ?? null;
        note = note || "Transferred via chat";
        break;
      }

      case "return": {
        const closed = await closeActiveCustody(db, tenantId, assetId, "returned");
        after = {
          status: "available",
          custodianId: null,
          projectId: null,
          locationId: action.locationId ?? asset.currentLocationId,
        };
        eventType = "return";
        refType = "assignment";
        refId = closed[0] ?? null;
        note = note || "Returned via chat";
        break;
      }

      /* Previously fell through every branch: marked done, wrote nothing. */
      case "repair": {
        await closeActiveCustody(db, tenantId, assetId, "returned");
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

  /* Parking everything for approval is a success, not a failure — the hand-off
     was recorded, it just needs a second signature. A borrow is more clearly a
     success: the register moved. Only a run that touched nothing is an error. */
  if (applied === 0 && awaitingApproval === 0 && awaitingVerification === 0) {
    throw new Error("No matching assets in this tenant");
  }
  return { transactionIds, applied, awaitingApproval, awaitingVerification };
}

/*
  Register a tool nobody has seen before.

  Writes the same pair `asset.create` does — the row plus its opening `tag`
  event — so a tool that entered by conversation is indistinguishable in the
  ledger from one typed into the form or loaded from a spreadsheet.

  The validation mirrors the intake gate in apps/api/src/messaging-worker.ts:
  a registration is complete with a tag and something descriptive, and a tag is
  optional entirely. A tool with neither a tag nor a description is nothing at
  all, which is the one case worth refusing over.
*/
async function applyIntake(
  db: any,
  tenantId: string,
  actorUserId: string | null,
  action: ChatAction,
  refMessageId?: string,
): Promise<ApplyResult> {
  const draft = action.draft ?? {};
  const tag = draft.tag?.trim();
  const make = draft.make?.trim();
  const modelNumber = draft.modelNumber?.trim();
  const description = draft.description?.trim();

  if (!tag && !make && !description) {
    throw new Error("A new tool needs a tag or something it is — a make or a description — before it can be registered");
  }

  if (tag) {
    const clash = await db.query.asset.findFirst({
      where: and(eq(schema.asset.tenantId, tenantId), eq(schema.asset.tag, tag)),
    });
    if (clash) throw new Error(`${tag} is already in the register`);
  }

  const label = formatAssetModel({ make, modelNumber, description }) || "Untagged tool";

  const [row] = await db
    .insert(schema.asset)
    .values({
      tenantId,
      tag: tag || null,
      make: make || null,
      modelNumber: modelNumber || null,
      description: description || null,
      categoryName: draft.categoryName?.trim() || null,
      serialNumber: draft.serialNumber?.trim() || null,
      acquisitionCost: draft.acquisitionCost?.trim() || null,
      createdBy: actorUserId,
      currentStatus: "available",
      currentLocationId: action.locationId ?? null,
      currentProjectId: action.projectId ?? null,
    })
    .returning();

  if (!row) throw new Error("Could not register that tool");

  const [tx] = await db
    .insert(schema.transaction)
    .values({
      tenantId,
      assetId: row.id,
      eventType: "tag",
      actorId: actorUserId,
      fromState: null,
      toState: {
        status: "available",
        custodianId: null,
        projectId: action.projectId ?? null,
        locationId: action.locationId ?? null,
      },
      refType: refMessageId ? "message" : "manual",
      refId: refMessageId ?? null,
      note: action.note || `Asset ${label} registered from a message`,
    })
    .returning();

  return { transactionIds: tx ? [String(tx.id)] : [], applied: 1, awaitingApproval: 0, awaitingVerification: 0 };
}

/* Which desk owns the follow-up, and what the approval card is headed. Both
   live in the catalog next to the intent they describe. */

export function departmentForAction(type: string, assetLabels?: { label: string }[]): string {
  if ((type === "assign" || type === "transfer") &&
      assetLabels?.some((a) => /TRU|TRA|trailer|truck/i.test(a.label))) {
    return "Fleet";
  }
  return ACTION_DEPARTMENTS[type] ?? "Equipment Admin";
}


export type RequestResult = { taskId: string | null; transactionIds: string[] };

/*
  The downgrade path: the actor described something real but is not authorised
  to apply it themselves.

  A foreman saying "UIC-1008 is broken" should never be a permission error in
  their face — the observation is valuable and they are the only one who has
  it. So it becomes a task for the owning desk plus an annotation on the tool's
  history, and the status change waits for someone holding `asset.manage`.
  Nothing about the register moves here by design.
*/
export async function requestChatAction(db: any, opts: ApplyOptions): Promise<RequestResult> {
  const { tenantId, actorUserId, action, refMessageId } = opts;
  const assetIds = action.assetIds ?? [];

  /* Two kinds of request reach here. Most name tools that exist and are being
     asked to change. Intake and purchase requests name a tool that does not
     exist yet — there is nothing to look up and nothing to annotate, so an
     empty asset list is correct rather than an error. */
  const named: any[] = assetIds.length
    ? await db.query.asset.findMany({
        where: and(eq(schema.asset.tenantId, tenantId), inArray(schema.asset.id, assetIds)),
      })
    : [];

  const aboutExisting = named.length > 0;
  if (assetIds.length && !aboutExisting) {
    throw new Error("No matching assets in this tenant");
  }

  const draft = action.draft ?? {};
  const subject = aboutExisting
    ? named.map((a) => a.tag).join(", ")
    : [draft.tag, formatAssetModel(draft)].filter(Boolean).join(" ") || "unspecified tool";

  const department = ACTION_DEPARTMENTS[action.type] ?? "Equipment Admin";
  const heading = REQUEST_TITLES[action.type] ?? "Action requested";
  const note = action.note?.trim() || "";

  const detail = aboutExisting
    ? []
    : [
        draft.serialNumber ? `Serial: ${draft.serialNumber}` : "",
        draft.categoryName ? `Category: ${draft.categoryName}` : "",
        draft.acquisitionCost ? `Cost: ${draft.acquisitionCost}` : "",
      ].filter(Boolean);

  const [task] = await db
    .insert(schema.task)
    .values({
      tenantId,
      title: `${heading}: ${subject}`.slice(0, 120),
      description: [note, ...detail, `Routed to ${department}. Awaiting sign-off.`]
        .filter(Boolean)
        .join("\n\n"),
      status: "pending",
      priority: action.type === "lost" ? "high" : "medium",
      assignedToEmployeeId: null, // unassigned: the desk claims it
      createdByUserId: actorUserId,
      requestedByEmployeeId: opts.actorEmployeeId ?? null,
      relatedAssetId: aboutExisting ? named[0].id : null,
      relatedProjectId: action.projectId ?? (aboutExisting ? named[0].currentProjectId : null) ?? null,
      source: "chat",
      sourceMessageId: refMessageId ?? null,
      /*
        The whole point of the change: keep the action, not just the sentence.
        Approving this task replays exactly this payload through
        applyChatAction, so the desk signs off on the thing the foreman asked
        for rather than retyping their best guess at it into a form.
      */
      actionType: action.type,
      pendingAction: {
        type: action.type,
        assetIds: assetIds,
        custodianId: action.custodianId ?? null,
        projectId: action.projectId ?? null,
        locationId: action.locationId ?? null,
        note: action.note ?? null,
        draft: action.draft ?? null,
      },
      department,
    })
    .returning();

  /* Annotate every named tool so the request shows up in its history even
     though its status is unchanged. */
  const transactionIds: string[] = [];
  for (const asset of named) {
    const state = {
      status: asset.currentStatus,
      custodianId: asset.currentCustodianId,
      projectId: asset.currentProjectId,
      locationId: asset.currentLocationId,
    };
    const [tx] = await db
      .insert(schema.transaction)
      .values({
        tenantId,
        assetId: asset.id,
        eventType: "status_change",
        actorId: actorUserId,
        fromState: state,
        toState: state, // unchanged: this records the ask, not a movement
        refType: "task",
        refId: task?.id ?? null,
        note: note ? `${heading} — ${note}` : heading,
      })
      .returning();
    if (tx) transactionIds.push(String(tx.id));
  }

  return { taskId: task?.id ?? null, transactionIds };
}
