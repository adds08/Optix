"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { groupByPosition, type VehicleStatus } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { dateTime } from "@/lib/format";
import { humanize } from "@/components/sti/status";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/components/use-permissions";

/*
  The map itself, shared by the /map page and the dashboard panel.

  A tracker pushes a ping to vehicle.updateGps and the row's gps_at is stamped;
  "online" just means that stamp is fresh (see @stinventory/types/gps). Tools
  aboard a truck are wherever the truck is, so the popup carries the count —
  this is the answer to "where is the drill that should be on Truck 12".

  One component, two callers: the /map page surrounds it with the legend and
  the no-fix sidebar; the dashboard embeds it with just a legend. Both read the
  same query, so they cannot drift.
*/

/* The status colours ARE the design tokens (globals.css --ok/--warn/--idle),
   passed through as CSS colours so the map and the pills cannot drift apart. */
export const VEHICLE_STATUS_COLOR: Record<VehicleStatus, string> = {
  online: "oklch(0.505 0.092 168)",
  offline: "oklch(0.545 0.115 62)",
  no_signal: "oklch(0.545 0.012 245)",
};

export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  online: "Online",
  offline: "Offline",
  no_signal: "No signal",
};

/* Dallas — where the seed lives. This is only the opening view, used before
   any ping is known and when nothing is tracked at all; FitToTracked below
   then moves the map to the pings that actually exist. (It used to say the map
   "zooms to whatever the fleet is actually doing", which was simply untrue of
   the code beneath it — there was no fitBounds anywhere in this file, so a
   truck that pinged from outside this viewport was off-canvas with no cue.
   That was the second half of UI-67.) */
const CENTER: [number, number] = [32.7767, -96.797];

