import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { MENTION_KINDS, type ChatMention } from "@stinventory/types";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { TRPCError } from "@trpc/server";
import {
  applyChatAction,
  canApplyAction,
  permissionForAction,
  requestChatAction,
  type ChatAction,
} from "../apply-action.js";

/*
  Confirm each mentioned id really is a row of that kind in this tenant.

  The client sends ids it got from `entity.search`, but a tRPC input is just
  JSON — nothing stops a crafted call from claiming an asset id belongs to
  another tenant. Since a verified mention goes on to outrank the parser and
  can end up naming the tool in a custody action, it has to be checked here.
*/
async function verifyMentions(
  db: any,
  tenantId: string,
  mentions: ChatMention[],
): Promise<ChatMention[]> {
  const table = {
    asset: schema.asset,
    employee: schema.employee,
    project: schema.project,
    location: schema.location,
    vehicle: schema.vehicle,
  } as const;

  const out: ChatMention[] = [];
  const seen = new Set<string>();

  for (const m of mentions) {
    const key = `${m.kind}:${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const t = table[m.kind];
    const [row] = await db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.id, m.id), eq(t.tenantId, tenantId)))
      .limit(1);
    if (row) out.push(m);
  }
  return out;
}

export const messagingRouter = router({
  // List channels the current user has access to (role-derived: foreman + equipment_admin + superintendent).
  listChannels: protectedProcedure.query(async ({ ctx }) => {
    const tid = ctx.session.tenantId;
    const userRole = ctx.session.roleName;
    const rows = await ctx.db
      .select()
      .from(schema.channel)
      .where(eq(schema.channel.tenantId, tid))
      .orderBy(asc(schema.channel.name));
    return rows;
  }),

  // Paginated messages for a channel, newest first.
  messages: protectedProcedure
    .input(
      z.object({
        channelId: z.string().uuid(),
        cursor: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const conditions = [eq(schema.message.tenantId, tid), eq(schema.message.channelId, input.channelId)];
      if (input.cursor) {
        conditions.push(lt(schema.message.createdAt, sql`(select created_at from "message" where id = ${input.cursor})`));
      }
      const rows = await ctx.db
        .select({
          id: schema.message.id,
          channelId: schema.message.channelId,
          authorUserId: schema.message.authorUserId,
          authorEmployeeId: schema.message.authorEmployeeId,
          body: schema.message.body,
          mentions: schema.message.mentions,
          processingStatus: schema.message.processingStatus,
          intentType: schema.message.intentType,
          intentPayload: schema.message.intentPayload,
          proposedAction: schema.message.proposedAction,
          executedTransactionIds: schema.message.executedTransactionIds,
          handledByUserId: schema.message.handledByUserId,
          handledAt: schema.message.handledAt,
          errorNote: schema.message.errorNote,
          createdAt: schema.message.createdAt,
          updatedAt: schema.message.updatedAt,
        })
        .from(schema.message)
        .where(and(...conditions))
        .orderBy(desc(schema.message.createdAt))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;

      /*
        Everything the bubble needs to become a card.

        The stored action carries ids and nothing else, so the chat could say
        "Hand over · 1 tool" and no more — not which tool, not to whom, not what
        became of it. A foreman reading his own messages back could not tell
        what he had recorded, which is the one thing chat capture has to be able
        to show him.

        Resolved in two queries for the whole page rather than per message: the
        same tool appears in several messages and the same person in most of
        them, so per-row lookups would be the classic N+1 on the busiest screen.
      */
      const actions = items.map((m) => (m.proposedAction ?? null) as ChatAction | null);
      const assetIds = [...new Set(actions.flatMap((a) => a?.assetIds ?? []))];
      const custodianIds = [
        ...new Set(actions.map((a) => a?.custodianId).filter((id): id is string => !!id)),
      ];

      const assets = assetIds.length
        ? await ctx.db
            .select({
              id: schema.asset.id,
              tag: schema.asset.tag,
              modelName: schema.asset.modelName,
              status: schema.asset.currentStatus,
              holderName: schema.employee.name,
            })
            .from(schema.asset)
            .leftJoin(schema.employee, eq(schema.asset.currentCustodianId, schema.employee.id))
            .where(and(eq(schema.asset.tenantId, tid), inArray(schema.asset.id, assetIds)))
        : [];
      const custodians = custodianIds.length
        ? await ctx.db
            .select({ id: schema.employee.id, name: schema.employee.name })
            .from(schema.employee)
            .where(and(eq(schema.employee.tenantId, tid), inArray(schema.employee.id, custodianIds)))
        : [];

      const assetById = new Map(assets.map((a) => [a.id, a]));
      const custodianById = new Map(custodians.map((c) => [c.id, c.name]));

      const withCards = items.map((m, i) => {
        const action = actions[i];
        return {
          ...m,
          card: action
            ? {
                tools: (action.assetIds ?? [])
                  .map((id) => assetById.get(id))
                  .filter((a): a is NonNullable<typeof a> => !!a),
                toName: action.custodianId ? custodianById.get(action.custodianId) ?? null : null,
              }
            : null,
        };
      });

      return { items: withCards, nextCursor: hasMore ? items[items.length - 1]?.id : null };
    }),

  // Send a message. Sets processingStatus = 'queued' for the background poller.
  send: protectedProcedure
    .input(
      z.object({
        channelId: z.string().uuid(),
        body: z.string().min(1).max(2000),
        /*
          Entities the author picked off the @ list. The sentence still says
          what happened and the parser still reads it — but these are already
          resolved, so the parser never has to guess which "rotary hammer" was
          meant. Empty is normal: typing a plain sentence is still the fastest
          way to file something, and it behaves exactly as before.
        */
        mentions: z
          .array(
            z.object({
              kind: z.enum(MENTION_KINDS),
              id: z.string().uuid(),
              label: z.string().max(200),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;

      /* Never trust the client's word for what an id is. A mention that does
         not resolve to a row of that kind in this tenant is dropped rather
         than rejected — the sentence is still worth filing, and the parser
         gets the same shot at it that an unmentioned message gets. */
      const mentions = input.mentions?.length
        ? await verifyMentions(ctx.db, tid, input.mentions)
        : [];

      const [row] = await ctx.db
        .insert(schema.message)
        .values({
          tenantId: tid,
          channelId: input.channelId,
          authorUserId: ctx.session.userId,
          authorEmployeeId: ctx.session.employeeId ?? null,
          body: input.body,
          mentions: mentions.length ? mentions : null,
          processingStatus: "queued",
        })
        .returning();
      if (!row) throw new Error("Failed to create message");
      await logEvent(ctx, {
        category: "messaging",
        action: "send",
        entityType: "message",
        entityId: row.id,
        details: { channelId: input.channelId, mentionCount: mentions.length },
      });
      return row;
    }),

  // Confirm a proposed action (foreman taps "Confirm" on the action card).
  confirmAction: protectedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const msg = await ctx.db.query.message.findFirst({
        where: and(eq(schema.message.id, input.messageId), eq(schema.message.tenantId, tid)),
      });
      if (!msg) throw new Error("Message not found");
      if (msg.processingStatus !== "action_proposed" || !msg.proposedAction) {
        throw new Error("Message does not have a proposed action to confirm");
      }

      const action = msg.proposedAction as ChatAction;

      const opts = {
        tenantId: tid,
        actorUserId: ctx.session.userId,
        actorEmployeeId: ctx.session.employeeId ?? null,
        permissions: ctx.session.permissions,
        action,
        refMessageId: msg.id,
      };

      /*
        Chat carries no more authority than the equivalent form. Someone without
        the permission an action costs does not get an error — their observation
        is still worth capturing — it becomes a request for the owning desk.
      */
      const allowed = canApplyAction(action.type, ctx.session.permissions);

      // Single executor shared with the background worker, so the two paths
      // cannot drift apart again. Throws rather than silently succeeding.
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
        The same bug action.submit had: `applied: allowed` reported the
        permission check rather than the outcome, and the message was stamped
        `action_executed` even when the executor had parked the change for a
        signature. The chat bubble then said "Recorded" about a tool that had
        not moved.

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
          handledByUserId: ctx.session.userId,
          handledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.message.id, input.messageId));

      await logEvent(ctx, {
        category: "messaging",
        action: allowed ? "confirm_action" : "request_action",
        entityType: "message",
        entityId: input.messageId,
        details: { actionType: action.type, transactionIds, taskId, outcome },
      });

      return { ok: true, outcome, awaitingApproval, awaitingVerification, transactionIds, taskId };
    }),

  // Manual entry by admin for pending_manual messages.
  /*
    The desk resolving a message the parser could not.

    This used to be a fourth hand-rolled copy of the custody logic, and it had
    drifted the way copies do: assign never closed the previous custody link,
    and repair/lost wrote `toState: { status }` alone — a partial snapshot,
    which the last-snapshot-wins fold reads as "custodian, project and location
    are now null". Rebuilding the projection from the log would have quietly
    emptied those tools.

    It now delegates to the same executor as chat confirm, the request approval
    and the manual forms. Which also means it supports every action type they
    do, rather than the five it had been frozen at.
  */
  manualEntry: protectedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        actionType: z.enum([
          "assign",
          "return",
          "transfer",
          "repair",
          "lost",
          "report",
          "intake",
        ]),
        assetIds: z.array(z.string().uuid()).max(50).default([]),
        custodianId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        locationId: z.string().uuid().optional(),
        note: z.string().max(2000).optional(),
        draft: z
          .object({
            tag: z.string().max(60).optional(),
            modelName: z.string().max(200).optional(),
            categoryName: z.string().max(120).optional(),
            serialNumber: z.string().max(120).optional(),
            acquisitionCost: z.string().max(20).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;

      const msg = await ctx.db.query.message.findFirst({
        where: and(eq(schema.message.id, input.messageId), eq(schema.message.tenantId, tid)),
      });
      if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });

      /* Permission is charged by action, not by "can you use this screen".
         Resolving somebody else's message into a write-off still costs
         `asset.manage`. */
      if (!canApplyAction(input.actionType, ctx.session.permissions)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Recording a ${input.actionType} requires ${permissionForAction(input.actionType)}.`,
        });
      }

      const { transactionIds } = await applyChatAction(ctx.db, {
        tenantId: tid,
        actorUserId: ctx.session.userId,
        actorEmployeeId: ctx.session.employeeId ?? null,
        permissions: ctx.session.permissions,
        action: {
          type: input.actionType,
          assetIds: input.assetIds,
          custodianId: input.custodianId,
          projectId: input.projectId,
          locationId: input.locationId,
          note: input.note || `Resolved by the desk: ${msg.body.slice(0, 120)}`,
          draft: input.draft,
        },
        refMessageId: msg.id,
      });

      await ctx.db
        .update(schema.message)
        .set({
          processingStatus: "action_executed",
          intentType: input.actionType,
          executedTransactionIds: transactionIds,
          handledByUserId: ctx.session.userId,
          handledAt: new Date(),
          errorNote: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.message.id, input.messageId));

      /* Tell whoever sent it that their message was dealt with — the desk
         acting on it is the answer they were waiting for. */
      if (msg.authorEmployeeId) {
        await ctx.db.insert(schema.notification).values({
          tenantId: tid,
          recipientEmployeeId: msg.authorEmployeeId,
          type: "request_approved",
          refType: "message",
          refId: msg.id,
          title: `Recorded: ${msg.body.slice(0, 80)}`,
          body: "The equipment desk sorted this one out for you.",
          channel: "in_app",
        });
      }

      await logEvent(ctx, {
        category: "messaging",
        action: "manual_entry",
        entityType: "message",
        entityId: input.messageId,
        details: { actionType: input.actionType, transactionIds },
      });

      return { ok: true, transactionIds };
    }),

  /*
    Close a message without recording anything.

    Every message has to reach a terminal state — chatter, duplicates and
    mistakes included. Without this the unresolved queue only grows, and a
    desk that cannot empty its queue stops reading it, which costs more than
    the odd unrecorded hand-off.
  */
  dismiss: protectedProcedure
    .input(z.object({ messageId: z.string().uuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const msg = await ctx.db.query.message.findFirst({
        where: and(eq(schema.message.id, input.messageId), eq(schema.message.tenantId, tid)),
      });
      if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (msg.processingStatus === "action_executed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This one already changed the register — it cannot be dismissed.",
        });
      }

      await ctx.db
        .update(schema.message)
        .set({
          processingStatus: "dismissed",
          handledByUserId: ctx.session.userId,
          handledAt: new Date(),
          errorNote: input.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.message.id, input.messageId));

      /* A dismissal the sender never hears about is the silence problem again,
         so they are told — with the reason, which is the useful part. */
      if (msg.authorEmployeeId) {
        await ctx.db.insert(schema.notification).values({
          tenantId: tid,
          recipientEmployeeId: msg.authorEmployeeId,
          type: "request_declined",
          refType: "message",
          refId: msg.id,
          title: `Nothing recorded: ${msg.body.slice(0, 80)}`,
          body: input.reason || "The equipment desk closed this without a change to the register.",
          channel: "in_app",
        });
      }

      await logEvent(ctx, {
        category: "messaging",
        action: "dismiss",
        entityType: "message",
        entityId: input.messageId,
        details: { reason: input.reason ?? null },
      });

      return { ok: true };
    }),

  // Admin: list pending_manual messages grouped by foreman.
  pendingActions: requirePermission("assignment.create")
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
      }).optional(),
    )
    .query(async ({ ctx }) => {
      const tid = ctx.session.tenantId;
      const rows = await ctx.db
        .select({
          id: schema.message.id,
          body: schema.message.body,
          mentions: schema.message.mentions,
          processingStatus: schema.message.processingStatus,
          intentType: schema.message.intentType,
          intentPayload: schema.message.intentPayload,
          errorNote: schema.message.errorNote,
          createdAt: schema.message.createdAt,
          authorUserId: schema.message.authorUserId,
          authorEmployeeId: schema.message.authorEmployeeId,
          channelId: schema.message.channelId,
          channelName: schema.channel.name,
        })
        .from(schema.message)
        .leftJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
        .where(
          and(
            eq(schema.message.tenantId, tid),
            inArray(schema.message.processingStatus, ["pending_manual", "error"]),
          ),
        )
        .orderBy(desc(schema.message.createdAt));
      return rows;
    }),

  // Admin oversight: all messages with intent readout.
  feed: requirePermission("assignment.read")
    .input(
      z.object({
        channelId: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(50),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const conditions = [eq(schema.message.tenantId, tid)];
      if (input?.channelId) conditions.push(eq(schema.message.channelId, input.channelId));

      const rows = await ctx.db
        .select({
          id: schema.message.id,
          body: schema.message.body,
          mentions: schema.message.mentions,
          processingStatus: schema.message.processingStatus,
          intentType: schema.message.intentType,
          intentPayload: schema.message.intentPayload,
          proposedAction: schema.message.proposedAction,
          executedTransactionIds: schema.message.executedTransactionIds,
          errorNote: schema.message.errorNote,
          createdAt: schema.message.createdAt,
          authorUserId: schema.message.authorUserId,
          authorEmployeeId: schema.message.authorEmployeeId,
        })
        .from(schema.message)
        .where(and(...conditions))
        .orderBy(desc(schema.message.createdAt))
        .limit(input?.limit ?? 50);

      return rows;
    }),

  // Verification queue: messages needing admin verification, grouped by status.
  pendingVerification: requirePermission("assignment.read")
    .query(async ({ ctx }) => {
      const tid = ctx.session.tenantId;
      const rows = await ctx.db
        .select({
          id: schema.message.id,
          body: schema.message.body,
          mentions: schema.message.mentions,
          processingStatus: schema.message.processingStatus,
          intentType: schema.message.intentType,
          intentPayload: schema.message.intentPayload,
          proposedAction: schema.message.proposedAction,
          errorNote: schema.message.errorNote,
          createdAt: schema.message.createdAt,
          authorUserId: schema.message.authorUserId,
          authorEmployeeId: schema.message.authorEmployeeId,
        })
        .from(schema.message)
        .where(
          and(
            eq(schema.message.tenantId, tid),
            inArray(schema.message.processingStatus, ["action_proposed", "pending_manual"]),
          ),
        )
        .orderBy(desc(schema.message.createdAt));
      return rows;
    }),
});
