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

function compareOccurred(a: EventEnvelope, b: EventEnvelope): number {
  const ta = typeof a.occurredAt === "string" ? a.occurredAt : a.occurredAt.toISOString();
  const tb = typeof b.occurredAt === "string" ? b.occurredAt : b.occurredAt.toISOString();
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return (a.id ?? 0) - (b.id ?? 0);
}
