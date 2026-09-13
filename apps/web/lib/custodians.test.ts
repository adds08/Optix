import { describe, expect, it } from "vitest";
import { activeCustodians, canHoldCustody } from "./custodians";

/*
  The test that would have caught it.

  Six pickers filtered on `CUSTODIAN_ROLES` — three role names, compiled in —
  while `role.can_hold_custody` sat stored, seeded and editable on
  /settings/roles with nothing reading it. Ticking the box changed nothing, and
  no test noticed, because every test asserted the CONSTANT against the SEED.
  Both were right about each other and neither was what the UI did.

  These assert the helper honours the column, which is the fact that was
  missing. Pure — no database, no React.
*/
describe("canHoldCustody", () => {
  it("takes the server's answer over the role name", () => {
    /* A field engineer: not in `CUSTODIAN_ROLES`, marked custody-capable on
       the tier ladder the client drew. Before this helper the register said
       yes and every picker in the product said no. */
    expect(canHoldCustody({ role: "field_engineer", roleCanHoldCustody: true })).toBe(true);
  });

  it("refuses somebody whose role name would have let them through", () => {
    /* The other direction, and the one that matters for an administrator who
       REVOKES custody: the name still says foreman, the register says no. */
    expect(canHoldCustody({ role: "foreman", roleCanHoldCustody: false })).toBe(false);
  });

  it("falls back to the role name when the server did not answer", () => {
    /* `undefined` is a payload that predates the field — not a denial. The
       fallback is what stops a half-migrated client emptying every picker. */
    expect(canHoldCustody({ role: "foreman" })).toBe(true);
    expect(canHoldCustody({ role: "pm" })).toBe(false);
  });

  it("treats a person with no login role as unable to hold custody", () => {
    /* `null` is the left join finding nothing: the person has no role, so the
       register has no opinion, and an unanswered question is not a yes. */
    expect(canHoldCustody({ role: "foreman", roleCanHoldCustody: null })).toBe(false);
  });
});

describe("activeCustodians", () => {
  const people = [
    { id: "1", role: "foreman", roleCanHoldCustody: true, employmentStatus: "active" },
    { id: "2", role: "foreman", roleCanHoldCustody: true, employmentStatus: "terminated" },
    { id: "3", role: "pm", roleCanHoldCustody: false, employmentStatus: "active" },
    { id: "4", role: "field_engineer", roleCanHoldCustody: true, employmentStatus: "active" },
  ];

  it("offers only people who may hold a tool and still work here", () => {
    expect(activeCustodians(people).map((p) => p.id)).toEqual(["1", "4"]);
  });

  it("includes leavers when a screen asks, because clearance needs them", () => {
    /* The jobsites card resolves crew DISPLAY across terminated staff — they
       are exactly the people the HR clearance workflow is chasing tools from.
       Two of the six pickers had this condition in a different order and one
       omitted it, which is how a terminated foreman stayed selectable on one
       screen and not another. */
    expect(activeCustodians(people, { includeInactive: true }).map((p) => p.id)).toEqual(["1", "2", "4"]);
  });

  it("survives an unloaded query", () => {
    expect(activeCustodians(undefined)).toEqual([]);
    expect(activeCustodians(null)).toEqual([]);
  });
});
