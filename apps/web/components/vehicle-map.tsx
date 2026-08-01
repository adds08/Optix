"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { VehicleStatus } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { dateTime } from "@/lib/format";
import { humanize } from "@/components/sti/status";
import { Skeleton } from "@/components/ui/skeleton";

/*
  Where the fleet is, right now.

  A tracker pushes a ping to vehicle.updateGps and the row's gps_at is stamped;
  "online" just means that stamp is fresh (see @stinventory/types/gps). Tools
  aboard a truck are wherever the truck is, so the popup carries the count —
  this is the answer to "where is the drill that should be on Truck 12".

  The map shows only vehicles with a GPS fix. One that has never reported is
  not silently dropped — it is in the sidebar, because on a personal-allowance
  truck that is expected and on a company truck it is the whole problem.
*/

/* The status colours ARE the design tokens (globals.css --ok/--warn/--idle),
   passed through as CSS colours so the map and the pills cannot drift apart. */
const STATUS_COLOR: Record<VehicleStatus, string> = {
  online: "oklch(0.505 0.092 168)",
  offline: "oklch(0.545 0.115 62)",
  no_signal: "oklch(0.545 0.012 245)",
};

const STATUS_LABEL: Record<VehicleStatus, string> = {
  online: "Online",
  offline: "Offline",
  no_signal: "No signal",
};

/* Dallas — where the seed lives. The map zooms to whatever the fleet is
   actually doing the moment a vehicle without a Dallas ping exists. */
const CENTER: [number, number] = [32.7767, -96.797];

export function VehicleMap() {
  const vehicles = trpc.vehicle.list.useQuery();
  const assets = trpc.asset.list.useQuery({});

  const countByLocation = new Map<string, number>();
  for (const a of assets.data ?? []) {
    if (a.locationId) countByLocation.set(a.locationId, (countByLocation.get(a.locationId) ?? 0) + 1);
  }

  const rows = vehicles.data ?? [];
  const tracked = rows.filter((v) => v.gpsLat && v.gpsLng);
  const untracked = rows.filter((v) => !v.gpsLat || !v.gpsLng);

  if (vehicles.isLoading) {
    return <Skeleton className="h-[70vh] w-full rounded-md" />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="h-[70vh] overflow-hidden rounded-md border bg-muted">
        <MapContainer center={CENTER} zoom={11} className="h-full w-full" scrollWheelZoom>
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
                fillColor: STATUS_COLOR[v.status],
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
                    {STATUS_LABEL[v.status]}
                    {v.gpsAt ? ` · last ping ${dateTime(v.gpsAt)}` : ""}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
          <h2 className="text-sm font-medium">Legend</h2>
          {(Object.keys(STATUS_COLOR) as VehicleStatus[]).map((s) => (
            <div key={s} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="size-3 rounded-full"
                style={{ backgroundColor: STATUS_COLOR[s] }}
              />
              <span>{STATUS_LABEL[s]}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
          <h2 className="text-sm font-medium">On the map</h2>
          {tracked.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {tracked.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span>{v.unit}</span>
                  <span className="text-xs text-muted-foreground">{STATUS_LABEL[v.status]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No vehicle has reported a position yet.</p>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
          <h2 className="text-sm font-medium">No GPS fix</h2>
          {untracked.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {untracked.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span>{v.unit}</span>
                  {/* A foreman's own truck was never going to ping — calling
                      that a problem would send somebody to the yard for nothing. */}
                  <span className="text-xs text-muted-foreground">
                    {v.ownershipType === "personal_allowance" ? "no tracker" : "tracker not reporting"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Every vehicle has a position.</p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Trucks and trailers only. Gang boxes, containers and yards have no coordinates yet —
          mapping those is the larger "every small tool on a map" phase.
        </p>
      </aside>
    </div>
  );
}
