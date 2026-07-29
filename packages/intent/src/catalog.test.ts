import { describe, expect, it } from "vitest";
import {
  ACTION_DEPARTMENTS,
  ACTION_PERMISSIONS,
  AUTO_SAFE_INTENTS,
  CUSTODY_INTENTS,
  INTENTS,
  INTENT_NAMES,
  isKnownIntent,
} from "./catalog.js";
import { buildSystemPrompt } from "./prompt.js";

/*
  The catalog is the single source of truth for a set of facts that used to be
  spread over six files. These tests are the thing that keeps it honest: they
  assert the derived maps still say what the hand-written ones said, so the
  consolidation cannot quietly change who is allowed to do what.
*/

describe("catalog shape", () => {
  it("has unique names", () => {
    expect(new Set(INTENT_NAMES).size).toBe(INTENT_NAMES.length);
  });

  it("gives every intent a department, so nothing lands nowhere", () => {
    for (const i of INTENTS) expect(ACTION_DEPARTMENTS[i.name]).toBeTruthy();
  });

  it("gives every intent at least one example", () => {
    /* The examples are the strongest classification signal in the prompt. An
       intent without one is a definition the model has to guess at. */
    for (const i of INTENTS) expect(i.examples.length).toBeGreaterThan(0);
  });

  it("never marks an intent both auto-safe and always-confirm", () => {
    for (const i of INTENTS) expect(i.autoSafe && i.alwaysConfirm).toBe(false);
  });
});

describe("derived maps match what the hand-written ones said", () => {
  it("permissions", () => {
    expect(ACTION_PERMISSIONS).toEqual({
      assign: "assignment.create",
      return: "assignment.create",
      transfer: "transfer.create",
      repair: "asset.manage",
      lost: "asset.manage",
      intake: "asset.manage",
      report: null,
    });
  });

  it("keeps request_purchase out of the permission map entirely", () => {
    /* Absent, not null. Null would mean "anyone may apply it"; absent means
       there is no apply path, so it is always a request. */
    expect("request_purchase" in ACTION_PERMISSIONS).toBe(false);
    expect("task" in ACTION_PERMISSIONS).toBe(false);
    expect("none" in ACTION_PERMISSIONS).toBe(false);
  });

  it("custody intents", () => {
    expect([...CUSTODY_INTENTS].sort()).toEqual(
      ["assign", "lost", "repair", "return", "transfer"].sort(),
    );
  });

  it("auto-safe intents", () => {
    expect([...AUTO_SAFE_INTENTS].sort()).toEqual(["report", "task"]);
  });
});

describe("isKnownIntent", () => {
  it("accepts the catalog", () => {
    for (const n of INTENT_NAMES) expect(isKnownIntent(n)).toBe(true);
  });

  it("rejects anything else, including near-misses", () => {
    for (const bad of ["Assign", "check_out", "", null, undefined, 7, {}]) {
      expect(isKnownIntent(bad)).toBe(false);
    }
  });
});

describe("generated prompt", () => {
  const prompt = buildSystemPrompt();

  it("names every intent, so the model can emit every one the executor accepts", () => {
    /* The drift this prevents: `intake` was in the maps for a week before the
       prompt mentioned it, so the model never once produced it. */
    for (const i of INTENTS) expect(prompt).toContain(`\`${i.name}\``);
  });

  it("carries the examples", () => {
    for (const i of INTENTS) for (const e of i.examples) expect(prompt).toContain(e);
  });

  it("names no seed data", () => {
    /* The old prompt listed the demo projects and foremen. On a real tenant
       that is a list of people who do not exist, and the model matches against
       it anyway. Real names arrive per message in the context block. */
    for (const ghost of ["Legacy West", "Trinity Bridge Rehab", "Miguel", "Sofia"]) {
      expect(prompt).not.toContain(ghost);
    }
  });
});
