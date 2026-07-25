"use client";

import { MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, TableWrap, Metric } from "@/components/sti/page";
import { Tag, humanize } from "@/components/sti/status";
import { relative } from "@/lib/format";

/*
  Every place a tool can be — including trucks and trailers.

  These are NOT a fleet to manage. A truck matters here because it is a
  location that moves: it answers "where is UIC-1012?" with "Truck 12", and
  its GPS gives the tools on board a position. No mileage, no service
  schedules, no driver rosters.
*/
export default function LocationsPage() {
  const locations = trpc.location.list.useQuery();
  const vehicles = trpc.vehicle.list.useQuery();
  const assets = trpc.asset.list.useQuery({});

  const locs = locations.data ?? [];
  const vehs = vehicles.data ?? [];

  /* How many tools sit at each location — the only number that matters here. */
  const countByLocation = new Map<string, number>();
  for (const a of assets.data ?? []) {
    if (a.locationId) countByLocation.set(a.locationId, (countByLocation.get(a.locationId) ?? 0) + 1);
  }

  const movable = locs.filter((l) => l.type === "vehicle");
  const fixed = locs.filter((l) => l.type !== "vehicle");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Equipment"
        title="Locations"
        description="Every place a tool can be — yards, containers, gang boxes, and the trucks and trailers that carry them around."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Fixed locations" value={fixed.length} loading={locations.isLoading} hint="yards, containers, gang boxes" />
        <Metric label="On wheels" value={movable.length} loading={locations.isLoading} hint="trucks and trailers" />
        <Metric label="Tools placed" value={countByLocation.size ? Array.from(countByLocation.values()).reduce((a, b) => a + b, 0) : 0} loading={assets.isLoading} />
      </div>

      {locations.isLoading ? (
        <TableSkeleton cols={4} />
      ) : locations.isError ? (
        <ErrorNote message="Locations could not be loaded." />
      ) : !locs.length ? (
        <EmptyState icon={MapPin} title="No locations defined" description="Add a warehouse or container to start placing tools." />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Fixed</h2>
            <TableWrap>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Name", "Type", "Warehouse", "Project", "Tools here"].map((h, i) => (
                      <th key={h} className={`label-xs px-4 py-2.5 ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fixed.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5 font-medium">{l.name}</td>
                      <td className="px-4 py-2.5">{humanize(l.type)}</td>
                      <td className="px-4 py-2.5">{l.warehouseName ?? "—"}</td>
                      <td className="px-4 py-2.5">{l.projectName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tnum">{countByLocation.get(l.id) ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">On wheels</h2>
            <p className="text-sm text-muted-foreground">
              Tools loaded on these inherit their position, so a tool in a truck is never
              &ldquo;missing&rdquo; — it is wherever the truck is.
            </p>
            {vehicles.isLoading ? (
              <TableSkeleton cols={5} />
            ) : !vehs.length ? (
              <EmptyState title="No trucks or trailers registered" />
            ) : (
              <TableWrap>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {["Unit", "Type", "Assigned to", "Project", "Last position", "Tools aboard"].map((h, i) => (
                        <th key={h} className={`label-xs px-4 py-2.5 ${i === 5 ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vehs.map((v) => (
                      <tr key={v.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5"><Tag>{v.unit}</Tag></td>
                        <td className="px-4 py-2.5 capitalize">{v.vehicleType}</td>
                        <td className="px-4 py-2.5">{v.foremanName ?? "—"}</td>
                        <td className="px-4 py-2.5">{v.projectName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {v.gpsAt ? relative(v.gpsAt) : "no signal yet"}
                        </td>
                        <td className="px-4 py-2.5 text-right tnum">
                          {v.locationId ? (countByLocation.get(v.locationId) ?? 0) : 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
        </>
      )}
    </div>
  );
}
