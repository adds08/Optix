import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@stinventory/db/schema";
import {
  applyChatAction,
  canApplyAction,
  permissionForAction,
  requestChatAction,
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
    throw new TRPCError({
      code: "BAD_REQUEST",
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

  const result = await applyChatAction(ctx.db, {
    tenantId: tid,
    actorUserId: ctx.session!.userId,
    permissions: ctx.session!.permissions,
    action,
    refMessageId: task.sourceMessageId ?? undefined,
  });

  await ctx.db
    .update(schema.task)
    .set({
      status: "completed",
      completedAt: new Date(),
      classification: "completed",
      assignedToEmployeeId: task.assignedToEmployeeId ?? ctx.session!.employeeId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.task.id, task.id));

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
  outcome: "applied" | "borrowed" | "awaiting_approval" | "requested";
  awaitingApproval: number;
  awaitingVerification: number;
  transactionIds: string[];
  taskId: string | null;
}> {
  const tid = ctx.session!.tenantId;
  const msg = await ctx.db.query.message.findFirst({
    where: and(eq(schema.message.id, messageId), eq(schema.message.tenantId, tid)),
  });
  if (!msg) throw new Error("Message not found");
  if (msg.processingStatus !== "action_proposed" || !msg.proposedAction) {
    throw new Error("Message does not have a proposed action to confirm");
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

  let transactionIds: string[] = [];
  let taskId: string | null = null;
  let awaitingApproval = 0;
  let awaitingVerification = 0;

  if (allowed) {
    const res = await applyChatAction(ctx.db, opts);
    transactionIds = res.transactionIds;
    awaitingApproval = res.awaitingApproval;
    awaitingVerification = res.awaitingVerification;
  } else {
    const res = await requestChatAction(ctx.db, opts);
    transactionIds = res.transactionIds;
    taskId = res.taskId;
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
      : awaitingVerification > 0
        ? ("borrowed" as const)
        : ("applied" as const);

  /* A borrow DID move the register, so it is executed, not requested — the
     desk still has to look at it, but the tool is where the message said it
     is and the bubble must not imply otherwise. */
  await ctx.db
    .update(schema.message)
    .set({
      processingStatus:
        outcome === "applied" || outcome === "borrowed" ? "action_executed" : "action_requested",
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
    awaitingVerification,
    transactionIds,
    taskId,
  };
}
