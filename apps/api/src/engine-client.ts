import { createLogger } from "@stinventory/logger";
import type { ServerEnv } from "@stinventory/env";
import type { EngineParseRequest, EngineParseResponse } from "./engine-types.js";

const log = createLogger("engine-client");

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// Default response when the engine fails or times out.
const FALLBACK: EngineParseResponse = {
  intent: "none",
  confidence: 0,
  entities: { assets: [], destination: null, custodian: null, project: null },
  actionPayload: {},
  needsConfirmation: true,
  replyText: "",
};

export async function parseIntent(
  env: ServerEnv,
  req: EngineParseRequest,
  signal?: AbortSignal,
): Promise<EngineParseResponse> {
  const url = `${env.ENGINE_BASE_URL}/parse`;
  const timeoutMs = env.ENGINE_TIMEOUT_MS;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const combinedSignal = signal
      ? combineSignals(signal, controller.signal)
      : controller.signal;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: combinedSignal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      log.error("[engine] non-ok status", { status: res.status, url });
      return FALLBACK;
    }

    const raw = await res.text();
    const parsed = extractJson(raw);
    if (!parsed) {
      log.error("[engine] failed to parse response JSON", { raw });
      return FALLBACK;
    }

    return parsed as unknown as EngineParseResponse;
  } catch (err) {
    log.error("[engine] request failed", { err: String(err), url });
    return FALLBACK;
  }
}

function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
