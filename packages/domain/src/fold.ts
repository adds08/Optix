import { INITIAL_STATE, type AssetStateSnapshot, type EventEnvelope } from "./events.js";

// Sort events by occurredAt (then id) ascending and return the snapshot for the latest
// event that carries a toState. If no event carries a toState, return the initial state.
export function foldAssetState(events: EventEnvelope[]): AssetStateSnapshot {
  const sorted = [...events].sort(compareOccurred);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i]!;
    if (e.toState) return { ...e.toState };
  }
  return { ...INITIAL_STATE };
}

// Fold many assets at once: group events by assetId, fold each.
export function foldAllAssets(
  events: EventEnvelope[],
): Map<string, AssetStateSnapshot> {
  const byAsset = new Map<string, EventEnvelope[]>();
  for (const e of events) {
    const list = byAsset.get(e.assetId);
    if (list) list.push(e);
    else byAsset.set(e.assetId, [e]);
  }
  const out = new Map<string, AssetStateSnapshot>();
  for (const [assetId, list] of byAsset) out.set(assetId, foldAssetState(list));
  return out;
}

/*
  Reconciliation (STI-106): the comparison that proves the rebuild guarantee.

  `asset.current_*` is a cache of this fold. `asset.rebuild` overwrites the cache
  and in doing so destroys the only signal a broken writer emits — the register
  quietly becomes right again and nobody learns which code path corrupted it.
  This function compares and reports instead, and writes nothing; repair stays a
  separate, explicit action.
*/

export type ProjectedAssetState = AssetStateSnapshot & {
  assetId: string;
  /** How a human names the tool in a report — e.g. "#42 TL-0042". */
  label?: string | null;
};

export type ProjectionDivergence = {
  assetId: string;
  label: string | null;
  /** Which of the four state keys disagree. */
  fields: (keyof AssetStateSnapshot)[];
  /** What replaying the ledger says the register should show. */
  folded: AssetStateSnapshot;
  /** What the register actually shows. */
  projected: AssetStateSnapshot;
};

const STATE_KEYS = ["status", "custodianId", "projectId", "locationId"] as const;

export function reconcileProjections(
  projected: ProjectedAssetState[],
  events: EventEnvelope[],
): ProjectionDivergence[] {
  const byAsset = new Map<string, EventEnvelope[]>();
  for (const e of events) {
    const list = byAsset.get(e.assetId);
    if (list) list.push(e);
    else byAsset.set(e.assetId, [e]);
  }
  const out: ProjectionDivergence[] = [];
  for (const p of projected) {
    /* An asset whose ledger carries no complete snapshot folds to INITIAL_STATE,
       and that still gets compared. An empty fold is NOT a pass — it is exactly
       the condition STI-101's baseline backfill exists to remove, and tolerating
       it here would re-hide it. */
    const folded = normalize(foldAssetState(byAsset.get(p.assetId) ?? []));
    /* Normalized on both sides so the question asked is "would a rebuild change
       the register?" — a stored snapshot with a missing key rebuilds to null, so
       missing-vs-null alone is not a divergence (the partial-snapshot bug shows
       up anyway, because the projection still holds the value the snapshot
       dropped). */
    const proj = normalize(p);
    const fields = STATE_KEYS.filter((k) => folded[k] !== proj[k]);
    if (fields.length) {
      out.push({ assetId: p.assetId, label: p.label ?? null, fields, folded, projected: proj });
    }
  }
  return out;
}

function normalize(s: AssetStateSnapshot): AssetStateSnapshot {
  return {
    /* `?? INITIAL_STATE.status` mirrors rebuild's `?? "available"` fallback. */
    status: s.status ?? INITIAL_STATE.status,
    custodianId: s.custodianId ?? null,
    projectId: s.projectId ?? null,
    locationId: s.locationId ?? null,
  };
}

function compareOccurred(a: EventEnvelope, b: EventEnvelope): number {
  const ta = typeof a.occurredAt === "string" ? a.occurredAt : a.occurredAt.toISOString();
  const tb = typeof b.occurredAt === "string" ? b.occurredAt : b.occurredAt.toISOString();
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return (a.id ?? 0) - (b.id ?? 0);
}
