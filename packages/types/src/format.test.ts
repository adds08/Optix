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

describe("daysFrom is a CALENDAR difference, not elapsed time", () => {
  /*
    The bug this caught, on 2026-08-23: `daysFrom` measured milliseconds since
    the date and floored them, so its answer moved with the wall clock. A tool
    tagged at noon read as "today" after lunch and "tomorrow" all morning, and
    "10 days ago" read as 9 until noon came round.

    These build their fixtures at a fixed hour and assert the answer is the
    same regardless — which the old implementation cannot satisfy.
  */
  function at(hour: number, daysOffset: number): Date {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    d.setDate(d.getDate() + daysOffset);
    return d;
  }

  it("says today for any hour of today", () => {
    /* 00:01 and 23:59 are the same calendar day and must read the same. The
       old code returned 0 for one and -1 ("tomorrow") for the other,
       depending on when you looked. */
    for (const hour of [0, 6, 12, 18, 23]) {
      expect(daysFrom(at(hour, 0)), `${hour}:00 today`).toBe(0);
      expect(relative(at(hour, 0)), `${hour}:00 today`).toBe("today");
    }
  });

  it("says yesterday for any hour of yesterday", () => {
    for (const hour of [0, 12, 23]) {
      expect(daysFrom(at(hour, -1)), `${hour}:00 yesterday`).toBe(1);
      expect(relative(at(hour, -1))).toBe("yesterday");
    }
  });

  it("counts ten days as ten from any hour", () => {
    for (const hour of [1, 12, 22]) {
      expect(daysFrom(at(hour, -10)), `${hour}:00, ten days back`).toBe(10);
    }
  });

  it("reads a date-only string as a day in the reader's timezone, not UTC", () => {
    /*
      `warrantyExpiresOn` is a `date` column and arrives as "2026-08-23".
      `new Date("2026-08-23")` is UTC midnight, which west of Greenwich is the
      previous day locally — so a warranty expiring today reads as already
      expired in Dallas and not in London. The same string must mean the same
      calendar day wherever it is read.
    */
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(daysFrom(iso)).toBe(0);
    expect(relative(iso)).toBe("today");
  });

  it("still returns null for rubbish rather than NaN", () => {
    /* `Math.round(NaN)` is NaN, which would render as "NaN days ago" instead
       of the em-dash `relative` promises for an unknown date. */
    expect(daysFrom("not a date")).toBeNull();
    expect(daysFrom("")).toBeNull();
    expect(daysFrom(null)).toBeNull();
    expect(relative("not a date")).toBe("—");
  });
});
