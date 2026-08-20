import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Database } from "@stinventory/db";
import { DEFAULT_HIGH_VALUE_THRESHOLD, type Permission } from "@stinventory/types";
import {
  ACTION_PERMISSIONS,
  AUTO_SAFE_INTENTS,
  CUSTODY_INTENTS,
  applyChatAction,
  canApplyAction,
  departmentForAction,
  permissionForAction,
  requestChatAction,
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

/*
  STI-204: the executor's refusals are read by a person holding a phone, and a
  plain `throw new Error` reached them as INTERNAL_SERVER_ERROR — user guidance
  rendered as a server crash. Every refusal must carry a TRPC code the client
  can act on, with the message intact.

  Each mock below is the smallest object the path touches before it throws; a
  path that refuses before reaching the database gets no mock at all, which is
  itself the proof the refusal is pure input validation.
*/

const noDb = undefined as unknown as Database;

async function thrownBy(p: Promise<unknown>): Promise<TRPCError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof TRPCError) return e;
    throw new Error(`expected a TRPCError, got: ${String(e)}`);
  }
  throw new Error("expected a throw, but the call resolved");
}

const baseOpts = {
  tenantId: "t-1",
  actorUserId: "u-1",
  permissions: perms("asset.manage", "assignment.create", "transfer.create"),
};

/* A projection row shaped like the executor reads it. Cost decides whether the
   custody rule parks the move for approval. */
const assetRow = (acquisitionCost: string | null) => ({
  id: "a-1",
  acquisitionCost,
  currentStatus: "available",
  currentCustodianId: null,
  currentProjectId: null,
  currentLocationId: null,
});

const dbWith = (over: Record<string, unknown>) => over as unknown as Database;

describe("applyChatAction typed refusals", () => {
  it("refuses a caller without the permission as FORBIDDEN", async () => {
    /* Callers normally downgrade this to a request first — reaching the throw
       means a caller skipped canApplyAction, but the actor still must not get
       a 500 for it. */
    const err = await thrownBy(
      applyChatAction(noDb, { ...baseOpts, permissions: perms(), action: { type: "lost", assetIds: ["a-1"] } }),
    );
    expect(err.code).toBe("FORBIDDEN");
  });

  it("refuses an unknown action type as BAD_REQUEST", async () => {
    const err = await thrownBy(
      applyChatAction(noDb, { ...baseOpts, action: { type: "delete_everything" } }),
    );
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("refuses an action that resolved no assets as BAD_REQUEST", async () => {
    const err = await thrownBy(
      applyChatAction(noDb, { ...baseOpts, permissions: perms(), action: { type: "report", assetIds: [] } }),
    );
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("reports assets that match nothing in this tenant as NOT_FOUND", async () => {
    const db = dbWith({ query: { asset: { findFirst: async () => undefined } } });
    const err = await thrownBy(
      applyChatAction(db, { ...baseOpts, permissions: perms(), action: { type: "report", assetIds: ["missing"] } }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("refuses an assign without a custodian as BAD_REQUEST", async () => {
    const db = dbWith({
      query: {
        asset: { findFirst: async () => assetRow(null) },
        tenantSettings: { findFirst: async () => undefined },
      },
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    });
    const err = await thrownBy(
      applyChatAction(db, { ...baseOpts, action: { type: "assign", assetIds: ["a-1"] } }),
    );
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("refuses a transfer without any destination as BAD_REQUEST", async () => {
    const db = dbWith({
      query: {
        asset: { findFirst: async () => assetRow(null) },
        tenantSettings: { findFirst: async () => undefined },
      },
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    });
    const err = await thrownBy(
      applyChatAction(db, { ...baseOpts, action: { type: "transfer", assetIds: ["a-1"] } }),
    );
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("refuses a high-value hand-off naming nobody as BAD_REQUEST, with the guidance intact", async () => {
    /* The approval-parking branch: an expensive tool, no destination of any
       kind. The message is written for the foreman and must survive. */
    const db = dbWith({
      query: {
        asset: { findFirst: async () => assetRow(String(DEFAULT_HIGH_VALUE_THRESHOLD)) },
        tenantSettings: { findFirst: async () => undefined },
      },
    });
    const err = await thrownBy(
      applyChatAction(db, { ...baseOpts, action: { type: "assign", assetIds: ["a-1"] } }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toMatch(/names nobody/);
  });

  it("treats a high-value hand-off with no requester as the caller bug it is", async () => {
    /* canApplyAction refuses custody intents to an empty permission set, so an
       anonymous requester can only mean a caller skipped the gate — an
       internal invariant, not user guidance. */
    const db = dbWith({
      query: {
        asset: { findFirst: async () => assetRow(String(DEFAULT_HIGH_VALUE_THRESHOLD)) },
        tenantSettings: { findFirst: async () => undefined },
      },
    });
    const err = await thrownBy(
      applyChatAction(db, {
        ...baseOpts,
        actorUserId: null,
        action: { type: "assign", assetIds: ["a-1"], custodianId: "c-1" },
      }),
    );
    expect(err.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("applyIntake typed refusals", () => {
  it("refuses a draft that names nothing as BAD_REQUEST, with the guidance intact", async () => {
    /* The ticket's headline case: this exact sentence used to reach the chat
       client as a 500. Whitespace-only fields count as nothing — the worker's
       gate checks truthiness untrimmed, so this is the last line of defence. */
    const err = await thrownBy(
      applyChatAction(noDb, { ...baseOpts, action: { type: "intake", draft: { tag: "  " } } }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toMatch(/needs a tag/);
  });

  it("refuses a tag already in the register as CONFLICT", async () => {
    /* Same code asset.update uses for the same clash (routers/asset.ts) — the
       two surfaces must disagree with the user in the same voice. */
    const db = dbWith({ query: { asset: { findFirst: async () => ({ id: "existing" }) } } });
    const err = await thrownBy(
      applyChatAction(db, { ...baseOpts, action: { type: "intake", draft: { tag: "DEV204-DUP", make: "DeWalt" } } }),
    );
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toMatch(/already in the register/);
  });

  it("keeps a row-less insert an INTERNAL_SERVER_ERROR", async () => {
    /* Nothing the user said caused this — the insert itself returned no row. */
    const db = dbWith({
      query: { asset: { findFirst: async () => undefined } },
      insert: () => ({ values: () => ({ returning: async () => [] }) }),
    });
    const err = await thrownBy(
      applyChatAction(db, { ...baseOpts, action: { type: "intake", draft: { tag: "DEV204-NEW", make: "DeWalt" } } }),
    );
    expect(err.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("requestChatAction typed refusals", () => {
  it("reports named assets that match nothing in this tenant as NOT_FOUND", async () => {
    const db = dbWith({ query: { asset: { findMany: async () => [] } } });
    const err = await thrownBy(
      requestChatAction(db, { ...baseOpts, permissions: perms(), action: { type: "lost", assetIds: ["missing"] } }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });
});
