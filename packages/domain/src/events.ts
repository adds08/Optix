// Event-sourced core types (pure, no DB). The `transaction` table is the system of
// record; every operational state is a fold over it.

export type AssetStateSnapshot = {
  status: string;
  custodianId: string | null;
  projectId: string | null;
  locationId: string | null;
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
