import { isKnownIntent } from "./catalog.js";
import { buildSystemPrompt, buildUserPrompt, type ParseContext } from "./prompt.js";

/*
  One call to an OpenAI-compatible endpoint, and the normalisation of what
  comes back.

  Configuration arrives as an argument. It used to be read from the process
  environment here, which is why the settings page never worked in production:
  the worker looked the tenant's key up in the database, passed it in, and this
  function ignored it and used `LLM_API_KEY` — unset on the droplet — so every
  message fell back to intent `none` and landed in the manual queue.
*/

export type LlmConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
};

export type AssetDraft = {
  tag: string | null;
  make: string | null;
  modelNumber: string | null;
  description: string | null;
  serialNumber: string | null;
  categoryName: string | null;
  acquisitionCost: string | null;
};

export type ParsedIntent = {
  intent: string;
  confidence: number;
  entities: {
    assets: { label: string; raw: string }[];
    destination: { kind: "employee" | "location" | "project"; raw: string } | null;
    custodian: { raw: string } | null;
    project: { raw: string } | null;
  };
  draft: AssetDraft | null;
  actionPayload: Record<string, unknown>;
  needsConfirmation: boolean;
  replyText: string;
};

/*
  What a message becomes when the model could not be reached or could not be
  understood. `needsConfirmation` is true and the intent is `none`, so it lands
  in the desk's manual queue — the message is never lost, it just stops being
  automatic.
*/
export const FALLBACK: ParsedIntent = {
  intent: "none",
  confidence: 0,
  entities: { assets: [], destination: null, custodian: null, project: null },
  draft: null,
  actionPayload: {},
  needsConfirmation: true,
  replyText: "",
};

/*
  Small models are loose with "not stated" — they emit "", "null", "N/A" or
  "unknown" where the prompt asked for null. Every one of those would land in
  the register as a literal serial number, so they are flattened here rather
  than trusted downstream.
*/
const NOT_STATED = new Set(["", "null", "none", "n/a", "na", "unknown", "-", "tbd"]);

function draftField(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return NOT_STATED.has(s.toLowerCase()) ? null : s;
}

export function normalizeDraft(raw: unknown): AssetDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const out: AssetDraft = {
    tag: draftField(d.tag),
    make: draftField(d.make),
    modelNumber: draftField(d.modelNumber),
    description: draftField(d.description),
    serialNumber: draftField(d.serialNumber),
    categoryName: draftField(d.categoryName),
    acquisitionCost: draftField(d.acquisitionCost),
  };
  /* An object where nothing survived is the same as no draft at all. */
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/* Models that ignore `response_format` wrap the object in prose or a fence. */
export function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object") return v as Record<string, unknown>;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export function normalizeResponse(raw: Record<string, unknown>): ParsedIntent {
  const e = (raw.entities ?? {}) as Record<string, unknown>;
  const confidence = Math.min(Math.max(Number(raw.confidence ?? 0) || 0, 0), 1);

  /* An intent outside the catalog is a hallucination, not a feature. Coercing
     to `none` sends it to the desk instead of to an executor that would throw
     on an action type it has never heard of. */
  const intent = isKnownIntent(raw.intent) ? (raw.intent as string) : "none";

  return {
    intent,
    confidence: intent === "none" && !isKnownIntent(raw.intent) ? 0 : confidence,
    entities: {
      assets: Array.isArray(e.assets)
        ? (e.assets as unknown[])
            .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
            .map((a) => ({ label: String(a.label ?? a.raw ?? ""), raw: String(a.raw ?? a.label ?? "") }))
            .filter((a) => a.label || a.raw)
        : [],
      destination: (e.destination as ParsedIntent["entities"]["destination"]) ?? null,
      custodian: (e.custodian as ParsedIntent["entities"]["custodian"]) ?? null,
      project: (e.project as ParsedIntent["entities"]["project"]) ?? null,
    },
    draft: normalizeDraft(raw.draft),
    actionPayload: (raw.actionPayload as Record<string, unknown>) ?? {},
    needsConfirmation: Boolean(raw.needsConfirmation ?? confidence < 0.9),
    replyText: typeof raw.replyText === "string" ? raw.replyText : "",
  };
}

export class IntentParseError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "IntentParseError";
  }
}

type ChatCompletion = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { completion_tokens?: number; prompt_tokens?: number };
};

/* The initial ceiling. A useful reply to this prompt is ~200 tokens; 1024 is
   already generous for a model that answers rather than deliberates. */
const TOKEN_BUDGET = 1024;

/* Headroom for a reasoning model, which spends most of it before writing
   anything. Only ever sent after a first attempt came back empty. */
const RETRY_TOKEN_BUDGET = 8192;

type Fixup = {
  /** Does the provider's 400 look like it is complaining about this? */
  matches: (body: string) => boolean;
  apply: (body: Record<string, unknown>) => void;
};

