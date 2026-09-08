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
