import { eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@stinventory/db/schema";
import { decryptSecret, encryptSecret, secretHint } from "@stinventory/auth";
import { DEFAULT_HIGH_VALUE_THRESHOLD } from "@stinventory/types";
import { TRPCError } from "@trpc/server";
import {
  IntentParseError,
  parseIntent,
  type ParseContext,
  type ParsedIntent,
} from "@stinventory/intent";
import { sendMail } from "@stinventory/mail";
import { requirePermission, router } from "../trpc.js";
import { logEvent } from "../audit.js";
import { mailConfigFor } from "../mail-config.js";

/*
  The sentence the connection test parses.

  Chosen to exercise every slot at once — a tagged tool, a person and a job
  site — so a model that only half works shows up as half working rather than
  as a green tick. Nothing here needs to exist in the tenant's data: the test
  is asking whether the model can find the shape, not whether the resolver can
  find the rows.
*/
const TEST_MESSAGE = "gave the rotary hammer UIC-1012 to Dave for the bridge job";

const TEST_CONTEXT: ParseContext = {
  foremanName: "Test",
  foremanRole: "foreman",
  currentAssignments: [
    { tag: "UIC-1012", model: "Rotary Hammer", project: "Bridge Job", location: "Gang Box A" },
  ],
  primaryProject: "Bridge Job",
  currentLocation: "Gang Box A",
  recentMessages: [],
};

/*
  Tenant configuration, editable by the people who own the decisions.

  Everything here used to be either a constant in the code or an environment
  variable on a container — which meant "what counts as high value", "which
  model parses the chat" and "which relay sends our invites" were all
  questions only whoever held the SSH key could answer. They are operational
  decisions, not deployment ones.

  The LLM key and the SMTP password are why this file is careful. Both are
  encrypted at rest, neither is ever returned to a browser, and the only thing
  the page ever sees of either is the last four characters.
*/

/** Never widened to include either secret itself. */
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
  smtpHost: schema.tenantSettings.smtpHost,
  smtpPort: schema.tenantSettings.smtpPort,
  smtpUser: schema.tenantSettings.smtpUser,
  smtpPassHint: schema.tenantSettings.smtpPassHint,
  smtpFrom: schema.tenantSettings.smtpFrom,
  smtpLastCheckedAt: schema.tenantSettings.smtpLastCheckedAt,
  smtpLastCheckOk: schema.tenantSettings.smtpLastCheckOk,
  smtpLastCheckError: schema.tenantSettings.smtpLastCheckError,
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

        /* SMTP — same write-only-secret shape as the LLM key above, for the
           same reason. `smtpHost` empty clears the row back to the env
           fallback (`mailConfigFor` treats no host as "not configured"). */
        smtpHost: z.string().max(200).nullable().optional(),
        smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
        smtpUser: z.string().max(200).nullable().optional(),
        smtpFrom: z.string().max(200).nullable().optional(),
        smtpPass: z.string().max(400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      await ensureRow(ctx.db, tid);

      const { llmApiKey, smtpPass, ...rest } = input;
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

      if (smtpPass !== undefined) {
        if (smtpPass.trim() === "") {
          patch.smtpPassEnc = null;
          patch.smtpPassHint = null;
        } else {
          patch.smtpPassEnc = encryptSecret(smtpPass.trim(), ctx.sessionSecret);
          patch.smtpPassHint = secretHint(smtpPass);
        }
        /* A new password invalidates whatever the last test-send proved, same
           reasoning as the LLM key above — and also whenever the host, port,
           user or from-address changes, since any of those can be the reason
           delivery stops working. */
      }
      if (
        smtpPass !== undefined ||
        patch.smtpHost !== undefined ||
        patch.smtpPort !== undefined ||
        patch.smtpUser !== undefined ||
        patch.smtpFrom !== undefined
      ) {
        patch.smtpLastCheckedAt = null;
        patch.smtpLastCheckOk = null;
        patch.smtpLastCheckError = null;
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
    Actually parse a message with the configured model.

    Pasting a key and being told "saved" proves nothing — the failures that
    matter (wrong base URL, wrong model name, a key with no access to that
    model, a model that cannot hold a JSON format) all look identical until
    something tries to use it.

    This deliberately runs the *real* prompt over a *real* sentence rather than
    sending "say ready". A provider can answer a one-word prompt perfectly and
    still be useless here: `gpt-5-nano` and friends will happily reply in prose
    and never produce the JSON the worker needs. Proving the key is live and
    proving the chat feature works are different claims, and the desk needs the
    second one.
  */
  testLlm: requirePermission("config.manage")
    .input(
      z
        .object({
          /* Lets the page test what is on screen before committing it. */
          baseUrl: z.string().url().optional(),
          model: z.string().max(200).optional(),
          apiKey: z.string().max(400).optional(),
          /* The sentence to parse. Defaults to one that exercises every slot:
             a tool, a person and a job site. */
          message: z.string().max(500).optional(),
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

      const message = input?.message?.trim() || TEST_MESSAGE;
      const started = Date.now();
      let ok = false;
      let error: string | null = null;
      let detail: string | null = null;
      let parsed: ParsedIntent | null = null;

      try {
        parsed = await parseIntent(
          { baseUrl, model, apiKey, timeoutMs: row?.llmTimeoutMs ?? 15000 },
          { message, context: TEST_CONTEXT },
        );
        /* Reaching the provider is not the same as it being usable. A model
           that classifies our own worked example as `none` will classify the
           field's messages the same way, and saying "connected" about that is
           the failure this whole procedure exists to catch. */
        if (parsed.intent === "none") {
          error = "Connected, but the model could not parse a worked example.";
          detail = `It answered "none" for: "${message}". Usually the model is too small for structured output — try a larger one.`;
        } else {
          ok = true;
        }
      } catch (e) {
        /* The provider's own words are the useful part: "model not found" and
           "invalid api key" need different fixes. */
        error = e instanceof Error ? e.message : String(e);
        detail = e instanceof IntentParseError ? (e.detail ?? null) : null;
      }

      await ctx.db
        .update(schema.tenantSettings)
        .set({
          llmLastCheckedAt: new Date(),
          llmLastCheckOk: ok,
          llmLastCheckError: error ? `${error}${detail ? ` ${detail}` : ""}`.slice(0, 500) : null,
        })
        .where(eq(schema.tenantSettings.tenantId, tid));

      await logEvent(ctx, {
        category: "system",
        action: "settings.testLlm",
        entityType: "tenant_settings",
        result: ok ? "success" : "failure",
        details: { ok, ms: Date.now() - started, intent: parsed?.intent ?? null },
      });

      return {
        ok,
        error,
        detail,
        ms: Date.now() - started,
        message,
        /* What the model actually understood, so a half-right answer is
           visible as half-right rather than as a green tick. */
        intent: parsed?.intent ?? null,
        confidence: parsed?.confidence ?? null,
        assets: parsed?.entities.assets.map((a) => a.label) ?? [],
        custodian: parsed?.entities.destination?.raw ?? parsed?.entities.custodian?.raw ?? null,
        project: parsed?.entities.project?.raw ?? null,
        reply: parsed?.replyText ?? null,
      };
    }),

  /*
    Send an actual test email, to an actual inbox. Same reasoning as `testLlm`:
    "saved" proves nothing about whether a host, a port or a password is
    right, and those failures all look identical on this screen until
    something tries to use them. Uses whatever is currently stored on the row
    (not the unsaved form state — a password field is never sent back to the
    client to resubmit here, unlike `testLlm`'s optional overrides), so
    "Save" before "Send test email" is required and the page should say so.
  */
  testEmail: requirePermission("config.manage")
    .input(z.object({ to: z.string().email().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const tid = ctx.session.tenantId;
      const config = await mailConfigFor(ctx.db, tid, ctx.sessionSecret, ctx.mailFallback);

      if (!config) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No SMTP host is configured for this tenant, and no server-wide default is set either.",
        });
      }

      const started = Date.now();
      const result = await sendMail(config, {
        to: input.to,
        subject: "STInventory test email",
        html: `<p>This is a test email from STInventory's Settings page. If this arrived, the configured SMTP relay works.</p>`,
        text: "This is a test email from STInventory's Settings page. If this arrived, the configured SMTP relay works.",
      });

      await ctx.db
        .update(schema.tenantSettings)
        .set({
          smtpLastCheckedAt: new Date(),
          smtpLastCheckOk: result.ok,
          smtpLastCheckError: result.ok ? null : result.error.slice(0, 500),
        })
        .where(eq(schema.tenantSettings.tenantId, tid));

      await logEvent(ctx, {
        category: "system",
        action: "settings.testEmail",
        entityType: "tenant_settings",
        result: result.ok ? "success" : "failure",
        errorMessage: result.ok ? null : result.error,
        details: { to: input.to, ms: Date.now() - started },
      });

      return result.ok
        ? { ok: true as const, error: null }
        : { ok: false as const, error: result.error };
    }),
});
