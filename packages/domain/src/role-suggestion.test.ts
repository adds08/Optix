import { describe, expect, it } from "vitest";
import {
  canonicalKeyForTitle,
  normaliseJobTitle,
  suggestRoleId,
  suggestTierName,
} from "./role-suggestion.js";

/*
  Every title used here is a REAL string from Urban's synced register, not an
  invented one. That is the point of the test: the messiness it has to survive
  (`Operator- Dozer` without the leading space, `Foreman - Structures`,
  `Director of Estimating- Water Department`) is the messiness that actually
  arrived from BambooHR.
*/

const ROLES = [
  { id: "r-director", name: "director" },
  { id: "r-area", name: "area_in_charge" },
  { id: "r-pm", name: "project_manager" },
  { id: "r-super", name: "superintendent" },
  { id: "r-foreman", name: "foreman" },
  { id: "r-engineer", name: "engineer" },
  { id: "r-hr", name: "hr" },
];

const TIERS = [
  { name: "director" },
  { name: "area_in_charge" },
  { name: "general_superintendent" },
  { name: "pm" },
  { name: "superintendent" },
  { name: "foreman" },
];

describe("normaliseJobTitle", () => {
  it("drops the trade suffix, which duplicates the department", () => {
    /* All four are foremen; the suffix says WHICH CREW, and
       `employee.department_id` already carries that. */
    expect(normaliseJobTitle("Foreman - Structures")).toBe("foreman structures");
    expect(normaliseJobTitle("Foreman - Flatworks")).toBe("foreman flatworks");
  });

  it("survives the missing space in `Operator- Dozer`", () => {
    /* Real row. `Operator - Excavator` has the space and this one does not. */
    expect(normaliseJobTitle("Operator- Dozer")).toBe("operator dozer");
    expect(normaliseJobTitle("Operator - Excavator")).toBe("operator excavator");
  });

  it("drops seniority, which is a pay question and not an access one", () => {
    expect(normaliseJobTitle("Senior Project Manager")).toBe("project manager");
    expect(normaliseJobTitle("Sr Project Manager")).toBe("project manager");
    expect(normaliseJobTitle("Carpenter II")).toBe("carpenter");
    expect(normaliseJobTitle("Field Engineer 3")).toBe("field engineer");
  });
});

describe("canonicalKeyForTitle", () => {
  it("prefers the longer phrase, so a general superintendent is not a superintendent", () => {
    expect(canonicalKeyForTitle("General Superintendent")).toBe("general_superintendent");
    expect(canonicalKeyForTitle("Superintendent")).toBe("superintendent");
    expect(canonicalKeyForTitle("Utilities Superintendent")).toBe("superintendent");
  });

  it("reads every real Foreman spelling as a foreman", () => {
    for (const t of [
      "Foreman", "Foreman - Structures", "Foreman - Flatworks",
      "Foreman - Traffic", "Foreman - Dirt", "Pipe Foreman",
      "Paving Foreman", "Utilities Foreman", "Earthworks Foreman",
    ]) {
      expect(canonicalKeyForTitle(t), t).toBe("foreman");
    }
  });

  it("treats Area Manager and Area Superintendent as the area in-charge", () => {
    /* Urban has no title literally called "Area In-charge" — the tier exists
       and the titles that mean it are these two. */
    expect(canonicalKeyForTitle("Area Manager")).toBe("area_in_charge");
    expect(canonicalKeyForTitle("Area Superintendent")).toBe("area_in_charge");
  });

  it("only treats a PROJECT director as leadership", () => {
    /* The distinction that matters most here: `director` alone must not hand
       an estimating or back-office head the authority to claim jobs. */
    expect(canonicalKeyForTitle("Project Director")).toBe("director");
    expect(canonicalKeyForTitle("Director of Estimating- Water Department")).toBe("procurement");
    expect(canonicalKeyForTitle("Director of Project Controls")).toBeNull();
    expect(canonicalKeyForTitle("Human Resources Director")).toBe("hr");
  });

  it("returns null for the long tail rather than guessing", () => {
    /* The whole argument for a suggestion over a mapping table: these say
       nothing about access, and inventing an answer would be worse than none. */
    for (const t of ["Carpenter", "Labor", "Curb Man", "Leadman", "Mantis IT", "Welder"]) {
      expect(canonicalKeyForTitle(t), t).toBeNull();
    }
  });

  it("is null-safe on the half of the register with no title at all", () => {
    expect(canonicalKeyForTitle(null)).toBeNull();
    expect(canonicalKeyForTitle(undefined)).toBeNull();
    expect(canonicalKeyForTitle("")).toBeNull();
    expect(canonicalKeyForTitle("   ")).toBeNull();
  });
});

describe("suggestRoleId", () => {
  it("resolves against the tenant's own register, by name", () => {
    expect(suggestRoleId("Project Director", ROLES)).toBe("r-director");
    expect(suggestRoleId("Area Manager", ROLES)).toBe("r-area");
    expect(suggestRoleId("Senior Project Manager", ROLES)).toBe("r-pm");
  });

  it("returns null when the tenant has no role by that name", () => {
    /* A tenant that deleted or never had `director` gets no suggestion rather
       than a dangling id. */
    expect(suggestRoleId("Project Director", [{ id: "r-pm", name: "project_manager" }])).toBeNull();
  });

  it("returns null for an unrecognised title, leaving the picker unset", () => {
    expect(suggestRoleId("Carpenter", ROLES)).toBeNull();
  });
});

describe("suggestTierName", () => {
  it("resolves against the tier register, which is a different list", () => {
    expect(suggestTierName("General Superintendent", TIERS)).toBe("general_superintendent");
    expect(suggestTierName("Foreman - Flatworks", TIERS)).toBe("foreman");
  });

  it("returns null when the key has no matching tier", () => {
    /* `hr` is a login role and never a tier on a job — the two registers share
       several words and diverge on others, so each resolves separately. */
    expect(suggestTierName("Human Resources Director", TIERS)).toBeNull();
  });
});
