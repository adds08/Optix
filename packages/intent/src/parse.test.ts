import { afterEach, describe, expect, it } from "vitest";
import { extractJson, normalizeDraft, normalizeResponse, parseIntent } from "./parse.js";

/*
  Everything here is about not trusting the model's output shape.

  A 4B model running on a phone-class budget is what the field app talks to,
  and it is loose in exactly these ways: prose around the JSON, "N/A" where the
  prompt said null, an intent name it invented. Each one used to reach the
  executor.
*/

describe("extractJson", () => {
  it("reads a bare object", () => {
    expect(extractJson('{"intent":"assign"}')).toEqual({ intent: "assign" });
  });

  it("reads one wrapped in a fence", () => {
    expect(extractJson('```json\n{"intent":"lost"}\n```')).toEqual({ intent: "lost" });
  });

  it("reads one buried in prose", () => {
    expect(extractJson('Sure!\n{"intent":"return"}\nHope that helps.')).toEqual({
      intent: "return",
    });
  });

  it("returns null rather than throwing on junk", () => {
    for (const junk of ["", "no json here", "{not json}"]) {
      expect(extractJson(junk)).toBeNull();
    }
  });
});

describe("normalizeDraft", () => {
  it("keeps what was actually stated", () => {
    expect(normalizeDraft({ tag: "UIC-1099", modelName: "DeWalt DCH273" })).toEqual({
      tag: "UIC-1099",
      modelName: "DeWalt DCH273",
      serialNumber: null,
      categoryName: null,
      acquisitionCost: null,
    });
  });

  it("flattens every way a model says 'not stated'", () => {
    /* Without this, "N/A" is written into the register as a serial number and
       the tool is findable by searching for N/A. */
    for (const v of ["", "  ", "null", "N/A", "unknown", "-", "TBD", "none"]) {
      expect(normalizeDraft({ serialNumber: v })).toBeNull();
    }
  });

  it("is null when nothing survived", () => {
    expect(normalizeDraft({ tag: "unknown", modelName: "" })).toBeNull();
    expect(normalizeDraft(null)).toBeNull();
    expect(normalizeDraft("a string")).toBeNull();
  });
});

describe("normalizeResponse", () => {
  it("coerces an invented intent to none with zero confidence", () => {
    /* The model occasionally answers "check_out". Passing that through leaves
       the executor to throw on an action type it has never heard of, which
       shows up as a failed message rather than one waiting at the desk. */
    const r = normalizeResponse({ intent: "check_out", confidence: 0.97 });
    expect(r.intent).toBe("none");
    expect(r.confidence).toBe(0);
  });

  it("keeps confidence for a real intent", () => {
    expect(normalizeResponse({ intent: "assign", confidence: 0.8 }).confidence).toBe(0.8);
  });

  it("clamps confidence into range", () => {
    expect(normalizeResponse({ intent: "assign", confidence: 4 }).confidence).toBe(1);
    expect(normalizeResponse({ intent: "assign", confidence: -2 }).confidence).toBe(0);
    expect(normalizeResponse({ intent: "assign", confidence: "high" }).confidence).toBe(0);
  });

  it("defaults to needing confirmation when the model omits the flag", () => {
    expect(normalizeResponse({ intent: "assign", confidence: 0.5 }).needsConfirmation).toBe(true);
    expect(normalizeResponse({ intent: "assign", confidence: 0.95 }).needsConfirmation).toBe(false);
  });

  it("survives entities being absent entirely", () => {
    const r = normalizeResponse({ intent: "none" });
    expect(r.entities).toEqual({ assets: [], destination: null, custodian: null, project: null });
  });

  it("fills in a missing half of an asset rather than dropping it", () => {
    /* Models routinely give `label` without `raw`. The resolver only needs one
       of them, so discarding the pair would lose a real tool reference. */
    expect(normalizeResponse({ intent: "assign", entities: { assets: [{ label: "UIC-1012" }] } })
      .entities.assets).toEqual([{ label: "UIC-1012", raw: "UIC-1012" }]);
  });

  it("drops asset entries that carry no text at all", () => {
    expect(
      normalizeResponse({ intent: "assign", entities: { assets: [{}, null, "x"] } }).entities.assets,
    ).toEqual([]);
  });
});

