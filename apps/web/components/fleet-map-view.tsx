"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { VehicleStatus } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { dateTime } from "@/lib/format";
import { humanize } from "@/components/sti/status";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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

/* Dallas — where the seed lives. The map zooms to whatever the fleet is
   actually doing the moment a vehicle without a Dallas ping exists. */
const CENTER: [number, number] = [32.7767, -96.797];

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
  const vehicles = trpc.vehicle.list.useQuery();
  const assets = trpc.asset.list.useQuery({});

  const countByLocation = new Map<string, number>();
  for (const a of assets.data ?? []) {
    if (a.locationId) countByLocation.set(a.locationId, (countByLocation.get(a.locationId) ?? 0) + 1);
  }

  const tracked = (vehicles.data ?? []).filter((v) => v.gpsLat && v.gpsLng);

  if (vehicles.isLoading) {
    return <Skeleton className={cn("w-full rounded-md", className)} />;
  }

  return (
    <div className={cn("overflow-hidden rounded-md border bg-muted", className)}>
      <MapContainer center={CENTER} zoom={11} className="h-full w-full" scrollWheelZoom={scrollWheelZoom}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {tracked.map((v) => (
          <CircleMarker
            key={v.id}
            center={[Number(v.gpsLat), Number(v.gpsLng)]}
            radius={10}
            pathOptions={{
              color: "#ffffff",
              weight: 1.5,
              fillColor: VEHICLE_STATUS_COLOR[v.status],
              fillOpacity: 0.85,
            }}
          >
            <Popup>
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
            </Popup>
          </CircleMarker>
        ))}
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
