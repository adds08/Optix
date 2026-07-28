import { eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { decryptSecret, encryptSecret, secretHint } from "@stinventory/auth";
import { DEFAULT_HIGH_VALUE_THRESHOLD } from "@stinventory/types";
import { TRPCError } from "@trpc/server";
import { requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";

/*
  Tenant configuration, editable by the people who own the decisions.

  Everything here used to be either a constant in the code or an environment
  variable on a container — which meant "what counts as high value" and "which
  model parses the chat" were both questions only whoever held the SSH key
  could answer. They are operational decisions, not deployment ones.

  The API key is the reason this file is careful. It is encrypted at rest, it
  is never returned to a browser, and the only thing the page ever sees is the
  last four characters.
*/

/** Never widened to include the key itself. */
const PUBLIC_FIELDS = {
  highValueThreshold: schema.tenantSettings.highValueThreshold,
  custodyApproverRole: schema.tenantSettings.custodyApproverRole,
  overdueEscalateAfterDays: schema.tenantSettings.overdueEscalateAfterDays,
  missingReviewSlaDays: schema.tenantSettings.missingReviewSlaDays,
  discrepancyReviewSlaDays: schema.tenantSettings.discrepancyReviewSlaDays,
  emailEnabled: schema.tenantSettings.emailEnabled,
  smsEnabled: schema.tenantSettings.smsEnabled,
  llmEnabled: schema.tenantSettings.llmEnabled,
  llmBaseUrl: schema.tenantSettings.llmBaseUrl,
  llmModel: schema.tenantSettings.llmModel,
  llmApiKeyHint: schema.tenantSettings.llmApiKeyHint,
  llmTimeoutMs: schema.tenantSettings.llmTimeoutMs,
  llmLastCheckedAt: schema.tenantSettings.llmLastCheckedAt,
  llmLastCheckOk: schema.tenantSettings.llmLastCheckOk,
  llmLastCheckError: schema.tenantSettings.llmLastCheckError,
  updatedAt: schema.tenantSettings.updatedAt,
};

async function ensureRow(db: any, tenantId: string) {
  const [existing] = await db
    .select({ id: schema.tenantSettings.id })
    .from(schema.tenantSettings)
    .where(eq(schema.tenantSettings.tenantId, tenantId))
    .limit(1);
  if (existing) return existing.id as string;
  const [row] = await db
    .insert(schema.tenantSettings)
    .values({ tenantId, highValueThreshold: DEFAULT_HIGH_VALUE_THRESHOLD })
    .returning({ id: schema.tenantSettings.id });
  return row.id as string;
}

/*
  Read the decrypted key. Server-side only — deliberately not a procedure, so
  there is no route that can return it however the caller asks.
*/
export async function llmConfigFor(
  db: any,
  tenantId: string,
  sessionSecret: string,
): Promise<{ baseUrl: string; model: string; apiKey: string; timeoutMs: number } | null> {
  const [row] = await db
    .select()
    .from(schema.tenantSettings)
    .where(eq(schema.tenantSettings.tenantId, tenantId))
    .limit(1);
  if (!row?.llmEnabled || !row.llmBaseUrl || !row.llmModel) return null;
  const apiKey = decryptSecret(row.llmApiKeyEnc, sessionSecret);
  if (!apiKey) return null;
  return {
    baseUrl: row.llmBaseUrl,
    model: row.llmModel,
    apiKey,
    timeoutMs: row.llmTimeoutMs ?? 15000,
  };
}

export const settingsRouter = router({
  get: requirePermission("config.manage").query(async ({ ctx }) => {
    await ensureRow(ctx.db, ctx.session.tenantId);
    const [row] = await ctx.db
      .select(PUBLIC_FIELDS)
      .from(schema.tenantSettings)
      .where(eq(schema.tenantSettings.tenantId, ctx.session.tenantId))
      .limit(1);
    return row ?? null;
  }),

  update: requirePermission("config.manage")
    .input(
      z.object({
        highValueThreshold: z.number().min(0).max(10_000_000).optional(),
        custodyApproverRole: z.string().max(40).optional(),
        overdueEscalateAfterDays: z.number().int().min(0).max(365).optional(),
        missingReviewSlaDays: z.number().int().min(0).max(365).optional(),
        discrepancyReviewSlaDays: z.number().int().min(0).max(365).optional(),
        emailEnabled: z.boolean().optional(),
        smsEnabled: z.boolean().optional(),

        llmEnabled: z.boolean().optional(),
        llmBaseUrl: z.string().url().max(400).nullable().optional(),
        llmModel: z.string().max(200).nullable().optional(),
        llmTimeoutMs: z.number().int().min(1000).max(120_000).optional(),
        /*
          Write-only. Absent means "leave the stored key alone" — otherwise
          saving any other field on the page would wipe it, since the form
          cannot send back a value it was never given. Empty string clears it.
        */
        llmApiKey: z.string().max(400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      await ensureRow(ctx.db, tid);

      const { llmApiKey, ...rest } = input;
      const patch: Record<string, unknown> = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );

      if (llmApiKey !== undefined) {
        if (llmApiKey.trim() === "") {
          patch.llmApiKeyEnc = null;
          patch.llmApiKeyHint = null;
        } else {
          patch.llmApiKeyEnc = encryptSecret(llmApiKey.trim(), ctx.sessionSecret);
          patch.llmApiKeyHint = secretHint(llmApiKey);
          /* A new key invalidates whatever the last test proved. */
          patch.llmLastCheckedAt = null;
          patch.llmLastCheckOk = null;
          patch.llmLastCheckError = null;
        }
      }

      if (!Object.keys(patch).length) return { ok: true, changed: [] as string[] };
      patch.updatedAt = new Date();

      await ctx.db
        .update(schema.tenantSettings)
        .set(patch)
        .where(eq(schema.tenantSettings.tenantId, tid));

      await logEvent(ctx, {
        category: "system",
        action: "settings.update",
        entityType: "tenant_settings",
        /* Field names only. The value of a key must not reach the audit log
           any more than it reaches the browser. */
        details: { changed: Object.keys(patch).filter((k) => k !== "updatedAt") },
      });

      return { ok: true, changed: Object.keys(patch) };
    }),

  /*
    Actually call the model.

    Pasting a key and being told "saved" proves nothing — the failures that
    matter (wrong base URL, wrong model name, key without access to that model)
    all look identical until something tries to use it. This makes that attempt
    immediately, and records the result so the page can say when it last worked
    rather than implying it works now.
  */
  testLlm: requirePermission("config.manage")
    .input(
      z
        .object({
          /* Lets the page test what is on screen before committing it. */
          baseUrl: z.string().url().optional(),
          model: z.string().max(200).optional(),
          apiKey: z.string().max(400).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const [row] = await ctx.db
        .select()
        .from(schema.tenantSettings)
        .where(eq(schema.tenantSettings.tenantId, tid))
        .limit(1);

      const baseUrl = input?.baseUrl ?? row?.llmBaseUrl ?? null;
      const model = input?.model ?? row?.llmModel ?? null;
      const apiKey =
        input?.apiKey && input.apiKey.trim()
          ? input.apiKey.trim()
          : decryptSecret(row?.llmApiKeyEnc, ctx.sessionSecret);

      if (!baseUrl || !model || !apiKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Needs a base URL, a model name and a key before it can be tested.",
        });
      }

      const started = Date.now();
      let ok = false;
      let error: string | null = null;
      let reply: string | null = null;

      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Reply with the single word: ready" }],
            max_tokens: 8,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(row?.llmTimeoutMs ?? 15000),
        });

        if (!res.ok) {
          const body = await res.text();
          /* The provider's own message is the useful part — "model not found"
             and "invalid api key" need different fixes. */
          error = `${res.status}: ${body.slice(0, 200)}`;
        } else {
          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          reply = data.choices?.[0]?.message?.content?.trim()?.slice(0, 80) ?? "";
          ok = true;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      await ctx.db
        .update(schema.tenantSettings)
        .set({
          llmLastCheckedAt: new Date(),
          llmLastCheckOk: ok,
          llmLastCheckError: error?.slice(0, 500) ?? null,
        })
        .where(eq(schema.tenantSettings.tenantId, tid));

      await logEvent(ctx, {
        category: "system",
        action: "settings.testLlm",
        entityType: "tenant_settings",
        result: ok ? "success" : "failure",
        details: { ok, ms: Date.now() - started },
      });

      return { ok, error, reply, ms: Date.now() - started };
    }),
});
