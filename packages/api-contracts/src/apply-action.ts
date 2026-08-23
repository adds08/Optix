import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Database } from "@stinventory/db";
import * as schema from "@stinventory/db/schema";
import { custodyOutcome, type AssetStateSnapshot, type CustodyOutcome } from "@stinventory/domain";
import { DEFAULT_HIGH_VALUE_THRESHOLD, formatAssetModel, type Permission } from "@stinventory/types";
import {
  ACTION_DEPARTMENTS,
  ACTION_PERMISSIONS,
  AUTO_SAFE_INTENTS,
  CUSTODY_INTENTS,
  REQUEST_TITLES,
} from "@stinventory/intent";
import { assertVehicleContext, closeActiveCustody, moveCustody, projectForCustodian } from "./custody.js";

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
   description is required (see docs/built/12-model-field-split.md). */
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
  /* Which rig the tool rides out in (STI-203) — set by the bulk-move form;
     the chat parser does not resolve vehicles yet. Never defaulted. */
  truckId?: string | null;
  trailerId?: string | null;
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
): Promise<CustodyOutcome> {
  const settings = await db.query.tenantSettings.findFirst({
    where: eq(schema.tenantSettings.tenantId, tenantId),
  });
  return custodyOutcome({
    assetCost: asset.acquisitionCost != null ? Number(asset.acquisitionCost) : null,
    highValueThreshold: settings?.highValueThreshold ?? DEFAULT_HIGH_VALUE_THRESHOLD,
  });
}

/* `db` is the RAW handle on purpose — this function opens the transaction
   itself, one per asset, so a multi-asset action that fails partway keeps the
   assets it already moved. Custody helpers only ever see the tx inside. */
