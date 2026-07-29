import { describe, expect, it } from "vitest";
import { extractJson, normalizeDraft, normalizeResponse } from "./parse.js";

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
