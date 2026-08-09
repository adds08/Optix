import { describe, expect, it } from "vitest";
import { custodyOutcome, isIdleAsset } from "./rules.js";

/*
  The custody gate.

  It decides the one case where a person other than the actor has to be
  involved: a tool worth enough that one admin should not move it alone. Worth
  pinning down because three call sites depend on it agreeing with itself —
  assignment.create, transfer.create and the chat/manual action executor.

  This file used to also cover `isOverdueLoan` and a third `verify` outcome for
  foreman-to-foreman borrows. Both went with the borrow model on 2026-08-09:
  tools are moved by the equipment desk, so there is no loan to fall due and no
  hand-off to verify afterwards.
*/

describe("custodyOutcome", () => {
  it("lets the desk move an ordinary tool without ceremony", () => {
    expect(custodyOutcome({ assetCost: 90, highValueThreshold: 5000 })).toBe("auto");
  });

  it("asks for a second signature at the threshold", () => {
    /* At, not above — a tool priced exactly at the threshold is the one most
       likely to have been priced there on purpose. */
    expect(custodyOutcome({ assetCost: 5000, highValueThreshold: 5000 })).toBe("approve");
  });

  it("asks for a second signature above the threshold", () => {
    expect(custodyOutcome({ assetCost: 12000, highValueThreshold: 5000 })).toBe("approve");
  });

  it("disables the value gate entirely when the tenant has set no threshold", () => {
    /* A tenant that has not said what "high value" means has not asked for the
       gate. Treating null as zero would park every single move. */
    expect(custodyOutcome({ assetCost: 999999, highValueThreshold: null })).toBe("auto");
    expect(custodyOutcome({ assetCost: 999999, highValueThreshold: undefined })).toBe("auto");
  });

  it("treats an unpriced tool as zero rather than throwing", () => {
    /* Most of the register has no acquisition cost. An unpriced tool must not
       become un-movable. */
    expect(custodyOutcome({ assetCost: null, highValueThreshold: 5000 })).toBe("auto");
    expect(custodyOutcome({ assetCost: undefined, highValueThreshold: 5000 })).toBe("auto");
  });
});

describe("isIdleAsset", () => {
  it("counts only available stock as idle", () => {
    expect(isIdleAsset("available")).toBe(true);
    expect(isIdleAsset("assigned")).toBe(false);
    expect(isIdleAsset("in_maintenance")).toBe(false);
    expect(isIdleAsset("lost")).toBe(false);
  });
});
