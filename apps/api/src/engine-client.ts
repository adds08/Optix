import { createLogger } from "@stinventory/logger";
import type { ServerEnv } from "@stinventory/env";
import {
  FALLBACK,
  IntentParseError,
  parseIntent as runParser,
  type LlmConfig,
  type ParseContext,
  type ParsedIntent,
} from "@stinventory/intent";

const log = createLogger("engine-client");

/*
  Where the parser gets its configuration, and what a failure means here.

  The parsing itself moved to @stinventory/intent — it is shared with the
  settings page, which needs to run a real message through the real prompt to
  prove a saved key actually works. What is left in this file is the two
  decisions that belong to the API process rather than to the parser:

  1. Tenant settings beat environment variables. This is the bug that made the
     settings page cosmetic: the worker looked the tenant's key up in the
     database, passed it in, and the old implementation read `env.LLM_API_KEY`
     regardless — unset in the container, so every message became intent
     `none`. The environment is now a development convenience only.

  2. A failure is swallowed into FALLBACK rather than thrown. The worker's
     caller marks the message `pending_manual` on a fallback, which is the
     behaviour we want: the provider being down must not lose a foreman's
     message, it must put it in front of the desk.
*/

export type EngineParseRequest = {
  message: string;
  context: ParseContext;
  /** From tenant_settings. Absent means fall back to the environment. */
  llm?: Partial<LlmConfig>;
};

export type EngineParseResponse = ParsedIntent;

/** Null when neither the tenant nor the environment has a usable configuration. */
export function resolveLlmConfig(
  env: ServerEnv,
  tenant?: Partial<LlmConfig>,
): LlmConfig | null {
  const baseUrl = tenant?.baseUrl || env.LLM_BASE_URL;
  const model = tenant?.model || env.LLM_MODEL;
  const apiKey = tenant?.apiKey || env.LLM_API_KEY;
  const timeoutMs = tenant?.timeoutMs || env.LLM_TIMEOUT_MS;
  if (!baseUrl || !model || !apiKey) return null;
  return { baseUrl, model, apiKey, timeoutMs };
}

export async function parseIntent(
  env: ServerEnv,
  req: EngineParseRequest,
  signal?: AbortSignal,
): Promise<EngineParseResponse> {
  const llm = resolveLlmConfig(env, req.llm);
  if (!llm) {
    /* Not an error condition. A tenant that has not configured a model still
       gets its messages captured and queued for the desk to read. */
    log.warn("[engine] no model configured for this tenant — message goes to the manual queue");
    return FALLBACK;
  }

  try {
    return await runParser(llm, { message: req.message, context: req.context }, signal);
  } catch (err) {
    if (err instanceof IntentParseError) {
      log.error("[engine] parse failed", { err: err.message, detail: err.detail });
    } else {
      log.error("[engine] parse failed", { err: String(err) });
    }
    return FALLBACK;
  }
}