/*
  Not every OpenAI-compatible endpoint accepts every OpenAI parameter, and the
  ones that get rejected are the ones we would rather have.

  `response_format: json_object` is unsupported by a good number of hosted
  models; `temperature` is rejected outright by the reasoning models, and
  `max_tokens` was renamed for them. All three come back as a 400 naming the
  field, so a single retry without the offending parameter turns "this provider
  does not work" into "this provider works slightly worse" — extractJson copes
  with a model that wraps its answer in prose.
*/
const FIXUPS: Fixup[] = [
  {
    /* Rejected by many hosted models. Dropping it costs nothing but a little
       reliability — extractJson copes with prose around the object. */
    matches: (b) => b.includes("response_format"),
    apply: (b) => {
      delete b.response_format;
    },
  },
  {
    /* The reasoning models accept only the default. */
    matches: (b) => b.includes("temperature"),
    apply: (b) => {
      delete b.temperature;
    },
  },
  {
    /* OpenAI renamed this for the reasoning models and 400s on the old name;
       everything else still wants the old name, so start with `max_tokens`
       and swap only when told to. */
    matches: (b) => b.includes("max_completion_tokens") || b.includes("max_tokens"),
    apply: (b) => {
      /* Carry the current ceiling across, which matters when the budget retry
         already raised it — reading after the delete would silently reset it. */
      const current = b.max_tokens;
      delete b.max_tokens;
      b.max_completion_tokens = current ?? TOKEN_BUDGET;
    },
  },
];

/*
  Throws rather than returning FALLBACK.

  The caller decides what a failure means: the worker swallows it into the
  manual queue, while the settings page's connection test needs the provider's
  own words — "model not found" and "invalid api key" need different fixes and
  look identical once flattened to a fallback.
*/
export async function parseIntent(
  llm: LlmConfig,
  input: { message: string; context: ParseContext },
  signal?: AbortSignal,
): Promise<ParsedIntent> {
  const url = `${llm.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const timeout = AbortSignal.timeout(llm.timeoutMs ?? 15000);

  const body: Record<string, unknown> = {
    model: llm.model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input.message, input.context) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: TOKEN_BUDGET,
  };

  const used = new Set<Fixup>();
  let raisedBudget = false;
  let lastError = "";

  /* One attempt per fixup, plus the first, plus the budget retry below. */
  for (let attempt = 0; attempt <= FIXUPS.length + 1; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${llm.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      throw new IntentParseError(
        `Could not reach ${llm.baseUrl}`,
        err instanceof Error ? err.message : String(err),
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      lastError = text.slice(0, 300);

      const fixup =
        res.status === 400
          ? FIXUPS.find((f) => !used.has(f) && f.matches(text.toLowerCase()))
          : undefined;
      if (fixup) {
        used.add(fixup);
        fixup.apply(body);
        continue;
      }
      throw new IntentParseError(`Provider returned ${res.status}`, lastError);
    }

    const data = (await res.json().catch(() => null)) as ChatCompletion | null;
    const choice = data?.choices?.[0];
    const content = choice?.message?.content ?? "";
    const finish = choice?.finish_reason ?? "";
    const usage = data?.usage;

    /*
      Empty content with `finish_reason: "length"` is the reasoning models'
      signature failure, and it is not a small-print edge case: gpt-5-nano
      spends the entire budget thinking and returns an empty string, so the
      whole feature looks broken while the API key is perfectly fine. The
      reasoning tokens are invisible in `content` but counted in
      `completion_tokens`, which is how we tell this apart from a model that
      simply had nothing to say.

      One retry with a much larger ceiling. Not the initial value, because most
      models would then be allowed a 4k answer to a request whose useful reply
      is about 200 tokens.
    */
    if (!content.trim() && finish === "length" && !raisedBudget) {
      raisedBudget = true;
      const key = "max_completion_tokens" in body ? "max_completion_tokens" : "max_tokens";
      body[key] = RETRY_TOKEN_BUDGET;
      continue;
    }

    const parsed = extractJson(content);
    if (!parsed) {
      /* Say which of the two it was. "Returned nothing" and "returned prose"
         need different fixes, and an empty detail string told nobody anything. */
      const spent = usage?.completion_tokens;
      throw new IntentParseError(
        content.trim() ? "Model did not return JSON" : "Model returned an empty reply",
        content.trim()
          ? content.slice(0, 300)
          : `finish_reason=${finish || "unknown"}${
              spent ? `, ${spent} completion tokens spent with no output` : ""
            }. A reasoning model can spend its whole budget thinking; try a non-reasoning model.`,
      );
    }
    return normalizeResponse(parsed);
  }

  throw new IntentParseError("Provider rejected the request", lastError);
}
