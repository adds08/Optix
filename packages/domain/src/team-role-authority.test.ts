import { describe, expect, it } from "vitest";
import { canAssignIntoTier } from "./team-role-authority.js";

/*
  Each test isolates ONE of the three paths — the point is that no path can be
  satisfied by accident from the others' inputs. A test that set every flag
  true at once would not tell you which branch actually fired.
*/

const base = {
  hasAdminPermission: false,
  targetIsOpenToEveryone: false,
  callerTierNamesOnThisProject: new Set<string>(),
  targetAssignerTierNames: new Set<string>(),
};

describe("canAssignIntoTier", () => {
  it("refuses when none of the three paths apply", () => {
    expect(canAssignIntoTier(base)).toBe(false);
  });

  it("path 1: an admin-shaped permission always wins, regardless of the other two", () => {
    expect(canAssignIntoTier({ ...base, hasAdminPermission: true })).toBe(true);
  });

  it("path 2: a tier open to everyone admits a caller holding no tier at all", () => {
    expect(canAssignIntoTier({ ...base, targetIsOpenToEveryone: true })).toBe(true);
  });

  it("path 3: holding one of the target's registered assigner tiers, on this project", () => {
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set(["superintendent"]),
        targetAssignerTierNames: new Set(["superintendent", "pm"]),
      }),
    ).toBe(true);
  });

  it("path 3 refuses a tier the caller holds that is NOT on the target's list", () => {
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set(["foreman"]),
        targetAssignerTierNames: new Set(["superintendent", "pm"]),
      }),
    ).toBe(false);
  });

  it("path 3 refuses a tier the caller holds ONLY on a different project — the caller's set must already be scoped to the same project", () => {
    /* This function trusts its caller to have scoped `callerTierNamesOnThisProject`
       correctly; it cannot detect a wrongly-scoped set on its own. This test
       documents the contract rather than testing project-scoping itself, which
       lives in the router. */
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set<string>(), // caller holds "superintendent" elsewhere, not passed
        targetAssignerTierNames: new Set(["superintendent"]),
      }),
    ).toBe(false);
  });

  it("an empty assigner list is 'nobody yet', not 'everybody' — distinct from targetIsOpenToEveryone", () => {
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set(["director"]),
        targetAssignerTierNames: new Set(),
      }),
    ).toBe(false);
  });
});

/*
  PATH 4 — a tier may be set by everyone ABOVE it on the ladder.

  Urban's ladder, which every case below is drawn from:

    Director
      └─ Area In-charge
           ├─ General Superintendent   (nothing reports to it)
           ├─ Project Manager
           └─ Superintendent
                └─ Foreman, Field Engineer, Project Engineer

  and Urban's "Set by": Foreman is set by Superintendent, PM and General
  Superintendent; PM and Superintendent by Area In-charge and GSuper; GSuper by
  Director and Area In-charge.
*/
describe("canAssignIntoTier — path 4, the ladder", () => {
  const foremanAncestors = new Set(["superintendent", "area_in_charge", "director"]);
  const foremanSetBy = new Set(["superintendent", "pm", "general_superintendent"]);

  it("lets a Director set a Foreman, which 'Set by' alone refused", () => {
    /* The reported bug: Director is not in Foreman's "Set by" list, so the tier
       was withheld from a person every tier between them answers to. */
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set(["director"]),
        targetAssignerTierNames: foremanSetBy,
        targetAncestorTierNames: foremanAncestors,
      }),
    ).toBe(true);
  });

  it("still refuses a Superintendent setting a PM — the property that keeps this a hierarchy", () => {
    /* A Superintendent is neither above a PM on the ladder nor in the PM
       tier's "Set by". If this ever returns true the change has become a
       free-for-all. */
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set(["superintendent"]),
        targetAssignerTierNames: new Set(["area_in_charge", "general_superintendent"]),
        targetAncestorTierNames: new Set(["area_in_charge", "director"]),
      }),
    ).toBe(false);
  });

  it("keeps a General Superintendent's authority, which ancestry alone would have destroyed", () => {
    /* The case that forced a UNION rather than a replacement: NOTHING reports
       to General Superintendent on the ladder, so it is nobody's ancestor. Its
       authority over Foreman exists only in "Set by", and path 3 must still
       carry it. */
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set(["general_superintendent"]),
        targetAssignerTierNames: foremanSetBy,
        targetAncestorTierNames: foremanAncestors,
      }),
    ).toBe(true);
  });

  it("is absent-safe: no ancestor set behaves exactly as before", () => {
    /* Every pre-existing caller omits the field, and must keep its old answer
       until it is wired up. */
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set(["director"]),
        targetAssignerTierNames: foremanSetBy,
      }),
    ).toBe(false);
  });

  it("an empty ancestor set refuses, the same way an empty assigner list does", () => {
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set(["director"]),
        targetAssignerTierNames: new Set(),
        targetAncestorTierNames: new Set(),
      }),
    ).toBe(false);
  });

  it("does not let a tier set ITSELF — a Foreman is not above a Foreman", () => {
    /* `tiersAbove` excludes the tier it starts from, and this pins that: two
       foremen on a job must not be able to place each other. */
    expect(
      canAssignIntoTier({
        ...base,
        callerTierNamesOnThisProject: new Set(["foreman"]),
        targetAssignerTierNames: foremanSetBy,
        targetAncestorTierNames: foremanAncestors,
      }),
    ).toBe(false);
  });
});