/*
  The retry ladder.

  Every one of these is a real 400 from a real provider. They matter because
  the failure mode without them is indistinguishable from a bad API key: the
  desk sees "provider returned 400", concludes the key is wrong, and pastes it
  again.
*/
describe("parseIntent parameter fixups", () => {
  const llm = { baseUrl: "https://x.test/v1", model: "m", apiKey: "k" };
  const input = {
    message: "returning UIC-1002 to the yard",
    context: {
      foremanName: "T", foremanRole: "foreman", currentAssignments: [],
      primaryProject: "", currentLocation: "", recentMessages: [],
    },
  };

  const ok = {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"intent":"return","confidence":0.9}' } }],
    }),
  };
  const reject = (msg: string) => ({ ok: false, status: 400, text: async () => msg });

  /** Records every body sent, and answers from a scripted queue. */
  function stubFetch(queue: unknown[]) {
    const bodies: Record<string, unknown>[] = [];
    const fn = async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return queue.shift() as Response;
    };
    globalThis.fetch = fn as unknown as typeof fetch;
    return bodies;
  }

  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("drops response_format when the provider rejects it", async () => {
    const bodies = stubFetch([
      reject("Invalid parameter: 'response_format' is not supported"),
      ok,
    ]);
    const r = await parseIntent(llm, input);
    expect(r.intent).toBe("return");
    expect(bodies[0]).toHaveProperty("response_format");
    expect(bodies[1]).not.toHaveProperty("response_format");
  });

  it("drops temperature for a model that only accepts the default", async () => {
    /* gpt-5-nano and the rest of the reasoning line. This is the cheap model
       somebody reaches for first, so it has to work. */
    const bodies = stubFetch([
      reject("Unsupported value: 'temperature' does not support 0.1"),
      ok,
    ]);
    await parseIntent(llm, input);
    expect(bodies[0]).toHaveProperty("temperature");
    expect(bodies[1]).not.toHaveProperty("temperature");
  });

  it("renames max_tokens rather than dropping the cap", async () => {
    const bodies = stubFetch([
      reject("'max_tokens' is not supported, use 'max_completion_tokens'"),
      ok,
    ]);
    await parseIntent(llm, input);
    expect(bodies[0]).toHaveProperty("max_tokens");
    expect(bodies[1]).not.toHaveProperty("max_tokens");
    expect(bodies[1]!.max_completion_tokens).toBe(1024);
  });

  it("climbs the whole ladder when a provider objects to everything", async () => {
    const bodies = stubFetch([
      reject("'response_format' unsupported"),
      reject("'temperature' unsupported"),
      reject("use 'max_completion_tokens'"),
      ok,
    ]);
    const r = await parseIntent(llm, input);
    expect(r.intent).toBe("return");
    expect(bodies).toHaveLength(4);
  });

  it("gives up rather than looping on a 400 it cannot fix", async () => {
    stubFetch([reject("insufficient quota"), ok]);
    await expect(parseIntent(llm, input)).rejects.toThrow(/400/);
  });

  it("does not retry a 401 — a bad key is not a parameter problem", async () => {
    stubFetch([{ ok: false, status: 401, text: async () => "invalid api key" }, ok]);
    await expect(parseIntent(llm, input)).rejects.toThrow(/401/);
  });
});

/*
  The reasoning-model empty reply.

  This is not hypothetical: openai-gpt-5-nano on DigitalOcean returned exactly
  this against the real deployment — HTTP 200, a valid response envelope, and
  content of "". Every token went on reasoning. Without the retry the feature
  looks broken while the API key is perfectly fine, and the error said only
  "Model did not return JSON" with an empty detail.
*/
describe("parseIntent empty-reply handling", () => {
  const llm = { baseUrl: "https://x.test/v1", model: "gpt-5-nano", apiKey: "k" };
  const input = {
    message: "returning UIC-1002 to the yard",
    context: {
      foremanName: "T", foremanRole: "foreman", currentAssignments: [],
      primaryProject: "", currentLocation: "", recentMessages: [],
    },
  };

  const empty = (finish: string, spent = 1024) => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "" }, finish_reason: finish }],
      usage: { completion_tokens: spent },
    }),
  });
  const answered = {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"intent":"return","confidence":0.9}' } }],
    }),
  };

  function stubFetch(queue: unknown[]) {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return queue.shift() as Response;
    }) as unknown as typeof fetch;
    return bodies;
  }

  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("retries once with a much larger budget", async () => {
    const bodies = stubFetch([empty("length"), answered]);
    const r = await parseIntent(llm, input);
    expect(r.intent).toBe("return");
    expect(bodies[0]!.max_tokens).toBe(1024);
    expect(bodies[1]!.max_tokens).toBe(8192);
  });

  it("raises the renamed field when the provider made us rename it", async () => {
    /* Order matters: a 400 on max_tokens swaps the key, and the budget retry
       has to raise the new one or it silently sends 1024 again. */
    const bodies = stubFetch([
      { ok: false, status: 400, text: async () => "use 'max_completion_tokens'" },
      empty("length"),
      answered,
    ]);
    await parseIntent(llm, input);
    expect(bodies[1]!.max_completion_tokens).toBe(1024);
    expect(bodies[2]!.max_completion_tokens).toBe(8192);
    expect(bodies[2]).not.toHaveProperty("max_tokens");
  });

  it("gives up after one raise rather than escalating forever", async () => {
    stubFetch([empty("length"), empty("length"), answered]);
    await expect(parseIntent(llm, input)).rejects.toThrow(/empty reply/);
  });

  it("explains an empty reply instead of blaming the JSON", async () => {
    stubFetch([empty("length"), empty("length")]);
    const err = await parseIntent(llm, input).catch((e) => e);
    expect(err.message).toMatch(/empty reply/);
    expect(err.detail).toMatch(/finish_reason=length/);
    expect(err.detail).toMatch(/1024 completion tokens spent/);
    expect(err.detail).toMatch(/reasoning model/);
  });

  it("does not retry an empty reply the model chose to give", async () => {
    /* finish_reason "stop" with no content is a model declining to answer, not
       one that ran out of room. Retrying with more room changes nothing. */
    stubFetch([empty("stop", 5), answered]);
    await expect(parseIntent(llm, input)).rejects.toThrow(/empty reply/);
  });

  it("still reports prose as a JSON problem", async () => {
    stubFetch([{ ok: true, json: async () => ({ choices: [{ message: { content: "Sure, I can help!" } }] }) }]);
    const err = await parseIntent(llm, input).catch((e) => e);
    expect(err.message).toMatch(/did not return JSON/);
    expect(err.detail).toBe("Sure, I can help!");
  });
});
