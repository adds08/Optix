import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@stinventory/db/schema";
import {
  applyChatAction,
  canApplyAction,
  permissionForAction,
  requestChatAction,
  type ApplyResult,
  type ChatAction,
} from "./apply-action.js";
import { logEvent } from "./audit.js";
import type { Context } from "./trpc.js";

/*
  The two "sign it off" paths, shared so the inbox's one-click resolve is
  guaranteed to be the SAME code as the Inbox's approve button and the chat
  confirm button.

  Three surfaces used to settle the same kind of thing in three ways; any of
  them drifting means a hand-off approved here behaves differently from the
  same hand-off approved there. `task.approve`, `messaging.confirmAction` and
  `inbox.resolve` all delegate here.

  Permission is charged against the ACTOR, not the original requester — that is
  the whole point of the gate, otherwise a request would be a way to perform an
  action nobody was allowed to perform.
*/

export async function approveTaskAction(
  ctx: Context,
  taskId: string,
  note?: string,
): Promise<{ ok: boolean; applied: number; awaitingApproval: number; transactionIds: string[] }> {
  const tid = ctx.session!.tenantId;
  const task = await ctx.db.query.task.findFirst({
    where: and(eq(schema.task.id, taskId), eq(schema.task.tenantId, tid)),
  });
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });

  if (!task.actionType || !task.pendingAction) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This task is a note, not a request — there is nothing to approve.",
    });
  }
  if (task.status !== "pending" && task.status !== "in_progress") {
    /* CONFLICT, matching the five custody decision procedures: "somebody got
       here first" is a race outcome, not a malformed request (STI-117). */
    throw new TRPCError({
      code: "CONFLICT",
      message: `This request was already ${task.status}.`,
    });
  }

  if (!canApplyAction(task.actionType, ctx.session!.permissions)) {
    const needed = permissionForAction(task.actionType);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: needed
        ? `Approving a ${task.actionType} request requires ${needed}.`
        : `${task.actionType} cannot be approved from here.`,
    });
  }

  const stored = task.pendingAction as Record<string, unknown>;
  /* Nulls were written for absent fields so the payload shape stays readable
     in the database; the executor wants them gone. */
  const action: ChatAction = {
    type: task.actionType,
    assetIds: (stored.assetIds as string[]) ?? [],
    ...(stored.custodianId ? { custodianId: stored.custodianId as string } : {}),
    ...(stored.projectId ? { projectId: stored.projectId as string } : {}),
    ...(stored.locationId ? { locationId: stored.locationId as string } : {}),
    ...(stored.draft ? { draft: stored.draft as ChatAction["draft"] } : {}),
    note: note || (stored.note as string) || `Approved from request: ${task.title}`,
  };

  /*
    Claim-then-act (STI-117). Two simultaneous confirms — a double-tapped chat
    approval on a slow connection is ordinary behaviour — both used to pass the
    status guard above, and each replayed the pendingAction into an append-only
    ledger that can never be pruned.

    The claim is one conditional UPDATE: only a row still pending/in_progress
    matches, two racing claims serialise on the row lock inside the statement
    itself, and the loser re-evaluates the predicate after the winner commits,
    matches nothing, and hears CONFLICT. Deliberately NOT a transaction held
    open across applyChatAction: that shape pinned one pool connection while
    applyChatAction's own per-asset transaction needed a second, so pool-size
    concurrent approves on DISTINCT tasks held all ten connections (max: 10,
    packages/db/src/index.ts) each waiting for an eleventh — client-side
    starvation Postgres's deadlock detector cannot see, wedging the whole
    shared pool. QA reproduced the wedge before this shape replaced it. The
    hazard is acquiring a connection while holding one, so nothing here may
    open a transaction around the apply.

    The claim marks the task completed BEFORE the action applies. Trade-off,
    named: a crash between this statement and the apply strands a task
    completed-but-unapplied — visible on the task itself, recoverable by
    re-raising the request. The alternatives were worse: stranding it pending
    invites a retry that duplicates ledger events, which is permanent; and a
    new "claimed" status would leak an unknown value into every task list and
    filter. If the apply throws, the catch below un-claims.
  */
  const claimed = await ctx.db
    .update(schema.task)
    .set({
      status: "completed",
      completedAt: new Date(),
      classification: "completed",
      assignedToEmployeeId: task.assignedToEmployeeId ?? ctx.session!.employeeId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.task.id, task.id),
        eq(schema.task.tenantId, tid),
        inArray(schema.task.status, ["pending", "in_progress"]),
      ),
    )
    .returning({ id: schema.task.id });
  if (!claimed.length) {
    const fresh = await ctx.db.query.task.findFirst({
      where: and(eq(schema.task.id, task.id), eq(schema.task.tenantId, tid)),
      columns: { status: true },
    });
    throw new TRPCError({
      code: "CONFLICT",
      message: `This request was already ${fresh?.status ?? "gone"}.`,
    });
  }

  let result: ApplyResult;
  try {
    result = await applyChatAction(ctx.db, {
      tenantId: tid,
      actorUserId: ctx.session!.userId,
      permissions: ctx.session!.permissions,
      action,
      refMessageId: task.sourceMessageId ?? undefined,
    });
  } catch (err) {
    /* Un-claim: put the row back the way the claim found it, so a failed apply
       leaves a request the desk can still act on rather than one that claims
       to be done. Best effort — a crash before this line is the
       stranded-completed trade-off named above. */
    await ctx.db
      .update(schema.task)
      .set({
        status: task.status,
        completedAt: null,
        classification: task.classification,
        assignedToEmployeeId: task.assignedToEmployeeId,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.task.id, task.id), eq(schema.task.tenantId, tid)));
    throw err;
  }

  /* Close the loop for the foreman who raised it — they asked for something
     and are entitled to hear that it happened. */
  if (task.requestedByEmployeeId) {
    await ctx.db.insert(schema.notification).values({
      tenantId: tid,
      recipientEmployeeId: task.requestedByEmployeeId,
      type: "request_approved",
      refType: "task",
      refId: task.id,
      title: `Approved: ${task.title}`,
      body: note || "The equipment desk signed this off.",
      channel: "in_app",
    });
  }

  await logEvent(ctx, {
    category: "task",
    action: "approve",
    entityType: "task",
    entityId: task.id,
    entityLabel: task.title,
    details: {
      actionType: task.actionType,
      transactionIds: result.transactionIds,
      awaitingApproval: result.awaitingApproval,
    },
  });

  return {
    ok: true,
    applied: result.applied,
    /* A hand-off that itself needs a second signature is parked as a pending
       transfer rather than applied — the request was approved, the custody
       move still needs its own approval. */
    awaitingApproval: result.awaitingApproval,
    transactionIds: result.transactionIds,
  };
}

