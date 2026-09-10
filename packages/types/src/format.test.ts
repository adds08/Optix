import { afterEach, describe, expect, it, vi } from "vitest";
import { daysFrom, formatAssetModel, relative, toDate } from "./format.js";

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

/* This file runs under TZ=America/Chicago (see package.json) — Urban is in
   Dallas, and west of Greenwich is the only place the UI-60 defect is visible.
   In UTC the fixed and the broken parse are observationally identical, so
   nothing below could catch it on a UTC runner. */
describe("toDate", () => {
  /*
    UI-60 — the half that was NOT fixed with UI-62/63/64/65.

    A `date` column arrives as "2027-10-09" and means a calendar day. The spec
    reads a date-only string as UTC midnight, which in Dallas is 19:00 on the
    8th, so the Warranty field on the tool detail page rendered "Oct 8, 2027"
    for a warranty expiring on the 9th — all day, every day. Same shift on
    `acquisitionDate`, project and assignment `startDate`, posting
    `startedOn`/`endedOn`.
  */
  it("reads a date-only column as that calendar day, not as UTC midnight", () => {
    const d = toDate("2027-10-09");
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(9);
    expect(d.getHours()).toBe(0);
  });

  /* A full timestamp is a real instant, not a day — leave it exactly where it
     landed. */
  it("leaves a full timestamp alone", () => {
    const iso = "2027-10-09T02:30:00.000Z";
    expect(toDate(iso).getTime()).toBe(new Date(iso).getTime());
  });

  it("passes a Date straight through", () => {
    const d = daysAway(-3);
    expect(toDate(d)).toBe(d);
  });
});

describe("daysFrom", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is days SINCE — positive for the past, negative for the future", () => {
    expect(daysFrom(daysAway(-10))).toBe(10);
    expect(daysFrom(daysAway(10))).toBe(-10);
  });

  /*
    The other half of UI-60. This used to measure elapsed milliseconds and
    floor, so the answer moved with the wall clock: the day boundary landed at
    19:00 local in Dallas, inside a yard's working evening. Between 19:00 and
    midnight a warranty expiring today read "expires yesterday", and one that
    expired yesterday still wore the amber "ends soon" badge instead of the red
    "expired" one.

    Fixture dates are hardcoded here — the exception to the rule at the top of
    this file — because the clock is pinned with fake timers, so they cannot
    drift into meaning something else.
  */
  it("counts calendar days, so the hour of day cannot change the answer", () => {
    vi.useFakeTimers();
    for (const hour of [0, 9, 12, 19, 23]) {
      vi.setSystemTime(new Date(2026, 9, 9, hour, 30));
      expect(daysFrom("2026-10-09"), `read at ${hour}:30`).toBe(0);
      expect(daysFrom("2026-10-08"), `read at ${hour}:30`).toBe(1);
      expect(daysFrom("2026-10-12"), `read at ${hour}:30`).toBe(-3);
    }
  });

  /* Across a spring-forward the local day is 23 hours, so 7 Mar → 9 Mar 2026 is
     47 elapsed hours: 1.958 days. Flooring loses a day twice a year; rounding
     does not. */
  it("still counts two days across a DST boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 9, 10, 0));
    expect(daysFrom("2026-03-07")).toBe(2);
  });

  /* The instant path is untouched by all of the above. */
  it("measures a full timestamp from the day it fell on", () => {
    expect(daysFrom(daysAway(-10).toISOString())).toBe(10);
    expect(daysFrom(daysAway(10).toISOString())).toBe(-10);
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
  it("joins make and model, and leaves the description out of the name", () => {
    expect(formatAssetModel({ make: "BOSCH", modelNumber: "GWS10", description: "grinder" })).toBe(
      "BOSCH GWS10",
    );
    expect(formatAssetModel({ make: "BOSCH", modelNumber: null, description: "grinder" })).toBe("BOSCH");
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
