# Vehicle GPS tracking, online/offline status, and the map

Status: **spec** (implemented in the same change).

## What exists

- `vehicle.gps_lat` / `gps_lng` / `gps_at` / `gps_source` — see `packages/db/src/schema/location.ts`.
- `vehicle.updateGps` — the ingest endpoint a tracker (or a person) calls; it stamps
  `gps_at = now` and records the source. No polling, no broker — the tracker pushes.
- `vehicle.list` exposes `gpsLat` / `gpsLng` / `gpsAt` but **not** `gpsSource`.
- `ownershipType`: `company_owned` (tracker installed) vs `personal_allowance` (the
  foreman's own truck, paid an allowance — usually **no** tracker).

## The one derived value

**Online/offline is a function of `gps_at` freshness.** No schema change, no new
column — it is computed wherever the row is read:

| `gps_at` | Meaning |
|---|---|
| within the window (default 15 min) | **online** — reporting now |
| older than the window | **offline** — it reported, then stopped |
| null | **no signal** — never reported |

`personal_allowance` + no signal is *expected* (no tracker installed), not a fault;
`company_owned` + no signal is a tracker problem. Same status, different copy.

`VEHICLE_ONLINE_WINDOW_MINUTES` lives in `@stinventory/types` next to the pure
`vehicleStatus(gpsAt)` helper so the API and every client share one answer.

## What gets built

1. `packages/types/src/gps.ts` — `vehicleStatus(gpsAt)` → `online | offline | no_signal`,
   plus the window constant. Unit tested.
2. `vehicle.list` — adds computed `status` and exposes `gpsSource`.
3. Locations page — the "On wheels" table gains a Status column with pills
   (Online / Offline / No signal), and the no-signal copy distinguishes
   company-owned (tracker not reporting) from personal-allowance (no tracker expected).
4. `/map` page — **Leaflet + OpenStreetMap tiles** (no API keys, no cost).
   Every vehicle with a GPS fix gets a marker coloured by status; the popup shows
   unit, make/model, project, tools aboard, ownership, and when it last pinged.
   Vehicles without a fix are listed in a sidebar, not dropped silently.
   Fixed locations (yards, gang boxes, containers) have **no coordinates** and are
   not on the map yet — that is the larger "all small tools on a map" phase.

## Deliberately not in scope

- Coordinates on `location` (needed before gang boxes/containers/yards can be mapped).
- Live asset positions for tools carried by a person with no vehicle.
- Trackers that poll instead of push; SMS/email offline alerts (the notification
  engine can add "vehicle went offline" later, since `gps_at` makes it cheap).
- Tenant-configurable window.