export async function confirmMessageAction(
  ctx: Context,
  messageId: string,
): Promise<{
  ok: boolean;
  applied: number;
  outcome: "applied" | "awaiting_approval" | "requested";
  awaitingApproval: number;
  transactionIds: string[];
  taskId: string | null;
}> {
  const tid = ctx.session!.tenantId;
  const msg = await ctx.db.query.message.findFirst({
    where: and(eq(schema.message.id, messageId), eq(schema.message.tenantId, tid)),
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
  /* STI-204: same split as the task guard above — a message that never carried
     an action is a malformed ask, while one whose action is already settled is
     a race outcome, matching the claim's own CONFLICT below. Both still throw
     before the claim, exactly as the combined guard did. */
  if (!msg.proposedAction) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Message does not have a proposed action to confirm",
    });
  }
  if (msg.processingStatus !== "action_proposed") {
    throw new TRPCError({ code: "CONFLICT", message: "This message was already handled." });
  }

  const action = msg.proposedAction as ChatAction;

  const opts = {
    tenantId: tid,
    actorUserId: ctx.session!.userId,
    actorEmployeeId: ctx.session!.employeeId ?? null,
    permissions: ctx.session!.permissions,
    action,
    refMessageId: msg.id,
  };

  /*
    Chat carries no more authority than the equivalent form. Someone without
    the permission an action costs does not get an error — their observation
    is still worth capturing — it becomes a request for the owning desk.
  */
  const allowed = canApplyAction(action.type, ctx.session!.permissions);

  /*
    Claim-then-act (STI-117): the same double-confirm race as approveTaskAction
    above, on the surface a phone user actually double-taps. Two clicks of the
    chat Confirm used to produce two assign events and two assignment rows —
    the first closed as "transferred", a hand-off that never happened, now
    permanent in the ledger (QA reproduced it in a real browser).

    One conditional UPDATE is the claim: only a message still
    `action_proposed` matches, so the loser of a race matches nothing and
    hears CONFLICT. Never an outer transaction held across applyChatAction —
    that acquires its own connection, and holding one while waiting for
    another is the pool wedge described above.

    "processing" is already the vocabulary for "someone is working on this"
    (the messaging worker claims a parse the same way), and it fails the
    action_proposed guard, which is all a claim needs. It also makes a crash
    mid-apply self-healing: the request worker re-queues a message stuck
    `processing` after five minutes, the parser re-proposes it, and the user
    is asked again — the same recovery the worker's own crashes get.
  */
  const claimed = await ctx.db
    .update(schema.message)
    .set({ processingStatus: "processing", updatedAt: new Date() })
    .where(
      and(
        eq(schema.message.id, messageId),
        eq(schema.message.tenantId, tid),
        eq(schema.message.processingStatus, "action_proposed"),
      ),
    )
    .returning({ id: schema.message.id });
  if (!claimed.length) {
    throw new TRPCError({ code: "CONFLICT", message: "This message was already handled." });
  }

  let transactionIds: string[] = [];
  let taskId: string | null = null;
  let awaitingApproval = 0;

  try {
    if (allowed) {
      const res = await applyChatAction(ctx.db, opts);
      transactionIds = res.transactionIds;
      awaitingApproval = res.awaitingApproval;
    } else {
      const res = await requestChatAction(ctx.db, opts);
      transactionIds = res.transactionIds;
      taskId = res.taskId;
    }
  } catch (err) {
    /* Un-claim so the Confirm button still works after a failed apply. Best
       effort — if this line is never reached, the request worker's
       stuck-`processing` sweep re-proposes the message. */
    await ctx.db
      .update(schema.message)
      .set({ processingStatus: "action_proposed", updatedAt: new Date() })
      .where(and(eq(schema.message.id, messageId), eq(schema.message.tenantId, tid)));
    throw err;
  }

  /*
    The same bug action.submit had: `applied: allowed` reported the permission
    check rather than the outcome, and the message was stamped `action_executed`
    even when the executor had parked the change for a signature. The chat
    bubble then said "Recorded" about a tool that had not moved.

    A parked change is genuinely waiting on the desk, which is what
    `action_requested` already means — no new status needed.
  */
  const outcome = !allowed
    ? ("requested" as const)
    : awaitingApproval > 0
      ? ("awaiting_approval" as const)
      : ("applied" as const);

  /* A borrow DID move the register, so it is executed, not requested — the
     desk still has to look at it, but the tool is where the message said it
     is and the bubble must not imply otherwise. */
  await ctx.db
    .update(schema.message)
    .set({
      processingStatus:
        outcome === "applied" ? "action_executed" : "action_requested",
      executedTransactionIds: transactionIds,
      handledByUserId: ctx.session!.userId,
      handledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.message.id, messageId));

  await logEvent(ctx, {
    category: "messaging",
    action: allowed ? "confirm_action" : "request_action",
    entityType: "message",
    entityId: messageId,
    details: { actionType: action.type, transactionIds, taskId, outcome },
  });

  return {
    ok: true,
    applied: allowed ? 1 : 0,
    outcome,
    awaitingApproval,
    transactionIds,
    taskId,
  };
}
