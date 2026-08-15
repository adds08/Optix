# Vehicle GPS tracking: online/offline status, the fleet map, and the "No tracker" nuance

Implements `docs/built/18-vehicle-tracking-and-map.md`. One derived value, one status
column, one map — no schema change, no migration.

## What shipped

- **`vehicleStatus(gpsAt)` in `@stinventory/types/gps.ts`** — the only place that
  decides online/offline/no_signal. Online = last ping within
  `VEHICLE_ONLINE_WINDOW_MINUTES` (15 min, a forgiving window even for the
  cheapest telematics units that ping every 1-5 min); offline = it reported and
  then stopped; no_signal = it never reported. A slightly-future ping (tracker
  clock skew) still counts as online. Eight unit tests pin the edges.
- **`vehicle.list` now returns `status` and `gpsSource`** — derived once
  server-side so the locations page and the map cannot disagree about whether a
  unit is live.
- **Locations page** — the "On wheels" table gained a **GPS** column. The
  personal-allowance nuance is on screen, not just in the data: a
  personal-allowance truck with no signal reads "No tracker" in muted text,
  because his own truck was never going to ping; a company truck with no signal
  reads as a red "No signal" — a tracker problem worth acting on.
- **`/map` page** — Leaflet + OpenStreetMap tiles (no API keys, no cost).
  Markers coloured by the same status tokens as the pills; popups carry unit,
  make/model, project, **tools aboard** and last-ping time. Vehicles with no GPS
  fix are listed in a sidebar ("no tracker" vs "tracker not reporting"), never
  dropped silently. Nav link under Equipment.

## Found while building

- **`gps_at` is the whole story.** No schema change was needed for any of this —
  the ingest endpoint (`vehicle.updateGps`) already stamps `gps_at = now` on
  every ping, and freshness is a pure function of that column. The spec was
  nearly "derive one value and render it".
- **The mobile app was deliberately untouched.** Field UX simplicity is a hard
  constraint and the map is a desk question ("where is Truck 12 and is it
  reporting") — the foremen's three-item nav stays as it is.
- **Next.js + Leaflet needed `dynamic(..., { ssr: false })`** with a
  `.then(m => m.VehicleMap)` loader — Leaflet touches the DOM on import, and
  Next's build would otherwise try to render it on the server.

## What was deliberately not done

- **No coordinates on `location` yet.** Gang boxes, containers, yards and
  project sites still cannot be mapped; the map is trucks and trailers only.
  That is the larger "every small tool on a map" phase (needs lat/lng on
  `location` + a geocode-from-address pass + an asset-position resolver).
- **No "vehicle went offline" alerts.** `gps_at` makes them cheap for the
  notification engine later, but nothing pings it yet.
- **No tenant-configurable window.** Telematics cadence is not meaningfully
  different between tenants; the constant is a one-line change if it ever is.

## Verification

`pnpm typecheck` 12/12, `pnpm test` 6/6 tasks (139 tests incl. the 8 new gps
tests), `pnpm lint` clean, and a full `next build` of the web app with `/map`
in the route table.
