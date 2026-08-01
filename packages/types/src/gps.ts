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
