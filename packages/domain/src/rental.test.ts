import { describe, expect, it } from "vitest";
import {
  RENTAL_DUE_SOON_DAYS,
  daysUntilOffRent,
  isRentalDueSoon,
  isRentalOverdue,
} from "./rules.js";

/*
  The rental clock.

  These decide when Urban gets told it is paying for something it is not using,
  which is the entire point of tracking rented equipment separately from owned.
  Getting the boundary wrong in one direction floods the desk with noise; in the
  other it stays quiet while the meter runs.
*/

const today = "2026-07-27";

describe("isRentalOverdue", () => {
  it("is overdue the day after its end date", () => {
    expect(isRentalOverdue({ status: "on_rent", endDate: "2026-07-26", today })).toBe(true);
  });

  it("is not overdue on the day it is due", () => {
    /* Due today means the vendor collects today. Flagging it in the morning
       would put a line on the chase list that nobody needs to chase. */
    expect(isRentalOverdue({ status: "on_rent", endDate: today, today })).toBe(false);
  });

  it("ignores a quote, however old", () => {
    /* Quotes carry dates in the past and cost nothing. 39 of the 137 lines in
       a real export are quotes — alerting on them would bury the 23 that
       matter. */
    expect(isRentalOverdue({ status: "quoted", endDate: "2020-01-01", today })).toBe(false);
  });

  it("ignores a line already called off rent", () => {
    expect(isRentalOverdue({ status: "returned", endDate: "2020-01-01", today })).toBe(false);
  });

  it("is not overdue without an end date", () => {
    /* Open-ended hire is a data problem to chase, not a bill to stop today. */
    expect(isRentalOverdue({ status: "on_rent", endDate: null, today })).toBe(false);
  });
});

describe("isRentalDueSoon", () => {
  it("warns inside the window", () => {
    expect(isRentalDueSoon({ status: "on_rent", endDate: "2026-07-30", today })).toBe(true);
  });

  it("includes both ends of the window", () => {
    expect(isRentalDueSoon({ status: "on_rent", endDate: today, today })).toBe(true);
    expect(isRentalDueSoon({ status: "on_rent", endDate: "2026-08-03", today })).toBe(true); // +7
  });

  it("says nothing yet outside the window", () => {
    expect(isRentalDueSoon({ status: "on_rent", endDate: "2026-08-04", today })).toBe(false); // +8
  });

  it("does not double up with overdue", () => {
    /* A line past its date is overdue, not due-soon — otherwise the desk gets
       two alerts for one problem. */
    const past = { status: "on_rent", endDate: "2026-07-01", today };
    expect(isRentalOverdue(past)).toBe(true);
    expect(isRentalDueSoon(past)).toBe(false);
  });

  it("uses the documented window", () => {
    expect(RENTAL_DUE_SOON_DAYS).toBe(7);
  });
});

describe("daysUntilOffRent", () => {
  it("counts forward to the end date", () => {
    expect(daysUntilOffRent("2026-08-03", today)).toBe(7);
  });

  it("is zero on the day", () => {
    expect(daysUntilOffRent(today, today)).toBe(0);
  });

  it("goes negative once past", () => {
    expect(daysUntilOffRent("2026-07-20", today)).toBe(-7);
  });

  it("returns null rather than a number it cannot know", () => {
    expect(daysUntilOffRent(null, today)).toBeNull();
    expect(daysUntilOffRent("not a date", today)).toBeNull();
  });

  /* Dates are parsed at UTC midnight deliberately: a local-time parse makes
     the answer depend on the server's timezone, so a line reads "due today" in
     Dallas and "overdue" on a UTC box. */
  it("does not drift across a month boundary", () => {
    expect(daysUntilOffRent("2026-08-01", "2026-07-31")).toBe(1);
    expect(daysUntilOffRent("2027-01-01", "2026-12-31")).toBe(1);
  });
});
