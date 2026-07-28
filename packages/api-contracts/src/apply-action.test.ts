import { describe, expect, it } from "vitest";
import type { Permission } from "@stinventory/types";
import {
  ACTION_PERMISSIONS,
  AUTO_SAFE_INTENTS,
  CUSTODY_INTENTS,
  canApplyAction,
  departmentForAction,
  permissionForAction,
} from "./apply-action.js";

/*
  What an action costs, and who may perform it.

  This map is the reason the chat path is not a privilege escalation. Before it
  existed `confirmAction` was a plain protected procedure, so a foreman could
  write a $12k tool off as lost by typing a sentence — an action the equivalent
  form would have refused. Five call sites now depend on it: chat confirm, the
  manual action form, the desk resolving a message, request approval, and the
  background worker.
*/

const perms = (...p: string[]) => new Set(p as Permission[]);

describe("canApplyAction", () => {
  it("lets an equipment admin apply a write-off", () => {
    expect(canApplyAction("lost", perms("asset.manage"))).toBe(true);
  });

  it("refuses a foreman the same write-off", () => {
    /* Not an error in their face — the caller downgrades this to a request for
       the owning desk. But it must be refused here first. */
    expect(canApplyAction("lost", perms("assignment.create"))).toBe(false);
  });

  it("lets anyone annotate, since a note changes nothing", () => {
    expect(canApplyAction("report", new Set())).toBe(true);
  });

  it("refuses everything else to a caller with no permissions", () => {
    /* The background worker runs with an empty set on purpose. */
    for (const t of ["assign", "transfer", "return", "repair", "lost", "intake"]) {
      expect(canApplyAction(t, new Set())).toBe(false);
    }
  });

  it("refuses an action type it has never heard of", () => {
    /* An unknown type must not fall through to "costs nothing". */
    expect(canApplyAction("delete_everything", perms("asset.manage"))).toBe(false);
    expect(canApplyAction("", perms("asset.manage"))).toBe(false);
  });

  it("never lets a purchase request be applied directly", () => {
    /* Asking for a tool to be bought is always a request — there is nothing in
       the register to change — so it is absent from the map by design and
       falls through to requestChatAction for every role, owner included. */
    expect(canApplyAction("request_purchase", perms("asset.manage"))).toBe(false);
    expect("request_purchase" in ACTION_PERMISSIONS).toBe(false);
  });
});

describe("permissionForAction", () => {
  it("charges custody moves to the same permission the forms charge", () => {
    expect(permissionForAction("assign")).toBe("assignment.create");
    expect(permissionForAction("return")).toBe("assignment.create");
    expect(permissionForAction("transfer")).toBe("transfer.create");
  });

  it("charges register changes to asset.manage", () => {
    expect(permissionForAction("repair")).toBe("asset.manage");
    expect(permissionForAction("lost")).toBe("asset.manage");
    expect(permissionForAction("intake")).toBe("asset.manage");
  });

  it("charges nothing for an annotation", () => {
    expect(permissionForAction("report")).toBeNull();
  });
});

describe("intent classification", () => {
  it("treats every custody-moving intent as needing a human", () => {
    for (const t of ["assign", "transfer", "return", "repair", "lost"]) {
      expect(CUSTODY_INTENTS.has(t)).toBe(true);
      expect(AUTO_SAFE_INTENTS.has(t)).toBe(false);
    }
  });

  it("keeps the two sets disjoint", () => {
    /* An intent in both would be auto-applied AND expected to wait for
       confirmation — the overlap is what ADR-4 exists to prevent. */
    for (const t of AUTO_SAFE_INTENTS) {
      expect(CUSTODY_INTENTS.has(t)).toBe(false);
    }
  });

  it("only auto-applies things that cost no permission", () => {
    /* The worker has no session. Anything auto-safe must be free, or it would
       be refused at execution time after being reported as done. */
    for (const t of AUTO_SAFE_INTENTS) {
      expect(permissionForAction(t)).toBeNull();
    }
  });
});

describe("departmentForAction", () => {
  it("routes by action type", () => {
    expect(departmentForAction("repair")).toBe("Maintenance");
    expect(departmentForAction("lost")).toBe("Equipment Admin");
    expect(departmentForAction("request_purchase")).toBe("Procurement");
  });

  it("routes a truck or trailer hand-off to Fleet", () => {
    expect(departmentForAction("transfer", [{ label: "TRU-012" }])).toBe("Fleet");
    expect(departmentForAction("assign", [{ label: "Trailer 21" }])).toBe("Fleet");
  });

  it("leaves an ordinary tool with the yard", () => {
    expect(departmentForAction("assign", [{ label: "UIC-1012" }])).toBe("Equipment Yard");
  });

  it("falls back rather than returning undefined for an unknown type", () => {
    expect(departmentForAction("something_new")).toBe("Equipment Admin");
  });
});
