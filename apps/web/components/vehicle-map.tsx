"use client";

import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FleetMapView,
  VEHICLE_STATUS_VAR,
  VEHICLE_STATUS_LABEL,
} from "@/components/fleet-map-view";
import type { VehicleStatus } from "@stinventory/types";

/*
  Where the fleet is, right now.

  The map itself lives in FleetMapView (shared with the dashboard panel). This
  page adds the two things a full page can afford and a dashboard embed cannot:
  a list of every tracked unit, and the units with no GPS fix — because on a
  personal-allowance truck that is expected and on a company truck it is the
  whole problem. A vehicle with no fix is listed here, never dropped silently.
*/
export function VehicleMap() {
  const vehicles = trpc.vehicle.list.useQuery();

  const rows = vehicles.data ?? [];
  const tracked = rows.filter((v) => v.gpsLat && v.gpsLng);
  const untracked = rows.filter((v) => !v.gpsLat || !v.gpsLng);

  if (vehicles.isLoading) {
    return <Skeleton className="h-[70vh] w-full rounded-md" />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <FleetMapView className="h-[70vh]" scrollWheelZoom />

      <aside className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
          <h2 className="text-sm font-medium">Legend</h2>
          {(Object.keys(VEHICLE_STATUS_VAR) as VehicleStatus[]).map((s) => (
            <div key={s} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="size-3 rounded-full"
                style={{ backgroundColor: VEHICLE_STATUS_VAR[s] }}
              />
              <span>{VEHICLE_STATUS_LABEL[s]}</span>
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
                  <span className="text-xs text-muted-foreground">{VEHICLE_STATUS_LABEL[v.status]}</span>
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
      </aside>
    </div>
  );
}
