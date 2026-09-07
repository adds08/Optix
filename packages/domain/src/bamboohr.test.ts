import { describe, expect, it } from "vitest";
import {
  adaptBambooEmployee,
  adaptBambooPage,
  normaliseBambooStatus,
  BAMBOO_OPTIONAL_FIELDS,
} from "./bamboohr.js";

/*
  The adapter is pure, so this needs no database, no network and no fixture
  file. Every case below is a payload shape the published reference says can
  actually occur — not an invented edge.

  The restricted-fields group is the important one. It is the rule that, broken,
  loses real data silently on the SECOND sync, which is the worst possible time
  to find out.
*/

/** The shape the reference says always comes back, minus anything a test adds. */
const base = {
  employeeId: "4471",
  firstName: "Alejandro",
  lastName: "Capuchino",
  jobTitleName: "Operator",
  status: "Active",
  _restrictedFields: [] as string[],
};

function ok(record: Record<string, unknown>) {
  const res = adaptBambooEmployee(record);
  if (!res.ok) throw new Error(`expected success, got refusal: ${res.failure.reason}`);
  return res.person;
}

describe("BambooHR employee adapter", () => {
  describe("the match key", () => {
    it("carries employeeId through as the external id, never onto the employee row", () => {
      expect(ok(base).externalId).toBe("4471");
    });

    it("accepts a numeric employeeId, because ids arrive as both", () => {
      expect(ok({ ...base, employeeId: 4471 }).externalId).toBe("4471");
    });

    it("REFUSES a record with no employeeId rather than skipping it quietly", () => {
      const res = adaptBambooEmployee({ ...base, employeeId: undefined });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.failure.reason).toMatch(/employeeId/);
        /* The raw record rides along or the dry-run cannot say WHICH row it
           refused, which makes "refused: 4" unactionable. */
        expect(res.failure.raw).toBeTruthy();
      }
    });

    it("refuses a whitespace-only employeeId — a spreadsheet round-trip produces these", () => {
      expect(adaptBambooEmployee({ ...base, employeeId: "   " }).ok).toBe(false);
    });
  });

  describe("_restrictedFields — a null is NOT an empty value", () => {
    /* The whole reason this adapter exists in this shape. BambooHR nulls a
       field the key may not read and names it here; writing that null through
       would blank a real value on the next sync. */
    it("OMITS a withheld field rather than emitting undefined for it", () => {
      const person = ok({
        ...base,
        workEmail: null,
        mobilePhone: null,
        _restrictedFields: ["workEmail", "mobilePhone"],
      });
      /* `in` rather than a truthiness check: a present key holding undefined
         still overwrites on a spread, so absence is the actual requirement. */
      expect("email" in person.writable).toBe(false);
      expect(person.contacts).toHaveLength(0);
    });

    it("omits a withheld field even when Bamboo sends a value for it anyway", () => {
      /* Belt and braces: if the payload ever contradicts itself, the
         restriction wins. Reading the value would be reading something the key
         was told it may not see. */
      const person = ok({
        ...base,
        workEmail: "alejandro@urban.example",
        _restrictedFields: ["workEmail"],
      });
      expect("email" in person.writable).toBe(false);
    });

    it("passes _restrictedFields through verbatim so a thin record is explainable", () => {
      const person = ok({ ...base, _restrictedFields: ["mobilePhone", "workEmail"] });
      expect(person.withheld).toEqual(["mobilePhone", "workEmail"]);
    });

    it("tolerates _restrictedFields being absent or malformed", () => {
      expect(ok({ ...base, _restrictedFields: undefined }).withheld).toEqual([]);
      expect(ok({ ...base, _restrictedFields: "workEmail" }).withheld).toEqual([]);
      expect(ok({ ...base, _restrictedFields: [1, "workEmail", null] }).withheld).toEqual([
        "workEmail",
      ]);
    });

    it("still refuses on a withheld employeeId — an anonymous row is not usable", () => {
      const res = adaptBambooEmployee({
        ...base,
        employeeId: null,
        _restrictedFields: ["employeeId"],
      });
      expect(res.ok).toBe(false);
    });
  });

  describe("status is OBSERVED, never written", () => {
    /* Settled with the user 2026-09-07: a sync flags a departure, it never
       performs one. Terminating somebody reaches tool custody and the
       clearance queue. */
    it("normalises Active and Inactive", () => {
      expect(normaliseBambooStatus("Active")).toBe("active");
      expect(normaliseBambooStatus("Inactive")).toBe("terminated");
    });

    it("is case-insensitive — this is a display string in someone else's system", () => {
      expect(normaliseBambooStatus("ACTIVE")).toBe("active");
      expect(normaliseBambooStatus("inactive")).toBe("terminated");
    });

    it("maps Inactive to terminated and NOT to on_leave", () => {
      /* Bamboo models leave separately. Reading Inactive as on_leave would
         resurrect leavers as current staff. */
      expect(normaliseBambooStatus("Inactive")).not.toBe("on_leave");
    });

    it("reaches on_leave, which nothing could previously produce", () => {
      /* `EMPLOYMENT_STATUSES` has three values and `status` carries two, so
         until `employmentStatusName` was requested this enum member had no
         source at all — dead by construction. */
      expect(normaliseBambooStatus("Active", "Leave of Absence")).toBe("on_leave");
    });

    it("matches any wording containing leave, because the wording is tenant-defined", () => {
      expect(normaliseBambooStatus("Active", "FMLA Leave")).toBe("on_leave");
      expect(normaliseBambooStatus("Active", "Maternity Leave")).toBe("on_leave");
    });

    it("lets Inactive win over a leave status name", () => {
      /* The conservative order, chosen deliberately: somebody HR marked
         Inactive is off the roster whatever the status name says. Reading it as
         on_leave would keep them out of the clearance queue, which is an
         ex-employee holding tools that nobody goes looking for. */
      expect(normaliseBambooStatus("Inactive", "Leave of Absence")).toBe("terminated");
    });

    it("stays active for a status name that is not leave", () => {
      expect(normaliseBambooStatus("Active", "Full-Time")).toBe("active");
      expect(normaliseBambooStatus("Active", "Part-Time")).toBe("active");
    });

    it("folds the status name through the adapter, not just the bare function", () => {
      const person = ok({ ...base, employmentStatusName: "Leave of Absence" });
      expect(person.observed.employmentStatus).toBe("on_leave");
      expect(person.observed.rawEmploymentStatusName).toBe("Leave of Absence");
    });

    it("carries a termination date as an observation, never as a write", () => {
      /* `employee.terminated_at` is the column this targets and the one the
         clearance queue reads. It stays in `observed` because the user settled
         that a departure is a flag an admin acts on, not something a sync
         performs. */
      const person = ok({ ...base, status: "Inactive", terminationDate: "2026-03-15" });
      expect(person.observed.terminationDate).toBe("2026-03-15");
      expect(person.writable).not.toHaveProperty("terminationDate");
      expect(person.identity).not.toHaveProperty("terminationDate");
    });

    it("omits a withheld termination date rather than emitting undefined", () => {
      /* Same rule as every other field: a key present holding `undefined`
         still overwrites on a spread. */
      const person = ok({
        ...base,
        status: "Inactive",
        terminationDate: "2026-03-15",
        _restrictedFields: ["terminationDate"],
      });
      expect(person.observed).not.toHaveProperty("terminationDate");
    });

    it("returns null for an unrecognised status rather than guessing", () => {
      expect(normaliseBambooStatus("Furloughed")).toBeNull();
      expect(normaliseBambooStatus(undefined)).toBeNull();
      expect(normaliseBambooStatus("")).toBeNull();
    });

    it("keeps Bamboo's own word so a surprising value is debuggable", () => {
      const person = ok({ ...base, status: "Furloughed" });
      expect(person.observed.employmentStatus).toBeNull();
      expect(person.observed.rawStatus).toBe("Furloughed");
    });

    it("never puts employmentStatus in the writable bucket", () => {
      const person = ok({ ...base, status: "Inactive" });
      expect(Object.keys(person.writable)).not.toContain("employmentStatus");
      expect(Object.keys(person.identity)).not.toContain("employmentStatus");
    });
  });

  describe("identity is proposed, not applied", () => {
    it("puts code and name in identity, never in writable", () => {
      const person = ok({ ...base, employeeNumber: "URB-001" });
      expect(person.identity.code).toBe("URB-001");
      expect(person.identity.name).toBe("Alejandro Capuchino");
      expect(Object.keys(person.writable)).not.toContain("code");
      expect(Object.keys(person.writable)).not.toContain("name");
    });

    it("reads employeeNumber as the code and employeeId as the external id — they are different facts", () => {
      const person = ok({ ...base, employeeId: "4471", employeeNumber: "URB-001" });
      expect(person.externalId).toBe("4471");
      expect(person.identity.code).toBe("URB-001");
    });

    it("joins a name from one half when the other is withheld", () => {
      const person = ok({ ...base, lastName: null, _restrictedFields: ["lastName"] });
      expect(person.identity.name).toBe("Alejandro");
    });

    it("omits name entirely when both halves are withheld, rather than emitting a space", () => {
      const person = ok({
        ...base,
        firstName: null,
        lastName: null,
        _restrictedFields: ["firstName", "lastName"],
      });
      expect("name" in person.identity).toBe(false);
    });

    it("ignores preferredName — the register reconciles with payroll, not with nicknames", () => {
      const person = ok({ ...base, preferredName: "Alex" });
      expect(person.identity.name).toBe("Alejandro Capuchino");
    });
  });

  describe("the manager edge", () => {
    it("resolves by reportsToId and never by reportsToName", () => {
      const person = ok({ ...base, reportsToId: "4400", reportsToName: "Gilmer Medina" });
      expect(person.reportsToExternalId).toBe("4400");
    });

    it("ignores reportsToName when the id is withheld — a name is not a usable key here", () => {
      /* Urban's roster has five deliberately-separate near-duplicate pairs
         (Gilmer/Gilmar Medina among them), so a name lookup binds the wrong
         twin. Better to record no manager than the wrong one. */
      const person = ok({
        ...base,
        reportsToId: null,
        reportsToName: "Gilmar Medina",
        _restrictedFields: ["reportsToId"],
      });
      expect(person.reportsToExternalId).toBeUndefined();
    });

    it("drops a self-reference instead of passing a guaranteed 400 downstream", () => {
      const person = ok({ ...base, reportsToId: "4471" });
      expect(person.reportsToExternalId).toBeUndefined();
    });
  });

  describe("fields deliberately not mapped to columns", () => {
    it("keeps locationName in raw and out of writable — an HR office is not a place a tool sits", () => {
      const person = ok({ ...base, locationName: "Farmers Branch, TX" });
      expect(Object.keys(person.writable)).not.toContain("locationName");
      expect(person.raw["locationName"]).toBe("Farmers Branch, TX");
    });

    it("never surfaces photoUrl as a stored value — the signature expires", () => {
      const person = ok({ ...base, photoUrl: "https://example.test/p.jpg?Policy=abc" });
      const flat = JSON.stringify({
        writable: person.writable,
        identity: person.identity,
        observed: person.observed,
      });
      expect(flat).not.toContain("photoUrl");
      expect(flat).not.toContain("Policy");
    });
  });

  describe("contacts", () => {
    it("splits mobile and work into separate rows, both optional", () => {
      const person = ok({ ...base, mobilePhone: "214-555-0100", workPhone: "214-555-0199" });
      expect(person.contacts).toEqual([
        { kind: "mobile", value: "214-555-0100" },
        { kind: "work", value: "214-555-0199" },
      ]);
    });

    it("emits nothing when neither number is present", () => {
      expect(ok(base).contacts).toEqual([]);
    });
  });

  describe("a page", () => {
    it("keeps refusals beside successes so a dry run can report both", () => {
      const { people, failures } = adaptBambooPage([
        { ...base, employeeId: "1" },
        { ...base, employeeId: undefined },
        { ...base, employeeId: "3" },
      ]);
      expect(people.map((p) => p.externalId)).toEqual(["1", "3"]);
      expect(failures).toHaveLength(1);
    });

    it("does not abandon the rest of a page when one record is unusable", () => {
      const { people } = adaptBambooPage([{ employeeId: undefined }, { ...base }]);
      expect(people).toHaveLength(1);
    });

    it("handles an empty page", () => {
      expect(adaptBambooPage([])).toEqual({ people: [], failures: [] });
    });
  });

  describe("the fields request", () => {
    it("asks for every optional field the adapter reads", () => {
      /* If these drift apart the sync silently stops receiving a mapped field
         and it presents as "BambooHR never sends this". */
      for (const f of ["workEmail", "mobilePhone", "workPhone", "departmentName", "divisionName", "employeeNumber", "reportsToId"]) {
        expect(BAMBOO_OPTIONAL_FIELDS).toContain(f);
      }
    });

    it("does not ask for fields that always come back anyway", () => {
      for (const f of ["employeeId", "firstName", "lastName", "jobTitleName", "_restrictedFields"]) {
        expect(BAMBOO_OPTIONAL_FIELDS).not.toContain(f);
      }
    });
  });
});
