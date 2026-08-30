import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { protectedProcedure, requirePermission, router } from "../trpc.js";
import { approveTaskAction, confirmMessageAction } from "../approve.js";
import { TRPCError } from "@trpc/server";

/*
  The intelligent inbox (docs/19).

  Everything the desk can act on, in three honest buckets:
  - recognized: an action that can be replayed — a field request carrying its
    pendingAction, or a chat proposal with resolved entities.
  - completed: history — signed off, declined, dismissed, or already executed.
  - unrecognized: the model could not bind this to an action; a human either
    resolves it through the existing manual-entry form or dismisses it.

  Classification is stored on the row (`task.classification`), set by the
  request worker's sweep. For messages it is derived here from
  `processing_status` — a message has no classification column, and its status
  already IS the classification.

  `resolve` is the important one: it replays the stored action through the
  SAME code as the Inbox's approve button and the chat's Confirm button
  (`approve.ts`), so one-click resolving here is indistinguishable in the
  ledger from either of those paths.
*/

export type ClassifiedItem = {
  id: string;
  kind: "task" | "message";
  title: string;
  summary: string | null;
  status: string;
  department: string | null;
  createdAt: Date;
  /* Present on recognized tasks so the desk can see what it is about to do. */
  actionType: string | null;
};

const TERMINAL_TASK_STATUSES = ["completed", "cancelled"] as const;

