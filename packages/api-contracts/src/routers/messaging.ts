import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { applyChatAction, type ChatAction } from "../apply-action.js";

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
      return { items, nextCursor: hasMore ? items[items.length - 1]?.id : null };
    }),

  // Send a message. Sets processingStatus = 'queued' for the background poller.
  send: protectedProcedure
    .input(
      z.object({
        channelId: z.string().uuid(),
        body: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const [row] = await ctx.db
        .insert(schema.message)
        .values({
          tenantId: tid,
          channelId: input.channelId,
          authorUserId: ctx.session.userId,
          authorEmployeeId: ctx.session.employeeId ?? null,
          body: input.body,
          processingStatus: "queued",
        })
        .returning();
      if (!row) throw new Error("Failed to create message");
      await logEvent(ctx, {
        category: "messaging",
        action: "send",
        entityType: "message",
        entityId: row.id,
        details: { channelId: input.channelId },
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

      // Single executor shared with the background worker, so the two paths
      // cannot drift apart again. Throws rather than silently succeeding.
      const { transactionIds } = await applyChatAction(
        ctx.db,
        tid,
        ctx.session.userId,
        action,
        msg.id,
      );

      await ctx.db
        .update(schema.message)
        .set({
          processingStatus: "action_executed",
          executedTransactionIds: transactionIds,
          handledByUserId: ctx.session.userId,
          handledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.message.id, input.messageId));

      await logEvent(ctx, {
        category: "messaging",
        action: "confirm_action",
        entityType: "message",
        entityId: input.messageId,
        details: { actionType: action.type, transactionIds },
      });

      return { ok: true, transactionIds };
    }),

  // Manual entry by admin for pending_manual messages.
  manualEntry: requirePermission("assignment.create")
    .input(
      z.object({
        messageId: z.string().uuid(),
        actionType: z.enum(["assign", "return", "transfer", "repair", "lost"]),
        assetIds: z.array(z.string().uuid()),
        custodianId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        locationId: z.string().uuid().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      let transactionIds: string[] = [];

      if (input.actionType === "assign" && input.custodianId) {
        for (const assetId of input.assetIds) {
          const asset = await ctx.db.query.asset.findFirst({
            where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tid)),
          });
          if (!asset) continue;

          const [assignment] = await ctx.db
            .insert(schema.assignment)
            .values({
              tenantId: tid,
              assetId,
              custodianId: input.custodianId,
              projectId: input.projectId ?? null,
              locationId: input.locationId ?? null,
              type: "permanent",
              startDate: new Date().toISOString().slice(0, 10),
              status: "active",
              approvedBy: ctx.session.userId,
            })
            .returning();
          if (!assignment) continue;

          await ctx.db
            .update(schema.asset)
            .set({
              currentStatus: "assigned",
              currentCustodianId: input.custodianId,
              currentProjectId: input.projectId ?? asset.currentProjectId,
              currentLocationId: input.locationId ?? asset.currentLocationId,
              updatedAt: new Date(),
            })
            .where(eq(schema.asset.id, assetId));

          const [tx] = await ctx.db
            .insert(schema.transaction)
            .values({
              tenantId: tid,
              assetId,
              eventType: "assign",
              actorId: ctx.session.userId,
              fromState: { status: asset.currentStatus, custodianId: asset.currentCustodianId, projectId: asset.currentProjectId, locationId: asset.currentLocationId },
              toState: { status: "assigned", custodianId: input.custodianId, projectId: input.projectId ?? null, locationId: input.locationId ?? null },
              refType: "assignment",
              refId: assignment.id,
              note: input.note ?? "Manual entry",
            })
            .returning();
          if (tx) transactionIds.push(String(tx.id));
        }
      } else if (input.actionType === "return") {
        for (const assetId of input.assetIds) {
          const existing = await ctx.db.query.assignment.findFirst({
            where: and(eq(schema.assignment.assetId, assetId), eq(schema.assignment.status, "active"), eq(schema.assignment.tenantId, tid)),
          });
          if (existing) {
            await ctx.db
              .update(schema.assignment)
              .set({ status: "returned", returnedAt: new Date(), updatedAt: new Date() })
              .where(eq(schema.assignment.id, existing.id));
          }
          const asset = await ctx.db.query.asset.findFirst({
            where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tid)),
          });
          await ctx.db
            .update(schema.asset)
            .set({ currentStatus: "available", currentCustodianId: null, updatedAt: new Date() })
            .where(eq(schema.asset.id, assetId));

          const [tx] = await ctx.db
            .insert(schema.transaction)
            .values({
              tenantId: tid,
              assetId,
              eventType: "return",
              actorId: ctx.session.userId,
              fromState: asset ? { status: asset.currentStatus, custodianId: asset.currentCustodianId, projectId: asset.currentProjectId, locationId: asset.currentLocationId } : null,
              toState: { status: "available", custodianId: null, projectId: null, locationId: null },
              refType: "assignment",
              refId: existing?.id ?? null,
              note: input.note ?? "Manual return",
            })
            .returning();
          if (tx) transactionIds.push(String(tx.id));
        }
      } else if (input.actionType === "transfer" && input.custodianId) {
        for (const assetId of input.assetIds) {
          const asset = await ctx.db.query.asset.findFirst({
            where: and(eq(schema.asset.id, assetId), eq(schema.asset.tenantId, tid)),
          });
          if (!asset) continue;

          const [transfer] = await ctx.db
            .insert(schema.transfer)
            .values({
              tenantId: tid,
              assetId,
              fromCustodianId: asset.currentCustodianId,
              toCustodianId: input.custodianId,
              fromLocationId: asset.currentLocationId,
              toLocationId: input.locationId ?? null,
              fromProjectId: asset.currentProjectId,
              toProjectId: input.projectId ?? null,
              reason: "reallocation",
              status: "completed",
              requestedBy: ctx.session.userId,
              approvedBy: ctx.session.userId,
              completedAt: new Date(),
            })
            .returning();
          if (!transfer) continue;

          await ctx.db
            .update(schema.asset)
            .set({
              currentCustodianId: input.custodianId,
              currentLocationId: input.locationId ?? asset.currentLocationId,
              currentProjectId: input.projectId ?? asset.currentProjectId,
              updatedAt: new Date(),
            })
            .where(eq(schema.asset.id, assetId));

          const [tx] = await ctx.db
            .insert(schema.transaction)
            .values({
              tenantId: tid,
              assetId,
              eventType: "transfer",
              actorId: ctx.session.userId,
              fromState: { status: asset.currentStatus, custodianId: asset.currentCustodianId, projectId: asset.currentProjectId, locationId: asset.currentLocationId },
              toState: { status: "assigned", custodianId: input.custodianId, projectId: input.projectId ?? null, locationId: input.locationId ?? null },
              refType: "transfer",
              refId: transfer.id,
              note: input.note ?? "Manual transfer",
            })
            .returning();
          if (tx) transactionIds.push(String(tx.id));
        }
      } else if (input.actionType === "repair") {
        for (const assetId of input.assetIds) {
          await ctx.db
            .update(schema.asset)
            .set({ currentStatus: "in_maintenance", updatedAt: new Date() })
            .where(eq(schema.asset.id, assetId));

          const [tx] = await ctx.db
            .insert(schema.transaction)
            .values({
              tenantId: tid,
              assetId,
              eventType: "repair_start",
              actorId: ctx.session.userId,
              toState: { status: "in_maintenance" },
              refType: "manual",
              note: input.note ?? "Manual repair entry",
            })
            .returning();
          if (tx) transactionIds.push(String(tx.id));
        }
      } else if (input.actionType === "lost") {
        for (const assetId of input.assetIds) {
          await ctx.db
            .update(schema.asset)
            .set({ currentStatus: "lost", updatedAt: new Date() })
            .where(eq(schema.asset.id, assetId));

          const [tx] = await ctx.db
            .insert(schema.transaction)
            .values({
              tenantId: tid,
              assetId,
              eventType: "lost",
              actorId: ctx.session.userId,
              toState: { status: "lost" },
              refType: "manual",
              note: input.note ?? "Manual lost report",
            })
            .returning();
          if (tx) transactionIds.push(String(tx.id));
        }
      }

      // Update the message record.
      await ctx.db
        .update(schema.message)
        .set({
          processingStatus: "action_executed",
          executedTransactionIds: transactionIds,
          handledByUserId: ctx.session.userId,
          handledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.message.id, input.messageId));

      await logEvent(ctx, {
        category: "messaging",
        action: "manual_entry",
        entityType: "message",
        entityId: input.messageId,
        details: { actionType: input.actionType, transactionIds },
      });

      return { ok: true, transactionIds };
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
