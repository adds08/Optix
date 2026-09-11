import { describe, expect, it } from "vitest";
import { roleSpecs, teamRoleSpecs } from "@stinventory/db";

/*
  THE ONBOARDING CHAIN, PINNED AS A BASELINE.

  Every environment must start from the same tier vocabulary, the same "Set by"
  edges, the same ladder and the same claim grants. They did not. Checked on
  2026-09-11:

    | | local | dev | production |
    |---|---|---|---|
    | tiers                | 8  | 0  | 8  |
    | assigner edges       | 16 | 0  | 24 |
    | roles w/ claim grant | 3  | 3  | 4  |

  Each number was a different bug wearing the same shape:

  * **dev had NOTHING.** `claimOptions` resolves a role's `claimTierNames`
    against `team_role`, so an empty register returns no tiers, and
    `jobs-step.tsx` hides the whole take-on form when `tiers.length` is 0. A
    General Superintendent — a role that holds a claim grant — was shown "your
    manager should assign you a project", which is false in both directions and
    read as a broken product.
  * **production had EIGHT MORE EDGES and a FOURTH claim grant**, added through
    the Team Roles screen. Seven of the edges are ladder ancestry that
    `canAssignIntoTier` path 4 already grants, so they change nothing; the
    fourth claim grant (`superintendent`) genuinely changes who may claim a job.

  This file pins the SEEDED BASELINE — what every environment starts as. It is
  deliberately NOT a claim that the live rows still match: the Team Roles screen
  exists so a tenant can change its own chain, and a test that forbade that
  would forbid the feature. What it stops is the baseline itself drifting
  silently, so "dev behaves differently from production" is a test failure here
  rather than a bug report from a presentation.

  Pure — both sides are literals in `packages/db`. No database, no fixtures.
*/

/** Tier -> the tiers its `setBy` names, as the seed defines them. */
const SEEDED_SET_BY: Record<string, string[]> = {
  director: [],
  area_in_charge: ["director"],
  general_superintendent: ["area_in_charge", "director"],
  pm: ["area_in_charge", "general_superintendent"],
  superintendent: ["area_in_charge", "general_superintendent"],
  project_engineer: ["general_superintendent", "pm", "superintendent"],
  field_engineer: ["general_superintendent", "pm", "superintendent"],
  foreman: ["general_superintendent", "pm", "superintendent"],
};

/** Tier -> who it answers to. `null` is the top of the chain. */
const SEEDED_LADDER: Record<string, string | null> = {
  director: null,
  area_in_charge: "director",
  general_superintendent: "area_in_charge",
  pm: "area_in_charge",
  superintendent: "area_in_charge",
  project_engineer: "superintendent",
  field_engineer: "superintendent",
  foreman: "superintendent",
};

/*
  The roles that may put THEMSELVES on a job. This is the line between
  "leads jobs" and "is placed on jobs", and it is the single most
  consequential row in this file: a role missing from here cannot self-serve,
  and one wrongly added can join any job in the tenant unaided.
*/
const SEEDED_CLAIMERS = ["area_in_charge", "director", "general_superintendent"];

describe("the seeded tier baseline", () => {
  it("defines exactly the eight tiers the chain is built from", () => {
    expect(teamRoleSpecs.map((t) => t.name).sort()).toEqual(Object.keys(SEEDED_SET_BY).sort());
  });

  it("gives every tier the Set-by list the chain was designed with", () => {
    for (const spec of teamRoleSpecs) {
      expect([...(spec.setBy ?? [])].sort(), `"Set by" for ${spec.name}`).toEqual(
        [...SEEDED_SET_BY[spec.name]!].sort(),
      );
    }
  });

  it("keeps the ladder a single chain from director down", () => {
    for (const spec of teamRoleSpecs) {
      expect(spec.reportsTo ?? null, `ladder parent of ${spec.name}`).toBe(SEEDED_LADDER[spec.name]!);
    }
  });

  it("lets exactly three roles claim a job for themselves", () => {
    const claimers = roleSpecs
      .filter((r) => (r.claimTierNames ?? []).length > 0)
      .map((r) => r.name)
      .sort();
    expect(claimers).toEqual(SEEDED_CLAIMERS);
  });

  it("gives each claiming role its OWN tier and nothing else", () => {
    /* A role that could claim into somebody else's tier would be a way to
       appoint yourself General Superintendent by claiming a job. */
    for (const role of roleSpecs) {
      const tiers = role.claimTierNames ?? [];
      if (!tiers.length) continue;
      expect(tiers, `${role.name} claims into`).toEqual([role.name]);
    }
  });

  it("names only real tiers in a claim grant", () => {
    /* `claimOptions` joins these names against `team_role`. A name with no
       matching tier silently yields an empty picker — which is exactly the
       shape of the dev failure, reached by a different route. */
    const tierNames = new Set(teamRoleSpecs.map((t) => t.name));
    for (const role of roleSpecs) {
      for (const tier of role.claimTierNames ?? []) {
        expect(tierNames.has(tier), `${role.name} claims "${tier}", which is not a seeded tier`).toBe(true);
      }
    }
  });

  it("names only real tiers in a Set-by list", () => {
    const tierNames = new Set(teamRoleSpecs.map((t) => t.name));
    for (const spec of teamRoleSpecs) {
      for (const setter of spec.setBy ?? []) {
        expect(tierNames.has(setter), `${spec.name} is set by "${setter}", which is not a seeded tier`).toBe(true);
      }
    }
  });

  it("leaves every tier reachable, so nobody is stranded", () => {
    /* A tier with no Set-by AND no claim grant can never be filled by anyone.
       `director` is the deliberate exception: it is reached by claiming. */
    const claimable = new Set(roleSpecs.flatMap((r) => r.claimTierNames ?? []));
    for (const spec of teamRoleSpecs) {
      const reachable = (spec.setBy ?? []).length > 0 || claimable.has(spec.name);
      expect(reachable, `nothing can ever fill the "${spec.name}" tier`).toBe(true);
    }
  });
});