/*
  Move the view to cover every tracked position. Lives inside <MapContainer>
  because useMap() reads the map instance from its context.
*/
function FitToTracked({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  /* Refitting on every render would yank the map back from wherever the user
     panned it each time the 10s query refetches, so the fit is applied once per
     distinct set of positions rather than once per render. */
  const applied = useRef("");
  useEffect(() => {
    const key = positions.map(([lat, lng]) => `${lat},${lng}`).join("|");
    if (key === applied.current) return;
    applied.current = key;
    /* Nothing tracked: leave the opening CENTER/zoom alone. */
    if (positions.length === 0) return;
    /* One position is a zero-area bounds, and fitBounds on that zooms to the
       tile server's maximum — a street corner where a fleet map should be. Keep
       the opening zoom and just centre on the ping, which is the whole point:
       one truck in Houston must not sit off the edge of a Dallas viewport. */
    const only = positions[0];
    if (positions.length === 1 && only) {
      map.setView(only, 11);
      return;
    }
    map.fitBounds(positions, { padding: [40, 40] });
  }, [map, positions]);
  return null;
}

export function FleetMapView({
  className,
  scrollWheelZoom = false,
}: {
  className?: string;
  /* Off on the dashboard so scrolling the page past the map does not trap the
     wheel in a zoom; on for the dedicated page where the map is the whole
     point. */
  scrollWheelZoom?: boolean;
}) {
  /* Both reads are permission-gated server side (STI-302). Asking anyway from
     an account that holds neither just fills the console with 403s, so the
     query is gated on the same permission the procedure requires and the panel
     says so instead of rendering an empty map. */
  const { has } = usePermissions();
  const maySeeVehicles = has("vehicle.read");
  const maySeeAssets = has("asset.read");
  const vehicles = trpc.vehicle.list.useQuery(undefined, { enabled: maySeeVehicles });
  const assets = trpc.asset.list.useQuery({}, { enabled: maySeeAssets });

  const countByLocation = new Map<string, number>();
  for (const a of assets.data ?? []) {
    if (a.locationId) countByLocation.set(a.locationId, (countByLocation.get(a.locationId) ?? 0) + 1);
  }

  /* UI-67: one marker per POSITION, not per vehicle. Vehicles parked in the
     same yard share coordinates exactly, and a CircleMarker per vehicle drew
     them on top of one another — the tester saw 7 vehicles listed as tracked
     and 2 markers, with only the topmost of each stack clickable. Grouping is
     the honest fix: scattering the dots would invent positions no GPS unit ever
     reported, on a map whose whole job is saying where a tool really is. */
  const groups = groupByPosition(vehicles.data ?? []);
  const positions = groups.map((g) => [g.lat, g.lng] as [number, number]);

  if (!maySeeVehicles) {
    /* Say why the map is not here rather than drawing an empty one. An empty
       map reads as "no trucks are moving", which is a different and wrong
       answer to a question about the fleet. */
    return (
      <div className={cn("flex items-center justify-center rounded-md border bg-muted p-6 text-center text-sm text-muted-foreground", className)}>
        Fleet positions are not part of what this account tracks.
      </div>
    );
  }

  if (vehicles.isLoading) {
    return <Skeleton className={cn("w-full rounded-md", className)} />;
  }

  return (
    /* `isolate` + z-0 is the fix for the bell-over-map bug (docs/20, A4):
       Leaflet's internal panes stack up to z-700 INSIDE this container, and
       without a new stacking context they escaped it and drew over the
       header's popovers. The popover now sits at z-[70] in the root context,
       which is above everything this container can ever produce. */
    <div className={cn("relative z-0 isolate overflow-hidden rounded-md border bg-muted", className)}>
      <MapContainer center={CENTER} zoom={11} className="h-full w-full" scrollWheelZoom={scrollWheelZoom}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToTracked positions={positions} />
        {groups.map((g) => {
          /* A group is only created by pushing a vehicle into it, so it is never
             empty — the fallback exists to satisfy the compiler, not a case. */
          const v = g.vehicles[0]!;
          const stacked = g.vehicles.length > 1;
          return (
            <CircleMarker
              key={`${g.lat},${g.lng}`}
              center={[g.lat, g.lng]}
              radius={10}
              pathOptions={{
                color: "#ffffff",
                weight: 1.5,
                /* A stack gets the first vehicle's colour — any single colour
                   is a guess when a yard holds an online and an offline truck,
                   so the count below and the list in the popup carry the truth
                   rather than the dot pretending to. */
                fillColor: VEHICLE_STATUS_COLOR[v.status],
                fillOpacity: 0.85,
              }}
            >
              {/* The count is permanent, not on hover: the whole failure of
                  UI-67 was that a stack looked exactly like a single vehicle,
                  so there was nothing to tell anyone to click it. */}
              {stacked ? (
                <Tooltip permanent direction="top" offset={[0, -10]}>
                  {g.vehicles.length} vehicles
                </Tooltip>
              ) : null}
              <Popup maxHeight={280}>
                {stacked ? (
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="font-semibold">{g.vehicles.length} vehicles at this position</p>
                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                      {g.vehicles.map((stackedVehicle) => (
                        <li key={stackedVehicle.id}>
                          {stackedVehicle.unit}
                          <span className="text-muted-foreground">
                            {" "}
                            · {humanize(stackedVehicle.vehicleType)} ·{" "}
                            {VEHICLE_STATUS_LABEL[stackedVehicle.status]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5 text-sm">
                    <p className="font-semibold">
                      {v.unit}
                      <span className="font-normal text-muted-foreground"> · {humanize(v.vehicleType)}</span>
                    </p>
                    {v.makeModel ? <p className="text-muted-foreground">{v.makeModel}</p> : null}
                    <p>{v.projectName ?? "No project"}</p>
                    <p>Tools aboard: {countByLocation.get(v.locationId ?? "") ?? 0}</p>
                    <p className="text-muted-foreground">
                      {VEHICLE_STATUS_LABEL[v.status]}
                      {v.gpsAt ? ` · last ping ${dateTime(v.gpsAt)}` : ""}
                    </p>
                  </div>
                )}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

/* A one-line legend for the compact dashboard embed — the /map page builds its
   own richer one with the no-fix list. */
export function FleetLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
      {(Object.keys(VEHICLE_STATUS_COLOR) as VehicleStatus[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: VEHICLE_STATUS_COLOR[s] }} />
          {VEHICLE_STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}
