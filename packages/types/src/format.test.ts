import { describe, expect, it } from "vitest";
import { daysFrom, formatAssetModel, relative } from "./format.js";

/* Dates are built as offsets from now, never hardcoded — a fixture dated 2027
   silently changes meaning as the calendar moves, which is the same class of
   mistake as the bug below. Noon avoids a local-midnight boundary flipping a
   day either way. */
function daysAway(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

describe("daysFrom", () => {
  it("is days SINCE — positive for the past, negative for the future", () => {
    expect(daysFrom(daysAway(-10))).toBe(10);
    expect(daysFrom(daysAway(10))).toBe(-10);
  });

  it("returns null rather than NaN for absent or unparseable input", () => {
    expect(daysFrom(null)).toBeNull();
    expect(daysFrom(undefined)).toBeNull();
    expect(daysFrom("")).toBeNull();
    expect(daysFrom("not a date")).toBeNull();
  });
});

describe("relative", () => {
  /*
    UI-60 / UI-62 / UI-63 / UI-64 / UI-65 — five reports of one defect.

    `relative` handled only the past, because every caller passed a `createdAt`
    or an `occurredAt`. Warranty expiry passes a date in the FUTURE, and
    `daysFrom` returns a negative number for those, which fell through the
    `days < 30` branch: a warranty running to Oct 2027 rendered as
    "expires -413 days ago". An in-warranty tool read as long expired.
  */
  it("says how long is LEFT for a future date, never '... ago'", () => {
    expect(relative(daysAway(413))).toBe("in 1 yr");
    expect(relative(daysAway(20))).toBe("in 20 days");
    expect(relative(daysAway(60))).toBe("in 2 mo");
    expect(relative(daysAway(1))).toBe("tomorrow");
  });

  it("never emits a negative number, at any future distance", () => {
    for (const n of [1, 2, 15, 29, 30, 31, 200, 364, 365, 366, 413, 515, 5_000]) {
      const out = relative(daysAway(n));
      expect(out, `${n} days ahead rendered as "${out}"`).not.toContain("-");
      expect(out, `${n} days ahead rendered as "${out}"`).not.toContain("ago");
    }
  });

  /* The exact figure UI-62 asks for: a warranty to 15 Jan 2028 should read as
     time remaining, not as an expiry in the past. */
  it("reads as remaining time at the distance UI-62 reports", () => {
    expect(relative(daysAway(515))).toBe("in 1 yr");
    expect(relative(daysAway(90))).toBe("in 3 mo");
  });

  it("still reads the past the way every other caller depends on", () => {
    expect(relative(daysAway(0))).toBe("today");
    expect(relative(daysAway(-1))).toBe("yesterday");
    expect(relative(daysAway(-10))).toBe("10 days ago");
    expect(relative(daysAway(-60))).toBe("2 mo ago");
    expect(relative(daysAway(-400))).toBe("1 yr ago");
  });

  it("returns a dash for absent input rather than inventing a date", () => {
    expect(relative(null)).toBe("—");
    expect(relative(undefined)).toBe("—");
    expect(relative("not a date")).toBe("—");
  });
});

describe("formatAssetModel", () => {
  it("joins the columns that are present and drops the ones that are not", () => {
    expect(formatAssetModel({ make: "BOSCH", modelNumber: "GWS10", description: "grinder" })).toBe(
      "BOSCH GWS10 grinder",
    );
    expect(formatAssetModel({ make: "BOSCH", modelNumber: null, description: null })).toBe("BOSCH");
    expect(formatAssetModel({})).toBe("");
  });
});
