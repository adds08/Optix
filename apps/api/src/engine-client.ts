import { createLogger } from "@stinventory/logger";
import type { ServerEnv } from "@stinventory/env";
import type { EngineParseRequest, EngineParseResponse } from "./engine-types.js";

const log = createLogger("engine-client");

const SYSTEM_PROMPT = `You are an AI assistant for a construction equipment management system called STInventory.
Your job is to parse foremen's chat messages into structured tool-management intents.

## Domain vocabulary

- **Tools/assets**: Tagged with \`UIC-XXXX\` (e.g. UIC-1001), also referred to by model name (Rotary Hammer, Miter Saw, Generator, GNSS, etc.)
- **Vehicles**: Trucks (\`TRU-XXX\`) and Trailers (\`TRA-XXX\`), also called "truck 12", "trailer 1001", etc.
- **Foremen**: Supervisors who check out/return tools. Known by name (Miguel, Dwayne, Sofia, etc.)
- **Projects**: Job sites — Legacy West Phase 3, Trinity Bridge Rehab, Grand Parkway Segment H, Uptown Utility Relocate, Equipment Yard
- **Locations**: Gang Box A, site containers, trucks, trailers, yard (Dallas/Houston)

## Intent definitions

- \`assign\` — giving a tool to a foreman for the first time / checking out
- \`return\` — bringing a tool back to the yard/warehouse
- \`transfer\` — moving a tool between foremen or between projects
- \`lost\` — a tool is missing / can't be found
- \`repair\` — a tool is broken, damaged, not working, needs maintenance
- \`request_purchase\` — requesting a new tool be purchased ("we need another...")
- \`report\` — general note / issue / problem report about a tool
- \`task\` — a general work item or to-do related to small tools that doesn't fit the specific intents above. Examples: "I need someone to check the generator on Friday", "Please organize the gang box", "We need the miter saw serviced before Monday"
- \`none\` — greeting, question about process, or unclear intent

## Entity extraction rules

- Extract **assets** as an array of \`{label: "canonical name or tag", raw: "as written in message"}\`
- Extract **destination** as \`{kind: "employee"|"location"|"project", raw: "as written"}\`
- Extract **custodian** as \`{raw: "as written"}\` — who currently has the tool
- Extract **project** as \`{raw: "as written"}\` — which project
- **Do NOT** guess IDs or DB fields. Return only raw text spans and labels.
- If an entity is not mentioned, set it to \`null\` (or empty array for \`assets\`).

## Confidence

- Set \`confidence\` as a float 0.0–1.0
- \`1.0\` when every part of the action is clearly stated (tool + target + verb)
- \`0.5\`–\`0.9\` when some details are implied or ambiguous
- \`0.0\`–\`0.4\` when intent is unclear or \`"none"\`
- Set \`needsConfirmation\` to \`true\` unless confidence >= 0.9 AND all required entities are present

## Output format

Respond with valid JSON. No prose before or after.

\`\`\`json
{
  "intent": "assign|return|transfer|lost|repair|request_purchase|report|task|none",
  "confidence": 0.0-1.0,
  "entities": {
    "assets": [{"label": "best match label", "raw": "original text"}],
    "destination": {"kind": "employee|location|project", "raw": "original text"} | null,
    "custodian": {"raw": "original text"} | null,
    "project": {"raw": "original text"} | null
  },
  "actionPayload": {},
  "needsConfirmation": true|false,
  "replyText": "A natural language confirmation or reply to the foreman"
}
\`\`\``;

const FALLBACK: EngineParseResponse = {
  intent: "none",
  confidence: 0,
  entities: { assets: [], destination: null, custodian: null, project: null },
  actionPayload: {},
  needsConfirmation: true,
  replyText: "",
};

function buildUserPrompt(req: EngineParseRequest): string {
  const parts = [`## Message\n${req.message}\n`];
  const c = req.context;
  const ctxLines: string[] = [];
  ctxLines.push(`- Foreman: ${c.foremanName} (${c.foremanRole})`);
  if (c.primaryProject) ctxLines.push(`- Primary project: ${c.primaryProject}`);
  if (c.currentLocation) ctxLines.push(`- Current location: ${c.currentLocation}`);
  if (c.currentAssignments.length) {
    ctxLines.push("- Current tools:");
    for (const a of c.currentAssignments) {
      ctxLines.push(`  - ${a.tag} (${a.model}) @ ${a.project} / ${a.location}`);
    }
  }
  if (c.recentMessages.length) {
    ctxLines.push("- Recent messages in channel:");
    for (const m of c.recentMessages.slice(-5)) ctxLines.push(`  - ${m}`);
  }
  parts.push("## Context\n" + ctxLines.join("\n"));
  return parts.join("\n\n");
}

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function parseIntent(
  env: ServerEnv,
  req: EngineParseRequest,
  signal?: AbortSignal,
): Promise<EngineParseResponse> {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) {
    log.warn("[engine] no LLM_API_KEY set, using fallback");
    return FALLBACK;
  }

  const userPrompt = buildUserPrompt(req);
  const timeoutMs = env.LLM_TIMEOUT_MS;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = signal ? combineSignals(signal, controller.signal) : controller.signal;

    const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 1024,
      }),
      signal: combinedSignal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error("[engine] LLM API error", { status: res.status, body: body.slice(0, 300) });
      return FALLBACK;
    }

    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content);
    if (!parsed) {
      log.error("[engine] failed to parse LLM response", { content: content.slice(0, 500) });
      return FALLBACK;
    }

    return {
      intent: (parsed.intent as string) ?? "none",
      confidence: Math.min(Math.max(Number(parsed.confidence ?? 0), 0), 1),
      entities: {
        assets: (parsed.entities as any)?.assets ?? [],
        destination: (parsed.entities as any)?.destination ?? null,
        custodian: (parsed.entities as any)?.custodian ?? null,
        project: (parsed.entities as any)?.project ?? null,
      },
      actionPayload: (parsed.actionPayload as Record<string, unknown>) ?? {},
      needsConfirmation: Boolean(parsed.needsConfirmation ?? true),
      replyText: (parsed.replyText as string) ?? "",
    } as EngineParseResponse;
  } catch (err) {
    log.error("[engine] LLM request failed", { err: String(err) });
    return FALLBACK;
  }
}

function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) { controller.abort(s.reason); return controller.signal; }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
