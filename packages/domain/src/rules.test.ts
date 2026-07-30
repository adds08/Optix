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
  const between = { fromCustodianId: "a", toCustodianId: "b" };

  it("does not gate an ordinary hand-off between two people", () => {
    /* Changed deliberately. This used to return true for any cross-person move,
       which meant a $40 hand tool needed the equipment desk exactly as much as a
       compactor did. A gate on every hand-off is not a control — it is a queue
       nobody clears, while the tools move regardless and the register drifts. */
    expect(
      requiresCustodyApproval({ ...between, assetCost: 100, highValueThreshold: 5000 }),
    ).toBe(false);
  });

  it("gates anything at or above the threshold, however it moves", () => {
    /* `>=`, not `>`: a threshold of exactly 5000 includes 5000. */
    for (const from of [null, "a"]) {
      expect(
        requiresCustodyApproval({
          fromCustodianId: from,
          toCustodianId: "b",
          assetCost: 5000,
          highValueThreshold: 5000,
        }),
      ).toBe(true);
    }
    expect(
      requiresCustodyApproval({ ...between, assetCost: 4999, highValueThreshold: 5000 }),
    ).toBe(false);
  });

  it("does not gate a first issue out of the yard below the threshold", () => {
    expect(
      requiresCustodyApproval({
        fromCustodianId: null,
        toCustodianId: "b",
        assetCost: 100,
        highValueThreshold: 5000,
      }),
    ).toBe(false);
  });

  it("does not gate a cheap tool coming back to the yard", () => {
    expect(
      requiresCustodyApproval({
        fromCustodianId: "a",
        toCustodianId: null,
        assetCost: 100,
        highValueThreshold: 5000,
      }),
    ).toBe(false);
  });

  it("still gates a valuable tool coming back", () => {
    /* Returning a compactor is the moment it is easiest to lose track of. */
    expect(
      requiresCustodyApproval({
        fromCustodianId: "a",
        toCustodianId: null,
        assetCost: 12_000,
        highValueThreshold: 5000,
      }),
    ).toBe(true);
  });

  it("disables approval entirely when the tenant has set no threshold", () => {
    /* A tenant that has not said what high value means has not asked for a
       gate. Inventing one produces the queue described above. */
    for (const highValueThreshold of [null, undefined]) {
      expect(
        requiresCustodyApproval({ ...between, assetCost: 999_999, highValueThreshold }),
      ).toBe(false);
    }
  });

  it("treats an unpriced tool as zero rather than throwing", () => {
    /* Imported rows routinely have no cost. Unknown value must not silently
       become "needs approval" for everything. */
    for (const assetCost of [null, undefined]) {
      expect(
        requiresCustodyApproval({ ...between, assetCost, highValueThreshold: 5000 }),
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
