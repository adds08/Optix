import { describe, expect, it } from "vitest";
import { foldAllAssets, foldAssetState, reconcileProjections } from "./fold.js";
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

/*
  The STI-101 baseline contract.

  Migration 0013_backfill_ledger_tostate writes one `projection_baseline` event
  per asset because every ledger row before it carried a null toState — the fold
  had nothing to fold and rebuild was a no-op on all existing data. These tests
  pin the shape that SQL must emit; `baseline` below mirrors its
  jsonb_build_object exactly, JSON round-trip included, since jsonb is what the
  fold receives back from the database.
*/
describe("projection_baseline (STI-101 backfill)", () => {
  /* An asset in the yard: unknown custodian and project are EXPLICIT nulls.
     jsonb_build_object('custodianId', NULL) keeps the key; the migration relies
     on that, because the fold replaces rather than merges — a missing key is not
     "unchanged", it is undefined after the next rebuild. Shipped twice; see the
     partial-snapshot test above. */
  const baseline: AssetStateSnapshot = JSON.parse(
    JSON.stringify({
      status: "available",
      custodianId: null,
      projectId: null,
      locationId: null,
    }),
  );

  it("carries all four keys with explicit null, not a missing key", () => {
    expect(Object.keys(baseline).sort()).toEqual(["custodianId", "locationId", "projectId", "status"]);
    expect(baseline.custodianId).toBeNull();
    expect(baseline.projectId).toBeNull();
    expect(baseline.locationId).toBeNull();

    const state = foldAssetState([ev("a1", "projection_baseline", "2025-01-06T07:59:59Z", baseline)]);
    /* toBeNull, never toBeUndefined — undefined is the partial-snapshot bug. */
    expect(state.custodianId).toBeNull();
    expect(state.projectId).toBeNull();
    expect(state.locationId).toBeNull();
  });

  it("wins the fold over the historical null-toState rows it compensates for", () => {
    /* The seeded ledger's real shape: an `assign` row with no snapshot. The
       baseline is the only complete snapshot, so it must be what the fold
       returns even though the annotation row is newer. */
    const state = foldAssetState([
      ev("a1", "projection_baseline", "2025-01-06T07:59:59Z", baseline),
      ev("a1", "assign", "2025-01-06T08:00:00Z", null),
    ]);
    expect(state).toEqual(baseline);
  });

  it("never masks genuine history — a later real event beats the baseline", () => {
    /* Why the migration sets occurredAt strictly BEFORE the asset's earliest
       event: the baseline's identity id is higher than every historical row's,
       so on an occurredAt tie the id tiebreak would make it win. One second
       earlier means any real snapshot, past or future, takes precedence. */
    const state = foldAssetState([
      ev("a1", "projection_baseline", "2025-01-06T07:59:59Z", baseline),
      ev("a1", "assign", "2025-01-06T08:00:00Z", withMiguel),
    ]);
    expect(state).toEqual(withMiguel);
  });
});

/*
  The reconciliation check (STI-106).

  `asset.rebuild` repairs; this compares. The point of the check is to raise the
  signal a broken writer emits before anyone repairs it away, so a divergence
  must name the asset, the folded state and the projected state — enough to
  judge without opening psql.
*/
describe("reconcileProjections", () => {
  const projectedAs = (assetId: string, s: AssetStateSnapshot, label?: string) => ({
    assetId,
    label,
    ...s,
  });

  it("reports nothing when the register matches the fold", () => {
    const events = [
      ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel),
      ev("a1", "transfer", "2026-03-01T09:00:00Z", withDwayne, withMiguel),
    ];
    expect(reconcileProjections([projectedAs("a1", withDwayne)], events)).toEqual([]);
  });

  it("flags a known-divergent pair, naming both states and the differing fields", () => {
    /* The ledger says Miguel still holds it; the register says Dwayne does —
       the shape a bypassing writer leaves behind. */
    const events = [ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel)];
    const report = reconcileProjections(
      [projectedAs("a1", withDwayne, "#1 TL-0001")],
      events,
    );
    expect(report).toHaveLength(1);
    expect(report[0]!.assetId).toBe("a1");
    expect(report[0]!.label).toBe("#1 TL-0001");
    expect(report[0]!.folded).toEqual(withMiguel);
    expect(report[0]!.projected).toEqual(withDwayne);
    expect(report[0]!.fields.sort()).toEqual(["custodianId", "locationId", "projectId"]);
  });

  it("treats an empty fold as a divergence, never a pass", () => {
    /* The pre-STI-101 shape: every ledger row carries a null toState, so the
       fold returns INITIAL_STATE while the register shows a real holder. A
       checker tolerant of this would have reported a clean bill on a database
       whose entire safety net was a no-op — which is exactly what STI-101 had
       to backfill away. Do not weaken this. */
    const events = [ev("a1", "assign", "2026-02-01T09:00:00Z", null)];
    const report = reconcileProjections([projectedAs("a1", withMiguel)], events);
    expect(report).toHaveLength(1);
    expect(report[0]!.folded).toEqual(INITIAL_STATE);
    expect(report[0]!.projected).toEqual(withMiguel);
  });

  it("still checks an asset with no ledger rows at all", () => {
    const report = reconcileProjections([projectedAs("a-orphan", withMiguel)], []);
    expect(report).toHaveLength(1);
    expect(report[0]!.folded).toEqual(INITIAL_STATE);
  });

  it("does not call missing-key-vs-null a divergence on its own", () => {
    /* A stored partial snapshot rebuilds its missing keys to null, so if the
       register already shows null the two agree operationally. The partial
       snapshot bug still surfaces whenever the projection holds the value the
       snapshot dropped — see the divergent-pair test above. */
    const partial = { status: "available" } as unknown as AssetStateSnapshot;
    const events = [ev("a1", "status_change", "2026-02-01T09:00:00Z", partial)];
    const clean = { status: "available", custodianId: null, projectId: null, locationId: null };
    expect(reconcileProjections([projectedAs("a1", clean)], events)).toEqual([]);
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
