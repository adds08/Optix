/*
  A vehicle is "online" when its GPS has reported recently, "offline" when it
  reported at some point but the pings stopped, and "no_signal" when it has
  never reported. This is the ONLY place that decides — the API, the locations
  page and the map all ask the same question and must get the same answer.

  The window is a constant rather than per-tenant config on purpose: telematics
  trackers ping every 1-5 minutes, so 15 minutes is a forgiving "still here"
  for even the cheapest units, and there is no tenant that needs a different
  answer yet. Making it configurable later is a one-line change here plus a
  settings field.
*/
export const VEHICLE_ONLINE_WINDOW_MINUTES = 15;

export type VehicleStatus = "online" | "offline" | "no_signal";

export function vehicleStatus(
  gpsAt: Date | string | null | undefined,
  now: Date = new Date(),
  windowMinutes: number = VEHICLE_ONLINE_WINDOW_MINUTES,
): VehicleStatus {
  if (!gpsAt) return "no_signal";
  const t = gpsAt instanceof Date ? gpsAt.getTime() : new Date(gpsAt).getTime();
  if (Number.isNaN(t)) return "no_signal";
  const ageMs = now.getTime() - t;
  /* A timestamp slightly in the future (clock skew on the tracker) is still
     "online" — it is clearly reporting. */
  return ageMs <= windowMinutes * 60_000 ? "online" : "offline";
}

/*
  Two vehicles parked in the same yard have the SAME coordinates, and a map that
  draws one dot per vehicle paints those dots on top of one another — only the
  topmost is clickable, so every vehicle underneath is unreachable. That is
  UI-67: the Fleet & Small Tools Map listed 7 vehicles as tracked and showed 2
  markers, because 30 of 31 rows sat on the exact same point. Nothing was
  missing from the data; the drawing was lossy. Callers group first and draw one
  marker per position, so a stack can announce itself instead of hiding.

  The key is the raw column text, not a rounded number. `gps_lat`/`gps_lng` are
  decimal(10,6)/decimal(11,6), so Postgres hands back a canonical fixed-scale
  string and exact equality is exactly right — no epsilon, and none wanted: a
  tolerance would merge two genuinely different pings and invent a position the
  tracker never sent.
*/
export function groupByPosition<T extends { gpsLat: string | null; gpsLng: string | null }>(
  rows: T[],
): { lat: number; lng: number; vehicles: T[] }[] {
  /* A Map keeps first-appearance order, which keeps the marker list stable
     between renders — a reordered list would remount markers and close a popup
     the user had open. */
  const groups = new Map<string, { lat: number; lng: number; vehicles: T[] }>();
  for (const row of rows) {
    /* No fix means no position: an untracked vehicle belongs to no group
       rather than to a group at 0,0 off the coast of Africa. */
    if (row.gpsLat == null || row.gpsLng == null) continue;
    const key = `${row.gpsLat},${row.gpsLng}`;
    const group = groups.get(key);
    if (group) group.vehicles.push(row);
    else groups.set(key, { lat: Number(row.gpsLat), lng: Number(row.gpsLng), vehicles: [row] });
  }
  return [...groups.values()];
}