export async function applyChatAction(db: Database, opts: ApplyOptions): Promise<ApplyResult> {
  const { tenantId, actorUserId, permissions, action, refMessageId } = opts;

  if (!canApplyAction(action.type, permissions)) {
    const needed = permissionForAction(action.type);
    /* STI-204: callers normally downgrade a refusal to a desk request before
       ever calling this, so reaching either throw means a caller skipped
       canApplyAction — but the person on the other end still gets a coded
       refusal, not a 500. */
    throw new TRPCError({
      code: needed ? "FORBIDDEN" : "BAD_REQUEST",
      message: needed
        ? `Not allowed: ${action.type} requires ${needed}`
        : `Cannot apply unsupported action type: ${action.type}`,
    });
  }

  /* Intake runs before the asset loop because it is the one action whose
     subject does not exist yet — there is nothing to look up, only something
     to create. */
  if (action.type === "intake") {
    return applyIntake(db, tenantId, actorUserId, action, refMessageId);
  }

  const assetIds = action.assetIds ?? [];
  if (!assetIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No assets resolved for this action" });
  }

  /* Once, before the per-asset loop: the composite FK behind truckId/trailerId
     is tenant-blind and answers a wrong type with a raw 500 (custody.ts). */
  if (action.type === "assign" || action.type === "transfer") {
    await assertVehicleContext(db, tenantId, action.truckId, action.trailerId);
  }

  const transactionIds: string[] = [];
  let applied = 0;
  let awaitingApproval = 0;

  for (const assetId of assetIds) {
    const asset = await db.query.asset.findFirst({
      where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tenantId)),
    });
    if (!asset) continue;

    /*
      STI-120 — a retry must not re-apply what already landed.

      This loop writes one asset at a time, each in its own transaction. A
      five-asset action that fails on the third leaves two applied and three
      not; `confirmMessageAction` then catches, un-claims the message back to
      `action_proposed`, and the Confirm button works again. Pressing it
      re-ran the whole list, appending a second `assign` event for the two that
      had already moved — **permanent duplicate history in a log that cannot be
      pruned, with no crash involved.** QA reproduced it by ordinary retry.

      The ledger is its own idempotency key. Every event this path writes
      carries `refType: "message"` and `refId: <messageId>`, so "has this
      message already moved this asset" is a question the append-only log can
      answer, and answering it there means the guard cannot drift from what was
      actually written.

      Only for the message path: a direct form apply has no `refMessageId`, and
      each press of a form button is a genuinely new instruction. Skipping is
      the honest outcome rather than an error — the work IS done, and the
      caller asked for it to be done.
    */
    if (refMessageId) {
      const already = await db.query.transaction.findFirst({
        where: and(
          eq(schema.transaction.tenantId, tenantId),
          eq(schema.transaction.assetId, assetId),
          eq(schema.transaction.refMessageId, refMessageId),
        ),
      });
      if (already) {
        /* Counted as applied and its id returned, so the caller's totals and
           `executedTransactionIds` describe the whole action rather than only
           the part this attempt happened to do. A retry that reported "2
           applied" after a five-asset action would read as a partial success
           when it is a complete one. */
        transactionIds.push(String(already.id));
        applied++;
        continue;
      }
    }

    /* Custody moves get the rule applied before anything is written. */
    if (action.type === "assign" || action.type === "transfer") {
      const outcome = await outcomeFor(db, tenantId, asset);

      if (outcome === "approve") {
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
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This hand-off names nobody to hand it to. Say who is taking it, or record it from Custody.",
          });
        }

        /* `transfer.requested_by` is NOT NULL — a desk queue entry nobody
           raised is unactionable. Only surfaced when `db: any` became a real
           type (STI-102): the worker's no-session path can never reach here
           because canApplyAction refuses custody intents to an empty
           permission set, so an anonymous requester is a caller bug. */
        if (!actorUserId)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "This hand-off has no identifiable requester",
          });

        /* Handing a tool to somebody sends it to their job. The chat rarely
           resolves a project, so the fallback is the recipient's current one. */
        const toProjectId =
          action.projectId ??
          (await projectForCustodian(db, tenantId, toCustodianId, asset.currentProjectId));

        /*
          One open hand-off per tool — the same rule `transfer.create` enforces
          (routers/transfer.ts).

          STI-120's `refMessageId` guard above cannot cover this branch: it asks
          the ledger whether this message already moved this asset, and this
          branch writes NO ledger row at all — nothing has moved yet, only a
          queue row exists. So a re-confirmed message, or a second message
          naming the same tool, appended a second identical `handoff` row and
          the desk got two queue entries for one physical event (UI-66).
          Approve one and the other waits forever, pointing at a hand-off that
          already happened.

          `continue`, not a throw: this is inside the per-asset loop, and
          throwing on asset three of five recreates exactly the partial-failure
          retry STI-120 exists to survive. Counting it as already-awaiting is
          how the skip path above reports too — the desk entry IS there.
        */
        const openTransfer = await db.query.transfer.findFirst({
          where: and(
            eq(schema.transfer.tenantId, tenantId),
            eq(schema.transfer.assetId, assetId),
            eq(schema.transfer.status, "pending_approval"),
          ),
        });
        if (openTransfer) {
          awaitingApproval++;
          continue;
        }

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
            /* The rig the requester named rides the parked row (STI-203 /
               0017), so transfer.approve applies what was actually asked. */
            toTruckId: action.truckId ?? null,
            toTrailerId: action.trailerId ?? null,
            reason: "handoff",
            status: "pending_approval",
            requestedBy: actorUserId,
          })
          .returning();

        /* Withheld: the register does not move until a second person signs it
           off in the desk queue. The row above is what they act on. */
        if (transferRow) awaitingApproval++;
        continue;
      }
    }

    /* Typed as the snapshot, not inferred four-key: the shape-aware branches
       below assign vehicle keys into `after` (STI-203). */
    const before: AssetStateSnapshot = {
      status: asset.currentStatus,
      custodianId: asset.currentCustodianId,
      projectId: asset.currentProjectId,
      locationId: asset.currentLocationId,
    };

    /* Custody + projection + ledger commit or vanish together (STI-102), and
       the close inside custody.ts takes the asset-row lock so a chat move and
       a form move on the same tool serialise instead of both opening a link.
       Nothing network-shaped runs in here on purpose: postgres.js pins one
       pool connection for the life of a transaction, and this is the chat
       path — the LLM parse already happened, in the worker, before this call. */
    const ledgerId = await db.transaction(async (tx) => {
      let after: AssetStateSnapshot = { ...before };
      let eventType = "status_change";
      let refType = "message";
      let refId: string | null = refMessageId ?? null;
      let note = action.note ?? "";

      switch (action.type) {
        case "assign": {
          if (!action.custodianId)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Assign needs a custodian" });
          /* Assigning a tool that is already out closes the previous link first,
             or the tool ends up in two people's custody at once. The project
             defaults to the custodian's current job when the action says nothing. */
          await closeActiveCustody(tx, tenantId, assetId);
          const assignProjectId =
            action.projectId ?? (await projectForCustodian(tx, tenantId, action.custodianId, asset.currentProjectId));
          const [assignment] = await tx
            .insert(schema.assignment)
            .values({
              tenantId,
              assetId,
              custodianId: action.custodianId,
              projectId: assignProjectId,
              locationId: action.locationId ?? asset.currentLocationId ?? null,
              truckId: action.truckId ?? null,
              trailerId: action.trailerId ?? null,
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
            /* Both keys explicit, no current_* fallback: a new custody does
               not inherit the previous holder's rig (STI-203). */
            truckId: action.truckId ?? null,
            trailerId: action.trailerId ?? null,
          };
          eventType = "assign";
          refType = "assignment";
          refId = assignment?.id ?? null;
          note = note || "Assigned via chat";
          break;
        }

        case "transfer": {
          if (!action.custodianId && !action.locationId && !action.projectId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Transfer needs a destination" });
          }
          /* Same NOT NULL constraint as the pending branch above: a transfer
             row must name who moved it. */
          if (!actorUserId)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "This hand-off has no identifiable requester",
            });
          // Close any assignment the previous holder had.
          await closeActiveCustody(tx, tenantId, assetId);
          const transferProjectId =
            action.projectId ??
            (await projectForCustodian(tx, tenantId, action.custodianId, asset.currentProjectId));
          const [transfer] = await tx
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
              toTruckId: action.truckId ?? null,
              toTrailerId: action.trailerId ?? null,
              reason: "reallocation",
              status: "completed",
              requestedBy: actorUserId,
              approvedBy: actorUserId,
              completedAt: new Date(),
            })
            .returning();
          // A transfer with a new custodian opens their assignment.
          if (action.custodianId) {
            await tx.insert(schema.assignment).values({
              tenantId,
              assetId,
              custodianId: action.custodianId,
              projectId: transferProjectId,
              locationId: action.locationId ?? asset.currentLocationId ?? null,
              truckId: action.truckId ?? null,
              trailerId: action.trailerId ?? null,
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
            /* Explicit, never inherited from the previous holder (STI-203). */
            truckId: action.truckId ?? null,
            trailerId: action.trailerId ?? null,
          };
          eventType = "transfer";
          refType = "transfer";
          refId = transfer?.id ?? null;
          note = note || "Transferred via chat";
          break;
        }

        case "return": {
          const closed = await closeActiveCustody(tx, tenantId, assetId, "returned");
          after = {
            status: "available",
            custodianId: null,
            projectId: null,
            locationId: action.locationId ?? asset.currentLocationId,
            /* Explicit nulls (STI-203): a return means the tool came back IN,
               out of whoever's rig — an affirmative fact, same as the form
               return in routers/assignment.ts. */
            truckId: null,
            trailerId: null,
          };
          eventType = "return";
          refType = "assignment";
          refId = closed[0] ?? null;
          note = note || "Returned via chat";
          break;
        }

        /* Previously fell through every branch: marked done, wrote nothing. */
        case "repair": {
          await closeActiveCustody(tx, tenantId, assetId, "returned");
          /* Custody closes, so the vehicle keys are affirmatively null too —
             a tool in the shop is not riding anyone's rig (STI-203). `lost`
             below deliberately stays silent on them instead: nobody knows
             where a lost tool is riding, and absent keys are how a snapshot
             says "unknown" (packages/domain/src/fold.ts). */
          after = { ...before, status: "in_maintenance", custodianId: null, truckId: null, trailerId: null };
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
          /* Reachable only when an intent is in the catalog but has no case
             here — executor drift, not a bad request (an unknown type was
             already refused above, before any write). */
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Cannot apply unsupported action type: ${action.type}`,
          });
      }

      await tx
        .update(schema.asset)
        .set({
          currentStatus: after.status,
          currentCustodianId: after.custodianId,
          currentProjectId: after.projectId,
          currentLocationId: after.locationId,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tenantId)));

      const [ledgerRow] = await tx
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
          /* STI-120. `refType`/`refId` name the row this event is ABOUT — for
             an assign they become `assignment`/<id>, overwriting the message
             defaults set above. The cause is recorded separately so both
             survive, and so a retry can ask "have I already moved this asset
             for this message". Null on the form paths, which carry no
             message and where each press is a new instruction. */
          refMessageId: refMessageId ?? null,
          note,
        })
        .returning();
      return ledgerRow ? String(ledgerRow.id) : null;
    });

    if (ledgerId) transactionIds.push(ledgerId);
    applied++;
  }

  /* Parking everything for approval is a success, not a failure — the hand-off
     was recorded, it just needs a second signature. A borrow is more clearly a
     success: the register moved. Only a run that touched nothing is an error. */
  if (applied === 0 && awaitingApproval === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No matching assets in this tenant" });
  }
  return { transactionIds, applied, awaitingApproval };
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
    /* STI-204: this sentence is written for the person typing, and it used to
       reach them as INTERNAL_SERVER_ERROR — guidance rendered as a crash. */
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A new tool needs a tag or something it is — a make or a description — before it can be registered",
    });
  }

  if (tag) {
    const clash = await db.query.asset.findFirst({
      where: and(eq(schema.asset.tenantId, tenantId), eq(schema.asset.tag, tag)),
    });
    /* CONFLICT, matching the same clash in asset.update — the two surfaces
       must disagree with the user in the same voice. */
    if (clash)
      throw new TRPCError({ code: "CONFLICT", message: `${tag} is already in the register` });
  }

  const label = formatAssetModel({ make, modelNumber, description }) || "Untagged tool";

  /*
    STI-118: the register row and its genesis ledger event commit together or
    not at all.

    These were two unwrapped statements. A failure between them — a dropped
    connection, a constraint, a restart — left an asset in the register with
    NO ledger evidence at all, which is the one state the whole design forbids:
    `foldAssetState` has nothing to fold, `verifyProjection` reports it as a
    divergence with no evidence, and `asset.rebuild` deliberately REFUSES to
    repair it (repairing on no evidence would blank a live custodian). So the
    row could only ever be fixed by hand.

    This is the CHAT path, which is what made it worth fixing over the other
    two-statement writers: it is reachable by any foreman typing a sentence,
    not just by an administrator on a form.

    Nothing network-shaped runs inside — postgres.js pins one pool connection
    for the life of a transaction, and the LLM parse already happened in the
    worker before this call.
  */
  const { row, tx } = await db.transaction(async (trx: any) => {
  const [row] = await trx
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

  if (!row)
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not register that tool" });

  const [tx] = await trx
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
      /* Same cause column as the custody path (STI-120). Here `refType`/`refId`
         already hold the message, so this is redundant TODAY — and it is
         written anyway, because the retry guard queries one column and an
         intake event that answered a different one would be invisible to it.
         An intake is also the case where a duplicate is most visible: a second
         tool in the register, not just a second event. */
      refMessageId: refMessageId ?? null,
      note: action.note || `Asset ${label} registered from a message`,
    })
    .returning();

    return { row, tx };
  });

  return { transactionIds: tx ? [String(tx.id)] : [], applied: 1, awaitingApproval: 0 };
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
    throw new TRPCError({ code: "NOT_FOUND", message: "No matching assets in this tenant" });
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
        /* Kept so approval replays the rig the requester named (STI-203). */
        truckId: action.truckId ?? null,
        trailerId: action.trailerId ?? null,
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
