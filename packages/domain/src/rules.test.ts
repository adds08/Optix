import { describe, expect, it } from "vitest";
import { byMostOverdue, isIdleAsset, isOverdueLoan, requiresCustodyApproval } from "./rules.js";

/*
  The approval gate and the overdue rule.

  These two decide when a person other than the actor has to be involved, and
  when the system starts chasing somebody. They are pure functions with four
  inputs each, which makes them cheap to pin down — and worth pinning, because
  four separate call sites depend on `requiresCustodyApproval` agreeing with
  itself: assignment.create, transfer.create, the chat executor and the manual
  action path.
*/

describe("requiresCustodyApproval", () => {
  const cheap = { assetCost: 100, highValueThreshold: 5000 };

  it("does not gate a first issue out of the yard", () => {
    /* Nobody held it, so there is no second party with an interest yet. */
    expect(
      requiresCustodyApproval({ fromCustodianId: null, toCustodianId: "b", ...cheap }),
    ).toBe(false);
  });

  it("gates a hand-off between two people", () => {
    expect(
      requiresCustodyApproval({ fromCustodianId: "a", toCustodianId: "b", ...cheap }),
    ).toBe(true);
  });

  it("does not gate a no-op hand-off to the same person", () => {
    expect(
      requiresCustodyApproval({ fromCustodianId: "a", toCustodianId: "a", ...cheap }),
    ).toBe(false);
  });

  it("gates a return, because the tool is leaving somebody's hands", () => {
    expect(
      requiresCustodyApproval({ fromCustodianId: "a", toCustodianId: null, ...cheap }),
    ).toBe(true);
  });

  it("gates anything at or above the high-value threshold, even from the yard", () => {
    /* A $12k plate compactor going out for the first time still wants a second
       signature. `>=`, not `>`: a threshold of exactly 5000 includes 5000. */
    expect(
      requiresCustodyApproval({
        fromCustodianId: null,
        toCustodianId: "b",
        assetCost: 5000,
        highValueThreshold: 5000,
      }),
    ).toBe(true);
    expect(
      requiresCustodyApproval({
        fromCustodianId: null,
        toCustodianId: "b",
        assetCost: 4999,
        highValueThreshold: 5000,
      }),
    ).toBe(false);
  });

  it("disables the value rule when the tenant has set no threshold", () => {
    for (const highValueThreshold of [null, undefined]) {
      expect(
        requiresCustodyApproval({
          fromCustodianId: null,
          toCustodianId: "b",
          assetCost: 999_999,
          highValueThreshold,
        }),
      ).toBe(false);
    }
  });

  it("treats an unpriced tool as zero rather than throwing", () => {
    /* Imported rows routinely have no cost. Unknown value must not silently
       become "needs approval" for everything. */
    for (const assetCost of [null, undefined]) {
      expect(
        requiresCustodyApproval({
          fromCustodianId: null,
          toCustodianId: "b",
          assetCost,
          highValueThreshold: 5000,
        }),
      ).toBe(false);
    }
  });
});

describe("isOverdueLoan", () => {
  const base = { type: "temporary" as const, status: "active", today: "2026-07-26" };

  it("is overdue once the expected end date has passed", () => {
    expect(isOverdueLoan({ ...base, expectedEndDate: "2026-07-25" })).toBe(true);
  });

  it("is not overdue on the day it is due", () => {
    /* Due today means due by end of today. Chasing somebody on the morning of
       the day they were told is how alerts get ignored. */
    expect(isOverdueLoan({ ...base, expectedEndDate: "2026-07-26" })).toBe(false);
  });

  it("never applies to a permanent assignment", () => {
    expect(
      isOverdueLoan({ ...base, type: "permanent", expectedEndDate: "2020-01-01" }),
    ).toBe(false);
  });

  it("never applies to a loan that already came back", () => {
    for (const status of ["returned", "transferred", "cancelled"]) {
      expect(isOverdueLoan({ ...base, status, expectedEndDate: "2020-01-01" })).toBe(false);
    }
  });

  it("is not overdue when no end date was set", () => {
    expect(isOverdueLoan({ ...base, expectedEndDate: null })).toBe(false);
  });
});

describe("isIdleAsset", () => {
  it("counts only available stock as idle", () => {
    expect(isIdleAsset("available")).toBe(true);
    for (const s of ["assigned", "in_maintenance", "lost", "disposed", "reserved"]) {
      expect(isIdleAsset(s)).toBe(false);
    }
  });
});

describe("byMostOverdue", () => {
  const tool = (tag: string, daysOverdue: number) => ({ tag, daysOverdue });

  it("puts the worst offender first", () => {
    /* The screenshot that prompted this had UIC-1005 at 15 days above UIC-1012
       at 35 days, under a heading that claimed "newest first". There was no
       sort at all — the rows arrived in Postgres's chosen order. */
    const rows = [tool("UIC-1005", 15), tool("UIC-1012", 35), tool("UIC-1001", 2)];
    expect([...rows].sort(byMostOverdue).map((r) => r.tag)).toEqual([
      "UIC-1012",
      "UIC-1005",
      "UIC-1001",
    ]);
  });

  it("is stable on ties, so a poll does not reshuffle the list", () => {
    /* A truck's kit goes out and comes back together, so same-day overdues are
       the common case rather than the exception. Without a tiebreak the list
       reorders itself every thirty seconds under the alerts screen's poll. */
    const a = [tool("UIC-1009", 4), tool("UIC-1002", 4), tool("UIC-1007", 4)];
    const once = [...a].sort(byMostOverdue).map((r) => r.tag);
    const again = [...a].reverse().sort(byMostOverdue).map((r) => r.tag);
    expect(once).toEqual(["UIC-1002", "UIC-1007", "UIC-1009"]);
    expect(again).toEqual(once);
  });

  it("does not care whether a tag is present", () => {
    expect([{ daysOverdue: 1 }, { daysOverdue: 9 }].sort(byMostOverdue)[0]!.daysOverdue).toBe(9);
  });
});
