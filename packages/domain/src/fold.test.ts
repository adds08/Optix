import { describe, expect, it } from "vitest";
import { foldAllAssets, foldAssetState, hasSnapshotEvidence, reconcileProjections } from "./fold.js";
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
  The shape boundary (STI-202).

  Every snapshot written before truckId/trailerId existed — every historical
  event and every STI-101 projection_baseline row — carries only the four
  original keys, and historical snapshots are never rewritten. The rule pinned
  here: an ABSENT truck/trailer key folds to "not recorded" (undefined), never
  to null. An explicit null is a shape-aware writer saying "affirmatively no
  truck/trailer"; an absent key is an event that never asked. Collapsing the
  two would stamp "no truck" onto all pre-STI-202 history on the next rebuild —
  the partial-snapshot bug class, inverted.
*/
describe("the shape boundary (STI-202: truckId/trailerId)", () => {
  /* A shape-aware writer records BOTH keys explicitly. Trailer null here is
     an answer ("on truck 12, nothing hitched"), not an omission. */
  const inTruckNoTrailer: AssetStateSnapshot = {
    status: "assigned",
    custodianId: "emp-dwayne",
    projectId: "proj-trinity",
    locationId: "loc-truck-12",
    truckId: "veh-truck-12",
    trailerId: null,
  };

  it("folds old events then new events: the new shape wins with both keys intact", () => {
    const state = foldAssetState([
      ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel), // old shape
      ev("a1", "transfer", "2026-08-18T09:00:00Z", inTruckNoTrailer, withMiguel),
    ]);
    expect(state).toEqual(inTruckNoTrailer);
    expect(state.truckId).toBe("veh-truck-12");
    /* null, not undefined: the writer recorded "no trailer". */
    expect(state.trailerId).toBeNull();
  });

  it("keeps 'in a truck, no trailer' distinguishable from 'never recorded'", () => {
    /* Same four-key state, one event asked the trailer question and one never
       did. If these two folds ever agree on trailerId, the distinction
       invariant 5 requires ("independently recordable") is gone. */
    const newShape = foldAssetState([ev("a1", "assign", "2026-08-18T09:00:00Z", inTruckNoTrailer)]);
    const oldShape = foldAssetState([ev("a2", "assign", "2026-02-01T09:00:00Z", withMiguel)]);
    expect(newShape.trailerId).toBeNull();
    expect(oldShape.trailerId).toBeUndefined();
    expect(oldShape).not.toHaveProperty("trailerId");
  });

  it("folds a later old-shape event to 'not recorded', never to null or a stale truck", () => {
    /* Shape-blind writers still append AFTER shape-aware ones — STI-203
       carried the custody movers over, but the annotation writers (lost,
       report, setStatus, the bulk project/custodian writers) stay four-key
       on purpose. Replace-not-merge means the earlier truck must not leak
       forward (the tool moved), and the absent key must not be invented as
       null (nobody recorded "no truck"). */
    const state = foldAssetState([
      ev("a1", "assign", "2026-08-18T09:00:00Z", inTruckNoTrailer),
      ev("a1", "return", "2026-08-19T09:00:00Z", yard, inTruckNoTrailer), // old shape
    ]);
    expect(state).toEqual(yard);
    expect(state.truckId).toBeUndefined();
    expect(state).not.toHaveProperty("truckId");
    expect(state).not.toHaveProperty("trailerId");
  });

  it("does not change what counts as snapshot evidence (STI-110 stays whole)", () => {
    /* hasSnapshotEvidence is deliberately key-agnostic. If a four-key snapshot
       stopped counting as "complete" when the two keys arrived, every
       historical asset would reclassify as no_evidence — divergent AND
       unrepairable, ~754 at once — at the next boot sweep. */
    const oldShapeOnly = [ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel)];
    expect(hasSnapshotEvidence(oldShapeOnly)).toBe(true);

    /* And a register that matches an old-shape ledger stays clean: the two new
       keys alone must never manufacture a divergence. */
    expect(reconcileProjections([{ assetId: "a1", ...withMiguel }], oldShapeOnly)).toEqual([]);

    /* When an old-shape asset IS divergent, it is still the repairable kind. */
    const report = reconcileProjections([{ assetId: "a1", ...withDwayne }], oldShapeOnly);
    expect(report).toHaveLength(1);
    expect(report[0]!.kind).toBe("stale_projection");
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
    /* The ledger holds a snapshot, so this is the repairable kind: rebuild
       fixes it once the bypassing writer is diagnosed (STI-110). */
    expect(report[0]!.kind).toBe("stale_projection");
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
    /* And it is NAMED as the unrepairable kind (STI-110): rebuild skips a
       snapshotless asset by design, so calling this `stale_projection` would
       send the operator to a repair that silently does nothing — QA watched
       exactly that happen before the kinds existed. */
    expect(report[0]!.kind).toBe("no_evidence");
  });

  it("still checks an asset with no ledger rows at all", () => {
    const report = reconcileProjections([projectedAs("a-orphan", withMiguel)], []);
    expect(report).toHaveLength(1);
    expect(report[0]!.folded).toEqual(INITIAL_STATE);
    expect(report[0]!.kind).toBe("no_evidence");
  });

  it("calls a partial-snapshot divergence stale_projection, because rebuild WILL act on it", () => {
    /* A partial toState is evidence — broken evidence, but rebuild does not
       skip it. Classifying it no_evidence would tell the operator repair
       cannot help when in fact repair is exactly what surfaces the
       partial-snapshot bug. */
    const partial = { status: "in_maintenance" } as unknown as AssetStateSnapshot;
    const events = [ev("a1", "repair_start", "2026-02-05T09:00:00Z", partial)];
    const report = reconcileProjections([projectedAs("a1", withMiguel)], events);
    expect(report).toHaveLength(1);
    expect(report[0]!.kind).toBe("stale_projection");
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

/*
  The never-repair rule (STI-110, inheriting STI-106's reasoning).

  `asset.rebuild` skips an asset exactly when `hasSnapshotEvidence` is false,
  and `reconcileProjections` names that same condition `no_evidence`. Because
  both sides call this one predicate, "repair never touches the no-evidence
  kind" is not two pieces of code that happen to agree — it is one function.
  These tests pin the predicate; the router's skip is `!hasSnapshotEvidence`.
*/
describe("hasSnapshotEvidence", () => {
  it("is false for an empty ledger and for annotation-only history", () => {
    expect(hasSnapshotEvidence([])).toBe(false);
    expect(
      hasSnapshotEvidence([
        ev("a1", "assign", "2026-02-01T09:00:00Z", null),
        ev("a1", "status_change", "2026-02-02T09:00:00Z", null),
      ]),
    ).toBe(false);
  });

  it("is true once any event carries a snapshot — even a partial one", () => {
    expect(hasSnapshotEvidence([ev("a1", "tag", "2026-01-01T09:00:00Z", yard)])).toBe(true);
    /* Partial counts: rebuild acts on it (and in doing so surfaces the
       partial-snapshot bug), so it must not be reported as unrepairable. */
    const partial = { status: "in_maintenance" } as unknown as AssetStateSnapshot;
    expect(hasSnapshotEvidence([ev("a1", "repair_start", "2026-02-05T09:00:00Z", partial)])).toBe(true);
  });

  it("partitions every divergence: no_evidence exactly when rebuild would skip", () => {
    const withEvidence = [ev("a1", "assign", "2026-02-01T09:00:00Z", withMiguel)];
    const withoutEvidence = [ev("a2", "assign", "2026-02-01T09:00:00Z", null)];
    const report = reconcileProjections(
      [projectedFor("a1", withDwayne), projectedFor("a2", withDwayne)],
      [...withEvidence, ...withoutEvidence],
    );
    expect(report).toHaveLength(2);
    for (const d of report) {
      const events = d.assetId === "a1" ? withEvidence : withoutEvidence;
      /* The router's skip condition is `!hasSnapshotEvidence(list)`; a kind of
         `no_evidence` must coincide with it, or the alert would promise a
         repair that silently no-ops (or warn off a repair that works). */
      expect(d.kind === "no_evidence").toBe(!hasSnapshotEvidence(events));
    }
    expect(report.find((d) => d.assetId === "a1")!.kind).toBe("stale_projection");
    expect(report.find((d) => d.assetId === "a2")!.kind).toBe("no_evidence");
  });
});

function projectedFor(assetId: string, s: AssetStateSnapshot) {
  return { assetId, ...s };
}

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