export const inboxRouter = router({
  classified: requirePermission("assignment.read")
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const limit = input?.limit ?? 50;

      const [tasks, messages] = await Promise.all([
        ctx.db
          .select({
            id: schema.task.id,
            title: schema.task.title,
            status: schema.task.status,
            classification: schema.task.classification,
            llmSummary: schema.task.llmSummary,
            actionType: schema.task.actionType,
            department: schema.task.department,
            createdAt: schema.task.createdAt,
          })
          .from(schema.task)
          .where(eq(schema.task.tenantId, tid))
          .orderBy(desc(schema.task.createdAt))
          .limit(limit * 3),
        ctx.db
          .select({
            id: schema.message.id,
            body: schema.message.body,
            processingStatus: schema.message.processingStatus,
            intentType: schema.message.intentType,
            intentPayload: schema.message.intentPayload,
            createdAt: schema.message.createdAt,
          })
          .from(schema.message)
          .where(
            and(
              eq(schema.message.tenantId, tid),
              /* UI-72: "dismissed" belongs here. `dismiss` writes that status,
                 but this SELECT never fetched it and the completed filter below
                 never counted it, so a dismissed MESSAGE fell out of all three
                 buckets and vanished from the desk — the header comment above
                 has always promised it in `completed`. `processing_status` is
                 plain text with no enum, so nothing at the DB level catches a
                 status this list forgets. */
              inArray(schema.message.processingStatus, [
                "action_proposed",
                "action_executed",
                "action_requested",
                "pending_manual",
                "error",
                "dismissed",
              ]),
            ),
          )
          .orderBy(desc(schema.message.createdAt))
          .limit(limit * 2),
      ]);

      const recognizedTasks: ClassifiedItem[] = tasks
        .filter(
          (t) =>
            !TERMINAL_TASK_STATUSES.includes(t.status as (typeof TERMINAL_TASK_STATUSES)[number]) &&
            (t.classification === "recognized" ||
              /* Not yet swept: a request with its action is recognizable by
                 construction — that is what actionType+pendingAction mean. */
              (t.classification === null && !!t.actionType)),
        )
        .map((t) => ({
          id: t.id,
          kind: "task" as const,
          title: t.title,
          summary: t.llmSummary,
          status: t.status,
          department: t.department,
          createdAt: t.createdAt,
          actionType: t.actionType,
        }));

      const recognizedMessages: ClassifiedItem[] = messages
        .filter((m) => m.processingStatus === "action_proposed")
        .map((m) => {
          const payload = (m.intentPayload ?? {}) as { replyText?: string };
          return {
            id: m.id,
            kind: "message" as const,
            title: m.body,
            summary: payload.replyText ?? null,
            status: m.processingStatus,
            department: null,
            createdAt: m.createdAt,
            actionType: m.intentType,
          };
        });

      const unrecognized: ClassifiedItem[] = [
        ...tasks
          .filter(
            (t) =>
              !TERMINAL_TASK_STATUSES.includes(t.status as (typeof TERMINAL_TASK_STATUSES)[number]) &&
              !t.actionType,
          )
          .map((t) => ({
            id: t.id,
            kind: "task" as const,
            title: t.title,
            summary: t.llmSummary,
            status: t.status,
            department: t.department,
            createdAt: t.createdAt,
            actionType: null,
          })),
        ...messages
          .filter((m) => m.processingStatus === "pending_manual" || m.processingStatus === "error")
          .map((m) => ({
            id: m.id,
            kind: "message" as const,
            title: m.body,
            summary: null,
            status: m.processingStatus,
            department: null,
            createdAt: m.createdAt,
            actionType: null,
          })),
      ];

      const completed: ClassifiedItem[] = [
        ...tasks
          .filter((t) =>
            TERMINAL_TASK_STATUSES.includes(t.status as (typeof TERMINAL_TASK_STATUSES)[number]),
          )
          .map((t) => ({
            id: t.id,
            kind: "task" as const,
            title: t.title,
            summary: t.llmSummary,
            status: t.status,
            department: t.department,
            createdAt: t.createdAt,
            actionType: t.actionType,
          })),
        ...messages
          .filter(
            (m) =>
              m.processingStatus === "action_executed" ||
              m.processingStatus === "action_requested" ||
              /* UI-72: dismissed is history, not work — the same place a
                 dismissed TASK lands via TERMINAL_TASK_STATUSES. */
              m.processingStatus === "dismissed",
          )
          .map((m) => ({
            id: m.id,
            kind: "message" as const,
            title: m.body,
            summary: null,
            status: m.processingStatus,
            department: null,
            createdAt: m.createdAt,
            actionType: m.intentType,
          })),
      ];

      return {
        recognized: [...recognizedTasks, ...recognizedMessages]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit),
        completed: completed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit),
        unrecognized: unrecognized.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit),
      };
    }),

  /*
    Do the thing, in one click.

    A recognized task replays its stored pendingAction (approveTaskAction); a
    recognized message confirms its proposal (confirmMessageAction). Both
    charge the desk's permissions and write through the shared executor, so
    nothing here can behave differently from the explicit buttons.
  */
  resolve: requirePermission("assignment.read")
    .input(z.object({ id: z.string().uuid(), kind: z.enum(["task", "message"]) }))
    .mutation(async ({ ctx, input }) => {
      if (input.kind === "task") {
        const result = await approveTaskAction(ctx, input.id);
        return { outcome: "applied" as const, ...result };
      }
      const result = await confirmMessageAction(ctx, input.id);
      return result;
    }),

  /*
    Mark an unrecognized item as finished with nothing done.

    The row keeps its history — the point of the ledger — but leaves the work
    queue. Unlike `task.decline`, this is not a refusal of a request: it is
    "there is nothing to record here".
  */
  dismiss: requirePermission("assignment.read")
    .input(z.object({ id: z.string().uuid(), kind: z.enum(["task", "message"]), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      if (input.kind === "task") {
        const task = await ctx.db.query.task.findFirst({
          where: and(eq(schema.task.id, input.id), eq(schema.task.tenantId, tid)),
        });
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        await ctx.db
          .update(schema.task)
          .set({
            status: "cancelled",
            classification: "completed",
            declineReason: input.reason ?? "Dismissed from the inbox",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(schema.task.id, input.id), eq(schema.task.tenantId, tid)));
        return { ok: true };
      }
      const msg = await ctx.db.query.message.findFirst({
        where: and(eq(schema.message.id, input.id), eq(schema.message.tenantId, tid)),
      });
      if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      await ctx.db
        .update(schema.message)
        .set({
          processingStatus: "dismissed",
          errorNote: input.reason ?? "Dismissed from the inbox",
          handledByUserId: ctx.session.userId,
          handledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(schema.message.id, input.id), eq(schema.message.tenantId, tid)));
      return { ok: true };
    }),

  /*
    Give an unrecognized item one more pass through the tenant's LLM.

    The worker classifies at sweep time; sometimes a human reads an item and
    knows the model simply missed it. Retry re-parses the message through the
    same classifier the worker uses and stores the result — if it binds to an
    action, the item lands in Recognized.

    This is the one place the inbox calls the LLM on demand, and it is gated
    on the same permission the rest of the desk runs under.
  */
  retryClassify: requirePermission("assignment.read")
    .input(z.object({ id: z.string().uuid(), kind: z.enum(["task", "message"]) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const task =
        input.kind === "task"
          ? await ctx.db.query.task.findFirst({
              where: and(eq(schema.task.id, input.id), eq(schema.task.tenantId, tid)),
            })
          : null;

      if (task && !task.actionType) {
        /* A note with no action stays unrecognized until a human rewrites it —
           re-parsing an already-parsed message changes nothing. The honest
           answer is "already looked at". */
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This task has no stored message to re-parse.",
        });
      }

      /* Messages re-parse through the same worker path by re-queuing them. */
      if (input.kind === "message") {
        const msg = await ctx.db.query.message.findFirst({
          where: and(eq(schema.message.id, input.id), eq(schema.message.tenantId, tid)),
        });
        if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
        if (msg.processingStatus !== "pending_manual" && msg.processingStatus !== "error") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This message is not waiting on a retry." });
        }
        await ctx.db
          .update(schema.message)
          .set({ processingStatus: "queued", attempts: 0, updatedAt: new Date() })
          .where(and(eq(schema.message.id, input.id), eq(schema.message.tenantId, tid)));
        return { ok: true, reQueued: true };
      }

      throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to retry." });
    }),
});
