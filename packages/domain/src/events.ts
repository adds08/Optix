// Event-sourced core types (pure, no DB). The `transaction` table is the system of
// record; every operational state is a fold over it.

export type AssetStateSnapshot = {
  status: string;
  custodianId: string | null;
  projectId: string | null;
  locationId: string | null;
  /*
    STI-202: which truck and trailer the tool rides on — OPTIONAL keys, unlike
    the four above, because every snapshot written before the columns existed
    (including the STI-101 `projection_baseline` backfill) has no such keys and
    historical snapshots are never rewritten. The three states mean different
    things and the difference is load-bearing:

      truckId: "uuid"  — recorded: the tool is in that truck
      truckId: null    — recorded: the tool is affirmatively in NO truck
      key absent       — this event never recorded trucks at all (pre-STI-202
                         writer); the answer is UNKNOWN, not "no truck"

    A shape-aware writer must emit BOTH keys with explicit values ("in a truck,
    no trailer" is `truckId: "…", trailerId: null`); only pre-STI-202 events may
    omit them. See the fold-rule comment in fold.ts for why absent must stay
    absent through a fold.
  */
  truckId?: string | null;
  trailerId?: string | null;
};

// An event as stored in the append-only log. `toState` always carries the full new
// snapshot so the projection is simply "latest event wins" (state-snapshot variant).
export type EventEnvelope = {
  id: number;
  assetId: string;
  eventType: string;
  occurredAt: Date | string;
  fromState: AssetStateSnapshot | null;
  toState: AssetStateSnapshot | null;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
};

export const INITIAL_STATE: AssetStateSnapshot = {
  status: "available",
  custodianId: null,
  projectId: null,
  locationId: null,
};
