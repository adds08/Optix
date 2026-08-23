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

/* The radius the map draws a vehicle dot at, in screen pixels. It lives here
   rather than only in the component because `groupByPosition` below needs to
   know how big a dot is to answer "would these two overlap". */
export const VEHICLE_MARKER_RADIUS_PX = 10;

/* Leaflet draws with CRS.EPSG3857 over 256px tiles, so the whole world is
   256 * 2^zoom pixels wide. Reproducing that projection here — it is four lines
   of arithmetic and has not changed since Web Mercator was standardised — is
   what lets a pure, testable function answer a question about screen distance
   without holding a map instance. */
const TILE_SIZE = 256;
/* Web Mercator is undefined at the poles and Leaflet clamps here too. */
const MAX_MERCATOR_LAT = 85.05112878;

export function projectToPixels(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const latRad = (clamped * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  };
}

/*
  Vehicles whose dots would land on top of one another share ONE marker, so a
  stack can announce itself instead of hiding. That is UI-67: the Fleet & Small
  Tools Map listed 7 vehicles as tracked and drew 2 dots, because only the
  topmost of each pile is clickable and a pile looks exactly like a single
  vehicle. Nothing was missing from the data; the drawing was lossy.

  This grouped on the raw column text first, on the reasoning that vehicles
  parked in one yard share coordinates EXACTLY, so string equality was right and
  "no epsilon, and none wanted — a tolerance would merge two genuinely different
  pings and invent a position the tracker never sent". The first half of that was
  only true of the local seed, which parks 30 of 31 vehicles on one hardcoded
  point. Real trackers do not agree to six decimal places: on the deployed fleet
  no two rows shared a coordinate, every group held exactly one vehicle, and the
  bug came back untouched — 7 vehicles, 3 piles, no counts. The pairs were
  0.0001° apart, about 11 metres, which at zoom 11 is a hundredth of a pixel.

  The second half of that reasoning still holds, and this keeps it: the group is
  anchored on the FIRST vehicle's real coordinates, never a centroid, so no
  marker is ever drawn at a position no tracker reported. What changed is the
  question. "Same point" is not a fact about coordinates, it is a fact about the
  zoom you are looking at — 11 metres is one dot at city zoom and two clearly
  separate dots at street zoom. So it is asked in screen space, and the answer
  moves with the map: zoom in and a pile genuinely splits apart.
*/
export function groupByPosition<T extends { gpsLat: string | null; gpsLng: string | null }>(
  rows: T[],
  zoom: number,
): { lat: number; lng: number; vehicles: T[] }[] {
  /* Two dots of radius r are visually distinct once their centres are 2r apart;
     any closer and they overlap into the single blob UI-67 is about. */
  const minSeparation = VEHICLE_MARKER_RADIUS_PX * 2;
  /* Insertion order is preserved, which keeps the marker list stable between
     renders — a reordered list would remount markers and close a popup the user
     had open. */
  const groups: { lat: number; lng: number; px: { x: number; y: number }; vehicles: T[] }[] = [];
  for (const row of rows) {
    /* No fix means no position: an untracked vehicle belongs to no group
       rather than to a group at 0,0 off the coast of Africa. */
    if (row.gpsLat == null || row.gpsLng == null) continue;
    const lat = Number(row.gpsLat);
    const lng = Number(row.gpsLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const px = projectToPixels(lat, lng, zoom);
    /* Greedy against the group ANCHOR, not against every member: a chain of
       vehicles each just under 2r from the last would otherwise collapse into
       one group spanning the whole map. Comparing to the anchor keeps a group
       no wider than the dot the user actually clicks. */
    const hit = groups.find((g) => Math.hypot(g.px.x - px.x, g.px.y - px.y) < minSeparation);
    if (hit) hit.vehicles.push(row);
    else groups.push({ lat, lng, px, vehicles: [row] });
  }
  return groups.map(({ lat, lng, vehicles }) => ({ lat, lng, vehicles }));
}
