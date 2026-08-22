import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, VIEW_SCOPES, PM_EMPLOYEE_ROLE, PM_LOGIN_ROLE, isViewScope, tierAtLeast } from "./index.js";
import { EMPLOYEE_ROLES, CUSTODIAN_ROLES } from "./enums.js";

/*
  The visibility ladder's SHAPE (STI-302), pinned in the package that declares
  it — no database, no fixtures.

  `VIEW_SCOPES` is not just a list, it is an ORDER: `scope.ts` resolves a tier
  by walking it front to back and taking the first match, and
  `panel-registry.tsx` compares indices to answer "at least this wide". Both
  read this array precisely so the order is written down once. Reordering it
  silently changes who sees what, in two places, with no other test failing —
  which is what this file exists to stop.
*/
describe("the visibility ladder (STI-302)", () => {
  it("is ordered widest-first, and that order is the rule", () => {
    /* Not a restatement of the source: `scope.ts` returns the FIRST match, so
       if `assets.view.own` ever moved to the front, every foreman would keep
       their own tier and every admin would be demoted to it. */
    expect([...VIEW_SCOPES]).toEqual([
      "assets.view.all",
      "assets.view.project",
      "assets.view.crew",
      "assets.view.own",
    ]);
  });

  it("declares every tier as a real permission", () => {
    for (const scope of VIEW_SCOPES) {
      expect(PERMISSIONS as readonly string[]).toContain(scope);
    }
  });

  it("has no duplicates — a repeated tier would make first-match ambiguous", () => {
    expect(new Set(VIEW_SCOPES).size).toBe(VIEW_SCOPES.length);
  });

  it("recognises a tier, and nothing else", () => {
    expect(isViewScope("assets.view.crew")).toBe(true);
    /* A real permission, but not a tier — the Desk registry uses this to decide
       whether to compare widths or just call has(). */
    expect(isViewScope("assignment.approve")).toBe(false);
    expect(isViewScope("assets.view.everything")).toBe(false);
  });
});

describe("tierAtLeast — 'wide enough for', not 'equal to'", () => {
  /*
    The Desk's panel registry asks this to decide whether a panel applies.
    Getting it backwards is not a crash: it silently hides the yard desk's main
    screen from the yard desk (`all` failing a `project` requirement), or shows
    a foreman a panel built for the whole company.
  */
  it("lets a wider tier satisfy a narrower requirement", () => {
    expect(tierAtLeast("assets.view.all", "assets.view.project")).toBe(true);
    expect(tierAtLeast("assets.view.all", "assets.view.own")).toBe(true);
    expect(tierAtLeast("assets.view.project", "assets.view.crew")).toBe(true);
  });

  it("does NOT let a narrower tier satisfy a wider requirement", () => {
    expect(tierAtLeast("assets.view.own", "assets.view.all")).toBe(false);
    expect(tierAtLeast("assets.view.crew", "assets.view.project")).toBe(false);
  });

  it("is reflexive — a tier always satisfies itself", () => {
    for (const s of VIEW_SCOPES) expect(tierAtLeast(s, s)).toBe(true);
  });

  it("agrees with the declared order for every pair", () => {
    /* The property, not four examples: wider-or-equal is exactly
       index(actor) <= index(needed), for all sixteen combinations. */
    for (const a of VIEW_SCOPES) {
      for (const b of VIEW_SCOPES) {
        expect(tierAtLeast(a, b)).toBe(VIEW_SCOPES.indexOf(a) <= VIEW_SCOPES.indexOf(b));
      }
    }
  });
});

describe("roles (STI-304)", () => {
  it("carries the three roles Phase 3 added, and NOT a second superuser", () => {
    for (const r of ["office_admin", "engineer", "mechanic"]) {
      expect(ROLES as readonly string[]).toContain(r);
    }
    /* `owner` IS the System Administrator. A `system_admin` role alongside it
       would be two names for one authority — the "'Admin' means three things"
       ambiguity SYSTEM_PLAN §2 forbids reaching the code. If someone adds it,
       this test is where the argument is. */
    expect(ROLES as readonly string[]).not.toContain("system_admin");
    expect(ROLES as readonly string[]).toContain("owner");
  });

  it("has no duplicate role names", () => {
    expect(new Set(ROLES).size).toBe(ROLES.length);
  });
});

describe("the two role vocabularies stay separate (STI-301 problem 3)", () => {
  /*
    `pm` (employment) and `project_manager` (authorisation) name the same human
    in two lists that must not be joined by a literal written from memory —
    STI-301 recorded the mismatch as a latent bug before it became a real one.
  */
  it("keeps `pm` an employee role and `project_manager` a login role", () => {
    expect(EMPLOYEE_ROLES as readonly string[]).toContain(PM_EMPLOYEE_ROLE);
    expect(ROLES as readonly string[]).toContain(PM_LOGIN_ROLE);
    /* The point of the pair: neither name appears in the other list. */
    expect(ROLES as readonly string[]).not.toContain(PM_EMPLOYEE_ROLE);
    expect(EMPLOYEE_ROLES as readonly string[]).not.toContain(PM_LOGIN_ROLE);
  });

  it("has no employee role for `engineer` — an engineer is an authority, not a job title here", () => {
    /* PERMISSION_MATRIX §1: an Engineer is a Project Manager where small tools
       are concerned. Their EMPLOYEE role is `pm`; adding an `engineer`
       employee role would give the seed two places to disagree about the same
       person. */
    expect(EMPLOYEE_ROLES as readonly string[]).not.toContain("engineer");
  });

  it("keeps `mechanic` in both — they hold tools AND now log in", () => {
    /* `CUSTODIAN_ROLES` included `mechanic` long before the login role
       existed: the person was in the register, the account was not. Both are
       true now and both must stay true, or a mechanic can sign in and not be
       offered as a custodian. */
    expect(CUSTODIAN_ROLES as readonly string[]).toContain("mechanic");
    expect(EMPLOYEE_ROLES as readonly string[]).toContain("mechanic");
    expect(ROLES as readonly string[]).toContain("mechanic");
  });
});
