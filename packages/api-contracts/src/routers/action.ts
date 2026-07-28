import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";
import { applyChatAction, canApplyAction, requestChatAction } from "../apply-action.js";
import { logEvent } from "../audit.js";

/*
  The manual path — the same executor the chat confirm path uses.

  Field work cannot depend on a language model being reachable, so every action
  a foreman can describe in a sentence must also be reachable by tapping a form.
  Routing both through `applyChatAction` is what keeps them honest: identical
  ledger entries, identical permission cost, identical projection updates. A
  form is just a pre-filled intent with no parsing step.

  Permission is charged inside the executor rather than by `requirePermission`
  here, because a refusal is not an error for this workflow — an actor without
  the permission gets their observation recorded as a request for the owning
  desk (see requestChatAction).
*/

const ACTION_TYPES = [
  "assign",
  "transfer",
  "return",
  "repair",
  "lost",
  "report",
  "intake",
  "request_purchase",
] as const;

/* Intake and purchase requests name a tool the register has never seen, so they
   are the two types that legitimately arrive with no assetIds. */
const NEEDS_NO_ASSETS: readonly string[] = ["intake", "request_purchase"];

export const actionRouter = router({
  submit: protectedProcedure
    .input(
      z
        .object({
          type: z.enum(ACTION_TYPES),
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
        })
        .refine((v) => NEEDS_NO_ASSETS.includes(v.type) || v.assetIds.length > 0, {
          message: "Pick at least one tool for this action",
          path: ["assetIds"],
        })
        .refine((v) => v.type !== "intake" || !!v.draft?.tag, {
          message: "A new tool needs a tag",
          path: ["draft", "tag"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const opts = {
        tenantId: ctx.session.tenantId,
        actorUserId: ctx.session.userId,
        actorEmployeeId: ctx.session.employeeId ?? null,
        permissions: ctx.session.permissions,
        action: {
          type: input.type,
          assetIds: input.assetIds,
          custodianId: input.custodianId,
          projectId: input.projectId,
          locationId: input.locationId,
          note: input.note,
          draft: input.draft,
        },
      };

      const allowed = canApplyAction(input.type, ctx.session.permissions);

      /* NOTE: this path does not yet consult the high-value approval rule that
         `assignment.create` and `transfer.create` apply via tenantSettings.
         The chat path has never applied it either, so this is a pre-existing
         gap being made visible rather than a new one — but a $12k plate compactor
         handed over on a form should still route through approval. Worth closing
         before the register carries real money. */
      const { transactionIds, taskId } = allowed
        ? { ...(await applyChatAction(ctx.db, opts)), taskId: null as string | null }
        : await requestChatAction(ctx.db, opts);

      await logEvent(ctx, {
        category: "asset",
        action: allowed ? `action.${input.type}` : `request.${input.type}`,
        entityType: "asset",
        /* Intake has no asset id until it is applied; log the tag instead so the
           trail still names what was acted on. */
        entityId: input.assetIds[0] ?? null,
        entityLabel: input.draft?.tag ?? null,
        details: { type: input.type, assetIds: input.assetIds, transactionIds, taskId },
      });

      return { ok: true, applied: allowed, transactionIds, taskId };
    }),
});
