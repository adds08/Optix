import { describe, expect, it } from "vitest";
import { foldAllAssets, foldAssetState } from "./fold.js";
import { INITIAL_STATE, type AssetStateSnapshot, type EventEnvelope } from "./events.js";

/*
  The rebuild guarantee.

  Everything in the register — where a tool is, who has it, whether it is lost —
  is a projection of the `transaction` table, and the whole architecture rests
  on being able to throw those columns away and rebuild them from the log. That
  claim had never been executed once.

  These tests are the executable version of it.
*/

let nextId = 1;

function ev(
  assetId: string,
  eventType: string,
  occurredAt: string,
  toState: AssetStateSnapshot | null,
  fromState: AssetStateSnapshot | null = null,
): EventEnvelope {
  return { id: nextId++, assetId, eventType, occurredAt, fromState, toState };
}

const yard: AssetStateSnapshot = {
  status: "available",
  custodianId: null,
  projectId: null,
  locationId: "loc-yard",
};
const withMiguel: AssetStateSnapshot = {
  status: "assigned",
  custodianId: "emp-miguel",
  projectId: "proj-legacy",
  locationId: "loc-gangbox",
};
const withDwayne: AssetStateSnapshot = {
  status: "assigned",
  custodianId: "emp-dwayne",
  projectId: "proj-trinity",
  locationId: "loc-trailer",
};

describe("foldAssetState", () => {
  it("returns the initial state for a tool with no events", () => {
    expect(foldAssetState([])).toEqual(INITIAL_STATE);
  });

  it("rebuilds the current holder from a full custody chain", () => {
    const state = foldAssetState([
      ev("a1", "tag", "2026-01-01T09:00:00Z", yard),
      ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel, yard),
      ev("a1", "transfer", "2026-03-01T09:00:00Z", withDwayne, withMiguel),
    ]);
    expect(state).toEqual(withDwayne);
  });

  it("does not depend on the order events are supplied in", () => {
    const chain = [
      ev("a1", "tag", "2026-01-01T09:00:00Z", yard),
      ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel, yard),
      ev("a1", "transfer", "2026-03-01T09:00:00Z", withDwayne, withMiguel),
    ];
    /* A query without an ORDER BY returns rows in whatever order the planner
       likes. The fold has to sort for itself or the projection depends on the
       physical layout of the table. */
    const shuffled = [chain[2]!, chain[0]!, chain[1]!];
    expect(foldAssetState(shuffled)).toEqual(foldAssetState(chain));
  });

  it("breaks same-timestamp ties by id, so a bulk write is deterministic", () => {
    /* `assignToProject` and the container hand-off both insert many events in
       one statement — they land on the same occurredAt. Without the id
       tiebreak the winner would be arbitrary. */
    const a = ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel);
    const b = ev("a1", "transfer", "2026-02-01T09:00:00Z", withDwayne);
    expect(foldAssetState([a, b])).toEqual(withDwayne);
    expect(foldAssetState([b, a])).toEqual(withDwayne);
  });

  it("ignores annotation events that carry no state", () => {
    /* A request raised against a tool writes an event to put the ask in its
       history without moving anything. `requestChatAction` writes an unchanged
       toState; a note may carry none at all. Neither may disturb the fold. */
    const state = foldAssetState([
      ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel),
      ev("a1", "status_change", "2026-02-02T09:00:00Z", null),
    ]);
    expect(state).toEqual(withMiguel);
  });

  it("treats a lost tool as still held, so it stays on the clearance queue", () => {
    const lost = { ...withMiguel, status: "lost" };
    const state = foldAssetState([
      ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel),
      ev("a1", "lost", "2026-02-10T09:00:00Z", lost, withMiguel),
    ]);
    expect(state.status).toBe("lost");
    expect(state.custodianId).toBe("emp-miguel");
  });

  it("accepts Date and string timestamps interchangeably", () => {
    /* Drizzle hands back Date objects; fixtures and JSON hand back strings. */
    const state = foldAssetState([
      { ...ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel), occurredAt: new Date("2026-02-01T09:00:00Z") },
      ev("a1", "transfer", "2026-03-01T09:00:00Z", withDwayne),
    ]);
    expect(state).toEqual(withDwayne);
  });

  /*
    The bug this codebase actually shipped, pinned.

    `messaging.manualEntry` wrote `toState: { status: "in_maintenance" }` with
    no other keys. Because the fold is last-snapshot-wins rather than a merge,
    that snapshot does not mean "only the status changed" — it means custodian,
    project and location are now undefined. Rebuilding the projection would
    have emptied those fields on every tool the desk had ever resolved.

    Every writer must emit a COMPLETE toState. This test is what would have
    caught it.
  */
  it("replaces rather than merges — a partial snapshot loses the other fields", () => {
    const partial = { status: "in_maintenance" } as unknown as AssetStateSnapshot;
    const state = foldAssetState([
      ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel),
      ev("a1", "repair_start", "2026-02-05T09:00:00Z", partial),
    ]);
    expect(state.status).toBe("in_maintenance");
    expect(state.custodianId).toBeUndefined();
    expect(state).not.toHaveProperty("projectId", "proj-legacy");
  });
});

describe("foldAllAssets", () => {
  it("keeps each tool's chain separate", () => {
    const map = foldAllAssets([
      ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel),
      ev("a2", "assign", "2026-02-01T09:00:00Z", withDwayne),
      ev("a1", "return", "2026-03-01T09:00:00Z", yard),
    ]);
    expect(map.get("a1")).toEqual(yard);
    expect(map.get("a2")).toEqual(withDwayne);
    expect(map.size).toBe(2);
  });

  it("returns an empty map for an empty log", () => {
    expect(foldAllAssets([]).size).toBe(0);
  });
});
